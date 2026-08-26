// The opening of a voice reference survives, and the ceiling is one the engine can use.
//
// The reference conditioner used to search the WHOLE file for its most
// speech-dense window and then snap that window's start back to the nearest
// silence. Two consequences, both silent: a recording longer than the ceiling
// lost its opening, and because the search ranged over the entire file it could
// take a stretch out of the middle and drop both ends. Somebody who records a
// reference speaks the line they want cloned from the top, so that is the part
// least safe to throw away.
//
// The signal here is built so the OLD behaviour and the new one cannot produce
// the same answer:
//
//   0.0 - 2.0s   a quiet, steady opening       amplitude 0.25
//   2.0 - end    loud dense speech-like noise  amplitude 0.90
//
// The dense middle is exactly what a most-speech-dense search is drawn to, so
// the old code returned a window starting after 2s and the opening was gone.
// Keeping the start means the first two seconds of the output are the quiet
// part, which is measurable without any spectral analysis at all.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const path = require('path');
const fs = require('fs');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'voice_reference_window_v1.json');

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
    args: ['--window-size=1300,900', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message.slice(0, 120)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  const out = await page.evaluate(async () => {
    const VC = window.BlvckVoiceCloning;
    if (!VC) return { why: 'the voice cloning module is not loaded' };
    const SR = VC.TARGET_SR;

    // A quiet opening, then a loud dense body.
    const build = (totalSec, openingSec) => {
      const data = new Float32Array(Math.floor(totalSec * SR));
      for (let i = 0; i < data.length; i++) {
        const t = i / SR;
        const opening = t < openingSec;
        const amp = opening ? 0.25 : 0.9;
        // A tone for the opening and band-limited noise for the body, so both
        // read as real audio to the decoder and to the measurement.
        const v = opening
          ? Math.sin(2 * Math.PI * 220 * t)
          : (Math.sin(2 * Math.PI * 180 * t) * 0.6
             + Math.sin(2 * Math.PI * 1500 * t) * 0.3
             + (Math.random() * 2 - 1) * 0.25);
        data[i] = amp * v;
      }
      return new Blob([VC.encodeWav(data, SR)], { type: 'audio/wav' });
    };

    // Mean absolute amplitude of a stretch of the prepared wav, read back by
    // decoding it again — the same file the server would receive.
    const meanAbs = async (wavBlob, fromSec, toSec) => {
      const ctx = new AudioContext();
      const buf = await ctx.decodeAudioData(await wavBlob.arrayBuffer());
      const ch = buf.getChannelData(0);
      const rate = buf.sampleRate;
      const a = Math.max(0, Math.floor(fromSec * rate));
      const b = Math.min(ch.length, Math.floor(toSec * rate));
      let acc = 0;
      for (let i = a; i < b; i++) acc += Math.abs(ch[i]);
      await ctx.close();
      return b > a ? acc / (b - a) : 0;
    };

    const results = {};

    // 1. Twenty seconds — longer than the ceiling, so it must be cut, and the
    //    cut must be at the end. This is the reported case: a 20.3s take.
    const long = await VC.prepare(build(20, 2));
    results.long = {
      seconds: long.seconds, originalSec: long.originalSec, trimmed: long.trimmed,
      openingMean: await meanAbs(long.wav, 0, 1.5),
      bodyMean: await meanAbs(long.wav, 5, 10)
    };

    // 2. Nine seconds — inside the ceiling, so nothing should be removed.
    const short = await VC.prepare(build(9, 2));
    results.short = {
      seconds: short.seconds, originalSec: short.originalSec, trimmed: short.trimmed,
      openingMean: await meanAbs(short.wav, 0, 1.5),
      bodyMean: await meanAbs(short.wav, 5, 10)
    };

    results.MAX_SEC = VC.MAX_SEC;
    return results;
  });

  if (out.why) {
    check('the module is available', false, out.why);
    await browser.close();
    process.exit(1);
  }

  console.log(`=== the ceiling ===\n  MAX_SEC = ${out.MAX_SEC}`);
  // 12, not 25. The engine encodes the whole reference into its prompt and
  // refuses past roughly 15s — measured at 14s speaking and 16s returning a
  // 500 in 0.7s — and the usable length shrinks further as the script grows,
  // because reference tokens and spoken text share one sequence budget.
  check('the ceiling is the one the engine can actually use', out.MAX_SEC === 12, out.MAX_SEC);

  const L = out.long, S = out.short;
  console.log(`\n=== a 30s recording (quiet opening, loud body) ===`);
  console.log(`  kept ${L.seconds.toFixed(1)}s of ${L.originalSec.toFixed(1)}s`);
  console.log(`  first 1.5s mean |amp| ${L.openingMean.toFixed(4)} · body (5-10s) ${L.bodyMean.toFixed(4)}`
    + `  ratio ${(L.bodyMean / Math.max(1e-9, L.openingMean)).toFixed(2)}x`);

  check('a recording past the ceiling is cut down to it',
        L.seconds > 10.5 && L.seconds <= 12.05, L);
  check('and it is reported as trimmed', L.trimmed === true, L);
  // The opening is amplitude 0.25 against a body of 0.90 — a ratio near 3.6 if
  // it survived, and near 1 if the window started in the body instead.
  check('THE QUIET OPENING IS STILL AT THE FRONT OF THE FILE',
        L.bodyMean / Math.max(1e-9, L.openingMean) > 2,
        { opening: L.openingMean, body: L.bodyMean });

  console.log(`\n=== a 20s recording, inside the ceiling ===`);
  console.log(`  kept ${S.seconds.toFixed(1)}s of ${S.originalSec.toFixed(1)}s`);
  console.log(`  first 1.5s mean |amp| ${S.openingMean.toFixed(4)} · body (5-10s) ${S.bodyMean.toFixed(4)}`
    + `  ratio ${(S.bodyMean / Math.max(1e-9, S.openingMean)).toFixed(2)}x`);

  check('A RECORDING INSIDE THE CEILING IS KEPT WHOLE',
        Math.abs(S.seconds - S.originalSec) < 0.1, S);
  check('and is not reported as trimmed', S.trimmed === false, S);
  check('its opening is intact too',
        S.bodyMean / Math.max(1e-9, S.openingMean) > 2,
        { opening: S.openingMean, body: S.bodyMean });

  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), ...out }, null, 2));
  console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' · ') : 'All checks passed.'}`);
  console.log(`Written to ${OUT}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
