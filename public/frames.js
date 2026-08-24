// Reading a rendered file, without asking the browser to guess.
//
// Every pixel assertion in this project used to go through a <video> element:
// set currentTime, wait for onseeked, drawImage onto a canvas. That is
// presentation state, and it has lied three times — twice returning a blank
// frame at the tail of a clip, once mid-clip, and once handing back the same
// frame for two different instants, so a test that believed it had sampled 0.5s
// and 2.5s had sampled one frame twice and compared it with itself.
//
// This asks the server to decode the file instead. What comes back is the frame
// genuinely on screen at that instant, at the file's own resolution, carrying
// the timestamp it actually landed on — so a measurement can state what it
// measured rather than what it requested.
//
// THE RULE THIS EXISTS TO ENFORCE: an acceptance measurement must operate on
// decoded frames, and a geometric assertion about a small feature must be made
// at a resolution where the feature is bigger than the measurement's own noise
// floor. A 3px bar read into a half-size canvas is not a small bar, it is a
// rounding error.
(() => {
  'use strict';

  const EXTRACT_URL = '/api/frames/extract';
  const STATUS_URL = '/api/frames/status';

  let readiness = null;

  async function available(force) {
    if (readiness && !force) return readiness;
    try {
      const res = await fetch(STATUS_URL, { cache: 'no-store' });
      readiness = await res.json();
    } catch (err) {
      readiness = { ready: false, reasons: ['the frame service did not answer: ' + err.message] };
    }
    return readiness;
  }

  function toBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    let s = '';
    // Chunked: String.fromCharCode.apply on a multi-megabyte array overflows
    // the argument list and throws, which looked like a corrupt file.
    for (let i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s);
  }

  const extOf = (blob) => {
    const t = String((blob && blob.type) || '').toLowerCase();
    if (t.includes('webm')) return 'webm';
    if (t.includes('quicktime') || t.includes('mov')) return 'mov';
    if (t.includes('mp4')) return 'mp4';
    return 'mp4';
  };

  /**
   * The frames on screen at these instants.
   *
   * Returns { meta, frames: [{ at, actualAt, width, height, canvas, data }] }.
   * `at` is what was asked for and `actualAt` is what was reached; an assertion
   * that cares about timing should read the second and say so.
   *
   * Throws rather than returning a blank frame. A measurement that silently
   * degrades to black is worse than one that stops.
   */
  async function at(blob, times, { scale = null } = {}) {
    if (!blob || !blob.size) throw new Error('there is no video to measure');
    const list = (Array.isArray(times) ? times : [times]).map(Number);

    const res = await fetch(EXTRACT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        video: toBase64(await blob.arrayBuffer()),
        ext: extOf(blob),
        times: list,
        scale
      })
    });
    if (!res.ok) {
      let why = `HTTP ${res.status}`;
      try { why = (await res.json()).error || why; } catch (e) { /* not json */ }
      throw new Error(why);
    }
    const out = await res.json();

    const frames = [];
    for (const f of out.frames) {
      if (!f.ok) { frames.push({ at: f.at, ok: false, why: f.why }); continue; }
      const img = new Image();
      img.src = 'data:image/png;base64,' + f.png;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = f.width; c.height = f.height;
      const g = c.getContext('2d', { willReadFrequently: true });
      g.drawImage(img, 0, 0);
      frames.push({
        at: f.at, ok: true, actualAt: f.actualAt,
        width: f.width, height: f.height, scale: f.scale,
        canvas: c,
        data: g.getImageData(0, 0, c.width, c.height).data
      });
    }
    return { meta: out.meta, frames };
  }

  /** One frame, for the common case. Throws if it could not be read. */
  async function one(blob, time, opts) {
    const out = await at(blob, [time], opts);
    const f = out.frames[0];
    if (!f || !f.ok) throw new Error(f ? f.why : 'no frame came back');
    f.meta = out.meta;
    return f;
  }

  /**
   * How much of a frame is a colour, and the longest unbroken run of it.
   *
   * The run is what distinguishes a drawn shape from type: a glyph stroke is a
   * few pixels wide and a bar is hundreds, so counting pixels measures both
   * while measuring runs measures only the shape.
   */
  function measure(frame, test) {
    const d = frame.data;
    const w = frame.width, h = frame.height;
    let count = 0, longest = 0;
    const runs = [];
    for (let y = 0; y < h; y++) {
      let run = 0, best = 0;
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (test(d[i], d[i + 1], d[i + 2], d[i + 3])) {
          count++; run++;
          if (run > best) best = run;
        } else { run = 0; }
      }
      if (best) runs.push({ y, run: best });
      if (best > longest) longest = best;
    }
    // Rows of the same shape are contiguous, so grouping them gives one entry
    // per drawn band rather than one per scanline.
    const bands = [];
    let cur = null;
    for (const r of runs) {
      if (cur && r.y === cur.to + 1) { cur.to = r.y; cur.run = Math.max(cur.run, r.run); }
      else { if (cur) bands.push(cur); cur = { from: r.y, to: r.y, run: r.run }; }
    }
    if (cur) bands.push(cur);
    return {
      count,
      share: Math.round((count / (w * h)) * 1000) / 1000,
      longestRun: longest,
      bands: bands.filter((b) => b.to - b.from >= 2)
    };
  }

  window.BlvckFrames = { at, one, measure, available };
})();
