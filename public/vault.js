(() => {
  'use strict';

  const DB_NAME = 'blvck-knowledge-vault';
  const DB_VERSION = 1;
  const STORE_NAME = 'resources';

  let db = null;

  function initDB() {
    return new Promise((resolve, reject) => {
      if (db) return resolve(db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = (e) => { db = e.target.result; resolve(db); };
      req.onupgradeneeded = (e) => {
        const tempDb = e.target.result;
        if (!tempDb.objectStoreNames.contains(STORE_NAME)) {
          const store = tempDb.createObjectStore(STORE_NAME, { keyPath: 'id' });
          store.createIndex('projectId', 'projectId', { unique: false });
        }
      };
    });
  }

  function getProject() {
    return window.BlvckAssets && window.BlvckAssets.title ? window.BlvckAssets.title() || 'default' : 'default';
  }

  const store = {
    async getAll() {
      await initDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readonly');
        const req = tx.objectStore(STORE_NAME).index('projectId').getAll(getProject());
        req.onsuccess = () => resolve(req.result || []);
        req.onerror = () => reject(req.error);
      });
    },
    async save(resource) {
      await initDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).put(resource);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    },
    async remove(id) {
      await initDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, 'readwrite');
        tx.objectStore(STORE_NAME).delete(id);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  };

  // --- Parsing ---

  async function parseFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    
    if (ext === 'pdf') {
      if (!window.pdfjsLib) throw new Error("PDF parser not loaded. Check internet connection.");
      window.pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
      const arrayBuffer = await file.arrayBuffer();
      const pdf = await window.pdfjsLib.getDocument({ data: arrayBuffer }).promise;
      let fullText = '';
      for (let i = 1; i <= pdf.numPages; i++) {
        const page = await pdf.getPage(i);
        const textContent = await page.getTextContent();
        fullText += textContent.items.map(s => s.str).join(' ') + '\n';
      }
      return fullText;
    } 
    else if (ext === 'docx') {
      if (!window.mammoth) throw new Error("DOCX parser not loaded. Check internet connection.");
      const arrayBuffer = await file.arrayBuffer();
      const result = await window.mammoth.extractRawText({ arrayBuffer });
      return result.value;
    }
    else {
      // txt, md, json, csv
      return await file.text();
    }
  }

  // --- Chunking ---
  
  function chunkText(text, maxWords = 400) {
    const paragraphs = text.split(/\n\s*\n/);
    const chunks = [];
    let currentChunk = [];
    let currentWords = 0;

    for (const p of paragraphs) {
      const words = p.trim().split(/\s+/).filter(Boolean);
      if (words.length === 0) continue;
      
      if (currentWords + words.length > maxWords && currentChunk.length > 0) {
        chunks.push(currentChunk.join('\n\n'));
        currentChunk = [];
        currentWords = 0;
      }
      currentChunk.push(p.trim());
      currentWords += words.length;
    }
    if (currentChunk.length > 0) chunks.push(currentChunk.join('\n\n'));
    return chunks;
  }

  // --- Retrieval / RAG Engine ---

  function tokenize(str) {
    return str.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 2);
  }

  function scoreChunk(chunkText, queryTokens) {
    const chunkTokens = tokenize(chunkText);
    const chunkTokenSet = new Set(chunkTokens);
    let score = 0;
    for (const qt of queryTokens) {
      if (chunkTokenSet.has(qt)) {
        // basic term frequency (TF)
        const tf = chunkTokens.filter(t => t === qt).length;
        score += (tf / chunkTokens.length) * 100; 
      }
    }
    return score;
  }

  const WEIGHT_MULT = { 'primary': 3.0, 'reference': 1.0, 'background': 0.3 };

  async function retrieveRelevantChunks(query, maxTotalWords = 5000) {
    const queryTokens = tokenize(query);
    if (!queryTokens.length) return []; // nothing to search

    const resources = await store.getAll();
    const enabledResources = resources.filter(r => r.enabled);
    if (!enabledResources.length) return [];

    let allScoredChunks = [];

    for (const r of enabledResources) {
      const mult = WEIGHT_MULT[r.weight] || 1.0;
      for (let i = 0; i < (r.chunks || []).length; i++) {
        const text = r.chunks[i];
        let score = scoreChunk(text, queryTokens);
        
        // Also score against the filename in case the query explicitly asks for a file's topic
        score += scoreChunk(r.name, queryTokens) * 5;

        score *= mult;

        if (score > 0) {
          allScoredChunks.push({
            score,
            filename: r.name,
            text,
            chunkIndex: i
          });
        }
      }
    }

    // Sort descending
    allScoredChunks.sort((a, b) => b.score - a.score);

    const selected = [];
    let currentWords = 0;

    for (const sc of allScoredChunks) {
      const words = sc.text.split(/\s+/).length;
      if (currentWords + words > maxTotalWords) break;
      selected.push(sc);
      currentWords += words;
    }

    return selected;
  }

  // --- UI Bindings ---

  const $ = (id) => document.getElementById(id);
  const fileInput = $('vault-file-input');
  const dropzone = $('vault-dropzone');
  const listEl = $('vault-resource-list');
  const statusEl = $('vault-status');

  async function renderUI() {
    if (!listEl) return;
    const resources = await store.getAll();
    
    statusEl.textContent = `${resources.length} document${resources.length===1?'':'s'}`;
    
    if (resources.length === 0) {
      listEl.innerHTML = `<div style="text-align:center; padding: 20px; color: #666; font-style: italic;">No resources in this project's vault yet.</div>`;
      return;
    }

    listEl.innerHTML = resources.map(r => `
      <div style="background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.08); padding: 12px; border-radius: 8px; display:flex; justify-content:space-between; align-items:center;">
        <div style="display:flex; align-items:center; gap:10px;">
          <input type="checkbox" ${r.enabled ? 'checked' : ''} onchange="window.BlvckVault.toggleEnabled('${r.id}', this.checked)" title="Enable/Disable this resource" />
          <div style="display:flex; flex-direction:column;">
            <strong style="color:${r.enabled ? '#fff' : '#666'};">${esc(r.name)}</strong>
            <span style="font-size:0.75rem; color:#888;">${new Date(r.uploadedAt).toLocaleDateString()} &middot; ${(r.chunks||[]).length} chunks</span>
          </div>
        </div>
        <div style="display:flex; align-items:center; gap: 10px;">
          <select style="padding: 2px 6px; font-size:0.8rem; background: rgba(0,0,0,0.5); border: 1px solid #333; color: #ccc; border-radius: 4px;" onchange="window.BlvckVault.changeWeight('${r.id}', this.value)">
            <option value="primary" ${r.weight==='primary'?'selected':''}>Primary Source</option>
            <option value="reference" ${r.weight==='reference'?'selected':''}>Reference</option>
            <option value="background" ${r.weight==='background'?'selected':''}>Background</option>
          </select>
          <button class="btn ghost small" style="color:#ef4444;" onclick="window.BlvckVault.removeResource('${r.id}')">Delete</button>
        </div>
      </div>
    `).join('');
  }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }

  async function handleFiles(files) {
    if (!files || files.length === 0) return;
    const projectId = getProject();
    
    for (const file of Array.from(files)) {
      try {
        const text = await parseFile(file);
        const chunks = chunkText(text);
        
        await store.save({
          id: Date.now().toString() + '-' + Math.random().toString(36).substring(2, 9),
          projectId,
          name: file.name,
          type: file.name.split('.').pop().toLowerCase(),
          content: text,
          chunks,
          weight: 'reference', // default
          enabled: true,
          uploadedAt: Date.now()
        });
      } catch (err) {
        console.error("Failed to parse file:", file.name, err);
        alert(`Failed to parse ${file.name}: ${err.message}`);
      }
    }
    renderUI();
  }

  if (dropzone) {
    dropzone.addEventListener('click', () => fileInput.click());
    dropzone.addEventListener('dragover', e => { e.preventDefault(); dropzone.style.borderColor = '#fff'; });
    dropzone.addEventListener('dragleave', e => { e.preventDefault(); dropzone.style.borderColor = 'rgba(255,255,255,0.2)'; });
    dropzone.addEventListener('drop', e => {
      e.preventDefault();
      dropzone.style.borderColor = 'rgba(255,255,255,0.2)';
      handleFiles(e.dataTransfer.files);
    });
    fileInput.addEventListener('change', e => {
      handleFiles(e.target.files);
      fileInput.value = '';
    });
  }

  // --- Public API ---

  window.BlvckVault = {
    getAll: store.getAll,
    retrieve: retrieveRelevantChunks,
    
    async toggleEnabled(id, enabled) {
      const resources = await store.getAll();
      const r = resources.find(x => x.id === id);
      if (r) { r.enabled = enabled; await store.save(r); renderUI(); }
    },
    async changeWeight(id, weight) {
      const resources = await store.getAll();
      const r = resources.find(x => x.id === id);
      if (r) { r.weight = weight; await store.save(r); renderUI(); }
    },
    async removeResource(id) {
      if (confirm('Delete this resource from the vault?')) {
        await store.remove(id);
        renderUI();
      }
    },
    refreshUI: renderUI
  };

  // Hook into router to refresh UI when switching to vault tab
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-workspace="vault"]');
    if (btn) setTimeout(renderUI, 50);
  });
  
  // Refresh when project changes (approximate, since we don't have an event bus)
  let lastProject = getProject();
  setInterval(() => {
    const current = getProject();
    if (current !== lastProject) {
      lastProject = current;
      renderUI();
    }
  }, 1000);

})();
