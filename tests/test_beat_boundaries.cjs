// A beat must not begin halfway through a sentence.
//
// The failure this pins, from a live project:
//
//   scene 1 (13s): "A database of hundreds of downloadable scripts,.. movie
//                   scripts,.. screenplays,.. and transcripts of current,..
//                   classic and maybe a few soon-to-be-released movies,..
//                   television,.. anime,.."
//   scene 2  (2s): "unproduced and radio shows."
//
// mergeCuesToBeats cut on elapsed seconds alone, so the sentence broke and its
// tail became a beat with no subject in it. The Director cannot picture
// "unproduced and radio shows", so it reached for the topic of the passage and
// repeated the previous shot — which is what the duplicated visual intent
// actually was. The prompt was a second cause, not the only one.
const fs = require('fs');
const ROOT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const src = fs.readFileSync(ROOT + '/public/storyboard.js', 'utf8');

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

// Pull the real regex out of the file rather than restating it here, so this
// tests the shipped rule and not a copy that can drift from it.
const line = src.split('\n').find((l) => l.includes('endsSentence ='));
check('the merger has a sentence-boundary rule', !!line);
if (!line) { console.log('\nFAILED'); process.exit(1); }
const endsSentence = new RegExp(line.match(/\/(.+)\/\.test/)[1]);

console.log('\n--- what counts as the end of a sentence ---');
const cases = [
  ['radio shows.', true, 'a full stop after a word'],
  ['What now?', true, 'a question'],
  ['Yes!', true, 'an exclamation'],
  ['he said."', true, 'a stop inside a closing quote'],
  ['(done.)', true, 'a stop inside brackets'],
  ['anime,..', false, "Fish's pause marker, not a sentence"],
  ['television,..', false, "the exact text that split the live beat"],
  ['a list,', false, 'a comma'],
  ['mid sentence', false, 'no punctuation at all']
];
for (const [text, want, why] of cases) {
  check(`${JSON.stringify(text)} — ${why}`, endsSentence.test(text.trim()) === want,
        { got: endsSentence.test(text.trim()), want });
}

console.log('');
console.log('--- the rule is applied, and bounded ---');
check('a beat only closes on a sentence end',
      src.indexOf('(overBySec || overByWords) && (endsSentence || wayOver)') >= 0);

// The cap used to be asserted by matching its exact expression. That broke
// the moment the expression changed for an unrelated reason, and it never
// showed the cap WORKED - only that a particular string was present. Replay a
// track with no terminal punctuation anywhere through the shipped merger
// instead: without a working cap it can never close a beat, and returns one.
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
const merge = eval('(() => { ' + lift('tsToSeconds') + lift('mergeCuesToBeats')
                 + ' return mergeCuesToBeats; })()');
const pad = (n) => String(n).padStart(2, '0');
const stamp = (a, b) => '00:' + pad(Math.floor(a / 60)) + ':' + pad(a % 60)
                     + ' - 00:' + pad(Math.floor(b / 60)) + ':' + pad(b % 60);
const noStops = [];
for (let i = 0; i < 14; i++) {
  noStops.push({ timestamp: stamp(i * 5, i * 5 + 5),
                 text: 'and then another thing happened after that one' });
}
const capped = merge(noStops, 4);
console.log('  a 70s track with no full stop anywhere -> ' + capped.length + ' beat(s)');
check('a track with no punctuation still produces beats', capped.length > 1,
      { beats: capped.length });
check('and the cap is generous enough not to cut real sentences',
      src.indexOf('Math.max(minShotSec * 4, 18)') >= 0,
      'a mid-sentence cut is the failure the sentence rule exists to prevent');

console.log('\n--- the live case, replayed ---');
// The real cues, as Fish emits them.
const CUES = [
  'A database of hundreds of downloadable scripts,..',
  'movie scripts,.. screenplays,.. and transcripts of current,..',
  'classic and maybe a few soon-to-be-released movies,.. television,.. anime,..',
  'unproduced and radio shows.'
];
// Walk them the way the merger does: accumulate, and only close on a sentence.
let cur = '';
const beats = [];
for (const cue of CUES) {
  cur = cur ? cur + ' ' + cue : cue;
  const over = cur.split(/\s+/).length >= 12;      // stands in for the budget
  if (over && endsSentence.test(cur.trim())) { beats.push(cur); cur = ''; }
}
if (cur) beats.push(cur);

console.log(`  ${beats.length} beat(s):`);
for (const b of beats) console.log(`    ${JSON.stringify(b.slice(0, 64))}…`);
check('the sentence is no longer split across beats', beats.length === 1, { beats: beats.length });
check('no beat starts mid-sentence',
      beats.every((b) => /^[A-Z"'(]/.test(b.trim())), beats.map((b) => b.slice(0, 20)));

console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                 : 'BEATS BREAK ON SENTENCES'));
process.exit(fails.length ? 1 : 0);
