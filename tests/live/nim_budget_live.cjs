// NIM must be given room for the answer, and must say when it ran out.
//
// The reported failure was "Failed parsing JSON from NIM output." — which reads
// like the model wrote nonsense. It had not. chat() defaults to 1024 tokens and
// nothing scaled that to the work, so a ten-beat storyboard batch was cut off
// mid-object and arrived with no closing brace. The Qwen path has scaled its
// budget to the beat count all along.
//
// So the first assertion is about the REQUEST, not the reply: how many tokens
// were actually asked for. The rest are about telling three different failures
// apart, because they need different fixes — and about carrying the raw output,
// which the error never did, leaving the raw-response button with nothing.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

// Reply with whatever this case needs, and record what was asked for.
const STUB = () => {
  const real = window.fetch;
  window.__asked = null;
  window.fetch = async (url, opts) => {
    if (String(url).indexOf('/api/proxy/nvidia') >= 0) {
      window.__asked = JSON.parse(opts.body);
      const r = window.__reply;
      return {
        ok: true, status: 200,
        json: async () => ({
          choices: [{ message: { content: r.content }, finish_reason: r.finish }],
          usage: r.usage || null
        })
      };
    }
    return real(url, opts);
  };
};

const cues = (n) => Array.from({ length: n }, (_, i) => ({
  index: i + 1, timestamp: '00:00:00 - 00:00:05', text: 'A sentence of narration number ' + (i + 1) + '.'
}));

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 180000,
    args: ['--window-size=1400,950']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 120)); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate(() => {
    localStorage.setItem('blvck:director_provider', 'nim');
    localStorage.setItem('blvck:keys_nim', JSON.stringify(['nvapi-test']));
  });
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  const run = (batch, reply) => page.evaluate(async (stub, cueList, r) => {
    eval('(' + stub + ')()');
    window.__reply = r;
    let out = null, threw = null, raw = null, category = null;
    try {
      out = await window.AIManager.nim.generateJSON('/api/storyboard/scenes', { cues: cueList }, {});
    } catch (e) { threw = e.message; raw = e.raw; category = e.category; }
    return { asked: window.__asked, out, threw, raw, category };
  }, STUB.toString(), batch, reply);

  // ── The budget scales with the work ───────────────────────────────────────
  console.log('\n=== how many tokens are asked for ===');
  const one = await run(cues(1), { content: '{"scenes":[]}', finish: 'stop' });
  const ten = await run(cues(10), { content: '{"scenes":[]}', finish: 'stop' });
  console.log(`  1 cue  → max_tokens ${one.asked.max_tokens}`);
  console.log(`  10 cues → max_tokens ${ten.asked.max_tokens}`);
  check('a ten-beat batch is no longer capped at 1024', ten.asked.max_tokens > 1024, ten.asked.max_tokens);
  check('the budget grows with the batch', ten.asked.max_tokens > one.asked.max_tokens,
        { one: one.asked.max_tokens, ten: ten.asked.max_tokens });
  check('and matches what the Qwen path allows for the same work',
        ten.asked.max_tokens === Math.min(16384, 1200 + 10 * 320), ten.asked.max_tokens);
  check('a good reply still parses', !!one.out && !one.threw, one);

  // ── Truncation is named as truncation ────────────────────────────────────
  console.log('\n=== cut off mid-answer ===');
  const cut = await run(cues(10), {
    content: '{"scenes":[{"index":1,"camera":"Wide","sceneSummary":"A databa',
    finish: 'length',
    usage: { completion_tokens: 4400 }
  });
  console.log(`  "${cut.threw}"`);
  check('it says it ran out of room', /ran out of room|cut off/i.test(cut.threw || ''), cut.threw);
  check('and does not blame the JSON', !/not JSON/i.test(cut.threw || ''), cut.threw);
  check('it reports the budget it was given', /\d{4,}/.test(cut.threw || ''), cut.threw);
  check('the raw output travels with the error', (cut.raw || '').indexOf('"scenes"') >= 0, cut.raw);
  check('and it is categorised', cut.category === 'nim-output', cut.category);

  // ── An empty reply is not "bad JSON" either ──────────────────────────────
  console.log('\n=== nothing came back ===');
  const empty = await run(cues(4), { content: '', finish: 'stop' });
  console.log(`  "${empty.threw}"`);
  check('an empty reply says so', /empty/i.test(empty.threw || ''), empty.threw);
  check('and is not reported as truncation', !/ran out of room/i.test(empty.threw || ''), empty.threw);

  // ── Genuine nonsense keeps the old meaning ───────────────────────────────
  console.log('\n=== genuinely not JSON ===');
  const junk = await run(cues(4), { content: 'I am afraid I cannot help with that.', finish: 'stop' });
  console.log(`  "${junk.threw}"`);
  check('nonsense is still called nonsense', /not JSON/i.test(junk.threw || ''), junk.threw);
  check('and the reply is kept for inspection',
        (junk.raw || '').indexOf('cannot help') >= 0, junk.raw);

  check('nothing threw unexpectedly', pageErrors.length === 0, pageErrors.slice(0, 3));

  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'NIM GETS ROOM FOR THE ANSWER, AND SAYS WHEN IT RUNS OUT'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
