// Phase 10: three beats, one film, and nobody told the Planner what to pick.
//
// Every earlier test in this series forced a mode. That is the right way to
// test a route and the wrong way to accept a system, because the question an
// acceptance run has to answer is whether AETHER, handed three sentences,
// CHOOSES the right medium for each and then delivers all three into the same
// exported file.
//
// So: no mode is passed anywhere. The Planner reads the narration and decides,
// and whatever it says is what runs.
//
//   A  a place and an action, filmable            → expected FOOTAGE
//   B  a relationship between levels of authority → expected HYPERFRAME
//   C  a figure about a filmable scene            → expected HYBRID
//
// The film is made in the archival house style, which has a paper ground. That
// is not decoration: it makes the style visible IN THE EXPORTED PIXELS, so the
// last link — a look chosen in the workspace surviving all the way into the
// file — is measured rather than assumed.
//
// ONE THING IS A STAND-IN, AND IT IS SAID PLAINLY. The HYBRID beat's footage is
// a clip painted here with known colours, cached exactly where acquisition puts
// one. The claim being tested there is that the shot lands INSIDE the
// composition and survives the render, and that claim needs a colour known in
// advance to be measurable at all. The FOOTAGE beat attempts real acquisition
// first and only falls back to the stand-in if the providers cannot deliver —
// and if it falls back, this test says so in its output.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const env = fs.readFileSync(PROJECT + '/.env', 'utf8');
const envGet = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : '';
};
const OUT = path.join(PROJECT, 'tests', 'live', 'phase10_acceptance_v1.json');
const SECS = 6;                    // per beat
const ACQUIRE_BUDGET_MS = 180000;  // how long real acquisition gets before the stand-in

const fails = [];
const notes = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

const BEATS = [
  { index: 1, expect: 'FOOTAGE',
    subtitle: 'At first light the trawlers come back through the harbour mouth, riding low.',
    sceneSummary: 'fishing boats returning to harbour at dawn' },
  { index: 2, expect: 'HYPERFRAME',
    subtitle: 'Authority does not travel upward. Every level you rise is a level that can act without you.',
    sceneSummary: 'how authority thins as it moves up a hierarchy' },
  // A JUDGEMENT CALL, RECORDED. This beat first read "Two thirds of that fleet
  // never leaves the harbour at all", and the Planner answered HYPERFRAME at
  // 0.9 — the sentence is ABOUT a proportion, and nothing in it is happening on
  // camera. That is defensible, and tuning the brief until it agreed would have
  // been fitting the system to the test. So the beat was rewritten to the case
  // that is not in dispute: work being done, and a figure the shot of that work
  // cannot state.
  { index: 3, expect: 'HYBRID',
    subtitle: 'Ropes are checked and stacked along the quay each morning, though barely a '
              + 'third of these boats will put to sea this year.',
    sceneSummary: 'the morning work on the quay, and how few boats still sail' }
];

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 900000,
    args: ['--window-size=1300,900']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  // The keys the app would already have, seeded where it keeps them. Without
  // this the Planner and the Director both report themselves unreachable and
  // every beat quietly falls back to FOOTAGE — which is the safe answer, and
  // would have made this whole run look like a decision when it was an outage.
  await page.evaluate((k) => {
    if (k.nim) localStorage.setItem('blvck:keys_nim', JSON.stringify([k.nim]));
    localStorage.setItem('blvck:director_provider', 'nim');
    if (k.pexels) localStorage.setItem('blvck:pexels_key', k.pexels);
    if (k.pixabay) localStorage.setItem('blvck:pixabay_key', k.pixabay);
  }, { nim: envGet('NVIDIA_NIM_API'), pexels: envGet('PEXELS_API_KEY'),
       pixabay: envGet('PIXABAY_API_KEY') });
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  const reach = await page.evaluate(() => ({
    planner: window.BlvckVisualPlanner.available(),
    director: window.BlvckHyperFrameComposer.available(),
    stock: window.StockMedia.isConfigured()
  }));
  console.log(`  reachable: planner ${reach.planner} · director ${reach.director} · stock ${reach.stock}`);
  check('the Planner, the Director and the stock providers are all reachable',
        reach.planner && reach.director && reach.stock, reach);

  const record = { at: new Date().toISOString(), beats: [], film: null };

  // ── The film is made in one house ───────────────────────────────────────
  const house = await page.evaluate(() => {
    const S = window.BlvckHouseStyle;
    S.clearReference();
    S.set('archival');
    const t = S.current().tokens;
    return { name: S.current().name, bg: t.bg, ink: t.ink, accent: t.accent,
             maxElements: S.current().maxElements };
  });
  console.log(`=== this film is made in "${house.name}" — ground ${house.bg}, type ${house.ink}, `
    + `at most ${house.maxElements} on screen ===`);

  // ── A stand-in shot, cached where acquisition puts one ──────────────────
  const standIn = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    const stream = c.captureStream(30);
    const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.start();
    const t0 = performance.now();
    await new Promise((done) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        if (t >= 20) { rec.stop(); done(); return; }
        // A blue nobody's graphics use, so finding it in a frame means the
        // footage is there and nothing else could have put it there.
        g.fillStyle = '#1d4ed8'; g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#ffffff';
        g.font = 'bold 110px monospace';
        g.fillText(t.toFixed(1) + 's', 60, 130);
        requestAnimationFrame(tick);
      };
      tick();
    });
    await new Promise((r) => { rec.onstop = r; setTimeout(r, 2000); });
    const blob = new Blob(chunks, { type: 'video/webm' });
    const db = await new Promise((res, rej) => {
      const rq = indexedDB.open('blvck-stock-cache', 1);
      rq.onupgradeneeded = () => { const d = rq.result;
        if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets'); };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put(blob, 'pexels:p10shot');
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    localStorage.setItem('blvck:stock-cache-meta',
      JSON.stringify({ 'pexels:p10shot': { at: Date.now() } }));
    return { bytes: blob.size };
  });
  console.log(`  stand-in shot: ${(standIn.bytes / 1024).toFixed(0)}KB of #1d4ed8, 20s\n`);

  // ── A window that cannot be cut out of the file it was planned against ──
  //
  // Found by this run rather than reasoned about: a Pixabay item advertising a
  // longer runtime arrived as an 11.7s file, and the 8.0-14.0s excerpt planned
  // against the advertised figure made the export gate refuse the clip. The
  // gate was right. The excerpt is chosen before the download — deciding where
  // to cut is cheap, downloading is not — so it now gets reconciled with the
  // file once the file exists.
  console.log('=== an excerpt planned against a duration the library got wrong ===');
  const clamp = await page.evaluate(async () => {
    const S = window.StockMedia;
    const db = await new Promise((res, rej) => {
      const rq = indexedDB.open('blvck-stock-cache', 1);
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
    const blob = await new Promise((res, rej) => {
      const tx = db.transaction('assets', 'readonly');
      const g = tx.objectStore('assets').get('pexels:p10shot');
      g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error);
    });

    // The file is 20s. The catalogue says 60s and the window sits at 40-46s.
    const lying = { provider: 'pexels', id: 'liar', type: 'video', duration: 60,
                    excerpt: { required: true, applied: true, start: 40, end: 46,
                               duration: 6, sourceDuration: 60, method: 'heuristic_window' } };
    await S.reconcileExcerpt(lying, blob);

    // And one that was right all along, which must be left exactly as it was.
    const honest = { provider: 'pexels', id: 'honest', type: 'video', duration: 20,
                     excerpt: { required: true, applied: true, start: 8, end: 14,
                                duration: 6, sourceDuration: 20, method: 'heuristic_window' } };
    const before = JSON.stringify(honest.excerpt);
    await S.reconcileExcerpt(honest, blob);

    return { measured: lying.measuredDuration, claimed: lying.durationClaimed,
             window: S.excerptWindow(lying.excerpt), method: lying.excerpt.method,
             kept: lying.excerpt.duration, note: lying.excerpt.note,
             honestUnchanged: JSON.stringify(honest.excerpt) === before };
  });
  console.log(`  claimed ${clamp.claimed}s · measured ${clamp.measured}s · `
    + `window moved to ${clamp.window.in}-${clamp.window.out}s`);
  check('the file is measured rather than believed',
        clamp.measured > 19 && clamp.measured < 21 && clamp.claimed === 60, clamp);
  check('and the window is moved back inside it',
        clamp.window.out <= clamp.measured + 0.05, clamp);
  check('keeping the length the beat asked for', clamp.kept === 6, clamp);
  check('and saying it was moved rather than doing it quietly',
        /_clamped$/.test(clamp.method) && /advertised/.test(clamp.note || ''), clamp);
  check('A WINDOW THAT ALREADY FITS IS LEFT ALONE',
        clamp.honestUnchanged === true, clamp);

  // ── Lay the three beats on one timeline, then let the Planner decide ────
  console.log('=== the Planner reads three sentences ===');
  const plan = await page.evaluate(async (beats, secs) => {
    const scenes = beats.map((b, i) => ({
      index: b.index, subtitle: b.subtitle, sceneSummary: b.sceneSummary,
      status: 'pending',
      timelineStart: i * secs, timelineEnd: (i + 1) * secs,
      timestamp: `00:00:${String(i * secs).padStart(2, '0')} - `
                 + `00:00:${String((i + 1) * secs).padStart(2, '0')}`
    }));
    localStorage.setItem('blvck-tts:storyboard', JSON.stringify({
      project: { title: 'phase 10' }, cues: [], scenes, transcript: null }));
    const live = window.BlvckStoryboard.scenes();
    live.length = 0; live.push(...scenes);

    // No mode anywhere in this call. This is the whole point of the phase.
    const summary = await window.BlvckVisualPlanner.planScenes({ scenes: live, force: true });
    window.BlvckStoryboard.save();
    return {
      summary,
      chose: live.map((s) => ({ index: s.index, mode: window.BlvckVisualPlanner.strategyOf(s),
                                ran: !!(s.visualStrategy && s.visualStrategy.ran),
                                reason: (s.visualStrategy || {}).reason,
                                confidence: (s.visualStrategy || {}).confidence }))
    };
  }, BEATS, SECS);

  for (const c of plan.chose) {
    const want = BEATS.find((b) => b.index === c.index).expect;
    console.log(`  beat ${c.index}  ${String(c.mode).padEnd(10)} (wanted ${want})  ${c.reason || ''}`);
  }
  record.plan = plan.chose;

  for (const b of BEATS) {
    const got = plan.chose.find((c) => c.index === b.index);
    check(`beat ${b.index}: the Planner chose ${b.expect} unprompted`,
          got && got.ran && got.mode === b.expect, got);
  }
  check('and it did not simply give every beat the same answer',
        new Set(plan.chose.map((c) => c.mode)).size === 3, plan.chose);

  // ── An outage is not a decision ─────────────────────────────────────────
  //
  // Every beat falls back to FOOTAGE when the Planner cannot be reached, which
  // is the right behaviour and the wrong thing to accept a system on: a run
  // where NIM answered 503 would show three FOOTAGE beats and look like a
  // Planner that had made up its mind. So the run stops here rather than
  // driving routes an outage picked.
  const outage = plan.chose.filter((c) => !c.ran);
  if (outage.length) {
    for (const c of outage) console.log(`  ⚠ beat ${c.index}: ${c.reason}`);
    check('the Planner actually answered for every beat', false, outage);
    fs.writeFileSync(OUT, JSON.stringify(record, null, 2));
    console.log('\nNOT AN ACCEPTANCE RUN: the Planner was unreachable, so nothing below it '
      + 'was exercised on a real decision. Re-run when it answers.');
    await browser.close();
    process.exit(1);
  }

  // ── Whatever it chose is what runs ──────────────────────────────────────
  //
  // The route is selected from the decision, not from the beat's index or from
  // what this test expected. If the Planner changes its mind about a beat, the
  // pipeline that runs changes with it — which is the behaviour being accepted.
  for (const decided of plan.chose) {
    const idx = decided.index;
    const mode = decided.mode;
    console.log(`\n=== beat ${idx} · ${mode} ===`);

    if (mode === 'FOOTAGE') {
      const got = await page.evaluate(async (index, budget) => {
        const live = window.BlvckStoryboard.scenes();
        const scene = live.find((s) => s.index === index);
        const summary = String(scene.sceneSummary || scene.subtitle || '');
        scene.visualType = 'stock_video';
        scene.stockRequirements = {
          concept: summary,
          queries: [summary.split(/[,;]/)[0].split(' ').slice(0, 5).join(' '), summary],
          fallbackQueries: [summary.split(' ').slice(0, 2).join(' ')],
          subject: summary, action: '', setting: '',
          orientation: 'landscape', minimumDuration: 4
        };

        const out = { standIn: false };
        const S = window.StockMedia;
        if (S && S.isConfigured()) {
          try {
            const blob = await Promise.race([
              S.acquire(scene),
              new Promise((_, rej) => setTimeout(() => rej(new Error('out of time')), budget))
            ]);
            if (blob && blob.size) {
              await window.BlvckStoryboard.attachAsset(scene, blob, 'video');
              out.bytes = blob.size;
              out.asset = scene.stockAsset ? {
                provider: scene.stockAsset.provider, id: scene.stockAsset.id,
                sourceUrl: scene.stockAsset.sourceUrl,
                claimed: scene.stockAsset.durationClaimed || null,
                measured: scene.stockAsset.measuredDuration || null,
                excerpt: scene.stockAsset.excerpt || null
              } : null;
            } else { out.why = 'the providers returned nothing usable'; }
          } catch (err) { out.why = err.message; }
        } else { out.why = 'no stock provider is configured in this environment'; }

        if (!out.bytes) {
          out.standIn = true;
          const db = await new Promise((res, rej) => {
            const rq = indexedDB.open('blvck-stock-cache', 1);
            rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
          });
          const blob = await new Promise((res, rej) => {
            const tx = db.transaction('assets', 'readonly');
            const g = tx.objectStore('assets').get('pexels:p10shot');
            g.onsuccess = () => res(g.result); g.onerror = () => rej(g.error);
          });
          await window.BlvckStoryboard.attachAsset(scene, blob, 'video');
          scene.stockAsset = { provider: 'pexels', id: 'p10shot', type: 'video',
                               duration: 20, width: 1280, height: 720,
                               sourceUrl: 'https://example.invalid/p10shot',
                               queriesUsed: ['stand-in'] };
          out.bytes = blob.size;
        }
        out.builtAnything = !!scene.hyperFrame;
        window.BlvckStoryboard.save();
        return out;
      }, idx, ACQUIRE_BUDGET_MS);

      if (got.standIn) {
        notes.push(`beat ${idx} used the stand-in shot rather than real footage — ${got.why}`);
        console.log(`  ⚠ real acquisition did not deliver (${got.why}); using the stand-in`);
      } else {
        console.log(`  acquired ${got.asset.provider}:${got.asset.id} · ${(got.bytes / 1024).toFixed(0)}KB`);
        console.log(`  ${got.asset.sourceUrl}`);
        if (got.asset.claimed) {
          console.log(`  the library said ${got.asset.claimed}s; the file is `
            + `${got.asset.measured}s — the excerpt was moved to fit`);
          notes.push(`beat ${idx}: the provider's duration was wrong `
            + `(${got.asset.claimed}s claimed, ${got.asset.measured}s delivered)`);
        }
      }
      record.beats.push({ index: idx, mode, standIn: got.standIn, bytes: got.bytes,
                          asset: got.asset || null });
      check(`beat ${idx} has a clip on the timeline`, got.bytes > 0, got);
      check(`beat ${idx}: NOTHING WAS BUILT FOR IT — a filmable beat is filmed, not composed`,
            got.builtAnything === false, got);
      continue;
    }

    // HYPERFRAME or HYBRID: the same route, and it reads the mode itself.
    const r = await page.evaluate(async (index) => {
      const live = window.BlvckStoryboard.scenes();
      const scene = live.find((s) => s.index === index);
      const strategy = window.BlvckVisualPlanner.strategyOf(scene);

      // A HYBRID beat needs the shot it is going to be built around. The only
      // place the mode is consulted here, and it is consulted to fetch
      // footage — not to override what was decided.
      if (strategy === 'HYBRID') {
        scene.stockAsset = { provider: 'pexels', id: 'p10shot', type: 'video',
                             duration: 20, width: 1280, height: 720,
                             sourceUrl: 'https://example.invalid/p10shot',
                             queriesUsed: ['stand-in'],
                             excerpt: { required: true, applied: true, start: 8, end: 14,
                                        duration: 6, sourceDuration: 20 } };
      }

      const steps = [];
      const res = await window.BlvckHyperFrameComposer.runRoute(scene, {
        mode: strategy === 'HYBRID' ? 'HYBRID' : 'FULL_FRAME',
        onProgress: (s) => steps.push(s)
      });
      window.BlvckStoryboard.save();
      return { res, steps,
               hyperFrame: scene.hyperFrame || null,
               intent: scene.visualIntent || null,
               evaluation: scene.hyperFrameEvaluation || null,
               sourceHasFootage: /hf-shot/.test(scene.hyperFrameSource || ''),
               sourceHasMediaStart: /data-media-start="[\d.]+/.test(scene.hyperFrameSource || ''),
               sourceGround: (String(scene.hyperFrameSource || '')
                 .match(/html,body\{[^}]*background:([^;}]+)/) || [])[1] || '' };
    }, idx);

    if (!r.res.ok) {
      check(`beat ${idx}: built`, false, r.res);
      record.beats.push({ index: idx, mode, failed: r.res });
      continue;
    }
    console.log(`  ${r.hyperFrame.elements.join(' + ')} · ${(r.res.renderMs / 1000).toFixed(1)}s to render`
      + ` · made in ${r.hyperFrame.style}`);
    console.log(`  conveys: ${r.intent.concept}`);
    console.log(`  layout: ${r.evaluation.layout.problems.length
      ? r.evaluation.layout.problems.join('; ')
      : `clean, ${Math.round(r.evaluation.layout.density * 100)}% of the frame used`}`);
    if (r.evaluation.reading.ran) console.log(`  a viewer sees: ${r.evaluation.reading.sees}`);

    record.beats.push({ index: idx, mode, elements: r.hyperFrame.elements,
                        style: r.hyperFrame.style, renderMs: r.res.renderMs,
                        concept: r.intent.concept, evaluation: r.evaluation });

    check(`beat ${idx}: it reached a file`, r.res.ok === true, r.res);
    check(`beat ${idx}: the layout has no problems`,
          r.evaluation.layout.problems.length === 0, r.evaluation.layout);
    check(`beat ${idx}: it was made in the film's house style`,
          r.hyperFrame.style === 'archival', r.hyperFrame);
    check(`beat ${idx}: and it obeyed that house's limit of ${house.maxElements}`,
          r.hyperFrame.elements.length <= house.maxElements, r.hyperFrame);
    check(`beat ${idx}: the composition is painted on the house ground`,
          r.sourceGround.trim() === house.bg, r.sourceGround);

    if (mode === 'HYPERFRAME') {
      check(`beat ${idx}: no footage was involved at any point`,
            r.sourceHasFootage === false && !r.steps.some((s) => /footage/i.test(s)), r.steps);
    } else {
      check(`beat ${idx}: the shot is INSIDE the composition`, r.sourceHasFootage === true, r);
      check(`beat ${idx}: cut at the in-point the acquisition layer chose`,
            r.sourceHasMediaStart === true, r);
    }
  }

  // ── One film ────────────────────────────────────────────────────────────
  console.log('\n=== all three, assembled and exported ===');
  const film = await page.evaluate(async (secs) => {
    window.AetherRouter.switchWorkspace('video');
    document.getElementById('ed-assemble').click();
    for (let i = 0; i < 180; i++) {
      await new Promise((x) => setTimeout(x, 500));
      const st = window.BlvckEditorTiming._getState();
      if (st && st.clips && st.clips.length >= 3) break;
    }
    const st = window.BlvckEditorTiming._getState();
    if (!st || !st.clips || !st.clips.length) return { error: 'nothing assembled' };

    const realCreate = URL.createObjectURL.bind(URL);
    let cap = null;
    URL.createObjectURL = (b) => { if (b && /video\/webm/.test(b.type || '')) cap = b; return realCreate(b); };
    const realClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function () {};
    document.getElementById('ed-export-video').click();
    for (let i = 0; i < 300 && !cap; i++) await new Promise((x) => setTimeout(x, 500));
    URL.createObjectURL = realCreate;
    HTMLAnchorElement.prototype.click = realClick;
    if (!cap) return { error: 'no file was produced',
                       status: (document.getElementById('ed-status') || {}).textContent || '',
                       clips: st.clips.length };

    const url = realCreate(cap);
    const v = document.createElement('video');
    v.muted = true; v.src = url;
    const ok = await new Promise((res) => {
      v.onloadeddata = () => res(true); v.onerror = () => res(false);
      setTimeout(() => res(v.readyState >= 2), 25000);
    });
    if (!ok) return { error: 'the exported file would not decode', bytes: cap.size };

    // What is actually in a frame. Paper is the house ground and nothing else
    // in this film is that colour; blue is the shot and nothing else is that.
    const sampleAt = async (t) => {
      await new Promise((res) => {
        v.onseeked = () => res();
        try { v.currentTime = t; } catch (e) { res(); }
        setTimeout(res, 8000);
      });
      const c = document.createElement('canvas');
      c.width = 640; c.height = 360;
      const g = c.getContext('2d');
      g.drawImage(v, 0, 0, c.width, c.height);
      const d = g.getImageData(0, 0, c.width, c.height).data;
      let paper = 0, blue = 0, ink = 0, n = 0;
      for (let i = 0; i < d.length; i += 4 * 4) {
        const r = d[i], gr = d[i + 1], b = d[i + 2];
        n++;
        if (r > 198 && gr > 188 && b > 165 && Math.max(r, gr, b) - Math.min(r, gr, b) < 62) paper++;
        else if (b > 110 && b - r > 40 && b - gr > 30) blue++;
        else if (r < 78 && gr < 78 && b < 78) ink++;
      }
      return { t, paper: Math.round((paper / n) * 100), blue: Math.round((blue / n) * 100),
               ink: Math.round((ink / n) * 100) };
    };

    return { ok: true, bytes: cap.size, clips: st.clips.length,
             duration: Math.round(v.duration * 100) / 100,
             w: v.videoWidth, h: v.videoHeight,
             frames: [await sampleAt(secs * 0.5),
                      await sampleAt(secs * 1.5),
                      await sampleAt(secs * 2.5)] };
  }, SECS);

  record.film = film;
  if (film.error) {
    check('the three beats export as one film', false, film);
  } else {
    console.log(`  ${(film.bytes / 1024 / 1024).toFixed(1)}MB · ${film.duration}s · `
      + `${film.w}x${film.h} · ${film.clips} clips`);
    for (const f of film.frames) {
      console.log(`  at ${f.t}s   paper ${String(f.paper).padStart(3)}%   `
        + `shot ${String(f.blue).padStart(3)}%   ink ${String(f.ink).padStart(3)}%`);
    }
    // Read against what the Planner actually decided, not against where the
    // beats happen to sit. If it changes its mind, the frame that gets checked
    // for a paper ground moves with it.
    const frameOf = (mode) => {
      const at = plan.chose.findIndex((c) => c.mode === mode);
      return at >= 0 ? film.frames[at] : null;
    };
    const shot = frameOf('FOOTAGE'), built = frameOf('HYPERFRAME'), both = frameOf('HYBRID');

    check('the three beats export as one film', film.clips >= 3, film);
    check('and it runs the length of the three beats',
          Math.abs(film.duration - SECS * 3) <= 2.5, film.duration);

    check('the FOOTAGE beat is footage — no house graphics over it',
          shot && shot.paper < 8, shot);
    check('the HYPERFRAME beat IS THE HOUSE — the paper ground fills the frame',
          built && built.paper > 55, built);
    check('and it carries type on that ground', built && built.ink > 0.4, built);
    check('the HYBRID beat still has the shot in it', both && both.blue > 8, both);
    check('with the house laid over the shot rather than replacing it',
          both && both.paper > 4 && both.blue > 8, both);
    check('THE STYLE CHOSEN IN THE WORKSPACE REACHED THE EXPORTED FILE',
          built && shot && built.paper > 55 && shot.paper < 8, { built, shot });
  }

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));

  fs.writeFileSync(OUT, JSON.stringify(record, null, 2));
  console.log(`\n  written to ${path.relative(PROJECT, OUT)}`);
  if (notes.length) console.log('\nNOTES:\n  - ' + notes.join('\n  - '));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'THE PLANNER CHOSE, ALL THREE WERE MADE, AND ONE FILM CAME OUT'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
