/**
 * Phase 1 — Unified Caption Data Model & Normalizer
 *
 * This module ensures that captions originating from ANY source
 * (SRT import or Whisper transcription) conform to a single, 
 * standardized unified caption model.
 */

export function generateCaptionId() {
  return 'caption_' + Math.random().toString(36).substring(2, 9);
}

/**
 * Creates a normalized Caption object.
 * 
 * @param {Object} rawCaption 
 * @param {string} source 'srt' | 'generated'
 * @returns {Object} Unified Caption Object
 */
export function normalizeCaption(rawCaption, source = 'generated') {
  return {
    id: rawCaption.id || generateCaptionId(),
    source: source,
    start: Number(rawCaption.start) || 0.0,
    end: Number(rawCaption.end) || 0.0,
    text: (rawCaption.text || '').trim(),
    
    // Words array must be preserved if available, otherwise empty for SRTs
    words: Array.isArray(rawCaption.words) ? rawCaption.words.map(w => ({
      id: w.id || 'word_' + Math.random().toString(36).substring(2, 9),
      text: w.text,
      start: Number(w.start),
      end: Number(w.end)
    })) : [],

    styleId: rawCaption.styleId || 'documentary',
    animationId: rawCaption.animationId || 'none',

    position: rawCaption.position || {
      x: 0.5,
      y: 0.85
    },

    properties: rawCaption.properties || {
      fontSize: 64,
      fontWeight: 700,
      alignment: 'center'
    }
  };
}

export function normalizeCaptionTrack(rawCaptions, source) {
  if (!Array.isArray(rawCaptions)) return [];
  return rawCaptions.map(c => normalizeCaption(c, source));
}
