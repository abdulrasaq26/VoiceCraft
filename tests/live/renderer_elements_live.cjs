// A scene can carry several renderer elements, and old scenes still work.
//
// The companion to overlay_characterisation.cjs. That one pins what the single
// editorialOverlay did; this one proves the list added on top of it does what
// the Renderer stage needs - several elements in one beat, layered in plan
// order - without the old shape losing anything.
//
// The compatibility half matters as much as the capability half. A project
// saved before the Renderer existed has editorialOverlay and no array, and it
// has to open, draw and export exactly as it did.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

// Two elements sharing a beat, with windows that overlap in the middle: a
// statistic anchored to the words that say it, and a lower third that outlives
// it. Between 3 and 4 seconds both are on screen.
const STAT  = { enabled: true, start: 2, end: 4, text: '40%',
                emphasis: 'switch brands', style: 'stat',
                anchoredTo: 'forty percent', spokenAt: 2.1 };
const LOWER = { enabled: true, start: 3, end: 6, text: 'Consumer Insights 2024',
                emphasis: '', style: 'headline' };

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

    window.__load = (clip) => {
      window.__clip = Object.assign({
        sceneIndex: 1, subtitle: '', camera: '', durationSec: 8, effect: 'zoom-in',
        img: window.__img, video: null, timelineStart: null, timelineEnd: null
      }, clip);
      window.BlvckEditorTiming._setState({
        clips: [window.__clip], timingSource: 'estimated',
        audio: { buffers: [], offsets: [], totalMs: 8000 }
      });
    };
    window.__ink = (ms) => {
      const out = document.createElement('canvas');
      out.width = 640; out.height = 360;
      const gg = out.getContext('2d');
      window.BlvckEditorTiming.renderTo(gg, out.width, out.height, ms);
      const d = gg.getImageData(0, 0, out.width, out.height).data;
      // Anything that is not the footage was drawn over it.
      //
      // An earlier version counted near-white pixels only, which sees the
      // statistic - 240px white text - and is blind to a lower third:
      // drawEditorialBar fills in the theme ACCENT (teal) with its text in the
      // background colour. It reported the bar drawing nothing and the bar was
      // drawing the whole time. The footage is a flat red field, so the honest
      // measure is simply how much of it is no longer visible.
      let footage = 0, card = 0;
      for (let i = 0; i < d.length; i += 4 * 8) {
        const r = d[i], gn = d[i + 1], b = d[i + 2];
        if (r > 140 && gn < 90 && b < 90) footage++;
        else card++;
      }
      return { footage, card };
    };
  });

  // ── Several elements in one beat ─────────────────────────────────────────
  console.log('\n=== two elements, overlapping windows ===');
  const many = await page.evaluate((stat, lower) => {
    window.__load({ rendererElements: [stat, lower] });
    const T = window.BlvckEditorTiming;
    return {
      counts: {
        t1: T.activeElements(window.__clip, 1000).length,
        t2_5: T.activeElements(window.__clip, 2500).length,
        t3_5: T.activeElements(window.__clip, 3500).length,
        t5: T.activeElements(window.__clip, 5000).length,
        t7: T.activeElements(window.__clip, 7000).length
      },
      ink: { t1: window.__ink(1000), t2_5: window.__ink(2500),
             t3_5: window.__ink(3500), t5: window.__ink(5000), t7: window.__ink(7000) }
    };
  }, STAT, LOWER);

  console.log(`  t=1.0s  active ${many.counts.t1}  card px ${many.ink.t1.card}`);
  console.log(`  t=2.5s  active ${many.counts.t2_5}  card px ${many.ink.t2_5.card}   (stat only)`);
  console.log(`  t=3.5s  active ${many.counts.t3_5}  card px ${many.ink.t3_5.card}   (both)`);
  console.log(`  t=5.0s  active ${many.counts.t5}  card px ${many.ink.t5.card}   (lower third only)`);
  console.log(`  t=7.0s  active ${many.counts.t7}  card px ${many.ink.t7.card}`);

  check('nothing is active before either window', many.counts.t1 === 0, many.counts);
  check('one element while only the statistic is due', many.counts.t2_5 === 1, many.counts);
  check('two elements where the windows overlap', many.counts.t3_5 === 2, many.counts);
  check('one element after the statistic ends', many.counts.t5 === 1, many.counts);
  check('nothing is active after both windows', many.counts.t7 === 0, many.counts);

  check('nothing is drawn before either window', many.ink.t1.card === 0, many.ink.t1);
  check('both elements together draw more than one alone',
        many.ink.t3_5.card > many.ink.t2_5.card,
        { both: many.ink.t3_5.card, statOnly: many.ink.t2_5.card });
  check('the footage survives underneath both', many.ink.t3_5.footage > 0, many.ink.t3_5);
  check('nothing is drawn after both windows', many.ink.t7.card === 0, many.ink.t7);

  // ── A project saved before the Renderer existed ──────────────────────────
  console.log('\n=== the old shape still works ===');
  const legacy = await page.evaluate((stat) => {
    window.__load({ editorialOverlay: stat });          // no array at all
    const T = window.BlvckEditorTiming;
    return {
      read: T.elementsOf(window.__clip).length,
      activeInside: T.activeElements(window.__clip, 2500).length,
      firstActive: !!T.overlayActiveAt(window.__clip, 2500),
      inside: window.__ink(2500), outside: window.__ink(6000)
    };
  }, STAT);
  console.log(`  read as ${legacy.read} element(s) · card px inside ${legacy.inside.card}, outside ${legacy.outside.card}`);
  check('the singular field reads as a list of one', legacy.read === 1, legacy);
  check('it is active inside its window', legacy.activeInside === 1, legacy);
  check('overlayActiveAt keeps its old contract', legacy.firstActive === true, legacy);
  check('it still draws', legacy.inside.card > 0, legacy.inside);
  check('and still stops', legacy.outside.card === 0, legacy.outside);

  // ── Which wins when a project has both ──────────────────────────────────
  console.log('\n=== a migrated project carrying both shapes ===');
  const both = await page.evaluate((stat, lower) => {
    window.__load({ editorialOverlay: stat, rendererElements: [lower] });
    const T = window.BlvckEditorTiming;
    return { read: T.elementsOf(window.__clip).length,
             text: T.elementsOf(window.__clip)[0].text };
  }, STAT, LOWER);
  console.log(`  read ${both.read} element(s), first is "${both.text}"`);
  check('the list wins over the legacy field', both.read === 1 && both.text === LOWER.text, both);

  // ── It has to survive a save ────────────────────────────────────────────
  const persisted = await page.evaluate((stat, lower) => {
    window.__load({ rendererElements: [stat, lower] });
    const c = window.BlvckEditorTiming._getState().clips[0];
    return { n: (c.rendererElements || []).length,
             anchored: c.rendererElements && c.rendererElements[0].anchoredTo };
  }, STAT, LOWER);
  check('the list survives on the clip', persisted.n === 2, persisted);
  check('with its narration anchor intact', persisted.anchored === 'forty percent', persisted);
  // Checked against the source, because a clip in memory carries the list
  // whether or not save would have written it.
  const editorSrc = fs.readFileSync(PROJECT + '/public/editor.js', 'utf8');
  check('serialiseClip persists the list',
        editorSrc.indexOf('rendererElements: c.rendererElements || null') >= 0,
        'a reopened project would otherwise lose every element');
  check('assemble carries it from the storyboard',
        editorSrc.indexOf('rendererElements: part === 0') >= 0,
        'the list has to survive the storyboard to editor handoff');

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'A BEAT CAN CARRY SEVERAL ELEMENTS, AND OLD SCENES STILL DRAW'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
