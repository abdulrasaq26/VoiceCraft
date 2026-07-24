// Data management — the single place that knows what storage belongs to each
// module and how to wipe it. Powers every "Clear …" button, the global "Reset
// project", and the smart-clear options. Every destructive action is confirmed
// first, gives immediate visual feedback, and offers a short Undo window before
// the deletion becomes permanent.
//
// window.BlvckData
//   register(id, refreshFn)     modules re-hydrate their UI from storage on demand
//   registerScenes(fn)          storyboard exposes clearScenes('completed'|'failed')
//   clearModule(id)             confirm + clear one section (with undo)
//   resetProject()              confirm + clear the whole working project
//   smartClear(kind)            confirm + clear by category
(() => {
  'use strict';

  // --- Storage map -------------------------------------------------------
  // Each item lists the localStorage keys and IndexedDB stores it owns, plus
  // the categories it belongs to (for smart clears). Reusable libraries
  // (templates, presets, favorites, the channel knowledge base, saved
  // projects) are deliberately NOT listed — they are not current-project data.
  const ITEMS = [
    { id: 'research', module: 'research', label: 'Research brief', ls: ['blvck-tts:research'], cats: ['generated', 'ai'] },
    { id: 'script', module: 'script', label: 'Script', ls: ['blvck-tts:script-last'], cats: ['generated', 'ai'] },
    { id: 'audio', module: 'tts', label: 'Generated audio', ls: ['blvck-tts:batch'], idb: [['blvck-tts', 'audio']], cats: ['generated', 'ai'] },
    { id: 'voice-settings', module: 'tts', label: 'Voice settings', ls: ['blvck-tts:settings'], cats: ['settings'] },
    { id: 'subtitles', module: 'subtitles', label: 'Subtitles', ls: ['blvck-tts:subtitles'], cats: ['generated', 'ai'] },
    { id: 'storyboard', module: 'storyboard', label: 'Storyboard & scene images', ls: ['blvck-tts:storyboard'], idb: [['blvck-storyboard', 'images']], cats: ['generated', 'ai'] },
    { id: 'sb-style', module: 'storyboard', label: 'Storyboard style', ls: ['blvck-tts:sb-style'], cats: ['settings'] },
    { id: 'editor', module: 'editor', label: 'Video timeline', ls: ['blvck-tts:editor'], cats: ['generated'] },
    { id: 'editor-manual', module: 'editor', label: 'Uploaded narration', idb: [['blvck-editor', 'audio']], cats: ['uploaded'] },
    { id: 'seo', module: 'youtube', label: 'YouTube SEO & thumbnails', ls: ['blvck-tts:seo'], idb: [['blvck-thumbnails', 'images']], cats: ['generated', 'ai'] },
    { id: 'agent', module: 'agent', label: 'AI agent chat history', ls: ['blvck-tts:agent'], cats: ['ai'] },
    { id: 'director', module: 'director', label: 'Production audit', ls: ['blvck-tts:director-audit'], cats: ['ai'] },
    { id: 'narration', module: 'project', label: 'Project name & narration', ls: ['blvck-tts:narration'], cats: [] },
    { id: 'recents', module: 'cache', label: 'Recent & temporary items', ls: ['blvck-tts:recents'], cats: ['cache'] },
    // Channel Brain is cross-project memory — global:false keeps it out of the
    // whole-project reset and the category smart-clears, but its own section
    // Clear button still works (with confirm + undo).
    { id: 'brain', module: 'brain', label: 'Channel Brain (cross-project memory)', ls: ['blvck-tts:brain'], cats: [], global: false }
  ];

  // Sections that own a Clear button but no distinct storage (their output is
  // in-memory only). They still get a refresh() to reset their preview.
  const IN_MEMORY_MODULES = ['images'];

  const MODULE_LABELS = {
    research: 'research brief', script: 'script', tts: 'audio & voice settings', subtitles: 'subtitles',
    storyboard: 'storyboard', images: 'generated image', editor: 'timeline & assets',
    youtube: 'generated SEO assets', agent: 'chat history', director: 'production audit',
    brain: 'Channel Brain memory'
  };

  // --- Module refresh registry -------------------------------------------
  const refreshers = new Map(); // id -> fn (re-hydrate UI from storage)
  let sceneClearer = null; // storyboard: (filter) => Promise

  function refreshAll() {
    refreshers.forEach((fn) => { try { fn(); } catch { /* keep going */ } });
    if (window.BlvckAssets) { try { window.BlvckAssets.emit(); } catch { /* ignore */ } }
  }

  // --- IndexedDB helpers -------------------------------------------------
  function rawOpen(name) {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(name);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function storeEntries(dbName, store) {
    try {
      const db = await rawOpen(dbName);
      if (!db.objectStoreNames.contains(store)) { db.close(); return []; }
      const out = await new Promise((resolve, reject) => {
        const tx = db.transaction(store, 'readonly');
        const os = tx.objectStore(store);
        const keysReq = os.getAllKeys();
        const valsReq = os.getAll();
        tx.oncomplete = () => resolve(keysReq.result.map((k, i) => ({ key: k, value: valsReq.result[i] })));
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return out;
    } catch { return []; }
  }
  async function storeClear(dbName, store) {
    try {
      const db = await rawOpen(dbName);
      if (!db.objectStoreNames.contains(store)) { db.close(); return; }
      await new Promise((resolve) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).clear();
        tx.oncomplete = resolve; tx.onerror = resolve;
      });
      db.close();
    } catch { /* ignore */ }
  }
  async function storePut(dbName, store, entries) {
    if (!entries || !entries.length) return;
    try {
      const db = await rawOpen(dbName);
      if (!db.objectStoreNames.contains(store)) { db.close(); return; }
      await new Promise((resolve) => {
        const tx = db.transaction(store, 'readwrite');
        const os = tx.objectStore(store);
        entries.forEach((e) => os.put(e.value, e.key));
        tx.oncomplete = resolve; tx.onerror = resolve;
      });
      db.close();
    } catch { /* ignore */ }
  }

  // --- Snapshot / delete / restore ---------------------------------------
  async function snapshot(items) {
    const snap = { ls: {}, idb: [] };
    for (const it of items) {
      (it.ls || []).forEach((k) => { const v = localStorage.getItem(k); if (v != null) snap.ls[k] = v; });
      for (const [db, store] of (it.idb || [])) {
        const entries = await storeEntries(db, store);
        if (entries.length) snap.idb.push({ db, store, entries });
      }
    }
    return snap;
  }
  async function deleteItems(items) {
    for (const it of items) {
      (it.ls || []).forEach((k) => localStorage.removeItem(k));
      for (const [db, store] of (it.idb || [])) await storeClear(db, store);
    }
  }
  async function restoreSnapshot(snap) {
    Object.entries(snap.ls).forEach(([k, v]) => localStorage.setItem(k, v));
    for (const g of snap.idb) await storePut(g.db, g.store, g.entries);
  }
  function snapshotSize(snap) {
    return Object.keys(snap.ls).length + snap.idb.reduce((n, g) => n + g.entries.length, 0);
  }

  // --- Confirm dialog ----------------------------------------------------
  function ensureConfirm() {
    let el = document.getElementById('blvck-confirm-modal');
    if (el) return el;
    el = document.createElement('div');
    el.id = 'blvck-confirm-modal';
    el.className = 'modal';
    el.hidden = true;
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.innerHTML =
      '<div class="modal-backdrop" data-cancel></div>' +
      '<div class="modal-panel confirm-panel">' +
      '<div class="modal-header"><h2 id="blvck-confirm-title">Confirm</h2>' +
      '<button class="modal-close" type="button" data-cancel aria-label="Close">×</button></div>' +
      '<p id="blvck-confirm-msg" class="confirm-msg"></p>' +
      '<div class="confirm-actions">' +
      '<button class="btn ghost" type="button" data-cancel>Cancel</button>' +
      '<button class="btn danger" type="button" data-ok id="blvck-confirm-ok">Delete</button>' +
      '</div></div>';
    document.body.appendChild(el);
    return el;
  }

  function confirmDialog({ title, message, okLabel = 'Delete' }) {
    const el = ensureConfirm();
    el.querySelector('#blvck-confirm-title').textContent = title;
    el.querySelector('#blvck-confirm-msg').textContent = message;
    const ok = el.querySelector('#blvck-confirm-ok');
    ok.textContent = okLabel;
    el.hidden = false;
    return new Promise((resolve) => {
      const done = (val) => {
        el.hidden = true;
        el.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey);
        resolve(val);
      };
      const onClick = (e) => {
        if (e.target.closest('[data-ok]')) done(true);
        else if (e.target.closest('[data-cancel]')) done(false);
      };
      const onKey = (e) => { if (e.key === 'Escape') done(false); };
      el.addEventListener('click', onClick);
      document.addEventListener('keydown', onKey);
      ok.focus();
    });
  }

  // --- Toast + undo ------------------------------------------------------
  function ensureToastHost() {
    let host = document.getElementById('blvck-toast-host');
    if (host) return host;
    host = document.createElement('div');
    host.id = 'blvck-toast-host';
    host.className = 'toast-host';
    document.body.appendChild(host);
    return host;
  }

  const UNDO_MS = 8000;
  function toast(message, onUndo) {
    const host = ensureToastHost();
    const el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    const msg = document.createElement('span');
    msg.className = 'toast-msg';
    msg.textContent = message;
    el.appendChild(msg);
    let timer = null;
    const dismiss = () => { if (timer) clearTimeout(timer); el.classList.add('leaving'); setTimeout(() => el.remove(), 250); };
    if (onUndo) {
      const undo = document.createElement('button');
      undo.className = 'toast-undo';
      undo.type = 'button';
      undo.textContent = 'Undo';
      undo.addEventListener('click', async () => { dismiss(); await onUndo(); });
      el.appendChild(undo);
      const bar = document.createElement('div');
      bar.className = 'toast-timer';
      el.appendChild(bar);
      // kick the shrink animation on next frame
      requestAnimationFrame(() => { bar.style.transition = `transform ${UNDO_MS}ms linear`; bar.style.transform = 'scaleX(0)'; });
    }
    const close = document.createElement('button');
    close.className = 'toast-close';
    close.type = 'button';
    close.setAttribute('aria-label', 'Dismiss');
    close.textContent = '×';
    close.addEventListener('click', dismiss);
    el.appendChild(close);
    host.appendChild(el);
    timer = setTimeout(dismiss, UNDO_MS);
    return el;
  }

  // --- Core clear flow ---------------------------------------------------
  async function runClear({ title, message, items, extra, sceneFilter, okLabel, doneMsg }) {
    const ok = await confirmDialog({ title, message, okLabel });
    if (!ok) return false;

    // Scene-level smart clears delegate to the storyboard (its own undo-less op).
    if (sceneFilter) {
      if (sceneClearer) { const n = await sceneClearer(sceneFilter); toast(n ? `Cleared ${n} ${sceneFilter} scene(s).` : `No ${sceneFilter} scenes to clear.`, null); }
      refreshAll();
      return true;
    }

    const snap = await snapshot(items);
    await deleteItems(items);
    if (typeof extra === 'function') { try { await extra(); } catch { /* ignore */ } }
    refreshAll();

    const size = snapshotSize(snap);
    toast(doneMsg || 'Cleared.', size ? async () => {
      await restoreSnapshot(snap);
      refreshAll();
      toast('Restored.', null);
    } : null);
    return true;
  }

  const itemsForModule = (id) => ITEMS.filter((it) => it.module === id);
  const itemsForCategory = (cat) => ITEMS.filter((it) => (it.cats || []).includes(cat));

  // --- Public API --------------------------------------------------------
  const api = {
    register(id, fn) { if (typeof fn === 'function') refreshers.set(id, fn); },
    registerScenes(fn) { if (typeof fn === 'function') sceneClearer = fn; },

    async clearModule(id) {
      const items = itemsForModule(id);
      const noun = MODULE_LABELS[id] || 'data';
      return runClear({
        title: `Clear ${noun}?`,
        message: `This removes the ${noun} for this project. Other sections are untouched. You can undo for a few seconds.`,
        items,
        okLabel: 'Clear',
        doneMsg: `Cleared ${noun}.`
      });
    },

    async resetProject() {
      return runClear({
        title: 'Reset the whole project?',
        message: 'This action will permanently remove all project data and cannot be undone. Are you sure you want to continue?',
        // Cross-project items (e.g. the Channel Brain) are intentionally kept.
        items: ITEMS.filter((it) => it.global !== false),
        okLabel: 'Reset project',
        doneMsg: 'Project reset — every section is now empty. Channel Brain kept.'
      });
    },

    async smartClear(kind) {
      const map = {
        generated: { cat: 'generated', title: 'Clear generated content?', noun: 'AI-generated content (script, audio, subtitles, storyboard, images, timeline, SEO)' },
        uploaded: { cat: 'uploaded', title: 'Clear uploaded files?', noun: 'files you uploaded (e.g. narration audio)' },
        ai: { cat: 'ai', title: 'Clear AI outputs?', noun: 'everything the AI produced (script, audio, subtitles, storyboard, SEO, chat, audit)' },
        cache: { cat: 'cache', title: 'Clear cache & temporary assets?', noun: 'cached and temporary items' },
        'completed-scenes': { scene: 'completed', title: 'Clear completed scenes?', noun: 'scenes that finished generating' },
        'failed-scenes': { scene: 'failed', title: 'Clear failed generations?', noun: 'scenes that failed to generate' }
      };
      const spec = map[kind];
      if (!spec) return false;
      if (spec.scene) {
        return runClear({ title: spec.title, message: `This removes ${spec.noun} from the storyboard. Other data is untouched.`, sceneFilter: spec.scene, okLabel: 'Clear' });
      }
      return runClear({
        title: spec.title,
        message: `This removes ${spec.noun} for this project. You can undo for a few seconds.`,
        items: itemsForCategory(spec.cat),
        okLabel: 'Clear',
        doneMsg: 'Cleared.'
      });
    }
  };
  window.BlvckData = api;

  // --- Wire the buttons --------------------------------------------------
  function wire() {
    // Per-section clear buttons: any element with data-clear="<moduleId>".
    document.querySelectorAll('[data-clear]').forEach((btn) => {
      btn.addEventListener('click', () => api.clearModule(btn.getAttribute('data-clear')));
    });
    // Global reset.
    const reset = document.getElementById('data-reset-project');
    if (reset) reset.addEventListener('click', () => api.resetProject());
    // Smart-clear modal open/close + actions.
    const smartBtn = document.getElementById('data-smart-open');
    const smartModal = document.getElementById('data-smart-modal');
    if (smartBtn && smartModal) {
      smartBtn.addEventListener('click', () => { smartModal.hidden = false; });
      smartModal.addEventListener('click', (e) => {
        if (e.target.closest('[data-close]')) { smartModal.hidden = true; return; }
        const opt = e.target.closest('[data-smart]');
        if (opt) { smartModal.hidden = true; api.smartClear(opt.getAttribute('data-smart')); }
      });
    }
    // In-memory-only modules with a Clear button but no storage still refresh.
    IN_MEMORY_MODULES.forEach((id) => { /* refresh registered by the module */ });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire);
  else wire();
})();
