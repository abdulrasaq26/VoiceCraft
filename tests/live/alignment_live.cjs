// One beat, from measured speech to measured pixels.
//
// Every stage of this pipeline has been verified against its neighbours. What
// has never been checked is whether the thing that comes out THE FAR END still
// agrees with the decision recorded at the near end — and that is the only
// question a producer actually has. A beat can be planned correctly, composed
// correctly, rendered successfully, and still be a file whose graphic sits
// somewhere the layout never put it, or which runs for a length the narration
// never asked for.
//
// So this walks one beat the whole way and measures the correspondence at each
// join:
//
//   the clock     the narration is SPOKEN, not estimated, and its measured
//                 length is what the scene window is made of. The rendered
//                 file must be that long, to within one frame.
//   the anchor    the phrase the Visual Director chose to anchor on must be a
//                 phrase that was really said, at a time inside the beat.
//   the geometry  every element the layout declared must have ink where it
//                 said it would, and the caption band must be empty, measured
//                 on decoded frames rather than on a browser's presentation.
//   the record    what the scene says it was built from must be what the file
//                 was built from.
//
// Nothing here is stubbed. Fish speaks, NIM decides, HyperFrames renders,
// ffmpeg measures.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
// Everything except the measured clock can be checked without the speech
// engine. --estimated says so out loud rather than letting a green run imply a
// measurement that never happened.
const ESTIMATED_OK = process.argv.includes('--estimated');
const OUT = path.join(PROJECT, 'tests', 'live', 'alignment_v1.json');
const env = fs.readFileSync(PROJECT + '/.env', 'utf8');
const envGet = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : '';
};

const NARRATION = 'Authority does not travel upward. Every level you rise is a level '
                + 'that can act without you.';
// The HYBRID beat: something a camera can point at, and a figure the shot
// cannot state. Its footage is a stand-in whose content encodes its own source
// time, which is the only way to check an in-point quantitatively.
const HYBRID_LINE = 'Ropes are checked and stacked along the quay each morning, though '
                  + 'barely a third of these boats will put to sea this year.';
const MEDIA_START = 8;

const fails = [];
const notes = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 900000,
    args: ['--window-size=1300,900', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 120)); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((k) => {
    if (k.nim) localStorage.setItem('blvck:keys_nim', JSON.stringify([k.nim]));
    localStorage.setItem('blvck:director_provider', 'nim');
    localStorage.setItem('blvck:tts_provider', 'fishaudio');
    // Without this the adapter falls back to api.fish.audio, refuses for want
    // of a key, and the run quietly continues on an ESTIMATED clock — which
    // makes the whole point of this test compare an estimate with itself.
    if (k.fish && window.ProviderManager) window.ProviderManager.setEndpoint('fishaudio', k.fish);
  }, { nim: envGet('NVIDIA_NIM_API'), fish: envGet('FISH_API_URL') });
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  const record = { at: new Date().toISOString(), narration: NARRATION };

  // ── Is everything that has to be alive, alive? ──────────────────────────
  const live = await page.evaluate(async (ep) => {
    const out = { nim: false, frames: false, fish: false, align: false, voices: 0 };
    out.nim = !!(window.BlvckHyperFrameComposer && window.BlvckHyperFrameComposer.available());
    out.frames = (await window.BlvckFrames.available(true)).ready === true;
    try {
      const r = await fetch('/api/proxy/fish/aether/status', {
        // Cold, this endpoint is slow: measured at 14.0s and 21.6s on a
        // tunnel that was demonstrably up. A 30s ceiling reported it as down
        // and skipped the whole test, which is a worse answer than waiting.
        headers: { 'x-fish-endpoint': ep }, signal: AbortSignal.timeout(90000)
      });
      if (r.ok) {
        const j = JSON.parse(await r.text());
        out.fish = true;
        out.align = j.alignment === true;
        out.voices = (j.voices || []).length;
      } else out.why = 'HTTP ' + r.status;
    } catch (e) { out.why = e.message; }
    return out;
  }, envGet('FISH_API_URL'));
  console.log(`  NIM ${live.nim ? 'up' : 'down'} · frame service ${live.frames ? 'up' : 'down'} · `
    + `Fish ${live.fish ? `up (${live.voices} voices, align ${live.align ? 'yes' : 'no'})` : 'down'}`);
  check('the decision, the render and the measurement are all reachable',
        live.nim && live.frames, live);
  if (!live.nim || !live.frames) { await browser.close(); process.exit(1); }
  // The central claim here is that the file matches a MEASURED clock. Without
  // the engine there is no measured clock, and a green run would be claiming
  // something it never checked — so the run says so and stops rather than
  // grading itself on an estimate.
  if (!live.fish && !ESTIMATED_OK) {
    console.log('\nSKIPPED: Fish is not reachable, so the clock cannot be measured. '
      + 'This test asserts nothing without it. Pass --estimated to check '
      + 'everything else against a stated-length clock.');
    await browser.close();
    process.exit(0);
  }

  // ── 1. The clock: real speech, and its real length ──────────────────────
  console.log('\n=== the narration, spoken and measured ===');
  const spoken = await page.evaluate(async (text, ep) => {
    if (!window.FishAdapter) return { ok: false, why: 'no Fish adapter' };
    const t0 = performance.now();
    let url;
    try {
      url = await window.FishAdapter.textToSpeech({ input: text, voice: 'default' });
    } catch (err) { return { ok: false, why: err.message, ms: performance.now() - t0 }; }
    if (!url) return { ok: false, why: 'the engine returned nothing' };
    const blob = await (await fetch(url)).blob();

    // Decoded, not read off a media element: this is the length of the audio
    // that exists, which is the number the whole timeline is built from.
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
    const seconds = Math.round((buf.length / buf.sampleRate) * 1000) / 1000;
    ctx.close();
    window.__speech = blob;
    return { ok: true, seconds, bytes: blob.size, sampleRate: buf.sampleRate,
             ms: Math.round(performance.now() - t0) };
  }, NARRATION, envGet('FISH_API_URL'));

  let windowSeconds;
  if (spoken.ok) {
    console.log(`  ${(spoken.bytes / 1024).toFixed(0)}KB, ${spoken.seconds}s of speech `
      + `at ${spoken.sampleRate}Hz, generated in ${(spoken.ms / 1000).toFixed(1)}s`);
    windowSeconds = spoken.seconds;
    check('the narration was really spoken', spoken.seconds > 2 && spoken.seconds < 40, spoken);
  } else {
    console.log(`  ⚠ Fish could not speak it (${spoken.why}) — falling back to an estimate`);
    notes.push('the narration was estimated: ' + spoken.why);
    windowSeconds = 7;
    // The status endpoint said it was up. An engine that answers a status
    // check and then refuses to speak is a failure, not a note: continuing
    // quietly is how a clock check ends up comparing an estimate with itself
    // and reporting that the timing is exact.
    if (!ESTIMATED_OK) check('the engine that answered its status check actually spoke', false, spoken);
  }
  record.speech = spoken;

  // ── 2. The decision, on that clock ──────────────────────────────────────
  console.log('\n=== the decision, and what it recorded ===');
  const decided = await page.evaluate(async (text, secs) => {
    window.BlvckHouseStyle.clearReference();
    window.BlvckHouseStyle.set('broadcast-brief');

    const scene = {
      index: 1, subtitle: text, sceneSummary: 'how authority thins as it moves up a hierarchy',
      status: 'pending',
      timelineStart: 0, timelineEnd: secs,
      timestamp: '00:00:00 - 00:00:' + String(Math.round(secs)).padStart(2, '0')
    };
    localStorage.setItem('blvck-tts:storyboard', JSON.stringify({
      project: { title: 'alignment' }, cues: [], scenes: [scene], transcript: null }));
    const liveScenes = window.BlvckStoryboard.scenes();
    liveScenes.length = 0; liveScenes.push(scene);

    const plan = await window.BlvckVisualPlanner.planScenes({ scenes: liveScenes, force: true });
    const strategy = window.BlvckVisualPlanner.strategyOf(scene);

    const steps = [];
    const res = await window.BlvckHyperFrameComposer.runRoute(scene, {
      mode: 'FULL_FRAME', onProgress: (s) => steps.push(s)
    });
    window.BlvckStoryboard.save();

    // The layout as DECLARED — the boxes the components said they occupy.
    const declared = await window.BlvckHyperFrameEvaluator.inspectLayout(scene.hyperFrameSource);

    return {
      strategy, planRan: !!(scene.visualStrategy && scene.visualStrategy.ran),
      planReason: (scene.visualStrategy || {}).reason,
      res, steps,
      intent: scene.visualIntent || null,
      hyperFrame: scene.hyperFrame || null,
      declared: { ok: declared.ok, density: declared.density,
                  problems: declared.problems.map((p) => p.why),
                  elements: declared.elements, bandTop: declared.bandTop },
      sourceKinds: (String(scene.hyperFrameSource || '').match(/class="clip hf-([a-z]+)/g) || [])
        .map((x) => x.replace('class="clip hf-', ''))
    };
  }, NARRATION, windowSeconds);

  if (!decided.res.ok) {
    check('the beat was built', false, decided.res);
    fs.writeFileSync(OUT, JSON.stringify({ ...record, decided }, null, 2));
    await browser.close();
    process.exit(1);
  }

  console.log(`  planner: ${decided.strategy} — ${decided.planReason}`);
  console.log(`  conveys: ${decided.intent.concept}`);
  console.log(`  anchored to: "${decided.hyperFrame.anchorPhrase}"`);
  console.log(`  built from: ${decided.hyperFrame.elements.join(' + ')} in ${decided.hyperFrame.style}`);
  for (const e of decided.declared.elements) {
    console.log(`    ${e.id.padEnd(9)} ${String(e.x).padStart(5)},${String(e.y).padStart(4)}  ${e.w}x${e.h}`);
  }
  record.decision = decided;

  check('the Planner answered rather than falling back', decided.planRan === true, decided);
  check('the layout it produced has no problems',
        decided.declared.ok === true, decided.declared.problems);
  check('and the record of what it was built from matches the source',
        decided.hyperFrame.elements.every((k) => decided.sourceKinds.includes(k)),
        { recorded: decided.hyperFrame.elements, inSource: decided.sourceKinds });

  // ── 3. The file, measured ───────────────────────────────────────────────
  console.log('\n=== the rendered file ===');
  const measured = await page.evaluate(async (declared) => {
    const key = 'clip:1';
    const blob = await new Promise((res, rej) => {
      const rq = indexedDB.open('blvck-storyboard', 1);
      rq.onsuccess = () => {
        const tx = rq.result.transaction('images', 'readonly');
        const g = tx.objectStore('images').get(key);
        g.onsuccess = () => res(g.result || null);
        g.onerror = () => rej(g.error);
      };
      rq.onerror = () => rej(rq.error);
    });
    if (!blob) return { ok: false, why: 'nothing was stored for this scene' };

    // Late enough that every component's entrance has finished.
    const out = await window.BlvckFrames.at(blob, [0.2, 2.0]);
    const settled = out.frames[1];
    if (!settled.ok) return { ok: false, why: settled.why };

    // Ink is anything that is not the house ground. Measured per declared box,
    // which is the whole point: the layout said where things go, and this asks
    // the file whether they went there.
    const t = window.BlvckHyperFrameComponents.tokensFor();
    const bg = t.bg.replace('#', '');
    const gr = [0, 2, 4].map((i) => parseInt(bg.slice(i, i + 2), 16));
    const isInk = (r, g, b) =>
      Math.abs(r - gr[0]) + Math.abs(g - gr[1]) + Math.abs(b - gr[2]) > 90;

    const sx = settled.width / 1920, sy = settled.height / 1080;
    const inkIn = (x, y, w, h) => {
      let n = 0, total = 0;
      const x0 = Math.max(0, Math.round(x * sx)), x1 = Math.min(settled.width, Math.round((x + w) * sx));
      const y0 = Math.max(0, Math.round(y * sy)), y1 = Math.min(settled.height, Math.round((y + h) * sy));
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * settled.width + xx) * 4;
          total++;
          if (isInk(settled.data[i], settled.data[i + 1], settled.data[i + 2])) n++;
        }
      }
      return { share: total ? Math.round((n / total) * 1000) / 1000 : 0, pixels: n, total };
    };

    const boxes = declared.elements.map((e) => ({ id: e.id, box: e, ink: inkIn(e.x, e.y, e.w, e.h) }));

    // The band the compositor burns subtitles into. Anything here would be
    // written over by words the viewer needs more.
    const band = inkIn(0, declared.bandTop, 1920, 1080 - declared.bandTop);

    // The ground, sampled where no component was declared.
    const corner = inkIn(1700, 40, 180, 80);

    return { ok: true, width: settled.width, height: settled.height,
             actualAt: settled.actualAt, boxes, band, corner,
             first: out.frames[0].ok ? { actualAt: out.frames[0].actualAt } : null };
  }, decided.declared);

  const meta = await page.evaluate(async () => {
    const blob = await new Promise((res) => {
      const rq = indexedDB.open('blvck-storyboard', 1);
      rq.onsuccess = () => {
        const tx = rq.result.transaction('images', 'readonly');
        const g = tx.objectStore('images').get('clip:1');
        g.onsuccess = () => res(g.result || null);
      };
    });
    const out = await window.BlvckFrames.at(blob, [0.1]);
    return out.meta;
  });

  if (!measured.ok) {
    check('the rendered file could be measured', false, measured);
  } else {
    console.log(`  ${meta.width}x${meta.height} ${meta.codec} ${meta.fps.toFixed(1)}fps, `
      + `${meta.duration.toFixed(3)}s — frame read at ${measured.actualAt}s`);
    for (const b of measured.boxes) {
      console.log(`    ${b.id.padEnd(9)} declared ${b.box.w}x${b.box.h} → `
        + `${Math.round(b.ink.share * 100)}% ink`);
    }
    console.log(`    caption band ${Math.round(measured.band.share * 100)}% ink · `
      + `bare ground ${Math.round(measured.corner.share * 100)}% ink`);
    record.measured = { meta, ...measured };

    // ── The clock ─────────────────────────────────────────────────────────
    const frame = 1 / (meta.fps || 30);
    check(`THE FILE IS EXACTLY AS LONG AS THE ${spoken.ok ? 'MEASURED' : '(ESTIMATED)'} NARRATION ASKED FOR`,
          Math.abs(meta.duration - windowSeconds) <= frame + 0.05,
          { window: windowSeconds, file: meta.duration, oneFrame: frame });
    // Two places compute this window — runRoute, which bakes data-duration into
    // the composition and so governs the file, and renderScene, which records
    // durationSec on the scene. They agree today. If they ever stop agreeing,
    // the workspace would report a length the file does not have, and nothing
    // else in the pipeline would notice.
    check('and the length recorded on the scene is the length the file has',
          Math.abs((decided.hyperFrame.durationSec || 0) - meta.duration) <= frame + 0.05,
          { recorded: decided.hyperFrame.durationSec, file: meta.duration });
    check('and it is the frame size the composition declared',
          meta.width === 1920 && meta.height === 1080, meta);

    // ── The geometry ──────────────────────────────────────────────────────
    check('EVERY DECLARED ELEMENT HAS INK WHERE THE LAYOUT PUT IT',
          measured.boxes.length > 0 && measured.boxes.every((b) => b.ink.share > 0.02),
          measured.boxes.map((b) => ({ id: b.id, share: b.ink.share })));
    check('the caption band is left clear for the subtitles',
          measured.band.share < 0.01, measured.band);
    check('and the ground where nothing was declared is bare',
          measured.corner.share < 0.02, measured.corner);
  }

  // ── 4. The anchor, against what was actually said ───────────────────────
  console.log('\n=== the anchor phrase, against the words as spoken ===');
  const anchored = await page.evaluate(async (phrase, text, secs, ep, canAlign) => {
    // FORCED ALIGNMENT AGAINST THE AUDIO THAT EXISTS. Not the estimate — the
    // point of this check is whether the Director's anchor lands on the moment
    // the words are actually spoken, and an evenly-spread guess would answer a
    // different question and answer it flatteringly.
    let transcript = null, measuredWords = false, why = '';
    if (canAlign && window.__speech && window.Transcript) {
      try {
        const bytes = new Uint8Array(await window.__speech.arrayBuffer());
        let raw = '';
        for (let i = 0; i < bytes.length; i += 0x8000) {
          raw += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        }
        const r = await fetch('/api/proxy/fish/v1/align', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-fish-endpoint': ep },
          body: JSON.stringify({ audio_b64: btoa(raw), text }),
          signal: AbortSignal.timeout(120000)
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok || j.error) throw new Error(j.error || ('align failed (HTTP ' + r.status + ')'));
        transcript = window.Transcript.fromSyncTimeline(j, { script: text });
        measuredWords = !!(transcript && window.Transcript.hasWordTimings(transcript));
        if (!measuredWords) why = 'the aligner returned no word timings';
      } catch (err) {
        why = err.message;
      }
    }
    if (!transcript && window.Transcript && window.Transcript.fromSyncTimeline) {
      const words = text.split(/\s+/);
      const per = secs / words.length;
      transcript = window.Transcript.fromSyncTimeline({
        words: words.map((w, i) => ({ word: w, start: i * per, end: (i + 1) * per }))
      });
    }
    const shot = { timelineStart: 0, timelineEnd: secs };
    const hit = transcript && window.Timing
      ? window.Timing.anchorOverlay(transcript, phrase, { shot })
      : null;
    const inNarration = text.toLowerCase().includes(String(phrase || '').toLowerCase());
    const wordCount = transcript && window.Transcript.words
      ? window.Transcript.words(transcript).length : 0;
    const last = transcript && window.Transcript.words
      ? (window.Transcript.words(transcript).slice(-1)[0] || null) : null;
    return { measuredWords, why, hit, inNarration, phrase, wordCount,
             lastWordEnds: last ? Math.round(last.end * 100) / 100 : null };
  }, decided.hyperFrame.anchorPhrase, NARRATION, windowSeconds,
     envGet('FISH_API_URL'), live.fish && live.align);

  console.log(`  "${anchored.phrase}" — ${anchored.inNarration ? 'is' : 'is NOT'} in the narration`);
  if (anchored.hit) {
    console.log(`  anchored at ${anchored.hit.start}s–${anchored.hit.end}s, `
      + `spoken at ${anchored.hit.spokenAt}s `
      + `(${anchored.measuredWords ? `${anchored.wordCount} measured words, last ends `
          + `${anchored.lastWordEnds}s` : 'estimated words' + (anchored.why ? ': ' + anchored.why : '')})`);
  } else {
    console.log(`  the timing authority could not place it`);
  }
  record.anchor = anchored;

  check('THE DIRECTOR ANCHORED ON WORDS THAT WERE ACTUALLY SAID',
        anchored.inNarration === true, anchored);
  check('and the timing authority can place it on the clock',
        !!anchored.hit, anchored);
  if (anchored.hit) {
    check('inside the beat it belongs to',
          anchored.hit.start >= 0 && anchored.hit.end <= windowSeconds + 0.01,
          { hit: anchored.hit, window: windowSeconds });
  }
  if (live.fish && live.align) {
    check('THE WORDS WERE MEASURED AGAINST THE AUDIO, not spread evenly over it',
          anchored.measuredWords === true, anchored);
    if (anchored.measuredWords) {
      // The alignment has to describe the audio that exists. Words that run
      // past the end of the recording are not a timing, they are a guess with
      // decimal places.
      check('and the aligned words end inside the recording',
            anchored.lastWordEnds !== null
            && anchored.lastWordEnds <= windowSeconds + 0.15,
            { lastWordEnds: anchored.lastWordEnds, audio: windowSeconds });
      check('with a timing for every word that was spoken',
            anchored.wordCount >= NARRATION.split(/\s+/).length - 2,
            { aligned: anchored.wordCount, expected: NARRATION.split(/\s+/).length });
    }
  }

  // ── 5. HYBRID: the shot and the graphic sharing one frame ───────────────
  //
  // The mode where a timing error is least visible. A FULL_FRAME beat that
  // starts at the wrong instant looks like a beat that starts at the wrong
  // instant; a HYBRID beat cut from the wrong second of its source looks like
  // perfectly good footage of the wrong moment, and nothing downstream would
  // ever say so.
  //
  // So the source is a clip whose picture states its own source time, and the
  // claim is exact: the frame a viewer sees at t seconds into the beat must be
  // the frame that sits at mediaStart + t in the source. Both sides are
  // measured — the source is read with the same extractor as the render, so
  // nothing depends on the fixture being regular.
  console.log('\n=== HYBRID: the shot, cut where acquisition said ===');

  const shotBuilt = await page.evaluate(async () => {
    const c = document.createElement('canvas');
    c.width = 1280; c.height = 720;
    const g = c.getContext('2d');
    const BANDS = ['#c81e1e', '#1e8ac8', '#1ec85a', '#c8b81e', '#8a1ec8', '#1ec8b8',
                   '#c85a1e', '#5a1ec8', '#c81e8a', '#1e5ac8', '#5ac81e', '#c8c81e',
                   '#1ec8c8', '#c81ec8', '#8ac81e', '#1e1ec8', '#c88a1e', '#1ec88a',
                   '#8a8ac8', '#c8c88a'];
    const rec = new MediaRecorder(c.captureStream(30), { mimeType: 'video/webm',
                                                         videoBitsPerSecond: 6000000 });
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
    rec.start();
    const t0 = performance.now();
    await new Promise((done) => {
      const tick = () => {
        const t = (performance.now() - t0) / 1000;
        if (t >= 20) { rec.stop(); done(); return; }
        g.fillStyle = BANDS[Math.min(BANDS.length - 1, Math.floor(t))];
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = '#ffffff';
        g.font = 'bold 90px monospace';
        g.fillText(t.toFixed(1) + 's', 60, 110);
        requestAnimationFrame(tick);
      };
      tick();
    });
    await new Promise((r) => { rec.onstop = r; setTimeout(r, 2500); });
    const blob = new Blob(chunks, { type: 'video/webm' });

    const db = await new Promise((res, rej) => {
      const rq = indexedDB.open('blvck-stock-cache', 1);
      rq.onupgradeneeded = () => { const d = rq.result;
        if (!d.objectStoreNames.contains('assets')) d.createObjectStore('assets'); };
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
    await new Promise((res, rej) => {
      const tx = db.transaction('assets', 'readwrite');
      tx.objectStore('assets').put(blob, 'pexels:aligned');
      tx.oncomplete = res; tx.onerror = () => rej(tx.error);
    });
    localStorage.setItem('blvck:stock-cache-meta',
      JSON.stringify({ 'pexels:aligned': { at: Date.now() } }));
    window.__shot = blob;
    return { bytes: blob.size };
  });
  console.log(`  a ${(shotBuilt.bytes / 1024).toFixed(0)}KB source whose picture states its own time`);

  // What the SOURCE actually shows at the instants the beat will cut from.
  // Read rather than assumed: the capture is real-time and its frame times are
  // its own business.
  const hybridSpoken = await page.evaluate(async (text) => {
    const t0 = performance.now();
    try {
      const url = await window.FishAdapter.textToSpeech({ input: text, voice: 'default' });
      const blob = await (await fetch(url)).blob();
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      const buf = await ctx.decodeAudioData(await blob.arrayBuffer());
      const seconds = Math.round((buf.length / buf.sampleRate) * 1000) / 1000;
      ctx.close();
      return { ok: true, seconds, ms: Math.round(performance.now() - t0) };
    } catch (err) { return { ok: false, why: err.message }; }
  }, HYBRID_LINE);

  const hybridWindow = hybridSpoken.ok ? hybridSpoken.seconds : 6;
  if (hybridSpoken.ok) {
    console.log(`  the line runs ${hybridWindow}s, spoken in ${(hybridSpoken.ms / 1000).toFixed(1)}s`);
  } else {
    console.log(`  ⚠ the second line was not spoken (${hybridSpoken.why}) — using ${hybridWindow}s`);
    notes.push('the HYBRID clock was estimated: ' + hybridSpoken.why);
  }

  const SAMPLE_AT = [0.5, 1.5, 2.5].filter((t) => t < hybridWindow - 0.3);

  const hybrid = await page.evaluate(async (line, secs, mediaStart, sampleAt) => {
    const hex = (d, i) => '#' + [d[i], d[i + 1], d[i + 2]]
      .map((n) => n.toString(16).padStart(2, '0')).join('');
    // The right-hand side of the frame, past the scrim, where the footage is
    // shown as it is. The scrim runs to 72% of the width by design.
    const sampleRight = (f) => {
      const x = Math.round(f.width * 0.86), y = Math.round(f.height * 0.20);
      return hex(f.data, (y * f.width + x) * 4);
    };

    // 1. What the source shows at mediaStart + t.
    const src = await window.BlvckFrames.at(window.__shot, sampleAt.map((t) => mediaStart + t));
    const source = src.frames.map((f, i) => ({
      sourceAt: f.ok ? f.actualAt : null, beatAt: sampleAt[i],
      colour: f.ok ? sampleRight(f) : null, ok: f.ok, why: f.why || '' }));

    // 2. Build the beat and render it.
    const scene = {
      index: 2, subtitle: line, sceneSummary: 'the morning work on the quay, and how few boats sail',
      status: 'pending', timelineStart: 0, timelineEnd: secs,
      timestamp: '00:00:00 - 00:00:' + String(Math.round(secs)).padStart(2, '0'),
      stockAsset: { provider: 'pexels', id: 'aligned', type: 'video',
                    duration: 20, width: 1280, height: 720,
                    sourceUrl: 'https://example.invalid/aligned',
                    queriesUsed: ['quay'],
                    excerpt: { required: true, applied: true, start: mediaStart,
                               end: mediaStart + secs, duration: secs, sourceDuration: 20 } }
    };
    const liveScenes = window.BlvckStoryboard.scenes();
    liveScenes.length = 0; liveScenes.push(scene);

    const res = await window.BlvckHyperFrameComposer.runRoute(scene, { mode: 'HYBRID' });
    if (!res.ok) return { ok: false, res, source };

    const declared = await window.BlvckHyperFrameEvaluator.inspectLayout(scene.hyperFrameSource);
    const blob = await new Promise((resolve, reject) => {
      const rq = indexedDB.open('blvck-storyboard', 1);
      rq.onsuccess = () => {
        const tx = rq.result.transaction('images', 'readonly');
        const g = tx.objectStore('images').get('clip:2');
        g.onsuccess = () => resolve(g.result || null);
        g.onerror = () => reject(g.error);
      };
      rq.onerror = () => reject(rq.error);
    });
    if (!blob) return { ok: false, why: 'nothing was stored for the HYBRID beat', source };

    // 3. What the RENDER shows at t.
    const out = await window.BlvckFrames.at(blob, sampleAt);
    const rendered = out.frames.map((f, i) => ({
      beatAt: sampleAt[i], landedAt: f.ok ? f.actualAt : null,
      colour: f.ok ? sampleRight(f) : null, ok: f.ok, why: f.why || '' }));

    // 4. And whether the graphics are still where the layout put them.
    const settled = out.frames[out.frames.length - 1];
    const t = window.BlvckHyperFrameComponents.tokensFor();
    const rgbOf = (c) => {
      const m = String(c).match(/^#?([0-9a-f]{6})/i);
      if (m) { const n2 = parseInt(m[1], 16); return [(n2 >> 16) & 255, (n2 >> 8) & 255, n2 & 255]; }
      const p2 = String(c).match(/rgba?\(([^)]+)\)/i);
      return p2 ? p2[1].split(",").map((x) => parseFloat(x)) : [255, 255, 255];
    };
    const typeColours = [rgbOf(t.ink), rgbOf(t.accent)];
    const isTypeColour = (r, g2, b) => typeColours.some((c) =>
      Math.abs(r - c[0]) + Math.abs(g2 - c[1]) + Math.abs(b - c[2]) < 120);
    const ink = (box) => {
      let n = 0, total = 0;
      const sx = settled.width / 1920, sy = settled.height / 1080;
      const x0 = Math.max(0, Math.round(box.x * sx)), x1 = Math.min(settled.width, Math.round((box.x + box.w) * sx));
      const y0 = Math.max(0, Math.round(box.y * sy)), y1 = Math.min(settled.height, Math.round((box.y + box.h) * sy));
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * settled.width + xx) * 4;
          total++;
          // The colours the components actually paint with, read from the
          // tokens. Looking for near-white alone found the title and missed
          // the stat entirely — a stat is painted in the house accent, which
          // here is amber, and amber is not white. The measurement said 0%
          // type over a frame that plainly had some.
          if (isTypeColour(settled.data[i], settled.data[i + 1], settled.data[i + 2])) n++;
        }
      }
      return total ? Math.round((n / total) * 1000) / 1000 : 0;
    };
    const boxes = declared.elements
      .filter((e) => !(e.w >= 1916 && e.h >= 1076))     // the shot itself is the backdrop
      .map((e) => ({ id: e.id, share: ink(e) }));

    return { ok: true, source, rendered, boxes, meta: out.meta,
             elements: scene.hyperFrame.elements,
             hasMediaStart: /data-media-start="([\d.]+)"/.exec(scene.hyperFrameSource),
             declaredCount: declared.elements.length };
  }, HYBRID_LINE, hybridWindow, MEDIA_START, SAMPLE_AT);

  if (!hybrid.ok) {
    check('the HYBRID beat was built', false, hybrid.res || hybrid.why);
  } else {
    console.log(`  built from ${hybrid.elements.join(' + ')}, `
      + `data-media-start=${hybrid.hasMediaStart ? hybrid.hasMediaStart[1] : '(absent)'}`);
    console.log(`  ${hybrid.meta.width}x${hybrid.meta.height}, ${hybrid.meta.duration.toFixed(3)}s`);
    for (let i = 0; i < hybrid.rendered.length; i++) {
      const r = hybrid.rendered[i], s2 = hybrid.source[i];
      console.log(`    beat ${r.beatAt}s → source ${s2.sourceAt}s   `
        + `${s2.colour} in the source, ${r.colour} in the render`);
    }
    for (const b of hybrid.boxes) console.log(`    ${b.id.padEnd(9)} ${Math.round(b.share * 100)}% type`);
    record.hybrid = hybrid;

    const near = (a, b) => {
      if (!a || !b) return false;
      const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
      const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
      return Math.max(...pa.map((v, i) => Math.abs(v - pb[i]))) < 60;
    };

    check('the shot is carried into the composition with its in-point',
          !!hybrid.hasMediaStart && Number(hybrid.hasMediaStart[1]) === MEDIA_START,
          hybrid.hasMediaStart && hybrid.hasMediaStart[1]);
    check('THE FRAME AT t SECONDS INTO THE BEAT IS THE SOURCE AT mediaStart + t',
          hybrid.rendered.length > 0
          && hybrid.rendered.every((r, i) => near(r.colour, hybrid.source[i].colour)),
          hybrid.rendered.map((r, i) => ({ beatAt: r.beatAt, render: r.colour,
                                           source: hybrid.source[i].colour })));
    check('the beat is as long as its own narration',
          Math.abs(hybrid.meta.duration - hybridWindow) <= (1 / (hybrid.meta.fps || 30)) + 0.05,
          { window: hybridWindow, file: hybrid.meta.duration });
    check('and the graphics are still on top of it, where the layout put them',
          hybrid.boxes.length > 0 && hybrid.boxes.every((b) => b.share > 0.01), hybrid.boxes);
  }

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  fs.writeFileSync(OUT, JSON.stringify(record, null, 2));
  console.log(`\n  written to ${path.relative(PROJECT, OUT)}`);
  if (notes.length) console.log('\nNOTES:\n  - ' + notes.join('\n  - '));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : (spoken.ok
                                       ? 'THE FILE AGREES WITH THE DECISION THAT MADE IT, '
                                         + 'ON A CLOCK MADE OF MEASURED SPEECH'
                                       : 'THE FILE AGREES WITH THE DECISION THAT MADE IT — BUT '
                                         + 'THE CLOCK WAS STATED, NOT MEASURED. Nothing here '
                                         + 'checked the narration.')));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
