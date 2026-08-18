// The script prompt must forbid, by name, the tics the model actually produced.
//
// The generated WWII script opened "Imagine a single morning...", used four
// "not X, but Y" constructions in 400 words, reached for "millions of lives"
// instead of a number, and closed by restating the title. General advice
// ("write a strong hook") produced all of that, so the prompt names them.
const fs = require('fs'), vm = require('vm');
const ROOT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video/public';

const sb = { console: { log(){}, warn(){} }, Date, Math, JSON };
sb.window = sb; sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(fs.readFileSync(ROOT + '/prompts.js', 'utf8'), sb, { filename: 'prompts.js' });

const fails = [];
const check = (n, c, d) => { console.log((c?'  PASS  ':'  FAIL  ')+n+(c?'':'  <- '+JSON.stringify(d))); if(!c) fails.push(n); };

const built = sb.BlvckPrompts.build('/api/script/generate', {
  options: { type: 'documentary', length: 'medium', tone: 'authoritative and measured',
             topic: 'How World War Two began in Europe', retention: true }
});
const all = built.system + '\n' + built.user;

console.log('--- shape ---');
check('returns { system, user }', !!built.system && !!built.user);
check('the brief reaches the user turn', /World War Two/.test(built.user));
check('length guidance survives', /400 words/.test(built.user));

console.log('--- the observed failure modes are named ---');
check('bans the "Imagine" opener', /Never open with "Imagine"/.test(all));
check('bans "What if I told you"', /What if I told you/.test(all));
check('bans announcing the subject', /This is the story of/.test(all));
check('limits the "not X, but Y" tic', /"Not X, but Y" more than once/.test(all));
check('bans a summarising ending', /Summarising at the end/.test(all));
check('names the empty-scale words', /Millions of lives/.test(all));
check('bans hollow intensifiers', /little did they know/.test(all));

console.log('--- what it asks for instead ---');
check('demands a concrete opening fact', /concrete and specific/.test(all));
check('shows a weak/strong contrast', /Weak:/.test(all) && /Strong:/.test(all));
check('asks for an open loop', /HOLD SOMETHING BACK/.test(all));
check('asks for rhythm variation', /Vary sentence length hard/.test(all));
check('structure guidance is unconditional', /STRUCTURE: land a concrete fact/.test(built.user));

console.log('--- retention flag adds, never replaces ---');
const plain = sb.BlvckPrompts.build('/api/script/generate', {
  options: { type: 'documentary', topic: 'x', retention: false }
});
check('structure guidance is present without the flag',
      /STRUCTURE: land a concrete fact/.test(plain.user));
check('the flag adds the harder version', /fighting for watch time/.test(built.user));
check('and it is absent without the flag', !/fighting for watch time/.test(plain.user));

console.log('--- truthfulness is not traded for drama ---');
check('forbids invented specifics', /never invent a quote, a statistic/.test(all));
check('drama comes from arrangement', /selection and arrangement, not invention/.test(all));

console.log('--- the leak guard still holds at the output end ---');
check('still demands narration only', /Output only the spoken narration/.test(all));
check('forbids narrating its own process', /Never narrate your own process/.test(all));

console.log('--- the documentary brief no longer asks for a question opener ---');
check('documentary opens on a detail, not a question',
      /Open on a specific verifiable detail/.test(built.user));

console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}` : 'SCRIPT PROMPT PASSES'));
process.exit(fails.length ? 1 : 0);
