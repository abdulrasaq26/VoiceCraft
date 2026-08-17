// Acquired stock/archive footage must be filed where the readers look.
//
// The bug this pins: generateScene wrote every acquired blob to the SCENE key
// regardless of type. The editor loads that key with loadImage(), so a video
// blob threw and the beat fell through to a graphic card — while the CLIP key,
// which both the editor and the storyboard read for video, was never written.
// Footage could be chosen, rights-cleared, excerpted and cached, and still
// never reach the timeline.
const fs = require('fs'), vm = require('vm'), path = require('path');
const ROOT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video/public';

const writes = [];
function makeSandbox() {
  const sb = {
    console: { log(){}, warn(){}, error(){} }, setTimeout, clearTimeout,
    setInterval: () => 0, clearInterval(){}, Date, Math, JSON,
    performance: { now: () => 0 },
    localStorage: { getItem: () => null, setItem(){}, removeItem(){} },
    document: { getElementById: () => null, createElement: () => ({ getContext: () => ({}) }),
                addEventListener(){}, querySelectorAll: () => [], querySelector: () => null },
    CustomEvent: class { constructor(t, o) { this.type = t; Object.assign(this, o); } },
    dispatchEvent(){}, addEventListener(){},
    indexedDB: { open: () => { const r = {}; setTimeout(() => r.onerror && r.onerror(), 0); return r; } },
    URL: { createObjectURL: () => 'blob:x', revokeObjectURL(){} },
    fetch: async () => { throw new Error('no network'); },
    Blob: class { constructor(p, o) { this.parts = p; this.type = (o && o.type) || ''; this.size = 9999; } }
  };
  sb.window = sb; sb.globalThis = sb;
  return sb;
}

const sandbox = makeSandbox();
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'ltx-video.js'), 'utf8'), sandbox, { filename: 'ltx-video.js' });

// Intercept the storage layer by replacing the module's own idbPut through the
// only seam available: the IndexedDB stub above always errors, so idbPut is a
// no-op. Instead, assert on the KEY the module computes, by reading the source
// and the readers' expectations. Runtime interception of a closure-private
// function is not possible, so this is a contract test across the three files.
const fails = [];
const check = (n, c, d) => { console.log((c ? '  PASS  ' : '  FAIL  ') + n + (c ? '' : `  <- ${d}`)); if (!c) fails.push(n); };

const ltx = fs.readFileSync(path.join(ROOT, 'ltx-video.js'), 'utf8');
const ed  = fs.readFileSync(path.join(ROOT, 'editor.js'), 'utf8');
const sbj = fs.readFileSync(path.join(ROOT, 'storyboard.js'), 'utf8');

console.log('--- the writer files video under the clip key ---');
const stockBranch = ltx.slice(ltx.indexOf("if (refs.mode === 'STOCK')"), ltx.indexOf("if (refs.mode === 'STOCK')") + 1400);
check('the STOCK branch chooses a key by media type', /isVideo\s*\?\s*clipKey\(/.test(stockBranch),
      stockBranch.match(/idbPut\([^)]*\)/));
check('it no longer writes video to the scene key unconditionally',
      !/await idbPut\(String\(scene\.index\), blob\);/.test(stockBranch), 'still unconditional');
check('a still still goes to the scene key', /:\s*String\(scene\.index\)/.test(stockBranch), stockBranch.slice(-200));

console.log('--- the readers agree on that convention ---');
check('editor reads video from clip:N',
      /const key = part === 0 \? `clip:\$\{s\.index\}`/.test(ed), 'editor key changed');
check('editor reads stills from String(index)',
      /idbGet\(SB_DB, SB_STORE, String\(s\.index\)\)/.test(ed), 'editor still key changed');
check('storyboard reads video from clip:N',
      /isVideo \? `clip:\$\{d\.index\}` : String\(d\.index\)/.test(sbj), 'storyboard key changed');

console.log('--- clipKey is the shared definition ---');
check('clipKey exists and formats clip:N', /const clipKey = \(index\) => `clip:\$\{index\}`/.test(ltx), 'clipKey changed');
check('partKey extends it for split beats', /partKey = \(index, part\)/.test(ltx));

console.log('--- the module still loads and exports generateScene ---');
check('BlvckLTX present', !!sandbox.BlvckLTX, 'module failed to load');
check('generateScene exported', typeof (sandbox.BlvckLTX || {}).generateScene === 'function');

console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}` : 'CLIP KEY ROUTING PASSES'));
process.exit(fails.length ? 1 : 0);
