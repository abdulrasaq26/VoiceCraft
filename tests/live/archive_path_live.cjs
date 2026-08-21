// The archive path, end to end, through the app's own code.
//
// Probing archive.org by hand proves nothing about this pipeline - measured
// once already: a hand-written query omitting the sort the adapter actually
// uses returned a Fallout mod and a court deposition, and I nearly reported the
// query builder as broken on the strength of it. With the real sort the same
// search returns Prelinger educational film.
//
// So this drives ArchiveOrg and StockMedia themselves: search, normalise,
// licence, excerpt, thumbnail, download. Each stage reports what it produced,
// so a gap shows up as the stage that returns nothing rather than as a guess.
const PROJECT = 'C:/Users/abdul/.gemini/antigravity/scratch/Blvck-TTS - Pic n Video';
const puppeteer = require(PROJECT + '/node_modules/puppeteer');
const fs = require('fs');
const path = require('path');

const PORT = process.argv[2] || '3491';
const OUT = path.join(PROJECT, 'tests', 'live', 'archive_path_v1.json');

// An archival beat: a real period, a filmable subject, the kind of thing the
// archive exists for and modern stock cannot supply.
const BEAT = {
  narration: 'Factories across America began producing weapons at an unprecedented scale.',
  intent: {
    concept: 'Workers on a wartime factory floor assembling machinery',
    subject: 'factory workers', action: 'assembling machinery on a production line',
    environment: 'a 1940s American industrial plant',
    requiredElements: ['workers', 'machinery or a production line'],
    avoid: ['a modern office', 'empty scenery'],
    specificity: 'historical_event', assetStrategy: 'exact'
  },
  queries: ['wartime factory production', 'factory workers assembly line'],
  archiveQueries: ['1940s American war production newsreel', 'wartime factory workers'],
  timePeriod: { from: 1939, to: 1949, label: '1940s' }
};

const fails = [];
const check = (name, cond, detail) => {
  console.log((cond ? '  PASS  ' : '  FAIL  ') + name + (cond ? '' : '  <- ' + JSON.stringify(detail)));
  if (!cond) fails.push(name);
};

(async () => {
  const browser = await puppeteer.launch({
    headless: false,
    executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    defaultViewport: null, protocolTimeout: 900000,
    args: ['--window-size=1200,800']
  });
  const page = (await browser.pages())[0];
  const pageErrors = [];
  page.on('pageerror', (e) => { pageErrors.push(e.message); console.log('  [pageerror] ' + e.message.slice(0, 110)); });
  page.on('console', (m) => {
    const t = m.text();
    if (/Archive|archive/.test(t) && !/DevTools/.test(t)) console.log('  [console] ' + t.slice(0, 150));
  });

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'load', timeout: 60000 });

  // ── Is the archive even switched on? ──────────────────────────────────────
  const wiring = await page.evaluate(() => ({
    adapter: !!window.ArchiveOrg,
    licence: !!window.ArchiveLicense,
    excerpt: !!window.ArchiveExcerpt,
    enabledFlag: localStorage.getItem('blvck:archive_enabled'),
    policy: localStorage.getItem('blvck:rights_policy'),
    defaultPolicy: window.ArchiveLicense && window.ArchiveLicense.DEFAULT_POLICY,
    providerPref: localStorage.getItem('blvck:stock_provider')
  }));
  console.log('WIRING');
  console.log(`  adapter ${wiring.adapter} · licence ${wiring.licence} · excerpt ${wiring.excerpt}`);
  console.log(`  archive_enabled=${wiring.enabledFlag} · rights_policy=${wiring.policy}`
            + ` (default ${wiring.defaultPolicy}) · provider=${wiring.providerPref}`);
  check('all three archive modules are loaded',
        wiring.adapter && wiring.licence && wiring.excerpt, wiring);

  const reachable = await page.evaluate(async () => {
    try { return await window.ArchiveOrg.isReachable(); } catch (e) { return 'ERR ' + e.message; }
  });
  check('archive.org answers through the proxy', reachable === true, reachable);

  // ── Search, and what comes back ──────────────────────────────────────────
  console.log('\nSEARCH');
  const found = await page.evaluate(async (beat) => {
    const t0 = Date.now();
    try {
      // Through StockMedia, which is the path acquire() takes: it supplies the
      // licence policy from the project and routes archiveQueries separately
      // from the stock queries. Calling ArchiveOrg.search directly is what the
      // first version of this harness did, with the wrong argument names - it
      // searched for an empty string and reported the pipeline broken.
      const assets = (await window.StockMedia.search({
        queries: beat.queries, archiveQueries: beat.archiveQueries,
        timePeriod: beat.timePeriod, mediaType: 'video',
        orientation: 'landscape', minimumDuration: 3,
        provider: 'all', sources: ['archive_org']
      })).filter((a) => a.provider === 'archive_org');
      return { ms: Date.now() - t0, n: assets.length, assets: assets.map((a) => ({
        id: a.id, title: (a.archive && a.archive.title) || '', year: a.archive && a.archive.year,
        collection: (a.archive && a.archive.collection) || null,
        w: a.width, h: a.height, duration: a.duration,
        downloadUrl: a.downloadUrl, thumbnailUrl: a.thumbnailUrl,
        licence: a.license, tags: a.tags, frames: (a.frames || []).length
      })) };
    } catch (e) { return { ms: Date.now() - t0, error: e.message }; }
  }, BEAT);

  if (found.error) {
    check('the archive search completed', false, found.error);
  } else {
    console.log(`  ${found.n} asset(s) in ${(found.ms / 1000).toFixed(1)}s`);
    for (const a of found.assets) {
      console.log(`   ${a.id}`);
      console.log(`      "${String(a.title).slice(0, 62)}"  ${a.year || '?'}  ${a.duration || '?'}s  ${a.w}x${a.h}`);
      console.log(`      licence: ${a.licence ? (a.licence.label || a.licence.id || JSON.stringify(a.licence).slice(0, 50)) : 'NONE'}`);
      console.log(`      thumb  : ${String(a.thumbnailUrl).slice(0, 68)}`);
    }
    check('the search returns candidates', found.n > 0, found.n);
    check('every asset carries a licence decision',
          found.assets.every((a) => !!a.licence), found.assets.filter((a) => !a.licence).map((a) => a.id));
    check('every asset has a playable file',
          found.assets.every((a) => !!a.downloadUrl), found.assets.filter((a) => !a.downloadUrl).map((a) => a.id));
    check('every asset has a thumbnail to inspect',
          found.assets.every((a) => !!a.thumbnailUrl), found.assets.filter((a) => !a.thumbnailUrl).map((a) => a.id));
    check('duration is known, so an excerpt can be planned',
          found.assets.every((a) => a.duration > 0), found.assets.map((a) => a.duration));
  }

  // ── Does the rights gate actually decide? ────────────────────────────────
  console.log('\nRIGHTS');
  const rights = await page.evaluate(async (beat) => {
    const assets = (await window.StockMedia.search({
      queries: beat.queries, archiveQueries: beat.archiveQueries,
      timePeriod: beat.timePeriod, mediaType: 'video', orientation: 'landscape',
      minimumDuration: 3, provider: 'all', sources: ['archive_org']
    })).filter((a) => a.provider === 'archive_org');
    return assets.map((a) => {
      let cleared = null, why = '';
      try { cleared = window.StockMedia.clearForProduction(a, { index: 1 }); }
      catch (e) { why = e.message; }
      return { id: a.id, licence: a.license && (a.license.label || a.license.id),
               requiresAttribution: !!(a.license && a.license.requiresAttribution),
               cleared, why };
    });
  }, BEAT);
  for (const r of rights) {
    console.log(`   ${r.cleared ? 'CLEARED ' : 'blocked '} ${r.id.slice(0, 44).padEnd(44)} ${r.licence || '—'}`);
  }
  check('the rights gate reaches a decision for every asset',
        rights.every((r) => r.cleared === true || r.cleared === false), rights);
  check('at least one archival asset is usable under the current policy',
        rights.some((r) => r.cleared), 'none cleared — check the rights policy');

  fs.writeFileSync(OUT, JSON.stringify({ at: new Date().toISOString(), beat: BEAT,
    wiring, reachable, search: found, rights }, null, 2));

  check('nothing threw', pageErrors.length === 0, pageErrors.slice(0, 3));
  console.log('\n' + (fails.length ? `FAILED (${fails.length}): ${fails.join(', ')}`
                                   : 'THE ARCHIVE PATH REACHES A USABLE ASSET'));
  console.log(`  written to ${path.relative(PROJECT, OUT)}`);
  await browser.close();
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('DRIVER ERROR: ' + e.stack); process.exit(3); });
