/**
 * Phase 1 / Phase 3 — Audio Preprocessor
 * Decodes audio from a File/Blob, resamples to 16kHz, converts to Mono,
 * and returns a Float32Array ready for Whisper transcription.
 */

export async function preprocessAudioForTranscription(fileOrBlob) {
  const arrayBuffer = await fileOrBlob.arrayBuffer();
  
  // Whisper requires 16000Hz sampling rate
  const TARGET_SAMPLE_RATE = 16000;
  
  // Create an offline audio context to decode and resample
  // Note: We don't know the exact duration yet, so we decode normally first
  const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
  const audioBuffer = await tempCtx.decodeAudioData(arrayBuffer);
  
  const offlineCtx = new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
    1, // mono
    audioBuffer.duration * TARGET_SAMPLE_RATE,
    TARGET_SAMPLE_RATE
  );
  
  const source = offlineCtx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineCtx.destination);
  source.start(0);
  
  const resampledBuffer = await offlineCtx.startRendering();
  
  // Get the raw mono Float32Array
  const float32Data = resampledBuffer.getChannelData(0);
  
  // Normalization (Peak normalization to -1.0 to +1.0)
  let maxAmp = 0;
  for (let i = 0; i < float32Data.length; i++) {
    const abs = Math.abs(float32Data[i]);
    if (abs > maxAmp) maxAmp = abs;
  }
  
  if (maxAmp > 0 && maxAmp < 1.0) {
    const scale = 1.0 / maxAmp;
    for (let i = 0; i < float32Data.length; i++) {
      float32Data[i] *= scale;
    }
  }

  return float32Data;
}
