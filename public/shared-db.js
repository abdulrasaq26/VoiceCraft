// Shared IndexedDB layer for VoiceCraft and AutoEditor
// Interacts with the "autoeditor" database.

window.SharedDB = (function() {
  const DB_NAME = "autoeditor";
  const DB_VERSION = 1;
  const STORE_PROJECTS = "projects";
  const STORE_MEDIA = "media";

  let dbPromise = null;

  function openDB() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_PROJECTS)) db.createObjectStore(STORE_PROJECTS, { keyPath: "id" });
        if (!db.objectStoreNames.contains(STORE_MEDIA)) db.createObjectStore(STORE_MEDIA);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode, fn) {
    return openDB().then((db) => new Promise((resolve, reject) => {
      const t = db.transaction(store, mode);
      const s = t.objectStore(store);
      let out;
      Promise.resolve(fn(s)).then((v) => { out = v; }).catch(reject);
      t.oncomplete = () => resolve(out);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    }));
  }

  function reqP(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function newId() {
    return "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  return {
    newId,
    async listProjects() {
      const all = await tx(STORE_PROJECTS, "readonly", (s) => reqP(s.getAll()));
      return (all || []).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    async getProject(id) {
      return tx(STORE_PROJECTS, "readonly", (s) => reqP(s.get(id)));
    },
    async saveProject(record) {
      let existing = null;
      try { existing = await this.getProject(record.id); } catch(e) {}
      const rec = existing ? { ...existing, ...record, updatedAt: Date.now() } : { ...record, updatedAt: Date.now() };
      await tx(STORE_PROJECTS, "readwrite", (s) => reqP(s.put(rec)));
      return rec;
    },
    async putMedia(projectId, mediaId, blob) {
      await tx(STORE_MEDIA, "readwrite", (s) => reqP(s.put(blob, `${projectId}/${mediaId}`)));
    },
    async getMedia(projectId, mediaId) {
      return tx(STORE_MEDIA, "readonly", (s) => reqP(s.get(`${projectId}/${mediaId}`)));
    }
  };
})();
