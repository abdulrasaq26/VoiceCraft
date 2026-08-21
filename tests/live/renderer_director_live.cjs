// The Renderer's decision layer, and the three boundaries it has to keep.
//
//   it decides WHAT, never WHEN   - timing comes from the measured narration
//   it may only ask for what the compositor can draw
//   it can never block production - every failure is "nothing needed"
//
// The parser is where those are enforced rather than described, so it is tested
// directly against the shapes a model actually produces: the good ones, the
// malformed ones, and the plausible-but-unexecutable ones.
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
    defaultViewport: null, protocolTimeout: 180000,
    args: ['--window-size=1200,800']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  const P = (json) => page.evaluate((t) => window.BlvckRenderer._parseDecision(t), json);

  // ── 1. A real decision with several elements ─────────────────────────────
  console.log('=== 1. needed, with several elements ===');
  const good = await P(JSON.stringify({
    needed: true, reason: 'The footage sets the shop but not the figure.',
    elements: [
      { kind: 'stat', content: '40%', label: 'switch brands because of price',
        anchor: 'forty percent', placement: 'lower_right' },
      { kind: 'chart', label: 'Revenue', items: ['2019: 20', '2021: 28', '2023: 35'],
        anchor: 'grew every year', placement: 'lower_left' },
      { kind: 'headline', content: 'Consumer Insights 2024', anchor: 'the 2024 study' }
    ]
  }));
  console.log(`  needed ${good.needed} · ${good.elements.length} elements · "${good.reason.slice(0, 48)}"`);
  for (const e of good.elements) console.log(`    ${e.kind.padEnd(10)} anchor "${e.anchor}"  ${e.placement}`);
  check('a good decision is accepted', good.needed === true, good);
  check('every element survives', good.elements.length === 3, good.elements.length);
  check('the reason is carried', /footage sets the shop/.test(good.reason), good.reason);

  // ── 6. Plan order is the layer order ────────────────────────────────────
  check('elements keep their declared order',
        good.elements.map((e) => e.kind).join(',') === 'stat,chart,headline',
        good.elements.map((e) => e.kind));

  // ── 7. Timing is not the Director's to give ─────────────────────────────
  console.log('\n=== 7. the Director may not set timing ===');
  const timed = await P(JSON.stringify({
    needed: true, reason: 'x',
    elements: [{ kind: 'stat', content: '40%', anchor: 'forty percent',
                 start: 99, end: 123, duration: 7 }]
  }));
  const el = timed.elements[0];
  console.log(`  element keys: ${Object.keys(el).join(', ')}`);
  check('start is stripped', el.start === undefined, el);
  check('end is stripped', el.end === undefined, el);
  check('duration is stripped', el.duration === undefined, el);
  check('but the anchor phrase is kept', el.anchor === 'forty percent', el);

  // ── 5. A kind the compositor cannot draw ────────────────────────────────
  console.log('\n=== 5. an unsupported kind ===');
  const mapped = await P(JSON.stringify({
    needed: true, reason: 'geography matters here',
    elements: [
      { kind: 'map', label: 'California, Texas, Florida', anchor: 'across three states' },
      { kind: 'stat', content: '3', label: 'states', anchor: 'three states' }
    ]
  }));
  console.log(`  kept ${mapped.elements.length}, refused ${mapped.rejected.length}`);
  for (const r of mapped.rejected) console.log(`    refused: ${r.why}`);
  check('a map is refused', mapped.elements.every((e) => e.kind !== 'map'), mapped.elements);
  check('and refused visibly, not silently dropped',
        mapped.rejected.some((r) => /unsupported kind "map"/.test(r.why)), mapped.rejected);
  check('the drawable element beside it still survives',
        mapped.elements.length === 1 && mapped.elements[0].kind === 'stat', mapped.elements);

  // A data card with no data cannot be drawn either.
  const empty = await P(JSON.stringify({
    needed: true, reason: 'x', elements: [{ kind: 'chart', label: 'Revenue', anchor: 'grew' }] }));
  check('a chart with no items is refused',
        empty.needed === false && empty.rejected.some((r) => /no items/.test(r.why)), empty);

  // ── 2. A considered no ──────────────────────────────────────────────────
  console.log('\n=== 2. needed: false ===');
  const no = await P(JSON.stringify({
    needed: false, reason: 'The footage already shows the assembly line described.', elements: [] }));
  console.log(`  "${no.reason}"`);
  check('a no is a valid decision', no.needed === false && no.elements.length === 0, no);
  check('and it keeps its reason', /already shows/.test(no.reason), no.reason);

  // ── 3. Malformed output ─────────────────────────────────────────────────
  console.log('\n=== 3. malformed output ===');
  const bad = {
    prose: await P('I think a chart would be nice here, honestly.'),
    broken: await P('{"needed":true,"elements":[{"kind":"stat",}'),
    empty: await P(''),
    wrongShape: await P(JSON.stringify(['stat', 'chart'])),
    nullish: await P(JSON.stringify({ needed: true, reason: 'x', elements: null }))
  };
  for (const [k, v] of Object.entries(bad)) {
    console.log(`  ${k.padEnd(11)} needed=${v.needed}  "${String(v.reason).slice(0, 46)}"`);
  }
  check('no shape of nonsense produces elements',
        Object.values(bad).every((v) => v.needed === false && v.elements.length === 0), bad);
  check('and each says why', Object.values(bad).every((v) => !!v.reason), bad);

  // ── 4. The provider is gone ─────────────────────────────────────────────
  console.log('\n=== 4. the Director is unreachable ===');
  const down = await page.evaluate(async () => {
    const realKey = window.ProviderManager.getActiveKey;
    const realChat = window.LLMAdapters.nvidiaNimChat;
    const N = 'Forty percent switch brands.';

    // No key at all: the call is never attempted.
    window.ProviderManager.getActiveKey = () => '';
    const noKey = await window.BlvckRenderer.decide({ narration: N });

    // A key IS present, so decide() gets past available() and actually calls.
    // Without this the throw, the timeout and the garbage cases below never run
    // at all - they bail at the availability check and pass for the wrong
    // reason. This test page has no NIM key of its own, which is exactly how
    // the first version of this silently proved nothing.
    window.ProviderManager.getActiveKey = () => 'nvapi-test';

    window.LLMAdapters.nvidiaNimChat = async () => { throw new Error('503 ResourceExhausted'); };
    const threw = await window.BlvckRenderer.decide({ narration: N });

    window.LLMAdapters.nvidiaNimChat = async () => 'not json at all, sorry';
    const garbage = await window.BlvckRenderer.decide({ narration: N });

    window.LLMAdapters.nvidiaNimChat = async () => new Promise(() => {});   // never settles
    const hung = await window.BlvckRenderer.decide({ narration: N });

    window.ProviderManager.getActiveKey = realKey;
    window.LLMAdapters.nvidiaNimChat = realChat;
    const noNarration = await window.BlvckRenderer.decide({ narration: '' });
    return { noKey, threw, garbage, hung, noNarration };
  });
  for (const [k, v] of Object.entries(down)) {
    console.log(`  ${k.padEnd(12)} needed=${v.needed} ran=${v.ran}  "${String(v.reason).slice(0, 44)}"`);
  }
  check('an unreachable Director yields a valid no',
        Object.values(down).every((v) => v.needed === false && Array.isArray(v.elements)), down);
  check('and never throws', true);
  check('a provider that throws is reported as a failure, not a considered no',
        down.threw.ran === false && /the Director failed/.test(down.threw.reason)
        && /503/.test(down.threw.reason), down.threw);
  check('a reply that is not JSON yields a no with a reason',
        down.garbage.ran === true && down.garbage.needed === false
        && /did not answer in JSON/.test(down.garbage.reason), down.garbage);
  check('a call that never returns is bounded rather than hanging the beat',
        down.hung.ran === false && /did not answer in/.test(down.hung.reason), down.hung);
  check('and no key at all is reported as unreachable',
        /not reachable/.test(down.noKey.reason), down.noKey);

  // ── Timing comes from the measured narration ────────────────────────────
  console.log('\n=== timing is applied downstream ===');
  const anchored = await page.evaluate(() => {
    const words = 'Today forty percent of shoppers switch brands because of price'.split(' ');
    const transcript = {
      source: 'whisper', audioDuration: 10,
      segments: [{ start: 0, end: 6, text: words.join(' '),
                   words: words.map((w, i) => ({ word: w, start: i * 0.5, end: i * 0.5 + 0.5 })) }]
    };
    const shot = { timelineStart: 0, timelineEnd: 8 };
    const els = [{ kind: 'stat', content: '40%', anchor: 'forty percent',
                   items: [], placement: 'lower_right', enabled: true }];
    const out = window.BlvckRenderer._applyTiming(els, shot, transcript);
    return { n: out.length, first: out[0] || null };
  });
  console.log(`  ${JSON.stringify(anchored.first)}`);
  check('the anchor became a window', !!anchored.first && anchored.first.end > anchored.first.start, anchored);
  check('and it landed on the spoken words, not the shot start',
        anchored.first && anchored.first.spokenAt > 0, anchored.first);
  check('recording which words it was anchored to',
        anchored.first && !!anchored.first.anchoredTo, anchored.first);

  // ── The three kind lists must agree ─────────────────────────────────────
  console.log('\n=== the contract matches the compositor ===');
  const agree = await page.evaluate(() => {
    const R = window.BlvckRenderer, G = window.BlvckGraphic;
    const missing = R.PANEL_KINDS.filter((k) => !(G.PANEL_KINDS || {})[k]);
    return { panel: R.PANEL_KINDS, missing,
             mapOffered: R.SUPPORTED_KINDS.indexOf('map') >= 0,
             placementsAgree: R.PLACEMENTS.every((p) => !!(G.PANEL_PLACEMENTS || {})[p]) };
  });
  console.log(`  ${JSON.stringify(agree)}`);
  check('every panel kind the Director may ask for can be drawn',
        agree.missing.length === 0, agree.missing);
  check('every placement it may ask for exists', agree.placementsAgree === true, agree);
  check('a map is never offered in the first place', agree.mapOffered === false, agree);

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'THE DIRECTOR DECIDES WHAT, AND ONLY WHAT IT CAN DRAW'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
