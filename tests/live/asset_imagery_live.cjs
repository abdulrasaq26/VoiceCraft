// The picture we think we are looking at must be the picture we are looking at.
//
// Pixabay's parser read hit.picture_id to build a Vimeo URL, falling back to
// hit.userImageURL. Pixabay stopped returning picture_id — it is null on every
// hit — so the fallback was taken every time, and userImageURL is the
// UPLOADER'S AVATAR. The visual evaluator was shown photographers' headshots
// and company logos, described them accurately, and was judged to be
// hallucinating.
//
// This runs against the LIVE provider APIs rather than a fixture, because the
// bug was API drift: a recorded response from the day the parser was written
// would still contain picture_id and would still pass. Only the real endpoint
// can catch the field going away again.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');

const PORT = process.argv[2] || '3491';
const env = fs.readFileSync(PROJECT + '/.env', 'utf8');
const envGet = (k) => {
  const m = env.match(new RegExp('^' + k + '=(.*)$', 'm'));
  return m ? m[1].trim().replace(/^"|"$/g, '') : '';
};

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

(async () => {
  if (!envGet('PIXABAY_API_KEY') && !envGet('PEXELS_API_KEY')) {
    console.log('SKIPPED: no stock keys'); process.exit(0);
  }
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 300000,
    args: ['--window-size=1400,950']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 120)); });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });
  await page.evaluate((px, pe) => {
    if (px) localStorage.setItem('blvck:keys_pixabay', JSON.stringify([px]));
    if (pe) localStorage.setItem('blvck:keys_pexels', JSON.stringify([pe]));
  }, envGet('PIXABAY_API_KEY'), envGet('PEXELS_API_KEY'));
  await page.reload({ waitUntil: 'load', timeout: 60000 });

  const got = await page.evaluate(async () => {
    const S = window.StockMedia;
    const per = async (provider) => (await S.search({
      queries: ['concert stage lights crowd'], orientation: 'landscape',
      mediaType: 'video', minimumDuration: 3, provider
    })).filter((a) => a.provider === provider);
    return {
      pixabay: (await per('pixabay')).slice(0, 4).map((a) => ({
        id: a.id, thumbnailUrl: a.thumbnailUrl, previewVideoUrl: a.previewVideoUrl,
        frames: a.frames.length, tags: (a.tags || []).slice(0, 3).join(', ')
      })),
      pexels: (await per('pexels')).slice(0, 4).map((a) => ({
        id: a.id, thumbnailUrl: a.thumbnailUrl, previewVideoUrl: a.previewVideoUrl,
        frames: a.frames.length, firstFrame: a.frames[0] || ''
      }))
    };
  });

  // ── Pixabay: the avatar must be gone ──────────────────────────────────────
  console.log('\n=== Pixabay ===');
  for (const a of got.pixabay) {
    console.log(`  ${a.id}  ${a.thumbnailUrl.slice(0, 76)}`);
  }
  check('Pixabay returned candidates', got.pixabay.length > 0, got.pixabay.length);
  // /user/ is the avatar path on the Pixabay CDN; /video/ is the clip's own.
  check('no thumbnail is an uploader avatar',
        got.pixabay.every((a) => a.thumbnailUrl.indexOf('/user/') < 0),
        got.pixabay.filter((a) => a.thumbnailUrl.indexOf('/user/') >= 0));
  check('every thumbnail is the clip\'s own frame',
        got.pixabay.every((a) => /\/video\/.+\.(jpg|jpeg|png)$/i.test(a.thumbnailUrl)),
        got.pixabay.map((a) => a.thumbnailUrl));
  check('none is empty', got.pixabay.every((a) => !!a.thumbnailUrl), got.pixabay);
  check('a small video is carried for lazy frame extraction',
        got.pixabay.every((a) => /\.mp4$/i.test(a.previewVideoUrl)),
        got.pixabay.map((a) => a.previewVideoUrl));

  // ── Pexels: the provider's own frames survive normalisation ───────────────
  console.log('\n=== Pexels ===');
  for (const a of got.pexels) {
    console.log(`  ${a.id}  ${a.frames} frame(s)  first: ${a.firstFrame.slice(0, 66)}`);
  }
  check('Pexels returned candidates', got.pexels.length > 0, got.pexels.length);
  check('its preview frames are preserved',
        got.pexels.every((a) => a.frames >= 2), got.pexels.map((a) => a.frames));
  check('and they are real frame URLs',
        got.pexels.every((a) => /pictures\/preview-\d+\.jpe?g/i.test(a.firstFrame)),
        got.pexels.map((a) => a.firstFrame));

  // ── The image actually reaches the evaluator ──────────────────────────────
  console.log('\n=== what the evaluator would be handed ===');
  const handed = await page.evaluate(async () => {
    const S = window.StockMedia;
    const results = await S.search({ queries: ['concert stage lights crowd'],
      orientation: 'landscape', mediaType: 'video', minimumDuration: 3, provider: 'modern' });
    // The evaluator's own choice of picture, without calling the model.
    return results.slice(0, 5).map((a) => ({
      who: `${a.provider}:${a.id}`,
      picture: a.thumbnailUrl || a.previewUrl || ''
    }));
  });
  for (const h of handed) console.log(`  ${h.who.padEnd(18)} ${h.picture.slice(0, 72)}`);
  check('no avatar reaches the evaluator',
        handed.every((h) => h.picture.indexOf('/user/') < 0), handed);
  check('every candidate has a picture to inspect',
        handed.every((h) => !!h.picture), handed);

  // ── The source is fixed, not merely detected ──────────────────────────────
  const src = fs.readFileSync(PROJECT + '/public/adapters/stock-media.js', 'utf8');
  const code = src.split('\n').map((l) => { const i = l.indexOf('//'); return i >= 0 ? l.slice(0, i) : l; }).join('\n');
  console.log('');
  check('userImageURL is not read anywhere in the parser', code.indexOf('userImageURL') < 0);
  check('picture_id is not read either', code.indexOf('picture_id') < 0);

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'THE IMAGE IS THE CLIP'));
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
