// The Renderer workspace: does it exist, does it wire up, and does it tell the
// truth about why a beat has no card?
//
// The last question is the point of the page. "No card" has three completely
// different causes - the Director judged the footage sufficient, the Director
// never answered, or nothing has been run yet - and a producer who cannot tell
// them apart has no way to know whether re-running would change anything.
//
// It also guards the wiring bug this app has had twice: one unguarded
// getElementById throwing partway through a module and silently killing every
// listener declared after it.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

// One beat of each outcome the page has to distinguish.
const SCENES = [
  { index: 1, timestamp: '00:00:00 - 00:00:06', subtitle: 'Forty percent switch brands on price.',
    status: 'done', timelineStart: 0, timelineEnd: 6,
    stockAsset: { provider: 'pixabay', id: '1' },
    rendererElements: [{ kind: 'stat', content: '40%', label: 'on price', items: [],
                         placement: 'lower_right', anchor: 'forty percent',
                         start: 0.4, end: 2.4, anchoredTo: 'forty percent', spokenAt: 0.4 }],
    rendererDecision: { ran: true, needed: true, reason: 'the picture cannot show the figure',
                        at: Date.now(), rejected: [] } },

  { index: 2, timestamp: '00:00:06 - 00:00:12', subtitle: 'The waves break against the rocks.',
    status: 'done', timelineStart: 6, timelineEnd: 12,
    stockAsset: { provider: 'pixabay', id: '2' }, rendererElements: null,
    rendererDecision: { ran: true, needed: false, reason: 'the footage already shows this',
                        at: Date.now(), rejected: [] } },

  { index: 3, timestamp: '00:00:12 - 00:00:18', subtitle: 'A third of the fleet was lost.',
    status: 'done', timelineStart: 12, timelineEnd: 18,
    stockAsset: { provider: 'pixabay', id: '3' }, rendererElements: null,
    rendererDecision: { ran: false, needed: false,
                        reason: 'the Director failed: 503 ResourceExhausted',
                        at: Date.now(), rejected: ['unsupported kind "map"'] } },

  { index: 4, timestamp: '00:00:18 - 00:00:24', subtitle: 'Nothing has been asked about this one.',
    status: 'done', timelineStart: 18, timelineEnd: 24,
    stockAsset: { provider: 'pixabay', id: '4' } }
];

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 180000,
    args: ['--window-size=1400,950']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((scenes) => {
    localStorage.setItem('blvck-tts:storyboard', JSON.stringify({
      project: { title: 'workspace test' }, cues: [], scenes, transcript: null }));
  }, SCENES);
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  // ── The page exists and the router can reach it ─────────────────────────
  console.log('=== the workspace ===');
  const there = await page.evaluate(() => ({
    page: !!document.getElementById('workspace-renderer'),
    card: !!document.getElementById('renderer-card'),
    nav: !!document.querySelector('[data-workspace="renderer"]'),
    inRouter: !!(window.AetherRouter && window.AetherRouter.workspaces
                 && window.AetherRouter.workspaces().some
                 ? window.AetherRouter.workspaces().some((w) => w.id === 'renderer')
                 : true),
    ui: !!window.BlvckRendererUI,
    stageKnown: !!(window.BlvckAssets && 'renderer' in window.BlvckAssets.status())
  }));
  console.log(`  ${JSON.stringify(there)}`);
  check('the workspace page exists', there.page, there);
  check('renderer-card exists — the pipeline step has pointed at it all along',
        there.card, there);
  check('there is a sidebar entry for it', there.nav, there);
  check('the ui module loaded and did not abort partway',
        there.ui, 'BlvckRendererUI missing — an unguarded lookup probably threw');
  check('the pipeline tracker knows the stage', there.stageKnown, there);

  const switched = await page.evaluate(() => {
    window.AetherRouter.switchWorkspace('renderer');
    const p = document.getElementById('workspace-renderer');
    return { visible: !p.hidden,
             others: [...document.querySelectorAll('.workspace-page')]
               .filter((x) => !x.hidden).map((x) => x.id) };
  });
  check('the router can switch to it', switched.visible, switched);
  check('and only it is shown', switched.others.length === 1, switched.others);

  // ── Every wire is live ──────────────────────────────────────────────────
  console.log('\n=== the controls ===');
  const wired = await page.evaluate(() => {
    const ids = ['renderer-run', 'renderer-stop', 'renderer-clear', 'renderer-scope',
                 'renderer-status', 'renderer-summary', 'renderer-beats', 'renderer-provider'];
    return Object.fromEntries(ids.map((i) => [i, !!document.getElementById(i)]));
  });
  console.log(`  ${JSON.stringify(wired)}`);
  check('every element the module reaches for is present',
        Object.values(wired).every(Boolean), wired);

  // ── Why a beat has no card ──────────────────────────────────────────────
  console.log('\n=== what it says about each beat ===');
  const rows = await page.evaluate(() => {
    window.BlvckRendererUI._paint();
    return [...document.querySelectorAll('#renderer-beats > div')]
      .map((r) => r.textContent.replace(/\s+/g, ' ').trim());
  });
  for (const r of rows) console.log(`  ${r.slice(0, 118)}`);
  check('every beat is listed', rows.length === 4, rows.length);
  check('a beat with a card says what the card is',
        /1 element/.test(rows[0]) && /stat/.test(rows[0]) && /40%/.test(rows[0]), rows[0]);
  check('and where it was anchored in the narration',
        /on “forty percent”/.test(rows[0]) && /0\.40–2\.40s/.test(rows[0]), rows[0]);
  check('a considered no says nothing was needed', /nothing needed/.test(rows[1]), rows[1]);
  check('and gives the judgement, not just the absence',
        /already shows this/.test(rows[1]), rows[1]);
  check('an outage is NOT reported as nothing needed',
        !/nothing needed/.test(rows[2]) && /did not answer/.test(rows[2]), rows[2]);
  check('and it names the failure',
        /503/.test(rows[2]), rows[2]);
  check('a refused element is surfaced rather than dropped silently',
        /unsupported kind "map"/.test(rows[2]), rows[2]);
  check('an unasked beat says it has not been decided yet',
        /not decided yet/.test(rows[3]), rows[3]);

  const summary = await page.evaluate(() => document.getElementById('renderer-summary').textContent);
  console.log(`  summary: ${summary}`);
  check('the summary separates decided from carrying a card',
        /4 beat\(s\)/.test(summary) && /2 decided/.test(summary)
        && /1 carrying a card/.test(summary), summary);
  check('and counts the beat the Director could not answer', /1 the Director could not answer/.test(summary), summary);

  // ── The run button actually runs the stage ──────────────────────────────
  console.log('\n=== the run button ===');
  const ran = await page.evaluate(async () => {
    const real = window.BlvckRenderer.runStage;
    let got = null;
    window.BlvckRenderer.runStage = async (opts) => {
      got = { force: opts.force, hasSignal: !!opts.signal, hasProgress: typeof opts.onProgress === 'function' };
      opts.onProgress({ scene: { index: 1 }, working: true, summary: {} });
      return { considered: 1, decided: 1, added: 1, nothing: 0, skipped: 3, failed: 0,
               stopped: false, beats: [] };
    };
    document.getElementById('renderer-scope').value = 'all';
    await window.BlvckRendererUI._run();
    window.BlvckRenderer.runStage = real;
    return { got, status: document.getElementById('renderer-status').textContent,
             stopHidden: document.getElementById('renderer-stop').hidden };
  });
  console.log(`  called with ${JSON.stringify(ran.got)}`);
  console.log(`  status: ${ran.status}`);
  check('the button runs the stage', !!ran.got, ran);
  check('"every beat, again" is passed through as force', ran.got.force === true, ran.got);
  check('it can be stopped and reports progress',
        ran.got.hasSignal && ran.got.hasProgress, ran.got);
  check('the outcome is reported in plain terms',
        /1 element/.test(ran.status) && /3 skipped/.test(ran.status), ran.status);
  check('and the stop button is put away afterwards', ran.stopHidden === true, ran);

  // ── Clearing ────────────────────────────────────────────────────────────
  console.log('\n=== clearing ===');
  const cleared = await page.evaluate(() => {
    window.BlvckRendererUI._clear();
    const sb = JSON.parse(localStorage.getItem('blvck-tts:storyboard'));
    return { scenes: sb.scenes.map((s) => ({ el: s.rendererElements, d: s.rendererDecision })),
             stillHasFootage: sb.scenes.every((s) => !!s.stockAsset),
             stillPlaced: sb.scenes.every((s) => Number.isFinite(s.timelineStart)),
             rows: document.querySelectorAll('#renderer-beats > div').length };
  });
  check('every decision is cleared', cleared.scenes.every((s) => !s.el && !s.d), cleared.scenes);
  check('but the footage is untouched', cleared.stillHasFootage, cleared);
  check('and so is the timing', cleared.stillPlaced, cleared);
  check('the page repaints to match', cleared.rows === 4, cleared.rows);

  // ── The badge tells the truth about the provider ────────────────────────
  console.log('\n=== the provider badge ===');
  const badge = await page.evaluate(() => {
    const real = window.BlvckRenderer.available;
    window.BlvckRenderer.available = () => false;
    window.BlvckRendererUI._paint();
    return { real: document.getElementById('renderer-provider').textContent, restored: !!(window.BlvckRenderer.available = real) };
  });
  console.log(`  ${badge.real}`);
  check('the badge reports the Director\'s reachability', /Director/.test(badge.real), badge);

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'THE WORKSPACE SAYS WHY A BEAT HAS NO CARD'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
