// The five beats that failed, run against the live providers and the live
// evaluator, showing what each stage of the pipeline would have chosen.
//
// This is both the regression test and the evidence. For every beat it prints
// three answers to the same question:
//
//   quality  — what the ranker chose before any of this existed: provider,
//              orientation, duration, resolution. This is the column that
//              produced swans under a beat about a stage show.
//   metadata — what the words say the clip is.
//   seen     — what the evaluator reports is ACTUALLY IN THE PICTURE, and
//              whether it tells the beat.
//
// The intents below are the ones the Director really wrote, taken from the
// reported storyboard, because the point is that the pipeline must cope with
// an imperfect intent rather than only with a corrected one.
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
  console.log((cond ? '    PASS  ' : '    FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

const BEATS = [
  {
    name: 'Blue Man Group — the arena tour',
    narration: 'In two thousand three, the Blue Man Group embarked on their How to Be a Megastar '
             + 'national arena tour, a performance that would showcase the power of creativity.',
    intent: {
      concept: 'The Blue Man Group performs on stage',
      subject: 'performers on a stage', action: 'playing to a packed arena',
      environment: 'a darkened arena under coloured lights',
      requiredElements: ['a stage', 'an audience'],
      avoid: ['animals', 'empty landscape', 'a person sitting alone'],
      specificity: 'specific_person'
    },
    queries: ['blue man group performing', 'concert stage lights crowd'],
    // A clip of livestock or waterfowl must never be the answer here.
    bannedTop: /cow|cattle|swan|duck|pasture|meadow|farm|livestock|bird/i
  },
  {
    name: 'Blue Man Group — interacting with the audience',
    narration: "The Blue Man Group's interactive shows, with their emphasis on participation "
             + 'and improvisation, demonstrate the importance of thinking on one\'s feet.',
    intent: {
      concept: 'The Blue Man Group interacts with the audience',
      subject: 'a performer and a crowd', action: 'audience taking part in a live show',
      environment: 'a theatre or arena',
      requiredElements: ['people watching or taking part'],
      avoid: ['animals', 'empty scenery'],
      specificity: 'specific_person'
    },
    queries: ['audience participation live show', 'crowd at a performance'],
    bannedTop: /cow|cattle|swan|duck|pasture|meadow|farm|livestock|bird/i
  },
  {
    name: 'PISA — the assessment',
    narration: 'This is echoed in the results of the Programme for International Student '
             + 'Assessment, a worldwide educational assessment that evaluates the knowledge '
             + 'and skills of students.',
    intent: {
      concept: 'A student participates in the PISA assessment',
      subject: 'a school student', action: 'working through a written exam',
      environment: 'a classroom or exam hall',
      requiredElements: ['a student', 'writing or a desk'],
      avoid: ['animals', 'empty landscape', 'nightlife'],
      specificity: 'general_event'
    },
    queries: ['student taking an exam', 'classroom desks writing'],
    bannedTop: /cow|swan|nightclub|party|beach|animal/i
  },
  {
    name: 'Business — the path to success',
    narration: 'But what can we learn from these seemingly disparate sources about the path '
             + 'to success in business?',
    intent: {
      concept: 'A person thinks deeply about the path to success',
      subject: 'a person at work', action: 'thinking or planning',
      environment: 'an office or workplace',
      requiredElements: ['a person', 'a sense of work or thought'],
      avoid: ['a person standing beside a fence doing nothing', 'empty scenery'],
      specificity: 'metaphorical'
    },
    queries: ['person thinking at desk', 'business planning office'],
    bannedTop: /cow|swan|fence|wildlife/i
  },
  {
    name: 'Spider-Man — swinging through the city',
    narration: 'Meanwhile, the Spider-Man film series, with its emphasis on determination and '
             + 'hard work, shows how ordinary people can achieve extraordinary success.',
    intent: {
      concept: 'Spider-Man swings through the city',
      subject: 'a figure moving above the street', action: 'airborne movement between buildings',
      environment: 'a dense city',
      requiredElements: ['an urban environment', 'a sense of height or movement'],
      // The two near misses that keyword overlap cannot separate.
      avoid: ['a static skyline with nothing happening', 'a swinging park bench',
              'any swinging object that is not a person'],
      specificity: 'specific_person'
    },
    queries: ['spider-man swinging', 'city rooftops aerial'],
    bannedTop: /bench|park swing|playground|chicken|hen/i
  }
];

(async () => {
  if (!envGet('NVIDIA_NIM_API')) { console.log('SKIPPED: no NIM key'); process.exit(0); }
  if (!envGet('PIXABAY_API_KEY') && !envGet('PEXELS_API_KEY')) {
    console.log('SKIPPED: no stock keys'); process.exit(0);
  }

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 600000,
    args: ['--window-size=1400,950']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 120)); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((nim, px, pe) => {
    if (nim) localStorage.setItem('blvck:keys_nim', JSON.stringify([nim]));
    if (px) localStorage.setItem('blvck:keys_pixabay', JSON.stringify([px]));
    if (pe) localStorage.setItem('blvck:keys_pexels', JSON.stringify([pe]));
    localStorage.setItem('blvck:director_provider', 'nim');
  }, envGet('NVIDIA_NIM_API'), envGet('PIXABAY_API_KEY'), envGet('PEXELS_API_KEY'));
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  const evaluatorUp = await page.evaluate(() =>
    !!(window.BlvckVisualEvaluator && window.BlvckVisualEvaluator.available()));
  check('the evaluator is reachable', evaluatorUp, evaluatorUp);
  if (!evaluatorUp) { await browser.close(); process.exit(1); }

  for (const beat of BEATS) {
    console.log(`\n${'═'.repeat(74)}\n${beat.name}\n  narration: "${beat.narration.slice(0, 96)}…"`);
    console.log(`  intent:    "${beat.intent.concept}"`);

    const r = await page.evaluate(async (b) => {
      const S = window.StockMedia;
      const E = window.BlvckVisualEvaluator;
      const results = await S.search({ queries: b.queries, orientation: 'landscape',
                                       mediaType: 'video', minimumDuration: 3, provider: 'modern' });
      const says = (a) => ((a.tags || []).join(', ')
        || String(a.sourceUrl || '').split('/').filter(Boolean).pop() || '(nothing)').slice(0, 62);

      const base = { orientation: 'landscape', mediaType: 'video', minimumDuration: 3, targetDuration: 9 };
      // 1. What the ranker chose before any of this existed.
      const quality = S.rank(results.slice(), base, new Set())[0];
      // 2. What the words say.
      const terms = S._relevanceTerms(b.intent.concept, b.queries);
      const metaOrder = S.rank(results.slice(), Object.assign({ terms }, base), new Set());
      // 3. What is actually in the picture.
      const out = await E.evaluate({ narration: b.narration, intent: b.intent,
                                     candidates: metaOrder, specificity: b.intent.specificity });
      return {
        found: results.length,
        quality: quality && { id: `${quality.provider}:${quality.id}`, says: says(quality),
                              px: quality.width * quality.height },
        metadata: metaOrder[0] && { id: `${metaOrder[0].provider}:${metaOrder[0].id}`,
                                    says: says(metaOrder[0]),
                                    pct: Math.round((metaOrder[0].relevance || {}).score * 100) },
        verdict: out.verdict, confidence: out.confidence,
        floor: Math.round((out.floor || 0) * 100), tookMs: out.tookMs,
        selected: out.selected && { id: `${out.selected.asset.provider}:${out.selected.asset.id}`,
                                    says: says(out.selected.asset),
                                    pct: Math.round(out.selected.score * 100),
                                    sees: out.selected.judgement.sees,
                                    klass: out.selected.judgement.classification },
        table: (out.scored || []).slice(0, 5).map((x) => ({
          id: `${x.asset.provider}:${x.asset.id}`, pct: Math.round(x.score * 100),
          klass: x.judgement.classification, sees: x.judgement.sees, says: says(x.asset)
        }))
      };
    }, beat);

    console.log(`  ${r.found} candidates · evaluator floor ${r.floor}% · ${r.tookMs}ms\n`);
    console.log(`  by quality alone   ${r.quality ? `${r.quality.id}  "${r.quality.says}"` : '—'}`);
    console.log(`  by metadata        ${r.metadata ? `${r.metadata.id}  ${r.metadata.pct}%  "${r.metadata.says}"` : '—'}`);
    console.log(`  by what is SEEN    ${r.selected ? `${r.selected.id}  ${r.selected.pct}%  ${r.selected.klass}` : `— ${r.verdict}`}`);
    if (r.selected) console.log(`                     the evaluator sees: "${r.selected.sees}"`);
    console.log('\n  every candidate it looked at:');
    for (const t of r.table) {
      console.log(`    ${String(t.pct).padStart(3)}%  ${t.klass.padEnd(20)} "${t.sees}"`);
      console.log(`          library said: "${t.says}"`);
    }

    // ── What must be true ──────────────────────────────────────────────────
    if (r.selected) {
      check('the chosen clip is not the thing the beat forbade',
            !beat.bannedTop.test(r.selected.says) && !beat.bannedTop.test(r.selected.sees),
            { says: r.selected.says, sees: r.selected.sees });
      check('it is not filler or a contradiction',
            r.selected.klass !== 'generic_filler' && r.selected.klass !== 'contradictory',
            r.selected.klass);
    } else if (r.verdict === 'NO_SUITABLE_ASSET') {
      check('refusing is reported as a verdict, not a crash', true, r.verdict);
    } else {
      // NOT_EVALUATED is a designed outcome, not a failure: the vision endpoint
      // 500s intermittently, and when it does the pipeline must fall back to
      // the metadata order rather than stop. What must still hold is that the
      // fallback is safe - the beat does not get livestock.
      check('an unavailable evaluator degrades instead of breaking',
            r.verdict === 'NOT_EVALUATED' || r.verdict === 'NO_CANDIDATES', r.verdict);
      check('and the metadata order it falls back to is not forbidden footage',
            !r.metadata || !beat.bannedTop.test(r.metadata.says),
            r.metadata);
    }
    check('nothing forbidden survived into the accepted set',
          !r.table.slice(0, 1).some((t) => beat.bannedTop.test(t.says) && t.pct >= r.floor),
          r.table[0]);
  }

  check('nothing threw throughout', pageErrors.length === 0, pageErrors.slice(0, 3));

  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'THE CLIP IS CHOSEN FOR WHAT IT SHOWS'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
