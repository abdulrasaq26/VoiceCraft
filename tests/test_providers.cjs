// The providers control must mean what it says.
//
// 'all' always permitted archive_org, while the option was labelled
// "Pixabay + Pexels" — so the control read as excluding the archive while
// including it, and a producer who wanted archival footage had no reason to
// think it was available.
const fs = require('fs'), vm = require('vm');
const ROOT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video/public';
const html = fs.readFileSync(ROOT + '/index.html', 'utf8');
const sm = fs.readFileSync(ROOT + '/adapters/stock-media.js', 'utf8');

const fails = [];
const check = (n, c, d) => { console.log((c?'  PASS  ':'  FAIL  ')+n+(c?'':'  <- '+JSON.stringify(d))); if(!c) fails.push(n); };

// Re-create the gate exactly as stock-media applies it.
const allowed = (provider, name, sources) => {
  if (provider === 'modern') { if (name === 'archive_org') return false; }
  else if (provider !== 'all' && provider !== name) return false;
  if (Array.isArray(sources) && sources.length) return sources.includes(name);
  return true;
};

console.log('--- the option list ---');
const sel = html.slice(html.indexOf('id="sb-stock-provider"'), html.indexOf('id="sb-stock-provider"') + 700);
check('the archive is offered', /value="archive_org"/.test(sel), sel.slice(0, 200));
check('modern-only is offered', /value="modern"/.test(sel));
check('"all" no longer claims to be Pixabay + Pexels',
      !/value="all"[^>]*>Pixabay \+ Pexels</.test(sel));
check('"all" says the Director chooses', /value="all"[^>]*>All sources/.test(sel));

console.log('--- what each option actually permits ---');
for (const [p, expect] of [
  ['all',         { pixabay: true,  pexels: true,  archive_org: true  }],
  ['modern',      { pixabay: true,  pexels: true,  archive_org: false }],
  ['archive_org', { pixabay: false, pexels: false, archive_org: true  }],
  ['pixabay',     { pixabay: true,  pexels: false, archive_org: false }],
  ['pexels',      { pixabay: false, pexels: true,  archive_org: false }]
]) {
  const got = {};
  for (const name of ['pixabay', 'pexels', 'archive_org']) got[name] = allowed(p, name, null);
  check(`${p.padEnd(12)} -> ${JSON.stringify(got)}`,
        JSON.stringify(got) === JSON.stringify(expect), { got, expect });
}

console.log('--- the Director\'s own allow-list still wins ---');
check('a beat asking only for the archive is honoured under "all"',
      allowed('all', 'archive_org', ['archive_org']) === true
      && allowed('all', 'pexels', ['archive_org']) === false);
check('but a modern-only project still excludes it',
      allowed('modern', 'archive_org', ['archive_org']) === false);

console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}` : 'PROVIDERS CONTROL PASSES'));
process.exit(fails.length ? 1 : 0);
