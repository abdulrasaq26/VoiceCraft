// No assignment may target a name the file never declares.
//
// Every front-end file here runs under 'use strict', where assigning to an
// undeclared name throws a ReferenceError rather than creating a global. That
// is usually a quick, obvious failure — except in one place, and this project
// hit exactly that place:
//
//   } catch (err) {
//     lastRaw = ...            <- ReferenceError, inside the error handler
//     showStatus(err.message);
//   }
//
// The throw destroyed the provider error the handler existed to report and
// replaced it with a message about a variable. Before Analyze had an outer
// catch, it became an unhandled rejection: spinner still turning, nothing
// reported, and no way to tell a dead provider from a slow one. The bug was
// invisible until something failed, and then it hid what failed.
//
// The matcher is deliberately narrow — spaces around the operator and a
// terminating semicolon — because the two shapes that produced false positives
// are a multi-line destructuring default (`sources = null, archiveQueries = []`)
// and an HTML attribute inside a template literal (`style="..."`), and neither
// looks like that. A missed case is better here than a wrong one.
const fs = require('fs');
const path = require('path');
const ROOT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video/public';

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

const GLOBALS = new Set(['window', 'document', 'console', 'localStorage', 'indexedDB', 'fetch', 'Math',
  'JSON', 'Date', 'Promise', 'Array', 'Object', 'String', 'Number', 'Boolean', 'Error', 'Set', 'Map',
  'WeakMap', 'URL', 'Blob', 'File', 'FileReader', 'Image', 'Audio', 'AbortSignal', 'MediaRecorder',
  'CustomEvent', 'TextEncoder', 'TextDecoder', 'setTimeout', 'setInterval', 'clearTimeout',
  'clearInterval', 'requestAnimationFrame', 'performance', 'navigator', 'location', 'history', 'crypto',
  'structuredClone', 'atob', 'btoa', 'module', 'exports', 'require', 'globalThis', 'self', 'undefined',
  'NaN', 'Infinity', 'AudioContext', 'webkitAudioContext', 'Response', 'Headers', 'FormData', 'Intl']);

/** Line and block comments removed, so prose never counts as code. */
// Comment removal that knows what a string is.
//
// The first version was two regexes, and a string literal containing comment
// punctuation fooled both. storyboard.js sets file.accept = 'image/*', and the
// /* inside that string opened a block comment that ran for FIFTY-EIGHT lines
// until it found a real */ - deleting `let previewEl = null;` along with the
// rest of closePreview. The scan then reported previewEl as an undeclared
// assignment, which was false, and for as long as that span was swallowed it
// was also not scanning any of the code inside it, which is the more serious
// half: a stripper that eats code hides offenders as readily as it invents
// them.
//
// So this walks the source instead, tracking quotes and template literals.
// Newlines inside block comments are kept so reported line numbers still match
// the real file.
function stripComments(src) {
  const NL = String.fromCharCode(10);
  let out = '';
  let quote = null;          // the ' " or ` we are inside, if any
  let inLine = false;
  let inBlock = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const d = src[i + 1];
    if (inLine) {
      if (c === NL) { inLine = false; out += c; }
      continue;
    }
    if (inBlock) {
      if (c === '*' && d === '/') { inBlock = false; i++; }
      else if (c === NL) out += c;
      continue;
    }
    if (quote) {
      out += c;
      if (c === String.fromCharCode(92)) { out += (d === undefined ? '' : d); i++; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; out += c; continue; }
    if (c === '/' && d === '/') { inLine = true; i++; continue; }
    if (c === '/' && d === '*') { inBlock = true; i++; continue; }
    out += c;
  }
  return out;
}

function declaredNames(src) {
  const names = new Set(GLOBALS);
  const add = (n) => { if (/^[A-Za-z_$][\w$]*$/.test(n)) names.add(n); };

  // Every declarator in a let/const/var statement, not just the first: a
  // `let sum = 0, sumSq = 0;` otherwise reports its second name as undeclared.
  for (const m of src.matchAll(/\b(?:let|const|var)\s+([^;\n]+)/g)) {
    let depth = 0;
    let cur = '';
    for (const ch of m[1]) {
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      if (ch === ',' && depth === 0) { add(cur.split('=')[0].trim()); cur = ''; }
      else cur += ch;
    }
    add(cur.split('=')[0].trim());
  }
  for (const m of src.matchAll(/\bfunction\s*\*?\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of src.matchAll(/\bclass\s+([A-Za-z_$][\w$]*)/g)) add(m[1]);
  for (const m of src.matchAll(/catch\s*\(\s*([A-Za-z_$][\w$]*)/g)) add(m[1]);
  // Parameter positions only.
  //
  // An earlier version added every identifier found between any brackets,
  // reasoning that over-broad only suppresses reports. It suppressed the one
  // that mattered: showRawResponse(lastRaw) is a CALL, and treating its
  // argument as a declaration made the undeclared lastRaw look declared. A
  // scan that cannot fail is not a scan, so these are the real binding sites
  // and nothing else.
  const params = (list) => {
    for (const part of String(list).split(',')) {
      add(part.split(':').pop().split('=')[0].trim().replace(/^[.]{3}/, ''));
    }
  };
  for (const m of src.matchAll(/function\s*\*?\s*[\w$]*\s*\(([^)]*)\)/g)) params(m[1]);
  for (const m of src.matchAll(/\(([^()]*)\)\s*=>/g)) params(m[1]);
  for (const m of src.matchAll(/(?:^|[^\w$.])([A-Za-z_$][\w$]*)\s*=>/gm)) add(m[1]);
  // Class and object-literal methods: name(a, b) {
  for (const m of src.matchAll(/(?:^|[;,{}\s])(?:async\s+)?([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*\{/g)) {
    add(m[1]);
    params(m[2]);
  }
  for (const m of src.matchAll(/for\s*\(\s*(?:const|let|var)\s+([\w$]+)/g)) add(m[1]);
  for (const m of src.matchAll(/(?:let|const|var)\s*[{[]([^}\]]*)[}\]]/g)) params(m[1]);
  return names;
}

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.js')) files.push(f);
  }
})(ROOT);

const offenders = [];
let scanned = 0;
for (const f of files) {
  const raw = fs.readFileSync(f, 'utf8');
  if (!/['\"]use strict['\"]/.test(raw)) continue;
  scanned++;
  // Comments stripped BEFORE deciding what is declared. Reading raw source
  // meant a commented-out `// let lastRaw = '';` still registered as a
  // declaration - the scan reported clean with the bug deliberately back in
  // place, which is how this was caught.
  const src = stripComments(raw);
  const declared = declaredNames(src);
  src.split(String.fromCharCode(10)).forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').trim();
    if (!code.endsWith(';')) return;                    // not a statement
    const m = code.match(/^([A-Za-z_$][\w$]*)\s+(?:=|\+=|-=|\|\|=)\s+[^=]/);
    if (!m || declared.has(m[1])) return;
    offenders.push(`${path.relative(ROOT, f)}:${i + 1}  ${m[1]}  —  ${code.slice(0, 70)}`);
  });
}

console.log(`  scanned ${scanned} strict-mode file(s)\n`);
for (const o of offenders) console.log('    ' + o);
check('no assignment targets an undeclared name', offenders.length === 0, offenders);

// The specific one that hid a provider failure, pinned by name so a revert is
// caught even if the scanner above is ever loosened.
// Comments stripped, or a declaration that has merely been COMMENTED OUT still
// satisfies this - which is exactly how the first version of this test passed
// while the bug was deliberately put back to check it could fail at all.
const sb = fs.readFileSync(ROOT + '/storyboard.js', 'utf8')
  .split(String.fromCharCode(10))
  .map((l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; })
  .join(String.fromCharCode(10));
console.log('');
check('lastRaw is declared before it is assigned',
      /\blet\s+lastRaw\s*=/.test(sb) && sb.indexOf('let lastRaw') < sb.indexOf('lastRaw = (err'),
      'the storyboard error handler assigns it');
check('and reading the raw response cannot itself throw',
      /try\s*\{[\s\S]{0,220}lastRaw\s*=\s*\(err[\s\S]{0,260}catch/.test(sb),
      'lastRawResponse() goes through the subsystem that just failed');

console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                 : 'NOTHING ASSIGNS TO A NAME IT NEVER DECLARED'));
process.exit(fails.length ? 1 : 0);
