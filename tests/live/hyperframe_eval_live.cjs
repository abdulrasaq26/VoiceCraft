// Evaluation, and a workspace that knows "no footage" is an answer.
//
// THE EVALUATOR IS MOSTLY NOT A MODEL. Whether two components overlap, whether
// type runs off the frame, whether something sits in the band the subtitles are
// burned into — those are measurements, and a language model asked to eyeball
// them is slower, costs a call, and is worse at it than getBoundingClientRect.
// So the structural pass is tested by handing it compositions that are
// deliberately broken in one specific way each, and checking it names that way.
//
// The one thing measurement cannot answer is whether the picture COMMUNICATES
// THE IDEA, and that is the only place vision is used.
//
// AND THE REVISION IS BOUNDED. A pipeline that regenerates until it approves of
// its own work regenerates forever on the beat it cannot do. At most one retry,
// kept only if it is actually better, and what is still wrong is recorded.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

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
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  // ── A composition the components would never produce ────────────────────
  console.log('=== layouts that are broken on purpose ===');
  const broken = await page.evaluate(async () => {
    const EV = window.BlvckHyperFrameEvaluator;
    const wrap = (body, style) => `<!doctype html><html><head><style>
      *{margin:0;padding:0;box-sizing:border-box}
      html,body{width:1920px;height:1080px;overflow:hidden;background:#0b0d12}
      ${style}</style></head><body>
      <div id="root" data-composition-id="main" data-start="0" data-duration="4"
           data-width="1920" data-height="1080">${body}</div></body></html>`;

    const cases = {
      // Two things in the same place — the failure that only exists between
      // components, and the one a real scene actually hit.
      overlap: wrap(
        '<div id="a" class="clip">A</div><div id="b" class="clip">B</div>',
        '#a,#b{position:absolute;left:200px;top:300px;width:600px;height:200px;font-size:80px;color:#fff}'),

      // Down in the band the compositor burns subtitles into.
      caption: wrap(
        '<div id="low" class="clip">down here</div>',
        '#low{position:absolute;left:200px;top:960px;width:600px;height:100px;font-size:60px;color:#fff}'),

      // Off the edge, where a frame has no scrolling to reveal it.
      clipped: wrap(
        '<div id="out" class="clip">off the side</div>',
        '#out{position:absolute;left:1700px;top:300px;width:600px;height:120px;font-size:60px;color:#fff}'),

      // Type nobody can read on a handset.
      tiny: wrap(
        '<div id="small" class="clip"><span id="t">unreadable</span></div>',
        '#small{position:absolute;left:200px;top:300px;width:600px;height:60px}#t{font-size:11px;color:#fff}'),

      // A beat that wastes its seconds.
      sparse: wrap(
        '<div id="dot" class="clip">.</div>',
        '#dot{position:absolute;left:200px;top:300px;width:40px;height:30px;font-size:20px;color:#fff}'),

      // And one that is simply correct.
      fine: wrap(
        '<div id="ok1" class="clip">A headline</div><div id="ok2" class="clip">A number</div>',
        '#ok1{position:absolute;left:160px;top:340px;width:700px;height:200px;font-size:90px;color:#fff}'
        + '#ok2{position:absolute;right:160px;top:340px;width:500px;height:200px;font-size:90px;color:#fff}')
    };

    const out = {};
    for (const [name, html] of Object.entries(cases)) {
      const r = await EV.inspectLayout(html);
      out[name] = { ok: r.ok, kinds: r.problems.map((p) => p.kind),
                    why: r.problems.map((p) => p.why), density: r.density };
    }
    return out;
  });

  for (const [name, r] of Object.entries(broken)) {
    console.log(`  ${name.padEnd(9)} ok=${String(r.ok).padEnd(5)} ${r.kinds.join(', ') || '(none)'}`);
  }
  check('two components in the same place are caught',
        broken.overlap.kinds.includes('overlap'), broken.overlap);
  check('so is something sitting in the caption band',
        broken.caption.kinds.includes('caption_collision'), broken.caption);
  check('and something running off the frame',
        broken.clipped.kinds.includes('clipped'), broken.clipped);
  check('and type too small to read',
        broken.tiny.kinds.includes('unreadable_text'), broken.tiny);
  check('and a beat that wastes its seconds',
        broken.sparse.kinds.includes('sparse'), broken.sparse);
  // The check that makes the five above mean something.
  check('WHILE A SOUND LAYOUT IS LEFT ALONE — no false alarms',
        broken.fine.ok === true && broken.fine.kinds.length === 0, broken.fine);

  // ── The real components must pass their own evaluator ───────────────────
  console.log('\n=== what the component library actually produces ===');
  const real = await page.evaluate(async () => {
    const C = window.BlvckHyperFrameComponents;
    const EV = window.BlvckHyperFrameEvaluator;
    const src = C.compose({ seconds: 6, elements: [
      { kind: 'title', text: 'A headline that runs to a second line', kicker: 'Chapter one' },
      { kind: 'stat', value: '2/3', label: 'of the fleet is idle' },
      { kind: 'progression', items: ['Operator', 'Supervisor', 'Executive'] }
    ]});
    const r = await EV.inspectLayout(src);
    return { ok: r.ok, kinds: r.problems.map((p) => p.kind), why: r.problems.map((p) => p.why),
             density: r.density, boxes: r.elements };
  });
  for (const b of real.boxes) console.log(`  ${b.id.padEnd(9)} ${b.x},${b.y}  ${b.w}x${b.h}`);
  console.log(`  density ${Math.round(real.density * 100)}%`);
  check('a three-component scene from the real library evaluates clean',
        real.ok === true, real);

  // ── Revision is bounded ─────────────────────────────────────────────────
  console.log('\n=== the revision cannot loop ===');
  // Stubbed at the TRANSPORT, not at the module's exports: runRoute calls its
  // own direct() and composeScene() directly, so replacing the exported
  // functions would replace nothing. Counting calls to the model adapter also
  // measures the thing that actually matters — how many times a stuck beat can
  // make the pipeline pay for a model call.
  const bounded = await page.evaluate(async () => {
    const C = window.BlvckHyperFrameComposer;
    const calls = [];

    const realChat = window.LLMAdapters.nvidiaNimChat;
    const realKey = window.ProviderManager.getActiveKey;
    window.ProviderManager.getActiveKey = (p) => (p === 'nim' ? 'test-key' : realKey.call(window.ProviderManager, p));
    window.LLMAdapters.nvidiaNimChat = async ({ messages }) => {
      const prompt = messages[0].content;
      const isDirector = prompt.includes('anchorPhrase');
      calls.push(isDirector ? 'director' : 'composer');
      return isDirector
        ? '{"concept":"a beat","anchorPhrase":"a beat","conveys":["one"],"assetNeeds":[]}'
        : '{"elements":[{"kind":"title","text":"A headline"}],"reason":"x"}';
    };

    // A layout that is always broken: if the bound were missing, this would
    // never return.
    const realCompose = window.BlvckHyperFrameComponents.compose;
    window.BlvckHyperFrameComponents.compose = () =>
      '<!doctype html><html><head><style>html,body{width:1920px;height:1080px}'
      + '#a,#b{position:absolute;left:100px;top:200px;width:500px;height:200px}</style></head>'
      + '<body><div id="root" data-composition-id="main" data-start="0" data-duration="4">'
      + '<div id="a" class="clip">A</div><div id="b" class="clip">B</div></div></body></html>';

    // Render is stubbed: this is about how many times the composer is asked.
    const realRender = window.BlvckHyperFrame.renderScene;
    window.BlvckHyperFrame.renderScene = async () => { throw new Error('render stubbed out'); };

    const scene = { index: 1, subtitle: 'A beat.', timelineStart: 0, timelineEnd: 4,
                    timestamp: '00:00:00 - 00:00:04' };
    const res = await C.runRoute(scene, { force: true });

    window.BlvckHyperFrameComponents.compose = realCompose;
    window.BlvckHyperFrame.renderScene = realRender;
    window.LLMAdapters.nvidiaNimChat = realChat;
    window.ProviderManager.getActiveKey = realKey;
    return { calls, composerCalls: calls.filter((c) => c === 'composer').length,
             res, layout: scene.hyperFrameLayout, revised: !!scene.hyperFrameRevised };
  });
  console.log(`  model calls: ${bounded.calls.join(' → ')}`);
  console.log(`  layout recorded: ${JSON.stringify(bounded.layout)}`);
  check('a layout that cannot be fixed is retried ONCE, not forever',
        bounded.composerCalls === 2, bounded);
  check('and the revision is recorded rather than hidden', bounded.revised === true, bounded);
  check('the problems that remain are kept on the scene',
        bounded.layout && bounded.layout.problems.length > 0, bounded.layout);

  // ── The workspace ───────────────────────────────────────────────────────
  console.log('\n=== a scene with no footage is not a broken scene ===');
  const ws = await page.evaluate(() => {
    const scene = {
      index: 1, subtitle: 'Some ideas have no footage.', sceneSummary: 'x',
      timestamp: '00:00:00 - 00:00:06', timelineStart: 0, timelineEnd: 6, status: 'done',
      visualStrategy: { mode: 'HYPERFRAME', reason: 'a relationship, not a thing',
                        confidence: 0.9, ran: true },
      visualIntent: { concept: 'authority shifts as you rise', conveys: [], assetNeeds: [] },
      assetManifest: [],
      hyperFrame: { mode: 'FULL_FRAME', status: 'ready', renderedKey: 'clip:1',
                    durationSec: 6, renderMs: 25200, bytes: 382000,
                    elements: ['title', 'progression'], anchorPhrase: 'without you' },
      hyperFrameSource: '<!doctype html><html>…</html>',
      hyperFrameEvaluation: {
        layout: { ok: true, density: 0.31, problems: [] },
        reading: { ran: true, sees: 'A dark slide with a heading and three stages listed.', overlap: 0.4 },
        revised: false
      }
    };
    localStorage.setItem('blvck-tts:storyboard', JSON.stringify({
      project: { title: 'ws' }, cues: [], scenes: [scene] }));
    const row = window.BlvckRendererUI._beatRow(scene);
    return { text: row.textContent.replace(/\s+/g, ' ').trim(),
             buttons: [...row.querySelectorAll('button')].map((b) =>
               b.textContent + (b.disabled ? '(off)' : '')) };
  });
  console.log(`  ${ws.text.slice(0, 200)}`);
  console.log(`  actions: ${ws.buttons.join(', ')}`);

  check('it says the beat was BUILT rather than that it failed to find footage',
        /FULL_FRAME · built/.test(ws.text), ws.text);
  check('and that having no footage is deliberate',
        /none — this beat is built, not filmed/.test(ws.text), ws.text);
  check('it shows what the beat had to convey', /authority shifts as you rise/.test(ws.text), ws.text);
  check('what it was built from', /title/.test(ws.text) && /progression/.test(ws.text), ws.text);
  check('the phrase it is anchored to', /without you/.test(ws.text), ws.text);
  check('that the layout was checked', /no problems found/.test(ws.text), ws.text);
  check('and what a viewer actually sees in it',
        /A dark slide with a heading/.test(ws.text), ws.text);
  check('it is honest that no assets were approved',
        /none approved for this beat/.test(ws.text), ws.text);
  check('the actions a producer needs are offered',
        ['Rebuild', 'Preview', 'Source', 'Reset'].every((b) =>
          ws.buttons.some((x) => x.startsWith(b))), ws.buttons);

  // A scene that failed must say so, and must still be actionable.
  const failed = await page.evaluate(() => {
    const scene = { index: 2, subtitle: 'A beat that did not build.',
                    timestamp: '00:00:06 - 00:00:12', timelineStart: 6, timelineEnd: 12,
                    visualStrategy: { mode: 'HYPERFRAME', reason: 'x', ran: true },
                    hyperFrame: { mode: 'FULL_FRAME', status: 'failed',
                                  failure: { stage: 'composer', why: 'the composer is not reachable' } } };
    const row = window.BlvckRendererUI._beatRow(scene);
    return { text: row.textContent.replace(/\s+/g, ' ').trim(),
             buttons: [...row.querySelectorAll('button')].map((b) => b.textContent + (b.disabled ? '(off)' : '')) };
  });
  console.log(`\n  failed beat: ${failed.text.slice(0, 150)}`);
  console.log(`  actions: ${failed.buttons.join(', ')}`);
  check('a failed build says which stage failed and why',
        /composer: the composer is not reachable/.test(failed.text), failed.text);
  check('Preview is off when there is nothing to preview',
        failed.buttons.some((b) => /^Preview\(off\)/.test(b)), failed.buttons);
  check('but it can still be rebuilt',
        failed.buttons.some((b) => b === 'Build' || b === 'Rebuild'), failed.buttons);

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'THE EVALUATOR MEASURES, AND THE WORKSPACE EXPLAINS'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
