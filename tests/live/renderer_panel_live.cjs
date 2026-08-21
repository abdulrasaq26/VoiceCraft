// A data card can sit ON the footage instead of replacing it.
//
// The full-frame renderers are opaque by design - that is characterised, and it
// is why a chart beat replaces its clip. The Renderer needs the other shape: a
// chart occupying part of the frame while the footage keeps playing underneath.
//
// Containment is the whole claim, so it is measured by quadrant. A panel placed
// lower-right must leave the upper-left untouched; if the picture is gone
// everywhere, nothing has been gained over the full-frame card.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

const CHART = {
  enabled: true, start: 2, end: 6, kind: 'chart',
  label: 'Revenue', items: ['2019: 20', '2021: 28', '2023: 35'],
  placement: 'lower_right', animation: 'none'
};
// The old shape, which must keep working beside the new one.
const LEGACY = { enabled: true, start: 2, end: 6, text: '40%',
                 emphasis: 'switch brands', style: 'stat' };

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

  await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    g.fillStyle = '#c00000'; g.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.src = c.toDataURL();
    await img.decode();
    window.__img = img;

    window.__load = (els) => {
      window.__clip = { sceneIndex: 1, subtitle: '', camera: '', durationSec: 8,
                        effect: 'zoom-in', img: window.__img, video: null,
                        timelineStart: null, timelineEnd: null, rendererElements: els };
      window.BlvckEditorTiming._setState({
        clips: [window.__clip], timingSource: 'estimated',
        audio: { buffers: [], offsets: [], totalMs: 8000 }
      });
    };

    // Footage remaining, counted per quadrant, so containment is visible.
    window.__quads = (ms) => {
      const out = document.createElement('canvas');
      out.width = 640; out.height = 360;
      const gg = out.getContext('2d');
      window.BlvckEditorTiming.renderTo(gg, out.width, out.height, ms);
      const d = gg.getImageData(0, 0, out.width, out.height).data;
      const q = { tl: 0, tr: 0, bl: 0, br: 0 };
      const tot = { tl: 0, tr: 0, bl: 0, br: 0 };
      for (let y = 0; y < out.height; y += 4) {
        for (let x = 0; x < out.width; x += 4) {
          const i = (y * out.width + x) * 4;
          const key = (y < out.height / 2 ? 't' : 'b') + (x < out.width / 2 ? 'l' : 'r');
          tot[key]++;
          if (d[i] > 140 && d[i + 1] < 90 && d[i + 2] < 90) q[key]++;
        }
      }
      return { footage: q, total: tot };
    };
  });

  // ── A chart over footage, contained ──────────────────────────────────────
  console.log('=== chart panel, placed lower-right ===');
  const panel = await page.evaluate((chart) => {
    window.__load([chart]);
    return { off: window.__quads(1000), on: window.__quads(4000) };
  }, CHART);

  const pct = (q, t) => Math.round((q / t) * 100);
  for (const k of ['tl', 'tr', 'bl', 'br']) {
    console.log(`  ${k}  footage before ${String(pct(panel.off.footage[k], panel.off.total[k])).padStart(3)}%`
      + `   during ${String(pct(panel.on.footage[k], panel.on.total[k])).padStart(3)}%`);
  }
  check('the picture is whole before the panel is due',
        pct(panel.off.footage.tl, panel.off.total.tl) > 95
        && pct(panel.off.footage.br, panel.off.total.br) > 95, panel.off.footage);
  check('the panel covers part of the lower-right',
        pct(panel.on.footage.br, panel.on.total.br) < 70, panel.on.footage);
  check('and the upper-left is untouched — it is contained, not full-frame',
        pct(panel.on.footage.tl, panel.on.total.tl) > 95, panel.on.footage);
  check('the lower-right still shows some footage around the card',
        panel.on.footage.br > 0, panel.on.footage);

  // ── Placement actually moves it ─────────────────────────────────────────
  console.log('\n=== placement ===');
  const moved = await page.evaluate((chart) => {
    window.__load([Object.assign({}, chart, { placement: 'upper_left' })]);
    return window.__quads(4000);
  }, CHART);
  console.log(`  upper_left  tl ${pct(moved.footage.tl, moved.total.tl)}%  `
    + `br ${pct(moved.footage.br, moved.total.br)}%`);
  check('a panel placed upper-left covers the upper-left',
        pct(moved.footage.tl, moved.total.tl) < 70, moved.footage);
  check('and leaves the lower-right alone',
        pct(moved.footage.br, moved.total.br) > 95, moved.footage);

  // ── The old shape still draws beside the new one ────────────────────────
  console.log('\n=== a legacy overlay and a panel together ===');
  const mixed = await page.evaluate((chart, legacy) => {
    window.__load([legacy, chart]);
    const T = window.BlvckEditorTiming;
    return { active: T.activeElements(window.__clip, 4000).length, q: window.__quads(4000) };
  }, CHART, LEGACY);
  console.log(`  active ${mixed.active}  ·  tl ${pct(mixed.q.footage.tl, mixed.q.total.tl)}%  `
    + `br ${pct(mixed.q.footage.br, mixed.q.total.br)}%`);
  check('both elements are active', mixed.active === 2, mixed.active);
  check('the legacy stat still marks the centre',
        pct(mixed.q.footage.tl, mixed.q.total.tl) < 100, mixed.q.footage);
  check('and the panel still covers the lower-right',
        pct(mixed.q.footage.br, mixed.q.total.br) < 70, mixed.q.footage);

  // ── An honest limit ─────────────────────────────────────────────────────
  console.log('\n=== what panel mode will not do ===');
  const limits = await page.evaluate(() => {
    const G = window.BlvckGraphic;
    return { kinds: Object.keys(G.PANEL_KINDS || {}),
             mapIsPanel: !!(G.PANEL_KINDS || {}).map,
             placements: Object.keys(G.PANEL_PLACEMENTS || {}) };
  });
  console.log(`  panel kinds: ${limits.kinds.join(', ')}`);
  console.log(`  placements : ${limits.placements.join(', ')}`);
  check('chart, timeline and checklist are panel kinds',
        ['chart', 'timeline', 'checklist'].every((k) => limits.kinds.indexOf(k) >= 0), limits.kinds);
  check('a map is NOT a panel kind — renderMap awaits geography data, and a '
      + 'render loop cannot await', limits.mapIsPanel === false, limits);

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'A DATA CARD CAN SIT ON THE FOOTAGE'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
