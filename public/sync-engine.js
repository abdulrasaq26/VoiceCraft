// AETHER Synchronization Engine — the single source of temporal truth.
//
// Not a Fish Speech timing system. Fish is one PRODUCER among several, and the
// renderer must never know which one answered. Adding ElevenLabs, Kokoro or
// anything future should mean writing one adapter, not touching a renderer.
//
// The engine walks a capability ladder and returns the same Timeline shape
// whatever rung it lands on, tagged with how it was obtained and how much to
// trust it:
//
//   native     the narrator returned real word timings itself
//   phoneme    phoneme timings exist; words derived from them
//   aligned    forced alignment ran against the rendered audio
//   measured   real audio duration, words distributed by syllable weight
//   estimated  text only — a guess, and it says so
//
// Every renderer consumes Timeline. None of them computes timing. That rule is
// the whole point: two subsystems doing their own timing arithmetic is how a
// mouth ends up moving while the narrator is silent.
(() => {
  'use strict';

  const round = (n) => Math.round(n * 1000) / 1000;
  const CONFIDENCE = { native: 1, phoneme: 0.95, aligned: 0.9, measured: 0.6, estimated: 0.3 };
  const RANK = { native: 0, phoneme: 1, aligned: 2, measured: 3, estimated: 4 };

  // --- provider registry ---------------------------------------------------
  //
  // A provider declares what it can do and how to do it. `probe` is optional
  // and async, so a backend that gained alignment after a restart is noticed
  // without a page reload.
  const providers = [];

  function register(provider) {
    if (!provider || !provider.name) throw new Error('a provider needs a name');
    const existing = providers.findIndex((p) => p.name === provider.name);
    if (existing > -1) providers.splice(existing, 1);
    providers.push(Object.assign({ priority: 50 }, provider));
    providers.sort((a, b) => a.priority - b.priority);
    return provider.name;
  }

  function list() {
    return providers.map((p) => ({
      name: p.name,
      priority: p.priority,
      provides: p.provides || 'aligned',
      hasProbe: typeof p.probe === 'function'
    }));
  }

  // --- timeline shape ------------------------------------------------------

  function emptyTimeline(source) {
    return {
      source: source || 'estimated',
      confidence: CONFIDENCE[source] || 0,
      duration: 0,
      words: [],
      sentences: [],
      pauses: [],
      phonemes: []
    };
  }

  /** Group words into sentences using punctuation, so scenes can anchor to a
   *  sentence index rather than a second — the thing that keeps a storyboard
   *  aligned when narration is regenerated at a different pace. */
  function deriveSentences(words) {
    const out = [];
    let start = null;
    let buf = [];
    words.forEach((w, i) => {
      if (start === null) start = w.start;
      buf.push(w.text);
      const ends = /[.!?]["')\]]?$/.test(w.text) || i === words.length - 1;
      if (ends) {
        out.push({ index: out.length, text: buf.join(' '), start: round(start), end: round(w.end) });
        start = null;
        buf = [];
      }
    });
    return out;
  }

  /** Gaps between words. Useful on their own: a gesture landing in a pause
   *  reads as deliberate, and a cut on a pause reads as edited. */
  function derivePauses(words, minSec) {
    const min = minSec == null ? 0.18 : minSec;
    const out = [];
    for (let i = 1; i < words.length; i++) {
      const gap = words[i].start - words[i - 1].end;
      if (gap >= min) out.push({ start: round(words[i - 1].end), end: round(words[i].start), sec: round(gap) });
    }
    return out;
  }

  /** Normalise anything a provider returns into the one shape renderers know. */
  function normalize(raw, source, fallbackDuration) {
    const tl = emptyTimeline(source);
    const words = (raw && raw.words ? raw.words : [])
      .map((w) => ({
        text: String(w.text || w.word || '').trim(),
        start: round(Number(w.start) || 0),
        end: round(Number(w.end) || 0)
      }))
      .filter((w) => w.text && w.end >= w.start);

    tl.words = words;
    tl.phonemes = (raw && raw.phonemes) || [];
    tl.duration = round(Number(raw && raw.duration) || fallbackDuration ||
      (words.length ? words[words.length - 1].end : 0));
    tl.sentences = deriveSentences(words);
    tl.pauses = derivePauses(words);
    tl.confidence = CONFIDENCE[source] || 0;
    return tl;
  }

  // --- caching -------------------------------------------------------------
  //
  // Alignment is expensive — a Whisper pass on CPU is seconds per chunk. The
  // same audio and script must never be aligned twice.
  const cache = new Map();

  function hash(str) {
    let h = 2166136261;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(36);
  }

  async function keyFor(text, opts) {
    const o = opts || {};
    const t = hash(text);
    // The key must cover EVERY input that changes the answer, not just the
    // text. Keying on text alone made three calls with different durations and
    // native timings collide on one entry, so the first (worst) result was
    // served to all of them — a measured timeline came back tagged 'estimated'
    // and supplied native timings were silently discarded.
    const d = o.durationSec ? Math.round(o.durationSec * 100) : 0;
    const n = o.native && o.native.words && o.native.words.length ? `n${o.native.words.length}` : '';
    const a = o.audioBlob ? `${o.audioBlob.size}:${o.audioBlob.type || 'x'}` : '';
    return `t:${t}|d:${d}|${n}|a:${a}`;
  }

  function clearCache() {
    const n = cache.size;
    cache.clear();
    return n;
  }

  // --- the ladder ----------------------------------------------------------

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = String(r.result || '');
        const i = s.indexOf(',');
        resolve(i > -1 ? s.slice(i + 1) : '');
      };
      r.onerror = () => reject(new Error('could not read audio'));
      r.readAsDataURL(blob);
    });
  }

  /**
   * Build the best timeline obtainable for this narration.
   *
   * opts: { audioBlob, durationSec, native, allowAlignment, signal }
   * `native` is timing the narrator already returned — always preferred, since
   * no alignment can beat the model that produced the audio.
   */
  async function timelineFor(text, opts = {}) {
    const key = await keyFor(text, opts);
    if (cache.has(key) && !opts.force) return cache.get(key);

    // 1. Native timings from the narrator.
    if (opts.native && Array.isArray(opts.native.words) && opts.native.words.length) {
      const tl = normalize(opts.native, opts.native.phonemes && opts.native.phonemes.length ? 'phoneme' : 'native', opts.durationSec);
      cache.set(key, tl);
      return tl;
    }

    // 2. Forced alignment, from whichever provider is available and cheapest.
    if (opts.allowAlignment !== false && opts.audioBlob) {
      for (const p of providers) {
        if (typeof p.align !== 'function') continue;
        try {
          if (typeof p.probe === 'function' && !(await p.probe())) continue;
          const b64 = await blobToBase64(opts.audioBlob);
          const raw = await p.align({ audio_b64: b64, text, signal: opts.signal });
          if (raw && Array.isArray(raw.words) && raw.words.length) {
            const tl = normalize(raw, 'aligned', opts.durationSec);
            tl.provider = p.name;
            cache.set(key, tl);
            return tl;
          }
        } catch (err) {
          // A provider that fails must not sink the render — drop to the next
          // rung. Alignment is an improvement, never a requirement.
          console.warn(`[Sync] provider "${p.name}" failed: ${err.message}`);
        }
      }
    }

    // 3/4. Fall back to the measured-or-estimated distribution.
    const base = window.BlvckTimeline
      ? window.BlvckTimeline.build(text, opts.durationSec)
      : { source: 'estimated', duration: opts.durationSec || 0, words: [] };
    const tl = normalize(base, opts.durationSec ? 'measured' : 'estimated', opts.durationSec);
    cache.set(key, tl);
    return tl;
  }

  /** Join per-chunk timelines into one, offsetting each by what came before. */
  function concat(timelines) {
    const list2 = (timelines || []).filter(Boolean);
    if (!list2.length) return emptyTimeline('estimated');
    let worst = 'native';
    let offset = 0;
    const words = [];
    list2.forEach((tl) => {
      if (RANK[tl.source] > RANK[worst]) worst = tl.source;
      tl.words.forEach((w) => words.push({
        text: w.text, start: round(w.start + offset), end: round(w.end + offset)
      }));
      offset += tl.duration || 0;
    });
    const out = normalize({ words, duration: offset }, worst, offset);
    out.segments = list2.length;
    return out;
  }

  // --- queries every renderer shares --------------------------------------

  const wordAt = (tl, t) => (tl && tl.words.find((w) => t >= w.start && t < w.end)) || null;
  const speakingAt = (tl, t) => !!wordAt(tl, t);
  const sentenceAt = (tl, t) => (tl && tl.sentences.find((s) => t >= s.start && t < s.end)) || null;
  const inPause = (tl, t) => !!(tl && tl.pauses.find((p) => t >= p.start && t < p.end));

  function find(tl, phrase) {
    return window.BlvckTimeline ? window.BlvckTimeline.find(tl, phrase) : null;
  }

  function mouthAt(tl, t) {
    return window.BlvckTimeline ? window.BlvckTimeline.mouthAt(tl, t) : 0.05;
  }

  /**
   * Resolve the Director's semantic cues into timed events.
   *
   * The Director says "point at 'blood pressure'" or "reveal the chart after
   * 'research found'". It never says a number, so a plan survives the
   * narration being regenerated at a different pace or in a different voice.
   */
  function schedule(tl, cues) {
    const events = [];
    (cues || []).forEach((cue) => {
      if (!cue) return;
      let time = Number.isFinite(cue.time) ? cue.time : null;

      if (time == null && Number.isFinite(cue.sentence)) {
        const s = tl.sentences[cue.sentence];
        if (s) time = cue.after ? s.end : s.start;
      }
      if (time == null && cue.at) {
        const hit = find(tl, cue.at);
        if (hit) time = cue.after ? hit.end : hit.start;
      }
      // A cue that cannot be resolved is DROPPED, never given a made-up time —
      // an event on the wrong word is worse than no event.
      if (time == null) return;

      events.push({
        time: round(Math.max(0, time + (cue.offset || 0))),
        type: cue.type || 'gesture',
        action: cue.action || '',
        target: cue.target || '',
        value: cue.value
      });
    });
    return events.sort((a, b) => a.time - b.time);
  }

  const due = (events, since, t) => (events || []).filter((e) => e.time > since && e.time <= t);

  // --- built-in provider: the AETHER backend ------------------------------
  //
  // Registered here rather than hard-coded into the engine, so it is one
  // implementation of an interface and not the interface itself.
  register({
    name: 'aether-forced-alignment',
    priority: 10,
    provides: 'aligned',
    async probe() {
      if (!window.FishAdapter || !window.FishAdapter.endpoint || !window.FishAdapter.endpoint()) return false;
      try {
        const r = await fetch('/api/proxy/fish/aether/status', {
          headers: { 'x-fish-endpoint': window.FishAdapter.endpoint() }
        });
        if (!r.ok) return false;
        const j = await r.json();
        return j.alignment === true;
      } catch {
        return false;
      }
    },
    async align({ audio_b64, text }) {
      const r = await fetch('/api/proxy/fish/v1/align', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-fish-endpoint': window.FishAdapter ? window.FishAdapter.endpoint() : ''
        },
        body: JSON.stringify({ audio_b64, text })
      });
      if (!r.ok) throw new Error(`align failed (HTTP ${r.status})`);
      return r.json();
    }
  });

  window.BlvckSync = {
    register,
    list,
    timelineFor,
    concat,
    normalize,
    emptyTimeline,
    wordAt,
    speakingAt,
    sentenceAt,
    inPause,
    find,
    mouthAt,
    schedule,
    due,
    clearCache,
    cacheSize: () => cache.size,
    CONFIDENCE
  };
})();
