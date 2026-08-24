// Acquisition must cost what it is worth, and never lie about what it did.
//
// Measured with every request the page makes during three real acquisitions:
// 176 seconds, of which 119 were model calls — four candidate descriptions and
// a judge per beat, at 2 to 24 seconds each. The stock providers, long assumed
// to be the bottleneck, were a small fraction of it. That measurement is what
// this test defends:
//
//   the cache      a clip looks like what it looks like. Describing
//                  pexels:17226133 again next week is money for nothing.
//   the budget     a slow endpoint must not eat the beat's whole allowance.
//                  Worst case before: four describes at a 25s deadline, two
//                  abreast, then a 60s judge — 110s for one beat, which is how
//                  a Phase 10 acceptance run lost its footage to a stand-in.
//   the honesty    a verdict reached on half the shortlist is not the same as
//                  one reached on all of it, and a scene that does not say so
//                  presents a rushed pick as a considered one.
//
// The model is stubbed here on purpose. What is under test is how the evaluator
// behaves when the endpoint is slow or absent, and a real endpoint cannot be
// asked to take exactly eight seconds.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');

const PORT = process.argv[2] || '3491';
const env = fs.readFileSync(PROJECT + '/.env', 'utf8');
const envGet = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : '';
};

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 300000,
    args: ['--window-size=1300,900']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 120)); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((nim) => {
    if (nim) localStorage.setItem('blvck:keys_nim', JSON.stringify([nim]));
  }, envGet('NVIDIA_NIM_API'));
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  // ── A stub endpoint whose latency is ours to choose ─────────────────────
  await page.evaluate(() => {
    window.__ev = { vision: 0, judge: 0, visionMs: 0, judgeMs: 0, judgeHangs: false };
    const real = window.LLMAdapters.nvidiaNimChat;
    window.__realNim = real;
    window.LLMAdapters.nvidiaNimChat = async ({ messages }) => {
      const E = window.__ev;
      const c = messages[0].content;
      const isVision = Array.isArray(c) && c.some((x) => x.type === 'image_url');
      if (isVision) {
        E.vision++;
        const which = (c.find((x) => x.type === 'image_url').image_url.url.match(/\d+/) || ['0'])[0];
        await new Promise((r) => setTimeout(r, E.visionMs));
        return `A person would see a harbour with fishing boats and nets, picture ${which}.`;
      }
      E.judge++;
      if (E.judgeHangs) await new Promise(() => {});      // never answers
      await new Promise((r) => setTimeout(r, E.judgeMs));
      return JSON.stringify([
        { i: 1, subject: 0.9, action: 0.8, environment: 0.9, fit: 0.9, contradiction: 0, class: 'direct_depiction' },
        { i: 2, subject: 0.6, action: 0.5, environment: 0.7, fit: 0.6, contradiction: 0, class: 'strong_contextual' },
        { i: 3, subject: 0.4, action: 0.3, environment: 0.5, fit: 0.4, contradiction: 0, class: 'weak_contextual' },
        { i: 4, subject: 0.2, action: 0.2, environment: 0.3, fit: 0.2, contradiction: 0, class: 'generic_filler' }
      ]);
    };

    window.__candidates = (tag) => [1, 2, 3, 4].map((n) => ({
      provider: 'pexels', id: `${tag}${n}`, type: 'video', duration: 12,
      width: 1920, height: 1080,
      thumbnailUrl: `https://example.invalid/thumb-${tag}${n}.jpg`,
      description: 'a harbour', sourceUrl: `https://example.invalid/${tag}${n}`
    }));

    window.__evaluate = (tag, opts = {}) => window.BlvckVisualEvaluator.evaluate(Object.assign({
      narration: 'Empty nets dry on the quayside.',
      intent: { concept: 'nets drying on a quay', subject: 'fishing nets' },
      candidates: window.__candidates(tag)
    }, opts));
  });

  // ── 1. A clip is described once ─────────────────────────────────────────
  console.log('=== describing the same shortlist twice ===');
  const cached = await page.evaluate(async () => {
    // A fresh store, so the run is not reading a previous session's answers.
    await new Promise((res) => { const rq = indexedDB.deleteDatabase('blvck-vision-cache');
      rq.onsuccess = res; rq.onerror = res; rq.onblocked = res; });
    const E = window.__ev;
    E.vision = 0; E.judge = 0; E.visionMs = 60; E.judgeMs = 40;

    const first = await window.__evaluate('a');
    const afterFirst = { vision: E.vision, judge: E.judge, cost: first.cost };
    const second = await window.__evaluate('a');
    return { afterFirst, second: { vision: E.vision, judge: E.judge, cost: second.cost },
             firstVerdict: first.verdict, secondVerdict: second.verdict,
             samePick: first.accepted[0].asset.id === second.accepted[0].asset.id };
  });
  console.log(`  first  ${cached.afterFirst.vision} description(s), ${cached.afterFirst.judge} judge — `
    + JSON.stringify(cached.afterFirst.cost));
  console.log(`  second ${cached.second.vision - cached.afterFirst.vision} description(s), `
    + `${cached.second.judge - cached.afterFirst.judge} judge — ${JSON.stringify(cached.second.cost)}`);

  check('the first pass looks at every candidate',
        cached.afterFirst.vision === 4 && cached.afterFirst.cost.cacheMisses === 4, cached.afterFirst);
  check('THE SECOND PASS LOOKS AT NONE OF THEM AGAIN',
        cached.second.vision === cached.afterFirst.vision, cached.second);
  check('and says so', cached.second.cost.cacheHits === 4 && cached.second.cost.cacheMisses === 0,
        cached.second.cost);
  check('the judge still runs — the ordering depends on the beat, not the clip',
        cached.second.judge === cached.afterFirst.judge + 1, cached.second);
  check('and the answer is the same one', cached.samePick === true, cached);

  // ── 2. A slow endpoint cannot eat the beat ──────────────────────────────
  console.log('\n=== a describer that takes eight seconds a candidate ===');
  const bounded = await page.evaluate(async () => {
    const E = window.__ev;
    E.vision = 0; E.judge = 0; E.visionMs = 8000; E.judgeMs = 40;
    const t0 = performance.now();
    const out = await window.__evaluate('slow', { budgetMs: 12000 });
    return { ms: Math.round(performance.now() - t0), ran: out.ran, verdict: out.verdict,
             cost: out.cost || null, described: out.described, legible: out.legible,
             vision: E.vision };
  });
  console.log(`  finished in ${(bounded.ms / 1000).toFixed(1)}s with a 12s budget — `
    + `${bounded.vision} description(s) attempted`);
  console.log(`  verdict ${bounded.verdict}, cost ${JSON.stringify(bounded.cost)}`);

  check('IT STOPS INSIDE THE BUDGET rather than running to its own deadlines',
        bounded.ms < 20000, bounded.ms);
  check('and it says the shortlist was only partly seen',
        bounded.cost && bounded.cost.overBudget === true, bounded.cost);
  check('while still producing a usable answer from what it did see',
        bounded.ran === true, bounded);

  // ── 3. A judge that never answers ───────────────────────────────────────
  console.log('\n=== a judge that never answers ===');
  const hung = await page.evaluate(async () => {
    const E = window.__ev;
    E.vision = 0; E.judge = 0; E.visionMs = 40; E.judgeHangs = true;
    const t0 = performance.now();
    const out = await window.__evaluate('hang', { budgetMs: 9000 });
    E.judgeHangs = false;
    return { ms: Math.round(performance.now() - t0), ran: out.ran, verdict: out.verdict,
             why: out.why || '' };
  });
  console.log(`  gave up after ${(hung.ms / 1000).toFixed(1)}s — ${hung.verdict}: ${hung.why}`);
  check('a judge that never answers does not hang the beat',
        hung.ms < 15000, hung);
  check('AND AN OUTAGE IS NOT A REFUSAL — the verdict says unevaluated, not unsuitable',
        hung.ran === false && /NOT_EVALUATED|FAILED/.test(hung.verdict), hung);

  // ── 4. What the scene is told ───────────────────────────────────────────
  console.log('\n=== what the scene records ===');
  const recorded = await page.evaluate(async () => {
    const E = window.__ev;
    const scene = { index: 1, subtitle: 'Empty nets dry on the quayside.' };
    const req = { concept: 'nets drying on a quay', subject: 'fishing nets' };

    // Judged in full.
    E.visionMs = 40; E.judgeMs = 40;
    await window.StockMedia._judgeCandidates(scene, req, window.__candidates('full'), 'auto');
    const full = JSON.parse(JSON.stringify(scene.visualEvaluation));

    // Judged on part of the shortlist.
    const scene2 = { index: 2, subtitle: 'Empty nets dry on the quayside.' };
    E.visionMs = 8000;
    await window.StockMedia._judgeCandidates(scene2, req, window.__candidates('part'), 'auto', 11000);
    const partial = JSON.parse(JSON.stringify(scene2.visualEvaluation));

    // Not judged at all.
    const scene3 = { index: 3, subtitle: 'Empty nets dry on the quayside.' };
    E.visionMs = 40; E.judgeHangs = true;
    await window.StockMedia._judgeCandidates(scene3, req, window.__candidates('none'), 'auto', 8000);
    E.judgeHangs = false;
    const none = JSON.parse(JSON.stringify(scene3.visualEvaluation));

    return { full, partial, none };
  });
  console.log(`  judged in full : ${recorded.full.verdict} · partial=${recorded.full.partial}`);
  console.log(`  budget cut it  : ${recorded.partial.verdict} · partial=${recorded.partial.partial}`);
  console.log(`  never judged   : ${recorded.none.verdict} · ${recorded.none.why}`);

  check('a fully judged scene is recorded as a considered choice',
        recorded.full.partial === false && recorded.full.considered > 0, recorded.full);
  check('A RUSHED ONE SAYS IT WAS RUSHED',
        recorded.partial.partial === true, recorded.partial);
  check('and one that was never judged says that, rather than claiming a verdict',
        /NOT_EVALUATED|FAILED/.test(recorded.none.verdict)
        && recorded.none.confidence === 'UNKNOWN', recorded.none);
  check('an outage never becomes "no suitable asset"',
        recorded.none.verdict !== 'NO_SUITABLE_ASSET', recorded.none);

  // ── 5. A provider that hangs ────────────────────────────────────────────
  console.log('\n=== a stock provider that never answers ===');
  const hangSearch = await page.evaluate(async () => {
    const realFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      if (/pixabay|pexels/.test(url)) {
        // Answers to nothing but the caller's own abort signal.
        return new Promise((_, reject) => {
          const sig = init && init.signal;
          if (sig) sig.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        });
      }
      return realFetch(input, init);
    };
    localStorage.setItem('blvck:pexels_key', 'test');
    localStorage.setItem('blvck:pixabay_key', 'test');
    const t0 = performance.now();
    const found = await window.StockMedia.search({ queries: ['a quayside'], provider: 'modern' });
    const ms = Math.round(performance.now() - t0);
    window.fetch = realFetch;
    return { ms, found: found.length };
  });
  console.log(`  the search gave up after ${(hangSearch.ms / 1000).toFixed(1)}s`);
  check('A HUNG PROVIDER IS CUT OFF IN TEN SECONDS, not twenty',
        hangSearch.ms >= 9000 && hangSearch.ms < 13000, hangSearch);
  check('and the search returns rather than throwing', hangSearch.found === 0, hangSearch);

  await page.evaluate(() => { window.LLMAdapters.nvidiaNimChat = window.__realNim; });
  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'ACQUISITION COSTS WHAT IT IS WORTH, AND SAYS WHAT IT DID'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
