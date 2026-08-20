// The Fish test button must distinguish "can speak" from "can measure".
//
// Fish does two jobs. If it cannot speak, the Voice stage fails loudly. If it
// can speak but has no /v1/align, nothing fails at all — the storyboard quietly
// plans against estimated timing and every cut lands slightly off the voice.
// A button that reported one green tick for both would hide exactly the failure
// it was added to catch, so each case below checks what the user is actually
// told, not merely that something was said.
//
// fetch is stubbed: the subject is the button's reasoning about answers, and a
// real ngrok URL cannot produce a 404, a warning page and a timeout on demand.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

// Each case: how the stubbed server answers, and what the user must be told.
const CASES = [
  { name: 'speech and alignment',
    endpoint: 'https://fish.example.dev',
    reply: { status: 200, json: { alignment: true, voices: ['Adam', 'Bella'] } },
    must: [/live/i, /alignment/i, /follow the measured/i],
    mustNot: [/estimated/i] },

  { name: 'speech but no alignment',
    endpoint: 'https://fish.example.dev',
    reply: { status: 200, json: { alignment: false, voices: ['Adam'] } },
    must: [/no forced alignment/i, /estimated/i, /v1\/align/i],
    mustNot: [/^Live — /] },

  { name: 'reached something that is not Fish',
    endpoint: 'https://fish.example.dev',
    reply: { status: 404, json: null, body: 'Not Found' },
    must: [/not an AETHER Fish server/i],
    mustNot: [/live/i] },

  { name: 'an ngrok warning page instead of the server',
    endpoint: 'https://fish.example.dev',
    reply: { status: 200, json: null, body: '<html>You are about to visit…</html>' },
    must: [/not JSON/i, /ngrok/i],
    mustNot: [/live/i, /alignment/i] },

  { name: 'the notebook is asleep',
    endpoint: 'https://fish.example.dev',
    reply: { timeout: true },
    must: [/could not reach/i, /20s|asleep|stale/i],
    mustNot: [/live/i] },

  { name: 'server is up but erroring',
    endpoint: 'https://fish.example.dev',
    reply: { status: 502, json: null, body: 'bad gateway' },
    must: [/HTTP 502/, /notebook/i],
    mustNot: [/live/i] },

  { name: 'nothing typed in',
    endpoint: '',
    reply: null,
    must: [/add an endpoint first/i],
    mustNot: [/live/i] },

  { name: 'a bare hostname with no scheme',
    endpoint: 'fish.example.dev',
    reply: null,
    must: [/does not look like a URL/i],
    mustNot: [/live/i] }
];

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null,
    protocolTimeout: 300000,
    args: ['--window-size=1400,950']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 120)); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  // The button and its result line must exist at all, before anything else.
  const present = await page.evaluate(() => ({
    button: !!document.getElementById('btn-test-fish'),
    result: !!document.getElementById('fish-test-result'),
    field: !!document.getElementById('set-fishaudio-endpoint')
  }));
  check('the Fish fieldset has a test button', present.button && present.result && present.field, present);
  if (!present.button) {
    console.log('\nFAILED: no button to test');
    await browser.close();
    process.exit(1);
  }

  for (const c of CASES) {
    const said = await page.evaluate(async (cs) => {
      // Intercept only the status call; everything else on the page is left
      // alone so the app keeps working around the test.
      const real = window.fetch;
      window.fetch = async (url, opts) => {
        if (String(url).indexOf('/api/proxy/fish/aether/status') >= 0) {
          window.__sentEndpoint = (opts && opts.headers && opts.headers['x-fish-endpoint']) || '';
          if (!cs.reply) throw new Error('the button should not have called the server');
          if (cs.reply.timeout) {
            const e = new Error('timed out');
            e.name = 'TimeoutError';
            throw e;
          }
          const text = cs.reply.json ? JSON.stringify(cs.reply.json) : (cs.reply.body || '');
          return { ok: cs.reply.status >= 200 && cs.reply.status < 300,
                   status: cs.reply.status,
                   text: async () => text };
        }
        return real(url, opts);
      };
      window.__sentEndpoint = null;

      document.getElementById('set-fishaudio-endpoint').value = cs.endpoint;
      document.getElementById('btn-test-fish').click();

      const line = document.getElementById('fish-test-result');
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, 100));
        const t = (line.textContent || '').trim();
        if (t && t !== 'Checking…') break;
      }
      window.fetch = real;
      return { text: (line.textContent || '').trim(),
               sentEndpoint: window.__sentEndpoint,
               reEnabled: !document.getElementById('btn-test-fish').disabled };
    }, c);

    console.log(`\n  ${c.name}:`);
    console.log(`    "${said.text}"`);
    for (const re of c.must) {
      check(`${c.name} — says ${re}`, re.test(said.text), said.text);
    }
    for (const re of c.mustNot) {
      check(`${c.name} — does not claim ${re}`, !re.test(said.text), said.text);
    }
    check(`${c.name} — the button is usable again`, said.reEnabled, said);
  }

  // The trailing slash must not survive into the header, or the proxy builds a
  // double-slashed path against the worker.
  const trimmed = await page.evaluate(async () => {
    const real = window.fetch;
    window.fetch = async (url, opts) => {
      if (String(url).indexOf('/api/proxy/fish/aether/status') >= 0) {
        window.__sentEndpoint = opts.headers['x-fish-endpoint'];
        return { ok: true, status: 200, text: async () => JSON.stringify({ alignment: true }) };
      }
      return real(url, opts);
    };
    document.getElementById('set-fishaudio-endpoint').value = 'https://fish.example.dev///';
    document.getElementById('btn-test-fish').click();
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 100));
      if (window.__sentEndpoint) break;
    }
    window.fetch = real;
    return window.__sentEndpoint;
  });
  console.log(`\n  trailing slashes: sent "${trimmed}"`);
  check('a trailing slash is trimmed before the endpoint is used',
        trimmed === 'https://fish.example.dev', trimmed);

  check('nothing threw throughout', pageErrors.length === 0, pageErrors.slice(0, 4));

  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'THE FISH TEST TELLS THE TRUTH ABOUT BOTH JOBS'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
