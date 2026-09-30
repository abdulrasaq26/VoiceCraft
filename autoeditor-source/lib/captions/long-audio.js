/**
 * Long-audio helpers for Whisper captioning (pure, no model — unit tested).
 *
 * Whisper sees 30 seconds at a time. Handing it a whole voiceover in one call
 * blocks the page for minutes with no progress and one bad stretch fails the
 * entire job, so long audio is cut into windows that end at a pause, each
 * transcribed on its own and shifted back onto the full timeline.
 */

export const SAMPLE_RATE = 16000;

const FRAME = 320; // 20ms analysis frames at 16kHz

function frameRms(samples, from, to) {
  let sum = 0;
  for (let i = from; i < to; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / Math.max(1, to - from));
}

/**
 * Split audio into windows no longer than `maxSec`, each ending at the quietest
 * point of its last `searchSec` so cuts land between words rather than
 * through them.
 * @returns {{start:number,end:number}[]} sample offsets
 */
export function planWindows(samples, { sampleRate = SAMPLE_RATE, maxSec = 28, searchSec = 6 } = {}) {
  const total = samples.length;
  const maxLen = Math.floor(maxSec * sampleRate);
  const searchLen = Math.floor(searchSec * sampleRate);
  const windows = [];
  let start = 0;
  while (start < total) {
    if (total - start <= maxLen) {
      windows.push({ start, end: total });
      break;
    }
    const hardEnd = start + maxLen;
    const from = Math.max(start + FRAME, hardEnd - searchLen);
    let best = hardEnd, bestRms = Infinity;
    for (let f = from; f + FRAME <= hardEnd; f += FRAME) {
      const r = frameRms(samples, f, f + FRAME);
      if (r < bestRms) { bestRms = r; best = f + (FRAME >> 1); }
    }
    windows.push({ start, end: best });
    start = best;
  }
  return windows;
}

/** Root-mean-square level of a window; used to skip silence. */
export function windowRms(samples, start, end) {
  // Sample every 4th value — plenty for a silence test and 4x cheaper.
  let sum = 0, n = 0;
  for (let i = start; i < end; i += 4) { sum += samples[i] * samples[i]; n++; }
  return Math.sqrt(sum / Math.max(1, n));
}

// Whisper's non-speech placeholders: "[BLANK_AUDIO]", "(music)", "[ Silence ]"…
const NOISE_RE = /^\s*[[(（【].*[\])）】]\s*$/;

export function isNoiseText(text) {
  const t = (text || "").trim();
  return !t || NOISE_RE.test(t);
}

/**
 * Turn one window's Whisper segments into words on the global timeline.
 * Whisper gives a start/end per segment; words inside a segment are spread
 * across it in proportion to their length, which keeps captions short and
 * lets the karaoke highlight move word by word.
 *
 * @param {{text:string,timestamp:[number,number|null]}[]} chunks
 * @param {number} offsetSec  window start on the full timeline
 * @param {number} windowSec  window length (clamps runaway timestamps)
 */
export function segmentsToWords(chunks, offsetSec, windowSec) {
  const words = [];
  const segs = (chunks || []).filter((c) => c && !isNoiseText(c.text) && Array.isArray(c.timestamp));
  segs.forEach((c, i) => {
    let s = Number(c.timestamp[0]);
    let e = c.timestamp[1] == null ? NaN : Number(c.timestamp[1]);
    if (!isFinite(s)) s = 0;
    if (!isFinite(e)) {
      const next = segs[i + 1];
      e = next && isFinite(Number(next.timestamp[0])) ? Number(next.timestamp[0]) : windowSec;
    }
    s = Math.min(Math.max(s, 0), windowSec);
    e = Math.min(Math.max(e, s), windowSec);
    if (e - s < 0.05) e = Math.min(windowSec, s + 0.3);

    const tokens = c.text.trim().split(/\s+/).filter(Boolean);
    if (!tokens.length) return;
    const weights = tokens.map((t) => t.length + 1);
    const totalW = weights.reduce((a, b) => a + b, 0);
    let t = s;
    tokens.forEach((tok, k) => {
      const d = ((e - s) * weights[k]) / totalW;
      words.push({ text: tok, start: +(offsetSec + t).toFixed(3), end: +(offsetSec + t + d).toFixed(3) });
      t += d;
    });
  });
  return words;
}

/** "1:05" style clock for progress messages. */
export function clockLabel(sec) {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
