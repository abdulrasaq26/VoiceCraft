import { normalizeCaptionTrack } from './caption-normalizer.js';

function parseTimestamp(ts) {
  // 00:00:00,000 or 00:00:00.000 -> seconds
  const match = ts.trim().match(/(?:(\d+):)?(\d+):(\d+)[,\.](\d+)/);
  if (!match) return 0;
  const h = match[1] ? parseInt(match[1], 10) : 0;
  const m = parseInt(match[2], 10);
  const s = parseInt(match[3], 10);
  const ms = parseInt(match[4], 10);
  return h * 3600 + m * 60 + s + ms / 1000;
}

/**
 * Parses an SRT file string into the unified Caption model.
 * 
 * @param {string} srtText 
 * @returns {Array} Array of normalized Caption objects
 */
export function parseSRT(srtText) {
  if (!srtText || !srtText.trim()) return { captions: [], error: 'The file is empty.' };
  
  const blocks = srtText.replace(/\r/g, '').split(/\n\s*\n/);
  const rawCaptions = [];

  for (const block of blocks) {
    const lines = block.split('\n');
    if (lines.length >= 2) {
      // Find the line with the timestamp arrow -->
      const tsIndex = lines.findIndex(l => l.includes('-->'));
      if (tsIndex !== -1) {
        const [startStr, endStr] = lines[tsIndex].split('-->');
        const start = parseTimestamp(startStr);
        const end = parseTimestamp(endStr);
        const text = lines.slice(tsIndex + 1).join('\n').trim();
        
        if (text) {
          rawCaptions.push({
            start,
            end,
            text
          });
        }
      }
    }
  }

  if (rawCaptions.length === 0) {
    return { captions: [], error: 'No valid SRT timestamps found.' };
  }

  return { captions: normalizeCaptionTrack(rawCaptions, 'srt'), error: null };
}
