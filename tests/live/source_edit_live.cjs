// An edited composition, and the file that comes out of it.
//
// The Composer's source was already kept on the scene and already readable in
// the workspace. What could not be done was ACT on it: a scene that was nearly
// right could only be thrown away and asked for again, which is a different
// capability from the one "the source remains editable" describes.
//
// So the claim here is narrow and end-to-end: text a human changed is the text
// that gets rendered, the change reaches the pixels, and the two things that
// are NOT the editor's to decide still are not.
//
//   the edit lands      the file carries the colour the edited source asks for
//                       and no longer carries the one it replaced
//   the clock holds     the edited source asks for a longer composition and
//                       gets the timeline's length anyway, because the window
//                       comes from the measured narration and never from
//                       whoever is typing
//   the record is true  the scene says it was edited by hand, so the Composer's
//                       account of elements and reasoning is not left standing
//                       as an explanation of a file it never saw
//
// No model is called anywhere in this test. The first composition is
// hand-written and the second is the first with two edits, which is what makes
// the difference between the two files attributable.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'source_edit_v1.json');

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

const SECONDS = 3;
// What the edited source will ask for. Deliberately far from SECONDS so the
// difference is unmistakable in a decoded file rather than a rounding argument.
const EDITED_DURATION = 8;

// Two accents no stock footage carries, and far enough apart that neither can
// be mistaken for the other or for the house ground.
const BEFORE = { r: 233, g: 30, b: 160 };   // magenta
const AFTER  = { r: 30, g: 220, b: 90 };    // green

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 900000,
    args: ['--window-size=1300,900', '--autoplay-policy=no-user-gesture-required']
  });
  const page = (await browser.pages())[0];
  page.on('pageerror', (e) => console.log('  [pageerror] ' + e.message.slice(0, 110)));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  console.log('=== the services this needs ===');
  const live = await page.evaluate(async () => ({
    render: (await window.BlvckHyperFrame.available(true)).ready === true,
    frames: (await window.BlvckFrames.available(true)).ready === true
  }));
  console.log(`  renderer ${live.render ? 'up' : 'down'} · frame service ${live.frames ? 'up' : 'down'}`);
  check('the renderer and the frame extractor are both up', live.render && live.frames, live);
  if (!live.render || !live.frames) {
    console.log('\nFAILED: this test measures decoded files and cannot grade itself without them.');
    await browser.close();
    process.exit(1);
  }

  // ── The first render, from a hand-written composition ───────────────────
  console.log('\n=== the build the Composer would have made ===');
  const first = await page.evaluate(async (secs, accent) => {
    const gsap = await window.BlvckHyperFrame.gsap();
    const source = `<!doctype html><html><head><meta charset="utf-8">
<script src="./vendor/gsap.min.js"><\/script>
<style>
 *{margin:0;padding:0;box-sizing:border-box}
 html,body{width:1920px;height:1080px;overflow:hidden;background:#0b0d12}
 body{font-family:Georgia,'Times New Roman',serif}
 #card{position:absolute;left:170px;top:392px}
 #head{font-size:118px;color:#f2f5f8;letter-spacing:-.02em}
 #bar{margin-top:36px;width:560px;height:80px;background:rgb(${accent.r},${accent.g},${accent.b})}
</style></head><body>
 <div id="root" data-composition-id="main" data-start="0" data-duration="${secs}"
      data-width="1920" data-height="1080" data-fps="30">
   <div id="card" class="clip" data-start="0" data-duration="${secs}" data-track-index="0">
     <div id="head">A scene made of code.</div>
     <div id="bar"></div>
   </div>
 </div>
 <script>
  window.__timelines = window.__timelines || {};
  const tl = gsap.timeline({paused:true});
  tl.from("#head",{opacity:0,y:34,duration:.65,ease:"power3.out"},0.2);
  window.__timelines["main"] = tl;
 <\/script></body></html>`;

    const scene = {
      index: 1,
      timestamp: '00:00:00 - 00:00:0' + secs,
      subtitle: 'Some ideas have no footage. This is one of them.',
      sceneSummary: 'a scene made of code',
      status: 'pending',
      timelineStart: 0, timelineEnd: secs,
      visualStrategy: { mode: 'HYPERFRAME', reason: 'hand-written for the edit test', ran: true },
      hyperFrame: { mode: 'FULL_FRAME', status: 'planned' }
    };
    localStorage.setItem('blvck-tts:storyboard', JSON.stringify({
      project: { title: 'source edit' }, cues: [], scenes: [scene], transcript: null
    }));
    const liveScenes = window.BlvckStoryboard.scenes();
    liveScenes.length = 0;
    liveScenes.push(scene);

    try {
      const out = await window.BlvckHyperFrame.renderScene(scene, {
        source, vendor: [{ name: 'gsap.min.js', text: gsap }]
      });
      // A stale verdict, to prove the re-render drops it rather than leaving it
      // attached to a file it never saw.
      scene.hyperFrameEvaluation = { reading: { sees: 'the build before the edit' }, at: Date.now() };
      window.BlvckStoryboard.save();
      return { ok: true, renderMs: out.renderMs, seconds: out.seconds,
               bytes: out.blob.size, hyperFrame: scene.hyperFrame,
               sourceKept: (scene.hyperFrameSource || '').length };
    } catch (e) { return { ok: false, why: e.message }; }
  }, SECONDS, BEFORE);

  if (!first.ok) {
    check('the first composition rendered', false, first.why);
    await browser.close();
    process.exit(1);
  }
  console.log(`  ${(first.bytes / 1024).toFixed(0)}KB · ${first.seconds}s`
    + ` · rendered in ${(first.renderMs / 1000).toFixed(1)}s`);
  console.log(`  ${JSON.stringify(first.hyperFrame)}`);

  check('the source it was built from is kept on the scene', first.sourceKept > 400, first);
  check('and it is version 1, not edited by anyone',
        first.hyperFrame.version === 1 && first.hyperFrame.handEdited === false, first.hyperFrame);

  // ── Measure it, so the second render has something to differ from ───────
  const readFile = async () => page.evaluate(async (accents) => {
    const blob = await new Promise((res, rej) => {
      const rq = indexedDB.open('blvck-storyboard', 1);
      rq.onsuccess = () => {
        const tx = rq.result.transaction('images', 'readonly');
        const g = tx.objectStore('images').get('clip:1');
        g.onsuccess = () => res(g.result || null);
        g.onerror = () => rej(g.error);
      };
      rq.onerror = () => rej(rq.error);
    });
    if (!blob) return { ok: false, why: 'nothing is stored for this scene' };
    // Late enough that the entrance has finished, and inside the SHORT length
    // so the same instant is valid whichever duration the file turned out to be.
    const out = await window.BlvckFrames.at(blob, [2.0]);
    const f = out.frames[0];
    if (!f.ok) return { ok: false, why: f.why };
    // NEAREST REFERENCE, NOT A TOLERANCE.
    //
    // The first version of this check asked whether a pixel was within a fixed
    // distance of the colour the source declares, with the distance calibrated
    // on the magenta. It did not survive the green. h264 does not carry these
    // colours faithfully and does not err in a consistent direction:
    //
    //   rgb(233,30,160) declared -> rgb(248,45,157) decoded   summed 33
    //   rgb(30,220,90)  declared -> rgb(3,189,76)   decoded   summed 72
    //
    // so a threshold that admits the first rejects the second, and a correct
    // render measured as a missing one. Every pixel is now assigned to whichever
    // reference it is CLOSEST to. The two accents are far apart from each other
    // and from both the ground and the type, so the assignment needs no
    // threshold at all and no number calibrated on one sample.
    const refs = [
      { name: 'before', c: accents.BEFORE },
      { name: 'after', c: accents.AFTER },
      { name: 'ground', c: { r: 11, g: 13, b: 18 } },
      { name: 'type', c: { r: 242, g: 245, b: 248 } }
    ];
    const count = { before: 0, after: 0, ground: 0, type: 0 };
    let barR = 0, barG = 0, barB = 0, barN = 0;
    for (let i = 0; i < f.data.length; i += 4) {
      const r = f.data[i], g = f.data[i + 1], b = f.data[i + 2];
      let best = null, bestD = Infinity;
      for (const ref of refs) {
        const d = Math.abs(r - ref.c.r) + Math.abs(g - ref.c.g) + Math.abs(b - ref.c.b);
        if (d < bestD) { bestD = d; best = ref.name; }
      }
      count[best]++;
      // The mean of whatever is standing where an accent should be, reported
      // so the codec's actual shift is on the record rather than inferred.
      if (best === 'before' || best === 'after') { barR += r; barG += g; barB += b; barN++; }
    }
    const mean = barN ? [Math.round(barR / barN), Math.round(barG / barN), Math.round(barB / barN)] : null;
    return { ok: true, count, mean, width: f.width, height: f.height,
             duration: out.meta.duration, frames: out.meta.frames, fps: out.meta.fps };
  }, { BEFORE, AFTER });

  console.log('\n=== the first file ===');
  const fileA = await readFile();
  if (!fileA.ok) {
    check('the first file could be measured', false, fileA.why);
    await browser.close();
    process.exit(1);
  }
  console.log(`  ${fileA.width}x${fileA.height} · ${fileA.duration}s · `
    + `magenta ${fileA.count.before}px · green ${fileA.count.after}px`
    + ` · the accent decoded as rgb(${(fileA.mean || []).join(',')})`);
  // The bar is 560x80 = 44800 pixels, so a correct render puts essentially all
  // of them on one side of the swap.
  //
  // The other side is asserted as a RATIO rather than a count. Nearest-reference
  // classification gives every pixel a home, so the antialiased boundary between
  // an accent and the ground lands on whichever accent it happens to be nearer -
  // about a thousand pixels of edge, which is a property of having edges and not
  // evidence of the wrong colour. What would actually indicate a failed swap is
  // the two counts being comparable, and they are not: the margin here is
  // better than thirty to one in both directions.
  const RATIO = 10;
  check('the first file carries the colour its source asked for',
        fileA.count.before > 30000, fileA.count);
  check('and the colour it never mentioned is nowhere near it',
        fileA.count.before > fileA.count.after * RATIO,
        { before: fileA.count.before, after: fileA.count.after,
          ratio: +(fileA.count.before / Math.max(1, fileA.count.after)).toFixed(1) });

  // ── Edit it, and render the edit ────────────────────────────────────────
  console.log('\n=== the same composition, edited by hand ===');
  const second = await page.evaluate(async (before, after, editedDuration) => {
    const scene = window.BlvckStoryboard.scenes()[0];
    const was = scene.hyperFrameSource || '';

    // Two edits. One a human would plausibly make, and one they are not
    // entitled to make.
    const pattern = new RegExp('rgb\\(' + before.r + ',\\s*' + before.g + ',\\s*' + before.b + '\\)', 'g');
    let edited = was.replace(pattern, 'rgb(' + after.r + ',' + after.g + ',' + after.b + ')');
    const recoloured = edited !== was;
    edited = edited.replace(/(data-composition-id="main"[^>]*?)data-duration="[^"]*"/,
                            '$1data-duration="' + editedDuration + '"');
    const relengthened = /data-composition-id="main"[^>]*?data-duration="8"/.test(edited);

    const t0 = Date.now();
    const res = await window.BlvckHyperFrameComposer.rerenderFrom(scene, edited, {
      onProgress: () => {}
    });
    window.BlvckStoryboard.save();
    const stored = JSON.parse(localStorage.getItem('blvck-tts:storyboard')).scenes[0];
    const rootDuration = /data-composition-id="main"[^>]*?data-duration="([^"]*)"/
      .exec(stored.hyperFrameSource || '');
    return {
      res, recoloured, relengthened, wallMs: Date.now() - t0,
      hyperFrame: stored.hyperFrame,
      storedSourceAsksFor: rootDuration ? rootDuration[1] : null,
      storedSourceIsEdited: new RegExp('rgb\\(' + after.r + ',\\s*' + after.g + ',\\s*' + after.b + '\\)')
        .test(stored.hyperFrameSource || ''),
      keptStaleVerdict: !!stored.hyperFrameEvaluation
    };
  }, BEFORE, AFTER, EDITED_DURATION);

  check('the edit actually changed the colour before rendering', second.recoloured === true, second);
  check('and actually asked for a different length', second.relengthened === true, second);
  if (!second.res.ok) {
    check('the edited composition rendered', false, second.res.why);
    await browser.close();
    process.exit(1);
  }
  console.log(`  re-rendered in ${(second.res.renderMs / 1000).toFixed(1)}s`
    + ` · version ${second.hyperFrame.version}`);
  console.log(`  ${JSON.stringify(second.hyperFrame)}`);

  check('THE SCENE SAYS IT WAS EDITED BY HAND',
        second.hyperFrame.handEdited === true, second.hyperFrame);
  check('and counts as the second version of this scene',
        second.hyperFrame.version === 2, second.hyperFrame);
  check('the edited text is what the scene now says it was built from',
        second.storedSourceIsEdited === true, second);
  check('the verdict on the previous build was not left attached to this one',
        second.keptStaleVerdict === false, second);

  // ── And the file ────────────────────────────────────────────────────────
  console.log('\n=== the file the edit produced ===');
  const fileB = await readFile();
  if (!fileB.ok) {
    check('the second file could be measured', false, fileB.why);
    await browser.close();
    process.exit(1);
  }
  console.log(`  ${fileB.width}x${fileB.height} · ${fileB.duration}s · `
    + `magenta ${fileB.count.before}px · green ${fileB.count.after}px`
    + ` · the accent decoded as rgb(${(fileB.mean || []).join(',')})`);

  check('THE EDIT REACHED THE PIXELS — the new colour is in the file',
        fileB.count.after > 30000, fileB.count);
  check('and the colour it replaced no longer holds the frame',
        fileB.count.after > fileB.count.before * RATIO,
        { before: fileB.count.before, after: fileB.count.after,
          ratio: +(fileB.count.after / Math.max(1, fileB.count.before)).toFixed(1) });
  check('THE ACCENT CHANGED SIDES BETWEEN THE TWO FILES',
        fileA.count.before > fileA.count.after && fileB.count.after > fileB.count.before,
        { first: fileA.count, second: fileB.count });
  check(`THE EDITED SOURCE ASKED FOR ${EDITED_DURATION}s AND THE TIMELINE GAVE IT ${SECONDS}s`,
        Math.abs(fileB.duration - SECONDS) < 0.2, { duration: fileB.duration, asked: EDITED_DURATION });
  check('the scene records that the length was held',
        second.hyperFrame.durationForced === true, second.hyperFrame);
  check('and the source the scene kept is the corrected one, not the one that was typed',
        Number(second.storedSourceAsksFor) === SECONDS, second);

  fs.writeFileSync(OUT, JSON.stringify({
    at: new Date().toISOString(),
    seconds: SECONDS, editedDuration: EDITED_DURATION,
    first: { hyperFrame: first.hyperFrame, file: fileA },
    second: { hyperFrame: second.hyperFrame, file: fileB, res: second.res }
  }, null, 2));

  console.log(`\n${fails.length ? 'FAILED: ' + fails.join(' · ') : 'All checks passed.'}`);
  console.log(`Written to ${OUT}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})();
