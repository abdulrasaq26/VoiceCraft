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
  const TARGET_SEC = 14;     // ~10-20 s is the sweet spot for cloning
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

  // Pick the most speech-dense contiguous window and snap the start back to a
  // natural pause, so a long recording becomes one clean stretch of speech
  // rather than an arbitrary slice through the middle of a word.
  function bestWindow(data, targetSec = TARGET_SEC) {
    const need = Math.floor(targetSec * TARGET_SR);
    if (data.length <= need) return data;
    const hop = Math.floor(0.05 * TARGET_SR);
    const frames = Math.floor((data.length - hop) / hop);
    const rms = new Float64Array(frames);
    for (let f = 0; f < frames; f++) {
      let acc = 0;
      const s = f * hop;
      for (let i = s; i < s + hop; i++) acc += data[i] * data[i];
      rms[f] = Math.sqrt(acc / hop);
    }
    const win = Math.max(1, Math.floor(need / hop));
    let best = 0, bestSum = -1, run = 0;
    for (let f = 0; f < win && f < frames; f++) run += rms[f];
    bestSum = run;
    for (let f = win; f < frames; f++) {
      run += rms[f] - rms[f - win];
      if (run > bestSum) { bestSum = run; best = f - win + 1; }
    }
    // snap back to the quietest frame in the preceding ~0.6 s
    const lookBack = Math.floor(0.6 * TARGET_SR / hop);
    const lo = Math.max(0, best - lookBack);
    let quietest = best;
    for (let f = lo; f <= best; f++) if (rms[f] < rms[quietest]) quietest = f;
    const start = quietest * hop;
    return data.slice(start, start + need);
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
    const trimmed = normalize(bestWindow(mono));
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
    if (!res.ok) throw new Error(`Upload failed (${res.status}): ${body.slice(0, 200)}`);
    return body;
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
    deleteReference,
    validateId,
    measure,
    encodeWav,
    QUALITY,
    TARGET_SR,
    TARGET_SEC
  };
})();
