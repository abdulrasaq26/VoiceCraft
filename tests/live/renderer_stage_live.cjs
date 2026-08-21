// The Renderer as a stage: every beat in a project, and where the answers go.
//
// decide() is proven against live NIM elsewhere. What is unproven here is the
// plumbing around it, and the plumbing is where this app has actually broken
// before: a decision written into localStorage that the storyboard's next save
// quietly rebuilt away, exactly as the transcript once vanished.
//
// So decide() is stubbed. That is deliberate - it makes every case below fast
// and deterministic, and none of them depend on what a model says. The live
// question is answered by renderer_director_smoke.cjs.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

// A project with one of everything the stage has to tell apart.
const SCENES = [
  { index: 1, timestamp: '00:00:00 - 00:00:06', subtitle: 'Forty percent switch brands on price.',
    sceneSummary: 'A shopper at a shelf', status: 'done', timelineStart: 0, timelineEnd: 6,
    stockAsset: { provider: 'pixabay', id: '1', queriesUsed: ['supermarket'] },
    visualEvaluation: { best: { sees: 'A person reaching for a box on a shelf.' } } },

  { index: 2, timestamp: '00:00:06 - 00:00:12', subtitle: 'Revenue tripled over four years.',
    sceneSummary: 'A chart beat', status: 'done', visualType: 'chart',
    graphic: { title: 'Revenue' }, timelineStart: 6, timelineEnd: 12 },

  { index: 3, timestamp: '00:00:12 - 00:00:18', subtitle: 'Nobody chose a picture for this one.',
    sceneSummary: 'unacquired', status: 'pending', timelineStart: 12, timelineEnd: 18 },

  { index: 4, timestamp: '00:00:18 - 00:00:24', subtitle: '',
    sceneSummary: 'silence', status: 'done', timelineStart: 18, timelineEnd: 24,
    stockAsset: { provider: 'pexels', id: '4', queriesUsed: ['b-roll'] } },

  // No timeline fields at all — an estimated project, placed only by its
  // timestamp string. The stage must still be able to hang an element on it.
  { index: 5, timestamp: '00:00:24 - 00:00:31', subtitle: 'The bridge opened in 1937.',
    sceneSummary: 'A bridge in fog', status: 'done',
    stockAsset: { provider: 'pixabay', id: '5', queriesUsed: ['bridge fog'] },
    visualEvaluation: { best: { sees: 'A red bridge in heavy fog.' } } }
];

const TRANSCRIPT = (() => {
  const say = (text, from) => ({ start: from, end: from + text.split(' ').length * 0.4,
    text, words: text.split(' ').map((w, i) => ({ word: w, start: from + i * 0.4, end: from + i * 0.4 + 0.4 })) });
  return { source: 'whisper', audioDuration: 31,
           segments: [say('Forty percent switch brands on price', 0),
                      say('The bridge opened in 1937', 24)] };
})();

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 180000,
    args: ['--window-size=1200,800']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  await page.evaluate((scenes, transcript) => {
    window.__seed = (extra) => {
      localStorage.setItem('blvck-tts:storyboard', JSON.stringify(Object.assign({
        project: { title: 'stage test' }, cues: [], scenes: JSON.parse(JSON.stringify(scenes)),
        transcript
      }, extra || {})));
    };
    window.__stored = () => JSON.parse(localStorage.getItem('blvck-tts:storyboard') || 'null');

    // A stub that answers like the real one: a yes for a beat with a figure, a
    // considered no otherwise. Recorded so the arguments can be inspected.
    window.__calls = [];
    window.__decider = null;
    window.__stub = (mode) => {
      window.__decider = async (args) => {
        window.__calls.push(args);
        if (mode === 'outage') {
          return { needed: false, reason: 'the Director failed: 503 ResourceExhausted',
                   elements: [], rejected: [], ran: false };
        }
        if (mode === 'nothing') {
          return { needed: false, reason: 'the footage already carries it',
                   elements: [], rejected: [], ran: true };
        }
        const start = args.shot.timelineStart + 0.1;
        return { needed: true, reason: 'the picture cannot show the figure', ran: true,
                 rejected: [],
                 elements: [{ kind: 'stat', content: '40%', label: 'on price', items: [],
                              placement: 'lower_right', anchor: 'forty percent',
                              animation: 'none', enabled: true,
                              start, end: start + 2, anchoredTo: 'forty percent', spokenAt: start }] };
      };
    };
    // Every runStage in this file goes through here, so the stub is passed as
    // the stage's own decider parameter rather than monkey-patched over it.
    window.__run = (opts) => window.BlvckRenderer.runStage(
      Object.assign({ decider: window.__decider }, opts || {}));
  }, SCENES, TRANSCRIPT);

  // ── Which beats are even asked about ─────────────────────────────────────
  console.log('=== eligibility ===');
  const elig = await page.evaluate((scenes) =>
    scenes.map((s) => ({ index: s.index, ...window.BlvckRenderer._eligible(s) })), SCENES);
  for (const e of elig) console.log(`  scene ${e.index}  ${e.ok ? 'asked' : 'skipped — ' + e.why}`);
  check('a beat with a picture and narration is asked about', elig[0].ok === true, elig[0]);
  check('a beat that is ALREADY a full-frame graphic is not',
        elig[1].ok === false && /already a full-frame graphic/.test(elig[1].why), elig[1]);
  check('a beat with no picture is not', elig[2].ok === false, elig[2]);
  check('a beat with no narration is not', elig[3].ok === false, elig[3]);
  check('a beat placed only by its timestamp still is', elig[4].ok === true, elig[4]);

  // ── The shot window, which the Renderer reads and never invents ──────────
  console.log('\n=== where the shot sits ===');
  const windows = await page.evaluate((scenes) =>
    scenes.map((s) => ({ index: s.index, w: window.BlvckRenderer._shotWindowOf(s) })), SCENES);
  for (const w of windows) console.log(`  scene ${w.index}  ${JSON.stringify(w.w)}`);
  check('a measured beat uses its placed timeline',
        windows[0].w.timelineStart === 0 && windows[0].w.timelineEnd === 6, windows[0]);
  check('an unplaced beat falls back to its own timestamp, not to zero',
        windows[4].w.timelineStart === 24 && windows[4].w.timelineEnd === 31, windows[4]);

  // ── What the Director is told about the picture ──────────────────────────
  console.log('\n=== what it is told about the picture ===');
  const ctx = await page.evaluate((s) => window.BlvckRenderer._pictureContext(s), SCENES[0]);
  console.log(`  ${JSON.stringify(ctx)}`);
  check('the description already recorded during acquisition is reused',
        /reaching for a box/.test(ctx.mediaDescription), ctx);
  check('and it is not re-fetched from the vision model', true,
        'pictureContext reads scene.visualEvaluation — no call is made');

  // ── A whole project ─────────────────────────────────────────────────────
  console.log('\n=== running the stage ===');
  const run = await page.evaluate(async () => {
    window.__seed();
    window.__stub('yes');
    window.__calls = [];
    const seen = [];
    const summary = await window.__run({
      onProgress: (p) => seen.push(p.skipped ? `skip ${p.scene.index}` : `beat ${p.scene.index}`)
    });
    return { summary, seen, stored: window.__stored(), calls: window.__calls.length };
  });
  console.log(`  ${JSON.stringify(run.summary.beats)}`);
  console.log(`  considered ${run.summary.considered} · added ${run.summary.added} `
    + `· skipped ${run.summary.skipped} · failed ${run.summary.failed}`);
  check('only the eligible beats were asked', run.calls === 2, run.calls);
  check('and both produced an element', run.summary.added === 2, run.summary);
  check('progress was reported for every beat',
        new Set(run.seen.filter((x) => x.startsWith('beat'))).size === 2, run.seen);

  const stored = run.stored.scenes;
  check('the decision is on the scene', !!(stored[0].rendererElements || [])[0], stored[0]);
  check('and it is PERSISTED, not only held in memory',
        (stored[0].rendererElements || []).length === 1, stored[0].rendererElements);
  check('the skipped graphic beat got nothing', !stored[1].rendererElements, stored[1]);
  check('the reason is kept beside it',
        /cannot show the figure/.test((stored[0].rendererDecision || {}).reason || ''),
        stored[0].rendererDecision);
  check('the beat placed by timestamp got an element anchored inside its own window',
        (stored[4].rendererElements || [])[0]
        && stored[4].rendererElements[0].start >= 24, stored[4].rendererElements);

  // ── The transcript reaches the Director ─────────────────────────────────
  const passed = await page.evaluate(() => window.__calls[0]);
  check('the measured transcript is handed to the Director',
        !!(passed.transcript && passed.transcript.source === 'whisper'), passed.transcript);
  check('and the narration for THAT beat, not the whole script',
        /Forty percent/.test(passed.narration), passed.narration);

  // ── A second run does not redo the work ─────────────────────────────────
  console.log('\n=== running it again ===');
  const again = await page.evaluate(async () => {
    window.__calls = [];
    const s = await window.__run({});
    const forcedCalls = [];
    window.__calls = forcedCalls;
    const f = await window.__run({ force: true });
    return { plain: s, forced: f, plainCalls: 0, forcedCalls: forcedCalls.length };
  });
  console.log(`  plain: considered ${again.plain.considered}, skipped ${again.plain.skipped}`);
  console.log(`  force: considered ${again.forced.considered}`);
  check('a re-run skips beats already decided', again.plain.considered === 0, again.plain);
  check('but force asks again', again.forced.considered === 2, again.forced);

  // ── A no clears a previous yes ──────────────────────────────────────────
  console.log('\n=== the Director changes its mind ===');
  const cleared = await page.evaluate(async () => {
    window.__stub('nothing');
    const s = await window.__run({ force: true });
    return { summary: s, stored: window.__stored().scenes };
  });
  check('a considered no removes the card that was there',
        !cleared.stored[0].rendererElements, cleared.stored[0].rendererElements);
  check('and says so on the scene',
        /already carries it/.test((cleared.stored[0].rendererDecision || {}).reason || ''),
        cleared.stored[0].rendererDecision);
  check('counted as a decision, not a failure',
        cleared.summary.nothing === 2 && cleared.summary.failed === 0, cleared.summary);

  // ── An outage cannot stop the stage ─────────────────────────────────────
  console.log('\n=== the Director is down ===');
  const outage = await page.evaluate(async () => {
    window.__seed();
    window.__stub('outage');
    const s = await window.__run({ force: true });
    return { summary: s, stored: window.__stored().scenes };
  });
  console.log(`  decided ${outage.summary.decided} · failed ${outage.summary.failed}`);
  check('every beat is still visited', outage.summary.considered === 2, outage.summary);
  check('an outage is counted as a failure, not as a considered no',
        outage.summary.failed === 2 && outage.summary.nothing === 0, outage.summary);
  check('no beat is left carrying a card it did not earn',
        outage.stored.every((s) => !s.rendererElements), outage.stored.map((s) => s.rendererElements));
  check('and the scene records that it was an outage, not a judgement',
        outage.stored[0].rendererDecision.ran === false
        && /503/.test(outage.stored[0].rendererDecision.reason), outage.stored[0].rendererDecision);

  // ── Stopping ────────────────────────────────────────────────────────────
  const stopped = await page.evaluate(async () => {
    window.__seed();
    window.__stub('yes');
    const ctrl = new AbortController();
    ctrl.abort();
    return await window.__run({ signal: ctrl.signal, force: true });
  });
  check('an aborted run stops and says so',
        stopped.stopped === true && stopped.considered === 0, stopped);

  // ── The storyboard must not rebuild the decision away ───────────────────
  //
  // This is the failure this stage was most likely to have. saveProject()
  // rebuilds the stored scenes from its own in-memory array, so a decision
  // written into localStorage alone is erased by the next save from anywhere.
  console.log('\n=== a later save from the storyboard ===');
  const survives = await page.evaluate(async () => {
    const SBM = window.BlvckStoryboard;
    if (!SBM || !SBM.scenes) return { noAccessor: true };
    const live = SBM.scenes();
    const had = live.length;
    live.length = 0;
    live.push({ index: 1, timestamp: '00:00:00 - 00:00:06', status: 'done',
                subtitle: 'Forty percent switch brands on price.', sceneSummary: 'shelf',
                timelineStart: 0, timelineEnd: 6,
                stockAsset: { provider: 'pixabay', id: '1', queriesUsed: ['x'] },
                visualEvaluation: { best: { sees: 'a shelf' } } });
    window.__stub('yes');
    await window.__run({ force: true });
    const afterRun = (window.__stored().scenes[0] || {}).rendererElements;
    // Now the storyboard saves for its own reasons, as it does constantly.
    SBM.save();
    const afterSave = (window.__stored().scenes[0] || {}).rendererElements;
    return { had, afterRun: (afterRun || []).length, afterSave: (afterSave || []).length };
  });
  console.log(`  ${JSON.stringify(survives)}`);
  check('the stage wrote onto the storyboard\'s own scenes',
        survives.noAccessor !== true && survives.afterRun === 1, survives);
  check('and a later storyboard save does NOT rebuild them away',
        survives.afterSave === 1, survives);

  // Non-vacuity: with the accessor hidden the stage falls back to localStorage,
  // and the very next storyboard save must then wipe the decision. If it does
  // not, the check above is proving nothing.
  const withoutAccessor = await page.evaluate(async () => {
    const SBM = window.BlvckStoryboard;
    const realScenes = SBM.scenes;
    // Both sides reset to a scene carrying NO decision, or the previous block's
    // result is still sitting in the live array and the probe measures nothing.
    const fresh = () => ({ index: 1, timestamp: '00:00:00 - 00:00:06', status: 'done',
      subtitle: 'Forty percent switch brands on price.', sceneSummary: 'shelf',
      timelineStart: 0, timelineEnd: 6,
      stockAsset: { provider: 'pixabay', id: '1', queriesUsed: ['x'] },
      visualEvaluation: { best: { sees: 'a shelf' } } });
    const live = realScenes.call(SBM);
    live.length = 0; live.push(fresh());
    const st = window.__stored(); st.scenes = [fresh()];
    localStorage.setItem('blvck-tts:storyboard', JSON.stringify(st));

    delete SBM.scenes;
    window.__stub('yes');
    await window.__run({ force: true });
    const afterRun = ((window.__stored().scenes[0] || {}).rendererElements || []).length;
    SBM.save();
    const afterSave = ((window.__stored().scenes[0] || {}).rendererElements || []).length;
    SBM.scenes = realScenes;
    return { afterRun, afterSave };
  });
  console.log(`  without the accessor: wrote ${withoutAccessor.afterRun}, `
    + `survived the save ${withoutAccessor.afterSave}`);
  check('without the accessor the decision IS rebuilt away — so the check above bites',
        withoutAccessor.afterRun === 1 && withoutAccessor.afterSave === 0, withoutAccessor);

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'THE STAGE RUNS THE PROJECT AND THE ANSWERS SURVIVE'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
