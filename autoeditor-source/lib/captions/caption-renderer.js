/**
 * Phase 11 — Caption Preview Renderer
 * Shared rendering logic for Canvas (Preview) and Image sequence (Export)
 */

import { getCaptionStyle } from './caption-style-manager.js';
import { computeAnimationState } from './caption-animation-engine.js';

/**
 * Returns the currently active caption object for a given time.
 */
export function getActiveCaption(captionsTrack, playheadTime) {
  if (!captionsTrack || !captionsTrack.length) return null;
  for (let i = 0; i < captionsTrack.length; i++) {
    const c = captionsTrack[i];
    if (playheadTime >= c.start && playheadTime < c.end) {
      return c;
    }
  }
  return null;
}

/**
 * Renders the active caption onto an HTML5 Canvas context.
 * Supports word-level highlighting and animations.
 */
export function drawUnifiedCaption(ctx, caption, playheadTime, W, H, overrides = {}) {
  if (!caption || !caption.text) return;

  let style = getCaptionStyle(caption.styleId);
  
  if (overrides.styleOverride) {
    if (overrides.styleOverride === 'classic') style = getCaptionStyle('documentary');
    else if (overrides.styleOverride === 'boxed') style = getCaptionStyle('boxed');
    else if (overrides.styleOverride === 'yellow') style = getCaptionStyle('boldsocial');
  }

  const animState = computeAnimationState(caption, playheadTime);

  let baseSize = style.typography.fontSize;
  if (overrides.sizeOverride === 'sm') baseSize = 40;
  else if (overrides.sizeOverride === 'md') baseSize = 64;
  else if (overrides.sizeOverride === 'lg') baseSize = 96;
  
  const scale = overrides.scaleOverride || 1.0;
  const fontSizePx = Math.round(H * ((baseSize * scale) / 1000));
  ctx.font = `${style.typography.fontWeight} ${fontSizePx}px ${style.typography.fontFamily}`;
  ctx.textAlign = style.layout.alignment;
  ctx.textBaseline = 'middle';
  const lh = overrides.lineHeightOverride ? (1.0 + overrides.lineHeightOverride/100) : style.typography.lineHeight;
  const lineHeightPx = fontSizePx * lh;

  // Compute position
  const x = W * caption.position.x;
  const y = H * caption.position.y;

  // Background Box (if applicable)
  if (style.appearance.backgroundColor && style.appearance.backgroundColor !== 'transparent') {
    ctx.fillStyle = style.appearance.backgroundColor;
    const padding = fontSizePx * 0.5;
    const metrics = ctx.measureText(caption.text);
    const boxW = metrics.width + padding * 2;
    const boxH = fontSizePx * 1.5;
    const boxX = ctx.textAlign === 'center' ? x - boxW / 2 : x - padding;
    const boxY = y - boxH / 2;
    ctx.fillRect(boxX, boxY, boxW, boxH);
  }

  // Draw Words (for word-level animation)
  if (caption.words && caption.words.length > 0 && animState.animationId !== 'none') {
    // Advanced word-by-word drawing (Karaoke, Highlight, etc)
    let currentX = x;
    if (ctx.textAlign === 'center') {
      const fullWidth = ctx.measureText(caption.text).width;
      currentX = x - fullWidth / 2;
    }

    ctx.textAlign = 'left';

    for (let i = 0; i < caption.words.length; i++) {
      const word = caption.words[i];
      const isActive = (i === animState.activeWordIndex);

      // Apply animation effect
      let fillStyle = style.appearance.textColor;
      if (isActive && animState.animationId === 'word-highlight') {
        fillStyle = '#FFD700'; // Gold highlight
      } else if (animState.animationId === 'karaoke' && i > animState.activeWordIndex) {
        fillStyle = 'rgba(255,255,255,0.3)'; // Dimmed future words
      }

      ctx.fillStyle = fillStyle;
      
      if (style.appearance.outlineWidth > 0) {
        ctx.strokeStyle = '#000000';
        ctx.lineWidth = style.appearance.outlineWidth;
        ctx.strokeText(word.text, currentX, y);
      }
      
      ctx.fillText(word.text, currentX, y);

      const wordWidth = ctx.measureText(word.text + ' ').width;
      currentX += wordWidth;
    }
  } else {
    // Simple drawing
    ctx.fillStyle = style.appearance.textColor;
    if (style.appearance.outlineWidth > 0) {
      ctx.strokeStyle = '#000000';
      ctx.lineWidth = style.appearance.outlineWidth;
      ctx.strokeText(caption.text, x, y);
    }
    ctx.fillText(caption.text, x, y);
  }
}
