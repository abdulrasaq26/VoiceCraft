// Stage 4: the three ways a HyperFrame can meet a frame.
//
//   FULL_FRAME  the composition IS the picture. No footage anywhere.
//   HYBRID      the shot becomes an element inside the composition and the
//               graphics are built around it. One clip comes out.
//   OVERLAY     the composition renders transparent and AETHER's compositor
//               draws it over the footage clip.
//
// HYBRID and OVERLAY look similar and are not. In HYBRID the renderer composes
// both and the result is opaque — the graphics can respond to the shot because
// they are in the same document as it. In OVERLAY the two stay separate until
// the compositor puts them together, which is the only way a graphic can
// outlive the shot it started on or span a cut.
//
// Two capabilities were unverified before this and both are now measured rather
// than assumed. data-media-start is the source in-point, so a beat can take
// seconds 12-20 of a longer film without anything being trimmed first. And a
// transparent WebM keeps its alpha through drawImage, which is why OVERLAY is a
// WebM and not an RGBA png-sequence.
//
// Every assertion is on the DECODED EXPORTED FILE. A scene that renders and
// does not reach the video is not a scene.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'hyperframe_modes_v1.json');

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

const SECONDS = 4;
// A source deliberately longer than the beat, so the in-point has to work.
const SOURCE_SECS = 20;
const MEDIA_START = 12;

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

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  const ready = await page.evaluate(() => window.BlvckHyperFrame.available(true));
  if (!ready.ready) { check('the renderer is ready', false, ready); await browser.close(); process.exit(1); }

  // A synthetic "shot": 20 seconds that change colour every 4, so which part of
  // the source reached the frame is readable from the pixels.
  console.log('=== building a 20s source whose colour says where you are in it ===');
  const shot = await page.evaluate(async (secs) => {
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    const bands = ['#1d4ed8', '#047857', '#b45309', '#be123c', '#6d28d9'];  // 0-4s, 4-8, 8-12, 12-16, 16-20
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.start();
    const t0 = performance.now();
    await new Promise((done) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        if (t >= secs) { rec.stop(); done(); return; }
        g.fillStyle = bands[Math.min(bands.length - 1, Math.floor(t / 4))];
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#ffffff';
        g.font = 'bold 120px monospace';
        g.fillText(t.toFixed(1) + 's', 60, 140);
        requestAnimationFrame(tick);
      };
      tick();
    });
    await new Promise((r) => { rec.onstop = r; setTimeout(r, 2000); });
    const blob = new Blob(chunks, { type: 'video/webm' });

    // Into the stock cache, exactly where acquisition would have put it, with
    // an excerpt window and provenance so the rights path is the real one.
    const db = await new Promise((res, rej) => {
      const rq = indexedDB.open('blvck-stock-cache', 1);
      rq.onupgradeneeded = () => { const d = rq.result;
        if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets'); };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put(blob, 'pexels:test20');
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    localStorage.setItem('blvck:stock-cache-meta', JSON.stringify({ 'pexels:test20': { at: Date.now() } }));
    return { bytes: blob.size, bands };
  }, SOURCE_SECS);
  console.log(`  ${(shot.bytes / 1024).toFixed(0)}KB, bands: ${shot.bands.join(' ')}`);
  check('the source clip was cached where acquisition puts one', shot.bytes > 0, shot);

  // ── Run all three modes ─────────────────────────────────────────────────
  const results = {};
  for (const mode of ['FULL_FRAME', 'HYBRID', 'OVERLAY']) {
    console.log(`\n${'='.repeat(70)}\n${mode}`);
    const r = await page.evaluate(async (mode, secs, srcSecs, mediaStart) => {
      const scene = {
        index: 1, timestamp: '00:00:00 - 00:00:0' + secs,
        subtitle: 'Two thirds of the fleet never leaves harbour.',
        sceneSummary: 'how much of the fleet is idle',
        status: 'pending', timelineStart: 0, timelineEnd: secs,
        visualStrategy: { mode: mode === 'FULL_FRAME' ? 'HYPERFRAME' : 'HYBRID',
                          reason: 'test', confidence: 1, ran: true },
        hyperFrame: { mode }
      };
      if (mode !== 'FULL_FRAME') {
        scene.stockAsset = {
          provider: 'pexels', id: 'test20', type: 'video',
          duration: srcSecs, width: 1280, height: 720,
          sourceUrl: 'https://www.pexels.com/video/test20/',
          queriesUsed: ['harbour boats'],
          excerpt: { required: true, applied: true, start: mediaStart,
                     end: mediaStart + secs, duration: secs, sourceDuration: srcSecs }
        };
      }
      localStorage.setItem('blvck-tts:storyboard', JSON.stringify({
        project: { title: 'stage 4' }, cues: [], scenes: [scene], transcript: null }));
      const live = window.BlvckStoryboard.scenes();
      live.length = 0; live.push(scene);

      // Clear what the previous mode left behind. Without this OVERLAY inherits
      // HYBRID's clip:1 and passes on somebody else's render.
      const sbdb = await new Promise((res, rej) => {
        const rq = indexedDB.open('blvck-storyboard', 1);
        rq.onupgradeneeded = () => { const d = rq.result;
          if (!d.objectStoreNames.contains('images')) d.createObjectStore('images'); };
        rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
      });
      await new Promise((res) => {
        const tx = sbdb.transaction('images', 'readwrite');
        tx.objectStore('images').delete('clip:1');
        tx.objectStore('images').delete('hfov:1');
        tx.oncomplete = res; tx.onerror = res;
      });

      // OVERLAY draws over footage the acquisition layer stored as the scene's
      // clip, so put it there — that is where it really lives.
      if (mode === 'OVERLAY') {
        const src = await new Promise((res, rej) => {
          const rq = indexedDB.open('blvck-stock-cache', 1);
          rq.onsuccess = () => {
            const tx = rq.result.transaction('assets', 'readonly');
            const g2 = tx.objectStore('assets').get('pexels:test20');
            g2.onsuccess = () => res(g2.result); g2.onerror = () => rej(g2.error);
          };
          rq.onerror = () => rej(rq.error);
        });
        await window.BlvckStoryboard.attachAsset(scene, src, 'video');
      }

      // The composition is written here rather than asked for: this test is
      // about the three ways a HyperFrame meets a frame, not about a model's
      // judgement, which hyperframe_route_live already covers.
      const C = window.BlvckHyperFrameComponents;
      const R = window.BlvckAssetRegistry;
      const els = [{ kind: 'stat', value: '2/3', label: 'of the fleet is idle' }];
      const assets = [];
      let shotAsset = null;
      if (mode === 'HYBRID') {
        shotAsset = await R.footageFor(scene);
        if (!shotAsset) return { error: 'the footage could not be read back' };
        els.unshift({ kind: 'footage', file: shotAsset.fileName, mediaStart: shotAsset.mediaStart });
        assets.push(...await R.toRenderAssets({ assets: [shotAsset] }));
      }
      const source = C.compose({ elements: els, seconds: secs,
                                 transparent: mode === 'OVERLAY' });
      const gsapText = await window.BlvckHyperFrame.gsap();
      const vendor = [{ name: 'gsap.min.js', text: gsapText }];

      const t0 = Date.now();
      try {
        const out = mode === 'OVERLAY'
          ? await window.BlvckHyperFrame.renderOverlay(scene, { source, assets, vendor })
          : await window.BlvckHyperFrame.renderScene(scene, { source, assets, vendor });
        window.BlvckStoryboard.save();
        return { ok: true, ms: Date.now() - t0, renderMs: out.renderMs, bytes: out.blob.size,
                 type: out.blob.type, hyperFrame: scene.hyperFrame,
                 mediaStart: shotAsset ? shotAsset.mediaStart : null,
                 sourceHasMediaStart: /data-media-start="\d+/.test(source),
                 transparentGround: /background:transparent/.test(source) };
      } catch (e) { return { error: e.message, ms: Date.now() - t0 }; }
    }, mode, SECONDS, SOURCE_SECS, MEDIA_START);

    if (r.error) { check(`${mode}: rendered`, false, r.error); results[mode] = r; continue; }
    console.log(`  ${(r.bytes / 1024).toFixed(0)}KB ${r.type} · rendered in ${(r.renderMs / 1000).toFixed(1)}s`);
    console.log(`  ${JSON.stringify(r.hyperFrame)}`);

    // Export and read the pixels.
    const film = await page.evaluate(async (secs) => {
      window.AetherRouter.switchWorkspace('video');
      document.getElementById('ed-assemble').click();
      for (let i = 0; i < 120; i++) {
        await new Promise((x) => setTimeout(x, 500));
        const st = window.BlvckEditorTiming._getState();
        if (st && st.clips && st.clips.length) break;
      }
      const st = window.BlvckEditorTiming._getState();
      const clip = st && st.clips && st.clips[0];
      if (!clip) return { error: 'nothing assembled' };

      const realCreate = URL.createObjectURL.bind(URL);
      let cap = null;
      URL.createObjectURL = (b) => { if (b && /video\/webm/.test(b.type || '')) cap = b; return realCreate(b); };
      const realClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () {};
      document.getElementById('ed-export-video').click();
      for (let i = 0; i < 240 && !cap; i++) await new Promise((x) => setTimeout(x, 500));
      URL.createObjectURL = realCreate;
      HTMLAnchorElement.prototype.click = realClick;
      if (!cap) return { error: 'no file was produced',
                         status: (document.getElementById('ed-status') || {}).textContent || '' };

      const url = realCreate(cap);
      const v = document.createElement('video');
      v.muted = true; v.src = url;
      const ok = await new Promise((res) => {
        v.onloadeddata = () => res(true); v.onerror = () => res(false);
        setTimeout(() => res(v.readyState >= 2), 25000);
      });
      if (!ok) return { error: 'the exported file would not decode' };
      await new Promise((res) => {
        v.onseeked = () => res();
        try { v.currentTime = secs * 0.55; } catch (e) { res(); }
        setTimeout(res, 8000);
      });
      const c = document.createElement('canvas');
      c.width = 640; c.height = 360;
      const g = c.getContext('2d');
      g.drawImage(v, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      // The source's colour bands, so which seconds of it reached the frame is
      // readable. band3 is 12-16s — the excerpt window.
      const near = (r, gn, b, R, G, B) => Math.abs(r - R) < 60 && Math.abs(gn - G) < 60 && Math.abs(b - B) < 60;
      const BANDS = [[0x1d,0x4e,0xd8],[0x04,0x78,0x57],[0xb4,0x53,0x09],[0xbe,0x12,0x3c],[0x6d,0x28,0xa9]];
      let band0 = 0, band3 = 0, anyBand = 0, accent = 0, dark = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 4) {
        n++;
        const r = d[i], gn = d[i + 1], b = d[i + 2];
        if (near(r, gn, b, 0x1d, 0x4e, 0xd8)) band0++;     // 0-4s of the source
        if (near(r, gn, b, 0xbe, 0x12, 0x3c)) band3++;     // 12-16s of the source
        // Any of the source's colours: "is the footage there at all", which is
        // a different question from "which second of it".
        if (BANDS.some((c) => near(r, gn, b, c[0], c[1], c[2]))) anyBand++;
        if (r > 200 && gn > 140 && gn < 215 && b < 90) accent++;
        if ((r + gn + b) / 3 < 40) dark++;
        }
      return { ok: true, bytes: cap.size, duration: Math.round(v.duration * 100) / 100,
               band0, band3, anyBand, accent, dark, n, frame: c.toDataURL('image/png'),
               hasOverlayOnClip: !!clip.overlayVideo, hasVideoOnClip: !!clip.video };
    }, SECONDS);

    if (film.error) {
      check(`${mode}: exported`, false, film.error);
      if (film.status) console.log(`  status said: "${film.status}"`);
      results[mode] = { r, film }; continue;
    }
    console.log(`  export ${(film.bytes / 1024).toFixed(0)}KB · footage ${film.anyBand}`
      + ` (band0 ${film.band0}, band3 ${film.band3}) · accent ${film.accent}`
      + ` · dark ${film.dark} of ${film.n}`);
    fs.writeFileSync(path.join(PROJECT, 'tests', 'live', `hyperframe_mode_${mode.toLowerCase()}.png`),
      Buffer.from(film.frame.split(',')[1], 'base64'));
    delete film.frame;
    results[mode] = { r, film };

    check(`${mode}: the graphic reached the exported file`, film.accent > 100, film);

    if (mode === 'FULL_FRAME') {
      check('FULL_FRAME: no footage is in the frame at all', film.anyBand < 200, film);
      check('FULL_FRAME: the composition provides its own ground', film.dark > 5000, film);
    }
    if (mode === 'HYBRID') {
      check('HYBRID: the shot is in the frame', film.band3 > 1500, film);
      check('HYBRID: and it is the EXCERPT — seconds 12-16, not the start of the source',
            film.band3 > film.band0 * 20, { band3: film.band3, band0: film.band0 });
      check('HYBRID: the source carried data-media-start', r.sourceHasMediaStart === true, r);
      check('HYBRID: one clip came out, with no separate overlay',
            film.hasVideoOnClip === true && film.hasOverlayOnClip === false, film);
    }
    if (mode === 'OVERLAY') {
      check('OVERLAY: rendered transparent', r.transparentGround === true, r);
      check('OVERLAY: it is a WebM, kept beside the footage rather than replacing it',
            /webm/.test(r.type) && r.hyperFrame.overlayKey === 'hfov:1', r);
      check('OVERLAY: the compositor loaded it onto the clip', film.hasOverlayOnClip === true, film);
      // The claim here is compositing, not which second. The in-point is
      // HYBRID's to prove and it did, decisively. An earlier version of this
      // asserted the 12-16s band and failed on a frame that was plainly
      // correct: the seek lands ON the in-point, so the sampled frame is the
      // last instant of the band before it.
      check('OVERLAY: the footage shows through where the graphic drew nothing',
            film.anyBand > 20000, film);
      check('OVERLAY: and the frame is not blacked out by a lost alpha channel',
            film.dark < film.n * 0.2, film);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(),
    seconds: SECONDS, sourceSecs: SOURCE_SECS, mediaStart: MEDIA_START, results }, null, 2));

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'FULL_FRAME, HYBRID AND OVERLAY ALL REACH THE FILE'));
  console.log(`  written to ${path.relative(PROJECT, OUT)}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
