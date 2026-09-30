/**
 * Phase 4 - Local Whisper Transcription
 * Uses @xenova/transformers to run Whisper locally in the browser via WASM.
 *
 * Audio is transcribed in pause-aligned windows of <=28s (see long-audio.js)
 * rather than one call over the whole file: the page stays responsive and
 * shows real progress, and a window that fails is retried, then skipped,
 * instead of losing a long transcription to one bad stretch.
 */

import { pipeline, env } from '@xenova/transformers';
import {
  SAMPLE_RATE, planWindows, windowRms, segmentsToWords, clockLabel,
} from './long-audio.js';

// Configure transformers.js environment for Next.js/Browser
env.allowLocalModels = false;
env.useBrowserCache = true;

const SILENCE_RMS = 0.004; // below this (after peak normalisation) a window is silence

let pipelinePromise = null;

function loadPipeline(onProgress) {
  if (!pipelinePromise) {
    if (onProgress) onProgress({ status: 'Loading Whisper model...', progress: 0 });
    // The model is several files downloaded in parallel; report one combined
    // figure rather than whichever file happened to report last.
    // The total grows as each new file starts, so never let the figure go back.
    const files = new Map();
    let shown = 0;
    pipelinePromise = pipeline('automatic-speech-recognition', 'Xenova/whisper-tiny.en', {
      progress_callback: (info) => {
        if (!onProgress || info.status !== 'progress' || !info.file) return;
        files.set(info.file, { loaded: info.loaded || 0, total: info.total || 0 });
        let loaded = 0, total = 0;
        for (const f of files.values()) { loaded += f.loaded; total += f.total; }
        if (total > 0) {
          shown = Math.max(shown, Math.min(99, Math.floor((loaded / total) * 100)));
          onProgress({ status: `Downloading speech model (${shown}%)`, progress: 0 });
        }
      },
    }).catch((e) => {
      pipelinePromise = null; // let the next attempt retry the download
      throw e;
    });
  }
  return pipelinePromise;
}

// Let React paint the progress message between windows.
const yieldToUi = () => new Promise((r) => setTimeout(r, 0));

export async function transcribeWithLocalWhisper(audioData, options = {}, onProgress) {
  let whisper;
  try {
    whisper = await loadPipeline(onProgress);
  } catch (error) {
    console.error('Local Whisper load error:', error);
    throw new Error('Could not load the Whisper model — check your internet connection for the first download. (' + error.message + ')');
  }

  const totalSec = audioData.length / SAMPLE_RATE;
  const windows = planWindows(audioData, { sampleRate: SAMPLE_RATE });
  const words = [];
  const failures = [];
  let firstError = null;
  let spoken = 0;

  for (let w = 0; w < windows.length; w++) {
    const { start, end } = windows[w];
    const offsetSec = start / SAMPLE_RATE;
    const windowSec = (end - start) / SAMPLE_RATE;
    const pct = Math.round((w / windows.length) * 100);
    if (onProgress) {
      onProgress({
        status: `Transcribing ${clockLabel(offsetSec)} / ${clockLabel(totalSec)} (${pct}%)`,
        progress: pct,
      });
    }
    await yieldToUi();

    if (windowRms(audioData, start, end) < SILENCE_RMS) continue; // silence: nothing to caption
    spoken++;

    // Copy the window: the model may hold on to its input buffer.
    const slice = audioData.slice(start, end);
    let result = null;
    for (let attempt = 0; attempt < 2 && !result; attempt++) {
      try {
        result = await whisper(slice, { return_timestamps: true });
      } catch (e) {
        console.warn(`[captions] window ${w + 1}/${windows.length} attempt ${attempt + 1} failed:`, e);
        if (!firstError) firstError = e;
      }
    }
    if (!result) {
      failures.push(`${clockLabel(offsetSec)}–${clockLabel(offsetSec + windowSec)}`);
      continue;
    }

    if (result.chunks && result.chunks.length) {
      words.push(...segmentsToWords(result.chunks, offsetSec, windowSec));
    } else if (result.text && result.text.trim()) {
      // No timestamps came back: spread this window's words across it.
      words.push(...segmentsToWords([{ text: result.text, timestamp: [0, windowSec] }], offsetSec, windowSec));
    }
  }

  if (spoken > 0 && failures.length === spoken) {
    throw new Error('Transcription failed: ' + (firstError ? firstError.message : 'every section errored'));
  }
  if (failures.length) {
    console.warn(`[captions] skipped ${failures.length} section(s) that failed to transcribe: ${failures.join(', ')}`);
  }
  if (onProgress) onProgress({ status: 'Transcription complete', progress: 100 });

  words.forEach((wd, i) => { wd.id = `word_${i}`; });
  return {
    text: words.map((wd) => wd.text).join(' '),
    start: words.length ? words[0].start : 0,
    end: words.length ? words[words.length - 1].end : totalSec,
    words,
    failedSections: failures,
  };
}
