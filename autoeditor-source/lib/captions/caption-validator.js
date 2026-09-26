/**
 * Phase 5 — Word Timing & Validation
 * 
 * Transcription models can sometimes return slightly overlapping word timings
 * or negative durations. This module normalizes the word-level timestamps 
 * ensuring monotonicity and correctness.
 */

export function validateWordTiming(transcriptResult) {
  if (!transcriptResult || !transcriptResult.words) return transcriptResult;

  const words = [...transcriptResult.words];

  for (let i = 0; i < words.length; i++) {
    const word = words[i];

    // Fix negative or zero durations
    if (word.end <= word.start) {
      word.end = word.start + 0.1; 
    }

    // Fix overlaps with previous word
    if (i > 0) {
      const prev = words[i - 1];
      if (word.start < prev.end) {
        // Resolve overlap by shifting the boundary to the midpoint
        const midpoint = (word.start + prev.end) / 2.0;
        prev.end = midpoint;
        word.start = midpoint;
      }
    }
  }

  // Recalculate global start/end
  if (words.length > 0) {
    transcriptResult.start = words[0].start;
    transcriptResult.end = words[words.length - 1].end;
  }

  return { ...transcriptResult, words };
}
