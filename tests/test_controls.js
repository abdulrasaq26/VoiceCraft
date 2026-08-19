// The controls that decide what gets fetched must survive a reload.
const fs = require('fs');
const ROOT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video/public';
const html = fs.readFileSync(ROOT + '/index.html', 'utf8');
const sb = fs.readFileSync(ROOT + '/storyboard.js', 'utf8');
const sm = fs.readFileSync(ROOT + '/adapters/stock-media.js', 'utf8');

const fails = [];
const check = (n, c, d) => { console.log((c?'  PASS  ':'  FAIL  ')+n+(c?'':'  <- '+JSON.stringify(d))); if(!c) fails.push(n); };

console.log('--- the default ---');
const sel = html.slice(html.indexOf('id="sb-stock-provider"'), html.indexOf('id="sb-stock-provider"') + 800);
check('modern stock is selected by default', /value="modern" selected/.test(sel));
check('"all" is no longer the default', !/value="all" selected/.test(sel));
check('the archive is still offered', /value="archive_org"/.test(sel));

console.log('--- persistence ---');
check('the choice is saved', /localStorage\.setItem\(CONTROL_PREFS/.test(sb));
check('and restored', /localStorage\.getItem\(CONTROL_PREFS/.test(sb));
check('only values the control still offers are restored',
      /o\.value === saved\[key\]/.test(sb));
check('restoreControls runs once, in the wiring section',
      (sb.match(/restoreControls\(\);/g) || []).length === 1, 
      (sb.match(/restoreControls\(\);/g) || []).length + ' call sites');
check('it is not called inside the batch loop',
      !/forEach\(\(s\) => scenes\.push[\s\S]{0,80}restoreControls/.test(sb));

console.log('--- the thumbnail path stays archive-only ---');
check('excerpt analysis is gated on archive_org',
      /const analyzable = asset\.provider === 'archive_org'/.test(sm));
check('everything else uses planExcerpt, which does no network work',
      /return planExcerpt\(asset, wantSeconds, selectionIntent\);/.test(sm));
check('modern-only excludes the archive from search',
      /if \(provider === 'modern'\) \{\s*\n\s*if \(name === 'archive_org'\) return false;/.test(sm));

console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}` : 'CONTROLS PASS'));
process.exit(fails.length ? 1 : 0);
