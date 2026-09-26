import { detectAudio } from './audio-detector.js';
import { preprocessAudioForTranscription } from './audio-preprocessor.js';
import { transcribe } from './transcription-engine.js';
import { validateWordTiming } from './caption-validator.js';
import { segmentTranscript } from './caption-segmenter.js';

/**
 * Orchestrates the full automatic audio-to-caption pipeline.
 */
export async function generateCaptionsFlow(editorState, options, onProgress) {
  // 1. Audio Detection
  if (onProgress) onProgress({ status: 'Detecting audio...', progress: 5 });
  const audioInfo = await detectAudio(options.mode || 'main', editorState);

  // 2. Preprocessing
  if (onProgress) onProgress({ status: 'Preparing audio...', progress: 15 });
  
  const float32Data = await preprocessAudioForTranscription(audioInfo.file);
  


  // 3. Transcription
  
  const rawTranscript = await transcribe(float32Data, { provider: 'local-whisper' }, (info) => {
    if (onProgress) onProgress({ status: info.status, progress: 30 + (info.progress || 0) * 0.5 });
  });

  // 4. Validation
  if (onProgress) onProgress({ status: 'Validating word timing...', progress: 85 });
  const validTranscript = validateWordTiming(rawTranscript);

  // 5. Segmentation
  if (onProgress) onProgress({ status: 'Building captions...', progress: 90 });
  const captions = segmentTranscript(validTranscript, options.segmentation);

  if (onProgress) onProgress({ status: 'Finalizing timeline...', progress: 100 });
  if (captions.length === 0) throw new Error('No speech was detected in the audio file, or transcription failed to extract timing.');
  return captions;
}
