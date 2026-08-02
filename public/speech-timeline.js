// Speech Timeline — the master clock for every animated thing.
//
// The renderer used to guess. Visemes cycled on elapsed time, gestures fired on
// fixed delays, and whiteboards drew at a constant speed, so a mouth moved
// while the narrator was silent and an arrow appeared before the word it
// pointed at. Independent animations playing next to audio is what makes a
// video feel machine-made.
//
// Everything now reads from one timeline: lip sync, gestures, camera,
// whiteboard drawing, chart reveals, highlights and subtitles.
//
// WHERE THE TIMING COMES FROM — measured, not assumed:
//
//   Fish Speech returns raw audio and nothing else. Its request schema carries
//   no alignment option and the response is an arrayBuffer, so there are no
//   word or phoneme timestamps to consume. Anyone building on "Fish gives us
//   timing" is building on sand.
//
//   But the Fish notebook already loads faster_whisper for voice-clone
//   transcription, and faster_whisper supports word_timestamps=True. So the
//   forced alignment this needs is an endpoint on a backend that already has
//   the model resident — not a new dependency.
//
// Three tiers, best first, each honest about what it is:
//
//   'aligned'  real word timings from Whisper forced alignment
//   'measured' real per-chunk durations from decoded audio, words distributed
//              inside a chunk by syllable weight
//   'estimated' nothing but the text — a last resort, and it says so
(() => {
  'use strict';

  // Syllable count is a far better proxy for spoken length than character
  // count: "strength" is long on the page and short in the mouth.
  function syllables(word) {
    const w = String(word || '').toLowerCase().replace(/[^a-z]/g, '');
    if (!w) return 0;
    if (w.length <= 3) return 1;
    const groups = w
      .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '')
      .replace(/^y/, '')
      .match(/[aeiouy]{1,2}/g);
    return Math.max(1, groups ? groups.length : 1);
  }

  // Punctuation is where a speaker actually pauses, and a gesture landing in a
  // pause reads as deliberate rather than late.
  function pauseAfter(word) {
    const w = String(word || '');
    if (/[.!?]["')\]]?$/.test(w)) return 0.42;
    if (/[,;:]["')\]]?$/.test(w)) return 0.2;
    if (/[—–-]$/.test(w)) return 0.16;
    return 0;
  }

  /**
   * Build a timeline for one narration segment.
   *
   * @param {string} text        what is spoken
   * @param {number} durationSec measured length of the audio, when known
   * @param {object} alignment   optional { words:[{text,start,end}], phonemes:[] }
   */
  function build(text, durationSec, alignment) {
    const raw = String(text || '').trim();
    const tokens = raw ? raw.split(/\s+/) : [];

    // Tier 1 — real alignment.
    if (alignment && Array.isArray(alignment.words) && alignment.words.length) {
      const words = alignment.words.map((w) => ({
        text: String(w.text || w.word || '').trim(),
        start: Number(w.start) || 0,
        end: Number(w.end) || 0
      })).filter((w) => w.text);
      return {
        source: 'aligned',
        duration: Number(alignment.duration) || durationSec ||
          (words.length ? words[words.length - 1].end : 0),
        words,
        phonemes: Array.isArray(alignment.phonemes) ? alignment.phonemes : []
      };
    }

    if (!tokens.length) {
      return { source: durationSec ? 'measured' : 'estimated', duration: durationSec || 0, words: [], phonemes: [] };
    }

    // Tier 2/3 — distribute across the segment by syllable weight, giving
    // punctuation its pause. With a measured duration this is accurate at the
    // chunk boundaries and approximate within; without one it is a guess and
    // the source says so.
    const weights = tokens.map((t) => syllables(t) + pauseAfter(t) * 2.2);
    const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
    // ~2.6 syllables/sec is ordinary documentary narration pace.
    const total = durationSec || totalWeight / 2.6;

    const words = [];
    let cursor = 0;
    tokens.forEach((tok, i) => {
      const span = (weights[i] / totalWeight) * total;
      const pause = pauseAfter(tok) * (span / (weights[i] || 1));
      const start = cursor;
      const end = cursor + Math.max(0.04, span - pause);
      words.push({ text: tok, start: round(start), end: round(end) });
      cursor += span;
    });

    return {
      source: durationSec ? 'measured' : 'estimated',
      duration: round(total),
      words,
      phonemes: []
    };
  }

  const round = (n) => Math.round(n * 1000) / 1000;

  /** Join per-segment timelines into one, offsetting each by what came before. */
  function concat(timelines) {
    const words = [];
    let offset = 0;
    let worst = 'aligned';
    const rank = { aligned: 0, measured: 1, estimated: 2 };
    (timelines || []).forEach((tl) => {
      if (!tl) return;
      if (rank[tl.source] > rank[worst]) worst = tl.source;
      tl.words.forEach((w) => {
        words.push({ text: w.text, start: round(w.start + offset), end: round(w.end + offset) });
      });
      offset += tl.duration || 0;
    });
    return { source: worst, duration: round(offset), words, phonemes: [] };
  }

  // --- querying ------------------------------------------------------------

  /** The word being spoken at t, or null in a gap. */
  function wordAt(tl, t) {
    if (!tl || !tl.words.length) return null;
    for (const w of tl.words) if (t >= w.start && t < w.end) return w;
    return null;
  }

  /** Is anyone speaking at t? Drives the mouth and the idle/talk state. */
  function speakingAt(tl, t) {
    return !!wordAt(tl, t);
  }

  /**
   * When is a phrase spoken? This is how the Director attaches a visual to a
   * MOMENT rather than a delay: find "86 billion", animate the counter there.
   * Returns {start,end} or null.
   */
  function find(tl, phrase) {
    if (!tl || !tl.words.length) return null;
    const want = String(phrase || '').toLowerCase().split(/\s+/).filter(Boolean);
    if (!want.length) return null;
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    const target = want.map(norm);
    for (let i = 0; i <= tl.words.length - target.length; i++) {
      let ok = true;
      for (let j = 0; j < target.length; j++) {
        if (norm(tl.words[i + j].text) !== target[j]) { ok = false; break; }
      }
      if (ok) return { start: tl.words[i].start, end: tl.words[i + target.length - 1].end };
    }
    // Fall back to a containment match on a single distinctive word.
    if (target.length === 1) {
      const hit = tl.words.find((w) => norm(w.text).includes(target[0]));
      if (hit) return { start: hit.start, end: hit.end };
    }
    return null;
  }

  // --- visemes -------------------------------------------------------------
  //
  // Mouth shape by phoneme where alignment provides them, otherwise by the
  // vowels of the word being spoken — which still beats cycling on a clock,
  // because the mouth at least moves when and only when there is speech.
  const VISEME = { closed: 0.02, teeth: 0.1, wide: 0.46, open: 0.36, round: 0.2, rest: 0.05 };

  const PHONEME_VISEME = {
    AA: 'open', AH: 'open', AO: 'open', AE: 'open', AW: 'open', AY: 'open',
    IY: 'wide', IH: 'wide', EY: 'wide', EH: 'wide',
    UW: 'round', UH: 'round', OW: 'round', OY: 'round', W: 'round',
    B: 'closed', M: 'closed', P: 'closed',
    F: 'teeth', V: 'teeth',
    TH: 'teeth', DH: 'teeth',
    L: 'wide', R: 'round', S: 'teeth', Z: 'teeth', SH: 'round', CH: 'round'
  };

  function visemeFromWord(word, t) {
    const w = String(word || '').toLowerCase();
    const vowels = w.match(/[aeiou]+/g) || ['a'];
    // Step through the word's vowels over its own span so a long word opens
    // and closes more than once.
    const i = Math.min(vowels.length - 1, Math.floor(t * vowels.length));
    const v = vowels[i][0];
    if ('aeiou'.indexOf(v) < 0) return 'rest';
    if (v === 'e' || v === 'i') return 'wide';
    if (v === 'o' || v === 'u') return 'round';
    return 'open';
  }

  /**
   * Mouth opening at time t, already smoothed.
   *
   * Interpolating rather than switching is what stops the mouth flickering
   * between shapes — the spec's "do not abruptly switch" requirement, and the
   * difference between speech and chattering.
   */
  function mouthAt(tl, t, smoothing) {
    if (!tl) return VISEME.rest;
    if (tl.phonemes && tl.phonemes.length) {
      const p = tl.phonemes.find((x) => t >= x.start && t < x.end);
      if (p) return VISEME[PHONEME_VISEME[String(p.symbol || '').toUpperCase()] || 'open'];
      return VISEME.closed;
    }
    const w = wordAt(tl, t);
    if (!w) return VISEME.rest;
    const local = (t - w.start) / Math.max(0.001, w.end - w.start);
    const target = VISEME[visemeFromWord(w.text, local)];
    // Close towards the edges of the word so words separate audibly-looking.
    const edge = Math.min(local, 1 - local) * 4;
    const k = smoothing == null ? 1 : smoothing;
    return VISEME.closed + (target - VISEME.closed) * Math.min(1, edge) * k;
  }

  // --- event scheduling ----------------------------------------------------

  /**
   * Turn the Director's semantic cues into timed events.
   *
   * A cue says "point at the word liver", not "point at 1.2 seconds". The
   * timeline resolves it, so the same plan stays correct when the narration is
   * regenerated at a different pace — which is exactly what fixed delays
   * cannot do.
   */
  function schedule(tl, cues) {
    const events = [];
    (cues || []).forEach((cue) => {
      if (!cue) return;
      let time = Number.isFinite(cue.time) ? cue.time : null;
      if (time == null && cue.at) {
        const hit = find(tl, cue.at);
        if (!hit) return;               // never invent a time for a word that was not spoken
        time = cue.after ? hit.end : hit.start;
      }
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

  /** Events that should have fired by time t but not before `since`. */
  function due(events, since, t) {
    return (events || []).filter((e) => e.time > since && e.time <= t);
  }

  window.BlvckTimeline = {
    build,
    concat,
    wordAt,
    speakingAt,
    find,
    mouthAt,
    schedule,
    due,
    syllables,
    VISEME,
    PHONEME_VISEME
  };
})();
