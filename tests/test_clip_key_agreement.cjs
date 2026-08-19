// Every writer of a scene asset must use the key its readers use.
//
// Two writers got this wrong in the same way, months apart, and both failures
// looked like something else entirely:
//
//   ltx-video.js  wrote video to the scene key -> loadImage() threw and the
//                 beat degraded to a graphic card
//   storyboard.js wrote video to the scene key -> the Storyboard card looked
//                 perfect, because it reads with the same branch it renders
//                 by, while the editor assembled a typeset card in its place
//
// The convention is one line and it is invisible: video under clip:N, stills
// under String(N). Nothing enforced it, so this does.
const fs = require('fs');
const ROOT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video/public';

const read = (f) => fs.readFileSync(ROOT + '/' + f, 'utf8');
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

const sb = read('storyboard.js');
const ltx = read('ltx-video.js');
const ed = read('editor.js');

console.log('--- the readers define the convention ---');
check('editor reads video from clip:N', ed.indexOf('`clip:${s.index}`') > -1);
check('editor reads stills from String(index)',
      ed.indexOf('idbGet(SB_DB, SB_STORE, String(s.index))') > -1);
check('storyboard reads with the same branch',
      sb.indexOf('idbGet(isVideo ? `clip:${d.index}` : String(d.index))') > -1);

console.log('\n--- every writer branches on media type ---');
// storeAsset: the stock queue's writer.
const storeAsset = sb.slice(sb.indexOf('function storeAsset('), sb.indexOf('function storeAsset(') + 900);
check('storeAsset chooses by media type', /idbPut\(video \? clipKey\(index\) : String\(index\)/.test(storeAsset),
      storeAsset.match(/idbPut\([^)]*\)/));
check('storeAsset no longer writes everything to the scene key',
      storeAsset.indexOf('idbPut(String(index), blob)') === -1);

// attachAsset: the external entry point other modules use.
const attach = sb.slice(sb.indexOf('attachAsset:'), sb.indexOf('attachAsset:') + 500);
check('attachAsset chooses by media type', /clipKey\(scene\.index\) : String\(scene\.index\)/.test(attach),
      attach.match(/idbPut\([^)]*\)/));

// ltx-video.js: the writer fixed earlier in this work.
check('ltx-video STOCK mode chooses by media type',
      /isVideo \? clipKey\(scene\.index\) : String\(scene\.index\)/.test(ltx));

console.log('\n--- and they all spell the key the same way ---');
check('storyboard defines clipKey as clip:N', sb.indexOf('const clipKey = (index) => `clip:${index}`') > -1);
check('ltx-video defines clipKey as clip:N', ltx.indexOf('const clipKey = (index) => `clip:${index}`') > -1);

console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                 : 'WRITERS AND READERS AGREE ON THE CLIP KEY'));
process.exit(fails.length ? 1 : 0);
