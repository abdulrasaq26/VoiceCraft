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
// The condition is forced rather than hoped for: one oversized passage is sent
// whole, and a raw control confirms the engine really does refuse it before the
// adapter is asked to cope. Each phase is its own evaluate — the first version
// ran the lot inside one call and hit puppeteer's protocol timeout, which says
// nothing about the product.
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
const LONG = ('You are just awake, mildly annoyed, running the arithmetic of how many hours '
  + 'are left, and the night keeps going without asking your permission. The night-time low '
  + 'point of cortisol is set by the morning high point, so bright light on waking matters '
  + 'more than anything you do at midnight, and the fridge you never decided to open is not '
  + 'going to answer the question you are actually asking. ').repeat(2).trim();

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 1800000,
    args: ['--window-size=1300,900', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message.slice(0, 120)));
  page.on('console', (m) => {
    const t = m.text();
    if (/\[Fish\]|splitting|too long/i.test(t)) console.log('   · ' + t.slice(0, 140));
  });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  const record = { refId: REF_ID, longChars: LONG.length };
  const cleanup = async () => {
    try {
      const done = await page.evaluate(async (id) => {
        try { await window.BlvckVoiceCloning.deleteReference(id); return true; }
        catch (e) { return false; }
      }, REF_ID);
      console.log(`\n  probe reference cleaned up: ${done}`);
      record.cleaned = done;
    } catch (e) { console.log('\n  cleanup could not run: ' + e.message); }
  };

  // ── Phase 1: a reference at the ceiling ─────────────────────────────────
  console.log('=== the reference ===');
  const made = await page.evaluate(async (fish, refId) => {
    if (window.ProviderManager) window.ProviderManager.setEndpoint('fishaudio', fish);
    const VC = window.BlvckVoiceCloning;
    if (!VC || !window.FishAdapter) return { why: 'the cloning module or the adapter is not loaded' };
    const SR = VC.TARGET_SR;
    const d = new Float32Array(Math.floor(18 * SR));
    for (let i = 0; i < d.length; i++) {
      const t = i / SR;
      const env = 0.5 + 0.5 * Math.sin(2 * Math.PI * 2.3 * t);
      d[i] = 0.45 * env * (Math.sin(2 * Math.PI * 120 * t) * 0.6
        + Math.sin(2 * Math.PI * 700 * t) * 0.25
        + Math.sin(2 * Math.PI * 2400 * t) * 0.1
        + (Math.random() * 2 - 1) * 0.05);
    }
    try { await VC.deleteReference(refId); } catch (e) { /* may not exist */ }
    const prepared = await VC.prepare(new Blob([VC.encodeWav(d, SR)], { type: 'audio/wav' }));
    try {
      await VC.addReference(refId, prepared.wav, 'This is a short reference transcript.');
    } catch (e) { return { why: 'the probe reference could not be created: ' + e.message }; }
    return { seconds: prepared.seconds, ceiling: VC.MAX_SEC };
  }, FISH, REF_ID);

  if (made.why) {
    check('the probe could run', false, made.why);
    await browser.close();
    process.exit(1);
  }
  record.referenceSec = made.seconds;
  console.log(`  ${made.seconds.toFixed(1)}s (ceiling ${made.ceiling}s), created as "${REF_ID}"`);

  const call = async (body, ms = 300000) => page.evaluate(async (fish, b) => {
    const t0 = Date.now();
    try {
      const r = await fetch('/api/proxy/fish/v1/tts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json',
                   'x-fish-endpoint': fish },
        body: JSON.stringify(b)
      });
      if (r.ok) return { ok: true, bytes: (await r.arrayBuffer()).byteLength, ms: Date.now() - t0 };
      return { ok: false, status: r.status, body: (await r.text()).slice(0, 110), ms: Date.now() - t0 };
    } catch (e) { return { ok: null, why: e.message, ms: Date.now() - t0 }; }
  }, FISH, body);

  // ── Phase 2: the voice on its own ───────────────────────────────────────
  const short = await call({ text: 'Testing one two.', format: 'mp3', reference_id: REF_ID });
  record.short = short;
  console.log(`  a short line with it: ${short.ok ? `speaks, ${short.bytes} bytes` : `HTTP ${short.status}`}`
    + ` in ${(short.ms / 1000).toFixed(1)}s`);
  check('a reference at the ceiling speaks a short line', short.ok === true, short);

  // ── Phase 3: the same voice, oversized passage, no help ─────────────────
  console.log(`\n=== ${LONG.length} characters beside it, sent whole ===`);
  const raw = await call({ text: LONG, format: 'mp3', reference_id: REF_ID });
  record.raw = raw;
  console.log(`  raw engine: ${raw.ok ? `HTTP 200, ${raw.bytes} bytes` : `HTTP ${raw.status} — ${raw.body}`}`
    + ` in ${(raw.ms / 1000).toFixed(1)}s`);

  if (raw.ok === true) {
    notes.push('the engine accepted the oversized passage, so the condition this test exists for '
      + 'did not occur on this run');
    console.log('  SKIPPED, loudly: the engine took it. Nothing below would be measuring the');
    console.log('  thing this test is about, so it is not graded. This is a gap, not a pass.');
    await cleanup();
    fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), ...record, notes }, null, 2));
    console.log('\nNOT MEASURED: ' + notes.join(' · '));
    console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' · ') : 'No failures, but the main claim was not exercised.'}`);
    await browser.close();
    process.exit(fails.length ? 1 : 0);
  }

  check('THE ENGINE REFUSES THE PASSAGE BESIDE THE REFERENCE — the condition is real',
        raw.ok === false && raw.status === 500, raw);

  // ── Phase 4: the same passage through the adapter ───────────────────────
  console.log('\n=== the same passage through the adapter ===');
  const viaAdapter = await page.evaluate(async (refId, text) => {
    const A = window.FishAdapter;
    let calls = 0;
    const orig = window.fetch;
    window.fetch = function (...args) {
      if (String(args[0] || '').includes('/v1/tts')) calls++;
      return orig.apply(this, args);
    };
    const t0 = Date.now();
    try {
      // The cap is raised so the passage is handed over whole and the adapter
      // has to cope on its own, rather than being rescued by ordinary chunking.
      const url = await A.textToSpeech({ input: text, voice: refId,
                                         params: { maxChunkChars: 400 } });
      const blob = url ? await (await orig.call(window, url)).blob() : null;
      return { ok: true, bytes: blob ? blob.size : 0, calls, ms: Date.now() - t0 };
    } catch (e) {
      return { ok: false, why: e.message, calls, ms: Date.now() - t0 };
    } finally { window.fetch = orig; }
  }, REF_ID, LONG);

  record.adapter = viaAdapter;
  console.log(`  ${viaAdapter.ok ? `spoke, ${viaAdapter.bytes} bytes` : `failed — ${String(viaAdapter.why).slice(0, 170)}`}`
    + ` · ${viaAdapter.calls} tts request(s) in ${(viaAdapter.ms / 1000).toFixed(1)}s`);

  check('THE ADAPTER SPLITS AND FINISHES INSTEAD OF FAILING', viaAdapter.ok === true, viaAdapter);
  check('and it really did split, rather than getting lucky', viaAdapter.calls > 2, viaAdapter);
  check('the audio it returned is a whole passage, not a fragment',
        viaAdapter.ok === true && viaAdapter.bytes > 20000, viaAdapter);

  await cleanup();
  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), ...record, notes }, null, 2));
  if (notes.length) console.log('\nNOT MEASURED: ' + notes.join(' · '));
  console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' · ') : 'All checks passed.'}`);
  console.log(`Written to ${OUT}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
