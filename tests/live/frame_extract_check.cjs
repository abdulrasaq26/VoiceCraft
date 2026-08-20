// Can we get real frames out of a Pixabay clip, and what does it cost?
//
// 19 of the 20 candidates across the five N=4 shortlists are Pixabay, which
// publishes exactly one frame per clip. So multi-frame evaluation is not a
// frame-SELECTION problem for this provider mix - it is a video-DECODING
// problem, and nothing in the project decodes video today. archive-excerpt.js
// looks like it might, but it reads archive.org's published thumbnail strip
// (files of format "thumbnail" carrying a timestamp in the name); it never
// touches a video element.
//
// So this measures the cost before any of it is committed to: download, decode,
// seek and capture, against the real CDN. No model calls at all.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'frame_extract_v1.json');

// Temporal coverage, not the first N. A clip's opening frame is the least
// representative moment it has.
const POSITIONS = {
  1: [0.5],
  2: [0.1, 0.9],
  3: [0.1, 0.5, 0.9],
  5: [0.1, 0.3, 0.5, 0.7, 0.9]
};

(async () => {
  const baseline = JSON.parse(fs.readFileSync(
    path.join(PROJECT, 'tests', 'live', 'baseline_five_beats.json'), 'utf8'));

  // The beat-5 shortlist: the primary action test, and all Pixabay.
  const beat5 = baseline.results.find((r) => r.beat.id === 5);
  const shortlist = beat5.candidates.filter((c) => c.metadataRank <= 4);
  console.log('beat 5 shortlist, all Pixabay, one published frame each:');
  for (const c of shortlist) console.log(`  #${c.metadataRank} ${c.id}`);

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 300000,
    args: ['--window-size=1200,800', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message.slice(0, 110)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  // Rebuild the asset so previewVideoUrl is present - the baseline artifact
  // recorded the frame URL but not the mp4.
  const px = (fs.readFileSync(PROJECT + '/.env', 'utf8').match(/^PIXABAY_API_KEY=(.*)$/m) || [])[1].trim();
  await page.evaluate((k) => localStorage.setItem('blvck:keys_pixabay', JSON.stringify([k])), px);
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  const report = await page.evaluate(async (queries, wanted, positions) => {
    const S = window.StockMedia;
    const pool = await S.search({ queries, orientation: 'landscape', mediaType: 'video',
                                  minimumDuration: 3, provider: 'pixabay' });
    const byId = new Map(pool.map((a) => [`${a.provider}:${a.id}`, a]));

    /**
     * Decode a clip and capture frames at fractions of its duration.
     *
     * Deliberately written here rather than in the app: nothing is committed to
     * production until the experiment says multi-frame is worth its cost.
     */
    async function grab(url, fractions) {
      const started = Date.now();
      const v = document.createElement('video');
      v.muted = true; v.playsInline = true; v.crossOrigin = 'anonymous';
      v.preload = 'auto';
      v.src = url;
      const ready = await new Promise((res) => {
        const done = (ok) => res(ok);
        v.onloadeddata = () => done(true);
        v.onerror = () => done(false);
        setTimeout(() => done(v.readyState >= 2), 30000);
      });
      if (!ready || !v.duration || !v.videoWidth) {
        return { ok: false, why: 'would not decode', ms: Date.now() - started };
      }
      const loadedMs = Date.now() - started;
      const out = [];
      for (const f of fractions) {
        const t = Math.max(0.05, Math.min(v.duration * f, v.duration - 0.05));
        const seeked = await new Promise((res) => {
          const done = () => { v.onseeked = null; res(true); };
          v.onseeked = done;
          try { v.currentTime = t; } catch (e) { res(false); }
          setTimeout(() => res(v.readyState >= 2), 8000);
        });
        if (!seeked) continue;
        const c = document.createElement('canvas');
        const scale = Math.min(1, 640 / v.videoWidth);
        c.width = Math.round(v.videoWidth * scale);
        c.height = Math.round(v.videoHeight * scale);
        try {
          c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
          const data = c.toDataURL('image/jpeg', 0.7);
          out.push({ at: Math.round(t * 100) / 100, fraction: f, bytes: data.length });
        } catch (e) {
          return { ok: false, why: 'canvas tainted: ' + e.message, ms: Date.now() - started };
        }
      }
      return { ok: true, duration: Math.round(v.duration * 100) / 100,
               w: v.videoWidth, h: v.videoHeight, loadedMs,
               totalMs: Date.now() - started, frames: out };
    }

    const rows = [];
    for (const id of wanted) {
      const a = byId.get(id);
      if (!a) { rows.push({ id, ok: false, why: 'not in this pool' }); continue; }
      const r = await grab(a.previewVideoUrl, positions);
      rows.push(Object.assign({ id, mp4: a.previewVideoUrl }, r));
    }
    return rows;
  }, beat5.beat.queries, shortlist.map((c) => c.id), POSITIONS[5]);

  console.log('\nframe extraction, five temporal positions per clip:');
  let okCount = 0;
  for (const r of report) {
    if (!r.ok) { console.log(`  ${r.id.padEnd(18)} FAILED — ${r.why}`); continue; }
    okCount++;
    console.log(`  ${r.id.padEnd(18)} ${r.duration}s ${r.w}x${r.h}  `
      + `load ${r.loadedMs}ms  total ${r.totalMs}ms  frames at `
      + r.frames.map((f) => f.at + 's').join(', '));
    console.log(`  ${''.padEnd(18)} ~${Math.round(r.frames.reduce((a, f) => a + f.bytes, 0) / 1024)}KB of base64 for 5 frames`);
  }
  console.log(`\n  ${okCount}/${report.length} clips decoded`);

  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), positions: POSITIONS,
                                         results: report }, null, 2));
  console.log(`  written to ${path.relative(PROJECT, OUT)}`);
  await browser.close();
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
