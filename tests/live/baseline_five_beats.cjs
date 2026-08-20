// The five-beat baseline, as one controlled experiment.
//
// Three rankings over ONE candidate pool per beat, so the only thing differing
// between them is the ranking algorithm:
//
//   A  ORIGINAL   provider, orientation, duration, resolution. The algorithm as
//                 it was before any of this work. This is the column that chose
//                 swans for a beat about a stage show.
//   B  METADATA   A, plus relevance scored from what the asset says about
//                 itself. Isolates what the retrieval fix alone bought.
//   C  VISION     B, plus looking at the actual frame. Isolates whether the
//                 vision layer contributes anything metadata did not already.
//
// One pool, one provider response, one configuration. Nothing historical is
// mixed in: where the originally reported run is quoted it is labelled as such
// and is NOT presented as part of the comparison.
//
// Every candidate that reaches inspection is recorded with the exact frame URL
// handed to the model, and that URL is checked to belong to the asset it claims
// to. That check is here because a thumbnail silently resolving to an
// uploader's avatar is precisely the bug that invalidated the previous
// baseline, and no description could have revealed it - only the address.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const NO_VISION = process.argv.includes('--no-vision');
const OUT = path.join(PROJECT, 'tests', 'live', 'baseline_five_beats.json');

const env = fs.readFileSync(PROJECT + '/.env', 'utf8');
const envGet = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : '';
};

// Fixed for the whole experiment. Changing any of these between beats would
// make the comparison meaningless.
const CONFIG = { orientation: 'landscape', mediaType: 'video', minimumDuration: 3,
                 targetDuration: 9, provider: 'modern' };

// What the reported storyboard actually produced, kept for context only.
const BEATS = [
  {
    id: 1,
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
    historical: 'swans on water'
  },
  {
    id: 2,
    name: 'Blue Man Group — interacting with the audience',
    narration: "The Blue Man Group's interactive shows, with their emphasis on participation "
             + "and improvisation, demonstrate the importance of thinking on one's feet.",
    intent: {
      concept: 'The Blue Man Group interacts with the audience',
      subject: 'a performer and a crowd', action: 'audience taking part in a live show',
      environment: 'a theatre or arena',
      requiredElements: ['people watching or taking part'],
      avoid: ['animals', 'empty scenery'],
      specificity: 'specific_person'
    },
    queries: ['audience participation live show', 'crowd at a performance'],
    historical: 'swans on water (again)'
  },
  {
    id: 3,
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
    historical: 'a student reading at a desk'
  },
  {
    id: 4,
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
    historical: 'a man standing by a fence'
  },
  {
    id: 5,
    name: 'Spider-Man — swinging through the city',
    narration: 'Meanwhile, the Spider-Man film series, with its emphasis on determination and '
             + 'hard work, shows how ordinary people can achieve extraordinary success.',
    intent: {
      concept: 'Spider-Man swings through the city',
      subject: 'a figure moving above the street', action: 'airborne movement between buildings',
      environment: 'a dense city',
      requiredElements: ['an urban environment', 'a sense of height or movement'],
      avoid: ['a static skyline with nothing happening', 'a swinging park bench',
              'any swinging object that is not a person'],
      specificity: 'specific_person'
    },
    queries: ['spider-man swinging', 'city rooftops aerial'],
    historical: 'hands resting on an open book'
  }
];

/** Does this frame demonstrably belong to this asset? */
function frameBelongsTo(asset) {
  const url = String(asset.picture || '');
  if (!url) return { ok: false, why: 'no frame at all' };
  if (url.indexOf('/user/') >= 0) return { ok: false, why: 'an uploader avatar' };
  // Both providers put the asset id in the frame path.
  if (url.indexOf(String(asset.id)) >= 0) return { ok: true, why: 'the id is in the path' };
  return { ok: false, why: 'the id does not appear in the frame URL' };
}

(async () => {
  if (!envGet('PIXABAY_API_KEY') && !envGet('PEXELS_API_KEY')) {
    console.log('SKIPPED: no stock keys'); process.exit(0);
  }
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 900000,
    args: ['--window-size=1400,950']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((nim, px, pe) => {
    if (nim) localStorage.setItem('blvck:keys_nim', JSON.stringify([nim]));
    if (px) localStorage.setItem('blvck:keys_pixabay', JSON.stringify([px]));
    if (pe) localStorage.setItem('blvck:keys_pexels', JSON.stringify([pe]));
    localStorage.setItem('blvck:director_provider', 'nim');
  }, envGet('NVIDIA_NIM_API'), envGet('PIXABAY_API_KEY'), envGet('PEXELS_API_KEY'));
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  const results = [];
  for (const beat of BEATS) {
    process.stdout.write(`\nbeat ${beat.id}  ${beat.name}\n  retrieving…`);
    const r = await page.evaluate(async (b, cfg, skipVision) => {
      const S = window.StockMedia;
      const E = window.BlvckVisualEvaluator;
      const describe = (a) => ({
        id: `${a.provider}:${a.id}`, provider: a.provider, assetId: String(a.id),
        title: String(a.sourceUrl || '').split('/').filter(Boolean).pop() || '',
        sourceUrl: a.sourceUrl || '',
        picture: a.thumbnailUrl || a.previewUrl || '',
        providerFrames: (a.frames || []).length,
        tags: (a.tags || []).slice(0, 8),
        px: a.width * a.height, duration: a.duration
      });

      const t0 = Date.now();
      const pool = await S.search({ queries: b.queries, orientation: cfg.orientation,
        mediaType: cfg.mediaType, minimumDuration: cfg.minimumDuration, provider: cfg.provider });
      const retrievalMs = Date.now() - t0;

      const base = { orientation: cfg.orientation, mediaType: cfg.mediaType,
                     minimumDuration: cfg.minimumDuration, targetDuration: cfg.targetDuration };

      // A — the original algorithm, on this same pool.
      const tA = Date.now();
      const rankA = S.rank(pool.slice(), base, new Set());
      // B — plus metadata relevance.
      const terms = S._relevanceTerms(b.intent.concept, b.queries);
      const rankB = S.rank(pool.slice(), Object.assign({ terms }, base), new Set());
      const metadataMs = Date.now() - tA;

      const out = {
        poolSize: pool.length, terms, retrievalMs, metadataMs,
        A: rankA[0] ? describe(rankA[0]) : null,
        B: rankB[0] ? Object.assign(describe(rankB[0]), {
             metaPct: Math.round(((rankB[0].relevance || {}).score || 0) * 100) }) : null,
        candidates: rankB.slice(0, 8).map((a, i) => Object.assign(describe(a), {
          metadataRank: i + 1,
          metaPct: Math.round(((a.relevance || {}).score || 0) * 100)
        }))
      };
      if (skipVision) { out.vision = { skipped: true }; return out; }

      const ev = await E.evaluate({ narration: b.narration, intent: b.intent,
                                    candidates: rankB, specificity: b.intent.specificity });
      out.vision = {
        ran: ev.ran, verdict: ev.verdict, confidence: ev.confidence || null,
        floor: ev.floor != null ? Math.round(ev.floor * 100) : null,
        why: ev.why || '', tookMs: ev.tookMs || 0,
        timing: ev.timing || null, described: ev.described || 0, legible: ev.legible || 0,
        C: ev.selected ? Object.assign(describe(ev.selected.asset), {
             finalPct: Math.round(ev.selected.score * 100),
             classification: ev.selected.judgement.classification,
             entity: ev.selected.judgement.entity,
             sees: ev.selected.judgement.sees }) : null,
        judged: (ev.scored || []).map((x) => Object.assign(describe(x.asset), {
          finalPct: Math.round(x.score * 100),
          classification: x.judgement.classification,
          entity: x.judgement.entity,
          sees: x.judgement.sees,
          sawPicture: x.judgement.sawPicture
        }))
      };
      return out;
    }, beat, CONFIG, NO_VISION);

    r.beat = { id: beat.id, name: beat.name, narration: beat.narration,
               intent: beat.intent, queries: beat.queries, historical: beat.historical };
    results.push(r);
    process.stdout.write(`  ${r.poolSize} candidates`);
    if (!NO_VISION) process.stdout.write(`  ·  vision ${r.vision.verdict} (${r.vision.tookMs}ms)`);
    process.stdout.write('\n');
  }

  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), config: CONFIG,
                                         noVision: NO_VISION, results }, null, 2));

  // ── The report ────────────────────────────────────────────────────────────
  const line = (n) => console.log('─'.repeat(n));
  for (const r of results) {
    console.log('');
    line(76);
    console.log(`BEAT ${r.beat.id}  ${r.beat.name}`);
    console.log(`  narration : "${r.beat.narration.slice(0, 88)}…"`);
    console.log(`  intent    : "${r.beat.intent.concept}"`);
    console.log(`  queries   : ${JSON.stringify(r.beat.queries)}`);
    console.log(`  pool      : ${r.poolSize} candidates  (retrieval ${r.retrievalMs}ms, `
              + `metadata ranking ${r.metadataMs}ms)`);
    console.log('');
    console.log(`  A ORIGINAL  ${r.A ? `${r.A.id}  "${(r.A.tags.join(', ') || r.A.title).slice(0, 54)}"` : '—'}`);
    console.log(`  B METADATA  ${r.B ? `${r.B.id}  ${r.B.metaPct}%  "${(r.B.tags.join(', ') || r.B.title).slice(0, 48)}"` : '—'}`);
    if (r.vision.skipped) { console.log('  C VISION    (not run)'); continue; }
    const C = r.vision.C;
    console.log(`  C VISION    ${C ? `${C.id}  ${C.finalPct}%  ${C.classification}  entity=${C.entity}`
                                   : `— ${r.vision.verdict}${r.vision.why ? ` (${r.vision.why})` : ''}`}`);
    if (C) console.log(`              sees: "${C.sees}"`);
    console.log('');
    console.log(`  latency   : vision ${r.vision.timing ? r.vision.timing.visionMs : '?'}ms · `
              + `judge ${r.vision.timing ? r.vision.timing.judgeMs : '?'}ms · `
              + `total ${r.retrievalMs + r.metadataMs + r.vision.tookMs}ms`);
    console.log(`  looked at ${r.vision.described}, legible ${r.vision.legible}, floor ${r.vision.floor}%`);
    if (r.vision.judged.length) {
      console.log('\n  every candidate inspected:');
      for (const j of r.vision.judged) {
        const prov = frameBelongsTo(j);
        console.log(`    ${String(j.finalPct).padStart(3)}%  ${j.classification.padEnd(20)} `
                  + `entity=${j.entity.padEnd(10)} "${j.sees.slice(0, 62)}"`);
        console.log(`          library : ${(j.tags.join(', ') || j.title).slice(0, 66)}`);
        console.log(`          frame   : ${j.picture.slice(0, 70)}`);
        console.log(`          belongs : ${prov.ok ? 'yes — ' : 'NO — '}${prov.why}`);
      }
    }
    console.log(`\n  historical (the reported run, different pool): ${r.beat.historical}`);
  }

  // ── Did looking change the answer? ────────────────────────────────────────
  console.log('');
  line(76);
  console.log('DID LOOKING CHANGE THE ANSWER?\n');
  let changed = 0, same = 0, unmeasured = 0;
  for (const r of results) {
    if (r.vision.skipped || !r.vision.C) {
      unmeasured++;
      console.log(`  beat ${r.beat.id}  not measured (${r.vision.skipped ? 'vision skipped' : r.vision.verdict})`);
      continue;
    }
    const b = r.B ? r.B.id : '';
    const c = r.vision.C.id;
    if (b === c) { same++; console.log(`  beat ${r.beat.id}  same winner        ${c}`); }
    else { changed++; console.log(`  beat ${r.beat.id}  CHANGED  ${b} -> ${c}`); }
  }
  console.log(`\n  changed ${changed} · unchanged ${same} · not measured ${unmeasured} · of ${results.length}`);
  console.log(`\n  full evidence written to ${path.relative(PROJECT, OUT)}`);
  if (pageErrors.length) console.log(`\n  page errors: ${pageErrors.length}`);

  await browser.close();
  // The harness reports; it does not pass or fail. Judging the results is the
  // point, and a green tick would invite skipping that.
  process.exit(0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
