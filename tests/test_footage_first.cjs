// A documentary channel picks footage before it picks a drawing.
//
// Live, a beat reading "unproduced and radio shows" came back as a stickman —
// a drawn figure in a serious factual video. The Director was following its own
// instructions: stock_video sat at position 6 of 8, below stickman at 3, under
// a rationale arguing that drawings were cheaper because "a generated shot
// costs minutes of GPU". That was true in the diffusion era and stopped being
// true when generation was replaced by a stock search that answers in a second.
//
// Both prompts are checked, because the Director runs on Qwen (prompts.py) or
// NIM (prompts.js) and the two must not disagree about what a beat should be.
const fs = require('fs');
const ROOT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';

const SOURCES = [
  ['prompts.js', fs.readFileSync(ROOT + '/public/prompts.js', 'utf8')],
  ['prompts.py', fs.readFileSync(ROOT + '/kaggle_director/director/prompts.py', 'utf8')]
];

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

/** Which position a visual type holds in the numbered priority list. */
function rank(src, type) {
  for (let n = 1; n <= 8; n++) {
    if (src.indexOf(n + '. ' + type) > -1) return n;
  }
  return null;
}

for (const [name, src] of SOURCES) {
  console.log(`--- ${name} ---`);
  const stock = rank(src, 'stock_video');
  const stick = rank(src, 'stickman');

  check(`${name}: footage is the first choice`, stock === 1, { stock });
  check(`${name}: stickman is a last resort`, stick !== null && stick >= 7, { stick });
  check(`${name}: footage outranks drawing`,
        stock !== null && stick !== null && stock < stick, { stock, stick });
  check(`${name}: the obsolete GPU-cost argument is gone`,
        src.indexOf('costs minutes of GPU') === -1 && src.indexOf('generated shot costs') === -1);
  check(`${name}: it says plainly what counts as footage`,
        src.indexOf('picture it happening somewhere') > -1
        || src.indexOf('picture the beat happening somewhere') > -1);
}

console.log('\n--- the vocabulary is unchanged; only the order moved ---');
const js = SOURCES[0][1];
const missing = ['stock_video', 'stock_photo', 'stock_text', 'editorial_text', 'chart',
                 'map', 'timeline', 'diagram', 'whiteboard', 'stickman', 'presenter', 't2v']
  .filter((t) => js.indexOf(t) === -1);
check('every visual type still exists', missing.length === 0, { missing });

console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                 : 'FOOTAGE-FIRST ORDERING PASSES'));
process.exit(fails.length ? 1 : 0);
