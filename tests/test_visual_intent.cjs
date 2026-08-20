// The two Directors must be told the same thing.
//
// Qwen and NIM read different files — public/prompts.js and
// kaggle_director/director/{prompts,schema}.py — and a rule added to one of
// them silently means the storyboard behaves differently depending on which
// brain happened to answer. That is worse than the rule being absent from
// both, because it is invisible: the same project produces different work on
// different days and nothing reports why.
//
// The rule here is the one that put livestock under a beat about a stage show:
// a shot description naming a branded act describes footage that does not
// exist in any CC0 library, so the search returns whatever it likes.
const fs = require('fs');
const ROOT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

const nim   = fs.readFileSync(ROOT + '/public/prompts.js', 'utf8');
const qwenP = fs.readFileSync(ROOT + '/kaggle_director/director/prompts.py', 'utf8');
const qwenS = fs.readFileSync(ROOT + '/kaggle_director/director/schema.py', 'utf8');
const qwen  = qwenP + qwenS;
const stock = fs.readFileSync(ROOT + '/public/adapters/stock-media.js', 'utf8');

// Qwen's prompt is assembled from adjacent string fragments, so the SOURCE
// reads   "...do not contain named "  "people, branded acts..."   while the
// prompt the model receives reads "...named people, branded acts...". An
// earlier version of this test compared raw source and reported three rules
// missing from Qwen that were present and correct - it was measuring Python
// string syntax, not the prompt. Join the fragments first, the way Python
// does, then compare on meaning: whitespace and wrapping differ between a JS
// template literal and concatenated Python strings, and neither is the point.
const join = (s) => s.replace(/"\s*"/g, '');
const flat = (s) => join(s).replace(/\s+/g, ' ').toLowerCase();
const NIM = flat(nim);
const QWEN = flat(qwen);

console.log('--- both Directors are told the shot must be findable ---');
const RULES = [
  ['the shot must be filmable by anyone', 'it must be a shot anyone could film'],
  ['the libraries do not hold branded subjects', 'they do not contain named people, branded acts'],
  ['naming one describes footage that does not exist', 'describes footage that does not exist'],
  ['and what to do instead', 'shoot the closest honest thing']
];
for (const [what, phrase] of RULES) {
  const p = flat(phrase);
  check(`NIM  — ${what}`, NIM.indexOf(p) >= 0, phrase);
  check(`Qwen — ${what}`, QWEN.indexOf(p) >= 0, phrase);
}

console.log('\n--- both get the same worked example ---');
// The example matters more than the rule: a model given an abstract
// prohibition and no demonstration reliably violates it.
check('NIM  shows the broken arena concept', NIM.indexOf(flat('the blue man group performs on stage')) >= 0);
check('Qwen shows the broken arena concept', QWEN.indexOf(flat('the blue man group performs on stage')) >= 0);
check('NIM  shows what to write instead', NIM.indexOf(flat('a darkened arena stage under coloured lights')) >= 0);
check('Qwen shows what to write instead', QWEN.indexOf(flat('a darkened arena stage under coloured lights')) >= 0);

console.log('\n--- the intent is reasoned through, not written straight out ---');
// The baseline showed beat 1 could reach no better than strong_contextual with
// entity=related, and that ceiling was set by the intent naming an act no CC0
// library holds - not by retrieval and not by the evaluator. So the Director
// now walks the availability question BEFORE writing the shot, in both copies.
const STEPS = [
  ['asks what the viewer should understand', 'what is the viewer supposed to understand'],
  ['asks what evidence communicates it', 'what observable evidence communicates that'],
  ['asks what could realistically exist', 'what could realistically exist in these libraries'],
  ['asks what preserves the meaning when it cannot', 'what preserves the meaning'],
  ['and writes the queries last', 'only now, the queries']
];
for (const [what, phrase] of STEPS) {
  const p = flat(phrase);
  check(`NIM  - ${what}`, NIM.indexOf(p) >= 0, phrase);
  check(`Qwen - ${what}`, QWEN.indexOf(p) >= 0, phrase);
}
check('NIM  names the substitution deliberately', NIM.indexOf(flat('assetStrategy')) >= 0);
check('Qwen names the substitution deliberately', QWEN.indexOf(flat('assetStrategy')) >= 0);

console.log('\n--- describing a shot and searching for one are different jobs ---');
check('NIM  separates the two', NIM.indexOf(flat('queries are a different job')) >= 0);
check('Qwen separates the two', QWEN.indexOf(flat('queries are a different job')) >= 0);
check('NIM  says a proper noun in a query finds nothing',
      NIM.indexOf(flat('a query carrying a proper noun finds nothing')) >= 0);
check('Qwen says a proper noun in a query finds nothing',
      QWEN.indexOf(flat('a query carrying a proper noun finds nothing')) >= 0);

console.log('\n--- and filler is refused, not merely discouraged ---');
check('NIM  ranks story above keywords', NIM.indexOf(flat('does it tell this story')) >= 0);
check('Qwen ranks story above keywords', QWEN.indexOf(flat('does it tell this story')) >= 0);

console.log('\n--- retrieval no longer treats the intent as a query ---');
check('the intent is translated before it is searched',
      /queryFromIntent\(concept\)/.test(stock),
      'broaderQueries used to begin with the raw concept sentence');
check('and the raw concept is not posted as a query',
      !/broaderQueries\s*=\s*\[concept,/.test(stock));

console.log('\n--- the ranker judges the subject, not just the picture ---');
check('relevance is scored', /function relevanceOf\(/.test(stock));
check('it is weighted above resolution',
      /Math\.round\(rel\.score \* 70\)/.test(stock),
      'resolution moves a score by at most 12');
check('a single coincidental word is not evidence', /corroborated/.test(stock));
check('an asset that describes nothing is not punished',
      /known: false/.test(stock),
      'Pexels ships no tags on video; absence of evidence is not evidence of a bad match');

console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                 : 'BOTH DIRECTORS ARE TOLD THE SAME THING'));
process.exit(fails.length ? 1 : 0);
