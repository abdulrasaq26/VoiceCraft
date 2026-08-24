// The Editorial Visual Planner: which medium a beat is made of.
//
// Two things are being tested and they are separable on purpose.
//
// THE CONTRACT — what the parser keeps, what it refuses, and what happens when
// the provider is not there. All of that is deterministic and needs no model.
// The rule that matters most: every failure resolves to FOOTAGE, because that
// is what this pipeline did before a planner existed. A planner that can break
// production is worse than no planner.
//
// THE JUDGEMENT — run against live NIM, on beats chosen so that a planner
// answering the same thing every time CANNOT pass. One sentence describes a
// place a camera could stand in; one is about a hierarchy no camera ever saw;
// one carries both. If all three come back identical, the planner is not
// planning, and this test says so.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'visual_planner_v1.json');
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

// Deliberately three different shapes of sentence. No worked example in the
// prompt to echo, and nothing here shares vocabulary with the prompt's rules.
const BEATS = [
  { name: 'a place a camera could stand in',
    expect: 'FOOTAGE',
    subtitle: 'Before dawn the boats come back in, and the market on the quay '
            + 'is already loud with buyers.',
    sceneSummary: 'a fish market at first light' },

  { name: 'a structure no camera ever saw',
    expect: 'HYPERFRAME',
    subtitle: 'Every one of those boats answers to a quota set three levels '
            + 'above it, by people who have never been to sea.',
    sceneSummary: 'the chain of authority over the fleet' },

  { name: 'a real thing plus a figure it cannot show',
    expect: 'HYBRID',
    subtitle: 'The catch is weighed on the dock, and last year it came to '
            + 'ninety thousand tonnes — a third of what it was in nineteen ninety.',
    sceneSummary: 'weighing the catch on the dock' }
];

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 400000,
    args: ['--window-size=1200,800']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((nim) => {
    if (nim) localStorage.setItem('blvck:keys_nim', JSON.stringify([nim]));
    localStorage.setItem('blvck:director_provider', 'nim');
  }, envGet('NVIDIA_NIM_API'));
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  const P = (json) => page.evaluate((t) => window.BlvckVisualPlanner._parsePlan(t), json);

  // ── Legacy: a project that predates all of this ─────────────────────────
  console.log('=== a scene saved before the planner existed ===');
  const legacy = await page.evaluate(() => {
    const V = window.BlvckVisualPlanner;
    const old = { index: 1, subtitle: 'An old scene.', stockAsset: { provider: 'pixabay', id: '1' } };
    return { mode: V.strategyOf(old), planned: V.planned(old),
             noScene: V.strategyOf(null), junk: V.strategyOf({ visualStrategy: { mode: 'WHATEVER' } }) };
  });
  console.log(`  ${JSON.stringify(legacy)}`);
  check('an unplanned scene reads as FOOTAGE — no migration needed',
        legacy.mode === 'FOOTAGE' && legacy.planned === false, legacy);
  check('and so does a scene carrying a mode nobody has heard of',
        legacy.junk === 'FOOTAGE', legacy);
  check('and so does no scene at all', legacy.noScene === 'FOOTAGE', legacy);

  // ── The contract ────────────────────────────────────────────────────────
  console.log('\n=== what the parser keeps ===');
  const good = await P(JSON.stringify({
    mode: 'HYPERFRAME', reason: 'The sentence is about a hierarchy.', confidence: 0.88 }));
  console.log(`  ${JSON.stringify(good)}`);
  check('a good plan is accepted', good.mode === 'HYPERFRAME' && good.ran === true, good);
  check('its reason survives', /hierarchy/.test(good.reason), good);
  check('and its confidence', good.confidence === 0.88, good);

  console.log('\n=== what it refuses ===');
  const over = await P(JSON.stringify({
    mode: 'HYPERFRAME', reason: 'x', confidence: 0.9,
    // Everything a planner is not allowed to decide.
    start: 12.5, end: 19, duration: 6.5,
    layout: { x: 120, y: 400, width: 800 },
    html: '<div style="position:absolute">…</div>',
    assets: ['logo.png'], animation: 'fadeIn', footage: 'pixabay:1234'
  }));
  console.log(`  kept: ${Object.keys(over).join(', ')}`);
  check('nothing but mode, reason, confidence and ran survives',
        Object.keys(over).sort().join(',') === 'confidence,mode,ran,reason', Object.keys(over));
  check('no timing survives',
        over.start === undefined && over.end === undefined && over.duration === undefined, over);
  check('no layout or code survives',
        over.layout === undefined && over.html === undefined && over.animation === undefined, over);
  check('and it does not get to pick the footage either', over.footage === undefined, over);

  const bad = {
    unknownMode: await P(JSON.stringify({ mode: 'ANIMATION', reason: 'x' })),
    prose:       await P('I think motion graphics would suit this one.'),
    broken:      await P('{"mode":"HYBRID",'),
    empty:       await P(''),
    wrongShape:  await P(JSON.stringify(['HYPERFRAME'])),
    noMode:      await P(JSON.stringify({ reason: 'x', confidence: 0.9 }))
  };
  for (const [k, v] of Object.entries(bad)) {
    console.log(`  ${k.padEnd(12)} → ${v.mode.padEnd(10)} ran=${String(v.ran).padEnd(5)} "${v.reason.slice(0, 44)}"`);
  }
  check('every shape of nonsense falls back to FOOTAGE',
        Object.values(bad).every((v) => v.mode === 'FOOTAGE' && v.ran === false), bad);
  check('and each says why', Object.values(bad).every((v) => !!v.reason), bad);
  check('an unknown medium is named rather than silently demoted',
        /unknown medium "ANIMATION"/.test(bad.unknownMode.reason), bad.unknownMode);

  // ── The provider is gone ────────────────────────────────────────────────
  console.log('\n=== the planner is unreachable ===');
  const down = await page.evaluate(async () => {
    const realKey = window.ProviderManager.getActiveKey;
    const realChat = window.LLMAdapters.nvidiaNimChat;
    const N = 'A sentence that needs a medium.';

    window.ProviderManager.getActiveKey = () => '';
    const noKey = await window.BlvckVisualPlanner.decide({ narration: N });

    // A key IS present now, so decide() gets past available() and really calls.
    // Without this the cases below would pass for the wrong reason.
    window.ProviderManager.getActiveKey = () => 'nvapi-test';

    window.LLMAdapters.nvidiaNimChat = async () => { throw new Error('503 ResourceExhausted'); };
    const threw = await window.BlvckVisualPlanner.decide({ narration: N });

    window.LLMAdapters.nvidiaNimChat = async () => 'not json';
    const garbage = await window.BlvckVisualPlanner.decide({ narration: N });

    window.LLMAdapters.nvidiaNimChat = async () => new Promise(() => {});
    const hung = await window.BlvckVisualPlanner.decide({ narration: N });

    window.ProviderManager.getActiveKey = realKey;
    window.LLMAdapters.nvidiaNimChat = realChat;
    const noNarration = await window.BlvckVisualPlanner.decide({ narration: '' });
    return { noKey, threw, garbage, hung, noNarration };
  });
  for (const [k, v] of Object.entries(down)) {
    console.log(`  ${k.padEnd(12)} → ${v.mode.padEnd(8)} ran=${String(v.ran).padEnd(5)} "${String(v.reason).slice(0, 46)}"`);
  }
  check('an unreachable planner never blocks the pipeline — everything is FOOTAGE',
        Object.values(down).every((v) => v.mode === 'FOOTAGE' && v.ran === false), down);
  check('a provider that throws says so', /503/.test(down.threw.reason), down.threw);
  check('a call that never returns is bounded', /did not answer in/.test(down.hung.reason), down.hung);
  check('and no key is reported as unreachable', /not reachable/.test(down.noKey.reason), down.noKey);

  // ── The stage, with a stub ──────────────────────────────────────────────
  console.log('\n=== the stage over a project ===');
  const staged = await page.evaluate(async () => {
    const scenes = [
      { index: 1, subtitle: 'One.', sceneSummary: 'a' },
      { index: 2, subtitle: '', sceneSummary: 'silent' },
      { index: 3, subtitle: 'Three.', sceneSummary: 'c' }
    ];
    const seen = [];
    const summary = await window.BlvckVisualPlanner.planScenes({
      scenes,
      planner: async (args) => {
        seen.push(args);
        return { mode: 'HYPERFRAME', reason: 'stubbed', confidence: 0.7, ran: true };
      }
    });
    return { summary, seen, scenes };
  });
  console.log(`  considered ${staged.summary.considered} · planned ${staged.summary.planned} `
    + `· skipped ${staged.summary.skipped} · modes ${JSON.stringify(staged.summary.modes)}`);
  check('a beat with no narration is skipped rather than guessed at',
        staged.summary.skipped === 1 && staged.summary.considered === 2, staged.summary);
  check('the plan is written onto the scene',
        staged.scenes[0].visualStrategy.mode === 'HYPERFRAME'
        && staged.scenes[0].visualStrategy.ran === true, staged.scenes[0]);
  check('each beat is told what came before and after it',
        staged.seen[0].after === '' || typeof staged.seen[0].after === 'string', staged.seen[0]);
  check('and what the last few beats were made of, so the film can be seen whole',
        typeof staged.seen[1].recent === 'string' && staged.seen[1].recent.length > 0,
        staged.seen[1]);
  check('the opening beat knows it is the opening',
        /opening/.test(staged.seen[0].position), staged.seen[0]);

  // ── Live judgement ──────────────────────────────────────────────────────
  console.log(`\n${'='.repeat(70)}\nLIVE — three beats that cannot all be the same answer`);
  const live = [];
  for (const beat of BEATS) {
    const r = await page.evaluate(async (b) => {
      // Retried past transient provider load; this measures judgement, not uptime.
      let plan = null;
      const transient = [];
      for (let i = 0; i < 4; i++) {
        plan = await window.BlvckVisualPlanner.decide({
          narration: b.subtitle, intent: b.sceneSummary,
          position: 'a middle beat', recent: ''
        });
        if (plan.ran) break;
        transient.push(plan.reason);
        await new Promise((r2) => setTimeout(r2, 4000 * (i + 1)));
      }
      return { plan, transient };
    }, beat);
    live.push({ beat, ...r });
    for (const t of r.transient) console.log(`  waited: ${String(t).slice(0, 70)}`);
    console.log(`\n  ${beat.name}`);
    console.log(`    "${beat.subtitle.slice(0, 92)}…"`);
    console.log(`    → ${r.plan.mode}  (wanted ${beat.expect}, confidence ${r.plan.confidence})`);
    console.log(`      "${r.plan.reason}"`);
  }

  const ran = live.filter((r) => r.plan.ran);
  check('every beat reached the planner', ran.length === BEATS.length,
        live.map((r) => r.plan.reason));

  if (ran.length === BEATS.length) {
    const modes = live.map((r) => r.plan.mode);
    console.log(`\n  answers: ${modes.join(', ')}`);
    // The check that makes this test worth running.
    check('IT DOES NOT ANSWER THE SAME THING TO EVERY BEAT',
          new Set(modes).size > 1, modes);
    check('a place a camera could stand in is FOOTAGE',
          live[0].plan.mode === 'FOOTAGE', live[0].plan);
    check('a structure no camera saw is not sent looking for footage',
          live[1].plan.mode !== 'FOOTAGE', live[1].plan);
    // The assertion that was missing the first time this ran. Beat 3 came back
    // FOOTAGE because weighing a catch can be filmed - and two figures and a
    // comparison were dropped on the floor. The suite went green on a wrong
    // answer because nothing checked this one.
    check('a beat carrying BOTH a filmable event and a figure is HYBRID, not '
        + 'just the half a camera can reach',
          live[2].plan.mode === 'HYBRID', live[2].plan);
    check('every reason is about this beat rather than boilerplate',
          new Set(live.map((r) => r.plan.reason)).size === BEATS.length,
          live.map((r) => r.plan.reason));
  }

  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(),
    legacy, contract: { good, over, bad }, down, staged: staged.summary,
    live: live.map((r) => ({ beat: r.beat.name, expect: r.beat.expect, plan: r.plan })) }, null, 2));

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'THE PLANNER CHOOSES A MEDIUM, AND FAILS TO FOOTAGE'));
  console.log(`  written to ${path.relative(PROJECT, OUT)}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
