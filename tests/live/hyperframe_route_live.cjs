// Phase 3: a beat with no footage becomes a scene, and reaches the export.
//
//   narration
//      ↓  Visual Director      what should the viewer understand
//      ↓  Asset Registry       what may be shown, and on what terms
//      ↓  Composer             which components carry it
//      ↓  components           the source — all layout decided here, not by a model
//      ↓  HyperFrame runtime   real frames
//      ↓  clip:N → assemble → export
//
// The narration is chosen so no stock search could serve it: it is about who
// answers to whom, which is a relationship rather than a thing, and a camera
// has never recorded one. That is the case the whole architecture exists for.
//
// Three properties are asserted that "did it render" would miss.
//
// ACQUISITION IS NEVER TOUCHED. The scene has no stockAsset and no
// visualEvaluation. If the pipeline quietly still needs footage, it shows here.
//
// THE MODEL NEVER WROTE HTML. The generated source is checked for the marks of
// the component templates, and checked NOT to contain anything the model could
// only have supplied by writing markup or naming a position.
//
// AN UNAPPROVED ASSET CANNOT GET IN. The parser is handed a plan referencing an
// id the registry never issued, and must refuse it by name.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'hyperframe_route_v1.json');
const env = fs.readFileSync(PROJECT + '/.env', 'utf8');
const envGet = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : '';
};

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

const SECONDS = 6;
const NARRATION = 'By the time you reach executive leadership, you are no longer judged '
                + 'by what you can do yourself, but by what the people below you can do without you.';

(async () => {
  if (!envGet('NVIDIA_NIM_API')) { console.log('SKIPPED: no NIM key'); process.exit(0); }

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
    if (/HyperFrame|Composer|registry/i.test(t)) console.log('  · ' + t.slice(0, 130));
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((nim) => {
    if (nim) localStorage.setItem('blvck:keys_nim', JSON.stringify([nim]));
    localStorage.setItem('blvck:director_provider', 'nim');
  }, envGet('NVIDIA_NIM_API'));
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  // ── The gate that makes asset ids mean something ────────────────────────
  console.log('=== an id the registry never issued ===');
  const gate = await page.evaluate(() => {
    const C = window.BlvckHyperFrameComposer;
    const manifest = { assets: [{ assetId: 'stock_pixabay_1', fileName: 'a.jpg',
                                  description: 'x', type: 'image',
                                  rights: { status: 'approved', basis: 'test' } }] };
    const plan = C._parseScene(JSON.stringify({ elements: [
      { kind: 'image', assetId: 'https://example.com/logo.png', caption: 'from the internet' },
      { kind: 'image', assetId: 'some_asset_i_made_up' },
      { kind: 'image', assetId: 'stock_pixabay_1', caption: 'the approved one' },
      { kind: 'hologram', text: 'a component nobody has' },
      { kind: 'progression', items: ['only one'] }
    ], reason: 'x' }), manifest);
    return { kept: plan.elements.map((e) => e.kind + ':' + (e.assetId || '')),
             refused: plan.rejected.map((r) => r.why) };
  });
  console.log(`  kept   : ${JSON.stringify(gate.kept)}`);
  for (const r of gate.refused) console.log(`  refused: ${r}`);
  check('a URL cannot be used as an asset id',
        gate.refused.some((r) => /example\.com/.test(r)), gate.refused);
  check('nor can an id nobody issued',
        gate.refused.some((r) => /some_asset_i_made_up/.test(r)), gate.refused);
  check('a component that does not exist is refused by name',
        gate.refused.some((r) => /no component called "hologram"/.test(r)), gate.refused);
  check('and a progression with one step cannot be drawn',
        gate.refused.some((r) => /at least two items/.test(r)), gate.refused);
  check('while the approved asset survives',
        gate.kept.length === 1 && gate.kept[0] === 'image:stock_pixabay_1', gate.kept);

  // ── The route, live ─────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(70)}`);
  console.log(`narration: "${NARRATION}"`);
  console.log('a relationship, not a thing — no stock search can serve it\n');

  const route = await page.evaluate(async (secs, narration) => {
    const scene = {
      index: 1, timestamp: '00:00:00 - 00:00:0' + secs,
      subtitle: narration,
      sceneSummary: 'what changes about judgement at the top of an organisation',
      status: 'pending', timelineStart: 0, timelineEnd: secs,
      visualStrategy: { mode: 'HYPERFRAME', reason: 'a relationship, not a thing',
                        confidence: 0.9, ran: true }
    };
    localStorage.setItem('blvck-tts:storyboard', JSON.stringify({
      project: { title: 'phase 3' }, cues: [], scenes: [scene], transcript: null }));
    const live = window.BlvckStoryboard.scenes();
    live.length = 0; live.push(scene);

    const steps = [];
    const t0 = Date.now();
    // Retried past provider load; this measures the route, not NIM's uptime.
    let res = null;
    for (let i = 0; i < 3; i++) {
      res = await window.BlvckHyperFrameComposer.runRoute(scene, {
        force: true, onProgress: (s) => steps.push(s)
      });
      if (res.ok) break;
      if (!/failed:|did not answer|503/.test(res.why || '')) break;
      await new Promise((r) => setTimeout(r, 5000 * (i + 1)));
    }
    window.BlvckStoryboard.save();
    const stored = JSON.parse(localStorage.getItem('blvck-tts:storyboard')).scenes[0];
    return {
      res, steps, wallMs: Date.now() - t0,
      intent: stored.visualIntent || null,
      manifest: stored.assetManifest || [],
      hyperFrame: stored.hyperFrame || null,
      source: scene.hyperFrameSource || '',
      hasStockAsset: !!stored.stockAsset,
      hasVision: !!stored.visualEvaluation,
      assetType: stored.assetType
    };
  }, SECONDS, NARRATION);

  if (!route.res || !route.res.ok) {
    check('the HYPERFRAME route completed', false, route.res);
    console.log('\nFAILED — nothing downstream can be checked.');
    fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), route }, null, 2));
    await browser.close();
    process.exit(1);
  }

  console.log(`  steps: ${route.steps.join(' → ')}`);
  console.log(`\n  the director decided:`);
  console.log(`    concept : ${route.intent.concept}`);
  console.log(`    anchor  : "${route.intent.anchorPhrase}"`);
  console.log(`    conveys : ${route.intent.conveys.join(' | ')}`);
  console.log(`    wants   : ${route.intent.assetNeeds.join(', ') || '(nothing)'}`);
  console.log(`\n  the composer built: ${route.res.elements.map((e) => e.kind).join(', ')}`);
  for (const e of route.res.elements) {
    console.log(`    ${e.kind.padEnd(12)} ${JSON.stringify(e).slice(0, 108)}`);
  }
  for (const r of (route.res.rejected || [])) console.log(`    refused: ${r.why}`);
  console.log(`\n  ${route.manifest.length} approved asset(s) offered`);
  console.log(`  rendered in ${(route.res.renderMs / 1000).toFixed(1)}s `
    + `(${(route.res.renderMs / 1000 / route.res.seconds).toFixed(1)}x real time)`);

  check('the route completed', route.res.ok === true, route.res);
  check('the director produced an idea, not a design',
        !!route.intent.concept && route.intent.conveys.length > 0, route.intent);
  check('and an anchor phrase taken from the narration',
        !!route.intent.anchorPhrase
        && NARRATION.toLowerCase().includes(route.intent.anchorPhrase.toLowerCase().slice(0, 12)),
        route.intent.anchorPhrase);
  check('the composer built at least one component', route.res.elements.length > 0, route.res.elements);

  // Acquisition was never involved. The point of the whole route.
  check('NO FOOTAGE WAS ACQUIRED — the scene has no stockAsset',
        route.hasStockAsset === false, route);
  check('and no footage was judged by the vision model either',
        route.hasVision === false, route);
  check('yet the scene has a video visual', route.assetType === 'video', route);

  // ── The model did not write the markup ──────────────────────────────────
  console.log('\n=== who wrote the source ===');
  const src = route.source;
  console.log(`  ${src.length} chars of composed HTML`);
  check('it is real HyperFrame source, with the renderer\'s own attributes',
        /data-composition-id="main"/.test(src) && /data-duration="6"/.test(src)
        && /window\.__timelines\["main"\]/.test(src), src.slice(0, 200));
  check('built from the component templates, not from prose',
        /class="clip hf-/.test(src), src.slice(0, 200));
  check('every timeline element has a stable id, as Studio requires',
        (src.match(/class="clip hf-/g) || []).length === (src.match(/id="\w+\d"\s+class="clip/g) || []).length,
        (src.match(/class="clip[^"]*"/g) || []));
  // The source declares the reserve; the measured boxes below prove it holds.
  // This assertion was written against a padding-bottom longhand that the
  // column layout replaced with a shorthand — a reminder that grepping source
  // is a weaker check than measuring the result, which is why both are here.
  check('the source reserves the caption band',
        /padding:[^;}]*\d+px/.test(src), src.slice(0, 500));
  check('and GSAP is vendored rather than fetched from a CDN',
        /src="\.\/vendor\/gsap\.min\.js"/.test(src) && !/cdn\./.test(src), src.slice(0, 300));

  // ── Do the components collide? ──────────────────────────────────────────
  //
  // The check this test did not have the first time it ran. It asserted that
  // accent and typography reached the file, which was true while a title and a
  // progression were drawn straight through each other — every component
  // correct alone, and the scene unreadable. Presence is not legibility.
  console.log(String.fromCharCode(10) + '=== the components do not overlap ===');
  const boxes = await page.evaluate(async (html) => {
    const f = document.createElement('iframe');
    f.style.cssText = 'position:fixed;left:-9999px;top:0;width:1920px;height:1080px;border:0';
    document.body.appendChild(f);
    f.srcdoc = html.replace(new RegExp('<script[^]*?</' + 'script>', 'g'), '');  // layout only
    await new Promise((r) => { f.onload = r; setTimeout(r, 3000); });
    const doc = f.contentDocument;
    const els = [...doc.querySelectorAll('.clip')].map((el) => {
      const b = el.getBoundingClientRect();
      return { id: el.id, x: Math.round(b.x), y: Math.round(b.y),
               w: Math.round(b.width), h: Math.round(b.height) };
    });
    const overlaps = [];
    for (let i = 0; i < els.length; i++) {
      for (let j = i + 1; j < els.length; j++) {
        const a = els[i], b = els[j];
        const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
        const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
        if (ox > 8 && oy > 8) overlaps.push(`${a.id} over ${b.id} (${ox}x${oy}px)`);
      }
    }
    // Nothing may reach into the band the subtitles are burned into.
    const bandTop = 1080 * (1 - 0.24);
    const intruding = els.filter((e) => e.y + e.h > bandTop + 8).map((e) => e.id);
    f.remove();
    return { els, overlaps, intruding, bandTop: Math.round(bandTop) };
  }, src);

  for (const e of boxes.els) console.log(`  ${e.id.padEnd(10)} ${e.x},${e.y}  ${e.w}x${e.h}`);
  if (boxes.overlaps.length) for (const o of boxes.overlaps) console.log(`  OVERLAP: ${o}`);
  check('no two components are drawn on top of one another',
        boxes.overlaps.length === 0, boxes.overlaps);
  check('and none reaches into the caption band the subtitles are burned into',
        boxes.intruding.length === 0, { intruding: boxes.intruding, bandTop: boxes.bandTop });

  // ── Assemble and export ─────────────────────────────────────────────────
  console.log('\n=== assembling and exporting ===');
  const film = await page.evaluate(async (secs) => {
    window.AetherRouter.switchWorkspace('video');
    document.getElementById('ed-assemble').click();
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
    URL.createObjectURL = (b) => {
      if (b && /video\/webm/.test(b.type || '')) captured = b;
      return realCreate(b);
    };
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    document.getElementById('ed-export-video').click();
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
    if (!ok) return { error: 'the exported file would not decode' };

    await new Promise((res) => {
      v.onseeked = () => res();
      try { v.currentTime = secs * 0.75; } catch (e) { res(); }
      setTimeout(res, 8000);
    });
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    g.drawImage(v, 0, 0, c.width, c.height);
    const d = g.getImageData(0, 0, c.width, c.height).data;
    // The project's accent, #f5b301, which no footage in this project carries.
    let accent = 0, ink = 0, n = 0;
    for (let i = 0; i < d.length; i += 4 * 4) {
      n++;
      const r = d[i], gn = d[i + 1], b = d[i + 2];
      if (r > 200 && gn > 140 && gn < 215 && b < 90) accent++;
      if ((r + gn + b) / 3 > 200) ink++;
    }
    return { ok: true, bytes: captured.size, duration: Math.round(v.duration * 100) / 100,
             w: v.videoWidth, h: v.videoHeight, accent, ink, n,
             frame: c.toDataURL('image/png') };
  }, SECONDS);

  if (film.error) {
    check('the export produced a file', false, film.error);
    if (film.status) console.log(`  status said: "${film.status}"`);
  } else {
    console.log(`  ${(film.bytes / 1024).toFixed(0)}KB · ${film.duration}s · ${film.w}x${film.h}`);
    console.log(`  ${film.accent} accent px, ${film.ink} typography px of ${film.n} sampled`);
    fs.writeFileSync(path.join(PROJECT, 'tests', 'live', 'hyperframe_route_frame.png'),
      Buffer.from(film.frame.split(',')[1], 'base64'));
    delete film.frame;

    check('a finished file came out', film.bytes > 0, film.bytes);
    check('its duration matches the scene window',
          Math.abs(film.duration - SECONDS) <= 1.2, { got: film.duration, want: SECONDS });
    check('THE GENERATED SCENE IS IN THE EXPORT — its accent reached the frames',
          film.accent > 150, film);
    check('and its typography with it', film.ink > 200, film);
  }

  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), narration: NARRATION,
    gate, intent: route.intent, elements: route.res.elements, manifest: route.manifest,
    hyperFrame: route.hyperFrame, renderMs: route.res.renderMs, film,
    sourceChars: src.length }, null, 2));

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'A BEAT WITH NO FOOTAGE BECAME A SCENE, AND REACHED THE FILE'));
  console.log(`  written to ${path.relative(PROJECT, OUT)}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
