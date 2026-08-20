// A stalled shot holds its picture instead of flashing a fault card.
//
// The reported failure: during preview the frame strobed between the footage
// and a red "Visual unavailable — scene 4" card, on a scene whose thumbnail
// plainly showed the footage existed.
//
// A footage beat has no still written for it, and preparedFrame is only
// captured by the export preparation pass — never during preview. So every
// rendered frame where the decoder was momentarily not ready fell straight
// through to drawUnavailable, and any frame where it was ready drew the shot.
// At 30fps that alternation is a strobe.
//
// The test drives renderTo directly with a clip whose video is deliberately not
// drawable, because reproducing a decoder stall on demand is not something a
// browser will do for you. What it asserts is what the viewer sees.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

// Draw one frame with the given clip state and report what dominates it.
const SAMPLE = () => {
  window.__sample = (clip) => {
    const T = window.BlvckEditorTiming;
    const stalled = document.createElement('video');   // no src: readyState 0
    const built = Object.assign({
      sceneIndex: 4, subtitle: '', camera: '', durationSec: 6, effect: 'zoom-in',
      video: stalled, timelineStart: null, timelineEnd: null
    }, clip);
    if (built.heldColour) {
      const c = document.createElement('canvas');
      c.width = 320; c.height = 180;
      const g = c.getContext('2d');
      g.fillStyle = built.heldColour;
      g.fillRect(0, 0, c.width, c.height);
      built.heldFrame = c;
    }
    T._setState({ clips: [built], timingSource: 'estimated',
                  audio: { buffers: [], offsets: [], totalMs: 6000 } });

    const out = document.createElement('canvas');
    out.width = 640; out.height = 360;
    const g2 = out.getContext('2d');
    T.renderTo(g2, out.width, out.height, 1000);
    const d = g2.getImageData(0, 0, out.width, out.height).data;
    let green = 0, marker = 0, red = 0, other = 0;
    for (let i = 0; i < d.length; i += 4 * 16) {
      const r = d[i], gg = d[i + 1], b = d[i + 2];
      if (gg > 120 && r < 110 && b < 110) green++;
      else if (r > 30 && r < 60 && gg < 40 && b < 40) marker++;   // #2a1416 ground
      else if (r > 180 && gg < 90 && b < 90) red++;               // marker text
      else other++;
    }
    return { green, marker, red, other, fallbackUsed: built.fallbackUsed };
  };
};

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 180000,
    args: ['--window-size=1400,950']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 120)); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((s) => eval('(' + s + ')()'), SAMPLE.toString());

  // ── A stall with a held frame shows the shot ──────────────────────────────
  console.log('\n=== the shot stalls, and it has been seen before ===');
  const held = await page.evaluate(() => window.__sample({ heldColour: '#00c800' }));
  console.log(`  footage px ${held.green} · marker px ${held.marker + held.red} · via "${held.fallbackUsed}"`);
  check('the picture is held, not replaced by a card', held.green > 0, held);
  check('and the fault marker is not drawn at all', held.marker + held.red === 0, held);
  check('the render says which fallback it used', held.fallbackUsed === 'held frame', held.fallbackUsed);

  // ── With nothing ever seen, the marker is still correct ───────────────────
  console.log('\n=== the shot has never been drawable ===');
  const none = await page.evaluate(() => window.__sample({}));
  console.log(`  footage px ${none.green} · marker px ${none.marker + none.red} · via "${none.fallbackUsed}"`);
  check('a shot with nothing to show still says so', none.marker + none.red > 0, none);
  check('and is reported as the marker', none.fallbackUsed === 'marker', none.fallbackUsed);

  // ── The held frame is preferred over an unrelated still ───────────────────
  console.log('\n=== a still exists too ===');
  const both = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 180;
    const g = c.getContext('2d');
    g.fillStyle = '#0000ff';                    // a blue still, from elsewhere
    g.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.src = c.toDataURL();
    await img.decode();
    return window.__sample({ heldColour: '#00c800', img });
  });
  console.log(`  footage px ${both.green} · via "${both.fallbackUsed}"`);
  check('this shot\'s own frame beats a still from elsewhere',
        both.green > 0 && both.fallbackUsed === 'held frame', both);

  // ── Replace retires the footage it replaces ───────────────────────────────
  console.log('\n=== the shot is replaced by hand ===');
  const replaced = await page.evaluate(async () => {
    const r = await fetch('/editor.js');
    const text = await r.text();
    const at = text.indexOf('function replaceImage');
    const body = text.slice(at, at + 1400);
    return {
      clearsVideo: /clip\.video\s*=\s*null/.test(body),
      clearsHeld: /clip\.heldFrame\s*=\s*null/.test(body),
      clearsPrepared: /clip\.preparedFrame\s*=\s*null/.test(body)
    };
  });
  check('Replace retires the old footage', replaced.clearsVideo, replaced);
  check('and every frame copied from it', replaced.clearsHeld && replaced.clearsPrepared, replaced);

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));

  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'A STALL HOLDS THE PICTURE'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
