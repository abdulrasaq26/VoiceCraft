// "There is nothing" and "I could not look" are different sentences.
//
// Three bugs in this project have now had the same shape, and it is not a
// coding mistake so much as a habit: a failure is converted into a value that
// something downstream reads as a legitimate answer.
//
//   a rate limit became "body stream already read", so the retry that exists
//   for rate limits could never recognise one;
//   an unreachable planner became a FOOTAGE decision, which is what a planner
//   that had thought about it would also produce;
//   a slow endpoint became "unavailable", and a test skipped itself.
//
// This one is the same shape in the asset registry. A store that will not open
// returned an empty key list, which became an empty manifest, which became
// "NO ASSETS ARE APPROVED FOR THIS BEAT — build it from type alone" in the
// Composer's brief. A project whose imagery is sitting on disk would be told,
// in confident language, that it has none, and the finished scene would carry
// no sign that anything had gone wrong.
//
// So the test breaks the store on purpose and follows the consequence all the
// way to the words the model is given and the words the producer is shown.
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
    defaultViewport: null, protocolTimeout: 300000,
    args: ['--window-size=1300,900']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 120)); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  // ── A project that genuinely has nothing ────────────────────────────────
  console.log('=== a project with no assets ===');
  const empty = await page.evaluate(async () => {
    localStorage.removeItem('blvck:stock-cache-meta');
    localStorage.setItem('blvck-tts:storyboard', JSON.stringify({
      project: { title: 'faults' }, cues: [], scenes: [] }));
    const m = await window.BlvckAssetRegistry.manifestFor({ wanted: ['a harbour'] });
    const prompt = window.BlvckHyperFrameComposer._composePrompt({
      narration: 'A sentence.', intent: { concept: 'x', conveys: [] },
      assetLines: '', unmet: [], hasFootage: false, faults: m.faults
    });
    return { assets: m.assets.length, faults: m.faults,
             saysNone: /NO ASSETS ARE APPROVED FOR THIS BEAT/.test(prompt),
             saysFault: /THE ASSET REGISTRY COULD NOT BE READ/.test(prompt) };
  });
  console.log(`  ${empty.assets} assets, ${empty.faults.length} fault(s)`);
  check('an empty project reports no faults', empty.faults.length === 0, empty);
  check('and the brief says plainly that there are none', empty.saysNone === true, empty);
  check('without claiming anything went wrong', empty.saysFault === false, empty);

  // ── A project whose store will not open ─────────────────────────────────
  console.log('\n=== the same project, with the store broken ===');
  const broken = await page.evaluate(async () => {
    // The failure a real machine produces: private mode, a corrupt database, a
    // quota refusal. indexedDB.open throwing is how all of them arrive here.
    const realOpen = indexedDB.open.bind(indexedDB);
    indexedDB.open = () => { throw new Error('UnknownError: the database could not be opened'); };

    const m = await window.BlvckAssetRegistry.manifestFor({ wanted: ['a harbour'] });
    const prompt = window.BlvckHyperFrameComposer._composePrompt({
      narration: 'A sentence.', intent: { concept: 'x', conveys: [] },
      assetLines: '', unmet: [], hasFootage: false, faults: m.faults
    });
    indexedDB.open = realOpen;
    return { assets: m.assets.length, faults: m.faults,
             saysNone: /NO ASSETS ARE APPROVED FOR THIS BEAT/.test(prompt),
             saysFault: /THE ASSET REGISTRY COULD NOT BE READ/.test(prompt) };
  });
  console.log(`  ${broken.assets} assets, ${broken.faults.length} fault(s): ${broken.faults[0] || ''}`);

  check('THE MANIFEST SAYS IT COULD NOT LOOK', broken.faults.length > 0, broken);
  check('and names what would not open',
        /could not be read/.test(broken.faults[0] || ''), broken.faults);
  check('THE BRIEF TELLS THE MODEL IT IS A FAULT, not a considered absence',
        broken.saysFault === true && broken.saysNone === false, broken);

  // ── And the producer can see it ─────────────────────────────────────────
  console.log('\n=== what the workspace shows ===');
  const shown = await page.evaluate((faults) => {
    const scene = {
      index: 1, subtitle: 'A beat.', timestamp: '00:00:00 - 00:00:06',
      timelineStart: 0, timelineEnd: 6,
      visualStrategy: { mode: 'HYPERFRAME', reason: 'x', ran: true },
      visualIntent: { concept: 'x', conveys: [], assetNeeds: ['a harbour'] },
      assetManifest: [],
      assetFaults: faults,
      hyperFrame: { mode: 'FULL_FRAME', status: 'ready', renderedKey: 'clip:1',
                    elements: ['title'], style: 'broadcast-brief' }
    };
    const withFault = window.BlvckRendererUI._beatRow(scene).textContent.replace(/\s+/g, ' ');
    delete scene.assetFaults;
    const without = window.BlvckRendererUI._beatRow(scene).textContent.replace(/\s+/g, ' ');
    return { withFault, without };
  }, broken.faults);

  console.log(`  with a fault: ${(shown.withFault.match(/assets.{0,90}/) || [''])[0]}`);
  console.log(`  without one : ${(shown.without.match(/assets.{0,60}/) || [''])[0]}`);

  check('a beat whose registry failed says so on its row',
        /could not be read/.test(shown.withFault), shown.withFault.slice(0, 300));
  check('and does NOT claim none were approved',
        !/none approved for this beat/.test(shown.withFault), shown.withFault.slice(0, 300));
  check('while a beat that genuinely has none still says that',
        /none approved for this beat/.test(shown.without), shown.without.slice(0, 300));

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'A FAULT IS NOT AN ANSWER, AND NO LONGER LOOKS LIKE ONE'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
