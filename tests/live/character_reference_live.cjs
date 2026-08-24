// Character reference portraits: the store, and the restore that used to throw.
//
// Two real defects sit behind this.
//
// storyboard.js used six identifiers declared in no file at all - refKey,
// refBlobs, refUrls, refDataUrls, blobToDataUrl and setReference. Opening any
// project with a character bible threw "refKey is not defined" partway through
// restoreProject, which abandoned the rest of the restore. That is measured
// here, not argued: the probe that found it watched the page throw on load.
//
// And character-library.js owned the reference store, the key convention and
// every reader - ltx-video.js has been pulling portraits out of it for the KI
// path since it was written - while nothing anywhere could WRITE one. The
// store had no writer at all.
//
// The storyboard's own cast panel is NOT covered, deliberately: sb-cast and
// sb-cast-list do not exist in index.html, so renderCast() returns on its first
// line and the Upload button it builds is never in the document. That is a
// separate gap and pretending to test it would prove nothing.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');

const PORT = process.argv[2] || '3491';
const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

const BIBLE = { characters: [{ name: 'Ada', description: 'a woman in a red coat' }] };
const SCENES = [{ index: 1, timestamp: '00:00:00 - 00:00:06', subtitle: 'Ada walks in.',
                  sceneSummary: 'Ada walking', status: 'pending', characters: ['Ada'] }];

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 180000,
    args: ['--window-size=1300,900']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((bible, scenes) => {
    localStorage.setItem('blvck-tts:storyboard', JSON.stringify({
      project: { title: 'reference test' }, cues: [], bible, scenes }));
  }, BIBLE, SCENES);
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2200));

  // ── Opening a project that has a cast ───────────────────────────────────
  console.log('=== restoring a project with characters ===');
  const refErrors = pageErrors.filter((e) => /is not defined/.test(e));
  console.log(`  ReferenceErrors on load: ${refErrors.length ? refErrors.join(' | ') : 'none'}`);
  check('restoring a project with characters throws no ReferenceError',
        refErrors.length === 0, refErrors);
  check('and the scenes still restored — the throw used to abandon the rest',
        await page.evaluate(() => {
          const sb = JSON.parse(localStorage.getItem('blvck-tts:storyboard') || 'null');
          return !!(sb && sb.scenes && sb.scenes.length);
        }), 'scenes missing after restore');

  // ── The store now has a writer ──────────────────────────────────────────
  console.log('\n=== the reference store ===');
  const api = await page.evaluate(() => ({
    reader: !!(window.BlvckCast && window.BlvckCast.referenceBlob),
    writer: !!(window.BlvckCast && window.BlvckCast.setReference),
    remover: !!(window.BlvckCast && window.BlvckCast.clearReference),
    consumer: !!(window.BlvckCast && window.BlvckCast.referenceBase64)
  }));
  console.log(`  ${JSON.stringify(api)}`);
  check('the library can be read from', api.reader === true, api);
  check('and now written to — it had readers and no writer at all',
        api.writer === true, api);
  check('and cleared', api.remover === true, api);

  // ── A portrait round-trips ──────────────────────────────────────────────
  console.log('\n=== storing a portrait ===');
  const stored = await page.evaluate(async () => {
    // A real PNG, built here so nothing depends on a fixture on disk.
    const c = document.createElement('canvas');
    c.width = 32; c.height = 32;
    const g = c.getContext('2d');
    g.fillStyle = '#c0392b'; g.fillRect(0, 0, 32, 32);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));

    const before = await window.BlvckCast.referenceBlob('Ada');
    await window.BlvckCast.setReference('Ada', blob);
    const after = await window.BlvckCast.referenceBlob('Ada');
    const b64 = await window.BlvckCast.referenceBase64('Ada');
    const dataUrl = await window.BlvckCast.referenceDataUrl('Ada');
    return { hadBefore: !!before, wrote: blob.size, readBack: after ? after.size : 0,
             b64Len: b64.length, dataUrlOk: /^data:image\/png;base64,/.test(dataUrl),
             has: await window.BlvckCast.hasReference('Ada') };
  });
  console.log(`  ${JSON.stringify(stored)}`);
  check('nothing was there beforehand', stored.hadBefore === false, stored);
  check('the portrait is stored and reads back at the same size',
        stored.readBack > 0 && stored.readBack === stored.wrote, stored);
  check('hasReference agrees', stored.has === true, stored);
  check('it comes back as base64 — the exact call ltx-video.js makes for the KI path',
        stored.b64Len > 0, stored);
  check('and as a data URL that is really a PNG', stored.dataUrlOk === true, stored);

  // ── It survives a reload, and the restore still does not throw ──────────
  console.log('\n=== reopening with a portrait in the store ===');
  pageErrors.length = 0;
  await page.reload({ waitUntil: 'load', timeout: 60000 });
  await new Promise((r) => setTimeout(r, 2200));
  const reopened = await page.evaluate(async () => ({
    stillThere: !!(await window.BlvckCast.referenceBlob('Ada')),
    b64Len: (await window.BlvckCast.referenceBase64('Ada')).length
  }));
  console.log(`  ${JSON.stringify(reopened)}  errors: ${pageErrors.length ? pageErrors.slice(0, 2) : 'none'}`);
  check('the portrait survives a reload', reopened.stillThere === true, reopened);
  check('and restoring a project that HAS one still throws nothing',
        pageErrors.filter((e) => /is not defined/.test(e)).length === 0, pageErrors.slice(0, 3));

  // ── Clearing ────────────────────────────────────────────────────────────
  console.log('\n=== clearing it ===');
  const cleared = await page.evaluate(async () => {
    await window.BlvckCast.clearReference('Ada');
    return { blob: !!(await window.BlvckCast.referenceBlob('Ada')),
             b64: (await window.BlvckCast.referenceBase64('Ada')).length,
             has: await window.BlvckCast.hasReference('Ada') };
  });
  console.log(`  ${JSON.stringify(cleared)}`);
  check('clearing removes it from the store', cleared.blob === false, cleared);
  check('and the consumer sees nothing', cleared.b64 === 0 && cleared.has === false, cleared);

  console.log('\n' + (fails.length ? `FAILED (${fails.length}):\n  - ${fails.join('\n  - ')}`
                                   : 'A PORTRAIT CAN BE STORED, READ, KEPT AND REMOVED'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
