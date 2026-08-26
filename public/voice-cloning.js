// Voice Cloning Studio — create Fish Speech reference voices from the browser.
//
// Backed by real endpoints: POST /v1/references/add (multipart id + audio +
// text) and DELETE /v1/references/delete. See docs/FISH_VOICE_STUDIO_SPEC.md.
//
// Two things decide whether a cloned voice sounds good, and both are enforced
// here rather than left to chance:
//
//   1. Recording quality. Fish clones the reference's sample rate, noise floor
//      and frequency response along with the voice, so a band-limited or noisy
//      clip produces a band-limited, noisy voice. (The original built-in pack
//      shipped jfk.wav, whose 95% rolloff is 3.3 kHz, and it sounded like a
//      phone call.) Clips are conditioned and then measured, and the upload is
//      blocked when the source cannot produce a decent voice.
//   2. Transcript accuracy. The reference text drives in-context learning, so
//      a .lab that does not match its .wav degrades output badly — three
//      voices in the old pack shared a fabricated line and all sounded wrong.
//      The transcript is therefore required, never guessed.
(() => {
  'use strict';

  const TARGET_SR = 44100;   // Fish S2 Pro is happiest full-band
  // THE ENGINE REFUSES A LONG REFERENCE, AND SAYS NOTHING USEFUL WHEN IT DOES.
  //
  // 25 was tried on request and is not survivable. Measured against the live
  // server, one reference per length through this exact encoder, asked to speak
  // a sixteen-character line:
  //
  //   8s 10s 11s 12s 13s 14s   all speak
  //   16s                      500 "Failed to generate speech", in 0.7s
  //   22s                      500, same
  //
  // It fails in well under a second, before generation starts, because the
  // reference is encoded into the prompt: text2semantic/inference.py raises
  // when the sequence length T reaches the model's max_seq_len, and T is the
  // reference tokens PLUS the text being spoken. So the usable reference length
  // depends on the script - a clip that speaks a test phrase can still fail on
  // a real narration chunk, which is exactly how a 14.0s reference passed a
  // probe here and failed in production.
  //
  // Hence 12: inside the measured limit with room for a real line of script.
  // This is the model's ceiling rather than a preference, and raising it does
  // not buy a longer reference - it buys a voice that cannot speak.
  const MAX_SEC = 12;
  const MIN_SEC = 4;

  // Mirrors the server's own rule in tools/server/views.py, so a bad name is
  // rejected here with a clear message instead of failing server-side.
  const ID_RE = /^[a-zA-Z0-9\-_ ]+$/;

  const QUALITY = {
    rolloffFloor: 6000,   // below this the source is band-limited (jfk.wav = 3281)
    rolloffWarn: 7500,
    snrFloor: 20,         // below this the noise floor gets cloned too
    snrWarn: 30
  };

  function endpoint() {
    const ep = (window.ProviderManager && window.ProviderManager.getPoolState('fishaudio')?.endpoint) || '';
    return ep.replace(/\/+$/, '');
  }

  // --- audio conditioning ------------------------------------------------

  // Decode anything the browser can read, downmix to mono and resample to
  // 44.1 kHz in one pass. OfflineAudioContext handles both conversions.
  async function decodeToMono(arrayBuffer) {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    let decoded;
    try {
      decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
    } finally {
      try { await ctx.close(); } catch { /* ignore */ }
    }
    const frames = Math.ceil(decoded.duration * TARGET_SR);
    const off = new OfflineAudioContext(1, frames, TARGET_SR);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    return rendered.getChannelData(0);
  }

  // Keep the START of the recording, and end on a pause.
  //
  // This used to hunt for the most speech-dense window ANYWHERE in the file and
  // then snap that window's start back to the nearest silence, so a recording
  // longer than the ceiling reliably lost its opening - and, because the search
  // was over the whole file, it could take a stretch from the middle and drop
  // both ends. For a voice reference that is the wrong trade. Somebody who
  // records a reference speaks the line they want cloned from the top; the
  // opening is usually the most deliberate, best-articulated speech in the
  // clip, and losing it is a silent edit to the thing being cloned.
  //
  // So the window always begins at sample 0 and a clip inside the ceiling is
  // kept whole. Only the END moves, and only backwards, to the quietest frame
  // in the last ~0.8 s - a clip that stops mid-syllable clones that truncation.
  function leadWindow(data, maxSec = MAX_SEC) {
    const need = Math.floor(maxSec * TARGET_SR);
    if (data.length <= need) return data;

    const hop = Math.floor(0.05 * TARGET_SR);
    const endFrame = Math.floor(need / hop);
    const lookBack = Math.floor(0.8 * TARGET_SR / hop);
    const lo = Math.max(1, endFrame - lookBack);
    let quietest = endFrame, quietestRms = Infinity;
    for (let f = lo; f <= endFrame; f++) {
      const start = f * hop;
      if (start + hop > data.length) break;
      let acc = 0;
      for (let i = start; i < start + hop; i++) acc += data[i] * data[i];
      const r = Math.sqrt(acc / hop);
      if (r < quietestRms) { quietestRms = r; quietest = f; }
    }
    return data.slice(0, Math.min(need, quietest * hop));
  }

  function normalize(data, peakDbfs = -1) {
    let peak = 0;
    for (let i = 0; i < data.length; i++) { const a = Math.abs(data[i]); if (a > peak) peak = a; }
    if (!peak) return data;
    const gain = Math.pow(10, peakDbfs / 20) / peak;
    const out = new Float32Array(data.length);
    for (let i = 0; i < data.length; i++) out[i] = data[i] * gain;
    return out;
  }

  // --- measurement -------------------------------------------------------

  function fftMag(re) {
    const n = re.length, im = new Float64Array(n);
    for (let i = 1, j = 0; i < n; i++) {
      let bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) { const t = re[i]; re[i] = re[j]; re[j] = t; }
    }
    for (let len = 2; len <= n; len <<= 1) {
      const ang = -2 * Math.PI / len;
      for (let i = 0; i < n; i += len) {
        for (let k = 0; k < len / 2; k++) {
          const wr = Math.cos(ang * k), wi = Math.sin(ang * k);
          const ur = re[i + k], ui = im[i + k];
          const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
          const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
          re[i + k] = ur + vr; im[i + k] = ui + vi;
          re[i + k + len / 2] = ur - vr; im[i + k + len / 2] = ui - vi;
        }
      }
    }
    const m = new Float64Array(n / 2);
    for (let i = 0; i < n / 2; i++) m[i] = Math.hypot(re[i], im[i]);
    return m;
  }

  // 95% spectral rolloff, share of energy above 8 kHz, and a crude SNR from
  // the gap between the loudest and near-quietest frames. Same measures used
  // to select the built-in pack, so cloned and built-in voices are comparable.
  function measure(data) {
    const N = 2048;
    const spec = new Float64Array(N / 2);
    const rmsWins = [];
    const step = Math.max(N, Math.floor(data.length / 40));
    for (let s = 0; s + N < data.length; s += step) {
      const w = new Float64Array(N);
      let acc = 0;
      for (let i = 0; i < N; i++) {
        const v = data[s + i];
        acc += v * v;
        w[i] = v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
      }
      rmsWins.push(Math.sqrt(acc / N));
      const m = fftMag(w);
      for (let i = 0; i < N / 2; i++) spec[i] += m[i];
    }
    if (!rmsWins.length) return { rolloff: 0, hfPct: 0, snrDb: 0 };
    let total = 0;
    for (let i = 0; i < spec.length; i++) total += spec[i];
    let cum = 0, rolloff = 0;
    for (let i = 0; i < spec.length; i++) {
      cum += spec[i];
      if (cum >= 0.95 * total) { rolloff = i * TARGET_SR / N; break; }
    }
    const bin8k = Math.floor(8000 * N / TARGET_SR);
    let hf = 0;
    for (let i = bin8k; i < spec.length; i++) hf += spec[i];
    rmsWins.sort((a, b) => a - b);
    const noise = rmsWins[Math.floor(rmsWins.length * 0.1)] || 1e-9;
    const peak = rmsWins[rmsWins.length - 1] || 1e-9;
    return {
      rolloff: Math.round(rolloff),
      hfPct: +(100 * hf / (total || 1)).toFixed(2),
      snrDb: +(20 * Math.log10(peak / noise)).toFixed(1)
    };
  }

  function verdict(metrics, seconds) {
    const problems = [], warnings = [];
    if (seconds < MIN_SEC) problems.push(`Only ${seconds.toFixed(1)}s of audio — needs at least ${MIN_SEC}s.`);
    if (metrics.rolloff && metrics.rolloff < QUALITY.rolloffFloor) {
      problems.push(`Band-limited: energy stops at ${metrics.rolloff} Hz. This will clone as a muffled, telephone-quality voice.`);
    } else if (metrics.rolloff < QUALITY.rolloffWarn) {
      warnings.push(`Slightly dull (rolloff ${metrics.rolloff} Hz) — usable, but a brighter recording clones better.`);
    }
    if (metrics.snrDb < QUALITY.snrFloor) {
      problems.push(`Noisy: only ${metrics.snrDb} dB between speech and background. That background will be cloned too.`);
    } else if (metrics.snrDb < QUALITY.snrWarn) {
      warnings.push(`Some background noise (${metrics.snrDb} dB SNR) — a quieter room clones cleaner.`);
    }
    return { ok: problems.length === 0, problems, warnings };
  }

  // --- WAV encoding ------------------------------------------------------

  function encodeWav(data, sampleRate = TARGET_SR) {
    const buf = new ArrayBuffer(44 + data.length * 2);
    const v = new DataView(buf);
    const str = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
    str(0, 'RIFF');
    v.setUint32(4, 36 + data.length * 2, true);
    str(8, 'WAVE');
    str(12, 'fmt ');
    v.setUint32(16, 16, true);
    v.setUint16(20, 1, true);          // PCM
    v.setUint16(22, 1, true);          // mono
    v.setUint32(24, sampleRate, true);
    v.setUint32(28, sampleRate * 2, true);
    v.setUint16(32, 2, true);
    v.setUint16(34, 16, true);
    str(36, 'data');
    v.setUint32(40, data.length * 2, true);
    let off = 44;
    for (let i = 0; i < data.length; i++, off += 2) {
      const s = Math.max(-1, Math.min(1, data[i]));
      v.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7fff, true);
    }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // --- public API --------------------------------------------------------

  // Condition a user file into an upload-ready reference and report on it.
  async function prepare(fileOrBlob) {
    const raw = await fileOrBlob.arrayBuffer();
    const mono = await decodeToMono(raw);
    const originalSec = mono.length / TARGET_SR;
    const trimmed = normalize(leadWindow(mono));
    const seconds = trimmed.length / TARGET_SR;
    const metrics = measure(trimmed);
    return {
      wav: encodeWav(trimmed),
      seconds,
      originalSec,
      trimmed: originalSec - seconds > 0.25,
      metrics,
      verdict: verdict(metrics, seconds)
    };
  }

  function validateId(id) {
    const v = String(id || '').trim();
    if (!v) return 'Give the voice a name.';
    if (v.length > 255) return 'Name is too long (max 255 characters).';
    if (!ID_RE.test(v)) return 'Name may only contain letters, numbers, spaces, hyphens and underscores.';
    return null;
  }

  async function addReference(id, wavBlob, text) {
    const ep = endpoint();
    if (!ep) throw new Error('Set the Fish Speech endpoint in AI settings first.');
    const idErr = validateId(id);
    if (idErr) throw new Error(idErr);
    if (!text || !text.trim()) {
      throw new Error('A transcript is required — it must match what the recording actually says.');
    }

    const fd = new FormData();
    fd.append('id', String(id).trim());
    fd.append('audio', wavBlob, 'audio.wav');
    fd.append('text', text.trim());

    // Content-Type is deliberately unset: the browser must add the multipart
    // boundary itself, and the proxy forwards whatever it sees.
    const res = await fetch('/api/proxy/fish/v1/references/add', {
      method: 'POST',
      headers: { 'x-fish-endpoint': ep, 'Accept': 'application/json' },
      body: fd
    });
    const body = await res.text();
    // The server refuses to overwrite a reference and answers 409. On its own
    // that reads as "this worked before, why not now" - and it is the reply to
    // the one action most likely to be a deliberate REPLACEMENT, because
    // deleting and re-adding is the standard fix for a voice that has stopped
    // loading. So say what to do rather than forwarding the status.
    if (res.status === 409) {
      throw new Error(`A voice called "${String(id).trim()}" is already on the server, and the `
        + `server will not overwrite one. Delete it in the list below, then create it again — `
        + `that is also the fix when a voice has stopped working.`);
    }
    if (!res.ok) throw new Error(`Upload failed (${res.status}): ${body.slice(0, 200)}`);
    return body;
  }

  /**
   * Ask the engine to actually speak with a reference that was just created.
   *
   * A reference is ACCEPTED by /references/add on the strength of its file
   * extension and a non-empty transcript. Whether the model can use it is a
   * different question, answered only at generation time - and answered with
   * a generic 500 that names nothing. So a voice could be created, appear in
   * every picker, and fail on the first real narration, which is what was
   * reported twice.
   *
   * One short line, once, at creation. Cheap next to discovering it during a
   * run, and it is the only way to know.
   */
  async function verify(id) {
    const ep = endpoint();
    if (!ep) return { ok: false, why: 'no endpoint' };
    try {
      const res = await fetch('/api/proxy/fish/v1/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json',
                   'x-fish-endpoint': ep },
        body: JSON.stringify({ text: 'Testing one two.', format: 'mp3', reference_id: String(id).trim() })
      });
      if (res.ok) {
        const b = await res.arrayBuffer();
        return b.byteLength > 500
          ? { ok: true }
          : { ok: false, why: 'the engine returned an empty file for this voice' };
      }
      return { ok: false, status: res.status, why: (await res.text()).slice(0, 160) };
    } catch (e) {
      // Could not ASK is not the same as failed, and must not delete anything.
      return { ok: null, why: 'the check could not be run: ' + e.message };
    }
  }

  async function deleteReference(id) {
    const ep = endpoint();
    if (!ep) throw new Error('Set the Fish Speech endpoint in AI settings first.');
    const res = await fetch('/api/proxy/fish/v1/references/delete', {
      method: 'DELETE',
      headers: { 'x-fish-endpoint': ep, 'Accept': 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ reference_id: String(id).trim() })
    });
    const body = await res.text();
    if (!res.ok) throw new Error(`Delete failed (${res.status}): ${body.slice(0, 200)}`);
    return body;
  }

  window.BlvckVoiceCloning = {
    prepare,
    addReference,
    verify,
    deleteReference,
    validateId,
    measure,
    encodeWav,
    QUALITY,
    TARGET_SR,
    MAX_SEC
  };
})();
