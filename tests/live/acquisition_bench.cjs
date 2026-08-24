// Where does acquisition actually spend its time?
//
// Two runs have now overshot their budget — archive.org taking 18-35 minutes
// for ten scenes, and a single Pexels beat exceeding a three-minute budget in
// the Phase 10 acceptance run. Both were diagnosed by reading the code, which
// is how you end up optimising the wrong thing.
//
// So this measures instead. Every fetch the page makes during a real
// acquisition is recorded with its URL and its duration, and the report groups
// them by what they are: a search, a metadata round trip, a rights check, a
// download. Nothing is asserted — this is an instrument, and its output is the
// evidence any fix has to be argued from.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const WHICH = (process.argv[3] || 'modern');   // modern | archive | all
const OUT = path.join(PROJECT, 'tests', 'live', `acquisition_bench_${WHICH}.json`);
const env = fs.readFileSync(PROJECT + '/.env', 'utf8');
const envGet = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : '';
};

const BEATS = [
  { index: 1, concept: 'fishing boats coming into a harbour at dawn',
    queries: ['fishing boat harbour', 'trawler returning port', 'harbour sunrise boats'],
    fallback: ['fishing boats', 'harbour'] },
  { index: 2, concept: 'a welder working on a ship hull in a dry dock',
    queries: ['welder shipyard', 'welding sparks industrial', 'dry dock ship repair'],
    fallback: ['welding', 'shipyard'] },
  { index: 3, concept: 'empty nets drying on a quayside in the wind',
    queries: ['fishing nets quay', 'nets drying harbour', 'rope quayside'],
    fallback: ['fishing nets', 'quay'] }
];

const ms = (n) => `${(n / 1000).toFixed(2)}s`;

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 900000,
    args: ['--window-size=1300,900']
  });
  const page = (await browser.pages())[0];
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message.slice(0, 110)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((k) => {
    if (k.pexels) localStorage.setItem('blvck:pexels_key', k.pexels);
    if (k.pixabay) localStorage.setItem('blvck:pixabay_key', k.pixabay);
    if (k.nim) localStorage.setItem('blvck:keys_nim', JSON.stringify([k.nim]));
  }, { pexels: envGet('PEXELS_API_KEY'), pixabay: envGet('PIXABAY_API_KEY'),
       nim: envGet('NVIDIA_NIM_API') });
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  // ── The instrument ──────────────────────────────────────────────────────
  await page.evaluate(() => {
    window.__net = [];
    const real = window.fetch.bind(window);
    window.fetch = async (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || String(input);
      const t0 = performance.now();
      const rec = { url, at: t0, ms: null, status: null, bytes: null, failed: false };
      window.__net.push(rec);
      try {
        const res = await real(input, init);
        rec.ms = performance.now() - t0;
        rec.status = res.status;
        const len = res.headers.get('content-length');
        if (len) rec.bytes = Number(len);
        return res;
      } catch (err) {
        rec.ms = performance.now() - t0;
        rec.failed = true;
        rec.error = err.message;
        throw err;
      }
    };
  });

  const report = { at: new Date().toISOString(), provider: WHICH, beats: [] };

  for (const beat of BEATS) {
    console.log(`\n${'='.repeat(72)}\nbeat ${beat.index}: ${beat.concept}`);
    const r = await page.evaluate(async (b, which) => {
      window.__net.length = 0;
      const scene = {
        index: b.index, subtitle: b.concept, sceneSummary: b.concept,
        timestamp: '00:00:00 - 00:00:06', timelineStart: 0, timelineEnd: 6,
        visualType: 'stock_video',
        stockRequirements: {
          concept: b.concept, queries: b.queries, fallbackQueries: b.fallback,
          subject: b.concept, action: '', setting: '',
          orientation: 'landscape', minimumDuration: 4
        }
      };
      const t0 = performance.now();
      let out = { ok: false };
      try {
        const blob = await window.StockMedia.acquire(scene, { provider: which });
        out = { ok: !!(blob && blob.size), bytes: blob ? blob.size : 0,
                asset: scene.stockAsset
                  ? { provider: scene.stockAsset.provider, id: scene.stockAsset.id,
                      duration: scene.stockAsset.duration,
                      measured: scene.stockAsset.measuredDuration || null,
                      claimed: scene.stockAsset.durationClaimed || null }
                  : null };
      } catch (err) {
        out = { ok: false, error: err.message };
      }
      out.wallMs = performance.now() - t0;
      out.net = window.__net.map((n) => ({ url: n.url, ms: Math.round(n.ms),
                                           status: n.status, bytes: n.bytes,
                                           failed: n.failed, at: Math.round(n.at - t0) }));
      return out;
    }, beat, WHICH);

    // ── Group by what the request IS ──────────────────────────────────────
    const kindOf = (u) => {
      if (/\/api\/proxy\/archive|archive\.org\/advancedsearch/.test(u)) return 'archive search';
      if (/archive\.org\/metadata/.test(u)) return 'archive metadata';
      if (/archive\.org\/download|\/api\/proxy\/archive-file/.test(u)) return 'archive download';
      if (/pixabay/.test(u)) return 'pixabay search';
      if (/pexels.*\/videos\/search|api\.pexels/.test(u)) return 'pexels search';
      if (/\/api\/stock\/download|stock-download/.test(u)) return 'download (proxy)';
      if (/\.mp4|\.webm|\.mov|videos\.pexels|cdn\.pixabay/.test(u)) return 'download (direct)';
      if (/nim|integrate\.api\.nvidia/.test(u)) return 'model call';
      return 'other';
    };

    const groups = new Map();
    for (const n of r.net) {
      const k = kindOf(n.url);
      const g = groups.get(k) || { kind: k, n: 0, ms: 0, bytes: 0, failed: 0, slowest: 0 };
      g.n++; g.ms += n.ms; g.bytes += n.bytes || 0;
      if (n.failed || (n.status && n.status >= 400)) g.failed++;
      g.slowest = Math.max(g.slowest, n.ms);
      groups.set(k, g);
    }
    const rows = [...groups.values()].sort((a, b2) => b2.ms - a.ms);

    console.log(`  ${r.ok ? 'acquired' : 'FAILED'} in ${ms(r.wallMs)}`
      + (r.asset ? ` — ${r.asset.provider}:${r.asset.id}` : '')
      + (r.error ? ` — ${r.error}` : ''));
    console.log(`  ${'kind'.padEnd(20)} ${'n'.padStart(3)} ${'total'.padStart(9)} `
      + `${'slowest'.padStart(9)}  ${'MB'.padStart(6)}  failed`);
    for (const g of rows) {
      console.log(`  ${g.kind.padEnd(20)} ${String(g.n).padStart(3)} ${ms(g.ms).padStart(9)} `
        + `${ms(g.slowest).padStart(9)}  ${(g.bytes / 1048576).toFixed(1).padStart(6)}  ${g.failed || ''}`);
    }

    // Time the network cannot explain is time spent waiting on ourselves.
    const netTotal = r.net.reduce((a, n) => a + n.ms, 0);
    const overlap = r.net.length
      ? Math.max(...r.net.map((n) => n.at + n.ms)) - Math.min(...r.net.map((n) => n.at))
      : 0;
    console.log(`  requests ${r.net.length} · summed ${ms(netTotal)} · spanning ${ms(overlap)}`
      + ` · wall ${ms(r.wallMs)}`);
    console.log(`  NOT WAITING ON THE NETWORK: ${ms(Math.max(0, r.wallMs - overlap))}`);

    // The five slowest individual requests, which is usually the whole story.
    const slow = [...r.net].sort((a, b2) => b2.ms - a.ms).slice(0, 5);
    for (const n of slow) {
      console.log(`    ${ms(n.ms).padStart(8)}  ${n.status || (n.failed ? 'ERR' : '?')}  `
        + n.url.replace(/^https?:\/\//, '').slice(0, 96));
    }

    report.beats.push({ index: beat.index, ok: r.ok, wallMs: Math.round(r.wallMs),
                        asset: r.asset || null, error: r.error || null,
                        groups: rows, requests: r.net.length,
                        netSummedMs: Math.round(netTotal), netSpanMs: Math.round(overlap) });
  }

  const total = report.beats.reduce((a, b) => a + b.wallMs, 0);
  console.log(`\n${'='.repeat(72)}`);
  console.log(`three beats in ${ms(total)} — ${ms(total / 3)} each, `
    + `${report.beats.filter((b) => b.ok).length} of 3 acquired`);
  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`written to ${path.relative(PROJECT, OUT)}`);
  await browser.close();
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
