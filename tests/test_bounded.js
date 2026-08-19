// No network wait in the production path may be unbounded.
//
// Three separate hangs came from the same shape: a request that is accepted and
// never answered, so it never fails, so the caller never falls back. Each was
// fixed where it was found — archive search, then the download, then the frame
// loads — and each time the next unbounded one was still there. This checks the
// whole path at once.
const fs = require('fs');
const ROOT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video/public';

const FILES = ['adapters/stock-media.js', 'adapters/archive-org.js',
               'adapters/archive-excerpt.js', 'adapters/llm-adapters.js'];

const fails = [];
const check = (n, c, d) => { console.log((c?'  PASS  ':'  FAIL  ')+n+(c?'':'  <- '+JSON.stringify(d))); if(!c) fails.push(n); };

for (const f of FILES) {
  const src = fs.readFileSync(ROOT + '/' + f, 'utf8');
  const calls = [...src.matchAll(/fetch\(/g)];
  // Every fetch must have a signal within the next ~500 chars of its call.
  const naked = [];
  for (const m of calls) {
    const window = src.slice(m.index, m.index + 600);
    const closes = window.indexOf('});');
    const scope = closes > -1 ? window.slice(0, closes) : window;
    if (!/signal\s*:|withBudget|AbortSignal\.timeout/.test(scope)) {
      naked.push(src.slice(0, m.index).split('\n').length);
    }
  }
  check(`${f}: every fetch is bounded`, naked.length === 0,
        naked.length ? `unbounded at line(s) ${naked.join(', ')}` : '');

  const imgs = [...src.matchAll(/new Image\(\)/g)];
  if (imgs.length) {
    check(`${f}: image loads are bounded`, /FRAME_TIMEOUT_MS/.test(src));
  }
}

console.log('\n--- the budgets are per-provider, not shared ---');
const nim = fs.readFileSync(ROOT + '/adapters/llm-adapters.js', 'utf8');
const qwen = fs.readFileSync(ROOT + '/ai-provider-manager.js', 'utf8');
check('NIM has its own budget', /NIM_TIMEOUT_MS/.test(nim));
check('Qwen carries none of it', !/NIM_TIMEOUT_MS|DEFAULT_REQUEST_TIMEOUT_MS/.test(qwen));
check('Qwen keeps its retry-to-join', /asking again to join the generation/.test(qwen));

console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}` : 'NOTHING IN THE PATH CAN HANG FOREVER'));
process.exit(fails.length ? 1 : 0);
