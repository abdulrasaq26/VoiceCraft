/**
 * Phase 4 — Pluggable Transcription Interface
 * 
 * Provides a common transcribe() function that delegates to a specific
 * backend (Local Whisper, External API, etc.)
 */

import { transcribeWithLocalWhisper } from './transcription-local.js';

/**
 * Transcribes preprocessed audio into a unified word-level transcript.
 * 
 * @param {Float32Array} audioData - Resampled 16kHz Mono Float32 array
 * @param {Object} options - Configuration options
 * @param {Function} onProgress - Callback for reporting progress
 */
export async function transcribe(audioData, options = {}, onProgress = null) {
  const provider = options.provider || 'local-whisper';

  if (provider === 'local-whisper') {
    return await transcribeWithLocalWhisper(audioData, options, onProgress);
  }

  // Future providers can be added here
  // if (provider === 'openai') { ... }

  throw new Error(`Unknown transcription provider: ${provider}`);
}
