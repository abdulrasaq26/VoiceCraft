// One real beat, all the way through the real provider.
//
// Everything about the Renderer is now proven except the boundary that matters
// most: what NIM actually returns, meeting the parser that was written for it.
// The contract tests cover every shape I could imagine. This covers the shape
// it really produces.
//
// The raw response is captured for diagnosis by wrapping the adapter, but every
// assertion is made against the PARSED result. The parser is the contract; if
// the live answer disagrees with it, that is evidence about the answer, and the
// parser only changes if the answer exposes a genuine gap rather than an
// inconvenient one.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'renderer_smoke_v1.json');
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

// Three beats, chosen so the answers cannot be echoes.
//
// The first version of this test used a narration about "forty percent of
// shoppers switching brands because of price" - which is verbatim the worked
// example inside the Director's own prompt. It came back byte-identical to that
// example and passed every assertion, proving only that the model can copy.
//
// So none of these share vocabulary, subject or shape with the example. One
// wants a sequence, one wants a comparison, and one wants nothing at all
// because the picture already carries the sentence.
const BEATS = [
  { name: 'a sequence of dated events',
    expect: 'a timeline - the shot cannot show three years',
    wants: true, preferKinds: ['timeline'],
    narration: 'Surveying started in nineteen thirty-three, the towers were topped out '
             + 'two years later, and the first cars crossed in nineteen thirty-seven.',
    intent: 'A long suspension bridge standing in fog',
    queries: ['suspension bridge fog', 'golden gate bridge'] },

  { name: 'a comparison between values',
    expect: 'a chart - three values compared, each its own item',
    wants: true, preferKinds: ['chart'],
    narration: 'A cargo ship moves a tonne of freight on about three grams of fuel '
             + 'per kilometre. A lorry needs roughly twenty. A plane, five hundred.',
    intent: 'A container ship at sea seen from above',
    queries: ['container ship aerial ocean', 'cargo ship sea'] },

  { name: 'a sentence the picture already carries',
    expect: 'nothing - the footage IS the sentence',
    wants: false, preferKinds: [],
    narration: 'The waves break against the rocks over and over in the grey light before dawn.',
    intent: 'Waves crashing on dark rocks at dawn',
    queries: ['waves crashing rocks', 'ocean waves rocks dawn'] }
];

(async () => {
  if (!envGet('NVIDIA_NIM_API')) { console.log('SKIPPED: no NIM key'); process.exit(0); }

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 300000,
    args: ['--window-size=1200,800']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });
  page.on('console', (m) => {
    const t = m.text();
    if (/Renderer/.test(t)) console.log('  [console] ' + t.slice(0, 150));
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((nim, px, pe) => {
    if (nim) localStorage.setItem('blvck:keys_nim', JSON.stringify([nim]));
    if (px) localStorage.setItem('blvck:keys_pixabay', JSON.stringify([px]));
    if (pe) localStorage.setItem('blvck:keys_pexels', JSON.stringify([pe]));
    localStorage.setItem('blvck:director_provider', 'nim');
  }, envGet('NVIDIA_NIM_API'), envGet('PIXABAY_API_KEY'), envGet('PEXELS_API_KEY'));
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  const SUPPORTED = await page.evaluate(() => window.BlvckRenderer.SUPPORTED_KINDS);
  const PLACEMENTS = await page.evaluate(() => window.BlvckRenderer.PLACEMENTS);
  const results = [];

  for (const beat of BEATS) {
    console.log(`\n${'='.repeat(72)}\n${beat.name.toUpperCase()}`);
    console.log(`  narrator: "${beat.narration}"`);
    console.log(`  expected: ${beat.expect}`);

    // ── Real footage ───────────────────────────────────────────────────────
    const media = await page.evaluate(async (b) => {
      const S = window.StockMedia;
      const pool = await S.search({ queries: b.queries, orientation: 'landscape',
        mediaType: 'video', minimumDuration: 3, provider: 'modern' });
      if (!pool.length) return { error: 'nothing came back from the libraries' };
      const terms = S._relevanceTerms(b.intent, b.queries);
      const ranked = S.rank(pool.slice(), { orientation: 'landscape', mediaType: 'video',
        minimumDuration: 3, targetDuration: 9, terms }, new Set());
      const a = ranked[0];
      return { id: `${a.provider}:${a.id}`, picture: a.thumbnailUrl || a.previewUrl || '',
               says: (a.tags || []).join(', ') };
    }, beat);
    if (media.error) { check(`${beat.name}: footage was found`, false, media.error); continue; }
    console.log(`  footage : ${media.id}  "${media.says.slice(0, 56)}"`);

    // ── Real vision description ────────────────────────────────────────────
    const seen = await page.evaluate(async (pic) => {
      const d = await window.BlvckVisualEvaluator._describe({ thumbnailUrl: pic });
      return { sees: d.sees || '', sawPicture: !!d.sawPicture, error: d.error || null };
    }, media.picture);
    console.log(`  vision  : "${seen.sees || '(' + seen.error + ')'}"`);

    // ── The real Director ──────────────────────────────────────────────────
    const run = await page.evaluate(async (b, mediaSays, sees) => {
      const words = b.narration.replace(/[.,]/g, '').split(/\s+/);
      const transcript = {
        source: 'whisper', audioDuration: words.length * 0.4,
        segments: [{ start: 0, end: words.length * 0.4, text: words.join(' '),
                     words: words.map((w, i) => ({ word: w, start: i * 0.4, end: i * 0.4 + 0.4 })) }]
      };
      const shot = { timelineStart: 0, timelineEnd: words.length * 0.4 };

      // Keep the raw answer for diagnosis. The real call still goes through.
      const real = window.LLMAdapters.nvidiaNimChat;
      let raw = null, reqChars = 0;
      window.LLMAdapters.nvidiaNimChat = async (opts) => {
        reqChars = (opts.messages && opts.messages[0] && opts.messages[0].content || '').length;
        const answer = await real(opts);
        raw = answer;
        return answer;
      };

      // NIM answers 503 ResourceExhausted when its worker pool is full. That is
      // provider load, not a contract failure, and production correctly treats
      // it as "nothing needed". This test exists to see the LIVE OUTPUT, so it
      // waits past transient exhaustion. The attempt count is recorded, because
      // how often a real beat has to wait is evidence about whether production
      // should retry too — a separate question from the contract.
      const t0 = Date.now();
      let decision = null, attempts = 0;
      const transient = [];
      while (attempts < 6) {
        attempts++;
        decision = await window.BlvckRenderer.decide({
          narration: b.narration, intent: b.intent,
          mediaDescription: sees, mediaSays, shot, transcript
        });
        if (decision.ran) break;
        transient.push(decision.reason);
        if (!/503|ResourceExhausted|did not answer in/.test(decision.reason)) break;
        await new Promise((r) => setTimeout(r, 4000 * attempts));
      }
      window.LLMAdapters.nvidiaNimChat = real;
      return { decision, raw, reqChars, ms: Date.now() - t0, attempts, transient };
    }, beat, media.says, seen.sees);

    const d = run.decision;
    for (const t of run.transient) console.log(`  waited  : ${String(t).slice(0, 88)}`);
    console.log(`  answered in ${(run.ms / 1000).toFixed(1)}s over ${run.attempts} attempt(s)`);
    console.log(`\n  raw: ${String(run.raw || '(nothing)').replace(/\n/g, ' ').slice(0, 620)}`);
    console.log(`\n  DECIDED  needed=${d.needed} ran=${d.ran}`);
    console.log(`  because  "${d.reason}"`);
    for (const e of (d.elements || [])) {
      console.log(`    ${e.kind.padEnd(10)} "${String(e.content || e.label).slice(0, 30)}"`
        + (e.items.length ? ` [${e.items.join(' | ').slice(0, 46)}]` : '')
        + `\n${' '.repeat(15)}anchor "${e.anchor}" -> ${e.start}s-${e.end}s`
        + (e.anchoredTo ? ` on "${e.anchoredTo}"` : ' (shot window — the phrase was not found)')
        + `  ${e.placement}`);
    }
    for (const r of (d.rejected || [])) console.log(`    refused: ${r.why}`);

    results.push({ beat, media, vision: seen, raw: run.raw, decision: d,
                   ms: run.ms, attempts: run.attempts, promptChars: run.reqChars });

    // ── The contract, per beat ─────────────────────────────────────────────
    const N = beat.name;
    check(`${N}: the call reached NIM and ran`, d.ran === true, { reason: d.reason });
    check(`${N}: needed is a boolean`, typeof d.needed === 'boolean', typeof d.needed);
    check(`${N}: a reason survives parsing`, typeof d.reason === 'string' && d.reason.length > 0, d.reason);

    // The one thing every beat must prove: it is not the prompt's example
    // coming back. If it is, this beat measured nothing.
    check(`${N}: the answer is not an example from the prompt coming back`,
          !/forty percent|switch brands because of price|Region A|the yard opened/i
            .test(String(run.raw || '')),
          String(run.raw || '').slice(0, 160));
    check(`${N}: no placeholder from the JSON template was left in`,
          !(d.elements || []).some((e) => /^<|>$/.test(e.kind + e.content + e.placement)),
          d.elements);

    // ── The judgement, not the contract ────────────────────────────────────
    // These can fail while every contract assertion passes. That is the whole
    // reason they are here: the first live run produced a drawable element that
    // was editorially wrong, and nothing in the contract could notice.
    check(`${N}: judged correctly whether a graphic is warranted`,
          d.needed === beat.wants,
          { decided: d.needed, expected: beat.wants, because: d.reason });
    if (beat.wants && d.needed) {
      const kinds = (d.elements || []).map((e) => e.kind);
      check(`${N}: chose a fitting form (wanted ${beat.preferKinds.join(' or ')})`,
            kinds.some((k) => beat.preferKinds.indexOf(k) >= 0), kinds);
      check(`${N}: every anchor is a point, not a passage`,
            (d.elements || []).every((e) => e.anchor.split(/\s+/).length <= 6),
            (d.elements || []).map((e) => `${e.anchor.split(/\s+/).length}w: ${e.anchor}`));
    }

    for (const e of (d.elements || [])) {
      check(`${N}: "${e.kind}" is a kind the compositor can draw`, SUPPORTED.indexOf(e.kind) >= 0, e.kind);
      check(`${N}: "${e.placement}" is a placement that exists`, PLACEMENTS.indexOf(e.placement) >= 0, e.placement);
      check(`${N}: a ${e.kind} carries what it needs to be drawn`,
            ['chart', 'timeline', 'checklist'].indexOf(e.kind) < 0 ? !!(e.content || e.label)
              : e.items.length > 0, e);
      check(`${N}: no model-supplied timing survived on the ${e.kind}`,
            !Object.prototype.hasOwnProperty.call(e, 'duration'), Object.keys(e));
      check(`${N}: the ${e.kind}'s window is real and forward`,
            Number.isFinite(e.start) && Number.isFinite(e.end) && e.end > e.start, [e.start, e.end]);
      check(`${N}: the ${e.kind} carries an anchor phrase`,
            typeof e.anchor === 'string' && e.anchor.length > 0, e.anchor);
      check(`${N}: the ${e.kind} landed on words actually spoken`, !!e.anchoredTo,
            { anchor: e.anchor, note: 'fell back to the shot window' });
    }
  }

  // ── Across the three beats ───────────────────────────────────────────────
  console.log(`\n${'='.repeat(72)}\nWHAT THE THREE BEATS SHOW`);
  for (const r of results) {
    const kinds = (r.decision.elements || []).map((e) => e.kind).join(', ') || '—';
    console.log(`  ${r.beat.name.padEnd(38)} needed=${String(r.decision.needed).padEnd(5)} ${kinds}`);
  }
  const ran = results.filter((r) => r.decision.ran);
  const yes = ran.filter((r) => r.decision.needed);
  check('every beat reached the Director', ran.length === BEATS.length,
        `${ran.length}/${BEATS.length}`);
  check('the Director does not answer identically to every beat',
        new Set(ran.map((r) => JSON.stringify((r.decision.elements || []).map((e) => e.kind)))).size > 1,
        ran.map((r) => (r.decision.elements || []).map((e) => e.kind)));
  check('it says yes to a beat carrying information the picture cannot show',
        yes.length > 0, ran.map((r) => r.decision.needed));
  check('and no to a beat whose footage already IS the sentence',
        results.length === 3 && results[2].decision.needed === false,
        results[2] && { needed: results[2].decision.needed, reason: results[2].decision.reason });

  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), results }, null, 2));

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'THE LIVE DIRECTOR MEETS THE CONTRACT'));
  console.log(`  written to ${path.relative(PROJECT, OUT)}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
