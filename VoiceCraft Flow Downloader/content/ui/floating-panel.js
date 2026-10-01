// content/ui/floating-panel.js
//
// One manager for the extension's floating panels (Downloader, Automator,
// Prompt Recovery): drag by the header, stay inside the window, and reopen
// where they were left. Double-click a header to put a panel back.
//
//   FloatingPanelManager.register(id, { el, handle, show, hide, isOpen })
//   FloatingPanelManager.open(id) / close(id) / toggle(id)
//   FloatingPanelManager.move(id, left, top)
//   FloatingPanelManager.restorePosition(id) / savePosition(id)

(function () {
  if (window.FloatingPanelManager) return;

  const STORE_KEY = 'vcPanelPositions';
  const MARGIN = 8;          // keep this far from the window edges
  const GRAB = 48;           // at least this much of the header stays reachable
  const panels = new Map();  // id -> { el, handle, show, hide, isOpen, moved }
  let saved = {};            // id -> { left, top }

  const storage = (() => {
    try { if (chrome && chrome.storage && chrome.storage.local) return chrome.storage.local; } catch (e) { /* no extension storage */ }
    return null;
  })();
  const loaded = new Promise((resolve) => {
    if (!storage) {
      try { saved = JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { saved = {}; }
      resolve();
      return;
    }
    try {
      storage.get(STORE_KEY, (r) => { saved = (r && r[STORE_KEY]) || {}; resolve(); });
    } catch (e) { resolve(); }
  });
  const persist = () => {
    try {
      if (storage) storage.set({ [STORE_KEY]: saved });
      else localStorage.setItem(STORE_KEY, JSON.stringify(saved));
    } catch (e) { /* ignore */ }
  };

  const clamp = (p, left, top) => {
    const r = p.el.getBoundingClientRect();
    const w = r.width || 320;
    const vw = window.innerWidth, vh = window.innerHeight;
    const maxLeft = Math.max(MARGIN, vw - Math.min(w, vw) - MARGIN);
    return {
      left: Math.round(Math.min(Math.max(left, MARGIN), w > vw ? MARGIN : maxLeft)),
      top: Math.round(Math.min(Math.max(top, MARGIN), Math.max(MARGIN, vh - GRAB))),
    };
  };

  const place = (p, left, top) => {
    const s = p.el.style;
    s.left = left + 'px';
    s.top = top + 'px';
    s.right = 'auto';
    s.bottom = 'auto';
    s.transform = 'none';
  };

  const clearPlacement = (p) => {
    const s = p.el.style;
    s.left = s.top = s.right = s.bottom = s.transform = '';
  };

  const isControl = (t) => !!(t && t.closest && t.closest('button, input, select, textarea, a, label, [data-nodrag]'));

  function wireDrag(id, p) {
    let start = null;
    p.handle.style.cursor = 'grab';
    p.handle.style.userSelect = 'none';
    p.handle.style.touchAction = 'none';
    p.handle.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || isControl(e.target)) return;
      const r = p.el.getBoundingClientRect();
      start = { x: e.clientX, y: e.clientY, left: r.left, top: r.top };
      p.handle.setPointerCapture(e.pointerId);
      p.handle.style.cursor = 'grabbing';
      e.preventDefault();
    });
    p.handle.addEventListener('pointermove', (e) => {
      if (!start) return;
      const c = clamp(p, start.left + e.clientX - start.x, start.top + e.clientY - start.y);
      place(p, c.left, c.top);
    });
    const end = (e) => {
      if (!start) return;
      start = null;
      p.handle.style.cursor = 'grab';
      try { p.handle.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      api.savePosition(id);
    };
    p.handle.addEventListener('pointerup', end);
    p.handle.addEventListener('pointercancel', end);
    p.handle.addEventListener('dblclick', (e) => {
      if (isControl(e.target)) return;
      delete saved[id];
      persist();
      clearPlacement(p);
    });
  }

  const api = {
    register(id, opts) {
      if (!opts || !opts.el || !opts.handle) return;
      const p = { ...opts };
      panels.set(id, p);
      wireDrag(id, p);
      if (api.isOpen(id)) api.restorePosition(id);
    },
    has: (id) => panels.has(id),
    isOpen(id) {
      const p = panels.get(id);
      if (!p) return false;
      if (p.isOpen) return !!p.isOpen();
      return p.el.offsetParent !== null || getComputedStyle(p.el).display !== 'none';
    },
    open(id) {
      const p = panels.get(id);
      if (!p) return;
      if (p.show) p.show();
      api.restorePosition(id);
    },
    close(id) {
      const p = panels.get(id);
      if (p && p.hide) p.hide();
    },
    toggle(id) {
      if (api.isOpen(id)) api.close(id);
      else api.open(id);
    },
    move(id, left, top) {
      const p = panels.get(id);
      if (!p) return;
      const c = clamp(p, left, top);
      place(p, c.left, c.top);
      api.savePosition(id);
    },
    // Back to where the panel was left (after it is shown, so its size is known).
    restorePosition(id) {
      loaded.then(() => requestAnimationFrame(() => {
        const p = panels.get(id);
        const pos = saved[id];
        if (!p || !pos) return;
        const c = clamp(p, pos.left, pos.top);
        place(p, c.left, c.top);
      }));
    },
    savePosition(id) {
      const p = panels.get(id);
      if (!p) return;
      const r = p.el.getBoundingClientRect();
      saved[id] = { left: Math.round(r.left), top: Math.round(r.top) };
      persist();
    },
  };

  // Keep moved panels on screen when the window shrinks.
  let raf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      for (const [id, p] of panels) {
        if (!saved[id] || !api.isOpen(id)) continue;
        const r = p.el.getBoundingClientRect();
        const c = clamp(p, r.left, r.top);
        place(p, c.left, c.top);
      }
    });
  });

  window.FloatingPanelManager = api;
})();
