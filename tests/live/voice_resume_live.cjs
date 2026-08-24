// Losing the engine mid-run should cost what is left, not what is done.
//
// The queue generates a script as parts, and each PART is spoken by the engine
// as a series of small PIECES — nine of them is normal for a long part. Until
// now a failure on any piece threw away every finished piece before it, so a
// tunnel that dropped three quarters of the way through cost the whole part,
// minutes of GPU time, and again on every retry. And there were three ways to
// be stuck: no retry on the row that failed, a Cancel button that only took
// effect between parts, and a run that marched every remaining part into the
// same dead endpoint.
//
// The engine here is a stub, deliberately: what is being tested is the queue's
// behaviour when the engine misbehaves, and a real Fish tunnel cannot be made
// to drop on command at piece six. The stub answers on the same interface the
// adapter does, counts what it is asked for, and can be told to fail.
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
    defaultViewport: null, protocolTimeout: 300000,
    args: ['--window-size=1400,950', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 120)); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  // ── The stub engine ─────────────────────────────────────────────────────
  const installEngine = () => page.evaluate(() => {
    window.__fish = {
      calls: [],          // one entry per piece actually requested
      failAt: null,       // { part, piece, message }
      delayMs: 40,
      seeds: []
    };

    // Stands in for FishAdapter.textToSpeech: same arguments, same resume
    // contract, same abort behaviour.
    window.FishAdapter = window.FishAdapter || {};
    window.FishAdapter.textToSpeech = async ({ input, params = {}, onProgress, signal, resume }) => {
      const F = window.__fish;
      const part = Number((String(input).match(/^PART(\d+)/) || [])[1] || 0);
      // Six pieces per part, so "most of a part" is a meaningful amount to lose.
      const pieces = 6;

      let seed = params.seed;
      if (seed == null && resume && resume.seed != null) seed = Number(resume.seed);
      if (seed == null) seed = Math.floor(Math.random() * 1e9);
      if (resume && resume.onSeed) resume.onSeed(seed);
      F.seeds.push({ part, seed });

      const out = [];
      for (let i = 0; i < pieces; i++) {
        if (signal && signal.aborted) { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; }

        if (resume && resume.get) {
          const kept = await resume.get(i);
          if (kept && kept.byteLength) { out.push(kept); continue; }
        }

        F.calls.push({ part, piece: i, seed });
        await new Promise((r) => setTimeout(r, F.delayMs));
        if (signal && signal.aborted) { const e = new Error('cancelled'); e.name = 'AbortError'; throw e; }
        if (F.failAt && F.failAt.part === part && F.failAt.piece === i) throw new Error(F.failAt.message);

        if (onProgress) onProgress(`Piece ${i + 1} of ${pieces}…`);
        const buf = new Uint8Array(64).fill(part * 10 + i).buffer;
        out.push(buf);
        if (resume && resume.put) await resume.put(i, buf);
      }
      const total = out.reduce((n, b) => n + b.byteLength, 0);
      const joined = new Uint8Array(total);
      let at = 0;
      for (const b of out) { joined.set(new Uint8Array(b), at); at += b.byteLength; }
      return URL.createObjectURL(new Blob([joined], { type: 'audio/mp3' }));
    };
  });
  await installEngine();

  // Drive the real queue with a five-part script.
  const setup = async (opts = {}) => page.evaluate(async (o) => {
    const F = window.__fish;
    F.calls = []; F.seeds = []; F.failAt = o.failAt || null; F.delayMs = o.delayMs || 40;

    // The provider has to be Fish for the adapter path to be taken, and the
    // chunker has to give exactly five parts.
    localStorage.setItem('blvck:tts_provider', 'fishaudio');
    if (window.BlvckAI && window.BlvckAI.setTtsProvider) window.BlvckAI.setTtsProvider('fishaudio');

    const T = window.BlvckVoiceQueue;
    await T._clearBatch();
    T._setBatch([1, 2, 3, 4, 5].map((n) => `PART${n} of the script.`));
    return T._state();
  }, opts);

  const state = () => page.evaluate(() => window.BlvckVoiceQueue._state());
  const settle = async (want, ms = 30000) => {
    const t0 = Date.now();
    for (;;) {
      const st = await state();
      if (want(st)) return st;
      if (Date.now() - t0 > ms) return st;
      await new Promise((r) => setTimeout(r, 150));
    }
  };

  const hooked = await page.evaluate(() => !!window.BlvckVoiceQueue);
  check('the voice queue exposes what a test can drive', hooked === true, hooked);
  if (!hooked) { await browser.close(); process.exit(1); }

  // ── 1. A tunnel that drops mid-part ─────────────────────────────────────
  console.log('\n=== the engine goes away during part 2, on its fifth piece ===');
  await setup({ failAt: { part: 2, piece: 4,
    message: 'Fish Audio API error (503): ngrok gateway error ERR_NGROK_3004' } });
  await page.evaluate(() => window.BlvckVoiceQueue._run());
  const dropped = await settle((st) => !st.running);
  const asked = await page.evaluate(() => window.__fish.calls);

  console.log('  ' + dropped.items.map((i) => `${i.part}:${i.status}${i.pieces ? `(${i.pieces}p)` : ''}`).join('  '));
  console.log(`  the engine was asked for ${asked.length} piece(s)`);
  console.log(`  status: ${dropped.status.slice(0, 150)}`);

  check('part 1 finished', dropped.items[0].status === 'done', dropped.items[0]);
  check('part 2 is the one that failed', dropped.items[1].status === 'error', dropped.items[1]);
  check('and it says the engine went away, not that the part is bad',
        /ngrok|503/i.test(dropped.items[1].error || ''), dropped.items[1]);
  check('THE FOUR PIECES IT HAD ALREADY SPOKEN ARE KEPT',
        dropped.items[1].pieces === 4, dropped.items[1]);
  check('PARTS 3 TO 5 WERE NOT MARCHED INTO THE SAME WALL — they are still queued',
        dropped.items.slice(2).every((i) => i.status === 'pending'), dropped.items);
  check('so nothing after the failure was even asked for',
        asked.every((c) => c.part <= 2), asked.filter((c) => c.part > 2));
  check('and the queue says where it stopped and that it can pick up there',
        /went away at/i.test(dropped.status) && /Continue/.test(dropped.status), dropped.status);

  // ── 2. Continue picks up at the piece it stopped on ─────────────────────
  console.log('\n=== the engine comes back, and Continue is pressed ===');
  await page.evaluate(() => { window.__fish.failAt = null; window.__fish.calls = []; });
  await page.evaluate(() => window.BlvckVoiceQueue._run());
  const finished = await settle((st) => !st.running && st.items.every((i) => i.status === 'done'), 40000);
  const asked2 = await page.evaluate(() => window.__fish.calls);
  const part2Again = asked2.filter((c) => c.part === 2);

  console.log('  ' + finished.items.map((i) => `${i.part}:${i.status}`).join('  '));
  console.log(`  part 2 needed ${part2Again.length} more piece(s): `
    + part2Again.map((c) => c.piece).join(', '));

  check('every part is finished', finished.items.every((i) => i.status === 'done'), finished.items);
  check('PART 2 COST TWO PIECES, NOT SIX — it resumed where it stopped',
        part2Again.length === 2, part2Again);
  check('and it resumed at the piece that failed, not at the beginning',
        part2Again.length > 0 && part2Again[0].piece === 4, part2Again);
  check('under the seed the kept pieces were spoken with, so the voice matches',
        new Set(asked2.filter((c) => c.part === 2).map((c) => c.seed)).size === 1
        && asked2.find((c) => c.part === 2).seed === asked.find((c) => c.part === 2).seed,
        { then: asked.find((c) => c.part === 2), now: asked2.find((c) => c.part === 2) });
  check('and the parts after it were finally generated',
        asked2.some((c) => c.part === 5), asked2.map((c) => c.part));

  // ── 3. Cancel, during a part rather than between them ───────────────────
  console.log('\n=== Cancel, pressed while a part is being spoken ===');
  // Slow pieces, so "stopped now" and "waited out the part" are far apart: six
  // pieces at 1.2s is over seven seconds of part left to run.
  await setup({ delayMs: 1200 });
  page.evaluate(() => window.BlvckVoiceQueue._run());
  await settle((st) => st.items.some((i) => i.status === 'generating'), 15000);
  await new Promise((r) => setTimeout(r, 2600));          // let a piece or two land
  const callsAtClick = await page.evaluate(() => window.__fish.calls.length);
  const t0 = Date.now();
  await page.evaluate(() => document.getElementById('cancel-btn').click());
  const stopped = await settle((st) => !st.running, 8000);
  const tookMs = Date.now() - t0;
  const askedC = await page.evaluate(() => window.__fish.calls);

  console.log(`  stopped in ${tookMs}ms after the click`);
  console.log('  ' + stopped.items.map((i) => `${i.part}:${i.status}${i.pieces ? `(${i.pieces}p)` : ''}`).join('  '));

  check('CANCEL STOPS THE RUN WITHOUT WAITING OUT THE PART',
        stopped.running === false && tookMs < 2000, { tookMs, running: stopped.running });
  check('the part it interrupted is queued again, not marked failed',
        stopped.items.every((i) => i.status !== 'error'), stopped.items);
  check('and it keeps the pieces it had already spoken',
        stopped.items.some((i) => (i.pieces || 0) > 0), stopped.items);
  // The piece in flight is already asked for; nothing beyond it should be.
  check('and the engine is not asked for another piece after the click',
        askedC.length - callsAtClick === 0, { callsAtClick, after: askedC.length });

  // ── 4. Retrying one row ─────────────────────────────────────────────────
  console.log('\n=== one failed part, retried from its own row ===');
  await setup({ failAt: { part: 3, piece: 2, message: 'Fish Audio API error (500): CUDA out of memory' } });
  await page.evaluate(() => window.BlvckVoiceQueue._run());
  const oom = await settle((st) => !st.running, 30000);
  console.log('  ' + oom.items.map((i) => `${i.part}:${i.status}`).join('  '));

  check('a failure that is NOT about the connection does not halt the queue',
        oom.items.filter((i) => i.status === 'done').length === 4
        && oom.items[2].status === 'error', oom.items);

  const rowButtons = await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#queue-list .queue-item')];
    const failed = rows.find((r) => r.classList.contains('is-error'));
    if (!failed) return { error: 'no failed row on screen' };
    const btns = [...failed.querySelectorAll('button')].map((b) => ({ t: b.textContent, title: b.title }));
    return { buttons: btns, retryVisible: !document.getElementById('retry-btn').hidden };
  });
  console.log(`  the failed row offers: ${(rowButtons.buttons || []).map((b) => b.t).join(' ')}`);
  check('the failed row has a retry of its own',
        (rowButtons.buttons || []).some((b) => b.t === '↻'), rowButtons);
  check('and its tooltip says what will be kept',
        (rowButtons.buttons || []).some((b) => /already spoken/.test(b.title || '')), rowButtons);

  await page.evaluate(() => { window.__fish.failAt = null; window.__fish.calls = []; });
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#queue-list .queue-item')];
    const failed = rows.find((r) => r.classList.contains('is-error'));
    [...failed.querySelectorAll('button')].find((b) => b.textContent === '↻').click();
  });
  const retried = await settle((st) => !st.running && st.items.every((i) => i.status === 'done'), 30000);
  const askedR = await page.evaluate(() => window.__fish.calls);
  console.log(`  retrying part 3 asked for ${askedR.length} piece(s): `
    + askedR.map((c) => `${c.part}.${c.piece}`).join(' '));

  check('pressing it finishes that part', retried.items[2].status === 'done', retried.items[2]);
  check('AND ONLY THAT PART — the four that were fine are not spoken again',
        askedR.every((c) => c.part === 3), askedR);
  check('resuming from the piece that failed', askedR[0] && askedR[0].piece === 2, askedR[0]);

  // ── 5. The tunnel dies, a NEW server is started, the page is reloaded ────
  //
  // The case a producer actually hits: Fish falls over mid-run, they restart
  // the Colab and get a different ngrok URL, and they reload AETHER. None of
  // that is supposed to cost the work already done — the pieces live in
  // IndexedDB under the batch, and nothing in the resume signature depends on
  // which endpoint spoke them.
  console.log('\n=== a new Fish server, and a reloaded page ===');
  await setup({ failAt: { part: 2, piece: 3,
    message: 'Fish Audio API error (503): ngrok gateway error ERR_NGROK_3004' } });
  await page.evaluate(() => window.BlvckVoiceQueue._run());
  const beforeReload = await settle((st) => !st.running, 30000);
  const seedBefore = beforeReload.items[1].seed;
  console.log('  before: ' + beforeReload.items.map((i) => `${i.part}:${i.status}${i.pieces ? `(${i.pieces}p)` : ''}`).join('  '));

  check('the run stopped with part 2 part-spoken',
        beforeReload.items[1].status === 'error' && beforeReload.items[1].pieces === 3,
        beforeReload.items[1]);

  // A different server, exactly as restarting the Colab would give.
  const endpoints = await page.evaluate(() => {
    const was = (window.ProviderManager.getPoolState('fishaudio') || {}).endpoint || '';
    window.ProviderManager.setEndpoint('fishaudio', 'https://a-brand-new-tunnel.ngrok-free.app');
    return { was, now: (window.ProviderManager.getPoolState('fishaudio') || {}).endpoint };
  });
  console.log(`  endpoint ${endpoints.was || '(none)'} → ${endpoints.now}`);

  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await installEngine();
  await page.evaluate(() => { window.__fish.calls = []; window.__fish.failAt = null; });

  const restored = await settle((st) => st.items.length > 0, 20000);
  console.log('  after reload: ' + restored.items.map((i) => `${i.part}:${i.status}${i.pieces ? `(${i.pieces}p)` : ''}`).join('  '));
  console.log(`  status: ${restored.status.slice(0, 140)}`);

  check('THE BATCH SURVIVES THE RELOAD', restored.items.length === 5, restored.items);
  check('and so do the pieces that were already spoken',
        restored.items[1].pieces === 3, restored.items[1]);
  check('with the seed they were spoken under',
        restored.items[1].seed === seedBefore, { before: seedBefore, after: restored.items[1].seed });
  check('the queue says what is left and that the pieces are kept',
        /part\(s\) left/.test(restored.status) && /piece\(s\)/.test(restored.status), restored.status);

  const continueVisible = await page.evaluate(() =>
    !document.getElementById('resume-btn').hidden
    && document.getElementById('resume-btn').textContent.trim());
  check('and offers Continue rather than making them start again',
        continueVisible === 'Continue', continueVisible);

  await page.evaluate(() => document.getElementById('resume-btn').click());
  const afterReload = await settle((st) => !st.running && st.items.every((i) => i.status === 'done'), 40000);
  const askedAfter = await page.evaluate(() => window.__fish.calls);
  const part2After = askedAfter.filter((c) => c.part === 2);
  console.log(`  part 2 needed ${part2After.length} more piece(s) from the new server: `
    + part2After.map((c) => c.piece).join(', '));

  check('every part finishes on the new server',
        afterReload.items.every((i) => i.status === 'done'), afterReload.items);
  check('PART 2 RESUMED AT PIECE 4 ON A DIFFERENT SERVER AFTER A RELOAD',
        part2After.length === 3 && part2After[0].piece === 3, part2After);
  check('and the new server was given the old seed, so the voice does not change mid-part',
        part2After.every((c) => c.seed === seedBefore), { seedBefore, got: part2After.map((c) => c.seed) });
  check('parts 1 was not spoken again', !askedAfter.some((c) => c.part === 1), askedAfter.map((c) => c.part));

    check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'AN INTERRUPTED RUN COSTS WHAT IS LEFT, NOT WHAT IS DONE'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
