// What this project is allowed to put on screen.
//
// NOT a new store. Assets already live in several places with different rights
// stories, and building a second acquisition pipeline beside them is the
// failure this whole design exists to avoid. This enumerates what is already
// there and normalises it into one vocabulary:
//
//   stock cache          blvck-stock-cache/assets, keyed provider:id
//                        carries licence, archive metadata, attribution
//   character portraits  blvck-storyboard/images, keyed ref:<name>
//   storyboard stills    blvck-storyboard/images, keyed <index>
//
// THE RIGHTS PICTURE IS UNEVEN AND SAYING SO IS THE POINT. Only archive.org
// items carry a real rightsStatus. clearForProduction returns true for Pixabay
// and Pexels because those libraries are catalogue-licensed, and a portrait we
// generated or a still we drew has no licence record at all - not because it is
// unclear, but because it is ours. Those are different kinds of "fine" and a
// manifest that flattened them would be lying by omission.
//
// WHAT MAKES IT ENFORCEABLE. The renderer reads files from disk, and the
// manifest is exactly what gets written there. A composition can only reference
// asset ids that came from here, and an asset that is not approved is not on
// disk to reference. Two independent gates rather than a naming convention.
(() => {
  'use strict';

  const STOCK_DB = 'blvck-stock-cache';
  const STOCK_STORE = 'assets';
  const SB_DB = 'blvck-storyboard';
  const SB_STORE = 'images';
  const CACHE_META = 'blvck:stock-cache-meta';

  const str = (v) => String(v == null ? '' : v).trim();

  function idb(name, store) {
    return new Promise((res, rej) => {
      const rq = indexedDB.open(name, 1);
      rq.onupgradeneeded = () => {
        const db = rq.result;
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      };
      rq.onsuccess = () => res(rq.result);
      rq.onerror = () => rej(rq.error);
    });
  }

  async function get(dbName, store, key, faults) {
    try {
      const db = await idb(dbName, store);
      return await new Promise((res, rej) => {
        const tx = db.transaction(store, 'readonly');
        const rq = tx.objectStore(store).get(key);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => rej(rq.error);
      });
    } catch (e) {
      if (faults) faults.push(`${dbName}/${store}:${key} could not be read: ${e.message}`);
      return null;
    }
  }

  /**
   * The keys in a store, and whether asking succeeded.
   *
   * AN EMPTY LIST AND A BROKEN STORE ARE NOT THE SAME ANSWER, and this returned
   * the same [] for both. Downstream that becomes an empty manifest, which
   * becomes "NO ASSETS ARE APPROVED FOR THIS BEAT — build it from type alone"
   * in the Composer's brief. A project whose imagery is sitting on disk would
   * be told, in perfectly confident language, that it has none — and the
   * finished scene would carry no sign that anything had gone wrong.
   *
   * The faults are collected instead and travel with the answer.
   */
  async function keys(dbName, store, faults) {
    try {
      const db = await idb(dbName, store);
      return await new Promise((res, rej) => {
        const tx = db.transaction(store, 'readonly');
        const rq = tx.objectStore(store).getAllKeys();
        rq.onsuccess = () => res(rq.result || []);
        rq.onerror = () => rej(rq.error);
      });
    } catch (e) {
      if (faults) faults.push(`${dbName}/${store} could not be read: ${e.message}`);
      return [];
    }
  }

  // ── Rights ───────────────────────────────────────────────────────────────

  /**
   * On what terms may this be used?
   *
   * Delegates to the evaluator that already governs acquisition rather than
   * forming a second opinion. The vocabulary below is about WHY something is
   * usable, which a downstream reader needs in order to attribute it.
   */
  function rightsOf(source, meta) {
    if (source === 'generated' || source === 'storyboard') {
      return { status: 'approved', basis: 'produced by this project', attribution: null };
    }
    if (source === 'stock') {
      const provider = str(meta && meta.provider);
      if (provider && provider !== 'archive_org') {
        // Catalogue-licensed: the terms belong to the library, not the item.
        // clearForProduction says the same thing for these.
        return { status: 'approved', basis: provider + ' catalogue licence',
                 attribution: (meta && meta.attribution) || null };
      }
      // archive.org: the only source with a per-item licence, and the only one
      // that can come back refused.
      const AL = window.ArchiveLicense;
      const policy = (window.StockMedia && window.StockMedia.projectRightsPolicy)
        ? window.StockMedia.projectRightsPolicy() : (AL && AL.DEFAULT_POLICY);
      if (!AL || !meta || !meta.license) {
        return { status: 'unknown', basis: 'no licence recorded for this archive item',
                 attribution: (meta && meta.attribution) || null };
      }
      const verdict = AL.evaluate(meta.license, policy);
      return {
        status: verdict && verdict.usable ? 'approved' : 'refused',
        basis: (verdict && verdict.reason) || 'archive licence evaluation',
        humanReviewRequired: !!(verdict && verdict.humanReviewRequired),
        attribution: meta.attribution || null
      };
    }
    return { status: 'unknown', basis: 'unrecognised source', attribution: null };
  }

  // ── The catalogue ────────────────────────────────────────────────────────

  /**
   * Everything this project could draw on, with its terms attached.
   *
   * Metadata only — no blobs are read here. A catalogue that loaded every
   * cached video to answer "what do we have" would cost tens of megabytes to
   * answer a question about names.
   */
  async function catalogue(faults) {
    const out = [];

    // Stock: the manifest in localStorage says what is cached; the scenes say
    // what is known about each one.
    let meta = {};
    try { meta = JSON.parse(localStorage.getItem(CACHE_META) || '{}') || {}; }
    catch (e) {
      meta = {};
      if (faults) faults.push('the stock cache manifest is unreadable: ' + e.message);
    }

    const byKey = new Map();
    try {
      const sb = JSON.parse(localStorage.getItem('blvck-tts:storyboard') || 'null');
      for (const s of ((sb && sb.scenes) || [])) {
        const a = s.stockAsset;
        if (a && a.provider && a.id) byKey.set(`${a.provider}:${a.id}`, a);
      }
    } catch (e) {
      // A storyboard that will not parse is different from not having one, and
      // it costs every cached clip its description.
      if (faults) faults.push('the storyboard could not be read: ' + e.message);
    }

    for (const key of Object.keys(meta)) {
      const a = byKey.get(key) || {};
      const provider = a.provider || key.split(':')[0];
      out.push({
        assetId: 'stock_' + key.replace(/[^\w]/g, '_'),
        type: a.type === 'photo' ? 'image' : (a.type || 'video'),
        source: 'stock',
        storeKey: key,
        provider,
        description: describeStock(a, key),
        width: a.width || null, height: a.height || null,
        duration: a.duration || null,
        sourceUrl: a.sourceUrl || null,
        rights: rightsOf('stock', a)
      });
    }

    // Character portraits and storyboard stills share one store; the key tells
    // them apart.
    for (const k of await keys(SB_DB, SB_STORE, faults)) {
      const key = String(k);
      if (key.startsWith('ref:')) {
        const name = key.slice(4);
        out.push({
          assetId: 'portrait_' + name.replace(/[^\w]/g, '_'),
          type: 'image', source: 'generated', storeKey: key,
          description: `a reference portrait of ${name}`,
          rights: rightsOf('generated')
        });
      } else if (/^\d+$/.test(key)) {
        out.push({
          assetId: 'still_' + key,
          type: 'image', source: 'storyboard', storeKey: key,
          description: `the rendered still for scene ${key}`,
          rights: rightsOf('storyboard')
        });
      }
    }
    return out;
  }

  function describeStock(a, key) {
    const bits = [];
    if (a.archive && a.archive.title) bits.push(a.archive.title);
    else if (Array.isArray(a.queriesUsed) && a.queriesUsed.length) bits.push(a.queriesUsed.join(', '));
    if (a.width && a.height) bits.push(`${a.width}x${a.height}`);
    if (a.duration) bits.push(`${a.duration}s`);
    return bits.join(' · ') || key;
  }

  /** Only what may actually be used. */
  async function approved(faults) {
    return (await catalogue(faults)).filter((a) => a.rights.status === 'approved');
  }

  // ── The manifest ─────────────────────────────────────────────────────────

  /**
   * The assets a scene may use, with their bytes, ready to be written to disk.
   *
   * `wanted` is the Visual Director's list of needs. Matching is deliberately
   * plain - a shared word between a need and a description - because a clever
   * matcher would be a second relevance system beside the one acquisition
   * already has, and this is not the place to grow one.
   *
   * An asset that cannot be read back is dropped and reported. A manifest
   * promising a file that is not there produces a composition referencing a
   * missing image, which the renderer refuses under --no-best-effort.
   */
  async function manifestFor({ wanted = [], limit = 6, allowVideo = false } = {}) {
    const faults = [];
    const pool = await approved(faults);
    const needs = (Array.isArray(wanted) ? wanted : []).map(str).filter(Boolean);

    const scored = pool.map((a) => {
      const hay = (a.description + ' ' + a.type + ' ' + (a.provider || '')).toLowerCase();
      let score = 0;
      for (const need of needs) {
        for (const word of need.toLowerCase().split(/\W+/)) {
          if (word.length > 3 && hay.includes(word)) score++;
        }
      }
      return { a, score };
    }).sort((x, y) => y.score - x.score);

    const picked = [];
    const missing = [];
    for (const { a } of scored) {
      if (picked.length >= limit) break;
      const dbName = a.source === 'stock' ? STOCK_DB : SB_DB;
      const store = a.source === 'stock' ? STOCK_STORE : SB_STORE;
      const blob = await get(dbName, store, a.storeKey, faults);
      if (!blob || !blob.size) { missing.push(a.assetId); continue; }
      if (a.type !== 'image' && !allowVideo) continue;
      picked.push(Object.assign({}, a, { blob, bytes: blob.size, fileName: fileNameFor(a, blob) }));
    }

    return {
      assets: picked,
      missing,
      // Whatever went wrong while answering. An empty manifest with faults on
      // it means "this could not be looked up", which is a different sentence
      // from "there is nothing", and the Composer is told which.
      faults,
      // What the Director asked for and the registry could not supply. Reported
      // rather than papered over: the Composer designs around the absence, the
      // same way acquisition reports NO_SUITABLE_ASSET.
      unmet: needs.filter((need) => !picked.some((p) =>
        need.toLowerCase().split(/\W+/).some((w) => w.length > 3 &&
          p.description.toLowerCase().includes(w))))
    };
  }

  function fileNameFor(a, blob) {
    const t = String(blob.type || '');
    const ext = /webm/.test(t) ? 'webm' : /quicktime|mov/.test(t) ? 'mov'
              : /mp4|video/.test(t) ? 'mp4'
              : /png/.test(t) ? 'png' : /webp/.test(t) ? 'webp'
              : /gif/.test(t) ? 'gif' : 'jpg';
    return a.assetId + '.' + ext;
  }

  /**
   * The footage a scene has already been given, as a render asset.
   *
   * Rights are not re-litigated here — acquisition already cleared this clip
   * and wrote its provenance onto the scene. This reads the cached bytes and
   * carries the excerpt window across, because a composition that starts a
   * thirteen minute film at zero is showing the wrong nine seconds.
   */
  async function footageFor(scene) {
    const a = scene && scene.stockAsset;
    if (!a || !a.provider || !a.id) return null;
    const key = `${a.provider}:${a.id}`;
    const blob = await get(STOCK_DB, STOCK_STORE, key);
    if (!blob || !blob.size) return null;
    const win = (window.StockMedia && window.StockMedia.excerptWindow)
      ? window.StockMedia.excerptWindow(a.excerpt) : null;
    return {
      assetId: 'footage_' + key.replace(/[^\w]/g, '_'),
      type: 'video', source: 'stock', storeKey: key, blob, bytes: blob.size,
      fileName: 'footage.' + (/webm/.test(blob.type || '') ? 'webm' : 'mp4'),
      mediaStart: win ? win.in : 0,
      description: describeStock(a, key),
      rights: rightsOf('stock', a)
    };
  }

  /** The manifest as the render endpoint wants it: names and base64. */
  async function toRenderAssets(manifest) {
    const out = [];
    for (const a of (manifest.assets || [])) {
      const buf = await a.blob.arrayBuffer();
      let bin = '';
      const bytes = new Uint8Array(buf);
      const CH = 0x8000;
      for (let i = 0; i < bytes.length; i += CH) {
        bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
      }
      out.push({ name: a.fileName, base64: btoa(bin) });
    }
    return out;
  }

  /** What the Composer is told it may reference. Never blobs, never URLs. */
  function describeForPrompt(manifest) {
    return (manifest.assets || []).map((a) =>
      `${a.assetId} · ${a.type} · ${a.description} · rights: ${a.rights.basis}`).join('\n');
  }

  window.BlvckAssetRegistry = {
    catalogue, approved, manifestFor, toRenderAssets, describeForPrompt,
    rightsOf, footageFor
  };
})();
