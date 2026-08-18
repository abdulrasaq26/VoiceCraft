// Project alignment bridge — AETHER
//
// The one join that was missing. Every piece of this chain already existed and
// none of them were connected:
//
//   Fish /v1/align → BlvckSync → Transcript.fromSyncTimeline() → sb.transcript
//
// editor.js reads `sb.transcript` to decide whether a project is on a measured
// clock. Nothing wrote it, so isMeasured() was always false, timingSource was
// always 'estimated', and the measured-timing path was dead in production while
// passing its own unit tests.
//
// This module transcribes nothing and aligns nothing. It collects the project's
// narration, hands it to the existing sync engine, converts the result with the
// existing Transcript adapter, and stores it. Every decision about what counts
// as a word, a segment or a measured timing stays where it already lives.
//
// Public API: window.BlvckAlign
(() => {
  'use strict';

  const SB_LS = 'blvck-tts:storyboard';
  const AUDIO_LS = 'blvck-tts:batch';
  const AUDIO_DB = 'blvck-tts', AUDIO_STORE = 'audio';
  const MANUAL_DB = 'blvck-editor', MANUAL_STORE = 'audio', MANUAL_KEY = 'narration';

  function readSb() {
    try { return JSON.parse(localStorage.getItem(SB_LS) || 'null'); } catch { return null; }
  }

  function writeSb(sb) {
    try { localStorage.setItem(SB_LS, JSON.stringify(sb)); } catch { /* quota */ }
  }

  function idbGet(dbName, store, key) {
    return new Promise((resolve) => {
      let req;
      try { req = indexedDB.open(dbName); } catch { return resolve(null); }
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(store)) { db.close(); return resolve(null); }
        try {
          const tx = db.transaction(store, 'readonly').objectStore(store).get(key);
          tx.onsuccess = () => { resolve(tx.result || null); db.close(); };
          tx.onerror = () => { resolve(null); db.close(); };
        } catch { resolve(null); db.close(); }
      };
    });
  }

  // ── The project's narration, as one continuous piece of audio ─────────────
  //
  // Alignment needs a single stream on one clock. The narration is normally a
  // batch of separately generated parts, so they are decoded and concatenated
  // as PCM rather than by joining the encoded blobs — concatenated MP3 or WebM
  // frames decode to something whose timings drift from what the player does,
  // and a drifting alignment is worse than none.

  let audioCtx = null;
  function ctx() {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }

  async function collectNarration() {
    const buffers = [];
    let bytes = 0;

    const manual = await idbGet(MANUAL_DB, MANUAL_STORE, MANUAL_KEY);
    if (manual) {
      try {
        buffers.push(await ctx().decodeAudioData(await manual.arrayBuffer()));
        bytes += manual.size;
      } catch { /* fall through to the batch */ }
    }

    if (!buffers.length) {
      let meta = null;
      try { meta = JSON.parse(localStorage.getItem(AUDIO_LS) || 'null'); } catch { meta = null; }
      for (const item of (meta && meta.items) || []) {
        let blob = await idbGet(AUDIO_DB, AUDIO_STORE, `${meta.id}:${item.index}`);
        if (!blob) blob = await idbGet(AUDIO_DB, AUDIO_STORE, String(item.index));
        if (!blob) continue;
        try {
          buffers.push(await ctx().decodeAudioData(await blob.arrayBuffer()));
          bytes += blob.size;
        } catch { /* a part that will not decode cannot be aligned */ }
      }
    }

    if (!buffers.length) return null;

    const rate = buffers[0].sampleRate;
    const total = buffers.reduce((n, b) => n + b.length, 0);
    const merged = new Float32Array(total);
    let at = 0;
    for (const b of buffers) {
      // Mono: alignment cares about speech, and a stereo mix would only be
      // averaged by the aligner anyway.
      merged.set(b.getChannelData(0), at);
      at += b.length;
    }

    const wav = window.BlvckVoiceCloning && window.BlvckVoiceCloning.encodeWav
      ? window.BlvckVoiceCloning.encodeWav(merged, rate)
      : null;
    if (!wav) return null;

    return { blob: wav, durationSec: total / rate, byteLength: bytes, parts: buffers.length };
  }

  function narrationText() {
    if (window.BlvckAssets) {
      const t = window.BlvckAssets.narrationText();
      if (t && t.trim()) return t.trim();
      const s = window.BlvckAssets.script();
      if (s && s.trim()) return s.trim();
    }
    return '';
  }

  // ── Coverage ──────────────────────────────────────────────────────────────

  /** Below this, the timeline describes too little of the script to be trusted. */
  const MIN_COVERAGE = 0.85;

  const _normWord = (w) => String(w || '').toLowerCase().replace(/[^a-z0-9]/g, '');

  /**
   * How much of the script the aligner actually came back with.
   *
   * Matched in order rather than as a set, so a repeated word cannot be counted
   * twice and a large dropped span is not disguised by the same words appearing
   * elsewhere.
   */
  function alignmentCoverage(script, timeline) {
    const expected = String(script || '').split(/\s+/).map(_normWord).filter(Boolean);
    const got = ((timeline && timeline.words) || [])
      .map((w) => _normWord(w.text || w.word)).filter(Boolean);

    let cursor = 0;
    let matched = 0;
    const missing = [];
    for (const want of expected) {
      const at = got.indexOf(want, cursor);
      if (at === -1) missing.push(want);
      else { matched++; cursor = at + 1; }
    }
    return {
      expected: expected.length,
      returned: got.length,
      matched,
      missing,
      ratio: expected.length ? matched / expected.length : 1
    };
  }

  // ── Status ────────────────────────────────────────────────────────────────

  function current() {
    const sb = readSb();
    return (sb && sb.transcript) || null;
  }

  /**
   * What state is the project's timing in?
   *
   * `stale` is the one that matters: re-recording the narration leaves a
   * transcript whose word positions describe audio that no longer exists, and
   * reusing it silently puts every picture on the wrong beat.
   */
  async function status() {
    const t = current();
    if (!window.Transcript) return { state: 'unavailable', reason: 'transcript module not loaded' };
    if (!t) {
      return { state: 'none', transcript: null, wordCount: 0,
               reason: 'No alignment has been run for this project.' };
    }

    const measured = window.Transcript.isMeasured(t);
    const wordCount = window.Transcript.words(t).length;

    const audio = await collectNarration();
    if (audio) {
      const now = window.Transcript.fingerprint({
        byteLength: audio.byteLength, duration: audio.durationSec
      });
      if (window.Transcript.isStale(t, { byteLength: audio.byteLength, duration: audio.durationSec })) {
        return {
          state: 'stale', transcript: t, wordCount, measured,
          storedFingerprint: t.audioFingerprint, currentFingerprint: now,
          reason: 'The narration audio has changed since this timing was measured. '
                + 'Re-align before planning or exporting.'
        };
      }
    }

    return {
      state: measured ? 'aligned' : 'estimated',
      transcript: t, wordCount, measured,
      reason: measured
        ? `Measured from the narration audio — ${wordCount} word timings.`
        : 'Timing was estimated from text, not measured from audio.'
    };
  }

  // ── Align ─────────────────────────────────────────────────────────────────

  /**
   * Run the real chain and store the result.
   *
   * Refuses to store anything but a genuinely aligned result. An estimated
   * timeline stored as `sb.transcript` would make isMeasured() true for a
   * project whose timings were never measured, which is the exact false claim
   * this whole layer exists to avoid.
   */
  /** How many times to ask again when the answer comes back short. */
  const COVERAGE_ATTEMPTS = 3;

  /**
   * Align, and ask again if the answer is short.
   *
   * The endpoint under-returns intermittently — measured live at 10 of 19 words
   * on one run and 19 of 19 on the next, same script, same audio. Rejecting a
   * partial answer is only half the rule: the other half is that asking again
   * usually works, and a producer should not have to know that.
   *
   * Bounded, and the last failure is re-thrown with its coverage intact, so a
   * genuinely broken endpoint still reports as broken rather than looping.
   */
  async function align(opts = {}) {
    let lastErr = null;
    for (let attempt = 1; attempt <= COVERAGE_ATTEMPTS; attempt++) {
      try {
        return await alignOnce(opts);
      } catch (err) {
        lastErr = err;
        // Only a short answer is worth repeating. A missing endpoint or absent
        // audio will fail identically every time.
        if (!err.coverage || attempt === COVERAGE_ATTEMPTS) throw err;
        try {
          window.dispatchEvent(new CustomEvent('blvck:align-retry', {
            detail: { attempt, of: COVERAGE_ATTEMPTS, coverage: err.coverage }
          }));
        } catch (e) { /* non-fatal */ }
        console.warn(`[Align] covered ${err.coverage.matched}/${err.coverage.expected} words `
          + `(${Math.round(err.coverage.ratio * 100)}%) — asking again `
          + `(attempt ${attempt + 1}/${COVERAGE_ATTEMPTS})`);
      }
    }
    throw lastErr;
  }

  async function alignOnce(opts = {}) {
    if (!window.Transcript) throw new Error('Transcript module is not loaded.');
    if (!window.BlvckSync) throw new Error('Sync engine is not loaded.');

    const text = narrationText();
    if (!text) throw new Error('There is no narration text to align against.');

    const audio = await collectNarration();
    if (!audio) throw new Error('No narration audio found. Generate or upload narration first.');

    const timeline = await window.BlvckSync.timelineFor(text, {
      audioBlob: audio.blob,
      durationSec: audio.durationSec,
      allowAlignment: true,
      force: opts.force !== false
    });

    if (!timeline || timeline.source !== 'aligned') {
      const err = new Error(
        `Alignment did not produce measured timings (got "${timeline && timeline.source}"). `
        + 'Check that the Fish endpoint is reachable and reports alignment support.');
      err.timeline = timeline;
      throw err;
    }

    // Does the alignment actually cover the script?
    //
    // Measured twice on identical input, the endpoint returned 31 of 31 words
    // once and 11 of them the other time. A short answer is not flagged as an
    // error — it arrives as a perfectly well-formed timeline — so without this
    // a third of the narration would be filed as measured truth and every beat
    // after the gap would be placed against timings that describe nothing.
    //
    // The threshold is deliberately loose. Aligners legitimately merge
    // hyphenated words and drop the odd filler, and a missing word or two does
    // not damage placement. Losing a third does.
    const coverage = alignmentCoverage(text, timeline);
    if (coverage.ratio < MIN_COVERAGE) {
      const err = new Error(
        `Alignment covered only ${coverage.matched} of ${coverage.expected} words `
        + `(${Math.round(coverage.ratio * 100)}%). This is intermittent — run it again. `
        + 'Storing it would present a partial transcript as measured timing.');
      err.coverage = coverage;
      err.timeline = timeline;
      throw err;
    }

    const transcript = window.Transcript.fromSyncTimeline(timeline, {
      script: text,
      audioFingerprint: window.Transcript.fingerprint({
        byteLength: audio.byteLength, duration: audio.durationSec
      }),
      model: timeline.provider || 'whisper'
    });
    if (!transcript) throw new Error('The aligned timeline held no usable word timings.');

    save(transcript);
    return {
      transcript,
      wordCount: window.Transcript.words(transcript).length,
      provider: timeline.provider || '',
      audioDuration: audio.durationSec,
      parts: audio.parts
    };
  }

  /**
   * Store the transcript on the project.
   *
   * Read-modify-write, because the storyboard owns the rest of this payload and
   * holds its own copy of the scenes in memory.
   */
  function save(transcript) {
    const sb = readSb() || { project: '', cues: [], bible: null, scenes: [] };
    sb.transcript = transcript;
    writeSb(sb);
    try {
      window.dispatchEvent(new CustomEvent('blvck:transcript-updated', { detail: { transcript } }));
      window.dispatchEvent(new CustomEvent('blvck-storyboard-updated'));
    } catch { /* no-op */ }
  }

  function clear() {
    const sb = readSb();
    if (!sb) return;
    delete sb.transcript;
    writeSb(sb);
    try { window.dispatchEvent(new CustomEvent('blvck:transcript-updated', { detail: { transcript: null } })); }
    catch { /* no-op */ }
  }

  /** What the Director should be given, or null when nothing was measured. */
  function forDirector(options) {
    return window.Transcript ? window.Transcript.forDirector(current(), options || {}) : null;
  }

  window.BlvckAlign = {
    align,
    status,
    current,
    save,
    clear,
    forDirector,
    alignmentCoverage,
    MIN_COVERAGE,
    // exported for tests
    _internal: { collectNarration, narrationText }
  };
})();
