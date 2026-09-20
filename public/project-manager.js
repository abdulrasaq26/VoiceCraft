// Project Manager for VoiceCraft
// Links VoiceCraft's localStorage state to the AutoEditor IndexedDB "projects" store.

document.addEventListener('DOMContentLoaded', () => {
  const saveBtn = document.getElementById('save-project-btn');
  const loadBtn = document.getElementById('load-project-btn');
  const titleInput = document.getElementById('title-input');
  const textInput = document.getElementById('text-input');

  const LS_KEYS = {
    settings: 'blvck-tts:settings',
    batch: 'blvck-tts:batch',
    narration: 'blvck-tts:narration'
  };

  // Check if we are currently tracking a project ID
  let currentProjectId = localStorage.getItem('blvck-tts:currentProjectId');

  async function saveProject() {
    saveBtn.textContent = 'Saving...';
    saveBtn.disabled = true;

    try {
      const title = titleInput ? titleInput.value.trim() : 'Untitled Project';
      
      // Collect current VC state directly from localStorage where VoiceCraft autosaves it
      const vcState = {
        settings: JSON.parse(localStorage.getItem(LS_KEYS.settings) || '{}'),
        batch: JSON.parse(localStorage.getItem(LS_KEYS.batch) || 'null'),
        narration: JSON.parse(localStorage.getItem(LS_KEYS.narration) || '{}')
      };

      // Always update narration title to match input before saving
      vcState.narration.title = title;
      
      const allProjs = await window.SharedDB.listProjects();
      
      let rec;
      // If we already have an active ID, use it.
      if (currentProjectId) {
        rec = await window.SharedDB.getProject(currentProjectId);
      }
      
      // If we don't have an ID, or the ID was deleted, match by name or create new
      if (!rec) {
        let match = allProjs.find(p => p.name === title);
        if (match) {
          rec = await window.SharedDB.getProject(match.id);
          currentProjectId = rec.id;
        } else {
          currentProjectId = window.SharedDB.newId();
          rec = { id: currentProjectId, createdAt: Date.now(), data: {} };
        }
        localStorage.setItem('blvck-tts:currentProjectId', currentProjectId);
      }

      rec.name = title;
      rec.vcState = vcState; // Embed VoiceCraft's state

      await window.SharedDB.saveProject(rec);

      // Now copy all "done" audio chunks from VoiceCraft's IndexedDB into AutoEditor's media store
      if (vcState.batch && vcState.batch.items) {
        const vcDbPromise = new Promise((resolve, reject) => {
          const req = indexedDB.open("blvck-tts", 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const vcDb = await vcDbPromise;
        const batchId = vcState.batch.id;
        
        for (const item of vcState.batch.items) {
          if (item.status === 'done') {
            const key = `${batchId}:${item.index}`;
            const blob = await new Promise((resolve) => {
              const tx = vcDb.transaction("audio", "readonly");
              const store = tx.objectStore("audio");
              const getReq = store.get(key);
              getReq.onsuccess = () => resolve(getReq.result);
              getReq.onerror = () => resolve(null);
            });
            if (blob) {
              // Wait, AutoEditor's timeline build expects media files imported via "slots". 
              // We don't want to mess up AE's timeline by dumping raw blobs without slots.
              // We'll leave the transfer logic to the "Auto Editor" button.
              // BUT we want persistence! VoiceCraft's blobs are already persistent in blvck-tts DB.
            }
          }
        }
        vcDb.close();
      }

      saveBtn.textContent = 'Saved!';
      setTimeout(() => {
        saveBtn.textContent = '💾 Save Project';
        saveBtn.disabled = false;
      }, 2000);
    } catch (err) {
      console.error(err);
      saveBtn.textContent = 'Error';
      setTimeout(() => {
        saveBtn.textContent = '💾 Save Project';
        saveBtn.disabled = false;
      }, 2000);
    }
  }

  // Projects Modal
  const modalHTML = `
    <div id="projects-modal" class="modal" hidden role="dialog">
      <div class="modal-backdrop" data-close-projects></div>
      <div class="modal-panel" style="max-width: 600px;">
        <div class="modal-header">
          <h2>Select a Project</h2>
          <button class="modal-close" type="button" data-close-projects>&times;</button>
        </div>
        <div class="modal-body" style="max-height: 60vh; overflow-y: auto; display: flex; flex-direction: column; gap: 8px;" id="projects-list">
          Loading...
        </div>
      </div>
    </div>
  `;
  document.body.insertAdjacentHTML('beforeend', modalHTML);

  const modal = document.getElementById('projects-modal');
  const listContainer = document.getElementById('projects-list');

  document.querySelectorAll('[data-close-projects]').forEach(el => {
    el.addEventListener('click', () => modal.hidden = true);
  });

  async function loadProject(id) {
    const rec = await window.SharedDB.getProject(id);
    if (!rec || !rec.vcState) {
      alert("This project doesn't have VoiceCraft data yet.");
      return;
    }
    
    // Set the current ID
    localStorage.setItem('blvck-tts:currentProjectId', rec.id);
    
    // Restore localStorage
    if (rec.vcState.settings) localStorage.setItem(LS_KEYS.settings, JSON.stringify(rec.vcState.settings));
    if (rec.vcState.batch) localStorage.setItem(LS_KEYS.batch, JSON.stringify(rec.vcState.batch));
    if (rec.vcState.narration) localStorage.setItem(LS_KEYS.narration, JSON.stringify(rec.vcState.narration));
    
    // Reload the page to cleanly initialize everything with the new localStorage
    window.location.reload();
  }

  async function showProjects() {
    modal.hidden = false;
    listContainer.innerHTML = 'Loading...';
    try {
      const all = await window.SharedDB.listProjects();
      if (all.length === 0) {
        listContainer.innerHTML = '<p>No projects found. Save a project first!</p>';
        return;
      }
      
      listContainer.innerHTML = '';
      all.forEach(p => {
        const btn = document.createElement('div');
        btn.style.padding = '12px';
        btn.style.background = 'var(--bg-surface)';
        btn.style.border = '1px solid var(--border)';
        btn.style.borderRadius = '8px';
        btn.style.cursor = 'pointer';
        btn.style.display = 'flex';
        btn.style.justifyContent = 'space-between';
        btn.style.alignItems = 'center';
        
        const infoDiv = document.createElement('div');
        infoDiv.style.display = 'flex';
        infoDiv.style.flexDirection = 'column';
        
        const titleSpan = document.createElement('strong');
        titleSpan.textContent = p.name || 'Untitled';
        
        const dateSpan = document.createElement('span');
        dateSpan.style.fontSize = '0.85em';
        dateSpan.style.color = 'var(--text-dim)';
        dateSpan.textContent = new Date(p.updatedAt).toLocaleString();
        
        infoDiv.appendChild(titleSpan);
        infoDiv.appendChild(dateSpan);
        
        const delBtn = document.createElement('button');
        delBtn.textContent = '🗑️ Delete';
        delBtn.className = 'btn';
        delBtn.style.padding = '4px 8px';
        delBtn.style.background = '#4a1111';
        delBtn.style.color = '#ff9999';
        delBtn.style.border = 'none';
        delBtn.style.borderRadius = '4px';
        delBtn.style.cursor = 'pointer';
        
        delBtn.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (confirm(`Are you sure you want to delete "${p.name || 'Untitled'}"? This will delete both the VoiceCraft script and the AutoEditor timeline.`)) {
            await window.SharedDB.deleteProject(p.id);
            if (localStorage.getItem('blvck-tts:currentProjectId') === p.id) {
              localStorage.removeItem('blvck-tts:currentProjectId');
            }
            showProjects(); // refresh the list
          }
        });
        
        btn.appendChild(infoDiv);
        btn.appendChild(delBtn);
        
        btn.addEventListener('click', () => loadProject(p.id));
        listContainer.appendChild(btn);
      });
    } catch (err) {
      listContainer.innerHTML = '<p>Error loading projects.</p>';
    }
  }

  if (saveBtn) saveBtn.addEventListener('click', saveProject);
  if (loadBtn) loadBtn.addEventListener('click', showProjects);

  // Auto-set the project ID on handoff so AutoEditor knows which one we are working on
  const originalOpen = window.open;
  window.open = function(url, target, features) {
    if (url.includes('/auto-editor/index.html') && currentProjectId) {
      // Handoff uses IndexedDB transfer_* keys. We just need to add transfer_projectId
      const req = indexedDB.open("blvck-tts", 1);
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("audio", "readwrite");
        tx.objectStore("audio").put(currentProjectId, "transfer_projectId");
      };
    }
    return originalOpen(url, target, features);
  };
});
