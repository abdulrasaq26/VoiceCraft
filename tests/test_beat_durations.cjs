// A scene lasts as long as its narration does — not as long as a setting says.
//
// The failure this pins: Pacing was a TARGET length (Balanced = 15s), and the
// merger could not close a beat before reaching it. So every scene came out at
// roughly the pacing value whatever was being said, and sentences were glued
// together to get there. The cue timings were read only to decide when the
// floor had been crossed, never to place the cut.
//
// Pacing is now a FLOOR — the shortest shot worth cutting to. A beat closes at
// the first sentence end after it, so its length is whatever that sentence
// actually took.
//
// This runs the SHIPPED functions, lifted out of storyboard.js by brace
// matching rather than restated here, so the test cannot drift from the code
// it is describing.
const fs = require('fs');
const ROOT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const src = fs.readFileSync(ROOT + '/public/storyboard.js', 'utf8');

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

/** Lift one function out of the source by matching its braces. */
function lift(name) {
  const at = src.indexOf('function ' + name);
  if (at < 0) throw new Error('cannot find function ' + name);
  let depth = 0;
  let started = false;
  for (let i = at; i < src.length; i++) {
    if (src[i] === '{') { depth++; started = true; }
    else if (src[i] === '}') {
      depth--;
      if (started && depth === 0) return src.slice(at, i + 1);
    }
  }
  throw new Error('unbalanced braces in ' + name);
}

// eslint-disable-next-line no-eval
const mergeCuesToBeats = eval(`(() => { ${lift('tsToSeconds')} ${lift('mergeCuesToBeats')} return mergeCuesToBeats; })()`);

const ts = (a, b) => {
  const fmt = (n) => `${String(Math.floor(n / 3600)).padStart(2, '0')}:`
                   + `${String(Math.floor((n % 3600) / 60)).padStart(2, '0')}:`
                   + `${String(n % 60).padStart(2, '0')}`;
  return `${fmt(a)} - ${fmt(b)}`;
};
const span = (beat) => {
  const [a, b] = beat.timestamp.split(/\s*-\s*/);
  const sec = (t) => { const m = t.match(/(\d+):(\d+):(\d+)/); return +m[1] * 3600 + +m[2] * 60 + +m[3]; };
  return sec(b) - sec(a);
};

// A realistic track: two cues per sentence, sentences of deliberately different
// lengths, and one sentence too short to hold a shot on its own.
const CUES = [
  { timestamp: ts(0, 3),   text: 'A single database now holds several hundred movie scripts,' },
  { timestamp: ts(3, 6),   text: 'stored as plain text anyone can open.' },              // sentence A: 6s
  { timestamp: ts(6, 12),  text: 'Researchers sit for hours at library terminals and personal laptops,' },
  { timestamp: ts(12, 17), text: 'hunting for material that once required a written request.' }, // B: 11s
  { timestamp: ts(17, 20), text: 'The collection also preserves thousands of recordings' },
  { timestamp: ts(20, 22), text: 'of unproduced radio shows.' },                          // C: 5s
  { timestamp: ts(22, 24), text: 'Nobody aired them.' },                                  // D: 2s — too short
  { timestamp: ts(24, 28), text: 'Some of those reels had not been played in fifty years,' },
  { timestamp: ts(28, 31), text: 'sitting in sealed metal canisters.' }                   // E: 7s
];

const MIN_SHOT = 4;   // Balanced
const beats = mergeCuesToBeats(CUES, MIN_SHOT);

console.log(`\n--- what the narration produced at a ${MIN_SHOT}s floor ---`);
for (const b of beats) {
  console.log(`  beat ${b.index}  ${String(span(b)).padStart(2)}s  ${JSON.stringify(b.text.slice(0, 58))}…`);
}

console.log('\n--- the durations follow the sentences ---');
// A=6s, B=11s, C=5s, then the 2s sentence rides with the 7s one = 9s.
const EXPECTED = [6, 11, 5, 9];
check('one beat per sentence, short ones absorbed', beats.length === EXPECTED.length,
      { got: beats.length, want: EXPECTED.length, spans: beats.map(span) });
if (beats.length === EXPECTED.length) {
  beats.forEach((b, i) => {
    check(`beat ${i + 1} lasts as long as its narration (${EXPECTED[i]}s)`, span(b) === EXPECTED[i],
          { got: span(b), want: EXPECTED[i] });
  });
}

console.log('\n--- and are not all the same length ---');
const spans = beats.map(span);
check('the cuts are not on a fixed cadence', new Set(spans).size > 1, spans);
check('no beat is padded out to the old 15s target', spans.every((s) => s !== 15), spans);
check('nothing is shorter than the floor', spans.every((s) => s >= MIN_SHOT), spans);

console.log('\n--- no beat starts mid-sentence ---');
check('every beat opens on a capital', beats.every((b) => /^[A-Z"'(]/.test(b.text.trim())),
      beats.map((b) => b.text.slice(0, 18)));

console.log('\n--- the floor is a floor, not a target ---');
// The same narration at a denser setting must cut MORE, and at a sparser one
// must cut less. A target would pin every beat near its own value instead.
const dense = mergeCuesToBeats(CUES, 2.5).map(span);
const sparse = mergeCuesToBeats(CUES, 7).map(span);
console.log(`  dense(2.5s): ${JSON.stringify(dense)}`);
console.log(`  sparse(7s):  ${JSON.stringify(sparse)}`);
check('a denser setting gives at least as many cuts', dense.length >= spans.length, { dense, balanced: spans });
check('a sparser setting gives fewer', sparse.length < dense.length, { sparse, dense });
check('even at 7s the beats are not all 7s', new Set(sparse).size > 1, sparse);

console.log('');
console.log('--- what the old setting did to the same narration ---');
// 15 was the old Balanced value, used as a target. Running the SHIPPED merger
// at that number reproduces the reported symptom directly: the sentences are
// glued together because no beat may close before reaching 15s, so the scene
// length comes from the setting rather than from the narration.
const asTarget = mergeCuesToBeats(CUES, 15).map(span);
console.log(`  at the old 15s value: ${JSON.stringify(asTarget)} - ${asTarget.length} beat(s)`);
check('the old value collapsed the narration into far fewer scenes',
      asTarget.length < spans.length, { old: asTarget, now: spans });
check('and the current default does not', spans.length >= 4, spans);

console.log('\n--- the shipped control matches the code ---');
const html = fs.readFileSync(ROOT + '/public/index.html', 'utf8');
const opts = [...html.matchAll(/<option value="([\d.]+)"[^>]*>\s*(Sparse|Balanced|Dense)/g)]
  .map((m) => Number(m[1]));
check('the pacing options are floors, not the old scene targets',
      opts.length === 3 && opts.every((v) => v <= 10), opts);
check('the default the code falls back to is one of the options',
      opts.includes(4) && /Number\(densityEl\.value\) : 4/.test(src), opts);

console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                 : 'SCENE LENGTH FOLLOWS THE NARRATION'));
process.exit(fails.length ? 1 : 0);
