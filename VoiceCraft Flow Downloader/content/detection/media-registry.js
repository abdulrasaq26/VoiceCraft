// content/detection/media-registry.js
//
// The shared Flow media detection engine's state: every asset seen in the
// current Flow project, keyed by a stable identity, kept for as long as the
// project is open. The Downloader tray, Prompt Recovery, the crawler and the
// Automator all read from here, so there is one answer to "what has Flow
// generated?" — not one per feature.
//
//   key       Flow's media id when the URL or tile carries one, else the
//             normalized URL (query and FIFE size suffix stripped)
//   name      the name Flow shows for it (e.g. "0-12", "james"), from the
//             tile itself — never guessed
//   guessName network-only media borrow the last tile name for a file name;
//             Prompt Recovery ignores it
//
// The same tile found again (re-render, scroll, crawler pass) is merged into
// its entry; a name that shows up later fills the entry in.

(function () {
  if (window.FlowMediaRegistry) return;

  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  // "#0-12", "0-12.png", "0–12 " → "0-12"; lower-case for comparing.
  function cleanName(raw) {
    if (!raw) return '';
    let n = String(raw).replace(/[\/\\?%*:|"<>\n\r]/g, '-').replace(/\s+/g, ' ').trim();
    n = window.NameNormalizer ? window.NameNormalizer.normalize(n) : n.replace(/^#/, '');
    return n.replace(/--+/g, '-').trim();
  }
  const nameKey = (raw) => cleanName(raw).toLowerCase();

  function flowIdFrom(media) {
    const tryStr = (s) => { const m = s && UUID.exec(s); return m ? m[0].toLowerCase() : null; };
    if (media.url && !media.url.startsWith('blob:') && !media.url.startsWith('data:')) {
      try {
        const u = new URL(media.url);
        const id = tryStr(u.searchParams.get('name')) || tryStr(u.pathname);
        if (id) return id;
      } catch (e) { /* not a URL */ }
    }
    // The tile's own link often carries the id (…/edit/<id>, data attributes).
    const el = media.element;
    if (el && el.closest) {
      const a = el.closest('a[href]');
      const id = a && tryStr(a.getAttribute('href'));
      if (id) return id;
      let p = el;
      for (let i = 0; p && i < 4; i++, p = p.parentElement) {
        for (const attr of p.attributes || []) {
          if (/^data-/.test(attr.name)) { const v = tryStr(attr.value); if (v) return v; }
        }
      }
    }
    return null;
  }

  function stableKey(media) {
    const id = flowIdFrom(media);
    if (id) return { key: 'id:' + id, flowId: id };
    const url = window.MediaFingerprint ? window.MediaFingerprint.normalizeUrl(media.url) : media.url;
    return { key: 'url:' + url, flowId: null };
  }

  // The Flow project this page shows; a new project starts a new registry.
  const projectOf = () => {
    const m = /\/project\/([^/?#]+)/.exec(location.pathname);
    return m ? m[1] : location.pathname;
  };

  class Registry {
    constructor() {
      this.assets = new Map();   // key -> asset
      this.byName = new Map();   // name key -> Set<key>
      this.listeners = new Set();
      this.project = projectOf();
      this.uid = 0;
    }

    // ({ type: 'added' | 'updated' | 'reset', asset }) => void
    subscribe(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(ev) { for (const fn of this.listeners) { try { fn(ev); } catch (e) { console.warn('[FlowMedia]', e); } } }

    // Called before every ingest: a different project means a clean slate.
    checkProject() {
      const p = projectOf();
      if (p === this.project) return;
      this.project = p;
      this.assets.clear();
      this.byName.clear();
      this.emit({ type: 'reset' });
    }

    // A normalized media object from MediaNormalizer / the network listener.
    // Returns the registry entry (new or merged).
    ingest(media) {
      if (!media || !media.url) return null;
      this.checkProject();
      const { key, flowId } = stableKey(media);
      const realName = media.isNetwork ? '' : cleanName(media.title);
      const now = Date.now();
      let a = this.assets.get(key);
      if (!a) {
        a = {
          key, id: 'fm_' + (++this.uid) + '_' + now.toString(36), flowId,
          type: media.type, url: media.url, thumbnail: media.thumbnail || null,
          width: media.width || 0, height: media.height || 0, duration: media.duration || 0,
          name: realName, title: realName || null,
          guessName: media.isNetwork ? cleanName(media.title) : '',
          source: media.isNetwork ? 'network' : 'dom',
          detectedAt: now, updatedAt: now,
          element: media.element || null,
        };
        this.assets.set(key, a);
        if (a.name) this.indexName(a);
        this.emit({ type: 'added', asset: a });
        return a;
      }
      // Merge: fill in what was missing, never lose what we had.
      let changed = false;
      if (realName && !a.name) { a.name = realName; a.title = realName; this.indexName(a); changed = true; }
      if (!a.flowId && flowId) { a.flowId = flowId; changed = true; }
      if ((media.width || 0) > a.width) { a.width = media.width; a.height = media.height || a.height; changed = true; }
      if (!a.thumbnail && media.thumbnail) { a.thumbnail = media.thumbnail; changed = true; }
      if (media.element && (!a.element || !a.element.isConnected)) a.element = media.element;
      if (a.source === 'network' && !media.isNetwork) { a.source = 'dom'; changed = true; }
      if (changed) { a.updatedAt = now; this.emit({ type: 'updated', asset: a }); }
      return a;
    }

    indexName(a) {
      const k = nameKey(a.name);
      if (!k) return;
      if (!this.byName.has(k)) this.byName.set(k, new Set());
      this.byName.get(k).add(a.key);
    }

    get size() { return this.assets.size; }
    get named() { let n = 0; for (const a of this.assets.values()) if (a.name) n++; return n; }
    all() { return [...this.assets.values()]; }

    // Assets Flow named `name` (also "name (2)" for extra outputs).
    findByName(name) {
      const k = nameKey(name);
      if (!k) return [];
      const out = [];
      const exact = this.byName.get(k);
      if (exact) for (const key of exact) out.push(this.assets.get(key));
      const extra = new RegExp('^' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\(\\d+\\)$');
      for (const [nk, keys] of this.byName) {
        if (nk !== k && extra.test(nk)) for (const key of keys) out.push(this.assets.get(key));
      }
      return out;
    }
  }

  window.FlowMediaRegistry = new Registry();
  window.FlowMediaNames = { clean: cleanName, key: nameKey };
})();
