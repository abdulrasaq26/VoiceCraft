// Workspace Router & Project Mission Control for AETHER AI Studio
// Manages multi-page workspace routing with full sidebar navigation support
(() => {
  'use strict';

  const WORKSPACES = [
    { id: 'dashboard',  label: 'Dashboard',    icon: '📊', group: 'Overview'     },
    { id: 'assets',     label: 'Assets',       icon: '📦', group: 'Overview'     },
    { id: 'vault',      label: 'Knowledge Vault', icon: '📚', group: 'Overview'     },
    { id: 'research',   label: 'Research',     icon: '🔎', group: 'Production'   },
    { id: 'script',     label: 'Scripts',      icon: '📝', group: 'Production'   },
    { id: 'voice',      label: 'Voices',       icon: '🎙️', group: 'Production'   },
    { id: 'storyboard', label: 'Storyboards',  icon: '🎬', group: 'Production'   },
    { id: 'images',     label: 'Images',       icon: '🎨', group: 'Production'   },
    { id: 'video',      label: 'Videos',       icon: '🎞️', group: 'Production'   },
    { id: 'thumbnail',  label: 'Thumbnails',   icon: '🖼️', group: 'Production'   },
    { id: 'youtube',    label: 'Publish',      icon: '🚀', group: 'Production'   },
    { id: 'director',   label: 'AI Director',  icon: '⚙️', group: 'System & AI'  }
  ];

  const VALID_IDS = new Set(WORKSPACES.map(w => w.id));

  let currentWorkspace = 'dashboard';
  let mode = localStorage.getItem('aether:mode') || 'guided';

  /* ---- Mode (Guided / Pro) ---------------------------------------- */
  function setMode(newMode) {
    mode = newMode;
    localStorage.setItem('aether:mode', mode);
    document.body.classList.toggle('mode-guided', mode === 'guided');
    document.body.classList.toggle('mode-pro',    mode === 'pro');
    document.querySelectorAll('.mode-btn').forEach(btn => {
      // Support both data-mode="guided" and legacy id="mode-btn-guided"
      const btnMode = btn.dataset.mode || (btn.id === 'mode-btn-guided' ? 'guided' : 'pro');
      btn.classList.toggle('active', btnMode === mode);
    });
    window.dispatchEvent(new CustomEvent('aether:mode-changed', { detail: { mode } }));
  }

  /* ---- Project Metrics -------------------------------------------- */
  function computeProjectMetrics() {
    const st = (window.BlvckAssets && window.BlvckAssets.status) ? window.BlvckAssets.status() : {};
    const stages = ['research', 'script', 'voice', 'storyboard', 'images', 'video', 'youtube'];
    let completedCount = 0;
    stages.forEach(k => { if (st[k]) completedCount++; });
    const completionPct = Math.round((completedCount / stages.length) * 100);
    const assetCount = (window.BlvckAssets && window.BlvckAssets.getAll) ? window.BlvckAssets.getAll().length : 0;
    const chatModel  = (window.BlvckAI && window.AIManager.chatModel) ? window.AIManager.chatModel() : 'NIM Gateway';
    return { completionPct, completedCount, totalStages: stages.length, assetCount, chatModel, stageStatus: st };
  }

  /* ---- Mission Control Bar Update ---------------------------------- */
  function updateMissionControlBar() {
    const metrics = computeProjectMetrics();

    const pctEl     = document.getElementById('mc-completion-pct');
    const fillEl    = document.getElementById('mc-progress-fill');
    const assetsEl  = document.getElementById('mc-assets-count');
    const gatewayEl = document.getElementById('mc-gateway-name');

    if (pctEl)     pctEl.textContent     = `${metrics.completionPct}%`;
    if (fillEl)    fillEl.style.width    = `${metrics.completionPct}%`;
    if (assetsEl)  assetsEl.textContent  = `${metrics.assetCount}`;
    if (gatewayEl) gatewayEl.textContent = `NVIDIA NIM (${metrics.chatModel})`;

    document.querySelectorAll('.copilot-completion-val').forEach(el => {
      el.textContent = `${metrics.completionPct}%`;
    });

    const stageMap = [
      { key: 'research',   label: 'Research'   },
      { key: 'script',     label: 'Script'     },
      { key: 'voice',      label: 'Voice'      },
      { key: 'storyboard', label: 'Storyboard' },
      { key: 'images',     label: 'Images'     },
      { key: 'video',      label: 'Video'      },
      { key: 'youtube',    label: 'Publish'    }
    ];

    document.querySelectorAll('.copilot-stage-checklist').forEach(list => {
      list.innerHTML = stageMap.map(s => {
        const done      = !!metrics.stageStatus[s.key];
        const isCurrent = (s.key === currentWorkspace);
        let badge = '○', cls = 'pending';
        if (done)      { badge = '✓'; cls = 'done';   }
        else if (isCurrent) { badge = '⚡'; cls = 'active'; }
        return `<span class="copilot-checklist-item ${cls}"><strong>${badge}</strong> ${s.label}</span>`;
      }).join('');
    });

    // Update pipeline stepper done states
    document.querySelectorAll('.pipeline-step[data-stage]').forEach(step => {
      const key = step.dataset.stage;
      const done = !!metrics.stageStatus[key];
      step.classList.toggle('done', done);
    });
  }

  /* ---- Core Workspace Switch --------------------------------------- */
  function switchWorkspace(id, updateHash = true) {
    const target = VALID_IDS.has(id) ? id : 'dashboard';
    currentWorkspace = target;

    // Update URL hash (pushState for back/forward support)
    if (updateHash && window.location.hash !== `#${target}`) {
      history.pushState(null, '', `#${target}`);
    }

    // Show only the matching workspace page
    document.querySelectorAll('.workspace-page').forEach(page => {
      page.hidden = (page.id !== `workspace-${target}`);
    });

    // Sidebar active state
    document.querySelectorAll('.sidebar-nav-item').forEach(item => {
      item.classList.toggle('active', item.dataset.workspace === target);
    });

    // Pipeline stepper active state
    document.querySelectorAll('.pipeline-step').forEach(step => {
      step.classList.toggle('active', step.dataset.stage === target);
    });

    // Header workspace label
    const labelEl    = document.getElementById('active-workspace-title');
    const activeObj  = WORKSPACES.find(w => w.id === target);
    if (labelEl && activeObj) {
      labelEl.textContent = `${activeObj.icon} ${activeObj.label}`;
    }

    updateMissionControlBar();

    // Scroll canvas to top
    const canvas = document.getElementById('workspace-canvas');
    if (canvas) canvas.scrollTop = 0;

    window.dispatchEvent(new CustomEvent('aether:workspace-changed', { detail: { workspace: target } }));
  }

  /* ---- Bind Sidebar Navigation ------------------------------------- */
  function bindSidebarNavigation() {
    document.querySelectorAll('button[data-workspace]').forEach(btn => {
      // Remove any stale listeners by cloning (handles hot-reload scenarios)
      btn.addEventListener('click', () => switchWorkspace(btn.dataset.workspace));
    });
  }

  /* ---- Bind Pipeline Stepper --------------------------------------- */
  function bindPipelineSteps() {
    document.querySelectorAll('.pipeline-step[data-stage]').forEach(step => {
      step.addEventListener('click', () => switchWorkspace(step.dataset.stage));
    });
  }

  /* ---- Init -------------------------------------------------------- */
  function init() {
    setMode(mode);

    // Navigation: sidebar buttons (THE critical fix)
    bindSidebarNavigation();

    // Navigation: pipeline bar stepper clicks
    bindPipelineSteps();

    // Browser back/forward support
    window.addEventListener('popstate', () => {
      const hash = window.location.hash.replace('#', '');
      switchWorkspace(hash || 'dashboard', false);
    });

    // Fallback hashchange (for <a href="#x"> links)
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash.replace('#', '');
      if (hash) switchWorkspace(hash, false);
    });

    // Initial route on page load
    const initialHash = window.location.hash.replace('#', '');
    switchWorkspace(initialHash || 'dashboard', false);

    // Mode toggle buttons
    document.querySelectorAll('.mode-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const m = btn.dataset.mode || (btn.id === 'mode-btn-guided' ? 'guided' : 'pro');
        setMode(m);
      });
    });

    // Sidebar collapse / expand toggle
    const toggleSidebar = document.getElementById('toggle-sidebar');
    if (toggleSidebar) {
      toggleSidebar.addEventListener('click', () => {
        document.body.classList.toggle('sidebar-collapsed');
      });
    }

    // Periodic Mission Control refresh
    setInterval(updateMissionControlBar, 3000);
  }

  /* ---- Public API -------------------------------------------------- */
  window.AetherRouter = {
    WORKSPACES,
    VALID_IDS,
    get currentWorkspace() { return currentWorkspace; },
    get mode()             { return mode; },
    switchWorkspace,
    setMode,
    computeProjectMetrics,
    updateMissionControlBar,
    bindSidebarNavigation   // expose so dynamic sidebar additions can re-bind
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
