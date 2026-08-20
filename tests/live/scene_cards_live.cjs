// The scene strip must show the footage, and the preview must fit the screen.
//
// The reported failure: the canvas played real stock footage while every card
// underneath it showed the narration as a text card. Both came from one clip.
//
// The cause is that fallbackCard() persists its placeholder into the storyboard
// still store under String(index). A project assembled once before its footage
// arrived keeps that card on disk forever; the next assemble finds the card
// under the still key and the real clip under clip:N, and renderTimeline only
// ever drew the still.
//
// So this seeds exactly that state — a GREEN video under clip:1 and a stale RED
// card under '1' — and then samples the pixel the card actually renders. A test
// that compared src strings would pass on any change at all.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null,
    protocolTimeout: 300000,
    args: ['--window-size=1400,950', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  // Collected, not just printed. Two separate bugs this session were an
  // unguarded getElementById on markup that does not exist, and in both cases
  // the thrown TypeError aborted the rest of the wiring block - so features
  // several screens away stopped working with no visible error. A page that
  // loads clean is the cheapest guard against the whole class.
  const pageErrors = [];
  page.on('pageerror', (e) => {
    pageErrors.push(e.message);
    console.log('  [pageerror] ' + e.message.slice(0, 120));
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  // ── Seed the exact broken state ────────────────────────────────────────────
  const seeded = await page.evaluate(async () => {
    const solid = (colour) => {
      const c = document.createElement('canvas');
      c.width = 320; c.height = 180;
      const g = c.getContext('2d');
      g.fillStyle = colour; g.fillRect(0, 0, c.width, c.height);
      return c;
    };
    // Record long enough, and with a timeslice, that the encoder actually emits
    // frames. A short rAF burst produces a ~100-byte container header and
    // nothing else, which decodes as no video at all — the first run of this
    // test failed on exactly that and was measuring its own seed, not the app.
    const recordGreen = () => new Promise((resolve) => {
      const c = solid('#00d000');
      const g = c.getContext('2d');
      const stream = c.captureStream(30);
      const rec = new MediaRecorder(stream, { mimeType: 'video/webm', videoBitsPerSecond: 1000000 });
      const parts = [];
      rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
      rec.onstop = () => resolve(new Blob(parts, { type: 'video/webm' }));
      rec.start(100);
      // Repaint every frame: a still canvas gives the encoder nothing to do.
      let n = 0;
      const tick = () => {
        g.fillStyle = '#00d000'; g.fillRect(0, 0, c.width, c.height);
        // A single moving pixel keeps the stream alive without changing the
        // colour the assertion samples at the centre.
        g.fillStyle = '#00c000'; g.fillRect((n * 3) % c.width, 0, 3, 3);
        n++;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      setTimeout(() => rec.stop(), 2000);
    });
    const redCard = await new Promise((r) => solid('#d00000').toBlob(r, 'image/png'));
    const greenClip = await recordGreen();

    const put = (key, blob) => new Promise((resolve, reject) => {
      const req = indexedDB.open('blvck-storyboard', 1);
      req.onupgradeneeded = () => { try { req.result.createObjectStore('images'); } catch (e) {} };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('images', 'readwrite');
        tx.objectStore('images').put(blob, key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    await put('1', redCard);          // the stale placeholder
    await put('clip:1', greenClip);   // the footage the storyboard acquired

    localStorage.setItem('blvck-tts:storyboard', JSON.stringify({
      scenes: [{ index: 1, timestamp: '00:00:00 - 00:00:06', subtitle: 'A test beat.',
                 visualType: 'stock_video', status: 'done' }]
    }));
    localStorage.removeItem('blvck-tts:editor');
    return { clipBytes: greenClip.size, cardBytes: redCard.size };
  });
  console.log(`  seeded: ${seeded.clipBytes}B of footage under clip:1, `
            + `${seeded.cardBytes}B stale card under '1'\n`);

  await page.goto(`http://localhost:${PORT}/#video`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(() => {
    document.querySelectorAll('.workspace-page').forEach((p) => { p.hidden = true; });
    const v = document.getElementById('workspace-video');
    if (v) v.hidden = false;
    document.getElementById('ed-assemble').click();
  });

  // Wait for the strip to be drawn and the poster to land.
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const n = await page.evaluate(() => document.querySelectorAll('.ed-clip img').length);
    if (n > 0) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  await new Promise((r) => setTimeout(r, 2500));

  // ── What colour is the card actually showing? ──────────────────────────────
  const card = await page.evaluate(async () => {
    const el = document.querySelector('.ed-clip img');
    if (!el) return { error: 'no scene card rendered' };
    if (!el.src) return { error: 'scene card has no image at all' };
    const img = new Image();
    img.src = el.src;
    await img.decode().catch(() => {});
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(4, 4, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2], kind: el.src.slice(0, 24) };
  });

  if (card.error) {
    check('the scene card shows something', false, card.error);
  } else {
    console.log(`  card centre pixel: rgb(${card.r}, ${card.g}, ${card.b})`);
    check('the card shows the footage, not the stale placeholder',
          card.g > 120 && card.r < 100, card);
    check('the card is not the red placeholder card', !(card.r > 120 && card.g < 100), card);
  }

  // ── And after a reload ─────────────────────────────────────────────────────
  // restoreTimeline used to recover footage only through the stock cache, keyed
  // provider:id off stockAsset. A beat with no such pair — anything the video
  // generator rendered, or acquired before that field travelled — lost its
  // footage on reload and fell back to the still key, where the stale card
  // lives. So a reopened project quietly turned its video back into text.
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await page.evaluate(() => {
    document.querySelectorAll('.workspace-page').forEach((p) => { p.hidden = true; });
    const v = document.getElementById('workspace-video');
    if (v) v.hidden = false;
  });
  await new Promise((r) => setTimeout(r, 3000));

  const afterReload = await page.evaluate(async () => {
    const el = document.querySelector('.ed-clip img');
    if (!el || !el.src) return { error: 'the timeline did not come back at all' };
    const img = new Image();
    img.src = el.src;
    await img.decode().catch(() => {});
    const c = document.createElement('canvas');
    c.width = 8; c.height = 8;
    const g = c.getContext('2d');
    g.drawImage(img, 0, 0, 8, 8);
    const d = g.getImageData(4, 4, 1, 1).data;
    return { r: d[0], g: d[1], b: d[2] };
  });
  if (afterReload.error) {
    check('the timeline survives a reload', false, afterReload.error);
  } else {
    console.log(`  after reload, card centre pixel: rgb(${afterReload.r}, ${afterReload.g}, ${afterReload.b})`);
    check('the footage survives a reload — not replaced by the placeholder',
          afterReload.g > 120 && afterReload.r < 100, afterReload);
  }

  // ── Does the preview fit on the screen? ────────────────────────────────────
  // Scroll the preview into view first. Where the canvas happens to sit depends
  // on scroll position, which is not what the fix changed; what it changed is
  // how TALL the preview is allowed to get relative to the screen.
  const fit = await page.evaluate(() => {
    const c = document.getElementById('ed-canvas');
    c.scrollIntoView({ block: 'start' });
    const r = c.getBoundingClientRect();
    const transport = document.querySelector('.ed-transport').getBoundingClientRect();
    return {
      viewport: window.innerHeight,
      canvasHeight: Math.round(r.height),
      canvasTop: Math.round(r.top),
      canvasBottom: Math.round(r.bottom),
      transportBottom: Math.round(transport.bottom),
      aspect: Math.round((r.width / r.height) * 100) / 100
    };
  });
  console.log(`  viewport ${fit.viewport}px · canvas ${fit.canvasHeight}px tall `
            + `(${fit.canvasTop}→${fit.canvasBottom}) · transport ends ${fit.transportBottom} `
            + `· aspect ${fit.aspect}`);
  check('the whole preview fits on screen once scrolled to', fit.canvasBottom <= fit.viewport,
        { canvasBottom: fit.canvasBottom, viewport: fit.viewport });
  check('the transport fits under it', fit.transportBottom <= fit.viewport,
        { transportBottom: fit.transportBottom, viewport: fit.viewport });
  check('the preview leaves room for the controls around it',
        fit.canvasHeight <= fit.viewport - 120,
        { canvasHeight: fit.canvasHeight, viewport: fit.viewport });
  check('the preview is still 16:9 — not squashed to fit', Math.abs(fit.aspect - 16 / 9) < 0.03,
        { aspect: fit.aspect });

  check('nothing threw while the page loaded and assembled', pageErrors.length === 0,
        pageErrors.slice(0, 4));

  await page.screenshot({ path: __dirname + '/scene_cards_live.png' });
  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'SCENE CARDS SHOW THE FOOTAGE, PREVIEW FITS'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
