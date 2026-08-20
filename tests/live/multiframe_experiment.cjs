// 6E — does temporal evidence improve action understanding?
//
// A video is temporal; a single still is not. "Spider-Man swings through the
// city" is the clearest case: one frame can show a city, a person, buildings
// and sky without ever showing the swing.
//
// DESIGN
// Nothing changes except the amount of visual evidence: same beats, same
// candidate pools, same intent, same queries, same metadata ranking, same judge
// model, same thresholds, same prompt wording. N=4, which the baseline proved
// preserves every decision it made.
//
// Each clip is decoded ONCE at five temporal positions and every frame is
// described once. The 1/2/3/5-frame configurations are then composed from those
// same descriptions, so a configuration differs from its neighbour only in how
// much evidence the judge is shown - not in which frames happened to be
// captured, and not in run-to-run variation in the describer. That costs 20
// vision calls per beat instead of 36, and removes a confound at the same time.
//
// Architecture A, forced: the vision endpoint refuses more than one image per
// prompt ("At most 1 image(s) may be provided in one prompt"), so a single
// multi-image inspection is not available to test against.
//
// The describer is never told the narration. That contamination was measured
// once already and is not being reintroduced to save calls.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const ONLY = process.argv.find((a) => /^--beats=/.test(a));
const BEAT_IDS = ONLY ? ONLY.split('=')[1].split(',').map(Number) : [5, 2];
const OUT = path.join(PROJECT, 'tests', 'live', 'frame_sampling_v1.json');

const FRACTIONS = [0.1, 0.3, 0.5, 0.7, 0.9];
// Which of the five captured positions each configuration is allowed to see.
const CONFIGS = { 1: [2], 2: [0, 4], 3: [0, 2, 4], 5: [0, 1, 2, 3, 4] };

const env = fs.readFileSync(PROJECT + '/.env', 'utf8');
const envGet = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : '';
};

(async () => {
  const baseline = JSON.parse(fs.readFileSync(
    path.join(PROJECT, 'tests', 'live', 'baseline_five_beats.json'), 'utf8'));

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 900000,
    args: ['--window-size=1200,800', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message.slice(0, 110)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((nim, px, pe) => {
    if (nim) localStorage.setItem('blvck:keys_nim', JSON.stringify([nim]));
    if (px) localStorage.setItem('blvck:keys_pixabay', JSON.stringify([px]));
    if (pe) localStorage.setItem('blvck:keys_pexels', JSON.stringify([pe]));
  }, envGet('NVIDIA_NIM_API'), envGet('PIXABAY_API_KEY'), envGet('PEXELS_API_KEY'));
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  const report = { at: new Date().toISOString(), fractions: FRACTIONS, configs: CONFIGS, beats: [] };

  for (const id of BEAT_IDS) {
    const b = baseline.results.find((r) => r.beat.id === id);
    if (!b) continue;
    const shortlist = b.candidates.filter((c) => c.metadataRank <= 4);
    console.log(`\n${'═'.repeat(72)}\nBEAT ${id}  ${b.beat.name}`);
    console.log(`  intent: "${b.beat.intent.concept}"`);
    console.log(`  shortlist: ${shortlist.map((c) => c.id).join(', ')}`);
    console.log('  decoding and describing five positions per clip…');

    const out = await page.evaluate(async (beat, ids, fractions, configs) => {
      const S = window.StockMedia;
      const E = window.BlvckVisualEvaluator;
      const pool = await S.search({ queries: beat.queries, orientation: 'landscape',
        mediaType: 'video', minimumDuration: 3, provider: 'modern' });
      const terms = S._relevanceTerms(beat.intent.concept, beat.queries);
      const ranked = S.rank(pool.slice(), { orientation: 'landscape', mediaType: 'video',
        minimumDuration: 3, targetDuration: 9, terms }, new Set());
      const byId = new Map(ranked.map((a) => [`${a.provider}:${a.id}`, a]));

      async function framesOf(asset, fracs) {
        // Provider frames when they exist, chosen for temporal coverage.
        if ((asset.frames || []).length >= fracs.length) {
          const n = asset.frames.length;
          return fracs.map((f) => ({ url: asset.frames[Math.min(n - 1, Math.round(f * (n - 1)))],
                                     fraction: f, source: 'provider' }));
        }
        // Otherwise decode. Costs one download per clip, not one per frame.
        const v = document.createElement('video');
        v.muted = true; v.playsInline = true; v.crossOrigin = 'anonymous'; v.preload = 'auto';
        v.src = asset.previewVideoUrl || asset.downloadUrl;
        const ok = await new Promise((res) => {
          v.onloadeddata = () => res(true); v.onerror = () => res(false);
          setTimeout(() => res(v.readyState >= 2), 30000);
        });
        if (!ok || !v.duration || !v.videoWidth) return [];
        const got = [];
        for (const f of fracs) {
          const t = Math.max(0.05, Math.min(v.duration * f, v.duration - 0.05));
          await new Promise((res) => {
            v.onseeked = () => res(); try { v.currentTime = t; } catch (e) { res(); }
            setTimeout(res, 8000);
          });
          const c = document.createElement('canvas');
          const scale = Math.min(1, 640 / v.videoWidth);
          c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
          try {
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
            got.push({ url: c.toDataURL('image/jpeg', 0.7), fraction: f,
                       at: Math.round(t * 100) / 100, source: 'decoded' });
          } catch (e) { /* a frame that will not copy is skipped */ }
        }
        return got;
      }

      const t0 = Date.now();
      const cands = [];
      for (const cid of ids) {
        const asset = byId.get(cid);
        if (!asset) { cands.push({ id: cid, error: 'not in this pool' }); continue; }
        const frames = await framesOf(asset, fractions);
        const seen = [];
        for (const fr of frames) {
          const d = await E._describe({ thumbnailUrl: fr.url });
          seen.push({ fraction: fr.fraction, at: fr.at || null, source: fr.source,
                      sees: d.sees || '', error: d.error || null });
        }
        cands.push({ id: cid, provider: asset.provider, tags: (asset.tags || []).slice(0, 8),
                     frameSource: frames.length ? frames[0].source : 'none',
                     frames: seen });
      }
      const describeMs = Date.now() - t0;

      // Compose each configuration from the SAME descriptions and judge it.
      const runs = {};
      for (const [n, picks] of Object.entries(configs)) {
        const described = cands.filter((c) => c.frames && c.frames.some((f) => f.sees))
          .map((c) => {
            const chosen = picks.map((i) => c.frames[i]).filter((f) => f && f.sees);
            const joined = chosen.length > 1
              ? chosen.map((f, i) => `frame ${i + 1} of ${chosen.length}: ${f.sees}`).join(' ')
              : (chosen[0] ? chosen[0].sees : '');
            return { asset: byId.get(c.id), sees: joined, sawPicture: true, frameCount: chosen.length };
          }).filter((d) => d.sees && d.asset);
        if (!described.length) { runs[n] = { verdict: 'NOT_EVALUATED', why: 'nothing described' }; continue; }

        const tj = Date.now();
        let answer = null, err = null;
        try {
          answer = await window.LLMAdapters.nvidiaNimChat({
            model: E.JUDGE_MODEL,
            messages: [{ role: 'user', content:
              E._judgePrompt(beat.narration, beat.intent, described, beat.intent.specificity) }],
            temperature: 0.1, max_tokens: 700
          });
        } catch (e) { err = e.message; }
        const judgeMs = Date.now() - tj;
        const map = answer ? E._parseScores(answer) : null;
        if (!map) { runs[n] = { verdict: 'NOT_EVALUATED', why: err || 'unparseable', judgeMs }; continue; }

        const scored = described.map((d, i) => {
          const j = map.get(i + 1);
          return j ? { id: `${d.asset.provider}:${d.asset.id}`, score: E._combine(j, d.asset),
                       classification: j.classification, entity: j.entity, fit: j.fit,
                       sees: d.sees.slice(0, 150) } : null;
        }).filter(Boolean).sort((a, b) => b.score - a.score);

        const floor = E.floorFor(beat.intent.specificity);
        const rank = E._classRank;
        const need = floor >= 0.66 ? 3 : 2;
        const best = scored[0];
        const passes = best && best.score >= floor
          && best.classification !== 'contradictory' && rank[best.classification] >= need;
        runs[n] = {
          verdict: passes ? 'SELECTED' : 'NO_SUITABLE_ASSET',
          floor: Math.round(floor * 100), judgeMs,
          selected: passes ? { id: best.id, pct: Math.round(best.score * 100),
                               classification: best.classification, entity: best.entity } : null,
          table: scored.slice(0, 4).map((s) => ({ id: s.id, pct: Math.round(s.score * 100),
                                                  classification: s.classification, entity: s.entity }))
        };
      }
      return { describeMs, candidates: cands, runs };
    }, b.beat, shortlist.map((c) => c.id), FRACTIONS, CONFIGS);

    report.beats.push({ id, name: b.beat.name, intent: b.beat.intent.concept,
                        baseline: b.vision.C ? { id: b.vision.C.id, pct: b.vision.C.finalPct,
                                                 classification: b.vision.C.classification }
                                             : { verdict: b.vision.verdict },
                        ...out });

    console.log(`  described in ${(out.describeMs / 1000).toFixed(1)}s\n`);
    for (const c of out.candidates) {
      if (c.error) { console.log(`  ${c.id}  ${c.error}`); continue; }
      console.log(`  ${c.id}  (${c.frameSource})`);
      for (const f of c.frames) {
        console.log(`     ${String(Math.round(f.fraction * 100)).padStart(3)}%  ${(f.sees || '(' + f.error + ')').slice(0, 92)}`);
      }
    }
    console.log('\n  frames  verdict            selected                    judge ms');
    for (const n of Object.keys(CONFIGS)) {
      const r = out.runs[n];
      const sel = r.selected ? `${r.selected.id} ${r.selected.pct}% ${r.selected.classification}` : '—';
      console.log(`  ${n.padEnd(8)}${(r.verdict || '').padEnd(19)}${sel.padEnd(28)}${r.judgeMs || '?'}`);
    }
  }

  fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
  console.log(`\nwritten to ${path.relative(PROJECT, OUT)}`);
  await browser.close();
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
