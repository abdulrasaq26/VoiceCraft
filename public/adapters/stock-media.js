// Stock Media Provider Abstraction — AETHER Universal Video Engine
//
// Translates Director visual intent → API searches → normalized StockAssets →
// cached Blobs delivered to the renderer.
//
// Design decisions:
//   • The Director produces semantic concepts, NOT API queries. This module
//     builds and expands queries from those concepts.
//   • Results from Pixabay and Pexels are normalized to one StockAsset shape.
//     The rest of the app never sees provider-specific fields.
//   • Downloaded blobs are stored in IndexedDB keyed by "provider:id" so the
//     same asset is never downloaded twice in a project session.
//   • The fallback hierarchy (video → broader query → photo → text) lives here,
//     not in storyboard.js or ltx-video.js.
//   • Legacy AI generation is NOT part of this module's fallback chain.
//   • API keys are read from ProviderManager / localStorage and forwarded via
//     request headers to the server proxy — never embedded in client code.
//
// Public API: window.StockMedia
(() => {
  'use strict';

  // ── IndexedDB cache ────────────────────────────────────────────────────────

  const DB_NAME = 'blvck-stock-cache';
  const STORE   = 'assets';

  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB not available'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) {
          req.result.createObjectStore(STORE);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror   = () => reject(req.error);
    });
  }

  async function idbGet(key) {
    try {
      const db  = await idbOpen();
      const val = await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readonly');
        const rq = tx.objectStore(STORE).get(key);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror   = () => rej(rq.error);
      });
      db.close();
      return val;
    } catch { return null; }
  }

  async function idbPut(key, value) {
    try {
      const db = await idbOpen();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(value, key);
        tx.oncomplete = res;
        tx.onerror    = () => rej(tx.error);
      });
      db.close();
      return true;
    } catch { return false; }
  }

  // ── Normalized StockAsset shape ────────────────────────────────────────────
  // All code outside this file works with StockAssets only.

  function deriveOrientation(w, h) {
    if (!w || !h) return 'landscape';
    const r = w / h;
    if (r > 1.2)  return 'landscape';
    if (r < 0.85) return 'portrait';
    return 'square';
  }

  /**
   * The export height this project renders at.
   *
   * The editor stage is 1280x720 and the export resolution control offers no
   * more, so a file taller than this contributes nothing a viewer can see.
   */
  const EXPORT_HEIGHT = 720;

  /** The smallest variant that still covers the export, from a list sorted big to small. */
  function smallestSufficient(sortedDesc) {
    const sufficient = sortedDesc.filter((f) => (f.height || 0) >= EXPORT_HEIGHT);
    return sufficient.length ? sufficient[sufficient.length - 1] : null;
  }

  function makeAsset(opts) {
    const w = Number(opts.width  || 0);
    const h = Number(opts.height || 0);
    return {
      provider:     String(opts.provider     || 'unknown'),
      id:           String(opts.id           || ''),
      type:         opts.type === 'photo' ? 'photo' : 'video',
      downloadUrl:  String(opts.downloadUrl  || ''),
      previewUrl:   String(opts.previewUrl   || ''),
      thumbnailUrl: String(opts.thumbnailUrl || ''),
      width:        w,
      height:       h,
      duration:     Number(opts.duration     || 0),
      orientation:  opts.orientation || deriveOrientation(w, h),
      tags:         Array.isArray(opts.tags) ? opts.tags.map(String) : [],
      sourceUrl:    String(opts.sourceUrl    || '')
    };
  }

  // ── Key accessors ──────────────────────────────────────────────────────────
  // Keys are never embedded in code. They come from ProviderManager (which
  // reads localStorage) or directly from localStorage as a fallback.

  function getPixabayKey() {
    if (window.ProviderManager && window.ProviderManager.getActiveKey) {
      const k = window.ProviderManager.getActiveKey('pixabay');
      if (k) return k;
    }
    return localStorage.getItem('blvck:pixabay_key') || '';
  }

  function getPexelsKey() {
    if (window.ProviderManager && window.ProviderManager.getActiveKey) {
      const k = window.ProviderManager.getActiveKey('pexels');
      if (k) return k;
    }
    return localStorage.getItem('blvck:pexels_key') || '';
  }

  // ── PixabayProvider ────────────────────────────────────────────────────────

  async function pixabaySearch({ query, mediaType = 'video', pixabayOrientation = 'horizontal', perPage = 10 }) {
    const key = getPixabayKey();
    if (!key) throw new Error('Pixabay API key not configured');

    const isVideo   = mediaType !== 'photo';
    const endpoint  = isVideo ? '/api/proxy/pixabay/videos' : '/api/proxy/pixabay/photos';

    const params = { q: query, per_page: Math.min(Number(perPage) || 10, 20), safesearch: 'true' };
    if (pixabayOrientation && pixabayOrientation !== 'any') params.orientation = pixabayOrientation;
    if (!isVideo) params.image_type = 'photo';

    const res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-pixabay-key': key },
      body:    JSON.stringify(params),
      signal:  AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    });

    if (!res.ok) throw new Error(`Pixabay ${res.status}: ${await res.text().catch(() => '')}`);

    const data = await res.json();
    const hits  = Array.isArray(data.hits) ? data.hits : [];

    return hits.map(hit => {
      if (isVideo) {
        const vids   = hit.videos || {};
        const best   = vids.large  || vids.medium || vids.small || vids.tiny || {};
        const medium = vids.medium || vids.small  || vids.tiny  || best;
        // Pixabay video thumbnails come from Vimeo (picture_id is the Vimeo ID).
        const thumb  = hit.userImageURL || (hit.picture_id
          ? `https://i.vimeocdn.com/video/${hit.picture_id}_295x166.jpg`
          : '');
        return makeAsset({
          provider:     'pixabay',
          id:           String(hit.id),
          type:         'video',
          downloadUrl:  best.url    || '',
          previewUrl:   medium.url  || best.url || '',
          thumbnailUrl: thumb,
          width:        best.width  || 0,
          height:       best.height || 0,
          duration:     hit.duration || 0,
          tags:         String(hit.tags || '').split(',').map(t => t.trim()).filter(Boolean),
          sourceUrl:    hit.pageURL || ''
        });
      } else {
        return makeAsset({
          provider:     'pixabay',
          id:           String(hit.id),
          type:         'photo',
          downloadUrl:  hit.largeImageURL || hit.webformatURL || '',
          previewUrl:   hit.webformatURL  || '',
          thumbnailUrl: hit.previewURL    || '',
          width:        hit.imageWidth    || 0,
          height:       hit.imageHeight   || 0,
          duration:     0,
          tags:         String(hit.tags || '').split(',').map(t => t.trim()).filter(Boolean),
          sourceUrl:    hit.pageURL || ''
        });
      }
    }).filter(a => a.downloadUrl);
  }

  // ── PexelsProvider ─────────────────────────────────────────────────────────

  async function pexelsSearch({ query, mediaType = 'video', pexelsOrientation = 'landscape', perPage = 10 }) {
    const key = getPexelsKey();
    if (!key) throw new Error('Pexels API key not configured');

    const isVideo  = mediaType !== 'photo';
    const endpoint = isVideo ? '/api/proxy/pexels/videos' : '/api/proxy/pexels/photos';

    const params = { query, per_page: Math.min(Number(perPage) || 10, 15) };
    if (pexelsOrientation && pexelsOrientation !== 'any') params.orientation = pexelsOrientation;

    const res = await fetch(endpoint, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'x-pexels-key': key },
      body:    JSON.stringify(params),
      signal:  AbortSignal.timeout(SEARCH_TIMEOUT_MS)
    });

    if (!res.ok) throw new Error(`Pexels ${res.status}: ${await res.text().catch(() => '')}`);

    const data = await res.json();

    if (isVideo) {
      const videos = Array.isArray(data.videos) ? data.videos : [];
      return videos.map(v => {
        const files  = Array.isArray(v.video_files) ? v.video_files : [];
        const sorted = files.slice().sort((a, b) => (b.width * b.height) - (a.width * a.height));

        // The smallest file that still covers the export, not the largest
        // available.
        //
        // Taking sorted[0] meant downloading a 4K master to render a 1280x720
        // timeline: measured, one five-second beat was 31.4 MB and took 43.8s
        // on a 0.7 MB/s link, for detail thrown away at the first draw. The
        // queue sat at "0%" throughout, which is what a slow download looks
        // like from outside.
        //
        // Anything at or above the export height is equivalent once scaled, so
        // take the smallest of those. Falling back to the largest below it
        // keeps a clip whose only variants are small rather than rejecting it.
        const best = smallestSufficient(sorted) || sorted[0] || {};
        const preview = sorted[sorted.length - 1] || best;
        return makeAsset({
          provider:     'pexels',
          id:           String(v.id),
          type:         'video',
          downloadUrl:  best.link    || '',
          previewUrl:   preview.link || best.link || '',
          thumbnailUrl: v.image      || '',
          width:        best.width   || v.width  || 0,
          height:       best.height  || v.height || 0,
          duration:     v.duration   || 0,
          tags:         [], // Pexels v1 doesn't return tags on video results
          sourceUrl:    v.url || ''
        });
      }).filter(a => a.downloadUrl);
    } else {
      const photos = Array.isArray(data.photos) ? data.photos : [];
      return photos.map(p => {
        const src = p.src || {};
        return makeAsset({
          provider:     'pexels',
          id:           String(p.id),
          type:         'photo',
          downloadUrl:  src.original || src.large2x || src.large || '',
          previewUrl:   src.large    || src.medium  || '',
          thumbnailUrl: src.small    || '',
          width:        p.width  || 0,
          height:       p.height || 0,
          duration:     0,
          tags:         [],
          sourceUrl:    p.url || ''
        });
      }).filter(a => a.downloadUrl);
    }
  }

  // ── Orientation mapping ───────────────────────────────────────────────────
  // Different providers use different vocabulary; translate once here.

  // ── ArchiveProvider ────────────────────────────────────────────────────────
  // Delegates to the archive adapter, which does its own rights filtering.
  // Kept behind the same search() interface as the other two so acquire() has
  // one pipeline rather than a special case.

  function archiveEnabled() {
    if (!window.ArchiveOrg || !window.ArchiveLicense) return false;
    return localStorage.getItem('blvck:archive_enabled') !== 'false';   // on by default
  }

  function projectRightsPolicy() {
    return localStorage.getItem('blvck:rights_policy')
        || (window.ArchiveLicense && window.ArchiveLicense.DEFAULT_POLICY)
        || 'cleared_plus_by';
  }

  function archivePolicy() {
    const p = window.ArchiveLicense ? window.ArchiveLicense.policy(projectRightsPolicy()) : {};
    return {
      allowAttribution: !!p.allowAttribution,
      allowTrustedCollections: localStorage.getItem('blvck:archive_trusted_collections') !== 'false'
    };
  }

  function _legacyArchivePolicy() {
    return {
      // CC-BY is monetisable but demands a credit, so it stays off until the
      // user accepts that. Restricted and unknown are never opened.
      allowAttribution: localStorage.getItem('blvck:archive_allow_attribution') === 'true',
      allowTrustedCollections: localStorage.getItem('blvck:archive_trusted_collections') !== 'false'
    };
  }

  async function archiveSearch({ query, mediaType = 'video', timePeriod = null, perPage = 6 }) {
    return window.ArchiveOrg.search({
      query,
      mediaType,
      timePeriod,
      maxItems: Math.min(perPage, 6),
      licensePolicy: archivePolicy()
    });
  }

  function toPixabayOrientation(o) {
    if (o === 'portrait') return 'vertical';
    if (o === 'square')   return 'any';
    return 'horizontal'; // landscape is the default
  }

  function toPexelsOrientation(o) {
    if (o === 'portrait') return 'portrait';
    if (o === 'square')   return 'square';
    return 'landscape';
  }

  // ── StockMediaSearch ──────────────────────────────────────────────────────
  // Fans out all queries across all configured providers concurrently.

  async function search({
    queries = [], orientation = 'landscape', mediaType = 'video',
    minimumDuration = 3, perPage = 8, provider = 'all',
    // The Director decides which sources suit the beat. `sources` is the
    // allow-list for this search; archiveQueries are separate because the
    // phrasing that finds a newsreel is not the phrasing that finds b-roll.
    sources = null, archiveQueries = [], timePeriod = null
  } = {}) {
    if (!queries.length && !archiveQueries.length) return [];

    const pixabayOrientation = toPixabayOrientation(orientation);
    const pexelsOrientation  = toPexelsOrientation(orientation);

    const allowed = (name) => {
      // 'modern' is the two commercial stock libraries and nothing else. It
      // exists because "Pixabay + Pexels" was previously spelled 'all', which
      // also let the archive through — so a producer who wanted to exclude
      // archival footage had no way to say so, and one who thought they had
      // excluded it had not.
      if (provider === 'modern') {
        if (name === 'archive_org') return false;
      } else if (provider !== 'all' && provider !== name) {
        return false;
      }
      if (Array.isArray(sources) && sources.length) return sources.includes(name);
      return true;
    };

    const tasks = [];
    const hasPixabay = !!getPixabayKey() && allowed('pixabay');
    const hasPexels  = !!getPexelsKey() && allowed('pexels');
    const hasArchive = archiveEnabled() && allowed('archive_org');

    if (hasArchive) {
      // Archive searches are expensive — a metadata round trip per candidate —
      // so only the archive-specific queries run, and only a couple of them.
      const aq = (archiveQueries.length ? archiveQueries : queries).slice(0, 3);
      for (const query of aq) {
        if (!String(query || '').trim()) continue;
        tasks.push(
          archiveSearch({ query: String(query).trim(), mediaType, timePeriod, perPage })
            .catch(err => { console.warn(`[StockMedia] Archive "${query}": ${err.message}`); return []; })
        );
      }
    }

    for (const query of queries) {
      if (!String(query || '').trim()) continue;
      const q = String(query).trim();

      if (hasPixabay) {
        if (mediaType !== 'photo') {
          tasks.push(
            pixabaySearch({ query: q, mediaType: 'video', pixabayOrientation, perPage })
              .catch(err => { console.warn(`[StockMedia] Pixabay video "${q}": ${err.message}`); return []; })
          );
        }
        if (mediaType !== 'video') {
          tasks.push(
            pixabaySearch({ query: q, mediaType: 'photo', pixabayOrientation, perPage })
              .catch(err => { console.warn(`[StockMedia] Pixabay photo "${q}": ${err.message}`); return []; })
          );
        }
      }

      if (hasPexels) {
        if (mediaType !== 'photo') {
          tasks.push(
            pexelsSearch({ query: q, mediaType: 'video', pexelsOrientation, perPage })
              .catch(err => { console.warn(`[StockMedia] Pexels video "${q}": ${err.message}`); return []; })
          );
        }
        if (mediaType !== 'video') {
          tasks.push(
            pexelsSearch({ query: q, mediaType: 'photo', pexelsOrientation, perPage })
              .catch(err => { console.warn(`[StockMedia] Pexels photo "${q}": ${err.message}`); return []; })
          );
        }
      }
    }

    if (!tasks.length) return [];

    const settled = await Promise.allSettled(tasks);
    const all     = settled.flatMap(r => r.status === 'fulfilled' ? r.value : []);

    // Deduplicate by provider:id (same clip might appear in multiple query results).
    const seen   = new Set();
    const unique = all.filter(a => {
      const k = `${a.provider}:${a.id}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Filter videos that are too short to cover the beat.
    return unique.filter(a => a.type !== 'video' || a.duration >= minimumDuration);
  }

  // ── StockMediaRanker ──────────────────────────────────────────────────────

  function scoreAsset(asset, {
    orientation = 'landscape', mediaType = 'video',
    minimumDuration = 3, targetDuration = 8,
    // How much the beat wants authenticity over polish.
    strategy = 'auto', preferredSources = null
  } = {}, usedIds) {
    let score = 100;

    // ── Source intent ───────────────────────────────────────────────────────
    // A 1940s newsreel is grainy, 640x480 and badly lit. Judged on resolution
    // alone it loses to any modern clip — so for a beat that asked for
    // archival material, authenticity has to outweigh the picture quality it
    // costs. And for a beat about a modern coffee shop, archive footage is
    // simply the wrong answer however good it looks.
    const isArchive = asset.provider === 'archive_org';
    if (Array.isArray(preferredSources) && preferredSources.length) {
      const rank = preferredSources.indexOf(asset.provider);
      if (rank === 0) score += 45;
      else if (rank > 0) score += 20;
      else score -= 30;
    }
    if (isArchive) {
      if (strategy === 'archival' || strategy === 'archive_preferred') score += 60;
      else if (strategy === 'modern_stock') score -= 70;
    }

    // Attribution-required material is usable but costs the creator a credit,
    // so a public-domain clip of equal merit should win.
    if (asset.license && asset.license.requiresAttribution) score -= 8;

    // Already-used penalty — avoid identical clips within one video.
    if (usedIds && usedIds.has(`${asset.provider}:${asset.id}`)) score -= 80;

    // Media type preference.
    if (mediaType === 'video' && asset.type === 'photo') score -= 25;
    if (mediaType === 'photo' && asset.type === 'video') score -= 5;

    // Orientation match.
    //
    // The mismatch penalty is heavy on purpose. A portrait clip in a landscape
    // timeline cannot be shown whole without bars down both sides, and cannot
    // be shown full-bleed without throwing away two thirds of the picture -
    // there is no good outcome, only a choice of which one to lose. At -15 a
    // portrait clip with a convenient duration still won on total score, which
    // is how vertical footage reached the timeline at all. It stays a
    // preference rather than a filter: when a beat has no landscape candidate,
    // the wrong shape still beats no footage.
    if (orientation !== 'any') {
      if (asset.orientation === orientation) score += 20;
      else if (asset.orientation === 'square') score -= 25;
      else score -= 45;
    }

    // Duration scoring for video assets.
    if (asset.type === 'video') {
      if (asset.duration < minimumDuration) {
        score -= 40; // Clip is too short to cover the scene — hard penalty.
      } else {
        const surplus = asset.duration - targetDuration;
        if (surplus >= 0 && surplus <= 15) score += 10; // Sweet spot: covers beat with room to trim.
        if (surplus > 30) score -= 5;                   // Unnecessarily long clip.
      }
    }

    // Resolution quality. Archive material is judged on a different curve:
    // period footage is 640x480 because that is what survives, and penalising
    // it for that would mean never choosing the authentic clip.
    const px = asset.width * asset.height;
    if (isArchive) {
      if (px >= 1280 * 720) score += 8;
      else if (px >= 640 * 480) score += 4;
      else if (px > 0 && px < 320 * 240) score -= 10;
    } else {
      if (px >= 1920 * 1080) score += 12;
      else if (px >= 1280 * 720) score += 6;
      else if (px < 640 * 480)   score -= 20;
    }

    return score;
  }

  function rank(assets, requirements = {}, usedIds) {
    return assets
      .map(a => ({ asset: a, score: scoreAsset(a, requirements, usedIds) }))
      .sort((a, b) => b.score - a.score)
      .map(x => x.asset);
  }

  // ── Cache meta (localStorage manifest, actual blobs in IDB) ───────────────

  const CACHE_META_KEY = 'blvck:stock-cache-meta';

  function getCacheMeta() {
    try {
      const v = JSON.parse(localStorage.getItem(CACHE_META_KEY) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch { return {}; }
  }

  function setCacheMeta(meta) {
    try { localStorage.setItem(CACHE_META_KEY, JSON.stringify(meta)); } catch {}
  }

  // ── Asset download ────────────────────────────────────────────────────────
  // Downloads via the server-side CDN proxy (handles CORS from stock CDNs).
  // Caches the result in IDB so we never download the same asset twice.

  // An archival film runs to tens of megabytes, and export refuses to record
  // until it is cached — so a download with no visible progress looks like a
  // hang at exactly the moment the user is waiting to start production.
  //
  // Events rather than a callback: the storyboard, the editor and any future
  // panel all want this, and threading a callback through acquire() and its
  // fallback chain would mean every caller re-deciding what to do with it.
  function emit(name, detail) {
    try { window.dispatchEvent(new CustomEvent(name, { detail })); } catch (e) { /* non-fatal */ }
  }

  async function readWithProgress(res, cacheKey, asset) {
    const total = Number(res.headers.get('content-length')) || 0;
    const base = { cacheKey, provider: asset.provider, id: asset.id, total };

    // No length or no stream support: still say it started and finished, just
    // without a percentage. A spinner that never moves beats a silent wait.
    if (!total || !res.body || !res.body.getReader) {
      emit('blvck:asset-progress', Object.assign({}, base, { received: 0, pct: null }));
      const blob = await res.blob();
      emit('blvck:asset-progress',
        Object.assign({}, base, { received: blob.size, pct: 100, done: true }));
      return blob;
    }

    const reader = res.body.getReader();
    const parts = [];
    let received = 0;
    let lastEmit = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parts.push(value);
      received += value.length;
      // Throttled: a 90 MB file arrives in thousands of chunks and re-rendering
      // a card for each one costs more than the download.
      const now = Date.now();
      if (now - lastEmit > 250) {
        lastEmit = now;
        emit('blvck:asset-progress', Object.assign({}, base, {
          received, pct: Math.round((received / total) * 100)
        }));
      }
    }
    emit('blvck:asset-progress', Object.assign({}, base, { received, pct: 100, done: true }));

    // A truncated transfer decodes as a shorter film rather than an error, which
    // is how a silently wrong excerpt gets into a finished video.
    if (received < total) {
      throw new Error(`Download of ${cacheKey} stopped at ${received} of ${total} bytes`);
    }
    return new Blob(parts, { type: res.headers.get('content-type') || 'application/octet-stream' });
  }

  /**
   * How long a provider search may take.
   *
   * Bounded for the same reason the download is: an unanswered request never
   * fails, so the caller never falls through to the next provider or the next
   * level, and the queue sits at 0% indefinitely. A search returns a page of
   * JSON, so ten seconds is already slow.
   */
  const SEARCH_TIMEOUT_MS = 20000;

  /**
   * How long one media download may take.
   *
   * Archival masters run to tens of megabytes and the archive is not fast, so
   * this is deliberately roomy. It exists to bound failure, not to enforce
   * speed: a stalled transfer must end as a failed candidate the caller can
   * step past, rather than as a run that never finishes.
   */
  const DOWNLOAD_TIMEOUT_MS = 240000;

  /**
   * Say why a candidate was abandoned, and what happens next.
   *
   * A stalled download used to be invisible: one console.warn naming the asset,
   * nothing about how long it took, whether it timed out or errored, or that
   * the run was moving on to another candidate. From the Storyboard it read as
   * "Fetching stock..." forever even while the pipeline was working through
   * alternatives.
   */
  function noteCandidateFailure(asset, stage, err, startedAt, next) {
    const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
    const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
    const why = timedOut
      ? `timed out after ${elapsed}s`
      : `${err && err.message ? err.message : 'failed'} (after ${elapsed}s)`;
    console.warn(`[StockMedia] ${stage} ${asset.provider}:${asset.id} — ${why}`);
    console.warn(`[StockMedia]   → candidate failed, ${next}`);
    emit('blvck:asset-failed', {
      provider: asset.provider, id: asset.id, stage,
      timedOut, elapsedSec: Number(elapsed),
      reason: err && err.message ? err.message : 'failed', next
    });
  }

  async function downloadAsset(asset) {
    const cacheKey = `${asset.provider}:${asset.id}`;

    // Serve from cache if available.
    const meta = getCacheMeta();
    if (meta[cacheKey]) {
      const blob = await idbGet(cacheKey);
      if (blob && blob.size > 0) {
        emit('blvck:asset-cached',
          { cacheKey, provider: asset.provider, id: asset.id, bytes: blob.size, fromCache: true });
        return blob;
      }
    }

    // An asset whose URL is already one of our own proxy paths is same-origin
    // and needs no second hop. Archive downloads arrive this way, and sending
    // a relative path to the stock-download proxy — which expects an absolute
    // URL to fetch server-side — would fail every time.
    const isLocalProxy = asset.downloadUrl.startsWith('/');

    // A media file is tens of megabytes over a link that can stall, so this
    // needs a budget of its own — long enough for a real archival film on a
    // slow day, short enough that a dead connection does not take the run with
    // it. Without one, acquire()'s fallbacks never get to run: the beat cannot
    // move on to the next candidate because the first never fails.
    const res = isLocalProxy
      ? await fetch(asset.downloadUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) })
      : await fetch('/api/proxy/stock-download', {
          signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ url: asset.downloadUrl })
        });

    if (!res.ok) {
      throw new Error(`Stock download failed for ${cacheKey} (${res.status}): ${await res.text().catch(() => '')}`);
    }

    const blob = await readWithProgress(res, cacheKey, asset);
    if (!blob || blob.size < 512) {
      throw new Error(`Downloaded asset ${cacheKey} appears empty (${blob ? blob.size : 0} bytes)`);
    }

    await idbPut(cacheKey, blob);
    const newMeta = getCacheMeta();
    newMeta[cacheKey] = {
      provider:     asset.provider,
      id:           asset.id,
      type:         asset.type,
      orientation:  asset.orientation,
      duration:     asset.duration,
      width:        asset.width,
      height:       asset.height,
      downloadedAt: Date.now()
    };
    setCacheMeta(newMeta);
    emit('blvck:asset-cached', { cacheKey, provider: asset.provider, id: asset.id, bytes: blob.size });
    return blob;
  }

  // The cache meta lives in localStorage and the bytes live in IndexedDB, and
  // they can disagree — a cleared IndexedDB leaves the meta claiming a hit.
  // Anything telling the user they are ready to export has to check the bytes.
  async function isCached(asset) {
    if (!asset || !asset.provider || !asset.id) return false;
    const cacheKey = `${asset.provider}:${asset.id}`;
    if (!getCacheMeta()[cacheKey]) return false;
    try {
      const blob = await idbGet(cacheKey);
      return !!(blob && blob.size > 0);
    } catch (e) {
      return false;
    }
  }

  // ── Used-asset tracker ────────────────────────────────────────────────────
  // Persists per project (cleared when the user starts a new project or
  // explicitly resets via clearUsed()).

  const USED_KEY = 'blvck:stock-used-ids';

  function getUsedIds() {
    try {
      const v = JSON.parse(localStorage.getItem(USED_KEY) || '[]');
      return new Set(Array.isArray(v) ? v : []);
    } catch { return new Set(); }
  }

  function markUsed(asset) {
    const ids = getUsedIds();
    ids.add(`${asset.provider}:${asset.id}`);
    try { localStorage.setItem(USED_KEY, JSON.stringify([...ids])); } catch {}
  }

  function clearUsed() {
    try { localStorage.removeItem(USED_KEY); } catch {}
  }

  // ── Project orientation (reads project config) ────────────────────────────

  function projectOrientation() {
    try {
      const cfg = JSON.parse(localStorage.getItem('blvck-tts:project-config') || '{}');
      const ar  = String(cfg.aspectRatio || '16:9');
      if (ar === '9:16')  return 'portrait';
      if (ar === '1:1')   return 'square';
      return 'landscape'; // 16:9 default
    } catch { return 'landscape'; }
  }

  // ── Scene duration helper ─────────────────────────────────────────────────

  function sceneDurationSec(scene) {
    if (window.BlvckLTX && window.BlvckLTX.sceneDuration) return window.BlvckLTX.sceneDuration(scene);
    const parts = String((scene && scene.timestamp) || '').split(/\s*-\s*/);
    if (parts.length < 2) return 8;
    const toSec = ts => {
      const m = String(ts).match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
      if (!m) return null;
      return (Number(m[1]||0)*3600) + (Number(m[2])*60) + Number(m[3]) + (Number(m[4]||0)/1000);
    };
    const a = toSec(parts[0]), b = toSec(parts[1]);
    if (a == null || b == null) return 8;
    const d = b - a;
    return d >= 1 ? d : 8;
  }

  // ── Query builder (fallback when Director omits stockRequirements) ─────────

  function buildQueriesFromScene(scene) {
    const text = [
      scene.detectedAction,
      scene.sceneSummary,
      scene.subtitle,
      scene.environment
    ].filter(Boolean).join(' ');

    if (!text) return ['cinematic landscape'];

    // Primary query: first 5 meaningful words.
    const words   = text.replace(/[^\w\s]/g, '').split(/\s+/).filter(Boolean);
    const primary = words.slice(0, 5).join(' ');

    // Broadened query: first 3 words (higher recall).
    const broad   = words.slice(0, 3).join(' ');

    return primary === broad ? [primary] : [primary, broad];
  }

  // ── acquire(scene) — the main entry point ─────────────────────────────────
  //
  // Implements the full fallback hierarchy:
  //   Level 1 — Search all provided queries, all providers, prefer video
  //   Level 2 — Broader concept-only queries
  //   Level 3 — Try photos if video search found nothing
  //   Level 4 — Return null → caller falls back to text+graphic
  //
  // The AI generation path (LTX, SDXL, Pollinations, etc.) is NOT part of
  // this hierarchy. When null is returned, the storyboard renders a text card.

  async function acquire(scene, opts = {}) {
    const req            = scene.stockRequirements || {};
    const orientation    = req.orientation || projectOrientation();
    const targetDuration = sceneDurationSec(scene);
    const minimumDuration = Math.min(Number(req.minimumDuration) || 3, targetDuration > 2 ? targetDuration * 0.5 : 2);
    const usedIds        = getUsedIds();
    const provider       = opts.provider || 'all';
    const strategy       = opts.strategy || 'auto';

    // The Director's source decision for this beat. Everything below passes it
    // to both search (which sources to ask) and rank (how to weigh what comes
    // back), so a beat asking for archival material is not quietly handed a
    // sharper modern clip instead.
    const sourceStrategy   = req.sourceStrategy || scene.sourceStrategy || 'auto';
    const preferredSources = Array.isArray(req.preferredSources) ? req.preferredSources
                           : (Array.isArray(scene.preferredSources) ? scene.preferredSources : null);
    const archiveQueries   = Array.isArray(req.archiveQueries) ? req.archiveQueries : [];
    const timePeriod       = req.timePeriod || scene.timePeriod || null;

    // Determine media type from visual type + strategy.
    let isPhotoScene  = scene.visualType === 'stock_photo';
    if (strategy === 'video') isPhotoScene = false;
    if (strategy === 'photo') isPhotoScene = true;
    let mediaType = isPhotoScene ? 'photo' : 'video';

    // Built after mediaType exists — it reads it.
    const rankOpts = { orientation, mediaType, minimumDuration, targetDuration,
                       strategy: sourceStrategy, preferredSources };

    // ── Level 1: Director-provided queries ──────────────────────────────────
    const directorQueries = Array.isArray(req.queries) && req.queries.length
      ? req.queries
      : buildQueriesFromScene(scene);

    let results = await search({ queries: directorQueries, orientation, mediaType, minimumDuration, provider,
                                 sources: preferredSources, archiveQueries, timePeriod });

    if (results.length) {
      const ranked = rank(results, rankOpts, usedIds);
      console.log(`[StockMedia] scene ${scene.index}: ${ranked.length} cleared candidate(s) — `
        + ranked.slice(0, 4).map((a) => `${a.provider}:${a.id}`).join(', '));
      for (let i = 0; i < ranked.length; i++) {
        const asset = ranked[i];
        if (!clearForProduction(asset, scene)) continue;
        const startedAt = Date.now();
        try {
          // Rights were settled by clearForProduction above. Only now does it
          // make sense to spend anything on choosing WHERE in the film to cut:
          // a good-looking segment inside an uncleared item is still uncleared.
          const excerpt = req.excerpt || scene.excerpt || {};
          const wantSeconds = excerpt.targetDuration || targetDuration;
          asset.excerpt = await chooseExcerpt(asset, wantSeconds, excerpt.selectionIntent);
          asset.treatment = planTreatment(asset);
          const blob = await downloadAsset(asset);
          markUsed(asset);
          _attachStockMeta(scene, asset, directorQueries, 'primary');
          console.log(`[StockMedia] scene ${scene.index}: ${asset.provider}:${asset.id} `
            + `in ${((Date.now() - startedAt) / 1000).toFixed(1)}s`);
          return blob;
        } catch (err) {
          const next = ranked[i + 1]
            ? `trying ${ranked[i + 1].provider}:${ranked[i + 1].id}`
            : 'no candidates left at this level — falling back';
          noteCandidateFailure(asset, 'download', err, startedAt, next);
        }
      }
    }

    // ── Level 2: Broader concept query ─────────────────────────────────────
    const concept        = String(req.concept || '').trim();
    const fallbackQueries = Array.isArray(req.fallbackQueries) ? req.fallbackQueries : [];
    const broaderQueries  = [concept, ...fallbackQueries].filter(Boolean);
    if (broaderQueries.length) {
      // Widen the sources too, not just the words. An archival beat that found
      // nothing in the archive is better served by modern footage than by a
      // blank card — but only after the archive has genuinely been tried.
      const broader = await search({ queries: broaderQueries, orientation, mediaType,
                                     minimumDuration: Math.max(2, minimumDuration - 1), provider,
                                     archiveQueries, timePeriod });
      if (broader.length) {
        const ranked = rank(broader, Object.assign({}, rankOpts, { preferredSources: null }), usedIds);
        for (const asset of ranked) {
          try {
            const blob = await downloadAsset(asset);
            markUsed(asset);
            _attachStockMeta(scene, asset, broaderQueries, 'broader_query');
            return blob;
          } catch (err) {
            console.warn(`[StockMedia] Broader download failed ${asset.provider}:${asset.id}: ${err.message}`);
          }
        }
      }
    }

    // ── Level 3: Try photos if video search found nothing ───────────────────
    if (mediaType === 'video' && strategy !== 'video') {
      const photos = await search({ queries: directorQueries.concat(broaderQueries), orientation, mediaType: 'photo', minimumDuration: 0, provider });
      if (photos.length) {
        const ranked = rank(photos, { orientation, mediaType: 'photo', minimumDuration: 0, targetDuration }, usedIds);
        for (const asset of ranked) {
          try {
            const blob = await downloadAsset(asset);
            markUsed(asset);
            _attachStockMeta(scene, asset, directorQueries, 'photo_fallback');
            return blob;
          } catch (err) {
            console.warn(`[StockMedia] Photo fallback failed ${asset.provider}:${asset.id}: ${err.message}`);
          }
        }
      }
    }

    // ── Level 4: Nothing found — signal caller to use text+graphic ──────────
    console.warn(`[StockMedia] No stock asset found for scene ${scene.index}. Caller will use graphic fallback.`);
    scene.stockAsset = null;
    return null;
  }

  // Whether this asset may be placed on the timeline without a human first
  // looking at it. Decided here, in code — the Director judges whether footage
  // serves the story, never whether it may lawfully be published.
  function clearForProduction(asset, scene) {
    if (asset.provider !== 'archive_org') return true;      // catalogue-licensed
    if (!window.ArchiveLicense) return false;

    const verdict = window.ArchiveLicense.evaluate(asset.license, projectRightsPolicy());
    asset.rightsStatus = verdict;

    if (verdict.usable) return true;

    // An editorial candidate is recorded against the scene so the storyboard
    // can offer it for review, but it is not placed. "Might be arguable" is
    // not a decision software gets to make on someone's behalf.
    if (verdict.humanReviewRequired && scene) {
      scene.editorialCandidates = scene.editorialCandidates || [];
      if (!scene.editorialCandidates.some((c) => c.id === asset.id)) {
        scene.editorialCandidates.push({
          id: asset.id,
          provider: asset.provider,
          title: (asset.archive && asset.archive.title) || asset.id,
          sourceUrl: asset.sourceUrl,
          license: asset.license,
          rightsStatus: verdict,
          humanReviewRequired: true
        });
      }
    }
    return false;
  }

  // ── Excerpt planning ──────────────────────────────────────────────────────
  //
  // A Pexels clip is a shot. An archive item is a whole film — eleven minutes
  // of newsreel for a six-second beat. Dropping the whole thing on the
  // timeline gives the scene an arbitrary opening title card instead of the
  // footage it asked for.
  //
  // What this does NOT do is find the semantically right moment. Locating
  // "workers operating wartime machinery" inside an 11-minute reel needs
  // vision analysis that is not built here, and pretending otherwise would be
  // worse than admitting it. So the window is a heuristic starting point,
  // flagged for review, and the user can move it.
  function planExcerpt(asset, targetDuration, intent) {
    const full = Number(asset.duration || 0);
    const want = Math.max(2, Number(targetDuration) || 6);
    if (!full || full <= want * 1.5) return null;   // already about the right length

    // Skip the opening: archival films almost always start on titles, a
    // countdown or a logo, none of which is the footage anyone wants.
    const lead = Math.min(Math.max(full * 0.12, 8), 90);
    const usable = Math.max(0, full - lead - Math.min(full * 0.08, 30));
    const start = usable > want ? lead + (usable - want) * 0.25 : lead;

    return {
      required: true,
      applied: true,
      start: Math.round(start * 10) / 10,
      end: Math.round((start + want) * 10) / 10,
      duration: want,
      sourceDuration: full,
      selectionIntent: String(intent || ''),
      // Said plainly, because the alternative is the user assuming the system
      // watched the film and chose this moment on purpose.
      method: 'heuristic_window',
      reviewSuggested: true,
      note: 'Start point estimated, not chosen by watching the footage. Check it covers the moment you want.'
    };
  }

  // Pick the excerpt window. Prefers real analysis of the archive item's own
  // sampled frames, and falls back to the blind heuristic only when that is
  // unavailable — so the result always reports which one actually decided.
  async function chooseExcerpt(asset, wantSeconds, selectionIntent) {
    const analyzable = asset.provider === 'archive_org'
      && window.ArchiveExcerpt
      && asset.archive && asset.archive.identifier;

    if (analyzable) {
      try {
        const meta = await window.ArchiveOrg.itemMetadata(asset.archive.identifier);
        const chosen = await window.ArchiveExcerpt.selectExcerpt({
          metadata: meta,
          sourceDuration: asset.duration,
          targetDuration: wantSeconds,
          selectionIntent: selectionIntent || ''
        });
        if (chosen) return chosen;
      } catch (err) {
        console.warn(`[StockMedia] excerpt analysis failed for ${asset.id}: ${err.message}`);
      }
    }
    return planExcerpt(asset, wantSeconds, selectionIntent);
  }

  // How to fit a 4:3 archival frame into a 16:9 timeline (spec section 6).
  //
  // Cropping a 4:3 newsreel to fill 16:9 throws away a third of the picture,
  // and in archival footage that third is often the point — the crowd at the
  // edge, the sign above the door, the machine being operated. So the default
  // is to keep the whole frame and letterbox it, and cropping is only offered
  // where the aspect difference is small enough to be harmless.
  //
  // Upscaling is presentation only. It does not recover detail that was never
  // filmed, and nothing here should suggest it does.
  function planTreatment(asset, projectAspect) {
    const w = Number(asset.width || 0);
    const h = Number(asset.height || 0);
    if (!w || !h) return null;

    const target = Number(projectAspect) || (16 / 9);
    const source = w / h;
    const drift = Math.abs(source - target) / target;

    if (drift < 0.05) return { fit: 'fill', reframed: false, upscaled: false, note: '' };

    const narrower = source < target;
    return {
      fit: drift > 0.15 ? (narrower ? 'pillarbox' : 'letterbox') : 'crop',
      reframed: drift <= 0.15,
      // Below 720p in a 1080p timeline the renderer will scale it up. Said
      // plainly so nobody reads it as restoration.
      upscaled: h < 720,
      sourceAspect: Math.round(source * 100) / 100,
      note: drift > 0.15
        ? 'Whole frame kept and padded. Cropping this to fill the frame would '
          + 'cut away a third of the picture, which in archival footage is often the subject.'
        : 'Cropped slightly to fit.'
    };
  }

  function formatTimecode(seconds) {
    const s = Math.max(0, Number(seconds) || 0);
    const m = Math.floor(s / 60);
    const rest = (s - m * 60).toFixed(1).padStart(4, '0');
    return `${String(m).padStart(2, '0')}:${rest}`;
  }

  // The credit line for a clip that requires one. Public-domain material needs
  // no attribution, so returning null here is meaningful rather than missing.
  function buildAttribution(asset) {
    if (!asset.license || !asset.license.requiresAttribution) return null;
    const a = asset.archive || {};
    const parts = [a.title || asset.id];
    if (a.creator) parts.push(`by ${a.creator}`);
    parts.push(`— ${asset.sourceUrl}`);
    if (asset.license.licenseUrl) parts.push(`(${asset.license.licenseUrl})`);
    return parts.join(' ');
  }

  function _attachStockMeta(scene, asset, queries, fallback) {
    scene.stockAsset = {
      provider:     asset.provider,
      id:           asset.id,
      type:         asset.type,
      orientation:  asset.orientation,
      duration:     asset.duration,
      width:        asset.width,
      height:       asset.height,
      thumbnailUrl: asset.thumbnailUrl,
      sourceUrl:    asset.sourceUrl,
      queriesUsed:  queries,
      fallback:     fallback === 'primary' ? null : fallback,
      acquiredAt:   Date.now(),

      // Provenance travels with the clip. Without it a finished video has no
      // record of where its footage came from or on what terms, which is the
      // one thing you cannot reconstruct after the fact.
      license:      asset.license || null,
      archive:      asset.archive || null,
      attribution:  buildAttribution(asset),
      excerpt:      asset.excerpt || null,
      // Set by code, never by the model. An uncleared clip is not placed into
      // production by an AI deciding it looks defensible.
      rightsStatus: asset.rightsStatus || null
    };
  }

  // ── Manual override helpers ───────────────────────────────────────────────

  async function replaceClip(scene, query, opts = {}) {
    const orientation = opts.orientation || projectOrientation();
    const mediaType   = opts.mediaType   || 'video';
    const results     = await search({ queries: [String(query).trim()], orientation, mediaType, minimumDuration: 2 });
    if (!results.length) throw new Error(`No results for query: "${query}"`);
    const usedIds = getUsedIds();
    const ranked  = rank(results, { orientation, mediaType, minimumDuration: 2, targetDuration: sceneDurationSec(scene) }, usedIds);
    const asset   = ranked[0];
    const blob    = await downloadAsset(asset);
    markUsed(asset);
    _attachStockMeta(scene, asset, [query], 'manual_override');
    scene.stockLocked = false;
    return blob;
  }

  async function searchForBrowse(query, opts = {}) {
    const orientation = opts.orientation || projectOrientation();
    const mediaType   = opts.mediaType   || 'video';
    return search({ queries: [String(query || '').trim()], orientation, mediaType, minimumDuration: 2, perPage: 12 });
  }

  // ── Settings helpers ──────────────────────────────────────────────────────

  function isConfigured() {
    return !!(getPixabayKey() || getPexelsKey());
  }

  function providersStatus() {
    return { pixabay: !!getPixabayKey(), pexels: !!getPexelsKey() };
  }

  // Whether the old AI image/video generation path is re-enabled.
  // DISABLED by default. Only settable via an explicit developer toggle.
  function legacyAIEnabled() {
    return localStorage.getItem('blvck:legacy_ai_enabled') === 'true';
  }

  // ── Public API ────────────────────────────────────────────────────────────

  window.StockMedia = {
    // Core
    search,
    acquire,
    downloadAsset,
    rank,
    // UI helpers
    replaceClip,
    searchForBrowse,
    // State
    isConfigured,
    planExcerpt,
    chooseExcerpt,
    planTreatment,
    formatTimecode,
    clearForProduction,
    projectRightsPolicy,
    providersStatus,
    legacyAIEnabled,
    projectOrientation,
    // Used-ID tracking
    getUsedIds,
    markUsed,
    clearUsed,
    // Cache inspection
    getCacheMeta,
    isCached
  };
})();
