(() => {
  'use strict';

  // Project layer. Each project owns a "working set" — the localStorage keys
  // and IndexedDB blob stores the other modules already read/write. Only one
  // project is "live" (its working set is the active data). Switching a
  // project snapshots the live working set into the outgoing project, restores
  // the incoming project's snapshot into the working set, and reloads so every
  // module re-initialises cleanly. Modules are untouched.

  const $ = (id) => document.getElementById(id);

  const REG_KEY = 'blvck-tts:projects';
  const ACTIVE_KEY = 'blvck-tts:activeProject';
  // localStorage keys that belong to a project (voice/style, audio batch,
  // storyboard, editor timeline, project title). Presets/favorites/recents
  // stay global.
  const WORKING_LS = [
    'blvck-tts:settings',
    'blvck-tts:narration',
    'blvck-tts:batch',
    'blvck-tts:storyboard',
    'blvck-tts:editor'
  ];
  // IndexedDB blob stores that belong to a project.
  const LIVE_STORES = [
    { db: 'blvck-tts', store: 'audio' },
    { db: 'blvck-storyboard', store: 'images' }
  ];
  const SNAP_DB = 'blvck-projects';
  const SNAP_STORE = 'snapshots';

  // --- IndexedDB helpers (ensure store exists) ---------------------------

  function rawOpen(name, version, upgrade) {
    return new Promise((resolve, reject) => {
      const req = version ? indexedDB.open(name, version) : indexedDB.open(name);
      if (upgrade) req.onupgradeneeded = () => upgrade(req.result);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function openWithStore(name, store) {
    let db = await rawOpen(name);
    if (!db.objectStoreNames.contains(store)) {
      const v = db.version + 1;
      db.close();
      db = await rawOpen(name, v, (d) => {
        if (!d.objectStoreNames.contains(store)) d.createObjectStore(store);
      });
    }
    return db;
  }

  async function storeGetAll(dbName, store) {
    try {
      const db = await rawOpen(dbName);
      if (!db.objectStoreNames.contains(store)) {
        db.close();
        return [];
      }
      const entries = await new Promise((resolve, reject) => {
        const out = [];
        const tx = db.transaction(store, 'readonly');
        const rq = tx.objectStore(store).openCursor();
        rq.onsuccess = () => {
          const cur = rq.result;
          if (cur) {
            out.push({ key: cur.key, value: cur.value });
            cur.continue();
          }
        };
        tx.oncomplete = () => resolve(out);
        tx.onerror = () => reject(tx.error);
      });
      db.close();
      return entries;
    } catch {
      return [];
    }
  }

  async function storeReplace(dbName, store, entries) {
    const db = await openWithStore(dbName, store);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(store, 'readwrite');
      const os = tx.objectStore(store);
      os.clear();
      for (const e of entries) os.put(e.value, e.key);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }

  async function snapPut(id, snapshot) {
    const db = await openWithStore(SNAP_DB, SNAP_STORE);
    await new Promise((resolve, reject) => {
      const tx = db.transaction(SNAP_STORE, 'readwrite');
      tx.objectStore(SNAP_STORE).put(snapshot, id);
      tx.oncomplete = resolve;
      tx.onerror = () => reject(tx.error);
    });
    db.close();
  }
  async function snapGet(id) {
    try {
      const db = await openWithStore(SNAP_DB, SNAP_STORE);
      const v = await new Promise((resolve, reject) => {
        const rq = db.transaction(SNAP_STORE, 'readonly').objectStore(SNAP_STORE).get(id);
        rq.onsuccess = () => resolve(rq.result || null);
        rq.onerror = () => reject(rq.error);
      });
      db.close();
      return v;
    } catch {
      return null;
    }
  }
  async function snapDelete(id) {
    try {
      const db = await openWithStore(SNAP_DB, SNAP_STORE);
      await new Promise((resolve) => {
        const tx = db.transaction(SNAP_STORE, 'readwrite');
        tx.objectStore(SNAP_STORE).delete(id);
        tx.oncomplete = resolve;
        tx.onerror = resolve;
      });
      db.close();
    } catch {
      /* ignore */
    }
  }

  // --- Registry ----------------------------------------------------------

  function getRegistry() {
    try {
      return JSON.parse(localStorage.getItem(REG_KEY) || '[]');
    } catch {
      return [];
    }
  }
  function setRegistry(list) {
    localStorage.setItem(REG_KEY, JSON.stringify(list));
  }
  function getActiveId() {
    return localStorage.getItem(ACTIVE_KEY) || '';
  }
  function newId() {
    return `proj-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  }

  function liveCounts() {
    const read = (k) => {
      try {
        return JSON.parse(localStorage.getItem(k) || 'null');
      } catch {
        return null;
      }
    };
    const sb = read('blvck-tts:storyboard');
    const batch = read('blvck-tts:batch');
    const editor = read('blvck-tts:editor');
    return {
      scenes: sb && sb.scenes ? sb.scenes.filter((s) => s.status === 'done').length : 0,
      audioParts: batch && batch.items ? batch.items.length : 0,
      clips: editor && editor.clips ? editor.clips.length : 0
    };
  }

  function liveTitle() {
    try {
      const n = JSON.parse(localStorage.getItem('blvck-tts:narration') || 'null');
      return (n && n.title) || '';
    } catch {
      return '';
    }
  }

  // --- Snapshot / restore ------------------------------------------------

  async function collectWorkingSet() {
    const meta = {};
    for (const k of WORKING_LS) meta[k] = localStorage.getItem(k);
    const blobs = [];
    for (const { db, store } of LIVE_STORES) {
      const entries = await storeGetAll(db, store);
      for (const e of entries) blobs.push({ db, store, key: e.key, value: e.value });
    }
    return { meta, blobs };
  }

  async function snapshotActive() {
    const id = getActiveId();
    if (!id) return;
    const snap = await collectWorkingSet();
    await snapPut(id, snap);
    // Refresh registry metadata for the active project.
    const reg = getRegistry();
    const entry = reg.find((p) => p.id === id);
    if (entry) {
      entry.updatedAt = Date.now();
      entry.counts = liveCounts();
      const t = liveTitle();
      if (t) entry.name = t;
      setRegistry(reg);
    }
  }

  function clearWorkingSetLocal() {
    for (const k of WORKING_LS) localStorage.removeItem(k);
  }

  async function clearWorkingSetBlobs() {
    for (const { db, store } of LIVE_STORES) await storeReplace(db, store, []);
  }

  async function restoreSnapshot(snap) {
    clearWorkingSetLocal();
    if (snap && snap.meta) {
      for (const k of WORKING_LS) {
        if (snap.meta[k] != null) localStorage.setItem(k, snap.meta[k]);
      }
    }
    // Group blobs by store and replace.
    const byStore = new Map();
    for (const { db, store } of LIVE_STORES) byStore.set(`${db}/${store}`, []);
    if (snap && snap.blobs) {
      for (const b of snap.blobs) {
        const arr = byStore.get(`${b.db}/${b.store}`);
        if (arr) arr.push({ key: b.key, value: b.value });
      }
    }
    for (const { db, store } of LIVE_STORES) await storeReplace(db, store, byStore.get(`${db}/${store}`));
  }

  // --- Actions -----------------------------------------------------------

  async function switchTo(id) {
    if (id === getActiveId()) {
      closeModal();
      return;
    }
    await snapshotActive();
    const snap = await snapGet(id);
    await restoreSnapshot(snap || { meta: {}, blobs: [] });
    localStorage.setItem(ACTIVE_KEY, id);
    location.reload();
  }

  async function createProject(name) {
    await snapshotActive();
    // Blank working set becomes the new project.
    clearWorkingSetLocal();
    await clearWorkingSetBlobs();
    const id = newId();
    const reg = getRegistry();
    reg.push({ id, name: name || 'Untitled Project', createdAt: Date.now(), updatedAt: Date.now(), archived: false, counts: { scenes: 0, audioParts: 0, clips: 0 } });
    setRegistry(reg);
    // Seed the title so the new project shows the chosen name.
    localStorage.setItem('blvck-tts:narration', JSON.stringify({ title: name || '' }));
    localStorage.setItem(ACTIVE_KEY, id);
    location.reload();
  }

  async function duplicateProject(id) {
    if (id === getActiveId()) await snapshotActive();
    const snap = (await snapGet(id)) || { meta: {}, blobs: [] };
    const reg = getRegistry();
    const src = reg.find((p) => p.id === id);
    const newIdVal = newId();
    const copyName = `${(src && src.name) || 'Project'} (copy)`;
    // Copy the title inside the snapshot meta so the duplicate is renamed.
    const meta = { ...(snap.meta || {}) };
    meta['blvck-tts:narration'] = JSON.stringify({ title: copyName });
    await snapPut(newIdVal, { meta, blobs: snap.blobs || [] });
    reg.push({ id: newIdVal, name: copyName, createdAt: Date.now(), updatedAt: Date.now(), archived: false, counts: (src && src.counts) || {} });
    setRegistry(reg);
    render();
  }

  function renameProject(id) {
    const reg = getRegistry();
    const entry = reg.find((p) => p.id === id);
    if (!entry) return;
    const next = prompt('Rename project:', entry.name);
    if (!next || !next.trim()) return;
    entry.name = next.trim().slice(0, 80);
    entry.updatedAt = Date.now();
    setRegistry(reg);
    if (id === getActiveId()) {
      localStorage.setItem('blvck-tts:narration', JSON.stringify({ title: entry.name }));
      const ti = $('title-input');
      if (ti) ti.value = entry.name;
    }
    render();
    updateActiveName();
  }

  function archiveProject(id, archived) {
    const reg = getRegistry();
    const entry = reg.find((p) => p.id === id);
    if (!entry) return;
    entry.archived = archived;
    setRegistry(reg);
    render();
  }

  async function deleteProject(id) {
    const reg = getRegistry();
    const entry = reg.find((p) => p.id === id);
    if (!entry) return;
    if (id === getActiveId()) {
      alert('Switch to another project before deleting the active one.');
      return;
    }
    if (!confirm(`Delete project “${entry.name}” and all its assets? This cannot be undone.`)) return;
    await snapDelete(id);
    setRegistry(reg.filter((p) => p.id !== id));
    render();
  }

  // --- Bootstrap ---------------------------------------------------------

  function ensureActiveProject() {
    let reg = getRegistry();
    let active = getActiveId();
    if (!reg.length) {
      // Adopt any pre-existing working set as the first project.
      const id = newId();
      reg = [{ id, name: liveTitle() || 'Untitled Project', createdAt: Date.now(), updatedAt: Date.now(), archived: false, counts: liveCounts() }];
      setRegistry(reg);
      localStorage.setItem(ACTIVE_KEY, id);
      active = id;
    } else if (!active || !reg.some((p) => p.id === active)) {
      active = reg.find((p) => !p.archived)?.id || reg[0].id;
      localStorage.setItem(ACTIVE_KEY, active);
    }
    return active;
  }

  // --- UI ----------------------------------------------------------------

  const modal = $('projects-modal');
  const listEl = $('proj-list');
  const searchEl = $('proj-search');
  const sortEl = $('proj-sort');
  const archivedEl = $('proj-archived');

  function openModal() {
    // Keep the active project's counts fresh.
    const reg = getRegistry();
    const entry = reg.find((p) => p.id === getActiveId());
    if (entry) {
      entry.counts = liveCounts();
      const t = liveTitle();
      if (t) entry.name = t;
      setRegistry(reg);
    }
    modal.hidden = false;
    document.body.classList.add('modal-open');
    render();
  }
  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function fmtDate(ts) {
    try {
      return new Date(ts).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
      return '';
    }
  }

  function render() {
    const active = getActiveId();
    let reg = getRegistry();
    const q = (searchEl.value || '').trim().toLowerCase();
    const showArchived = archivedEl.checked;

    reg = reg.filter((p) => (showArchived ? true : !p.archived) && (!q || p.name.toLowerCase().includes(q)));
    const sort = sortEl.value;
    reg.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name);
      if (sort === 'created') return b.createdAt - a.createdAt;
      return b.updatedAt - a.updatedAt;
    });

    listEl.innerHTML = '';
    if (!reg.length) {
      const empty = document.createElement('div');
      empty.className = 'voice-empty';
      empty.textContent = q ? 'No projects match your search.' : 'No projects yet.';
      listEl.appendChild(empty);
      return;
    }

    reg.forEach((p) => {
      const row = document.createElement('div');
      row.className = 'proj-item' + (p.id === active ? ' active' : '') + (p.archived ? ' archived' : '');

      const info = document.createElement('div');
      info.className = 'proj-info';
      const name = document.createElement('div');
      name.className = 'proj-name';
      name.append(p.name);
      if (p.id === active) {
        const tag = document.createElement('span');
        tag.className = 'proj-active-tag';
        tag.textContent = 'ACTIVE';
        name.appendChild(tag);
      }
      const c = p.counts || {};
      const meta = document.createElement('div');
      meta.className = 'proj-meta';
      meta.textContent = `${c.scenes || 0} images · ${c.audioParts || 0} audio · ${c.clips || 0} clips · updated ${fmtDate(p.updatedAt)}`;
      info.append(name, meta);

      const actions = document.createElement('div');
      actions.className = 'proj-actions';
      const btn = (label, fn, danger) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        if (danger) b.className = 'danger';
        b.addEventListener('click', fn);
        return b;
      };
      if (p.id !== active) actions.appendChild(btn('Open', () => switchTo(p.id)));
      actions.appendChild(btn('Rename', () => renameProject(p.id)));
      actions.appendChild(btn('Duplicate', () => duplicateProject(p.id)));
      actions.appendChild(btn(p.archived ? 'Unarchive' : 'Archive', () => archiveProject(p.id, !p.archived)));
      if (p.id !== active) actions.appendChild(btn('Delete', () => deleteProject(p.id), true));

      row.append(info, actions);
      listEl.appendChild(row);
    });
  }

  function updateActiveName() {
    const reg = getRegistry();
    const entry = reg.find((p) => p.id === getActiveId());
    const el = $('active-project-name');
    if (el) el.textContent = (entry && entry.name) || liveTitle() || 'Untitled Project';
  }

  // --- Wire up -----------------------------------------------------------

  ensureActiveProject();
  updateActiveName();

  $('projects-open').addEventListener('click', openModal);
  $('project-new').addEventListener('click', () => {
    const name = prompt('New project name:', '');
    if (name === null) return;
    createProject(name.trim());
  });
  $('proj-new').addEventListener('click', () => {
    const name = prompt('New project name:', '');
    if (name === null) return;
    createProject(name.trim());
  });
  searchEl.addEventListener('input', render);
  sortEl.addEventListener('change', render);
  archivedEl.addEventListener('change', render);
  modal.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeModal();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !modal.hidden) closeModal();
  });

  // Keep the active project's name in sync when the title field changes.
  const titleInput = $('title-input');
  if (titleInput) {
    titleInput.addEventListener('change', () => {
      const reg = getRegistry();
      const entry = reg.find((p) => p.id === getActiveId());
      if (entry && titleInput.value.trim()) {
        entry.name = titleInput.value.trim();
        entry.updatedAt = Date.now();
        setRegistry(reg);
        updateActiveName();
      }
    });
  }
})();
