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
      body:    JSON.stringify(params)
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
      body:    JSON.stringify(params)
    });

    if (!res.ok) throw new Error(`Pexels ${res.status}: ${await res.text().catch(() => '')}`);

    const data = await res.json();

    if (isVideo) {
      const videos = Array.isArray(data.videos) ? data.videos : [];
      return videos.map(v => {
        const files  = Array.isArray(v.video_files) ? v.video_files : [];
        // Sort files by pixel area descending to pick highest quality.
        const sorted = files.slice().sort((a, b) => (b.width * b.height) - (a.width * a.height));
        const best    = sorted[0] || {};
        const preview = sorted[Math.min(1, sorted.length - 1)] || best;
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

  async function search({ queries = [], orientation = 'landscape', mediaType = 'video', minimumDuration = 3, perPage = 8, provider = 'all' } = {}) {
    if (!queries.length) return [];

    const pixabayOrientation = toPixabayOrientation(orientation);
    const pexelsOrientation  = toPexelsOrientation(orientation);

    const tasks = [];
    const hasPixabay = !!getPixabayKey() && (provider === 'all' || provider === 'pixabay');
    const hasPexels  = !!getPexelsKey() && (provider === 'all' || provider === 'pexels');

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

  function scoreAsset(asset, { orientation = 'landscape', mediaType = 'video', minimumDuration = 3, targetDuration = 8 } = {}, usedIds) {
    let score = 100;

    // Already-used penalty — avoid identical clips within one video.
    if (usedIds && usedIds.has(`${asset.provider}:${asset.id}`)) score -= 80;

    // Media type preference.
    if (mediaType === 'video' && asset.type === 'photo') score -= 25;
    if (mediaType === 'photo' && asset.type === 'video') score -= 5;

    // Orientation match.
    if (orientation !== 'any') {
      if (asset.orientation === orientation) score += 20;
      else score -= 15;
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

    // Resolution quality.
    const px = asset.width * asset.height;
    if (px >= 1920 * 1080) score += 12;
    else if (px >= 1280 * 720) score += 6;
    else if (px < 640 * 480)   score -= 20;

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

  async function downloadAsset(asset) {
    const cacheKey = `${asset.provider}:${asset.id}`;

    // Serve from cache if available.
    const meta = getCacheMeta();
    if (meta[cacheKey]) {
      const blob = await idbGet(cacheKey);
      if (blob && blob.size > 0) return blob;
    }

    const res = await fetch('/api/proxy/stock-download', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ url: asset.downloadUrl })
    });

    if (!res.ok) {
      throw new Error(`Stock download failed for ${cacheKey} (${res.status}): ${await res.text().catch(() => '')}`);
    }

    const blob = await res.blob();
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
    return blob;
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

    // Determine media type from visual type + strategy.
    let isPhotoScene  = scene.visualType === 'stock_photo';
    if (strategy === 'video') isPhotoScene = false;
    if (strategy === 'photo') isPhotoScene = true;
    let mediaType = isPhotoScene ? 'photo' : 'video';

    // ── Level 1: Director-provided queries ──────────────────────────────────
    const directorQueries = Array.isArray(req.queries) && req.queries.length
      ? req.queries
      : buildQueriesFromScene(scene);

    let results = await search({ queries: directorQueries, orientation, mediaType, minimumDuration, provider });

    if (results.length) {
      const ranked = rank(results, { orientation, mediaType, minimumDuration, targetDuration }, usedIds);
      for (const asset of ranked) {
        try {
          const blob = await downloadAsset(asset);
          markUsed(asset);
          _attachStockMeta(scene, asset, directorQueries, 'primary');
          return blob;
        } catch (err) {
          console.warn(`[StockMedia] Download failed ${asset.provider}:${asset.id}: ${err.message}`);
        }
      }
    }

    // ── Level 2: Broader concept query ─────────────────────────────────────
    const concept        = String(req.concept || '').trim();
    const fallbackQueries = Array.isArray(req.fallbackQueries) ? req.fallbackQueries : [];
    const broaderQueries  = [concept, ...fallbackQueries].filter(Boolean);
    if (broaderQueries.length) {
      const broader = await search({ queries: broaderQueries, orientation, mediaType, minimumDuration: Math.max(2, minimumDuration - 1), provider });
      if (broader.length) {
        const ranked = rank(broader, { orientation, mediaType, minimumDuration, targetDuration }, usedIds);
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
      acquiredAt:   Date.now()
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
    providersStatus,
    legacyAIEnabled,
    projectOrientation,
    // Used-ID tracking
    getUsedIds,
    markUsed,
    clearUsed,
    // Cache inspection
    getCacheMeta
  };
})();
