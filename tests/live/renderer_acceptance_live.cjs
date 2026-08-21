// One complete real scene, from a sentence to a file you could upload.
//
// Nothing here is mocked. The narration is a real sentence; the footage is
// searched, judged and downloaded from the real libraries; the vision model
// really looks at it; NVIDIA NIM really decides what belongs on it; the editor
// really assembles it; MediaRecorder really encodes it in real time; and the
// assertions are made on the decoded file, not on the pipeline's opinion of it.
//
// ONE HONEST GAP, stated rather than papered over: the project is on the
// ESTIMATED clock, because forced alignment needs the Fish endpoint and its
// tunnel is offline. That is a real configuration - a project before alignment
// - and the element lands on the shot's own window, which is what the Renderer
// does when a phrase cannot be located in measured audio. The measured path,
// where anchorOverlay places a card on the words actually spoken, is covered by
// overlay_characterisation and renderer_stage_live but is NOT exercised end to
// end here. Synthesising word timings and calling that end-to-end would have
// been worse than saying so.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'renderer_acceptance_v1.json');
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

const SECONDS = 8;

// A beat whose sentence carries something the picture cannot: three compared
// quantities. Deliberately unrelated to every example inside the Director's
// prompt, so a card here means it reasoned rather than copied.
const SCENE = {
  index: 1,
  timestamp: '00:00:00 - 00:00:08',
  subtitle: 'A cargo ship moves a tonne of freight on about three grams of fuel per '
          + 'kilometre. A lorry needs roughly twenty. A plane, five hundred.',
  sceneSummary: 'A container ship at sea, seen from above',
  camera: 'aerial wide',
  duration: SECONDS,
  status: 'pending',
  visualType: 'stock_video',
  stockRequirements: {
    concept: 'A container ship at sea seen from above',
    queries: ['container ship aerial ocean', 'cargo ship sea aerial'],
    orientation: 'landscape',
    minimumDuration: 3
  }
};

(async () => {
  if (!envGet('NVIDIA_NIM_API')) { console.log('SKIPPED: no NIM key'); process.exit(0); }
  if (!envGet('PIXABAY_API_KEY') && !envGet('PEXELS_API_KEY')) {
    console.log('SKIPPED: no stock library key'); process.exit(0);
  }

  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 400000,
    args: ['--window-size=1400,950', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });
  page.on('console', (m) => {
    const t = m.text();
    if (/StockMedia|Renderer|export|rights/i.test(t)) console.log('  · ' + t.slice(0, 150));
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((nim, px, pe) => {
    if (nim) localStorage.setItem('blvck:keys_nim', JSON.stringify([nim]));
    if (px) localStorage.setItem('blvck:keys_pixabay', JSON.stringify([px]));
    if (pe) localStorage.setItem('blvck:keys_pexels', JSON.stringify([pe]));
    localStorage.setItem('blvck:director_provider', 'nim');
    localStorage.removeItem('blvck-tts:storyboard');
  }, envGet('NVIDIA_NIM_API'), envGet('PIXABAY_API_KEY'), envGet('PEXELS_API_KEY'));
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  console.log(`narration: "${SCENE.subtitle}"\n`);

  // ── 1. Real footage, through the real acquisition path ──────────────────
  console.log('1. acquiring footage…');
  const got = await page.evaluate(async (scene) => {
    const t0 = Date.now();
    const s = JSON.parse(JSON.stringify(scene));
    let blob = null, error = null;
    try {
      blob = await window.StockMedia.acquire(s, { provider: 'modern', strategy: 'video' });
    } catch (e) { error = e.message; }
    if (!blob) return { error: error || 'nothing was acquired', ms: Date.now() - t0 };

    // Stored exactly as the storyboard stores it, so the editor finds it where
    // it always looks.
    const SBM = window.BlvckStoryboard;
    const live = SBM.scenes();
    live.length = 0;
    live.push(s);
    await SBM.attachAsset(s, blob, 'video');

    return { ms: Date.now() - t0, bytes: blob.size, type: blob.type,
             asset: s.stockAsset, evaluation: s.visualEvaluation || null };
  }, SCENE);

  if (got.error) {
    check('real footage was acquired', false, got.error);
  } else {
    console.log(`   ${got.asset.provider}:${got.asset.id}  ${(got.bytes / 1024 / 1024).toFixed(1)}MB `
      + `${got.asset.width}x${got.asset.height}  in ${(got.ms / 1000).toFixed(1)}s`);
    console.log(`   the vision model saw: "${(got.evaluation && got.evaluation.best
      && got.evaluation.best.sees) || '(not judged)'}"`);
    check('real footage was acquired from a stock library', got.bytes > 0, got);
    // A per-item licence object is an archive.org thing. Pixabay and Pexels are
    // catalogue-licensed - the terms belong to the library, not the clip - so
    // license is null here by design, and asserting otherwise would have been
    // asserting a bug into existence. What must travel either way is where the
    // footage came from, because that is the one thing you cannot reconstruct
    // after the fact.
    check('provenance travels with the clip — provider, id and source URL',
          !!(got.asset.provider && got.asset.id && got.asset.sourceUrl),
          { provider: got.asset.provider, id: got.asset.id, sourceUrl: got.asset.sourceUrl });
    check('and an excerpt window was planned for a clip longer than the beat',
          !!got.asset.excerpt, got.asset.excerpt);
  }

  // ── 2. The real Director, over the real project ─────────────────────────
  console.log('\n2. asking the Director…');
  const decided = await page.evaluate(async () => {
    const t0 = Date.now();
    // NIM times out or answers 503 when its shared worker pool is full. That is
    // provider load, and production correctly treats it as "nothing needed" -
    // measured on this very test, which once came back with a valid export and
    // no card because the Director had not answered within 60s. This test is
    // measuring the pipeline, not the provider's uptime, so it waits.
    let summary = null, attempts = 0;
    const transient = [];
    while (attempts < 5) {
      attempts++;
      summary = await window.BlvckRenderer.runStage({ force: true });
      if (summary.decided > 0) break;
      transient.push((summary.beats[0] || {}).reason || 'no reason');
      await new Promise((r) => setTimeout(r, 5000 * attempts));
    }
    const sb = JSON.parse(localStorage.getItem('blvck-tts:storyboard') || 'null');
    const scene = (sb && sb.scenes || [])[0] || {};
    return { ms: Date.now() - t0, summary, attempts, transient,
             elements: scene.rendererElements || null,
             decision: scene.rendererDecision || null,
             measured: !!(sb && sb.transcript) };
  });
  for (const t of (decided.transient || [])) console.log(`   waited: ${String(t).slice(0, 88)}`);
  console.log(`   ${(decided.ms / 1000).toFixed(1)}s over ${decided.attempts} attempt(s) `
    + `— "${(decided.decision || {}).reason}"`);
  for (const e of (decided.elements || [])) {
    console.log(`   ${e.kind}  "${e.content || e.label}"  [${(e.items || []).join(' | ')}]`);
    console.log(`      anchor "${e.anchor}" -> ${e.start}s–${e.end}s`
      + (e.anchoredTo ? ` on measured words "${e.anchoredTo}"` : ' (the shot window — this project is unaligned)'));
  }
  check('the Director answered for the real beat',
        !!(decided.decision && decided.decision.ran), decided.decision);
  check('and it asked for something the picture cannot show',
        (decided.elements || []).length > 0, decided.decision);

  const el = (decided.elements || [])[0] || null;
  if (el) {
    check('the element is drawable — the compositor was asked before it was accepted',
          await page.evaluate((e) => window.BlvckGraphic.canDrawPanel(e).ok, el), el);
    check('its window sits inside the shot, and came from the shot not the model',
          el.start >= 0 && el.end <= SECONDS + 0.001 && el.end > el.start,
          { start: el.start, end: el.end, shot: SECONDS });
    console.log(`   (this project is on the ${decided.measured ? 'measured' : 'estimated'} clock)`);
  }

  // ── 3. Assemble and export — twice, as a counterfactual ─────────────────
  //
  // The obvious proof - the card is absent before its window and present
  // inside it - cannot be run here, and the reason is itself the finding. This
  // project is unaligned, so the anchor phrase cannot be located in measured
  // audio and the element correctly holds the WHOLE shot: 0.1s to 7.9s of an
  // 8s beat. There is no outside to sample. The first version of this test
  // sampled two points, both inside, got identical numbers, and would have
  // reported "the backing darkens that rectangle" on sensor noise.
  //
  // So the same real scene is exported twice - once as the pipeline produced
  // it, once with the element removed - and the same frame is compared. The
  // second export is a deliberate counterfactual, not a mock: it is the same
  // footage through the same encoder, differing only in the thing being
  // measured.
  console.log(`\n3. assembling and recording ${SECONDS}s in real time, twice…`);
  const film = await page.evaluate(async (secs, element) => {
    window.AetherRouter.switchWorkspace('video');
    const btn = document.getElementById('ed-assemble');
    if (!btn) return { error: 'no assemble button' };
    btn.click();
    for (let i = 0; i < 120; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const st = window.BlvckEditorTiming._getState();
      if (st && st.clips && st.clips.length) break;
    }
    const st0 = window.BlvckEditorTiming._getState();
    const clip = st0 && st0.clips && st0.clips[0];
    if (!clip) return { error: 'nothing assembled' };
    const carried = (clip.rendererElements || []).length;
    const hasVideo = !!clip.video;

    // Where the card actually lands, asked of the compositor rather than
    // recomputed here. The first version of this test reimplemented the
    // placement maths, and when the panel started being fitted uniformly and
    // lifted clear of the caption band, the test went on measuring an empty
    // patch of sea and reported the card missing.
    const rectOf = (placement, w, h) => window.BlvckGraphic.panelBox(
      placement, w, h * window.BlvckEditorTiming.captionBand(clip));

    async function exportOnce() {
      const realCreate = URL.createObjectURL.bind(URL);
      let captured = null;
      URL.createObjectURL = (blob) => {
        if (blob && /video\/webm/.test(blob.type || '')) captured = blob;
        return realCreate(blob);
      };
      const realClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function () { /* no download in a test */ };

      const exportBtn = document.getElementById('ed-export-video');
      if (!exportBtn) { URL.createObjectURL = realCreate; return { error: 'no export button' }; }
      exportBtn.click();
      for (let i = 0; i < 300 && !captured; i++) await new Promise((r) => setTimeout(r, 500));
      URL.createObjectURL = realCreate;
      HTMLAnchorElement.prototype.click = realClick;
      if (!captured) return { error: 'no file was produced',
                              status: (document.getElementById('ed-status') || {}).textContent || '' };

      const url = realCreate(captured);
      const v = document.createElement('video');
      v.muted = true; v.src = url;
      const ready = await new Promise((res) => {
        v.onloadeddata = () => res(true); v.onerror = () => res(false);
        setTimeout(() => res(v.readyState >= 2), 25000);
      });
      if (!ready) return { error: 'the exported file would not decode', bytes: captured.size };

      const t = Math.min(secs - 1.5, (element ? (element.start + element.end) / 2 : secs / 2));
      await new Promise((res) => {
        v.onseeked = () => res();
        try { v.currentTime = t; } catch (e) { res(); }
        setTimeout(res, 8000);
      });
      const s = document.createElement('canvas');
      s.width = 640; s.height = 360;
      const g = s.getContext('2d');
      g.drawImage(v, 0, 0, s.width, s.height);
      const box = rectOf(element ? element.placement : 'lower_right', s.width, s.height);
      const stats = (x0, y0, x1, y1) => {
        const d = g.getImageData(x0, y0, Math.max(1, x1 - x0), Math.max(1, y1 - y0)).data;
        let sum = 0, n = 0, bright = 0;
        for (let i = 0; i < d.length; i += 4 * 4) {
          const l = (d[i] + d[i + 1] + d[i + 2]) / 3;
          sum += l; n++;
          if (l > 205) bright++;
        }
        return { luma: Math.round(sum / n), bright, n };
      };

      // Does the frame actually CARRY THE CARD'S OWN PIXELS?
      //
      // Colour is not a safe discriminator and this test learned that the hard
      // way twice. First the card's near-black ground, which stopped existing
      // when the backing was removed. Then the brand amber of the bars - until
      // a run drew a ship stacked with orange containers, and the footage
      // WITHOUT the card scored more amber than the footage with it.
      //
      // The card's own artwork does not have that problem. It is deterministic,
      // so it can be redrawn here and compared pixel for pixel wherever it is
      // opaque. Footage matching the exact colour of the exact marks at the
      // exact positions is not something a container ship can do by accident.
      const artMatch = () => {
        if (!element) return null;
        const a = document.createElement('canvas');
        a.width = s.width; a.height = s.height;
        const ag = a.getContext('2d');
        window.BlvckGraphic.drawPanel(ag, window.BlvckGraphic.THEMES.dark,
          window.BlvckGraphic.panelSpecOf(element), element.placement,
          s.width, s.height * window.BlvckEditorTiming.captionBand(clip));
        const art = ag.getImageData(0, 0, s.width, s.height).data;
        const frame = g.getImageData(0, 0, s.width, s.height).data;
        let marks = 0, hit = 0;
        for (let i = 0; i < art.length; i += 4) {
          if (art[i + 3] < 240) continue;          // solid marks only, not the halo
          marks++;
          if (Math.abs(art[i] - frame[i]) < 46
           && Math.abs(art[i + 1] - frame[i + 1]) < 46
           && Math.abs(art[i + 2] - frame[i + 2]) < 46) hit++;
        }
        return { marks, hit, pct: marks ? Math.round((hit / marks) * 100) : 0 };
      };

      return { ok: true, bytes: captured.size, type: captured.type, sampledAt: t,
               duration: Math.round(v.duration * 100) / 100, w: v.videoWidth, h: v.videoHeight,
               art: artMatch(),
               panel: stats(box.x + 4, box.y + 4, box.x + box.w - 4, box.y + box.h - 4),
               // A strip along the top, which no lower placement ever touches.
               control: stats(0, 0, s.width, Math.round(s.height * 0.28)),
               // The frame itself, kept beside the numbers. A statistic saying
               // a card is present is worth less than the frame it is present in.
               frame: s.toDataURL('image/png'),
               status: (document.getElementById('ed-status') || {}).textContent || '' };
    }

    const withCard = await exportOnce();

    // The counterfactual: the same clip, the same encoder, no element.
    const kept = clip.rendererElements;
    clip.rendererElements = [];
    clip.editorialOverlay = null;
    const withoutCard = await exportOnce();
    clip.rendererElements = kept;

    return { carried, hasVideo, withCard, withoutCard };
  }, SECONDS, el);

  if (film.error || (film.withCard && film.withCard.error)) {
    check('the export produced a file', false, film.error || film.withCard.error);
    if (film.withCard && film.withCard.status) console.log(`   status said: "${film.withCard.status}"`);
  } else {
    const a = film.withCard, b = film.withoutCard;
    console.log(`   with the card   : ${(a.bytes / 1024).toFixed(0)}KB  ${a.duration}s  ${a.w}x${a.h}`);
    console.log(`   without         : ${(b.bytes / 1024).toFixed(0)}KB  ${b.duration}s`);
    console.log(`   the clip carried ${film.carried} renderer element(s), real video: ${film.hasVideo}`);
    console.log(`   sampled at t=${a.sampledAt.toFixed(2)}s`);
    console.log(`     the card's own pixels present: with ${a.art && a.art.pct}% `
      + `· without ${b.art && b.art.pct}%  (of ${a.art && a.art.marks} marks)`);
    console.log(`     panel   with ${JSON.stringify(a.panel)}`);
    console.log(`     panel   w/o  ${JSON.stringify(b.panel)}`);
    console.log(`     control with ${JSON.stringify(a.control)}`);
    console.log(`     control w/o  ${JSON.stringify(b.control)}`);

    check('the decision travelled from the storyboard into the assembled clip',
          film.carried === (decided.elements || []).length && film.carried > 0, film.carried);
    check('the clip is the real downloaded footage, not a still', film.hasVideo === true, film);
    check('a finished file came out', a.bytes > 0, a.bytes);
    check('it decodes as 1280x720 video', a.w === 1280 && a.h === 720, a);
    check('its duration matches the beat',
          Math.abs(a.duration - SECONDS) <= 1.5, { got: a.duration, want: SECONDS });
    check('the counterfactual export also succeeded', !b.error && b.bytes > 0, b);

    // The card is in the file. There is no plate to look for - that is the
    // point of a panel - so presence is proved against the card's own artwork,
    // redrawn and compared where it is opaque.
    check('the card IS in the exported file — the frame carries its actual pixels',
          a.art && a.art.pct > 70, { with: a.art, without: b.art });
    check('and the counterfactual does NOT — the footage cannot fake the marks',
          b.art && b.art.pct < 25, { with: a.art, without: b.art });
    // The requirement that made panel mode worth having: the shot the beat was
    // chosen for is still playing underneath. A card that blacked out its
    // corner would be a smaller full-frame card.
    check('and the footage is still playing behind it — no backing covers the shot',
          Math.abs(a.panel.luma - b.panel.luma) < 30,
          { with: a.panel.luma, without: b.panel.luma });
    check('the footage elsewhere is untouched — it is a panel, not a full-frame card',
          Math.abs(a.control.luma - b.control.luma) < 25,
          { with: a.control, without: b.control });
    check('and nothing was drawn outside the card',
          Math.abs(a.control.bright - b.control.bright) < 120,
          { with: a.control, without: b.control });
  }

  // The frames go beside the JSON as real files, and out of it, so the record
  // stays readable.
  for (const [name, shot] of [['with-card', film.withCard], ['without-card', film.withoutCard]]) {
    if (shot && shot.frame) {
      fs.writeFileSync(path.join(path.dirname(OUT), `renderer_acceptance_${name}.png`),
        Buffer.from(shot.frame.split(',')[1], 'base64'));
      delete shot.frame;
    }
  }

  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), scene: SCENE,
    acquired: got, decided, film,
    note: 'estimated clock — the Fish alignment endpoint was offline, so the element '
        + 'correctly holds the whole shot window rather than measured words. That is '
        + 'why presence is proved by a counterfactual export rather than by sampling '
        + 'inside and outside the element window.' }, null, 2));

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'A SENTENCE BECAME A FILE, AND THE CARD IS IN IT'));
  console.log(`  written to ${path.relative(PROJECT, OUT)}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
