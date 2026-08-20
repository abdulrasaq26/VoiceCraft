// A clip must be shown whole, not cropped down to a strip.
//
// The reported failure: the preview showed roughly a third of the footage.
// fitFor() returned 'cover' for everything that was not archive_org, so a
// portrait stock clip was drawn 2276px tall inside a 720px frame — the viewer
// saw the middle band and nothing else.
//
// Testing this by reading fitFor's return value would prove very little, so
// this paints the source with a RED bar along its top edge and a BLUE bar along
// its bottom edge, renders through the real editor, and looks for those bars in
// the finished frame. Cropped, they are gone. Shown whole, they are there.
//
// The landscape control matters just as much: the fix must not turn ordinary
// 16:9 footage into a pillarboxed box, which would trade one bug for another.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

// Paint a clip of the given size with edge markers, store it, assemble, and
// report what the canvas ended up showing.
const SHAPES = [
  { name: 'portrait 9:16', w: 180, h: 320, wholeFrameExpected: true },
  { name: 'square 1:1',    w: 240, h: 240, wholeFrameExpected: true },
  { name: 'landscape 16:9', w: 320, h: 180, wholeFrameExpected: false }
];

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null,
    protocolTimeout: 300000,
    args: ['--window-size=1400,950', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 120)); });

  for (const shape of SHAPES) {
    await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

    await page.evaluate(async (sh) => {
      const record = () => new Promise((resolve) => {
        const c = document.createElement('canvas');
        c.width = sh.w; c.height = sh.h;
        const g = c.getContext('2d');
        const bar = Math.max(6, Math.round(sh.h * 0.08));
        const rec = new MediaRecorder(c.captureStream(30),
          { mimeType: 'video/webm', videoBitsPerSecond: 2000000 });
        const parts = [];
        rec.ondataavailable = (e) => { if (e.data && e.data.size) parts.push(e.data); };
        rec.onstop = () => resolve(new Blob(parts, { type: 'video/webm' }));
        rec.start(100);
        let n = 0;
        const tick = () => {
          g.fillStyle = '#00c800'; g.fillRect(0, 0, c.width, c.height);      // body
          g.fillStyle = '#ff0000'; g.fillRect(0, 0, c.width, bar);           // top edge
          g.fillStyle = '#0000ff'; g.fillRect(0, c.height - bar, c.width, bar); // bottom edge
          g.fillStyle = '#00b400'; g.fillRect((n++ * 3) % c.width, bar + 2, 3, 3);
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
        setTimeout(() => rec.stop(), 2000);
      });
      const clip = await record();
      await new Promise((resolve, reject) => {
        const req = indexedDB.open('blvck-storyboard', 1);
        req.onupgradeneeded = () => { try { req.result.createObjectStore('images'); } catch (e) {} };
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('images', 'readwrite');
          tx.objectStore('images').clear();
          tx.objectStore('images').put(clip, 'clip:1');
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      });
      localStorage.setItem('blvck-tts:storyboard', JSON.stringify({
        scenes: [{ index: 1, timestamp: '00:00:00 - 00:00:06', subtitle: 'A test beat.',
                   visualType: 'stock_video', status: 'done' }]
      }));
      localStorage.removeItem('blvck-tts:editor');
    }, shape);

    await page.goto(`http://localhost:${PORT}/#video`, { waitUntil: 'load', timeout: 60000 });
    await page.evaluate(() => {
      document.querySelectorAll('.workspace-page').forEach((p) => { p.hidden = true; });
      const v = document.getElementById('workspace-video');
      if (v) v.hidden = false;
      document.getElementById('ed-assemble').click();
    });
    await new Promise((r) => setTimeout(r, 6000));

    // Render deliberately, and keep asking until the footage is drawable.
    //
    // The visible canvas cannot be sampled directly here: assemble() paints one
    // frame at 0ms, and at that instant the element is often not yet ready for
    // its shot, so the editor draws its "visual unavailable" marker and - being
    // paused - never repaints. That is why the first version of this test read
    // identical pixels for three different clips: it was measuring the marker,
    // and would have reported the same numbers whatever the fix did.
    const seen = await page.evaluate(async () => {
      const scan = () => {
        const c = document.createElement('canvas');
        c.width = 1280; c.height = 720;
        const g = c.getContext('2d');
        window.BlvckEditorTiming.renderTo(g, c.width, c.height, 100);
        const d = g.getImageData(0, 0, c.width, c.height).data;
        let red = 0, blue = 0, green = 0, black = 0, marker = 0;
        for (let y = 0; y < c.height; y += 4) {
          for (let x = 0; x < c.width; x += 4) {
            const i = (y * c.width + x) * 4;
            const r = d[i], gg = d[i + 1], b = d[i + 2];
            if (r > 140 && gg < 90 && b < 90) red++;
            else if (b > 140 && r < 90 && gg < 90) blue++;
            else if (gg > 120 && r < 110 && b < 110) green++;
            else if (r < 24 && gg < 24 && b < 24) black++;
            else if (r > 30 && r < 60 && gg < 40 && b < 40) marker++;   // the marker's ground
          }
        }
        const total = red + blue + green + black || 1;
        return { red, blue, green, black, marker,
                 blackPct: Math.round((black / total) * 100),
                 videoPct: Math.round(((red + blue + green) / total) * 100) };
      };
      // The body colour is the proof the clip itself reached the canvas.
      for (let attempt = 0; attempt < 40; attempt++) {
        const r = scan();
        if (r.green > 0 && r.marker === 0) return r;
        await new Promise((res) => setTimeout(res, 250));
      }
      return scan();
    });

    console.log(`\n  ${shape.name}: red-edge=${seen.red} blue-edge=${seen.blue} `
              + `body=${seen.green} padding=${seen.blackPct}%`);

    if (shape.wholeFrameExpected) {
      check(`${shape.name} — the top of the frame is visible`, seen.red > 0, seen);
      check(`${shape.name} — the bottom of the frame is visible`, seen.blue > 0, seen);
    } else {
      check(`${shape.name} — still fills the frame, no bars`, seen.blackPct <= 2, seen);
      check(`${shape.name} — the picture is actually there`, seen.green > 0, seen);
    }
  }

  check('nothing threw during any of it', pageErrors.length === 0, pageErrors.slice(0, 4));

  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'EVERY CLIP IS SHOWN WHOLE, AND 16:9 STILL FILLS THE FRAME'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
