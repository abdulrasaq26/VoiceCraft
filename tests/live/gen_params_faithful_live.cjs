// An untouched panel sends nothing, and a cloned voice is left as recorded.
//
// A reference voice already contains the delivery somebody recorded. Every
// control in the engine-parameters panel steers away from it, and the panel
// steered by default: the sliders always held values and those values were
// always sent.
//
// Worse, the narration-style select reached sideways into them. Its handler
// wrote a sampling preset to storage, so choosing "Storytelling" once left
// temperature 0.85 / top_p 0.90 / repetition_penalty 1.05 applied to every
// later run under every other style — which is how a panel reading
// "Documentary" comes to be sending the storytelling preset. That is the
// reported symptom, and it is measured directly below.
//
// The claim under test is about the REQUEST, not about the UI: what leaves the
// browser is intercepted and read. Nothing is stubbed except the network hop
// itself, which is captured and refused so the test costs no GPU time.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'gen_params_faithful_v1.json');
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

const STEER = ['temperature', 'top_p', 'repetition_penalty'];

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 300000,
    args: ['--window-size=1400,950', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message.slice(0, 120)));

  // A clean slate: no stored params, no stored choice. This is what a producer
  // who has never opened the panel actually has.
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((fish) => {
    localStorage.removeItem('blvck:tts_gen_params');
    localStorage.removeItem('blvck:tts_gen_faithful');
    // Through the app's own setter rather than a guessed storage key — the
    // first attempt wrote 'blvck:tts_provider', which nothing reads, and the
    // run measured a Kokoro page with the panel hidden and no voices at all.
    if (window.BlvckAI && window.BlvckAI.setTtsProvider) window.BlvckAI.setTtsProvider('fishaudio');
    if (fish && window.ProviderManager) window.ProviderManager.setEndpoint('fishaudio', fish);
  }, envGet('FISH_API_URL'));
  // The voice list lives on the Voices view and is populated from the server.
  await page.goto(`http://localhost:${PORT}/#voice`, { waitUntil: 'load', timeout: 60000 });

  const ready = await page.evaluate(async () => {
    // There is no voice <select> — the picker is a modal, and the chosen voice
    // is shown on the card. What matters here is only that the app HAS settled
    // on a voice and that the panel is up, because "Preview selection" reads
    // currentVoice() and currentGenParams() and needs both.
    const named = () => {
      const el = document.getElementById('voice-card-name');
      const t = el ? el.textContent.trim() : '';
      return t && !/^[-—]?$/.test(t) ? t : '';
    };
    for (let i = 0; i < 40; i++) {
      const panel = document.getElementById('gen-params-panel');
      if (panel && !panel.hidden && named()) return { voice: named(), panel: true };
      await new Promise((r) => setTimeout(r, 500));
    }
    const panel = document.getElementById('gen-params-panel');
    return { voice: named(), panel: !!(panel && !panel.hidden),
             provider: window.BlvckAI ? window.BlvckAI.ttsProvider() : '?' };
  });
  console.log(`  ready: ${JSON.stringify(ready)}`);
  check('a voice is selected and the parameter panel is on screen',
        !!ready.voice && ready.panel === true, ready);
  if (!ready.voice || !ready.panel) {
    console.log('FAILED: without the panel and a voice there is nothing to measure.');
    await browser.close();
    process.exit(1);
  }

  // Capture what the app tries to send, and refuse it so nothing is generated.
  await page.evaluate(() => {
    window.__sent = [];
    const orig = window.fetch;
    window.fetch = function (...args) {
      const url = String(args[0] || '');
      if (url.includes('/v1/tts')) {
        let body = null;
        try { body = JSON.parse((args[1] && args[1].body) || '{}'); } catch (e) { body = null; }
        window.__sent.push(body);
        return Promise.resolve(new Response('{"captured":true}', { status: 503 }));
      }
      return orig.apply(this, args);
    };
  });

  // Speak through the app's own path, with whatever the panel currently holds.
  // The voice list is populated from the server, so the preview control does
  // not exist at load. Wait for it rather than measuring an empty page.
  const speak = async () => page.evaluate(async () => {
    window.__sent = [];
    // "Preview selection" is the shortest real path to a request: it reads the
    // highlighted script and calls speakAtPace with currentGenParams(), which
    // is precisely the value under test.
    const ta = document.getElementById('text-input');
    const btn = document.getElementById('btn-preview-selection');
    if (!ta || !btn) return { why: 'the script box or the preview control is missing' };
    ta.value = 'Testing one two three.';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    ta.focus();
    ta.setSelectionRange(0, ta.value.length);
    btn.click();
    for (let i = 0; i < 40 && !window.__sent.length; i++) {
      await new Promise((r) => setTimeout(r, 200));
    }
    if (!window.__sent.length) {
      const st = document.getElementById('status-message');
      return { why: 'no request was made' + (st ? ` — the app said: ${st.textContent.trim().slice(0, 120)}` : '') };
    }
    return window.__sent;
  });

  const settings = async () => page.evaluate(() => ({
    faithful: document.getElementById('gen-faithful')
      ? document.getElementById('gen-faithful').checked : null,
    stored: localStorage.getItem('blvck:tts_gen_faithful'),
    temperature: document.getElementById('gen-temperature')
      ? document.getElementById('gen-temperature').value : null,
    style: document.getElementById('narration-style-select')
      ? document.getElementById('narration-style-select').value : null
  }));

  const keysOf = (sent) => {
    if (!Array.isArray(sent)) return null;          // {why: ...}
    const b = sent.find((x) => x && typeof x === 'object');
    return b ? STEER.filter((k) => b[k] !== undefined) : null;
  };
  const bodyOf = (sent) => (Array.isArray(sent) ? sent[0] : null) || null;

  // ── 1. Straight out of the box ──────────────────────────────────────────
  console.log('=== an untouched panel ===');
  const s0 = await settings();
  console.log(`  "Leave the voice alone" is ${s0.faithful ? 'ON' : 'OFF'} (stored: ${s0.stored})`);
  check('it is on by default, with nothing stored to make it so',
        s0.faithful === true && s0.stored === null, s0);

  const sent0 = await speak();
  const k0 = keysOf(sent0);
  console.log(`  the request carried: ${k0 === null ? '(no request captured)' : (k0.length ? k0.join(', ') : 'none of the steering parameters')}`);
  if (!Array.isArray(sent0)) console.log(`  ${sent0.why}`);
  check('a request was actually made and captured', k0 !== null, sent0);
  if (k0 !== null) {
    check('NOTHING THAT STEERS THE VOICE IS SENT', k0.length === 0, { sent: bodyOf(sent0) });
  }

  // ── 2. Choosing a narration style ───────────────────────────────────────
  console.log('\n=== after choosing a narration style ===');
  const styled = await page.evaluate(() => {
    const sel = document.getElementById('narration-style-select');
    if (!sel) return { why: 'no style select' };
    const had = [...sel.options].map((o) => o.value);
    const pick = had.includes('storytelling') ? 'storytelling' : had[had.length - 1];
    sel.value = pick;
    sel.dispatchEvent(new Event('change', { bubbles: true }));
    return { pick, temperature: document.getElementById('gen-temperature').value };
  });
  console.log(`  picked "${styled.pick}" · the temperature slider now reads ${styled.temperature}`);
  const sent1 = await speak();
  const k1 = keysOf(sent1);
  console.log(`  the request carried: ${k1 === null ? '(none captured)' : (k1.length ? k1.join(', ') : 'none of the steering parameters')}`);
  check('CHOOSING A SCRIPT STYLE DOES NOT QUIETLY STEER THE ENGINE',
        k1 !== null && k1.length === 0, { sent: bodyOf(sent1), slider: styled.temperature });
  const s1 = await settings();
  check('and it did not turn the setting off behind your back', s1.faithful === true, s1);

  // ── 3. Moving a control is the opt-in ───────────────────────────────────
  console.log('\n=== after moving the expressiveness slider ===');
  await page.evaluate(() => {
    const el = document.getElementById('gen-temperature');
    el.value = '0.35';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  const s2 = await settings();
  console.log(`  "Leave the voice alone" is now ${s2.faithful ? 'ON' : 'OFF'}`);
  check('touching a control turns the protection off', s2.faithful === false, s2);

  const sent2 = await speak();
  const k2 = keysOf(sent2);
  console.log(`  the request carried: ${k2 === null ? '(none captured)' : k2.join(', ')}`);
  check('AND NOW THE PARAMETERS ARE ACTUALLY SENT',
        k2 !== null && STEER.every((k) => k2.includes(k)), { sent: bodyOf(sent2) });
  check('with the value that was set, not a default',
        k2 !== null && Math.abs(Number((bodyOf(sent2) || {}).temperature) - 0.35) < 0.001,
        bodyOf(sent2));

  // ── 4. And back ─────────────────────────────────────────────────────────
  console.log('\n=== ticking it back on ===');
  await page.evaluate(() => {
    const box = document.getElementById('gen-faithful');
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true }));
  });
  const sent3 = await speak();
  const k3 = keysOf(sent3);
  console.log(`  the request carried: ${k3 === null ? '(none captured)' : (k3.length ? k3.join(', ') : 'none of the steering parameters')}`);
  check('the voice is left alone again, and the slider value is not sent',
        k3 !== null && k3.length === 0, { sent: bodyOf(sent3) });

  // ── 5. It survives a reload ─────────────────────────────────────────────
  console.log('\n=== after a reload ===');
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  const s4 = await settings();
  console.log(`  "Leave the voice alone" is ${s4.faithful ? 'ON' : 'OFF'} · slider reads ${s4.temperature}`);
  check('the choice persists', s4.faithful === true, s4);

  fs.writeFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(),
    untouched: { settings: s0, sentKeys: k0, body: bodyOf(sent0) },
    afterStyle: { pick: styled.pick, slider: styled.temperature, sentKeys: k1 },
    afterSlider: { settings: s2, sentKeys: k2, body: bodyOf(sent2) },
    backOn: { sentKeys: k3 },
    afterReload: s4
  }, null, 2));

  console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' · ') : 'All checks passed.'}`);
  console.log(`Written to ${OUT}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
