/**
 * Phase 1 / Phase 3 — Audio Preprocessor
 * Decodes audio from a File/Blob, resamples to 16kHz, converts to Mono,
 * and returns a Float32Array ready for Whisper transcription.
 *
 * Memory matters for long voiceovers: decodeAudioData resamples to the
 * context's rate, so decoding straight into a 16kHz OfflineAudioContext never
 * materialises the full-rate buffer (a 7-minute 48kHz stereo WAV is ~160MB
 * decoded at full rate, ~54MB at 16kHz), and no second render pass is needed.
 */

const TARGET_SAMPLE_RATE = 16000; // Whisper's input rate

export async function preprocessAudioForTranscription(fileOrBlob) {
  let arrayBuffer = await fileOrBlob.arrayBuffer();

  const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  const decodeCtx = new Offline(1, 1, TARGET_SAMPLE_RATE);
  let audioBuffer;
  try {
    audioBuffer = await decodeCtx.decodeAudioData(arrayBuffer);
  } catch (e) {
    throw new Error(`Could not decode the audio file (${e && e.message ? e.message : "unsupported format"}).`);
  }
  arrayBuffer = null; // decodeAudioData detaches it anyway; drop our reference

  // Downmix to mono by averaging channels.
  const len = audioBuffer.length;
  const chans = audioBuffer.numberOfChannels;
  const mono = new Float32Array(len);
  for (let c = 0; c < chans; c++) {
    const data = audioBuffer.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += data[i];
  }
  if (chans > 1) {
    const inv = 1 / chans;
    for (let i = 0; i < len; i++) mono[i] *= inv;
  }
  audioBuffer = null;

  // Peak normalization to -1.0 .. +1.0
  let maxAmp = 0;
  for (let i = 0; i < len; i++) {
    const abs = Math.abs(mono[i]);
    if (abs > maxAmp) maxAmp = abs;
  }
  if (maxAmp > 0 && maxAmp < 1.0) {
    const scale = 1.0 / maxAmp;
    for (let i = 0; i < len; i++) mono[i] *= scale;
  }

  return mono;
}
