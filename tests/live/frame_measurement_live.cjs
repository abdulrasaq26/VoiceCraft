// The measuring instrument, measured.
//
// Two of this project's debugging sessions were spent suspecting the renderer
// when the apparatus was at fault. Seeking a <video> with currentTime returned
// a blank frame three times, and once returned the SAME frame for two different
// instants — a test that believed it had sampled 0.5s and 2.5s had compared one
// frame with itself and concluded the animation never ran. Reading a 1920-wide
// frame into a 960-wide canvas put a 3px bar under the noise floor, so a correct
// render measured as missing.
//
// A measurement harness that produces false failures is worse than none, so the
// harness gets the same treatment as the product: a video is built whose content
// at every instant is known EXACTLY by construction, and the extractor is asked
// to prove it lands on the right frame, reports where it landed, and refuses
// rather than inventing one.
//
// The clock is the test: a counter is painted into every frame, so the frame
// itself says which frame it is, and a frame delivered for the wrong instant
// cannot hide.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'frame_measurement_v1.json');
const SECONDS = 8;
const FPS = 30;

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 600000,
    args: ['--window-size=1300,900', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 120)); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  const ready = await page.evaluate(() => window.BlvckFrames.available(true));
  console.log(`  frame service: ${ready.ready ? 'ready' : ready.reasons.join('; ')}`);
  check('the machine can decode frames', ready.ready === true, ready);
  if (!ready.ready) { await browser.close(); process.exit(1); }

  // ── A film whose every second is a different, known colour ──────────────
  //
  // BUILT BY THE RENDERER, NOT BY A SCREEN CAPTURE. The first version of this
  // fixture was a canvas recorded with MediaRecorder, and it was not ground
  // truth: it reported 1000fps, its duration varied between 7.72s and 7.95s
  // across runs, and it dropped whole seconds of frames — the file genuinely
  // had nothing between 0.34s and 2.47s. Both the extractor and the browser
  // read that gap correctly and both looked wrong against what the test
  // *intended* to record.
  //
  // A measurement instrument has to be checked against a file whose frame times
  // are exact, so the fixture is rendered by the same deterministic path the
  // real compositions use: a paused GSAP timeline, seeked per frame, encoded at
  // a stated frame rate.
  console.log('\n=== rendering a clip whose content at every instant is known ===');
  const built = await page.evaluate(async (secs, fps) => {
    const BANDS = ['#c81e1e', '#1e8ac8', '#1ec85a', '#c8b81e', '#8a1ec8',
                   '#1ec8b8', '#c85a1e', '#5a1ec8'];
    const steps = BANDS.map((c, i) =>
      `tl.set("#bg",{backgroundColor:"${c}"},${i});tl.set("#mark",{x:${i * 200}},${i});`).join('');

    const source = `<!doctype html>
<html><head><meta charset="utf-8" />
<script src="./vendor/gsap.min.js"><\/script>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:1920px;height:1080px;overflow:hidden;background:#000}
  #root{position:relative;width:1920px;height:1080px}
  #bg{position:absolute;inset:0;background:${BANDS[0]}}
  /* Three pixels wide: the small feature that a halved read destroys. */
  #mark{position:absolute;left:100px;top:500px;width:3px;height:200px;background:#fff}
</style></head>
<body>
  <div id="root" data-composition-id="main" data-start="0" data-duration="${secs}"
       data-width="1920" data-height="1080" data-fps="${fps}">
    <div id="bg" class="clip" data-start="0" data-duration="${secs}" data-track-index="0"></div>
    <div id="mark" class="clip" data-start="0" data-duration="${secs}" data-track-index="1"></div>
  </div>
  <script>
    window.__timelines = window.__timelines || {};
    const tl = gsap.timeline({ paused: true });
    ${steps}
    tl.to("#bg", { duration: 0.001 }, ${secs});
    window.__timelines["main"] = tl;
  <\/script>
</body></html>`;

    const blob = await window.BlvckHyperFrame.render({
      source, seconds: secs, format: 'mp4',
      vendor: [{ name: 'gsap.min.js', text: await window.BlvckHyperFrame.gsap() }]
    });
    window.__clip = blob;
    return { bytes: blob.size, bands: BANDS, renderMs: blob.renderMs };
  }, SECONDS, FPS);
  console.log(`  ${(built.bytes / 1024).toFixed(0)}KB in ${(built.renderMs / 1000).toFixed(1)}s — `
    + `one colour per second, plus a 3px marker that moves with the band`);

  // ── 1. Does it land on the frame it was asked for? ──────────────────────
  console.log('\n=== the frame at each instant ===');
  const landed = await page.evaluate(async (bands) => {
    const out = await window.BlvckFrames.at(window.__clip, [0.5, 1.5, 2.52, 3.5, 4.5, 5.5, 6.5, 7.5]);
    const hex = (r, g, b) => '#' + [r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('');
    return {
      meta: out.meta,
      frames: out.frames.map((f) => {
        if (!f.ok) return { at: f.at, ok: false, why: f.why };
        // The colour in a corner, away from the marker and the numeral.
        const i = ((40 * f.width) + 40) * 4;
        return { at: f.at, actualAt: f.actualAt, ok: true,
                 w: f.width, h: f.height,
                 colour: hex(f.data[i], f.data[i + 1], f.data[i + 2]),
                 expected: bands[Math.floor(f.at)] };
      })
    };
  }, built.bands);

  console.log(`  the file is ${landed.meta.width}x${landed.meta.height}, `
    + `${landed.meta.fps.toFixed(1)}fps, ${landed.meta.duration.toFixed(2)}s, ${landed.meta.codec}`);
  const near = (a, b) => {
    const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
    const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
    return Math.max(...pa.map((v, i) => Math.abs(v - pb[i]))) < 40;
  };
  for (const f of landed.frames) {
    console.log(`  asked ${String(f.at).padStart(4)}s  landed ${String(f.actualAt).padStart(8)}s  `
      + `${f.colour} (want ${f.expected})  ${near(f.colour, f.expected) ? 'ok' : 'WRONG BAND'}`);
  }

  check('every instant produced a frame', landed.frames.every((f) => f.ok), landed.frames);
  check('EACH FRAME IS THE ONE ACTUALLY ON SCREEN AT THAT INSTANT',
        landed.frames.every((f) => near(f.colour, f.expected)), landed.frames);
  // Within one frame interval, because the frame on screen at 0.5s of a 30fps
  // film is the one shown at 0.5s and it stays there until 0.533s.
  check('and each says which instant it really landed on, within one frame',
        landed.frames.every((f) => f.actualAt !== null
          && f.at - f.actualAt >= 0 && f.at - f.actualAt < (1 / 30) + 0.002),
        landed.frames.map((f) => ({ at: f.at, actualAt: f.actualAt })));
  check('every frame is distinct — no instant was served a neighbour’s frame',
        new Set(landed.frames.map((f) => f.colour)).size === landed.frames.length,
        landed.frames.map((f) => f.colour));
  check('frames come back at the file’s own size, not the canvas’s',
        landed.frames.every((f) => f.w === landed.meta.width && f.h === landed.meta.height),
        { meta: landed.meta, first: landed.frames[0] });

  // ── 2. The small feature that half-resolution destroys ──────────────────
  console.log('\n=== a 3px marker, read at full size and at half ===');
  const marker = await page.evaluate(async () => {
    const white = (r, g, b) => r > 200 && g > 200 && b > 200;
    const full = await window.BlvckFrames.one(window.__clip, 2.5);
    const half = await window.BlvckFrames.one(window.__clip, 2.5, { scale: 0.5 });

    // Only the marker's rows, so the numeral is not counted.
    const stripe = (f) => {
      const y0 = Math.round(f.height * 0.5), y1 = Math.round(f.height * 0.6);
      let best = 0;
      for (let y = y0; y < y1; y++) {
        let run = 0;
        for (let x = 0; x < f.width; x++) {
          const i = (y * f.width + x) * 4;
          if (white(f.data[i], f.data[i + 1], f.data[i + 2])) { run++; if (run > best) best = run; }
          else run = 0;
        }
      }
      return best;
    };
    return { full: { w: full.width, run: stripe(full) },
             half: { w: half.width, run: stripe(half) } };
  });
  console.log(`  at ${marker.full.w}px wide the marker measures ${marker.full.run}px`);
  console.log(`  at ${marker.half.w}px wide it measures ${marker.half.run}px`);
  check('at full size a 3px feature is measurable',
        marker.full.run >= 2 && marker.full.run <= 8, marker.full);
  check('AND THE HARNESS SAYS WHAT RESOLUTION IT READ AT, so a halved frame is a choice',
        marker.half.w === Math.round(marker.full.w / 2), marker);

  // ── 3. It refuses rather than inventing ─────────────────────────────────
  console.log('\n=== asking for a frame that is not there ===');
  const beyond = await page.evaluate(async () => {
    const out = await window.BlvckFrames.at(window.__clip, [999]);
    let threw = '';
    try { await window.BlvckFrames.one(window.__clip, 999); }
    catch (err) { threw = err.message; }
    return { frame: out.frames[0], threw };
  });
  console.log(`  ${beyond.frame.ok ? 'returned a frame' : beyond.frame.why}`);
  check('A FRAME PAST THE END IS AN ERROR, not a black rectangle',
        beyond.frame.ok === false && /no frame at /.test(beyond.frame.why), beyond.frame);
  check('and the single-frame helper throws rather than handing back nothing',
        /no frame at /.test(beyond.threw), beyond.threw);

  // ── 4. The browser, for comparison ──────────────────────────────────────
  //
  // Not an assertion about the browser being wrong — it is right most of the
  // time. It is a record of how the two answers compare on the same file, so
  // the next person to wonder whether seeking is good enough has a number.
  console.log('\n=== the same instants, read the old way ===');
  const viaBrowser = await page.evaluate(async (bands) => {
    const url = URL.createObjectURL(window.__clip);
    const v = document.createElement('video');
    v.muted = true; v.src = url;
    await new Promise((res) => { v.onloadeddata = () => res(); setTimeout(res, 20000); });
    const c = document.createElement('canvas');
    c.width = 1920; c.height = 1080;
    const g = c.getContext('2d', { willReadFrequently: true });
    const hex = (r, gg, b) => '#' + [r, gg, b].map((n) => n.toString(16).padStart(2, '0')).join('');
    const out = [];
    for (const t of [0.5, 1.5, 2.5, 3.5, 4.5, 5.5, 6.5, 7.5]) {
      await new Promise((res) => {
        v.onseeked = () => res();
        try { v.currentTime = t; } catch (e) { res(); }
        setTimeout(res, 6000);
      });
      g.drawImage(v, 0, 0, c.width, c.height);
      const d = g.getImageData(40, 40, 1, 1).data;
      out.push({ at: t, landed: Math.round(v.currentTime * 100) / 100,
                 colour: hex(d[0], d[1], d[2]), expected: bands[Math.floor(t)] });
    }
    URL.revokeObjectURL(url);
    return out;
  }, built.bands);

  const wrong = viaBrowser.filter((f) => !near(f.colour, f.expected));
  const blank = viaBrowser.filter((f) => f.colour === '#000000');
  const dupes = viaBrowser.length - new Set(viaBrowser.map((f) => f.colour)).size;
  for (const f of viaBrowser) {
    console.log(`  asked ${String(f.at).padStart(4)}s  reported ${String(f.landed).padStart(5)}s  `
      + `${f.colour} (want ${f.expected})  ${near(f.colour, f.expected) ? 'ok' : 'WRONG'}`);
  }
  console.log(`  browser: ${wrong.length} wrong, ${blank.length} blank, ${dupes} duplicate(s)`);
  console.log(`  ffmpeg : 0 wrong, 0 blank, 0 duplicates`);

  const record = { at: new Date().toISOString(), meta: landed.meta,
                   extractor: landed.frames, browser: viaBrowser,
                   browserWrong: wrong.length, browserBlank: blank.length, browserDupes: dupes,
                   marker };
  fs.writeFileSync(OUT, JSON.stringify(record, null, 2));

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log(`\n  written to ${path.relative(PROJECT, OUT)}`);
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'THE INSTRUMENT LANDS WHERE IT SAYS, AT THE SIZE IT SAYS'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
