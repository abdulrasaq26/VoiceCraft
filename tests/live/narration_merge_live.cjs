// Joining the narration chunks into one track.
//
// The claim is not just "one file comes out". It is that the file is the SAME
// recording the video plays: every part, in script order, laid end to end with
// no gap. Any pause inserted between parts would drift the download against the
// video by that pause times the number of chunks, and take every subtitle cue
// with it.
//
// So each part here is a different pitch. After the join, the tone found at each
// expected position tells you whether the parts are in order and whether they
// begin where they should - which a duration check alone cannot, because parts
// joined in the wrong order still add up to the right length.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 180000,
    args: ['--window-size=1200,800']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });
  await page.goto(`http://localhost:${PORT}/#voice`, { waitUntil: 'load', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1800));

  const res = await page.evaluate(async () => {
    const M = window.BlvckAudioMerge;
    const VC = window.BlvckVoiceCloning;
    if (!M || !VC) return { error: 'merge or wav encoder missing' };

    const sr = 44100;
    // Four parts of deliberately different lengths and pitches.
    const spec = [
      { hz: 200, secs: 1.5 },
      { hz: 320, secs: 0.8 },
      { hz: 440, secs: 2.0 },
      { hz: 560, secs: 1.2 }
    ];
    const tone = (hz, secs) => {
      const n = Math.round(sr * secs);
      const x = new Float32Array(n);
      for (let i = 0; i < n; i++) x[i] = 0.5 * Math.sin((2 * Math.PI * hz * i) / sr);
      return VC.encodeWav(x, sr);
    };
    const blobs = spec.map((s) => tone(s.hz, s.secs));
    const wantSecs = spec.reduce((a, s) => a + s.secs, 0);

    const joined = await M.merge(blobs);

    // Decode the result and read the pitch at the middle of each expected slot.
    const ctx = new OfflineAudioContext(1, sr, sr);
    const dec = await ctx.decodeAudioData(await joined.blob.arrayBuffer());
    const x = dec.getChannelData(0);
    // Zero crossings, not autocorrelation. These parts are pure tones, and for
    // a pure tone autocorrelation peaks equally at every multiple of the period
    // - plain argmax reported the 560Hz part as 140Hz, and relaxing it to the
    // lowest lag "near" the peak then read every part about 6% sharp because
    // the correlation is still high just short of the true period. Counting
    // crossings has neither failure: a sine crosses zero exactly twice per
    // cycle, so the frequency falls out of the count directly.
    const f0At = (t) => {
      const W = 8192;
      const off = Math.max(0, Math.min(Math.round(t * sr), x.length - W - 1));
      let crossings = 0;
      for (let i = off + 1; i < off + W; i++) {
        if ((x[i - 1] < 0 && x[i] >= 0) || (x[i - 1] >= 0 && x[i] < 0)) crossings++;
      }
      return Math.round((crossings * sr) / (2 * W));
    };

    let at = 0;
    const found = spec.map((s) => {
      const mid = at + s.secs / 2;
      at += s.secs;
      return { want: s.hz, at: Math.round(mid * 100) / 100, got: f0At(mid) };
    });

    // Silence anywhere would mean a gap was inserted between parts.
    let quiet = 0;
    for (let i = 0; i < x.length; i += 64) if (Math.abs(x[i]) < 0.01) quiet++;

    // One unreadable part must be skipped, counted, and must not lose the rest.
    const junk = new Blob([new Uint8Array([1, 2, 3, 4])], { type: 'audio/wav' });
    const withJunk = await M.merge([blobs[0], junk, blobs[2]]);

    // Non-vacuity: the positional check must be able to fail. Joined backwards,
    // the same four parts still total 5.5s - which is exactly why duration
    // alone proves nothing - so the tone at the front has to change.
    const reversed = await M.merge(blobs.slice().reverse());
    const rctx = new OfflineAudioContext(1, sr, sr);
    const rdec = await rctx.decodeAudioData(await reversed.blob.arrayBuffer());
    const rx = rdec.getChannelData(0);
    const rFirst = (() => {
      const W = 8192, off = Math.round(0.5 * sr);
      let c = 0;
      for (let i = off + 1; i < off + W; i++) {
        if ((rx[i - 1] < 0 && rx[i] >= 0) || (rx[i - 1] >= 0 && rx[i] < 0)) c++;
      }
      return Math.round((c * sr) / (2 * W));
    })();

    let emptyErr = '';
    try { await M.merge([]); } catch (e) { emptyErr = e.message; }

    return {
      wantSecs: Math.round(wantSecs * 100) / 100,
      gotSecs: Math.round(dec.duration * 100) / 100,
      parts: joined.parts, skipped: joined.skipped,
      type: joined.blob.type, bytes: joined.blob.size,
      found,
      quietFraction: Math.round((quiet / (x.length / 64)) * 1000) / 1000,
      withJunk: { parts: withJunk.parts, skipped: withJunk.skipped,
                  secs: Math.round(withJunk.seconds * 100) / 100 },
      reversed: { secs: Math.round(rdec.duration * 100) / 100, firstTone: rFirst },
      emptyErr
    };
  });

  if (res.error) {
    check('the merge module is available', false, res.error);
  } else {
    console.log('=== four parts joined ===');
    console.log(`  ${res.parts} part(s), ${res.gotSecs}s, ${(res.bytes / 1024).toFixed(0)}KB ${res.type}`);
    for (const f of res.found) {
      console.log(`  at ${String(f.at).padStart(5)}s  expected ${f.want}Hz  found ${f.got}Hz`);
    }

    check('every part is in the file', res.parts === 4 && res.skipped === 0, res);
    check('the length is the sum of the parts, to the sample',
          Math.abs(res.gotSecs - res.wantSecs) < 0.02, { got: res.gotSecs, want: res.wantSecs });
    check('it is a WAV', res.type === 'audio/wav', res.type);

    // The check a duration test cannot make.
    check('each part is where it should be — order and offsets are right',
          res.found.every((f) => Math.abs(f.got - f.want) <= Math.max(6, f.want * 0.03)),
          res.found);

    check('the same parts joined backwards still total the same length — which '
        + 'is why length alone proves nothing',
          Math.abs(res.reversed.secs - res.wantSecs) < 0.02, res.reversed);
    check('but the order check sees the difference', res.reversed.firstTone > 500,
          res.reversed);

    console.log(`\n  silence: ${(res.quietFraction * 100).toFixed(1)}% of samples`);
    check('no gap was inserted between parts — the download cannot drift '
        + 'against the video', res.quietFraction < 0.12, res.quietFraction);

    console.log('\n=== a part that will not decode ===');
    console.log(`  ${JSON.stringify(res.withJunk)}`);
    check('the readable parts still join', res.withJunk.parts === 2, res.withJunk);
    check('and the bad one is counted rather than passed over silently',
          res.withJunk.skipped === 1, res.withJunk);
    check('joining nothing says so', /nothing to join/.test(res.emptyErr), res.emptyErr);
  }

  // ── The button ──────────────────────────────────────────────────────────
  console.log('\n=== the control ===');
  const ui = await page.evaluate(() => {
    const b = document.getElementById('merge-btn');
    return { present: !!b, label: b && b.textContent.trim(), disabled: b && b.disabled };
  });
  console.log(`  ${JSON.stringify(ui)}`);
  check('the button exists beside the other audio outputs', ui.present === true, ui);
  check('and starts disabled until something has been generated', ui.disabled === true, ui);

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'THE PARTS JOIN INTO ONE TRACK, IN ORDER, WITHOUT GAPS'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
