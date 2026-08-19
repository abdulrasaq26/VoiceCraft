// Internet Archive as an archival footage source.
//
// This is not a third stock library. Pixabay and Pexels answer "show me a
// person using a laptop"; the archive answers "show me what a 1940s factory
// floor actually looked like". Its value is authenticity, and its cost is that
// every item has to be checked for rights (see archive-license.js) and picked
// apart to find a usable video file.
//
// Three archive quirks drive the code below:
//
//   1. An item is a folder, not a clip. One identifier can hold twenty files:
//      several video encodes, an mp3, subtitles, OCR text, thumbnails.
//   2. Format names lie about quality. On a real item, "HiRes MPEG4" is
//      320x240 while plain "h.264" is 640x480. Selection has to go by the
//      declared width and height, never by the name.
//   3. Items are whole films. A Pexels clip is ten seconds; an archive
//      newsreel is eleven minutes, and the caller wants an excerpt.
(() => {
  'use strict';

  const PROXY = '/api/proxy/archive';

  /**
   * How long a search or metadata call may take before it is abandoned.
   *
   * Generous — the archive is often slow rather than broken — but finite, so a
   * connection that is never going to answer cannot stall the whole run.
   */
  const REQUEST_TIMEOUT_MS = 45000;

  // Formats worth considering, best first. Anything not listed is ignored —
  // which is how PDFs, OCR text, torrents and subtitle files stay out.
  const VIDEO_FORMATS = [
    'h.264', 'h.264 hd', 'mpeg4', '512kb mpeg4', 'hires mpeg4',
    '256kb mpeg4', 'ogg video', 'webm', 'matroska', 'mpeg2', 'divx'
  ];
  const PHOTO_FORMATS = ['jpeg', 'jpg', 'png', 'tiff', 'item image'];

  // Never a scene visual, whatever else the item contains.
  const NEVER = [
    'metadata', 'archive bitTorrent', 'archive torrent', 'subrip',
    'web video text tracks', 'thumbnail', 'item tile', 'animated gif',
    'text', 'djvutxt', 'abbyy gz', 'chocr', 'hocr', 'ocr page index',
    'single page processed jp2 zip', 'unknown', 'intermediate asr json',
    'whisper asr json', 'log', 'json'
  ];

  function isNever(format) {
    const f = String(format || '').toLowerCase();
    return NEVER.some((n) => f === n || f.startsWith(n));
  }

  // ── Duration parsing ──────────────────────────────────────────────────────
  // `length` arrives either as seconds ("684.19") or as a clock ("11:24").
  function parseLength(value) {
    const raw = String(value == null ? '' : value).trim();
    if (!raw) return 0;
    if (raw.includes(':')) {
      const parts = raw.split(':').map(Number);
      if (parts.some(Number.isNaN)) return 0;
      return parts.reduce((acc, p) => acc * 60 + p, 0);
    }
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  }

  // ── Rate limiting ─────────────────────────────────────────────────────────
  //
  // archive.org is a donated-funds library, not a commercial API, and planning
  // one storyboard can mean dozens of calls: a search per query, then a
  // metadata fetch per candidate. Left alone those fan out in parallel and
  // arrive as a burst.
  //
  // These numbers are a deliberately cautious guess, not a quote from the
  // published policy — archive.org's developer docs were unreachable (502)
  // when this was written, so nothing here should be read as "the documented
  // limit". Being slower than required costs a few seconds per storyboard;
  // being faster than allowed costs the service, and eventually our access.
  const MIN_INTERVAL_MS = 350;   // one request at a time, spaced out
  let chain = Promise.resolve();
  let lastStart = 0;

  function schedule(task) {
    // A promise chain rather than a counter: it serialises every caller,
    // including the parallel search fan-out in stock-media.js.
    const run = chain.then(async () => {
      const wait = Math.max(0, MIN_INTERVAL_MS - (Date.now() - lastStart));
      if (wait) await new Promise((r) => setTimeout(r, wait));
      lastStart = Date.now();
      return task();
    });
    // Keep the chain alive after a failure, or one error stalls every
    // subsequent request forever.
    chain = run.then(() => {}, () => {});
    return run;
  }

  // ── Transport ─────────────────────────────────────────────────────────────
  // archive.org answers 502 under load often enough that a single failure
  // means nothing. Retry briefly before giving up on an item.
  async function fetchJson(path, { retries = 2 } = {}) {
    let lastErr;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        // Bounded, because archive.org sometimes accepts a connection and then
        // never answers. Retries and backoff do not help there: the request
        // simply never settles, so the whole acquisition hangs behind it and
        // the fallback hierarchy below it never runs. Measured: an acquisition
        // sat for 40 minutes and only ended when the harness gave up.
        const res = await schedule(() => fetch(`${PROXY}${path}`, {
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        }));

        // Being told to slow down is an instruction, not an error to retry
        // through at the same pace.
        if (res.status === 429 || res.status === 503) {
          const after = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
          const backoff = Number.isFinite(after) && after > 0
            ? Math.min(after * 1000, 30000)
            : 2000 * (attempt + 1);
          lastErr = new Error(`archive.org asked us to slow down (HTTP ${res.status})`);
          if (attempt < retries) { await new Promise((r) => setTimeout(r, backoff)); continue; }
          throw lastErr;
        }

        const text = await res.text();
        if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 120)}`);
        if (!text.trim()) throw new Error('empty response');
        return JSON.parse(text);
      } catch (err) {
        lastErr = err;
        if (attempt < retries) await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
      }
    }
    throw lastErr;
  }

  // ── Search ────────────────────────────────────────────────────────────────

  function buildQuery(query, { mediaType, timePeriod, licensePolicy }) {
    const terms = [`(${escapeQuery(query)})`];
    terms.push(mediaType === 'photo' ? 'mediatype:(image)' : 'mediatype:(movies)');

    // The rights filter. Applied here rather than after the fact so the result
    // budget is spent on items that could actually be used.
    terms.push(window.ArchiveLicense.searchFilter(licensePolicy || {}));

    // Date narrowing, only when the script actually established a period.
    // Never invented — a wrong date is worse than no date.
    if (timePeriod && Number.isFinite(timePeriod.from) && Number.isFinite(timePeriod.to)) {
      terms.push(`year:[${timePeriod.from} TO ${timePeriod.to}]`);
    }
    return terms.join(' AND ');
  }

  // Lucene syntax leaking out of a narration line would break the search or,
  // worse, silently change what it means.
  function escapeQuery(q) {
    return String(q || '').replace(/[+\-&|!(){}\[\]^"~*?:\\/]/g, ' ').replace(/\s+/g, ' ').trim();
  }

  async function searchItems({ query, mediaType = 'video', rows = 12, timePeriod = null, licensePolicy = {} }) {
    const params = new URLSearchParams();
    params.set('q', buildQuery(query, { mediaType, timePeriod, licensePolicy }));
    ['identifier', 'title', 'description', 'licenseurl', 'rights', 'year',
     'date', 'creator', 'collection', 'downloads', 'item_size']
      .forEach((f) => params.append('fl[]', f));
    params.set('rows', String(rows));
    params.set('page', '1');
    // Popularity is a decent proxy for "watchable" in an archive full of
    // unwatchable scans.
    params.set('sort[]', 'downloads desc');
    params.set('output', 'json');

    const data = await fetchJson(`/advancedsearch.php?${params.toString()}`);
    return (data && data.response && data.response.docs) || [];
  }

  // ── File selection ────────────────────────────────────────────────────────

  function scoreFile(file, wanted) {
    const format = String(file.format || '').toLowerCase();
    if (isNever(format)) return -1;

    const list = wanted === 'photo' ? PHOTO_FORMATS : VIDEO_FORMATS;
    const rank = list.indexOf(format);
    if (rank === -1) return -1;

    const width = Number(file.width || 0);
    const height = Number(file.height || 0);
    const pixels = width * height;

    // Resolution first, format preference only as a tie-break. This is what
    // stops "HiRes MPEG4" at 320x240 beating "h.264" at 640x480.
    let score = 0;
    if (pixels >= 1920 * 1080) score += 100;
    else if (pixels >= 1280 * 720) score += 80;
    else if (pixels >= 640 * 480) score += 55;
    else if (pixels > 0) score += 20;
    else score += 10;                       // unstated: might be fine, might not

    score += Math.max(0, 12 - rank * 2);

    // Enormous files are a bad trade for a few seconds of screen time.
    const size = Number(file.size || 0);
    if (size > 600 * 1024 * 1024) score -= 40;
    else if (size > 250 * 1024 * 1024) score -= 15;

    return score;
  }

  function pickFile(files, wanted) {
    let best = null;
    let bestScore = 0;
    for (const file of files || []) {
      const score = scoreFile(file, wanted);
      if (score > bestScore) { best = file; bestScore = score; }
    }
    return best;
  }

  // ── Normalisation into the StockAsset shape ───────────────────────────────

  function toAsset(doc, meta, file, wanted) {
    const identifier = String(doc.identifier || (meta.metadata && meta.metadata.identifier) || '');
    const m = (meta && meta.metadata) || {};
    const license = window.ArchiveLicense.classify({
      licenseurl: m.licenseurl || doc.licenseurl,
      rights: m.rights || doc.rights,
      'possible-copyright-status': m['possible-copyright-status'],
      collection: m.collection || doc.collection
    });

    const width = Number(file.width || 0);
    const height = Number(file.height || 0);
    const encoded = encodeURIComponent(identifier);
    const downloadUrl = `${PROXY}/download/${encoded}/${encodeURIComponent(file.name)}`;

    return {
      provider: 'archive_org',
      id: identifier,
      type: wanted === 'photo' ? 'photo' : 'video',
      downloadUrl,
      previewUrl: downloadUrl,
      thumbnailUrl: `${PROXY}/services/img/${encoded}`,
      width,
      height,
      duration: parseLength(file.length),
      orientation: deriveOrientation(width, height),
      tags: collectionsOf(m.collection || doc.collection),
      sourceUrl: `https://archive.org/details/${identifier}`,

      // Archive-only fields. The base StockAsset has no room for provenance
      // because Pixabay and Pexels do not need any — here it is the point.
      archive: {
        identifier,
        file: file.name,
        format: file.format,
        title: String(doc.title || m.title || identifier),
        description: String(doc.description || m.description || '').slice(0, 400),
        creator: String(doc.creator || m.creator || ''),
        date: String(doc.date || m.date || doc.year || m.year || ''),
        collections: collectionsOf(m.collection || doc.collection),
        // Whole films, not clips: the caller needs to know it must excerpt.
        isLongForm: parseLength(file.length) > 90
      },
      license
    };
  }

  function collectionsOf(collection) {
    if (!collection) return [];
    return (Array.isArray(collection) ? collection : [collection]).map(String);
  }

  function deriveOrientation(w, h) {
    if (!w || !h) return 'landscape';
    const r = w / h;
    if (r > 1.2) return 'landscape';
    if (r < 0.85) return 'portrait';
    return 'square';
  }

  // ── Public search ─────────────────────────────────────────────────────────

  /**
   * Search the archive and return usable, rights-cleared assets.
   *
   * Metadata is fetched per item, so `maxItems` is a real cost. Search returns
   * candidates ordered by popularity; we inspect the top few rather than all.
   */
  async function search({
    query,
    mediaType = 'video',
    timePeriod = null,
    maxItems = 6,
    licensePolicy = {}
  }) {
    const docs = await searchItems({ query, mediaType, rows: maxItems * 3, timePeriod, licensePolicy });
    if (!docs.length) return [];

    const assets = [];
    for (const doc of docs) {
      if (assets.length >= maxItems) break;

      // A cheap pre-filter on the search document. Saves a metadata round trip
      // for anything already visibly unusable.
      const quick = window.ArchiveLicense.classify({
        licenseurl: doc.licenseurl, rights: doc.rights, collection: doc.collection
      });
      if (quick.tier === 'restricted') continue;

      let meta;
      try {
        meta = await fetchJson(`/metadata/${encodeURIComponent(doc.identifier)}`);
      } catch (err) {
        console.warn(`[ArchiveOrg] metadata ${doc.identifier}: ${err.message}`);
        continue;
      }
      if (!meta || !Array.isArray(meta.files)) continue;

      // Re-classify against full metadata: the search index is a summary and
      // can lack the licence the item itself declares.
      const full = window.ArchiveLicense.classify({
        licenseurl: (meta.metadata || {}).licenseurl || doc.licenseurl,
        rights: (meta.metadata || {}).rights,
        'possible-copyright-status': (meta.metadata || {})['possible-copyright-status'],
        collection: (meta.metadata || {}).collection || doc.collection
      });
      if (!window.ArchiveLicense.isUsable(full, licensePolicy)) continue;

      const file = pickFile(meta.files, mediaType);
      if (!file) continue;   // an item with no usable video is not a result

      assets.push(toAsset(doc, meta, file, mediaType));
    }
    return assets;
  }

  // Metadata, memoised for the session. The excerpt analyser needs the same
  // payload the search already fetched, and re-requesting it would double our
  // traffic against a service we are deliberately being gentle with.
  const metaCache = new Map();

  async function itemMetadata(identifier) {
    const key = String(identifier || '');
    if (!key) throw new Error('no identifier');
    if (metaCache.has(key)) return metaCache.get(key);
    const meta = await fetchJson(`/metadata/${encodeURIComponent(key)}`);
    metaCache.set(key, meta);
    return meta;
  }

  async function isReachable() {
    try {
      await fetchJson('/advancedsearch.php?q=identifier:(nasa)&rows=0&output=json', { retries: 0 });
      return true;
    } catch (_) {
      return false;
    }
  }

  window.ArchiveOrg = {
    search,
    itemMetadata,
    isReachable,
    // exported for tests
    _internal: { pickFile, scoreFile, parseLength, buildQuery, escapeQuery, toAsset, schedule, MIN_INTERVAL_MS }
  };
})();
