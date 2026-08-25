// A failure has to be able to say what it was.
//
// A response body can be read once. The adapter's key-rotation path read it to
// build the "this key is rate limited" message, and then — when there was no
// second key to rotate to — the error path read the same body AGAIN to build
// the exception. What the caller received was:
//
//   Failed to execute 'text' on 'Response': body stream already read
//
// Rate limits are the most common failure this endpoint has: NIM's workers are
// shared and answer "ResourceExhausted: Worker local total request limit
// reached (17/16)" the moment they are full. Every one of those arrived at the
// caller wearing that disguise, which is why a Composer call died mid-run with
// a message about streams. A pipeline that retries transient failures cannot
// recognise one it is never told about.
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
    defaultViewport: null, protocolTimeout: 120000,
    args: ['--window-size=1100,800']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  const run = async (keys, status, body) => {
    await page.evaluate((k) => localStorage.setItem('blvck:keys_nim', JSON.stringify(k)), keys);
    await page.reload({ waitUntil: 'load', timeout: 60000 });
    return page.evaluate(async (st, bd) => {
      const realFetch = window.fetch.bind(window);
      let calls = 0;
      window.fetch = async (input, init) => {
        const url = typeof input === 'string' ? input : (input && input.url) || '';
        if (/nvidia/.test(url)) {
          calls++;
          return new Response(bd, { status: st, headers: { 'Content-Type': 'application/json' } });
        }
        return realFetch(input, init);
      };
      let why = '';
      try {
        await window.LLMAdapters.nvidiaNimChat({
          model: 'meta/llama-3.3-70b-instruct',
          messages: [{ role: 'user', content: 'hello' }], max_tokens: 10
        });
      } catch (e) { why = e.message; }
      window.fetch = realFetch;
      return { why, calls };
    }, status, body);
  };

  const EXHAUSTED = '{"error":{"message":"ResourceExhausted: Worker local total '
                  + 'request limit reached (17/16)","code":429}}';

  console.log('=== a rate limit, with no second key to rotate to ===');
  const one = await run(['only-key'], 429, EXHAUSTED);
  console.log(`  ${one.why}`);
  check('THE CALLER IS TOLD IT WAS A RATE LIMIT',
        /429/.test(one.why) && /ResourceExhausted/.test(one.why), one);
  check('and not that something went wrong with a stream',
        !/body stream|already read/i.test(one.why), one);
  check('the request was made once', one.calls === 1, one);

  console.log('\n=== the same, with a spare key ===');
  const two = await run(['first-key', 'second-key'], 429, EXHAUSTED);
  console.log(`  ${two.why} (after ${two.calls} attempt(s))`);
  check('a second key is genuinely tried', two.calls === 2, two);
  check('and the failure still says what it was',
        /429/.test(two.why) && !/body stream/i.test(two.why), two);

  console.log('\n=== an ordinary server error ===');
  const three = await run(['only-key'], 500, '{"error":"internal"}');
  console.log(`  ${three.why}`);
  check('a 500 reports itself too',
        /500/.test(three.why) && /internal/.test(three.why), three);

  console.log('\n=== and a transient failure is recognisable as one ===');
  // The planner only retries what reads as transient. If the message it gets
  // is about streams, the retry never fires — which is the whole cost of this
  // bug, and the reason it belongs in a test rather than a changelog.
  const seen = await page.evaluate((msg) => {
    const T = /\b(429|503|500|502|504)\b|ResourceExhausted|rate.?limit|did not answer in|timed? ?out|temporarily/i;
    return T.test(msg);
  }, one.why);
  check('the planner’s retry would fire on it', seen === true, one.why);

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'A FAILURE SAYS WHAT IT WAS'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
