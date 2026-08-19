// Four distinct beats on one topic, through the live Director.
//
// The bar is not that the strings differ. It is that each beat's visual intent
// is a shot, is about THAT beat, and does not repeat its neighbour's picture.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');

const env = fs.readFileSync(PROJECT + '/.env', 'utf8');
const envGet = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim() : '';
};

const PORT = process.argv[2] || '3491';

// Related but genuinely distinct — the shape that produced the duplicate.
// Each carries its own concrete subject, so a repeated shot is a real failure
// rather than an arguable one.
// Related but genuinely distinct, and long enough that each one fills a beat
// on its own at Balanced pacing (~39 words). Without timestamps the merger
// splits on word budget, so short sentences collapse into a single beat and the
// distinctness question never gets asked.
const BEATS = [
  { text: 'A single database now holds several hundred downloadable movie scripts and screenplays, '
        + 'stored as plain text files that anyone with a browser can open, search through line by '
        + 'line, and download to read offline whenever they want.',
    wants: ['database', 'archive', 'screen', 'listing', 'catalog', 'catalogue', 'library', 'shelf', 'document', 'file', 'text'] },
  { text: 'Researchers sit for hours at library terminals and personal laptops, working through the '
        + 'archive one query at a time, hunting for material that used to require a written request '
        + 'and a long wait before anyone could even see it.',
    wants: ['research', 'search', 'computer', 'desk', 'reading', 'scroll', 'librarian', 'student', 'laptop', 'monitor', 'terminal', 'library'] },
  { text: 'The same collection quietly preserves thousands of recordings of unproduced radio shows, '
        + 'captured on magnetic tape decades ago by broadcasters who never aired a single one of '
        + 'them and simply filed the reels away.',
    wants: ['radio', 'tape', 'reel', 'microphone', 'broadcast', 'recording', 'audio', 'cassette', 'studio', 'magnetic'] },
  { text: 'Some of those reels had not been played in more than fifty years, sitting in sealed metal '
        + 'canisters on basement shelving where the labels faded and the dust settled thick enough '
        + 'to hide the handwriting underneath.',
    wants: ['reel', 'dust', 'shelf', 'shelv', 'canister', 'projector', 'tape', 'archive', 'box', 'vintage', 'metal', 'basement', 'label'] }
];

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

const words = (s) => String(s || '').toLowerCase().match(/[a-z]{4,}/g) || [];

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null,
    protocolTimeout: 900000,
    args: ['--window-size=1400,950', '--disable-features=CalculateNativeWinOcclusion']
  });
  const page = (await browser.pages())[0];
  const t0 = Date.now();
  const at = () => ((Date.now() - t0) / 1000).toFixed(0).padStart(5) + 's';
  page.on('pageerror', (e) => console.log(`${at()}  [pageerror] ${e.message.slice(0, 120)}`));
  page.on('console', (m) => {
    const t = m.text();
    if (/Provider|NIM|Qwen/i.test(t)) console.log(`${at()}  ${t.slice(0, 130)}`);
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.evaluate((nim, px, pe, beats) => {
    localStorage.clear();
    if (nim) localStorage.setItem('blvck:keys_nim', JSON.stringify([nim]));
    if (px) localStorage.setItem('blvck:keys_pixabay', JSON.stringify([px]));
    if (pe) localStorage.setItem('blvck:keys_pexels', JSON.stringify([pe]));
    localStorage.setItem('blvck-tts:script-last', JSON.stringify({ script: beats.map((b) => b.text).join(' ') }));
    localStorage.setItem('blvck-tts:subs-last', JSON.stringify({
      cues: beats.map((b, i) => ({
        index: i,
        timestamp: `00:00:${String(i * 7).padStart(2, '0')} - 00:00:${String(i * 7 + 7).padStart(2, '0')}`,
        text: b.text
      }))
    }));
  }, envGet('NVIDIA_NIM_API'), envGet('PIXABAY_API_KEY'), envGet('PEXELS_API_KEY'), BEATS);

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(() => {
    document.querySelectorAll('.workspace-page').forEach((p) => { p.hidden = true; });
    const sb = document.getElementById('workspace-storyboard');
    if (sb) sb.hidden = false;
  });
  await page.evaluate(() => { const el = document.getElementById('sb-import'); if (el) el.click(); });
  await new Promise((r) => setTimeout(r, 1500));

  console.log(`${at()}  planning with the live Director (NIM) — this takes minutes\n`);
  await page.evaluate(() => document.getElementById('sb-analyze').click());

  const deadline = Date.now() + 780000;
  let lastPhase = '';
  while (Date.now() < deadline) {
    const st = await page.evaluate(() => ({
      label: (document.querySelector('#sb-analyze .btn-label') || {}).textContent || '',
      busy: !!document.getElementById('sb-analyze').disabled,
      planned: (JSON.parse(localStorage.getItem('blvck-tts:storyboard') || '{}').scenes || [])
        .filter((s) => s.stockRequirements).length
    }));
    const phase = st.label.replace(/\s+\d+s$/, '');
    if (phase !== lastPhase) { console.log(`${at()}  ${phase}`); lastPhase = phase; }
    if (!st.busy && st.planned > 0) break;
    await new Promise((r) => setTimeout(r, 2000));
  }

  const scenes = await page.evaluate(() => {
    const sb = JSON.parse(localStorage.getItem('blvck-tts:storyboard') || '{}');
    return (sb.scenes || []).map((s) => ({
      i: s.index,
      narration: (s.subtitle || '').slice(0, 74),
      visualType: s.visualType,
      concept: (s.stockRequirements || {}).concept || '',
      queries: ((s.stockRequirements || {}).queries || []).slice(0, 2)
    }));
  });

  console.log(`\n${at()}  === what the Director produced ===\n`);
  for (const s of scenes) {
    console.log(`  beat ${s.i}  [${s.visualType}]`);
    console.log(`    narration : ${s.narration}`);
    console.log(`    intent    : ${s.concept}`);
    console.log(`    queries   : ${JSON.stringify(s.queries)}`);
    console.log('');
  }

  const planned = scenes.filter((s) => s.concept);
  check('every beat got a visual intent', planned.length === scenes.length && scenes.length > 0,
        { planned: planned.length, scenes: scenes.length });

  console.log('--- no two beats share a shot ---');
  for (let a = 0; a < planned.length; a++) {
    for (let b = a + 1; b < planned.length; b++) {
      const A = planned[a], B = planned[b];
      check(`beat ${A.i} and beat ${B.i} differ`, A.concept !== B.concept, A.concept);
      // Near-duplication matters more than exact: "browses a collection of
      // scripts" vs "holds a script, looking through its pages" are different
      // strings and the same picture.
      const wa = new Set(words(A.concept)), wb = new Set(words(B.concept));
      const shared = [...wa].filter((w) => wb.has(w));
      const overlap = shared.length / Math.max(1, Math.min(wa.size, wb.size));
      check(`beat ${A.i} and beat ${B.i} are not near-duplicates (${Math.round(overlap * 100)}% shared)`,
            overlap < 0.6, { shared, a: A.concept, b: B.concept });
    }
  }

  console.log('\n--- each intent is about its own beat ---');
  for (const s of planned) {
    const spec = BEATS[s.i] || BEATS[s.i - 1];
    if (!spec) continue;
    const text = (s.concept + ' ' + s.queries.join(' ')).toLowerCase();
    const hits = spec.wants.filter((w) => text.includes(w));
    check(`beat ${s.i} names something from its own narration`, hits.length > 0,
          { intent: s.concept, expectedAnyOf: spec.wants });
    if (hits.length) console.log(`         matched: ${hits.join(', ')}`);
  }

  fs.writeFileSync(__dirname + '/intent_run.json', JSON.stringify(scenes, null, 2));
  await page.screenshot({ path: __dirname + '/intent_run.png', fullPage: true });
  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'EACH BEAT GOT ITS OWN SHOT'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
