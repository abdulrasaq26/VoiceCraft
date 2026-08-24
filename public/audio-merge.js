// Joining the narration chunks into one track.
//
// A long script is spoken in pieces because the engine has a token ceiling, not
// because anyone wanted pieces. The editor already lays them end to end to build
// the video's audio - decode each part, place it at the running offset, no gap -
// and this produces a FILE of exactly that, so what you download and what the
// video plays are the same recording rather than two things that ought to match.
//
// End to end with no gap is therefore not a default to be tuned. Insert a pause
// between parts here and the download drifts against the video by that pause
// times the number of chunks, and every cue in the SRT with it.
//
// WAV, because it is the only container this app can write. The parts arrive as
// MP3 and joining MP3 by concatenating frames is a trick that works until it
// does not - encoder delay and a bitrate change put a click at every seam - so
// they are decoded and re-encoded properly. encodeWav belongs to
// voice-cloning.js and is reused rather than written again.
(() => {
  'use strict';

  /**
   * Decode every blob into one continuous mono track and encode it as a WAV.
   *
   * Decoding happens inside a single OfflineAudioContext, so parts recorded at
   * different sample rates are resampled to a common one on the way in rather
   * than being spliced at mismatched rates - which would play the odd chunk at
   * the wrong pitch and speed.
   *
   * @param {Blob[]} blobs in the order they should be heard
   * @param {{sampleRate?: number, onProgress?: (done:number, total:number) => void}} opts
   * @returns {Promise<{blob: Blob, seconds: number, parts: number, skipped: number}>}
   */
  async function merge(blobs, opts = {}) {
    const list = (blobs || []).filter(Boolean);
    if (!list.length) throw new Error('there is nothing to join');
    if (!window.BlvckVoiceCloning || !window.BlvckVoiceCloning.encodeWav) {
      throw new Error('the WAV encoder is not loaded');
    }

    const rate = Number(opts.sampleRate) || 44100;
    const Ctx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Ctx) throw new Error('this browser cannot decode audio');

    // One context for every decode, so every part lands at the same rate.
    const ctx = new Ctx(1, rate, rate);

    const parts = [];
    let total = 0;
    let skipped = 0;
    for (let i = 0; i < list.length; i++) {
      try {
        const buf = await ctx.decodeAudioData(await list[i].arrayBuffer());
        const chans = buf.numberOfChannels;
        let mono;
        if (chans === 1) {
          mono = buf.getChannelData(0);
        } else {
          mono = new Float32Array(buf.length);
          for (let c = 0; c < chans; c++) {
            const d = buf.getChannelData(c);
            for (let n = 0; n < d.length; n++) mono[n] += d[n] / chans;
          }
        }
        parts.push(mono);
        total += mono.length;
      } catch (err) {
        // One unreadable part must not cost the other twenty. It is counted and
        // reported rather than passed over in silence, because a narration that
        // is quietly missing a minute is worse than one that failed loudly.
        skipped++;
        console.warn(`[AudioMerge] part ${i + 1} could not be decoded: ${err.message}`);
      }
    }
    if (!parts.length) throw new Error('none of the parts could be decoded');

    const out = new Float32Array(total);
    let at = 0;
    for (const p of parts) {
      out.set(p, at);
      at += p.length;
      if (opts.onProgress) opts.onProgress(at / rate, total / rate);
    }

    return {
      blob: window.BlvckVoiceCloning.encodeWav(out, rate),
      seconds: total / rate,
      parts: parts.length,
      skipped
    };
  }

  window.BlvckAudioMerge = { merge };
})();
