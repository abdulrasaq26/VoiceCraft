// Does a finished file actually come out, and does the overlay reach it?
//
// The export gate has never been verified end to end, and a lot has changed
// underneath the encoder: fitFor now returns contain for off-aspect footage,
// the held frame is new and is what the recorder sees during a stall,
// rescaleClipsToAudio meets narration-driven durations, clip-key routing
// changed which blob the editor loads, and the rights gate can refuse.
//
// The Renderer's last acceptance criterion is "the exported video contains the
// footage plus the elements at the correct timing". That cannot be claimed
// until export is known to carry ONE overlay correctly, so this measures that
// first - on the file, not on the pipeline's opinion of the file.
//
// The exported blob is captured at URL.createObjectURL, which is where
// download() turns it into a link, then decoded and sampled frame by frame.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'export_gate_v1.json');

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

// Short: the recorder runs in real time, so every second here is a second spent.
const CLIP_SECONDS = 6;
const OVERLAY = { enabled: true, start: 2, end: 4, text: '40%',
                  emphasis: 'switch brands', style: 'stat',
                  anchoredTo: 'forty percent', spokenAt: 2.1 };

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 300000,
    args: ['--window-size=1200,800', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });
  page.on('console', (m) => {
    const t = m.text();
    if (/export|Export|recorder|rights/i.test(t)) console.log('  [console] ' + t.slice(0, 140));
  });

  await page.goto(`http://localhost:${PORT}/#video`, { waitUntil: 'load', timeout: 60000 });

  console.log(`recording ${CLIP_SECONDS}s in real time…`);
  const result = await page.evaluate(async (secs, ov) => {
    // Solid red footage so anything drawn over it is unmistakable.
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    g.fillStyle = '#c00000'; g.fillRect(0, 0, c.width, c.height);
    const img = new Image();
    img.src = c.toDataURL();
    await img.decode();

    const T = window.BlvckEditorTiming;
    T._setState({
      clips: [{ sceneIndex: 1, subtitle: '', camera: '', durationSec: secs,
                effect: 'zoom-in', img, video: null,
                timelineStart: null, timelineEnd: null, editorialOverlay: ov }],
      timingSource: 'estimated',
      audio: { buffers: [], offsets: [], totalMs: secs * 1000 }
    });

    // Catch the file where download() turns it into a link.
    const realCreate = URL.createObjectURL.bind(URL);
    let captured = null;
    URL.createObjectURL = (blob) => {
      if (blob && /video\/webm/.test(blob.type || '')) captured = blob;
      return realCreate(blob);
    };
    // And stop the anchor actually navigating.
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () { /* no download in a test */ };

    const btn = document.getElementById('ed-export-video');
    if (!btn) return { error: 'no export button in the page' };
    const t0 = Date.now();
    btn.click();

    for (let i = 0; i < 240 && !captured; i++) await new Promise((r) => setTimeout(r, 500));
    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;

    if (!captured) {
      return { error: 'no file was produced',
               status: (document.getElementById('ed-status') || {}).textContent || '' };
    }

    // Decode what was actually written and look at it.
    const url = realCreate(captured);
    const v = document.createElement('video');
    v.muted = true; v.src = url;
    const ready = await new Promise((res) => {
      v.onloadeddata = () => res(true); v.onerror = () => res(false);
      setTimeout(() => res(v.readyState >= 2), 20000);
    });
    if (!ready) return { error: 'the exported file would not decode', bytes: captured.size };

    const sampleAt = async (t) => {
      await new Promise((res) => {
        v.onseeked = () => res();
        try { v.currentTime = t; } catch (e) { res(); }
        setTimeout(res, 6000);
      });
      const s = document.createElement('canvas');
      s.width = 640; s.height = 360;
      const sg = s.getContext('2d');
      sg.drawImage(v, 0, 0, s.width, s.height);
      const d = sg.getImageData(0, 0, s.width, s.height).data;
      let footage = 0, card = 0;
      for (let i = 0; i < d.length; i += 4 * 8) {
        const r = d[i], gn = d[i + 1], b = d[i + 2];
        if (r > 120 && gn < 100 && b < 100) footage++;
        else if (r > 190 && gn > 190 && b > 190) card++;
      }
      return { t, footage, card };
    };

    return {
      ok: true, bytes: captured.size, type: captured.type,
      tookMs: Date.now() - t0,
      duration: Math.round(v.duration * 100) / 100,
      w: v.videoWidth, h: v.videoHeight,
      frames: [await sampleAt(1.0), await sampleAt(3.0), await sampleAt(5.0)],
      status: (document.getElementById('ed-status') || {}).textContent || ''
    };
  }, CLIP_SECONDS, OVERLAY);

  if (result.error) {
    check('the export produced a file', false, result.error);
    if (result.status) console.log(`  status said: "${result.status}"`);
  } else {
    console.log(`\n  ${(result.bytes / 1024).toFixed(0)}KB ${result.type}`
      + `  ${result.duration}s  ${result.w}x${result.h}  in ${(result.tookMs / 1000).toFixed(1)}s`);
    console.log(`  status: "${String(result.status).slice(0, 100)}"`);
    for (const f of result.frames) {
      console.log(`   t=${f.t}s  footage ${String(f.footage).padStart(5)}  card ${f.card}`);
    }

    check('a file was produced', result.bytes > 0, result.bytes);
    check('it decodes as video', result.w > 0 && result.h > 0, result);
    check('it is 16:9 at the export height',
          result.w === 1280 && result.h === 720, { w: result.w, h: result.h });
    check('its duration matches the timeline',
          Math.abs(result.duration - CLIP_SECONDS) <= 1.2,
          { got: result.duration, want: CLIP_SECONDS });

    const [before, during, after] = result.frames;
    check('the footage is in the file', before.footage > 0, before);
    check('the overlay is NOT in the file before its window', before.card === 0, before);
    check('the overlay IS in the file inside its window', during.card > 0, during);
    check('the overlay is NOT in the file after its window', after.card === 0, after);
    check('the footage survives underneath the overlay', during.footage > 0, during);
  }

  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(),
    clipSeconds: CLIP_SECONDS, overlay: OVERLAY, result }, null, 2));

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'THE EXPORTED FILE CARRIES THE FOOTAGE AND THE OVERLAY'));
  console.log(`  written to ${path.relative(PROJECT, OUT)}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
