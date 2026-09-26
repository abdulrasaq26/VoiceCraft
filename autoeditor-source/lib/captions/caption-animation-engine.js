/**
 * Phase 9 — Caption Animation Engine
 * Resolves active words and computes animation states for rendering.
 */

export const CAPTION_ANIMATIONS = {
  none: { id: 'none', name: 'None' },
  wordHighlight: { id: 'word-highlight', name: 'Word Highlight' },
  karaoke: { id: 'karaoke', name: 'Karaoke' },
  wordPop: { id: 'word-pop', name: 'Word Pop' },
  typewriter: { id: 'typewriter', name: 'Typewriter' }
};

export function getActiveWordIndex(caption, playheadTime) {
  if (!caption.words || caption.words.length === 0) return -1;
  
  for (let i = 0; i < caption.words.length; i++) {
    const word = caption.words[i];
    if (playheadTime >= word.start && playheadTime <= word.end) {
      return i;
    }
  }

  // If time is between words, return the most recently completed word
  let lastCompleted = -1;
  for (let i = 0; i < caption.words.length; i++) {
    if (playheadTime > caption.words[i].end) {
      lastCompleted = i;
    }
  }
  return lastCompleted;
}

export function computeAnimationState(caption, playheadTime) {
  const activeWordIdx = getActiveWordIndex(caption, playheadTime);
  
  // Return animation properties for the renderer
  return {
    activeWordIndex: activeWordIdx,
    animationId: caption.animationId || 'none'
  };
}
