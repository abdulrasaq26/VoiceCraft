// Narration pace — slowing speech down without lowering its pitch.
//
// Fish Speech has no speed parameter. That is not an oversight to route around
// with a cleverer request: fish-adapter.js says so at the call site and
// docs/FISH_VOICE_STUDIO_SPEC.md lists pace under "Explicitly not building — no
// such parameters exist". The engine reproduces the pace of the reference clip
// along with the voice, so a fast reference makes a fast narrator and the only
// engine-side lever is to record a slower reference.
//
// So this changes the audio after it is generated, and it deliberately does NOT
// do it by resampling. Playing 44.1 kHz speech back at 0.85x is the obvious
// one-liner and it drops the pitch by nearly three semitones, which turns a
// narrator into a different, slower person. What is wanted is the same voice
// saying the same words over more seconds.
//
// WSOLA does that: cut the signal into overlapping frames, lay them down again
// at a wider spacing, and before each one is placed, slide it a little to where
// it best continues what is already there. The sliding is the whole trick -
// without it the overlaps fight each other and speech acquires a metallic
// warble. Pitch is untouched because no frame is ever resampled; only the gaps
// between them change.
//
// WHERE THIS SITS. It runs on each generated chunk before the chunk is stored,
// which means alignment measures the audio that actually exists. Everything
// downstream - the cue list, scene cuts, the Renderer's anchors, the export -
// is timed from that measurement, so slowing the narration moves the picture
// with it and nothing has to be told twice.
(() => {
  'use strict';

  const LS_KEY = 'blvck:narration_pace';

  // 1.0 is the engine's own pace. Below 1 is slower. The floor is not
  // timidity: WSOLA on speech is transparent to about 0.8x and starts to
  // smear consonants below that, and a control that can produce a bad result
  // silently is worse than one that cannot reach it.
  const MIN = 0.75;
  const MAX = 1.25;

  const clamp = (v) => Math.min(MAX, Math.max(MIN, Number(v) || 1));

  function get() {
    const raw = Number(localStorage.getItem(LS_KEY));
    return Number.isFinite(raw) && raw > 0 ? clamp(raw) : 1;
  }

  function set(v) {
    const n = clamp(v);
    try { localStorage.setItem(LS_KEY, String(n)); } catch (e) { /* non-fatal */ }
    return n;
  }

  /** Is this pace far enough from 1 to be worth the work? */
  function active(pace) {
    return Math.abs((pace == null ? get() : clamp(pace)) - 1) > 0.005;
  }

  // ── WSOLA ────────────────────────────────────────────────────────────────

  function hann(n) {
    const w = new Float32Array(n);
    for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1));
    return w;
  }

  /**
   * Time-stretch one channel. `rate` is playback speed: 0.85 makes it longer
   * and slower, 1.15 shorter and faster. Pitch is preserved.
   */
  function stretchChannel(x, rate, sampleRate) {
    if (Math.abs(rate - 1) < 0.005 || x.length === 0) return x;

    // ~46ms at 44.1k. Long enough to hold a pitch period of even a low voice
    // (80 Hz is 12.5ms), short enough that a frame does not span two phonemes.
    const N = Math.max(256, Math.round(0.046 * sampleRate));
    const Hs = Math.round(N / 4);              // synthesis hop, fixed
    const Ha = Math.max(1, Math.round(Hs * rate));  // analysis hop
    const SEARCH = Math.round(N / 8);          // how far a frame may slide
    const w = hann(N);

    const outLen = Math.ceil(x.length / rate) + 2 * N;
    const out = new Float32Array(outLen);
    const norm = new Float32Array(outLen);

    // TWO POINTERS, and keeping them apart is the whole correctness of this.
    //
    // `nominal` is where the next frame is due, and it advances by Ha every
    // time, no matter where the search actually took the frame from. `from` is
    // where it was taken. An earlier version advanced the read pointer from
    // `from` instead - readAt = from + Ha - which folds every search offset
    // back into the position, and since the search range (N/8) is wider than
    // the per-frame stretch (Hs - Ha, about N/27 at 0.85x) it can cancel the
    // stretch completely. It did: measured on real Fish narration, a 3.44s
    // clip came back 3.44s. A pure tone hid it, because the best match for a
    // periodic signal is at offset zero.
    let nominal = 0;
    let writeAt = 0;

    while (nominal + N + SEARCH < x.length && writeAt + N < outLen) {
      const centre = Math.round(nominal);
      let best = 0;

      if (writeAt > 0) {
        // Slide the frame to wherever it best continues what is already on the
        // output. Normalised, so a loud frame cannot win on energy alone.
        let bestScore = -Infinity;
        const lo = Math.max(-SEARCH, -centre);
        for (let d = lo; d <= SEARCH; d++) {
          let dot = 0, energy = 0;
          for (let i = 0; i < Hs; i += 2) {          // every other sample is plenty
            const a = out[writeAt + i];
            const b = x[centre + d + i];
            dot += a * b;
            energy += b * b;
          }
          const score = dot / Math.sqrt(energy + 1e-9);
          if (score > bestScore) { bestScore = score; best = d; }
        }
      }

      const from = centre + best;
      for (let i = 0; i < N; i++) {
        const src = from + i;
        if (src < 0 || src >= x.length) continue;
        out[writeAt + i] += x[src] * w[i];
        norm[writeAt + i] += w[i];
      }

      nominal += Ha;        // NOT from + Ha
      writeAt += Hs;
    }

    // Undo the window's own gain. Where frames overlapped the sum is about 1
    // already; at the very ends it is not, and dividing keeps the first and
    // last syllables at full level instead of fading them.
    const end = Math.min(writeAt + N, outLen);
    const res = new Float32Array(end);
    for (let i = 0; i < end; i++) res[i] = norm[i] > 1e-6 ? out[i] / norm[i] : out[i];
    return res;
  }

  // ── The public job ───────────────────────────────────────────────────────

  /**
   * Return `blob` re-timed to the given pace, as a WAV.
   *
   * WAV because the editor decodes every narration part with decodeAudioData
   * and does not care about the container, and because re-encoding to MP3 here
   * would mean a second encoder for no gain. Returns the ORIGINAL blob
   * untouched when there is nothing to do or anything goes wrong: a pace
   * control that can lose a narration is not worth having.
   */
  async function stretch(blob, pace) {
    const rate = clamp(pace == null ? get() : pace);
    if (!blob || !active(rate)) return blob;
    if (!window.BlvckVoiceCloning || !window.BlvckVoiceCloning.encodeWav) return blob;

    let decoded = null;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return blob;
    const ctx = new Ctx();
    try {
      decoded = await ctx.decodeAudioData(await blob.arrayBuffer());
    } catch (err) {
      console.warn('[Pace] could not decode the narration, leaving it alone: ' + err.message);
      return blob;
    } finally {
      try { await ctx.close(); } catch (e) { /* ignore */ }
    }

    try {
      // Mono is what narration is, and mixing first keeps one stretch rather
      // than two that could drift against each other.
      const chans = decoded.numberOfChannels;
      let mono;
      if (chans === 1) {
        mono = decoded.getChannelData(0);
      } else {
        mono = new Float32Array(decoded.length);
        for (let c = 0; c < chans; c++) {
          const d = decoded.getChannelData(c);
          for (let i = 0; i < d.length; i++) mono[i] += d[i] / chans;
        }
      }
      const out = stretchChannel(mono, rate, decoded.sampleRate);
      return window.BlvckVoiceCloning.encodeWav(out, decoded.sampleRate);
    } catch (err) {
      console.warn('[Pace] stretch failed, leaving the narration alone: ' + err.message);
      return blob;
    }
  }

  window.BlvckPace = {
    get, set, active, stretch,
    MIN, MAX,
    // Exported so the stretch can be measured directly, without a round trip
    // through encode and decode.
    _stretchChannel: stretchChannel
  };
})();
