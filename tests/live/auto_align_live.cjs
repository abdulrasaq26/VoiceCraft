// Analyze must measure the narration first — and must never hang waiting to.
//
// Three things are being pinned, and the second matters most because it is the
// risk this feature introduces:
//
//   1. When the narration has not been measured, Analyze measures it, and the
//      CUTS then follow those measurements — not the TTS estimate. Proven by
//      capturing the cue list the Director is actually handed.
//   2. When the aligner hangs, Analyze finishes anyway on estimated timing and
//      says so. A storyboard that sits forever behind a dead endpoint is worse
//      than one planned against estimates.
//   3. A project already measured is not measured again.
//
// The aligner and the Director are both stubbed. The thing under test is the
// storyboard's own wiring: what it does with an alignment, and what it does
// without one. Transcript.toSRT and the beat merger are the real ones.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

// The TTS estimate: a flat 10s grid, which is what character-count apportioning
// produces and what the cuts used to follow.
const TTS_SRT = [
  '1\n00:00:00,000 --> 00:00:10,000\nA single database now holds several hundred movie scripts and screenplays.\n',
  '2\n00:00:10,000 --> 00:00:20,000\nResearchers sit for hours at library terminals hunting for material that once required a written request.\n',
  '3\n00:00:20,000 --> 00:00:30,000\nThe collection also preserves thousands of recordings of unproduced radio shows.\n'
].join('\n');

// What the aligner measured: the same words, at the positions they were
// actually spoken. Deliberately nothing like the 10s grid.
const MEASURED = [
  { start: 0,    end: 6.2,  text: 'A single database now holds several hundred movie scripts and screenplays.' },
  { start: 6.2,  end: 17.5, text: 'Researchers sit for hours at library terminals hunting for material that once required a written request.' },
  { start: 17.5, end: 22.4, text: 'The collection also preserves thousands of recordings of unproduced radio shows.' }
];

async function setup(page, mode) {
  await page.evaluate((srt, measured, m) => {
    localStorage.clear();
    window.__cuesSeenByDirector = null;
    window.__alignCalls = 0;

    const words = (seg) => seg.text.split(/\s+/).map((w, i, all) => ({
      word: w,
      start: seg.start + ((seg.end - seg.start) / all.length) * i,
      end: seg.start + ((seg.end - seg.start) / all.length) * (i + 1)
    }));
    const transcript = {
      source: 'whisper',
      audioDuration: 22.4,
      audioFingerprint: 'test',
      segments: measured.map((s) => ({ ...s, words: words(s) }))
    };

    // The aligner, in whichever mood this run needs.
    window.BlvckAlign = {
      status: async () => (m === 'already'
        ? { state: 'aligned', wordCount: 31, measured: true }
        : { state: 'none', wordCount: 0 }),
      align: async () => {
        window.__alignCalls++;
        if (m === 'hang') return new Promise(() => {});          // never settles
        if (m === 'down') throw new Error('Fish endpoint unreachable.');
        return { transcript, wordCount: 31, audioDuration: 22.4, provider: 'whisper', parts: 1 };
      },
      current: () => (m === 'ok' || m === 'already' ? transcript : null),
      forDirector: () => (m === 'ok' ? { audioDuration: 22.4, segments: measured } : null)
    };

    // The Director, stubbed to answer instantly AND to record what it was
    // asked to plan. That cue list is the actual subject of this test.
    window.AIManager = window.AIManager || {};
    window.AIManager.generateJSON = async (endpoint, payload) => {
      if (payload && payload.cues) window.__cuesSeenByDirector = payload.cues;
      return { scenes: (payload.cues || []).map((c) => ({
        index: c.index, timestamp: c.timestamp, subtitle: c.text,
        camera: 'Wide', sceneSummary: c.text.slice(0, 40), visualType: 'stock_video'
      })) };
    };
    window.AIManager.lastRawResponse = () => '';
    // Skip shot planning and acquisition: neither is what this test is about.
    window.BlvckLTX = Object.assign({}, window.BlvckLTX, {
      planWithDirector: async () => { throw new Error('stubbed out'); },
      reset: () => {}
    });
    if (window.StockMedia) window.StockMedia.acquire = async () => { throw new Error('stubbed out'); };

    window.BlvckAssets.setSubtitlesSRT(srt, 'audio');
  }, TTS_SRT, MEASURED, mode);
}

const spans = (cues) => (cues || []).map((c) => {
  const [a, b] = c.timestamp.split(/\s*-\s*/);
  const sec = (t) => { const m = t.match(/(\d+):(\d+):(\d+)/); return +m[1] * 3600 + +m[2] * 60 + +m[3]; };
  return sec(b) - sec(a);
});

async function runAnalyze(page, budgetMs) {
  await page.evaluate((ms) => {
    document.querySelectorAll('.workspace-page').forEach((p) => { p.hidden = true; });
    const sb = document.getElementById('workspace-storyboard');
    if (sb) sb.hidden = false;
    if (ms) window.BlvckStoryboard._setAutoAlignBudget(ms);
    document.getElementById('sb-import').click();
  }, budgetMs);
  await new Promise((r) => setTimeout(r, 600));
  const t0 = Date.now();
  await page.evaluate(() => document.getElementById('sb-analyze').click());

  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const done = await page.evaluate(() => !document.getElementById('sb-analyze').disabled
                                        && !!window.__cuesSeenByDirector);
    if (done) break;
    await new Promise((r) => setTimeout(r, 400));
  }
  return Date.now() - t0;
}

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null,
    protocolTimeout: 300000,
    args: ['--window-size=1400,950']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 120)); });

  // ── 1. A measured run ─────────────────────────────────────────────────────
  console.log('\n=== the aligner answers ===');
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await setup(page, 'ok');
  await runAnalyze(page);

  const ok = await page.evaluate(() => ({
    cues: window.__cuesSeenByDirector,
    alignCalls: window.__alignCalls,
    srt: window.BlvckAssets.subtitlesSRT(),
    status: (document.getElementById('sb-status') || {}).textContent || ''
  }));
  const okSpans = spans(ok.cues);
  console.log(`  cue spans handed to the Director: ${JSON.stringify(okSpans)}`);
  check('the aligner was actually run', ok.alignCalls === 1, ok.alignCalls);
  check('the cuts follow the measured timing, not the 10s estimate',
        okSpans.length === 3 && okSpans[0] === 6 && okSpans[1] === 11 && okSpans[2] === 5, okSpans);
  check('no cut sits on the estimated grid', !okSpans.every((s) => s === 10), okSpans);
  check('the project subtitles were rewritten from the measurement',
        ok.srt.includes('00:00:06') && !ok.srt.includes('00:00:10,000'), ok.srt.slice(0, 90));
  check('and it says the timing was measured', /Timing: measured/.test(ok.status), ok.status.slice(0, 160));

  // ── 2. A hung aligner ─────────────────────────────────────────────────────
  console.log('\n=== the aligner hangs ===');
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await setup(page, 'hang');
  const tookMs = await runAnalyze(page, 3000);

  const hung = await page.evaluate(() => ({
    cues: window.__cuesSeenByDirector,
    status: (document.getElementById('sb-status') || {}).textContent || ''
  }));
  console.log(`  Analyze finished in ${(tookMs / 1000).toFixed(1)}s on a 3s budget`);
  console.log(`  cue spans: ${JSON.stringify(spans(hung.cues))}`);
  check('production still happened', !!hung.cues && hung.cues.length > 0,
        { cues: hung.cues && hung.cues.length });
  check('it gave up near the budget rather than hanging', tookMs < 25000, tookMs);
  check('and it says the timing is still estimated',
        /still estimated/.test(hung.status), hung.status.slice(0, 160));

  // ── 3. An aligner that is down ────────────────────────────────────────────
  console.log('\n=== the aligner is down ===');
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await setup(page, 'down');
  await runAnalyze(page);
  const down = await page.evaluate(() => ({
    cues: window.__cuesSeenByDirector,
    status: (document.getElementById('sb-status') || {}).textContent || ''
  }));
  check('production still happened', !!down.cues && down.cues.length > 0,
        { cues: down.cues && down.cues.length });
  check('and the reason is reported, not swallowed',
        /still estimated/.test(down.status) && /unreachable/.test(down.status),
        down.status.slice(0, 160));

  // ── 4. Already measured ───────────────────────────────────────────────────
  console.log('\n=== already measured ===');
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await setup(page, 'already');
  await runAnalyze(page);
  const already = await page.evaluate(() => ({
    alignCalls: window.__alignCalls,
    status: (document.getElementById('sb-status') || {}).textContent || ''
  }));
  check('a measured project is not measured again', already.alignCalls === 0, already.alignCalls);
  check('and it says so', /already measured/.test(already.status), already.status.slice(0, 160));

  check('nothing threw throughout', pageErrors.length === 0, pageErrors.slice(0, 4));

  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'ANALYZE MEASURES THE NARRATION, AND NEVER HANGS ON IT'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
