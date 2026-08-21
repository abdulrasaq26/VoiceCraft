// What BlvckGraphic's full-frame renderers do TODAY, pinned before a panel
// mode is added beside them.
//
// These are shared. storyboard.js renders chart/map/timeline/checklist beats
// through them, ltx-video.js draws canvas beats with them, scene-compositor and
// the editor's fallback card both call render(). The Renderer stage needs a
// chart that sits OVER footage, and the safe way to get one is to add a
// contained mode next to the full-frame behaviour rather than to reshape code
// four callers already depend on.
//
// So this records what render() guarantees now:
//   * an opaque card that fills the frame - which is why it REPLACES footage
//   * a refusal when a data card has no data
//   * one exception, the map, which can draw from a place name alone
//   * a distinct picture per kind
//
// Every assertion here must keep passing once panel mode exists.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

// One spec per kind, each carrying the content that kind needs.
const SPECS = [
  { kind: 'chart',     title: 'Revenue', items: ['2019: 20', '2021: 28', '2023: 35'] },
  { kind: 'timeline',  title: 'The rollout', items: ['1940 begins', '1943 peak', '1945 ends'] },
  { kind: 'checklist', title: 'Three steps', items: ['Measure', 'Cut', 'Fit'] },
  { kind: 'stat',      title: 'switch brands', value: '40%' },
  { kind: 'title',     title: 'A plain card' }
];

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 180000,
    args: ['--window-size=1200,800']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  await page.evaluate(() => {
    // Decode a rendered blob and describe it: size, opacity, and a coarse
    // fingerprint so two kinds can be told apart without asserting on pixels
    // that are free to change.
    window.__describe = async (blob) => {
      const url = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.src = url;
        await img.decode();
        const c = document.createElement('canvas');
        c.width = img.naturalWidth; c.height = img.naturalHeight;
        const g = c.getContext('2d');
        g.drawImage(img, 0, 0);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let opaque = 0, lit = 0, sum = 0, n = 0;
        for (let i = 0; i < d.length; i += 4 * 16) {
          if (d[i + 3] === 255) opaque++;
          const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
          if (v > 40) lit++;
          sum += v; n++;
        }
        return { bytes: blob.size, type: blob.type,
                 w: img.naturalWidth, h: img.naturalHeight,
                 sampled: n, opaque, lit, meanLuma: Math.round(sum / n) };
      } finally { URL.revokeObjectURL(url); }
    };
  });

  // ── Every kind renders, and fills the frame ──────────────────────────────
  console.log('=== what each kind renders ===');
  const drawn = [];
  for (const spec of SPECS) {
    const r = await page.evaluate(async (s) => {
      try {
        const blob = await window.BlvckGraphic.render(s);
        return await window.__describe(blob);
      } catch (e) { return { error: e.message }; }
    }, spec);
    drawn.push({ kind: spec.kind, ...r });
    if (r.error) { console.log(`  ${spec.kind.padEnd(10)} ERROR ${r.error}`); continue; }
    console.log(`  ${spec.kind.padEnd(10)} ${String(r.w)}x${r.h}  ${(r.bytes / 1024).toFixed(0)}KB  `
      + `mean luma ${String(r.meanLuma).padStart(3)}  lit ${r.lit}/${r.sampled}`);
  }

  check('every kind renders without throwing', drawn.every((d) => !d.error),
        drawn.filter((d) => d.error));
  check('every card is 1280x720', drawn.every((d) => d.w === 1280 && d.h === 720),
        drawn.map((d) => `${d.kind} ${d.w}x${d.h}`));
  check('every card is fully opaque — which is why it replaces footage',
        drawn.every((d) => d.opaque === d.sampled),
        drawn.map((d) => `${d.kind} ${d.opaque}/${d.sampled}`));
  check('every card actually draws something', drawn.every((d) => d.lit > 0),
        drawn.map((d) => `${d.kind} lit ${d.lit}`));
  check('the kinds are visually distinct',
        new Set(drawn.map((d) => d.meanLuma + ':' + d.lit)).size === drawn.length,
        drawn.map((d) => `${d.kind} ${d.meanLuma}/${d.lit}`));

  // ── A data card with no data is refused ──────────────────────────────────
  console.log('\n=== a data card with no data ===');
  const refusals = await page.evaluate(async () => {
    const out = {};
    for (const kind of ['chart', 'timeline', 'checklist', 'whiteboard']) {
      try {
        await window.BlvckGraphic.render({ kind, title: 'No items supplied' });
        out[kind] = 'RENDERED';
      } catch (e) { out[kind] = e.message; }
    }
    return out;
  });
  for (const [k, v] of Object.entries(refusals)) console.log(`  ${k.padEnd(11)} ${String(v).slice(0, 66)}`);
  check('an empty data card is refused rather than stored',
        Object.values(refusals).every((v) => v !== 'RENDERED'), refusals);
  check('and the refusal says what is missing',
        Object.values(refusals).every((v) => /items/i.test(String(v))), refusals);

  // ── The map exception ────────────────────────────────────────────────────
  console.log('\n=== the map, which may draw from a place name ===');
  const mapCase = await page.evaluate(async () => {
    const geoLoaded = !!(window.BlvckGeo && window.BlvckGeo.isLoaded && window.BlvckGeo.isLoaded());
    let named = null, bare = null;
    try {
      const b = await window.BlvckGraphic.render({ kind: 'map', title: 'Across France and Germany' });
      named = await window.__describe(b);
    } catch (e) { named = { error: e.message }; }
    try {
      await window.BlvckGraphic.render({ kind: 'map', title: '' });
      bare = 'RENDERED';
    } catch (e) { bare = e.message; }
    return { geoLoaded, named, bare };
  });
  console.log(`  BlvckGeo loaded: ${mapCase.geoLoaded}`);
  console.log(`  named places  : ${mapCase.named.error ? 'refused — ' + mapCase.named.error.slice(0, 50) : 'rendered'}`);
  console.log(`  no title      : ${String(mapCase.bare).slice(0, 60)}`);
  check('a map with no title and no items is refused', mapCase.bare !== 'RENDERED', mapCase.bare);
  // Whether the named case renders depends on the geography data being loaded;
  // recorded rather than asserted, because that is an environment fact.
  console.log(`  (the named case is recorded, not asserted — it depends on BlvckGeo)`);

  // ── What the storyboard depends on ───────────────────────────────────────
  console.log('\n=== the storyboard helpers ===');
  const helpers = await page.evaluate(() => {
    const G = window.BlvckGraphic;
    return {
      hasLooksLike: typeof G.looksLikeGraphic === 'function',
      hasPalette: typeof G.paletteFor === 'function',
      hasComposite: typeof G.compositeOverlay === 'function',
      stage: G.OVERLAY_STAGE,
      // Two independent routes to the canvas, and they are not the same test.
      // rendersOnCanvas reads the Director's visualType; looksLikeGraphic is
      // the secondary heuristic for a scene the storyboard model gave a graphic
      // spec of its own. An earlier version of this test assumed
      // looksLikeGraphic read visualType and reported a bug that was not one.
      byVisualType: !!(window.BlvckLTX && window.BlvckLTX.rendersOnCanvas
                       && window.BlvckLTX.rendersOnCanvas({ visualType: 'chart' })),
      stockByVisualType: !!(window.BlvckLTX && window.BlvckLTX.rendersOnCanvas
                            && window.BlvckLTX.rendersOnCanvas({ visualType: 'stock_video' })),
      bySpec: G.looksLikeGraphic({ graphic: { title: 'x' } }),
      bySceneType: G.looksLikeGraphic({ sceneType: 'graphic' }),
      bareChart: G.looksLikeGraphic({ visualType: 'chart' }),
      stockIsNot: G.looksLikeGraphic({ visualType: 'stock_video' })
    };
  });
  console.log(`  ${JSON.stringify(helpers)}`);
  check('rendersOnCanvas routes a chart beat to the canvas', helpers.byVisualType === true, helpers);
  check('and leaves stock footage to the acquisition path', helpers.stockByVisualType === false, helpers);
  check('looksLikeGraphic catches a scene carrying its own graphic spec', helpers.bySpec === true, helpers);
  check('and one typed as a graphic scene', helpers.bySceneType === true, helpers);
  check('but it deliberately does NOT read visualType', helpers.bareChart === false,
        "that is the job of rendersOnCanvas; the two are separate on purpose");
  check('and it leaves stock footage alone', helpers.stockIsNot === false, helpers);
  check('the overlay stage is still 1280x720',
        helpers.stage && helpers.stage.w === 1280 && helpers.stage.h === 720, helpers.stage);
  check('compositeOverlay is still available for stock_text beats', helpers.hasComposite === true, helpers);

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'THE FULL-FRAME RENDERERS BEHAVE AS CHARACTERISED'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
