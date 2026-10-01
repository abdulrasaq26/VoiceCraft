/**
 * Caption renderer — the one drawing path for captions.
 *
 * The editor preview and the WebCodecs export both call drawCaptionFrame()
 * with the same options object, so style, animation, font, position, size,
 * colour, timing and word highlighting are identical in both. Everything is
 * scaled from the frame height, so a 1080p preview and a 720p export match.
 *
 * opts: { styleId, animationId, size, fontScale, lineHeight, overrides }
 */

import { resolveCaptionStyle, fontCss } from './caption-style-manager.js';
import { computeCaptionFrame } from './caption-animation-engine.js';
import { wordsFor } from './word-aligner.js';

/** The caption on screen at time t, or null. */
export function getActiveCaption(captionsTrack, t) {
  if (!captionsTrack || !captionsTrack.length) return null;
  for (let i = 0; i < captionsTrack.length; i++) {
    const c = captionsTrack[i];
    if (t >= c.start && t < c.end) return c;
  }
  return null;
}

export function captionFontString(style, fontPx) {
  return `${style.weight} ${fontPx}px ${fontCss(style.font)}`;
}

/** Make sure the chosen face is loaded before an export starts drawing. */
export async function ensureCaptionFont(opts) {
  if (typeof document === 'undefined' || !document.fonts) return;
  const style = resolveCaptionStyle(opts.styleId, opts);
  try { await document.fonts.load(captionFontString(style, 64), 'Ag'); } catch (_) { /* fall back to next font */ }
}

function hexA(color, alpha) {
  if (alpha == null || alpha >= 1) return color;
  const m = /^#([0-9a-f]{6})$/i.exec(color || '');
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

// Relative luminance (0 dark .. 1 light) of a #rgb/#rrggbb/rgb() colour.
function luminance(color) {
  let r, g, b;
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color || '');
  if (hex) {
    const h = hex[1].length === 3 ? hex[1].split('').map((c) => c + c).join('') : hex[1];
    r = parseInt(h.slice(0, 2), 16); g = parseInt(h.slice(2, 4), 16); b = parseInt(h.slice(4, 6), 16);
  } else {
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(color || '');
    if (!m) return 0;
    [r, g, b] = [m[1], m[2], m[3]].map(Number);
  }
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

function roundRect(ctx, x, y, w, h, r) {
  r = Math.max(0, Math.min(r, h / 2, w / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ---- layout (cached: it only changes when the caption, style or size does) ----
const layoutCache = new Map();

function layoutCaption(ctx, caption, style, words, W, H) {
  const fontPx = Math.max(8, Math.round(H * style.size));
  const key = `${caption.id}|${caption.text}|${W}x${H}|${fontPx}|${style.font}|${style.weight}|${style.uppercase}|${style.letterSpacing}|${style.maxWordsPerLine}|${style.align}|${style.background.mode}`;
  const hit = layoutCache.get(key);
  if (hit) return hit;

  ctx.save();
  ctx.font = captionFontString(style, fontPx);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(style.letterSpacing * fontPx).toFixed(2)}px`;
  const texts = words.map((w) => (style.uppercase ? w.text.toUpperCase() : w.text));
  const widths = texts.map((t) => ctx.measureText(t).width);
  const space = ctx.measureText(' ').width; // already includes letterSpacing
  ctx.restore();

  const maxW = W * (style.background.mode === 'bar' ? 0.72 : 0.88);
  const maxWords = Math.max(1, style.maxWordsPerLine || 99);
  const lines = [];
  let cur = [], curW = 0;
  texts.forEach((t, i) => {
    const add = (cur.length ? space : 0) + widths[i];
    if (cur.length && (cur.length >= maxWords || curW + add > maxW)) {
      lines.push({ idx: cur, width: curW });
      cur = []; curW = 0;
    }
    curW += (cur.length ? space : 0) + widths[i];
    cur.push(i);
  });
  if (cur.length) lines.push({ idx: cur, width: curW });

  const out = { fontPx, texts, widths, space, lines };
  if (layoutCache.size > 400) layoutCache.clear();
  layoutCache.set(key, out);
  return out;
}

/**
 * Draw one caption at time t. `words` defaults to the caption's word timings
 * (estimated if it has none).
 */
export function drawCaption(ctx, caption, t, W, H, opts = {}) {
  if (!caption || !caption.text) return;
  const style = resolveCaptionStyle(opts.styleId, opts);
  const words = wordsFor(caption);
  if (!words.length) return;
  const L = layoutCaption(ctx, caption, style, words, W, H);
  const frame = computeCaptionFrame(caption, words, t, opts.animationId);
  if (frame.alpha <= 0.001) return;

  const { fontPx, texts, widths, space } = L;

  // Word-limited styles (e.g. Social: 3 words a line) show one "page" of
  // lines at a time — the page holding the word being spoken.
  let lines = L.lines;
  const maxLines = Math.max(1, style.maxLines || 2);
  if (lines.length > maxLines) {
    let act = frame.words.findIndex((w) => w.state === 'active');
    if (act < 0) { act = 0; frame.words.forEach((w, i) => { if (w.state === 'past') act = i; }); }
    const li = Math.max(0, lines.findIndex((ln) => ln.idx.includes(act)));
    const page = Math.floor(li / maxLines);
    lines = lines.slice(page * maxLines, page * maxLines + maxLines);
  }

  const lh = fontPx * style.lineHeight;
  const blockH = lines.length * lh;
  let top;
  if (style.position === 'top') top = H * style.offset;
  else if (style.position === 'center') top = H / 2 - blockH / 2 + H * style.offset;
  else top = H * (1 - style.offset) - blockH;

  const bg = style.background || { mode: 'none' };
  const margin = W * 0.07;
  const barPad = bg.mode === 'bar' ? (bg.padX || 0.8) * fontPx : 0;
  const lineX = (ln) => {
    if (style.align === 'left') return margin + barPad;
    if (style.align === 'right') return W - margin - barPad - ln.width;
    return W / 2 - ln.width / 2;
  };
  const maxLineW = Math.max(...lines.map((l) => l.width));

  ctx.save();
  ctx.globalAlpha *= frame.alpha;
  // Whole-caption motion, scaled about the block centre.
  const cx = W / 2, cy = top + blockH / 2;
  ctx.translate(frame.dx * fontPx + cx, frame.dy * fontPx + cy);
  if (frame.scale !== 1) ctx.scale(frame.scale, frame.scale);
  ctx.translate(-cx, -cy);

  // ---- backgrounds ----
  if (bg.mode && bg.mode !== 'none' && bg.mode !== 'word') {
    ctx.fillStyle = hexA(bg.color || '#000000', bg.opacity == null ? 0.6 : bg.opacity);
    const padX = (bg.padX || 0.4) * fontPx, padY = (bg.padY || 0.14) * fontPx, r = (bg.radius || 0) * fontPx;
    if (bg.mode === 'line') {
      lines.forEach((ln, i) => {
        const x = lineX(ln), y = top + i * lh + (lh - fontPx) / 2;
        roundRect(ctx, x - padX, y - padY, ln.width + padX * 2, fontPx + padY * 2, r);
        ctx.fill();
      });
    } else {
      let x0;
      if (style.align === 'left') x0 = margin + barPad - (bg.mode === 'bar' ? barPad : padX);
      else if (style.align === 'right') x0 = W - margin - barPad - maxLineW - padX;
      else x0 = W / 2 - maxLineW / 2 - padX;
      const bw = maxLineW + padX * 2 + (bg.mode === 'bar' ? barPad - padX : 0);
      roundRect(ctx, x0, top - padY, bw, blockH + padY * 2, r);
      ctx.fill();
      if (bg.mode === 'bar' && bg.accent) {
        ctx.fillStyle = bg.accent;
        ctx.fillRect(x0, top - padY, Math.max(3, fontPx * 0.14), blockH + padY * 2);
      }
    }
  }

  // ---- words ----
  ctx.font = captionFontString(style, fontPx);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${(style.letterSpacing * fontPx).toFixed(2)}px`;
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  ctx.miterLimit = 2;
  const baseAlpha = ctx.globalAlpha;

  lines.forEach((ln, li) => {
    let x = lineX(ln);
    const baseline = top + li * lh + lh / 2 + fontPx * 0.34;
    ln.idx.forEach((wi, k) => {
      if (k > 0) x += space;
      const ws = frame.words[wi] || { alpha: 1, scale: 1, fill: 1, chars: Infinity };
      const full = texts[wi];
      const w = widths[wi];
      const text = ws.chars === Infinity ? full : full.slice(0, ws.chars);
      if (text && ws.alpha > 0.001) {
        ctx.save();
        ctx.globalAlpha = baseAlpha * ws.alpha;
        const wx = x + w / 2, wy = baseline - fontPx * 0.34;
        if (ws.scale !== 1) {
          ctx.translate(wx, wy);
          ctx.scale(ws.scale, ws.scale);
          ctx.translate(-wx, -wy);
        }
        if (ws.highlight) {
          const px = fontPx * 0.18, py = fontPx * 0.1;
          ctx.fillStyle = style.activeColor;
          roundRect(ctx, x - px, baseline - fontPx * 0.86 - py, w + px * 2, fontPx * 1.08 + py * 2, fontPx * 0.18);
          ctx.fill();
        }
        if (ws.highlight) {
          // Text on the pill takes whichever of dark/white reads against it.
          const onPill = luminance(style.activeColor) > 0.45 ? '#111114' : '#ffffff';
          paintText(ctx, text, x, baseline, { ...style, stroke: null, shadow: null }, fontPx, onPill);
        } else {
          paintText(ctx, text, x, baseline, style, fontPx, ws.colored ? style.activeColor : style.color);
        }
        // Karaoke: overpaint the spoken part of the word in the active colour.
        if (opts.animationId === 'karaoke' && ws.fill > 0) {
          ctx.save();
          ctx.beginPath();
          ctx.rect(x - fontPx, baseline - fontPx * 1.5, fontPx + w * ws.fill, fontPx * 2.5);
          ctx.clip();
          paintText(ctx, text, x, baseline, style, fontPx, style.activeColor, true);
          ctx.restore();
        }
        ctx.restore();
      }
      x += w;
    });
  });
  ctx.restore();
}

function paintText(ctx, text, x, y, style, fontPx, fill, noShadow = false) {
  const sh = !noShadow && style.shadow;
  const setShadow = (on) => {
    if (on && sh) {
      ctx.shadowColor = sh.color;
      ctx.shadowBlur = (sh.blur || 0) * fontPx;
      ctx.shadowOffsetX = (sh.x || 0) * fontPx;
      ctx.shadowOffsetY = (sh.y || 0) * fontPx;
    } else {
      ctx.shadowColor = 'transparent'; ctx.shadowBlur = 0; ctx.shadowOffsetX = 0; ctx.shadowOffsetY = 0;
    }
  };
  if (style.stroke && style.stroke.width > 0) {
    setShadow(true); // shadow sits under the outline
    ctx.strokeStyle = style.stroke.color;
    ctx.lineWidth = Math.max(1, style.stroke.width * fontPx);
    ctx.strokeText(text, x, y);
    setShadow(false);
  } else {
    setShadow(true);
  }
  ctx.fillStyle = fill;
  ctx.fillText(text, x, y);
  setShadow(false);
}

/** Draw whatever caption is on screen at t. */
export function drawCaptionFrame(ctx, cues, t, W, H, opts) {
  const c = getActiveCaption(cues, t);
  if (c) drawCaption(ctx, c, t, W, H, opts);
}

/** A representative frame for style/animation preview cards. */
export const SAMPLE_CAPTION = {
  id: '__sample', start: 0, end: 2.4, text: 'This is how people lived',
  words: [
    { text: 'This', start: 0.0, end: 0.35 }, { text: 'is', start: 0.35, end: 0.55 },
    { text: 'how', start: 0.55, end: 0.9 }, { text: 'people', start: 0.9, end: 1.45 },
    { text: 'lived', start: 1.45, end: 2.1 },
  ],
};

// Backwards-compatible entry point.
export function drawUnifiedCaption(ctx, caption, t, W, H, opts = {}) {
  drawCaption(ctx, caption, t, W, H, {
    styleId: opts.styleId || caption.styleId, animationId: opts.animationId || caption.animationId, ...opts,
  });
}
