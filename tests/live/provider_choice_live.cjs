// Picking a brain must actually skip the other one.
//
// The complaint this answers is about wasted time, so the test that matters is
// not "does it return the right provider" — it is "does it stop calling the one
// I did not pick". Every Qwen health probe is counted, and a pinned NIM must
// make none: not fewer, none. A setting that still probes first would look
// correct from the outside and change nothing about the waiting.
//
// The second half is about honesty. A pinned provider that quietly falls back
// means a run reported as Qwen actually came from NIM, which is worse than the
// discovery it replaced.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

// Count every call to each provider, and answer them without a network.
const INSTRUMENT = () => {
  window.__hits = { qwenHealth: 0, qwenWork: 0, nimWork: 0 };
  const real = window.fetch;
  window.fetch = async (url, opts) => {
    const u = String(url);
    if (u.indexOf('/api/proxy/qwen/health') >= 0) {
      window.__hits.qwenHealth++;
      return { ok: true, status: 200, json: async () => ({ status: window.__qwenUp ? 'ok' : 'down' }) };
    }
    if (u.indexOf('/api/proxy/qwen') >= 0) {
      window.__hits.qwenWork++;
      if (window.__qwenFails) throw new Error('Qwen exploded');
      return { ok: true, status: 200, json: async () => ({ success: true, plan: { scenes: [] } }) };
    }
    if (u.indexOf('/api/proxy/nvidia') >= 0) {
      window.__hits.nimWork++;
      return { ok: true, status: 200,
               text: async () => JSON.stringify({ choices: [{ message: { content: '{"scenes":[]}' } }] }),
               json: async () => ({ choices: [{ message: { content: '{"scenes":[]}' } }] }) };
    }
    return real(url, opts);
  };
};

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null,
    protocolTimeout: 180000,
    args: ['--window-size=1400,950']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 120)); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  // ── The default must not change ───────────────────────────────────────────
  const dflt = await page.evaluate(() => {
    localStorage.removeItem('blvck:director_provider');
    return window.AIManager.providerChoice();
  });
  check('the default is still automatic', dflt === 'auto', dflt);

  // ── Pinned NIM: Qwen must not be contacted at all ─────────────────────────
  const nim = await page.evaluate(async (instrument) => {
    eval('(' + instrument + ')()');
    window.__qwenUp = true;                    // Qwen is UP — and still must not be used
    window.AIManager.setProviderChoice('nim');
    const p = await window.AIManager.getProvider();
    return { hits: window.__hits, isNim: p === window.AIManager.nim,
             badge: (document.querySelector('.ai-provider-status') || {}).innerHTML || '' };
  }, INSTRUMENT.toString());
  console.log(`\n  pinned NIM  → qwen health probes: ${nim.hits.qwenHealth}`);
  check('NIM is used', nim.isNim, nim);
  check('Qwen is never probed, even though it is up', nim.hits.qwenHealth === 0, nim.hits);
  check('the badge says chosen, not fallback',
        /Selected/.test(nim.badge) && !/Fallback/.test(nim.badge), nim.badge);

  // ── Pinned Qwen: NIM must not be reached, even when Qwen fails ────────────
  const qwen = await page.evaluate(async (instrument) => {
    eval('(' + instrument + ')()');
    window.__qwenUp = false;                   // Qwen is DOWN — and must still be used
    window.AIManager.setProviderChoice('qwen');
    const p = await window.AIManager.getProvider();
    return { hits: window.__hits, isQwen: p === window.AIManager.qwen,
             badge: (document.querySelector('.ai-provider-status') || {}).innerHTML || '' };
  }, INSTRUMENT.toString());
  console.log(`  pinned Qwen → qwen health probes: ${qwen.hits.qwenHealth}`);
  check('Qwen is used even though it is unreachable', qwen.isQwen, qwen);
  check('and it is not probed first either', qwen.hits.qwenHealth === 0, qwen.hits);
  check('the badge names Qwen as chosen', /Qwen/.test(qwen.badge) && /Selected/.test(qwen.badge), qwen.badge);

  // ── A pinned Qwen failure is reported, not handed to NIM ──────────────────
  const noSwap = await page.evaluate(async (instrument) => {
    eval('(' + instrument + ')()');
    window.__qwenFails = true;
    window.AIManager.setProviderChoice('qwen');
    let threw = null;
    try {
      await window.AIManager.generateJSON('/api/storyboard/scenes', { cues: [] }, {});
    } catch (e) { threw = e.message; }
    return { threw, nimWork: window.__hits.nimWork };
  }, INSTRUMENT.toString());
  console.log(`  pinned Qwen failing → NIM calls: ${noSwap.nimWork}`);
  check('the failure surfaces instead of being swallowed', !!noSwap.threw, noSwap);
  check('and NIM is not quietly used instead', noSwap.nimWork === 0, noSwap);

  // ── Automatic still discovers ─────────────────────────────────────────────
  const auto = await page.evaluate(async (instrument) => {
    eval('(' + instrument + ')()');
    window.__qwenUp = false;
    window.__qwenFails = false;
    window.AIManager.setProviderChoice('auto');
    const p = await window.AIManager.getProvider();
    return { hits: window.__hits, isNim: p === window.AIManager.nim,
             badge: (document.querySelector('.ai-provider-status') || {}).innerHTML || '' };
  }, INSTRUMENT.toString());
  console.log(`  automatic   → qwen health probes: ${auto.hits.qwenHealth}`);
  check('automatic still probes Qwen', auto.hits.qwenHealth > 0, auto.hits);
  check('and falls back when it is down', auto.isNim, auto);
  check('and still reads as a fallback, not a choice',
        /Fallback/.test(auto.badge), auto.badge);

  // ── The choice survives a reload ──────────────────────────────────────────
  await page.evaluate(() => window.AIManager.setProviderChoice('nim'));
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 1500));
  const persisted = await page.evaluate(() => ({
    choice: window.AIManager.providerChoice(),
    select: (document.getElementById('set-director-provider') || {}).value,
    badge: (document.querySelector('.ai-provider-status') || {}).innerHTML || ''
  }));
  check('the choice survives a reload', persisted.choice === 'nim', persisted);
  check('and the badge comes back saying so', /Selected/.test(persisted.badge), persisted.badge);

  // ── The dialog shows it ───────────────────────────────────────────────────
  const dialog = await page.evaluate(async () => {
    // openModal is async - it awaits a gateway sync before calling populate() -
    // so reading straight after the click sees the dialog's previous contents.
    // The first version of this test did exactly that and reported the app
    // showing a stale choice it had simply not been given time to write.
    document.getElementById('ai-settings-open').click();
    const sel = document.getElementById('set-director-provider');
    const note = document.getElementById('director-provider-note');
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (note && note.textContent.trim()) break;
    }
    return { value: sel && sel.value, options: sel ? [...sel.options].map((o) => o.value) : [],
             note: (note || {}).textContent || '' };
  });
  console.log(`\n  settings shows: "${dialog.value}" · note: "${dialog.note.slice(0, 60)}…"`);
  check('the dialog offers all three modes',
        dialog.options.join(',') === 'auto,qwen,nim', dialog.options);
  check('and opens on the stored choice', dialog.value === 'nim', dialog.value);
  check('and explains what it does', dialog.note.length > 20, dialog.note);

  check('nothing threw throughout', pageErrors.length === 0, pageErrors.slice(0, 4));

  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'THE BRAIN IS A CHOICE, AND THE OTHER ONE IS LEFT ALONE'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
