/**
 * Word timing for captions.
 *
 * Captions generated from audio carry Whisper word timings. Imported SRTs and
 * hand-edited lines don't, so word-level animations need estimated timings:
 * words are spread across the caption in proportion to their length (a long
 * word takes longer to say than "a"). Edits keep real timings wherever the
 * words still line up.
 */

const tokenize = (text) => String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);

/** Spread `tokens` across [start, end] by character weight. */
export function distributeWords(tokens, start, end) {
  const span = Math.max(0.05, end - start);
  const weights = tokens.map((t) => t.length + 1);
  const total = weights.reduce((a, b) => a + b, 0) || 1;
  let t = start;
  return tokens.map((text, i) => {
    const d = (span * weights[i]) / total;
    const w = { text, start: +t.toFixed(3), end: +(t + d).toFixed(3) };
    t += d;
    return w;
  });
}

/**
 * Words for rendering: the caption's own timings when they match its text,
 * otherwise estimated ones. Never mutates the caption.
 */
export function wordsFor(caption) {
  const tokens = tokenize(caption.text);
  const w = caption.words;
  if (Array.isArray(w) && w.length === tokens.length && w.length > 0 &&
      w.every((x) => isFinite(x.start) && isFinite(x.end))) {
    // Timings are real; take the text from the (possibly edited) caption.
    return w.map((x, i) => ({ text: tokens[i], start: x.start, end: x.end }));
  }
  return distributeWords(tokens, caption.start, caption.end);
}

/** Replace a caption's text, keeping real word timings when the count matches. */
export function retext(caption, text) {
  const tokens = tokenize(text);
  const old = Array.isArray(caption.words) ? caption.words : [];
  const words = old.length === tokens.length && old.length > 0
    ? old.map((w, i) => ({ ...w, text: tokens[i] }))
    : distributeWords(tokens, caption.start, caption.end);
  return { ...caption, text: tokens.join(' '), words };
}

/** Move/resize a caption in time, scaling its word timings with it. */
export function retime(caption, start, end) {
  start = Math.max(0, +start);
  end = Math.max(start + 0.1, +end);
  const s0 = caption.start, d0 = Math.max(0.001, caption.end - caption.start);
  const k = (end - start) / d0;
  const words = (wordsFor(caption)).map((w) => ({
    ...w,
    start: +(start + (w.start - s0) * k).toFixed(3),
    end: +(start + (w.end - s0) * k).toFixed(3),
  }));
  return { ...caption, start: +start.toFixed(3), end: +end.toFixed(3), words };
}

/** Split a caption at a word index into two captions, keeping timings. */
export function splitAt(caption, wordIndex) {
  const words = wordsFor(caption);
  if (wordIndex <= 0 || wordIndex >= words.length) return [caption];
  const a = words.slice(0, wordIndex), b = words.slice(wordIndex);
  const mid = b[0].start;
  return [
    { ...caption, end: mid, text: a.map((w) => w.text).join(' '), words: a },
    { ...caption, id: caption.id + '_b', start: mid, text: b.map((w) => w.text).join(' '), words: b },
  ];
}

/** Join a caption with the one after it. */
export function merge(a, b) {
  const words = [...wordsFor(a), ...wordsFor(b)];
  return { ...a, end: b.end, text: words.map((w) => w.text).join(' '), words };
}
