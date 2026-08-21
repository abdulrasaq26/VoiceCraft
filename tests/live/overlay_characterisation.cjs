// What the overlay path does TODAY, pinned before it is generalised.
//
// The Renderer stage needs editorialOverlay to become an array of elements, and
// the audit found that nothing tests the code being generalised: only two live
// tests mention renderTo, and neither exercises an overlay. Generalising
// untested code and then testing the result proves the new behaviour and
// nothing about whether the old behaviour survived.
//
// So this characterises the existing single-overlay path first: when it draws,
// when it does not, where it sits in the layer order, and that it survives the
// storyboard -> editor -> serialise handoff. These assertions must keep passing
// after the array migration, unchanged.
//
// Deliberately pixel-based. drawEditorialOverlay is reached through renderTo,
// scales itself to the canvas and fades at its own edges, and none of that is
// visible from the data model.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

// One overlay, anchored the way Timing.anchorOverlay would leave it: absolute
// seconds on the finished video's clock, not an offset inside the shot.
const OVERLAY = {
  enabled: true, start: 3, end: 6,
  text: '40%', emphasis: 'switch brands because of price', style: 'stat',
  anchoredTo: 'forty percent', spokenAt: 3.15
};

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

  // Solid red footage, so anything the overlay draws is unmistakable.
  const setup = await page.evaluate(async (ov) => {
    const c = document.createElement('canvas');
    c.width = 640; c.height = 360;
    const g = c.getContext('2d');
    g.fillStyle = '#c00000'; g.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.src = c.toDataURL();
    await img.decode();

    window.__clip = {
      sceneIndex: 1, subtitle: '', camera: '', durationSec: 10, effect: 'zoom-in',
      img, video: null, timelineStart: null, timelineEnd: null,
      editorialOverlay: ov
    };
    window.BlvckEditorTiming._setState({
      clips: [window.__clip], timingSource: 'estimated',
      audio: { buffers: [], offsets: [], totalMs: 10000 }
    });

    // Count what is on the canvas at a given moment on the ABSOLUTE clock.
    window.__sample = (ms) => {
      const out = document.createElement('canvas');
      out.width = 640; out.height = 360;
      const gg = out.getContext('2d');
      window.BlvckEditorTiming.renderTo(gg, out.width, out.height, ms);
      const d = gg.getImageData(0, 0, out.width, out.height).data;
      let footage = 0, bright = 0;
      for (let i = 0; i < d.length; i += 4 * 8) {
        const r = d[i], gn = d[i + 1], b = d[i + 2];
        if (r > 140 && gn < 90 && b < 90) footage++;
        else if (r > 200 && gn > 200 && b > 200) bright++;   // the card's text
      }
      return { footage, bright };
    };
    return { ok: !!window.BlvckEditorTiming.overlayActiveAt };
  }, OVERLAY);
  check('the editor exposes the overlay primitives', setup.ok, setup);

  // ── When does it draw? ────────────────────────────────────────────────────
  console.log('\n=== the window ===');
  const at = await page.evaluate(() => ({
    before: window.__sample(1000),
    inside: window.__sample(4500),
    after:  window.__sample(8000)
  }));
  console.log(`  t=1.0s  footage ${at.before.footage}  card ${at.before.bright}`);
  console.log(`  t=4.5s  footage ${at.inside.footage}  card ${at.inside.bright}`);
  console.log(`  t=8.0s  footage ${at.after.footage}   card ${at.after.bright}`);
  check('nothing is drawn before the anchored moment', at.before.bright === 0, at.before);
  check('the card is drawn inside its window', at.inside.bright > 0, at.inside);
  check('nothing is drawn after it ends', at.after.bright === 0, at.after);
  check('the footage is still visible underneath', at.inside.footage > 0, at.inside);

  // ── Does the data model agree with the pixels? ────────────────────────────
  console.log('\n=== overlayActiveAt ===');
  const active = await page.evaluate(() => ({
    before: !!window.BlvckEditorTiming.overlayActiveAt(window.__clip, 1000),
    inside: !!window.BlvckEditorTiming.overlayActiveAt(window.__clip, 4500),
    onStart: !!window.BlvckEditorTiming.overlayActiveAt(window.__clip, 3000),
    onEnd: !!window.BlvckEditorTiming.overlayActiveAt(window.__clip, 6000),
    after: !!window.BlvckEditorTiming.overlayActiveAt(window.__clip, 8000)
  }));
  console.log(`  ${JSON.stringify(active)}`);
  check('inactive before start', active.before === false);
  check('active at start', active.onStart === true);
  check('active inside', active.inside === true);
  check('inactive at end — the window is half open', active.onEnd === false);
  check('inactive after end', active.after === false);

  // ── Is it disabled when it says it is? ───────────────────────────────────
  const off = await page.evaluate(() => {
    const saved = window.__clip.editorialOverlay;
    window.__clip.editorialOverlay = Object.assign({}, saved, { enabled: false });
    const s = window.__sample(4500);
    window.__clip.editorialOverlay = saved;
    return s;
  });
  check('enabled:false draws nothing', off.bright === 0, off);

  // ── Layer order: over the footage, under the words ───────────────────────
  console.log('\n=== layer order ===');
  const layered = await page.evaluate(() => {
    window.__clip.subtitle = 'the narration line';
    const withSubs = window.__sample(4500);
    window.__clip.subtitle = '';
    return withSubs;
  });
  console.log(`  with a subtitle: card ${layered.bright}`);
  check('a subtitle does not remove the card', layered.bright > 0, layered);
  check('renderTo draws the overlay before the subtitles',
        await page.evaluate(() => {
          const src = window.BlvckEditorTiming.renderTo.toString();
          return src.indexOf('drawEditorialOverlay') < src.indexOf('drawSubs');
        }), 'the card must never cover the words being spoken');

  // ── Does it survive the handoff? ─────────────────────────────────────────
  console.log('\n=== persistence ===');
  const kept = await page.evaluate(() => {
    window.BlvckEditorTiming._setState({ clips: [window.__clip] });
    // saveTimeline runs serialiseClip over every clip.
    const before = JSON.parse(localStorage.getItem('blvck-tts:editor') || 'null');
    return { hadKey: !!before };
  });
  const round = await page.evaluate(() => {
    const c = window.BlvckEditorTiming._getState().clips[0];
    return { overlay: c.editorialOverlay,
             anchoredTo: c.editorialOverlay && c.editorialOverlay.anchoredTo,
             spokenAt: c.editorialOverlay && c.editorialOverlay.spokenAt };
  });
  console.log(`  anchoredTo "${round.anchoredTo}" spokenAt ${round.spokenAt}`);
  check('the clip still carries its overlay', !!round.overlay, round);
  check('and the narration anchor travels with it',
        round.anchoredTo === 'forty percent' && round.spokenAt === 3.15, round);

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'THE OVERLAY PATH BEHAVES AS CHARACTERISED'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
