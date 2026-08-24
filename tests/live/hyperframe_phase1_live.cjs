// Phase 1: a HyperFrame scene, rendered from inside the app, in the export.
//
// The claim is narrow and it is the only one that matters at this stage: a
// composition written as HTML can be rendered by the HyperFrame runtime, stored
// where the storyboard stores a clip, assembled by the existing compositor and
// come out the other end as pixels in an exported video.
//
// No Planner, no Director, no AI. The composition is hand-written, because the
// thing under test is the SEAM, not anybody's judgement about what to draw.
//
// Two properties are asserted that a "did it render" check would miss.
//
// The scene has NO stockAsset and never touches acquisition — that is the whole
// point of a HYPERFRAME scene, and if the pipeline quietly requires footage
// this is where it shows.
//
// And the exported frames are compared against the composition's own colours.
// The scene is deliberately built from an accent no stock footage would carry,
// so "the graphics reached the file" is measurable rather than asserted.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'hyperframe_phase1_v1.json');

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

// Short on purpose: rendering is several times slower than real time, and this
// test is about the seam, not about endurance.
const SECONDS = 3;

// The scene's own accent. Chosen because open footage does not contain
// saturated magenta, so finding it in the export is evidence.
const ACCENT = { r: 233, g: 30, b: 160 };

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 900000,
    args: ['--window-size=1300,900', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });
  page.on('console', (m) => {
    const t = m.text();
    if (/HyperFrame|hyperframe|export/i.test(t)) console.log('  · ' + t.slice(0, 130));
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  // ── Is the runtime there at all? ────────────────────────────────────────
  console.log('=== the render service ===');
  const ready = await page.evaluate(() => window.BlvckHyperFrame.available(true));
  console.log(`  ${JSON.stringify(ready)}`);
  check('the render service reports ready', ready.ready === true, ready);
  if (!ready.ready) {
    console.log('\nFAILED: nothing below can run without a renderer.');
    await browser.close();
    process.exit(1);
  }

  // ── A scene with no footage ─────────────────────────────────────────────
  console.log('\n=== rendering one scene from code ===');
  const rendered = await page.evaluate(async (secs, accent) => {
    const gsap = await window.BlvckHyperFrame.gsap();

    // Hand-written. One asset-free component, one GSAP move, stable ids so
    // Studio could edit it later — the lint rule the framework asks for.
    const source = `<!doctype html><html><head><meta charset="utf-8">
<script src="./vendor/gsap.min.js"><\/script>
<style>
 *{margin:0;padding:0;box-sizing:border-box}
 html,body{width:1920px;height:1080px;overflow:hidden;background:#0b0d12}
 body{font-family:Georgia,'Times New Roman',serif}
 #card{position:absolute;left:170px;top:392px}
 #kicker{font-family:ui-monospace,monospace;font-size:26px;letter-spacing:.3em;
         text-transform:uppercase;color:rgb(${accent.r},${accent.g},${accent.b})}
 #head{font-size:118px;color:#f2f5f8;margin-top:20px;letter-spacing:-.02em}
 #bar{margin-top:36px;width:0;height:14px;
      background:rgb(${accent.r},${accent.g},${accent.b})}
 #chip{position:absolute;right:180px;top:430px;width:260px;height:260px;
       border-radius:16px;background:rgb(${accent.r},${accent.g},${accent.b});opacity:0}
</style></head><body>
 <div id="root" data-composition-id="main" data-start="0" data-duration="${secs}"
      data-width="1920" data-height="1080" data-fps="30">
   <div id="card" class="clip" data-start="0" data-duration="${secs}" data-track-index="0">
     <div id="kicker">No footage was used</div>
     <div id="head">A scene made of code.</div>
     <div id="bar"></div>
   </div>
   <div id="chip" class="clip" data-start="0" data-duration="${secs}" data-track-index="1"></div>
 </div>
 <script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({paused:true});
  tl.from("#kicker",{opacity:0,y:14,duration:.45,ease:"power2.out"},0.05)
    .from("#head",{opacity:0,y:34,duration:.65,ease:"power3.out"},0.2)
    .to("#bar",{width:560,duration:.75,ease:"power2.inOut"},0.6)
    .to("#chip",{opacity:1,duration:.5,ease:"power2.out"},0.5);
  window.__timelines["main"] = tl;
 <\/script></body></html>`;

    // A scene the storyboard will hold. No stockAsset: this is the case.
    const scene = {
      index: 1,
      timestamp: '00:00:00 - 00:00:0' + secs,
      subtitle: 'Some ideas have no footage. This is one of them.',
      sceneSummary: 'a scene made of code',
      status: 'pending',
      timelineStart: 0, timelineEnd: secs,
      visualStrategy: { mode: 'HYPERFRAME', reason: 'hand-written for the seam test', ran: true },
      hyperFrame: { mode: 'FULL_FRAME', status: 'planned' }
    };

    localStorage.setItem('blvck-tts:storyboard', JSON.stringify({
      project: { title: 'phase 1' }, cues: [], scenes: [scene], transcript: null
    }));
    const live = window.BlvckStoryboard.scenes();
    live.length = 0;
    live.push(scene);

    const t0 = Date.now();
    let out = null, error = null;
    try {
      out = await window.BlvckHyperFrame.renderScene(scene, {
        source, vendor: [{ name: 'gsap.min.js', text: gsap }]
      });
    } catch (e) { error = e.message; }
    if (error) return { error, wallMs: Date.now() - t0 };

    window.BlvckStoryboard.save();
    const stored = JSON.parse(localStorage.getItem('blvck-tts:storyboard')).scenes[0];
    return {
      wallMs: Date.now() - t0,
      renderMs: out.renderMs,
      seconds: out.seconds,
      bytes: out.blob.size,
      type: out.blob.type,
      hyperFrame: stored.hyperFrame,
      hasStockAsset: !!stored.stockAsset,
      assetType: stored.assetType,
      status: stored.status
    };
  }, SECONDS, ACCENT);

  if (rendered.error) {
    check('the composition rendered', false, rendered.error);
    console.log('\nFAILED — nothing downstream can be checked.');
    await browser.close();
    process.exit(1);
  }

  console.log(`  ${(rendered.bytes / 1024).toFixed(0)}KB ${rendered.type} · ${rendered.seconds}s`
    + ` · rendered in ${(rendered.renderMs / 1000).toFixed(1)}s`
    + ` (${(rendered.renderMs / 1000 / rendered.seconds).toFixed(1)}x real time)`);
  console.log(`  scene: ${JSON.stringify(rendered.hyperFrame)}`);

  check('a video came back from the renderer', rendered.bytes > 0, rendered);
  check('the scene never acquired footage — HYPERFRAME needs none',
        rendered.hasStockAsset === false, rendered);
  check('it was stored as the scene\'s video, under the storyboard\'s own key',
        rendered.assetType === 'video' && rendered.hyperFrame.renderedKey === 'clip:1', rendered);
  check('the duration came from the scene window, not from the model',
        rendered.hyperFrame.durationSec === SECONDS, rendered.hyperFrame);
  check('and the scene records that it is ready',
        rendered.hyperFrame.status === 'ready' && rendered.status === 'done', rendered);

  // ── Assemble and export, through the untouched compositor ───────────────
  console.log('\n=== assembling and exporting ===');
  const film = await page.evaluate(async (secs, accent) => {
    window.AetherRouter.switchWorkspace('video');
    const btn = document.getElementById('ed-assemble');
    if (!btn) return { error: 'no assemble button' };
    btn.click();
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const st = window.BlvckEditorTiming._getState();
      if (st && st.clips && st.clips.length) break;
    }
    const st = window.BlvckEditorTiming._getState();
    const clip = st && st.clips && st.clips[0];
    if (!clip) return { error: 'nothing assembled' };

    const realCreate = URL.createObjectURL.bind(URL);
    let captured = null;
    URL.createObjectURL = (blob) => {
      if (blob && /video\/webm/.test(blob.type || '')) captured = blob;
      return realCreate(blob);
    };
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { /* no download in a test */ };

    const ex = document.getElementById('ed-export-video');
    ex.click();
    for (let i = 0; i < 240 && !captured; i++) await new Promise((r) => setTimeout(r, 500));
    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
    if (!captured) return { error: 'no file was produced',
                            status: (document.getElementById('ed-status') || {}).textContent || '' };

    const url = realCreate(captured);
    const v = document.createElement('video');
    v.muted = true; v.src = url;
    const ok = await new Promise((res) => {
      v.onloadeddata = () => res(true); v.onerror = () => res(false);
      setTimeout(() => res(v.readyState >= 2), 25000);
    });
    if (!ok) return { error: 'the exported file would not decode', bytes: captured.size };

    const sampleAt = async (t) => {
      await new Promise((res) => {
        v.onseeked = () => res();
        try { v.currentTime = t; } catch (e) { res(); }
        setTimeout(res, 8000);
      });
      const c = document.createElement('canvas');
      c.width = 640; c.height = 360;
      const g = c.getContext('2d');
      g.drawImage(v, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let accentPx = 0, bright = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 4) {
        n++;
        const r = d[i], gn = d[i + 1], b = d[i + 2];
        // The composition's own accent, within codec tolerance.
        if (Math.abs(r - accent.r) < 46 && Math.abs(gn - accent.g) < 46 && Math.abs(b - accent.b) < 46) accentPx++;
        if ((r + gn + b) / 3 > 200) bright++;
      }
      return { t, accentPx, bright, n, frame: c.toDataURL('image/png') };
    };

    return { ok: true, bytes: captured.size, duration: Math.round(v.duration * 100) / 100,
             w: v.videoWidth, h: v.videoHeight,
             mid: await sampleAt(Math.min(secs - 0.6, secs * 0.7)),
             status: (document.getElementById('ed-status') || {}).textContent || '' };
  }, SECONDS, ACCENT);

  if (film.error) {
    check('the export produced a file', false, film.error);
    if (film.status) console.log(`  status said: "${film.status}"`);
  } else {
    console.log(`  ${(film.bytes / 1024).toFixed(0)}KB · ${film.duration}s · ${film.w}x${film.h}`);
    console.log(`  at t=${film.mid.t}s: ${film.mid.accentPx} accent px, ${film.mid.bright} bright px `
      + `of ${film.mid.n} sampled`);

    fs.writeFileSync(path.join(PROJECT, 'tests', 'live', 'hyperframe_phase1_frame.png'),
      Buffer.from(film.mid.frame.split(',')[1], 'base64'));
    delete film.mid.frame;

    check('a finished file came out', film.bytes > 0, film.bytes);
    check('it decodes as 1280x720 video', film.w === 1280 && film.h === 720, film);
    check('its duration matches the scene window',
          Math.abs(film.duration - SECONDS) <= 1.2, { got: film.duration, want: SECONDS });

    // The claim: the composition's pixels are in the exported file.
    check('THE HYPERFRAME IS IN THE EXPORT — its accent appears in the decoded frames',
          film.mid.accentPx > 200, film.mid);
    check('and its typography with it', film.mid.bright > 100, film.mid);
  }

  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(),
    seconds: SECONDS, accent: ACCENT, rendered, film }, null, 2));

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'A SCENE MADE OF CODE REACHED THE EXPORTED VIDEO'));
  console.log(`  written to ${path.relative(PROJECT, OUT)}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
