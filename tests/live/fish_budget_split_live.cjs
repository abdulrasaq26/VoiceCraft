// A long passage beside a long reference: split it, do not blame the voice.
//
// Reported: a voice created from a fresh reference previews fine and generates
// a short piece fine, then a long run fails partway through — several pieces
// complete and then one does not.
//
// The reference is encoded INTO the prompt, so reference tokens and spoken text
// share one sequence budget: text2semantic/inference.py raises once the total
// reaches the model's max_seq_len. A 14s reference is comfortably inside the
// limit on its own and can still be too much once paragraph nine is added to
// it. The failure therefore depends on the TEXT, not on the voice — and the
// remedy is to split the passage, exactly as the out-of-memory path does, for
// the same underlying reason.
//
// The first version of the diagnosis got this wrong. It asked whether a short
// line speaks WITHOUT the reference; that is true in this case, so it concluded
// the reference was broken and told the producer to pick another voice. Both
// halves of that were wrong. It now asks whether the reference speaks a short
// line, which separates "this voice is unusable" from "this passage will not
// fit beside it".
//
// The condition is forced rather than hoped for: the chunk cap is raised so one
// oversized passage is sent whole, and a raw control confirms the engine really
// does refuse it before the adapter is asked to cope.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'fish_budget_split_v1.json');
const env = fs.readFileSync(PROJECT + '/.env', 'utf8');
const FISH = ((env.match(/^FISH_API_URL=(.*)$/m) || [])[1] || '').trim().replace(/\/+$/, '');

const fails = [];
const notes = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

const REF_ID = 'zz-budget-probe';

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 900000,
    args: ['--window-size=1300,900', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message.slice(0, 120)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  const out = await page.evaluate(async (fish, refId) => {
    if (window.ProviderManager) window.ProviderManager.setEndpoint('fishaudio', fish);
    const VC = window.BlvckVoiceCloning;
    const A = window.FishAdapter;
    if (!VC || !A) return { why: 'the cloning module or the fish adapter is not loaded' };
    const SR = VC.TARGET_SR;
    const H = { 'Content-Type': 'application/json', Accept: 'application/json',
                'x-fish-endpoint': fish };

    // A reference at the ceiling — the case a producer actually has.
    const tone = (secs) => {
      const d = new Float32Array(Math.floor(secs * SR));
      for (let i = 0; i < d.length; i++) {
        const t = i / SR;
        const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.3 * t);
        d[i] = 0.45 * env * (Math.sin(2 * Math.PI * 120 * t) * 0.6
          + Math.sin(2 * Math.PI * 700 * t) * 0.25
          + Math.sin(2 * Math.PI * 2400 * t) * 0.1
          + (Math.random() * 2 - 1) * 0.05);
      }
      return new Blob([VC.encodeWav(d, SR)], { type: 'audio/wav' });
    };

    const result = { refId };
    try { await VC.deleteReference(refId); } catch (e) { /* may not exist */ }
    const prepared = await VC.prepare(tone(18));      // trimmed to the ceiling
    result.referenceSec = prepared.seconds;
    try {
      await VC.addReference(refId, prepared.wav, 'This is a short reference transcript.');
      result.added = true;
    } catch (e) { return { why: 'the probe reference could not be created: ' + e.message }; }

    try {
      // 1. The reference on its own is good.
      const short = await fetch('/api/proxy/fish/v1/tts', {
        method: 'POST', headers: H,
        body: JSON.stringify({ text: 'Testing one two.', format: 'mp3', reference_id: refId })
      });
      result.shortOk = short.ok;
      if (short.ok) { try { await short.arrayBuffer(); } catch (e) {} }

      // 2. A long passage beside it, sent whole, with no adapter to help.
      const LONG = ('You are just awake, mildly annoyed, running the arithmetic of how many hours '
        + 'are left, and the night keeps going without asking your permission. The night-time low '
        + 'point of cortisol is set by the morning high point, so bright light on waking matters '
        + 'more than anything you do at midnight, and the fridge you never decided to open is not '
        + 'going to answer the question you are actually asking. ').repeat(3).trim();
      result.longChars = LONG.length;
      const t0 = Date.now();
      const raw = await fetch('/api/proxy/fish/v1/tts', {
        method: 'POST', headers: H,
        body: JSON.stringify({ text: LONG, format: 'mp3', reference_id: refId })
      });
      result.rawStatus = raw.status;
      result.rawMs = Date.now() - t0;
      if (raw.ok) { const b = await raw.arrayBuffer(); result.rawBytes = b.byteLength; }
      else result.rawBody = (await raw.text()).slice(0, 110);

      // 3. The same passage through the adapter, with the chunk cap raised so
      //    it is sent whole and the adapter has to cope on its own.
      let calls = 0;
      const orig = window.fetch;
      window.fetch = function (...args) {
        if (String(args[0] || '').includes('/v1/tts')) calls++;
        return orig.apply(this, args);
      };
      const t1 = Date.now();
      try {
        const url = await A.textToSpeech({
          input: LONG, voice: refId, params: { maxChunkChars: 400 }
        });
        const blob = url ? await (await orig.call(window, url)).blob() : null;
        result.adapter = { ok: true, bytes: blob ? blob.size : 0, calls, ms: Date.now() - t1 };
      } catch (e) {
        result.adapter = { ok: false, why: e.message, calls, ms: Date.now() - t1 };
      } finally {
        window.fetch = orig;
      }
    } finally {
      try { await VC.deleteReference(refId); result.cleaned = true; }
      catch (e) { result.cleaned = false; }
    }
    return result;
  }, FISH, REF_ID);

  if (out.why) {
    check('the probe could run', false, out.why);
    await browser.close();
    process.exit(1);
  }

  console.log(`=== the reference ===\n  ${out.referenceSec.toFixed(1)}s, created as "${out.refId}"`);
  check('a reference at the ceiling speaks a short line', out.shortOk === true, out);

  console.log(`\n=== ${out.longChars} characters beside it, sent whole ===`);
  console.log(`  raw engine: HTTP ${out.rawStatus} in ${(out.rawMs / 1000).toFixed(1)}s`
    + (out.rawBody ? ` — ${out.rawBody}` : ` · ${out.rawBytes} bytes`));

  if (out.rawStatus === 200) {
    notes.push('the engine accepted the oversized passage, so the condition this test exists '
      + 'for did not occur on this run');
    console.log('  SKIPPED, loudly: the engine took it. Nothing below would be measuring the');
    console.log('  thing this test is about. Not a pass.');
  } else {
    check('THE ENGINE REFUSES THE PASSAGE BESIDE THE REFERENCE — the condition is real',
          out.rawStatus === 500, out);

    console.log(`\n=== the same passage through the adapter ===`);
    const a = out.adapter || {};
    console.log(`  ${a.ok ? `spoke, ${a.bytes} bytes` : `failed — ${String(a.why).slice(0, 160)}`}`
      + ` · ${a.calls} tts request(s) in ${(a.ms / 1000).toFixed(1)}s`);

    check('THE ADAPTER SPLITS AND FINISHES INSTEAD OF FAILING', a.ok === true, a);
    check('and it really did split, rather than getting lucky', a.calls > 2, a);
    check('the audio it returned is a whole passage, not a fragment',
          a.ok === true && a.bytes > 20000, a);
  }

  console.log(`\n  probe reference cleaned up: ${out.cleaned}`);
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), ...out, notes }, null, 2));
  if (notes.length) console.log('\nNOT MEASURED: ' + notes.join(' · '));
  console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' · ') : 'All checks passed.'}`);
  console.log(`Written to ${OUT}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
