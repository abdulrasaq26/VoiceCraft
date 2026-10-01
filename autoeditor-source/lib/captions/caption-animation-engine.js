/**
 * Caption animation library.
 *
 * Animations are chosen independently of the style. Each one is a pure
 * function of (caption, word timings, time): computeCaptionFrame() returns
 * how the whole caption and each word should look at time `t`, and the
 * renderer draws exactly that — in the preview and in the export — so
 * everything stays locked to the spoken audio.
 */

export const CAPTION_ANIMATIONS = [
  { id: 'none', name: 'None', group: 'Static' },
  { id: 'word-highlight', name: 'Word Highlight', group: 'Word' },
  { id: 'karaoke', name: 'Karaoke', group: 'Word' },
  { id: 'word-pop', name: 'Word Pop', group: 'Word' },
  { id: 'word-fade', name: 'Word Fade', group: 'Word' },
  { id: 'word-scale', name: 'Word Scale', group: 'Word' },
  { id: 'active-color', name: 'Active Word Color', group: 'Word' },
  { id: 'typewriter', name: 'Typewriter', group: 'Text' },
  { id: 'fade-in', name: 'Fade In', group: 'Text' },
  { id: 'fade-out', name: 'Fade Out', group: 'Text' },
  { id: 'fade', name: 'Fade In & Out', group: 'Text' },
  { id: 'slide-up', name: 'Slide Up', group: 'Text' },
  { id: 'slide-down', name: 'Slide Down', group: 'Text' },
  { id: 'slide-left', name: 'Slide Left', group: 'Text' },
  { id: 'slide-right', name: 'Slide Right', group: 'Text' },
  { id: 'bounce', name: 'Bounce', group: 'Text' },
  { id: 'scale-in', name: 'Scale In', group: 'Text' },
];
export const CAPTION_ANIMATION_IDS = new Set(CAPTION_ANIMATIONS.map((a) => a.id));
export const normalizeAnimationId = (id) => (CAPTION_ANIMATION_IDS.has(id) ? id : 'none');

const IN = 0.28;   // caption entrance, seconds
const OUT = 0.22;  // caption exit
const POP = 0.2;   // word pop

const clamp01 = (x) => Math.max(0, Math.min(1, x));
const easeOut = (x) => 1 - Math.pow(1 - clamp01(x), 3);
const easeIn = (x) => Math.pow(clamp01(x), 2);
const easeOutBack = (x) => { const c1 = 1.70158, c3 = c1 + 1; x = clamp01(x); return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2); };
const easeOutBounce = (x) => {
  x = clamp01(x);
  const n1 = 7.5625, d1 = 2.75;
  if (x < 1 / d1) return n1 * x * x;
  if (x < 2 / d1) return n1 * (x -= 1.5 / d1) * x + 0.75;
  if (x < 2.5 / d1) return n1 * (x -= 2.25 / d1) * x + 0.9375;
  return n1 * (x -= 2.625 / d1) * x + 0.984375;
};

/** Index of the word being spoken at t (or the last one finished; -1 before the first). */
export function activeWordIndex(words, t) {
  let last = -1;
  for (let i = 0; i < words.length; i++) {
    if (t >= words[i].start && t < words[i].end) return i;
    if (t >= words[i].end) last = i;
  }
  return last;
}

/**
 * @returns {{ alpha, dx, dy, scale, words: Array<{ state:'past'|'active'|'future',
 *   alpha, scale, dy, highlight, fill, chars }> }}
 *   dx/dy are in em (fractions of the font size); fill is 0..1 karaoke
 *   progress; chars is how many characters to show (Infinity = all).
 */
export function computeCaptionFrame(caption, words, t, animationId) {
  const anim = normalizeAnimationId(animationId);
  const sinceIn = t - caption.start;
  const untilOut = caption.end - t;
  const pIn = clamp01(sinceIn / IN);
  const pOut = clamp01(untilOut / OUT);

  const frame = { alpha: 1, dx: 0, dy: 0, scale: 1, words: [] };

  // ---- whole-caption motion ----
  switch (anim) {
    case 'fade-in': frame.alpha = easeOut(pIn); break;
    case 'fade-out': frame.alpha = easeIn(pOut); break;
    case 'fade': frame.alpha = Math.min(easeOut(pIn), easeIn(pOut)); break;
    case 'slide-up': frame.alpha = Math.min(easeOut(pIn), easeIn(pOut)); frame.dy = (1 - easeOut(pIn)) * 0.9; break;
    case 'slide-down': frame.alpha = Math.min(easeOut(pIn), easeIn(pOut)); frame.dy = -(1 - easeOut(pIn)) * 0.9; break;
    case 'slide-left': frame.alpha = Math.min(easeOut(pIn), easeIn(pOut)); frame.dx = (1 - easeOut(pIn)) * 2.2; break;
    case 'slide-right': frame.alpha = Math.min(easeOut(pIn), easeIn(pOut)); frame.dx = -(1 - easeOut(pIn)) * 2.2; break;
    case 'bounce': {
      const p = clamp01(sinceIn / (IN * 1.8));
      frame.dy = (1 - easeOutBounce(p)) * -1.4;
      frame.alpha = Math.min(clamp01(sinceIn / 0.08), easeIn(pOut));
      break;
    }
    case 'scale-in': frame.alpha = Math.min(easeOut(pIn), easeIn(pOut)); frame.scale = 0.6 + 0.4 * easeOutBack(pIn); break;
    default: break;
  }

  // ---- per-word state ----
  const act = activeWordIndex(words, t);
  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const state = i === act && t < w.end ? 'active' : t >= w.end || i < act ? 'past' : 'future';
    const ws = { state, alpha: 1, scale: 1, dy: 0, highlight: false, fill: state === 'future' ? 0 : 1, chars: Infinity, colored: false, dim: false };
    const dur = Math.max(0.05, w.end - w.start);
    const p = clamp01((t - w.start) / dur);

    switch (anim) {
      case 'word-highlight': ws.highlight = state === 'active'; break;
      case 'active-color': ws.colored = state === 'active'; break;
      case 'karaoke':
        ws.fill = state === 'active' ? p : state === 'past' ? 1 : 0;
        break;
      case 'word-pop':
        if (state === 'future') { ws.alpha = 0; }
        else {
          const q = clamp01((t - w.start) / POP);
          ws.scale = state === 'active' || q < 1 ? 0.7 + 0.3 * easeOutBack(q) : 1;
          ws.colored = state === 'active';
        }
        break;
      case 'word-fade':
        if (state === 'future') ws.alpha = 0.22;
        else ws.alpha = 0.22 + 0.78 * easeOut(clamp01((t - w.start) / 0.18));
        break;
      case 'word-scale':
        ws.scale = state === 'active' ? 1 + 0.18 * easeOut(clamp01((t - w.start) / 0.12)) : 1;
        ws.colored = state === 'active';
        break;
      case 'typewriter':
        // Characters appear across the time the word is actually spoken.
        if (state === 'future') ws.chars = 0;
        else if (state === 'active') ws.chars = Math.max(1, Math.ceil(w.text.length * clamp01((t - w.start) / Math.min(dur, 0.35))));
        break;
      default: break;
    }
    frame.words.push(ws);
  }
  return frame;
}

// Legacy API kept for callers that only need the spoken word.
export function computeAnimationState(caption, playheadTime) {
  const words = caption.words || [];
  return { activeWordIndex: activeWordIndex(words, playheadTime), animationId: caption.animationId || 'none' };
}
export const getActiveWordIndex = (caption, t) => activeWordIndex(caption.words || [], t);
