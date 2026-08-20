// A clip must show what the beat asked for, not merely rank well.
//
// This runs the ACTUAL failing intent from the reported storyboard against the
// ACTUAL provider APIs. Measured while diagnosing it, Pixabay answered "Blue
// Man Group performs on stage" with 500 hits whose top two were cows — tags:
// cow, ruminant, pasture, meadow — while genuinely relevant concert footage sat
// at positions three and four. The ranker scored provider, orientation,
// duration, resolution and licence and never looked at the subject, so the cows
// won on picture quality and the scene reported READY.
//
// So the assertion is comparative and uses live data: rank the same candidates
// with and without the relevance term, and show what each puts first.
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

// The beats that failed, exactly as the Director wrote them.
const BEATS = [
  { intent: 'The Blue Man Group performs on stage',
    queries: ['blue man group performing', 'stage performance'],
    // Words that would make a documentary editor accept the clip.
    wants: /stage|concert|band|perform|music|danc|crowd|audience|theatre|theater|drum/i },
  { intent: 'Spider-Man swings through the city',
    queries: ['spider-man swinging', 'superhero city'],
    wants: /city|skyline|building|urban|street|rooftop|skyscraper|aerial/i }
];

(async () => {
  if (!envGet('PIXABAY_API_KEY') && !envGet('PEXELS_API_KEY')) {
    console.log('SKIPPED: no stock keys in .env');
    process.exit(0);
  }

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 300000,
    args: ['--window-size=1400,950']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 120)); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((px, pe) => {
    if (px) localStorage.setItem('blvck:keys_pixabay', JSON.stringify([px]));
    if (pe) localStorage.setItem('blvck:keys_pexels', JSON.stringify([pe]));
  }, envGet('PIXABAY_API_KEY'), envGet('PEXELS_API_KEY'));
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  for (const beat of BEATS) {
    console.log(`\n=== "${beat.intent}" ===`);
    const r = await page.evaluate(async (b) => {
      const S = window.StockMedia;
      const results = await S.search({
        queries: b.queries, orientation: 'landscape', mediaType: 'video',
        minimumDuration: 3, provider: 'modern'
      });
      const describe = (a) => ({
        who: `${a.provider}:${a.id}`,
        // Whatever the asset says about itself, which is what a relevance
        // judgement has to work from.
        says: ((a.tags || []).join(', ')
               || String(a.sourceUrl || '').split('/').filter(Boolean).pop() || '(nothing)').slice(0, 80),
        px: a.width * a.height,
        relevance: a.relevance ? Math.round(a.relevance.score * 100) : null,
        matched: a.relevance ? a.relevance.matched : null
      });

      // Old behaviour: no terms, so relevanceOf returns neutral for everyone.
      const blind = S.rank(results.slice(), { orientation: 'landscape', mediaType: 'video',
                                              minimumDuration: 3, targetDuration: 9 }, new Set());
      const blindTop = describe(blind[0] || {});

      // New behaviour: the beat's own words decide the order.
      const terms = window.StockMedia._relevanceTerms(b.intent, b.queries);
      const seeing = S.rank(results.slice(), { orientation: 'landscape', mediaType: 'video',
                                              minimumDuration: 3, targetDuration: 9,
                                              terms }, new Set());
      const seeingTop = describe(seeing[0] || {});
      return {
        found: results.length, terms,
        derivedQuery: window.StockMedia._queryFromIntent(b.intent),
        blindTop, seeingTop,
        blindTop3: blind.slice(0, 3).map(describe),
        seeingTop3: seeing.slice(0, 3).map(describe)
      };
    }, beat);

    console.log(`  ${r.found} candidates · terms ${JSON.stringify(r.terms.slice(0, 7))}`);
    console.log(`  intent translated to query: "${r.derivedQuery}"`);
    console.log('  ranked by quality alone (the old order):');
    for (const a of r.blindTop3) console.log(`    ${a.who}  ${a.px}px  "${a.says}"`);
    console.log('  ranked by what it shows (now):');
    for (const a of r.seeingTop3) console.log(`    ${a.who}  ${a.relevance}%  "${a.says}"`);

    check(`"${beat.intent.slice(0, 26)}…" — candidates came back at all`, r.found > 0, r.found);
    check('the top pick now evidences the beat',
          beat.wants.test(r.seeingTop.says), r.seeingTop);
    check('and it matched real terms, not nothing',
          (r.seeingTop.matched || []).length > 0, r.seeingTop);
    check('the derived query drops the unfindable proper nouns',
          !/blue man group|spider-man/i.test(r.derivedQuery), r.derivedQuery);
  }

  // ── The floor refuses an asset that shows nothing asked for ───────────────
  console.log('\n=== the floor ===');
  const floor = await page.evaluate(() => {
    const S = window.StockMedia;
    const cow = { provider: 'pixabay', id: 'cow', width: 3840, height: 2160, duration: 12,
                  tags: ['cow', 'ruminant', 'pasture', 'meadow', 'nature', 'group'], sourceUrl: '' };
    const band = { provider: 'pixabay', id: 'band', width: 1280, height: 720, duration: 10,
                   tags: ['concert', 'stage', 'band', 'performance', 'crowd'], sourceUrl: '' };
    const silent = { provider: 'pexels', id: 'silent', width: 1920, height: 1080, duration: 10,
                     tags: [], sourceUrl: '' };
    const terms = S._relevanceTerms('The Blue Man Group performs on stage', ['stage performance']);
    const order = S.rank([cow, band, silent], { orientation: 'landscape', mediaType: 'video',
                                                minimumDuration: 3, targetDuration: 9, terms }, new Set());
    return {
      terms,
      order: order.map((a) => a.id),
      cowScore: Math.round((cow.relevance.score || 0) * 100),
      cowMatched: cow.relevance.matched,
      cowCorroborated: cow.relevance.corroborated,
      bandScore: Math.round((band.relevance.score || 0) * 100),
      bandMatched: band.relevance.matched,
      bandCorroborated: band.relevance.corroborated,
      silentKnown: silent.relevance.known,
      floor: Math.round(S._relevanceFloor() * 100)
    };
  });
  console.log(`  terms ${JSON.stringify(floor.terms)}`);
  console.log(`  cow ${floor.cowScore}% · band ${floor.bandScore}% · floor ${floor.floor}%`);
  console.log(`  order: ${floor.order.join(' → ')}`);
  check('the 4K cow loses to the 720p band', floor.order[0] === 'band', floor.order);
  check('the cow is refused for want of corroboration', floor.cowCorroborated === false,
        { cow: floor.cowScore, matched: floor.cowMatched, floor: floor.floor });
  check('the band is corroborated', floor.bandCorroborated === true, floor.bandMatched);
  check('an asset that describes nothing is not punished for it',
        floor.silentKnown === false, floor.silentKnown);

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));

  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'THE CLIP HAS TO SHOW THE THING'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
