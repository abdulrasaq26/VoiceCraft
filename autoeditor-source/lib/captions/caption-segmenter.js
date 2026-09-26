/**
 * Phase 6 — Caption Segmentation
 * Converts a raw transcript (with word timings) into readable 
 * caption blocks.
 */

import { generateCaptionId } from './caption-normalizer.js';

export function segmentTranscript(transcript, options = {}) {
  const {
    maxChars = 42,
    maxWords = 10,
    maxPauseSeconds = 1.0,
    maxDurationSeconds = 4.0
  } = options;

  if (!transcript || !transcript.words || transcript.words.length === 0) {
    return [];
  }

  const captions = [];
  let currentWords = [];
  let currentChars = 0;
  let currentStart = transcript.words[0].start;

  const commitCaption = (end) => {
    if (currentWords.length > 0) {
      captions.push({
        id: generateCaptionId(),
        source: 'generated',
        start: currentStart,
        end: end,
        text: currentWords.map(w => w.text).join(' '),
        words: [...currentWords],
        styleId: 'documentary',
        animationId: 'word-highlight',
        position: { x: 0.5, y: 0.85 },
        properties: { fontSize: 64, fontWeight: 700, alignment: 'center' }
      });
      currentWords = [];
      currentChars = 0;
    }
  };

  for (let i = 0; i < transcript.words.length; i++) {
    const word = transcript.words[i];
    
    // Check if we need to split before adding this word
    let shouldSplit = false;

    if (currentWords.length > 0) {
      const prevWord = currentWords[currentWords.length - 1];
      
      // Split on punctuation
      const endsWithPunctuation = /[.!?]$/.test(prevWord.text);
      if (endsWithPunctuation) {
        shouldSplit = true;
      }
      
      // Split on long pause
      if (word.start - prevWord.end > maxPauseSeconds) {
        shouldSplit = true;
      }
      
      // Split on length limits
      if (currentChars + word.text.length + 1 > maxChars) {
        shouldSplit = true;
      }
      if (currentWords.length >= maxWords) {
        shouldSplit = true;
      }
      
      // Split on max duration
      if (word.end - currentStart > maxDurationSeconds) {
        shouldSplit = true;
      }
    }

    if (shouldSplit) {
      commitCaption(currentWords[currentWords.length - 1].end);
      currentStart = word.start;
    }

    currentWords.push(word);
    currentChars += word.text.length + (currentWords.length > 1 ? 1 : 0);
  }

  if (currentWords.length > 0) {
    commitCaption(currentWords[currentWords.length - 1].end);
  }

  return captions;
}
