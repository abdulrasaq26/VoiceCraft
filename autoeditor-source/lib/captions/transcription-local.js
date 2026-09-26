/**
 * Phase 4 - Local Whisper Transcription
 * Uses @xenova/transformers to run Whisper locally in the browser via WASM.
 */

import { pipeline, env } from '@xenova/transformers';

// Configure transformers.js environment for Next.js/Browser
env.allowLocalModels = false;
env.useBrowserCache = true;

let whisperPipeline = null;

export async function transcribeWithLocalWhisper(audioData, options, onProgress) {
  try {
    if (!whisperPipeline) {
      if (onProgress) onProgress({ status: 'Loading Whisper model...' });
      
      whisperPipeline = await pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
        progress_callback: (progressInfo) => {
          if (onProgress && progressInfo.status === 'progress') {
            onProgress({ 
              status: `Downloading model (${Math.round(progressInfo.progress)}%)`
            });
          }
        }
      });
    }

    if (onProgress) onProgress({ status: 'Transcribing speech (this may take a few minutes)...' });
    await new Promise(resolve => setTimeout(resolve, 300));

    // Run the pipeline
    // We try to request chunk-level or word-level timestamps.
    const result = await whisperPipeline(audioData, {
      chunk_length_s: 30,
      stride_length_s: 5,
      return_timestamps: true
    });

    if (!result) {
      throw new Error('Transcription failed: No result returned.');
    }

    
    if (!result.text || result.text.trim() === "") {
      let sum = 0;
      for(let i=0; i<Math.min(100000, audioData.length); i++) sum += Math.abs(audioData[i]);
      /* empty text handled by fallback */
    }
    const words = [];

    let hasTimestamps = false;

    if (result.chunks && Array.isArray(result.chunks) && result.chunks.length > 0) {
      for (const chunk of result.chunks) {
        // Handle chunk.timestamp = [start, end]
        if (chunk.timestamp && chunk.timestamp.length === 2) {
          hasTimestamps = true;
          words.push({
            id: 'word_' + Math.random().toString(36).substring(2, 9),
            text: chunk.text.trim(),
            start: chunk.timestamp[0],
            end: chunk.timestamp[1] !== null ? chunk.timestamp[1] : chunk.timestamp[0] + 2.0
          });
        }
      }
    }

    // FALLBACK: If Whisper returned text but completely failed to return timestamps,
    // we manually split the text into words and spread them evenly across the audio duration.
    if (!hasTimestamps && result.text) {
      const rawWords = result.text.trim().split(/\s+/).filter(w => w.length > 0);
      const totalDuration = audioData.length / 16000;
      const durationPerWord = totalDuration / Math.max(1, rawWords.length);
      
      for (let i = 0; i < rawWords.length; i++) {
        words.push({
          id: 'word_' + Math.random().toString(36).substring(2, 9),
          text: rawWords[i],
          start: i * durationPerWord,
          end: (i + 1) * durationPerWord
        });
      }
    }

    // Return the standardized format
    return {
      text: result.text,
      start: words.length > 0 ? words[0].start : 0,
      end: words.length > 0 ? words[words.length - 1].end : (audioData.length / 16000),
      words: words
    };

  } catch (error) {
    console.error('Local Whisper error:', error);
    throw new Error('Transcription failed: ' + error.message);
  }
}
