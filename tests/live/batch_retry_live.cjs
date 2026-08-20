// A slow moment must not throw away a run that is minutes old.
//
// Measured against the live NIM service while investigating a 240s timeout: the
// same ten-beat batch returned in 60s and in 83s, and a two-token request took
// 26s — almost all of it queueing behind other work. The bound is generous
// against that, but a spike still breaches it, and every completed batch went
// down with the unlucky one.
//
// So a transient failure gets exactly one more ask. The other half matters just
// as much: a malformed or truncated reply fails identically the second time, so
// retrying it only doubles the wait before the same error. This checks both,
// and counts the calls rather than trusting the outcome.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

// Ten sentences, long enough that each fills its own beat at the 4s floor.
const SENTENCES = Array.from({ length: 10 }, (_, i) =>
  `Sentence number ${i + 1} of this narration describes one specific thing that `
  + `happened, at enough length to hold a shot on its own without borrowing the next.`);
const SRT = SENTENCES.map((t, i) => {
  const p = (n) => String(n).padStart(2, '0');
  return `${i + 1}\n00:00:${p(i * 6)},000 --> 00:00:${p(i * 6 + 6)},000\n${t}\n`;
}).join('\n');

async function seed(page, mode) {
  await page.evaluate((srt, script, m) => {
    localStorage.setItem('blvck-tts:script-last', JSON.stringify({ script }));
    localStorage.removeItem('blvck-tts:storyboard');
    window.BlvckAssets.setSubtitlesSRT(srt, 'audio');

    // No alignment in this test — it is about the Director loop.
    window.BlvckAlign = { status: async () => ({ state: 'aligned', wordCount: 99 }),
                          align: async () => { throw new Error('not used'); },
                          current: () => null, forDirector: () => null };

    window.__calls = [];
    window.AIManager.generateJSON = async (endpoint, payload) => {
      window.__calls.push((payload.cues || []).length);
      const n = window.__calls.length;
      if (m === 'transient' && n === 1) {
        const e = new Error('NVIDIA NIM did not respond within 240s.');
        e.transient = true;
        e.category = 'timeout';
        throw e;
      }
      if (m === 'permanent') {
        const e = new Error('NIM replied with something that is not JSON.');
        e.category = 'nim-output';
        throw e;
      }
      return { scenes: (payload.cues || []).map((c) => ({
        index: c.index, timestamp: c.timestamp, subtitle: c.text,
        camera: 'Wide', sceneSummary: c.text.slice(0, 30), visualType: 'stock_video'
      })) };
    };
    window.AIManager.lastRawResponse = () => '';
    window.BlvckLTX = Object.assign({}, window.BlvckLTX, {
      planWithDirector: async () => { throw new Error('not part of this test'); }, reset: () => {}
    });
    if (window.StockMedia) window.StockMedia.acquire = async () => { throw new Error('not part of this test'); };
  }, SRT, SENTENCES.join(' '), mode);
}

async function analyze(page) {
  await page.evaluate(() => {
    document.querySelectorAll('.workspace-page').forEach((p) => { p.hidden = true; });
    const sb = document.getElementById('workspace-storyboard');
    if (sb) sb.hidden = false;
    document.getElementById('sb-import').click();
  });
  await new Promise((r) => setTimeout(r, 700));
  await page.evaluate(() => document.getElementById('sb-analyze').click());
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const idle = await page.evaluate(() => !document.getElementById('sb-analyze').disabled);
    if (idle) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  return page.evaluate(() => ({
    calls: window.__calls,
    scenes: (JSON.parse(localStorage.getItem('blvck-tts:storyboard') || '{}').scenes || []).length,
    status: (document.getElementById('sb-status') || {}).textContent || ''
  }));
}

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

  // ── Batches are smaller than the whole script ─────────────────────────────
  console.log('\n=== how the work is divided ===');
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await seed(page, 'ok');
  const ok = await analyze(page);
  console.log(`  cues per request: ${JSON.stringify(ok.calls)}`);
  check('the script is split across several requests', ok.calls.length > 1, ok.calls);
  check('no single request carries the whole script',
        ok.calls.every((n) => n <= 5), ok.calls);
  check('and every beat still gets planned',
        ok.calls.reduce((a, b) => a + b, 0) === ok.scenes, { sent: ok.calls, planned: ok.scenes });

  // ── A slow batch is asked again ───────────────────────────────────────────
  console.log('\n=== the service is slow once ===');
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await seed(page, 'transient');
  const slow = await analyze(page);
  console.log(`  cues per request: ${JSON.stringify(slow.calls)}`);
  check('the timed-out batch was asked again', slow.calls.length === ok.calls.length + 1,
        { withRetry: slow.calls, clean: ok.calls });
  check('the retry carried the same batch', slow.calls[0] === slow.calls[1], slow.calls);
  check('and the run finished rather than dying', slow.scenes === ok.scenes,
        { got: slow.scenes, want: ok.scenes });
  check('the failure is not reported as an error', !/did not respond/.test(slow.status),
        slow.status.slice(0, 140));

  // ── A bad answer is not asked again ───────────────────────────────────────
  console.log('\n=== the answer is malformed ===');
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await seed(page, 'permanent');
  const bad = await analyze(page);
  console.log(`  cues per request: ${JSON.stringify(bad.calls)}`);
  check('a malformed reply is not retried', bad.calls.length === 1, bad.calls);
  check('and the reason reaches the user', /not JSON/.test(bad.status), bad.status.slice(0, 140));

  check('nothing threw throughout', pageErrors.length === 0, pageErrors.slice(0, 3));

  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'A SLOW MOMENT COSTS A MINUTE, NOT THE RUN'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
