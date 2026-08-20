// Did the five-question chain change what the Director writes?
//
// The five-beat harness deliberately uses fixed intents, so it can measure
// retrieval, ranking and vision without the Director moving underneath. That
// also means it cannot test the Director. This can.
//
// Narration -> Director -> visual intent. Nothing else runs: no search, no
// ranking, no vision. One variable.
//
// The OLD column is what the Director actually produced on the reported run,
// transcribed from the storyboard. It is a single sentence, because at that
// point a single sentence was the whole contract - subject, action,
// environment, specificity and assetStrategy did not exist in the schema. So
// the comparison is not sentence versus better sentence; it is sentence versus
// structured object, and the interesting question is what the model puts in the
// fields it now has to fill.
//
// Writes tests/live/director_intent_v1.json.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'director_intent_v1.json');
const env = fs.readFileSync(PROJECT + '/.env', 'utf8');
const envGet = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : '';
};

// The same five narrations, and what the old Director really wrote for each.
const BEATS = [
  { id: 1, name: 'Blue Man Group — stage',
    narration: 'In two thousand three, the Blue Man Group embarked on their How to Be a Megastar '
             + 'national arena tour, a performance that would showcase the power of creativity.',
    oldIntent: 'The Blue Man Group performs on stage' },
  { id: 2, name: 'Blue Man Group — audience',
    narration: "The Blue Man Group's interactive shows, with their emphasis on participation "
             + "and improvisation, demonstrate the importance of thinking on one's feet.",
    oldIntent: 'The Blue Man Group interacts with the audience' },
  { id: 3, name: 'PISA',
    narration: 'This is echoed in the results of the Programme for International Student '
             + 'Assessment, a worldwide educational assessment that evaluates the knowledge '
             + 'and skills of students.',
    oldIntent: 'A student participates in the PISA assessment' },
  { id: 4, name: 'Business success',
    narration: 'But what can we learn from these seemingly disparate sources about the path '
             + 'to success in business?',
    oldIntent: 'A person thinks deeply about the path to success' },
  { id: 5, name: 'Spider-Man',
    narration: 'Meanwhile, the Spider-Man film series, with its emphasis on determination and '
             + 'hard work, shows how ordinary people can achieve extraordinary success.',
    oldIntent: 'Spider-Man swings through the city' }
];

/** Is a query a visual concept, a name, or an idea? */
function classifyQuery(q) {
  const s = String(q || '').trim();
  if (!s) return 'EMPTY';
  // A capitalised word that is not the first token is a name in practice.
  const named = s.split(/\s+/).some((w, i) => i > 0 && /^[A-Z]/.test(w))
             || /blue man group|spider-?man|pisa/i.test(s);
  const ABSTRACT = /\b(success|path|importance|power|creativity|knowledge|thinking|idea|concept|meaning|determination)\b/i;
  const abstract = ABSTRACT.test(s);
  if (named && !abstract) return 'ENTITY';
  if (named && abstract) return 'MIXED';
  if (abstract) return 'ABSTRACT';
  return 'VISUAL';
}

(async () => {
  if (!envGet('NVIDIA_NIM_API')) { console.log('SKIPPED: no NIM key'); process.exit(0); }

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 900000,
    args: ['--window-size=1200,800']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((nim) => {
    localStorage.setItem('blvck:keys_nim', JSON.stringify([nim]));
    localStorage.setItem('blvck:director_provider', 'nim');
  }, envGet('NVIDIA_NIM_API'));
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  const model = await page.evaluate(() => window.AIManager.nim.model);
  console.log(`Director model: ${model}\n`);

  const results = [];
  for (const b of BEATS) {
    process.stdout.write(`beat ${b.id}  ${b.name.padEnd(26)}`);
    const r = await page.evaluate(async (beat) => {
      const t0 = Date.now();
      try {
        // One beat per call: clean per-beat latency, and one failure does not
        // take the other four with it. Production batches; this measures.
        const plan = await window.AIManager.generateJSON('/api/video/plan', {
          scenes: [{ index: beat.id, timestamp: '00:00:00 - 00:00:09', durationSec: 9,
                     subtitle: beat.narration, detectedAction: '', sceneSummary: '',
                     environment: '', timeOfDay: '', weather: '', lighting: '', characters: [] }],
          bible: null, characters: '', strategyBrief: '', modeBrief: '', host: '', timing: null
        }, { task: 'storyboard' });
        const s = (plan.scenes || [])[0] || null;
        return { ms: Date.now() - t0, ok: !!s, visualType: s && s.visualType,
                 requirements: s ? s.stockRequirements : null };
      } catch (e) {
        return { ms: Date.now() - t0, ok: false, error: e.message.slice(0, 200) };
      }
    }, b);
    results.push({ ...b, ...r });
    console.log(r.ok ? `${(r.ms / 1000).toFixed(1)}s` : `FAILED (${(r.ms / 1000).toFixed(1)}s) ${r.error}`);
    await new Promise((res) => setTimeout(res, 2000));
  }

  // ── Report ────────────────────────────────────────────────────────────────
  for (const r of results) {
    console.log(`\n${'─'.repeat(76)}\nBEAT ${r.id}  ${r.name}`);
    console.log(`  narration : "${r.narration.slice(0, 92)}…"`);
    console.log(`  OLD intent: "${r.oldIntent}"`);
    if (!r.ok) { console.log(`  NEW       : FAILED — ${r.error}`); continue; }
    const q = r.requirements || {};
    console.log(`  NEW intent: "${q.concept || '(none)'}"`);
    console.log('');
    console.log(`    subject          : ${q.subject || '—'}`);
    console.log(`    action           : ${q.action || '—'}`);
    console.log(`    environment      : ${q.environment || '—'}`);
    console.log(`    narrativeRole    : ${q.narrativeRole || '—'}`);
    console.log(`    requiredElements : ${(q.requiredElements || []).join(', ') || '—'}`);
    console.log(`    avoid            : ${(q.avoid || []).join(', ') || '—'}`);
    console.log(`    specificity      : ${q.specificity || '—'}`);
    console.log(`    assetStrategy    : ${q.assetStrategy || '—'}`);
    console.log(`    sourceStrategy   : ${q.sourceStrategy || '—'}`);
    console.log(`    preferredSources : ${(q.preferredSources || []).join(', ') || '—'}`);
    console.log(`    sourceReason     : ${q.sourceReason || '—'}`);
    const qs = q.queries || [];
    console.log(`    queries          :`);
    for (const one of qs) console.log(`        [${classifyQuery(one).padEnd(8)}] ${one}`);
    if ((q.fallbackQueries || []).length) {
      console.log(`    fallbackQueries  :`);
      for (const one of q.fallbackQueries) console.log(`        [${classifyQuery(one).padEnd(8)}] ${one}`);
    }
    if ((q.archiveQueries || []).length) {
      console.log(`    archiveQueries   : ${q.archiveQueries.join(' | ')}`);
    }
    const kinds = qs.map(classifyQuery);
    r.queryKinds = kinds;
    console.log(`    -> ${kinds.filter((k) => k === 'VISUAL').length}/${kinds.length} queries are VISUAL`);
  }

  console.log(`\n${'═'.repeat(76)}\nQUERY TRANSLATION\n`);
  console.log('beat  visual  entity  abstract  mixed');
  for (const r of results) {
    if (!r.queryKinds) { console.log(`  ${r.id}   (not measured)`); continue; }
    const c = (k) => r.queryKinds.filter((x) => x === k).length;
    console.log(`  ${r.id}     ${c('VISUAL')}       ${c('ENTITY')}       ${c('ABSTRACT')}        ${c('MIXED')}`);
  }

  const okCount = results.filter((r) => r.ok).length;
  console.log(`\n  ${okCount}/${results.length} Director calls succeeded`);
  console.log(`  latency: ${results.map((r) => (r.ms / 1000).toFixed(0) + 's').join(', ')}`);
  if (pageErrors.length) console.log(`  page errors: ${pageErrors.length}`);

  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), model, results }, null, 2));
  console.log(`\n  written to ${path.relative(PROJECT, OUT)}`);
  await browser.close();
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
