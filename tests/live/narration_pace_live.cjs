// Narration pace: longer, and the same voice.
//
// Fish Speech has no speed parameter, so the pace is applied to the audio after
// it is generated. Two things have to be true for that to be worth having, and
// only one of them is obvious.
//
// The obvious one is that the clip gets longer by the amount asked for. The
// other is that the PITCH does not move: resampling would give a longer clip
// too, and a narrator three semitones deeper, which is a different person
// reading the script.
//
// It is also the test that has to be run on real speech. The first version of
// the stretcher advanced its read pointer from the searched position rather
// than the nominal one, which folds every search offset back into the position
// and can cancel the stretch outright. Against a pure tone it looked perfect,
// because the best match for a periodic signal is at offset zero. Against real
// Fish narration a 3.44s clip came back 3.44s. So the ratio is asserted here on
// generated speech, not on a tone.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');

const PORT = process.argv[2] || '3491';
const FISH = (() => {
  const env = fs.readFileSync(PROJECT + '/.env', 'utf8');
  const m = env.match(/^FISH_API_URL=(.*)$/m);
  return m ? m[1].trim().replace(/^"|"$/g, '') : '';
})();

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 300000,
    args: ['--window-size=1300,900']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });

  await page.goto(`http://localhost:${PORT}/#voice`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((ep) => {
    localStorage.setItem('blvck:ttsprovider', 'fishaudio');
    if (ep) localStorage.setItem('blvck:keys_fishaudio', JSON.stringify(ep));
    localStorage.setItem('blvck:narration_pace', '0.85');
  }, FISH);
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 3500));

  // ── The control ─────────────────────────────────────────────────────────
  console.log('=== the control ===');
  const ui = await page.evaluate(() => {
    const w = document.getElementById('speech-speed-wrap');
    const s = document.getElementById('speech-speed-slider');
    const n = document.getElementById('speech-speed-note');
    return { visible: !!(w && getComputedStyle(w).display !== 'none'),
             value: s && s.value, min: s && s.min, max: s && s.max,
             noteShown: !!(n && !n.hidden),
             paceMin: window.BlvckPace && window.BlvckPace.MIN,
             paceMax: window.BlvckPace && window.BlvckPace.MAX };
  });
  console.log(`  ${JSON.stringify(ui)}`);
  check('the speed control is shown for an engine with no speed parameter',
        ui.visible === true, ui);
  check('and is held to the range the stretch is transparent over',
        Number(ui.min) === ui.paceMin && Number(ui.max) === ui.paceMax, ui);
  check('with a note saying it is applied after generation', ui.noteShown === true, ui);
  check('the slider carries the stored pace', Number(ui.value) === 0.85, ui);

  // ── Safety: it can never lose a narration ───────────────────────────────
  console.log('\n=== it never destroys the audio ===');
  const safety = await page.evaluate(async () => {
    const P = window.BlvckPace;
    const wav = window.BlvckVoiceCloning.encodeWav(new Float32Array(4410), 44100);
    const same = await P.stretch(wav, 1);
    const junk = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8])], { type: 'audio/wav' });
    const back = await P.stretch(junk, 0.8);
    return { untouchedAtOne: same === wav, undecodableReturned: back === junk,
             nullSafe: (await P.stretch(null, 0.8)) === null };
  });
  console.log(`  ${JSON.stringify(safety)}`);
  check('pace 1.0 returns the original blob, not a re-encode',
        safety.untouchedAtOne === true, safety);
  check('audio it cannot decode is handed back untouched',
        safety.undecodableReturned === true, safety);
  check('and nothing is invented from nothing', safety.nullSafe === true, safety);

  // ── Real speech ─────────────────────────────────────────────────────────
  console.log('\n=== real narration from the live engine ===');
  const live = await page.evaluate(async () => {
    const state = await window.FishAdapter.probeFish();
    if (!state.online) return { skipped: 'the Fish endpoint is not reachable' };
    const voice = (state.voices || []).map((v) => v.id).find((id) => id && id !== 'default');
    if (!voice) return { skipped: 'no reference voices on the server' };

    const decode = async (blob) => {
      const ctx = new OfflineAudioContext(1, 44100, 44100);
      const d = await ctx.decodeAudioData(await blob.arrayBuffer());
      return d.getChannelData(0);
    };
    // Fundamental by autocorrelation over a voiced stretch.
    const f0 = (x) => {
      const off = Math.floor(x.length / 2), W = 4096, sr = 44100;
      let bestLag = 0, best = -Infinity;
      for (let lag = Math.floor(sr / 350); lag <= Math.floor(sr / 70); lag++) {
        let s = 0;
        for (let i = 0; i < W && off + i + lag < x.length; i++) s += x[off + i] * x[off + i + lag];
        if (s > best) { best = s; bestLag = lag; }
      }
      return bestLag ? Math.round(sr / bestLag) : 0;
    };
    const rms = (x) => { let s = 0; for (let i = 0; i < x.length; i++) s += x[i] * x[i]; return Math.sqrt(s / x.length); };

    const raw = await window.BlvckAI.speak(
      'The factory floor never stopped, not once, in four long years.',
      voice, { params: { seed: 4242, temperature: 0.8, top_p: 0.8 } });
    if (!raw) return { skipped: 'the engine returned no audio' };
    const src = await decode(raw);

    const rows = [];
    for (const rate of [0.8, 0.85, 1.15]) {
      const out = await decode(await window.BlvckPace.stretch(raw, rate));
      rows.push({ rate,
        inSecs: Math.round((src.length / 44100) * 100) / 100,
        outSecs: Math.round((out.length / 44100) * 100) / 100,
        ratio: Math.round((out.length / src.length) * 1000) / 1000,
        want: Math.round((1 / rate) * 1000) / 1000,
        f0In: f0(src), f0Out: f0(out),
        rmsIn: Math.round(rms(src) * 1000) / 1000,
        rmsOut: Math.round(rms(out) * 1000) / 1000 });
    }
    return { voice, rows };
  });

  if (live.skipped) {
    console.log(`  SKIPPED: ${live.skipped}`);
  } else {
    console.log(`  voice: ${live.voice}`);
    for (const r of live.rows) {
      console.log(`  ${r.rate}x  ${r.inSecs}s -> ${r.outSecs}s  ratio ${r.ratio} (want ${r.want})`
        + `   f0 ${r.f0In}Hz -> ${r.f0Out}Hz   rms ${r.rmsIn} -> ${r.rmsOut}`);
    }
    // The regression that a tone could not catch.
    check('every rate stretches real speech by the amount asked for',
          live.rows.every((r) => Math.abs(r.ratio - r.want) / r.want < 0.03),
          live.rows.map((r) => `${r.rate}: ${r.ratio} vs ${r.want}`));
    check('and the voice keeps its pitch — this is not a resample',
          live.rows.every((r) => r.f0In > 0 && Math.abs(r.f0Out - r.f0In) <= Math.max(3, r.f0In * 0.04)),
          live.rows.map((r) => `${r.rate}: ${r.f0In} -> ${r.f0Out}`));
    check('and its level', live.rows.every((r) => Math.abs(r.rmsOut - r.rmsIn) < 0.03),
          live.rows.map((r) => `${r.rate}: ${r.rmsIn} -> ${r.rmsOut}`));
  }

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'THE NARRATION SLOWS DOWN AND KEEPS ITS VOICE'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
