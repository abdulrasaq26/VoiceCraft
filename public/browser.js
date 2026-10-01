// VoiceCraft built-in browser — host UI.
// Pages are native WebContentsViews owned by the main process
// (electron/browser-manager.js) and laid over #viewport. Anything that must
// appear over the page area either takes layout space (find bar, side panel)
// or hides the page view while open (settings). Menus are native popups.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const EB = window.electronBrowser;
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const GLOBE = '<svg class="globe" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>';
  const ICON = {
    lock: '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
    globe: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
    close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    sound: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9Z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/></svg>',
    muted: '<svg viewBox="0 0 24 24"><path d="M4 9v6h4l5 4V5L8 9Z"/><path d="M22 9l-6 6M16 9l6 6"/></svg>',
  };
  const PROFILE_COLORS = ['#6366f1', '#e8b64c', '#6cc98f', '#e06c6c', '#56b6f0', '#d07bf0', '#f09a56'];

  if (!EB) {
    $('not-desktop').hidden = false;
    ['tabstrip', 'toolbar', 'bmbar'].forEach((id) => { $(id).style.display = 'none'; });
    return;
  }

  // ------------------------------------------------------------------ state
  const state = {
    tabs: new Map(),      // id -> data from main
    order: [],            // strip order
    active: null,
    settings: null,
    bookmarks: [],
    downloads: new Map(),
    versions: {},
    extension: null,
    defaultDownloadDir: '',
    side: null,           // 'downloads' | 'history' | 'bookmarks' | null
    findOpen: false,
    settingsOpen: false,
    editingAddress: false,
  };

  const els = {
    tabs: $('tabs'), address: $('address-bar'), omniIcon: $('omnibox-icon'),
    back: $('btn-back'), forward: $('btn-forward'), reload: $('btn-reload'), star: $('btn-star'),
    zoom: $('btn-zoom'), flowtools: $('flowtools'), bmbar: $('bmbar'), viewport: $('viewport'),
    empty: $('empty-state'), side: $('side'), sideBody: $('side-body'), sideTitle: $('side-title'),
    sideActions: $('side-actions'), sideSearch: $('side-search'), sideSearchWrap: $('side-search-wrap'),
    findbar: $('findbar'), findInput: $('find-input'), findCount: $('find-count'),
    dlBadge: $('dl-badge'), dlRing: $('dl-ring'), dlBtn: $('btn-downloads'),
  };

  const activeTab = () => (state.active ? state.tabs.get(state.active) : null);
  const profileColor = (id) => {
    const i = state.settings.profiles.findIndex((p) => p.id === id);
    return PROFILE_COLORS[Math.max(0, i) % PROFILE_COLORS.length];
  };

  // ------------------------------------------------------------- page bounds
  function bounds() {
    const r = els.viewport.getBoundingClientRect();
    return { x: Math.round(r.left), y: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) };
  }
  const syncBounds = () => EB.resize(bounds());
  new ResizeObserver(syncBounds).observe(els.viewport);
  window.addEventListener('resize', syncBounds);

  function setPageHidden(hidden) { EB.setHidden(hidden); }

  // -------------------------------------------------------------------- tabs
  function renderTabs() {
    const frag = document.createDocumentFragment();
    for (const id of state.order) {
      const t = state.tabs.get(id);
      if (!t) continue;
      frag.appendChild(tabEl(t));
    }
    els.tabs.replaceChildren(frag);
    fitTabs();
    els.empty.hidden = state.order.length > 0;
  }

  function tabEl(t) {
    const el = document.createElement('div');
    el.className = 'tab' + (t.id === state.active ? ' is-active' : '');
    el.dataset.id = t.id;
    el.setAttribute('role', 'tab');
    el.setAttribute('aria-selected', String(t.id === state.active));
    el.draggable = true;
    el.title = `${t.title || ''}\n${t.url || ''}`.trim();

    let icon;
    if (t.loading) icon = '<span class="tab__spin"></span>';
    else if (t.favicon) icon = `<img src="${esc(t.favicon)}" alt="" onerror="this.style.visibility='hidden'">`;
    else icon = GLOBE;
    const profileDot = t.profileId && t.profileId !== 'default'
      ? `<span class="tab__profile" style="background:${profileColor(t.profileId)}" title="Profile: ${esc((state.settings.profiles.find((p) => p.id === t.profileId) || {}).name || t.profileId)}"></span>` : '';
    const audio = t.audible || t.muted
      ? `<button class="tab__audio" data-act="mute" title="${t.muted ? 'Unmute tab' : 'Mute tab'}">${t.muted ? ICON.muted : ICON.sound}</button>` : '';
    const netBadge = t.net && t.net.scope === 'tab'
      ? `<span class="tab__net" title="This tab has its own proxy: ${esc(t.net.summary)}">${ICON.lock}</span>` : '';
    el.innerHTML = `<span class="tab__icon">${icon}</span>${profileDot}${netBadge}<span class="tab__title">${esc(t.title || 'New tab')}</span>${audio}<button class="tab__close" data-act="close" title="Close tab (Ctrl+W)" aria-label="Close tab">${ICON.close}</button>`;
    return el;
  }

  function updateTabEl(id) {
    const t = state.tabs.get(id);
    const old = els.tabs.querySelector(`.tab[data-id="${CSS.escape(id)}"]`);
    if (t && old) old.replaceWith(tabEl(t));
    else renderTabs();
  }

  function fitTabs() {
    const n = state.order.length || 1;
    const avail = els.tabs.parentElement.clientWidth - 48;
    els.tabs.classList.toggle('is-compact', avail / n < 80);
  }
  window.addEventListener('resize', fitTabs);

  els.tabs.addEventListener('mousedown', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    if (e.button === 1) { e.preventDefault(); closeTab(tab.dataset.id); return; }
    if (e.button === 0 && !e.target.closest('[data-act]')) activate(tab.dataset.id);
  });
  els.tabs.addEventListener('click', (e) => {
    const act = e.target.closest('[data-act]');
    const tab = e.target.closest('.tab');
    if (!act || !tab) return;
    if (act.dataset.act === 'close') closeTab(tab.dataset.id);
    else if (act.dataset.act === 'mute') EB.toggleMute(tab.dataset.id);
  });
  els.tabs.addEventListener('dblclick', (e) => { if (e.target === els.tabs) newTab(); });
  els.tabs.addEventListener('contextmenu', (e) => {
    const tab = e.target.closest('.tab');
    if (tab) { e.preventDefault(); EB.tabMenu(tab.dataset.id); }
  });

  // Drag to reorder.
  let dragId = null;
  els.tabs.addEventListener('dragstart', (e) => {
    const tab = e.target.closest('.tab');
    if (!tab) return;
    dragId = tab.dataset.id;
    tab.classList.add('is-dragging');
    e.dataTransfer.effectAllowed = 'move';
  });
  els.tabs.addEventListener('dragover', (e) => {
    if (!dragId) return;
    e.preventDefault();
    const over = e.target.closest('.tab');
    if (!over || over.dataset.id === dragId) return;
    const from = state.order.indexOf(dragId), to = state.order.indexOf(over.dataset.id);
    const r = over.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    state.order.splice(from, 1);
    let idx = state.order.indexOf(over.dataset.id) + (after ? 1 : 0);
    if (to === -1) idx = state.order.length;
    state.order.splice(idx, 0, dragId);
    renderTabs();
    const d = els.tabs.querySelector(`.tab[data-id="${CSS.escape(dragId)}"]`);
    if (d) d.classList.add('is-dragging');
  });
  els.tabs.addEventListener('dragend', () => {
    if (!dragId) return;
    dragId = null;
    renderTabs();
    EB.setOrder(state.order);
  });

  function newTab(url, opts = {}) {
    return EB.createTab(url || null, opts.profileId || state.settings.activeProfile, opts);
  }
  function closeTab(id) { if (id) EB.closeTab(id); }
  function activate(id) { if (id && id !== state.active) EB.activateTab(id); }
  function cycle(step) {
    if (state.order.length < 2) return;
    const i = state.order.indexOf(state.active);
    activate(state.order[(i + step + state.order.length) % state.order.length]);
  }

  EB.onTabCreated(({ tab, index }) => {
    state.tabs.set(tab.id, tab);
    if (!state.order.includes(tab.id)) state.order.splice(Math.min(index, state.order.length), 0, tab.id);
    renderTabs();
  });
  EB.onTabUpdated((t) => {
    if (!state.tabs.has(t.id) && !state.order.includes(t.id)) state.order.push(t.id);
    state.tabs.set(t.id, t);
    updateTabEl(t.id);
    if (t.id === state.active) renderToolbar();
  });
  EB.onTabClosed((id) => {
    state.tabs.delete(id);
    state.order = state.order.filter((x) => x !== id);
    renderTabs();
    if (!state.order.length) renderToolbar();
  });
  EB.onActiveTabChanged((id) => {
    state.active = id;
    state.editingAddress = false;
    renderTabs();
    renderToolbar();
    if (state.findOpen) {
      if (id) runFind(false); else closeFind();
    }
  });

  // ----------------------------------------------------------------- toolbar
  function isFlowUrl(url) {
    return /^https:\/\/([a-z0-9-]+\.)*(flow\.google\.com|labs\.google)(\/|$)/i.test(url || '');
  }

  const isNewTabPage = (url) => !!(state.newTabUrl && url && url.startsWith(state.newTabUrl));
  function displayUrl(url) {
    if (!url || url.startsWith('data:') || isNewTabPage(url)) return '';
    return url;
  }

  // Toolbar chip: how the active tab reaches the network.
  function renderNetChip() {
    const chip = $('net-chip');
    const t = activeTab();
    chip.hidden = !t || !t.net;
    if (!t || !t.net) return;
    const n = t.net;
    const proxied = !['direct', 'system'].includes(n.type);
    chip.className = 'netchip' + (n.scope === 'tab' ? ' is-tab' : proxied ? ' is-proxy' : '');
    chip.innerHTML = `${proxied ? ICON.lock : ICON.globe}<span>${esc(n.label)}</span><span class="netchip__scope">${n.scope === 'tab' ? 'Tab' : 'Global'}</span>`;
    chip.title = `${n.scope === 'tab' ? 'This tab' : 'Whole browser'}: ${n.summary} — click to change`;
  }

  function renderToolbar() {
    const t = activeTab();
    renderNetChip();
    els.back.disabled = !t || !t.canGoBack;
    els.forward.disabled = !t || !t.canGoForward;
    els.reload.disabled = !t;
    els.reload.classList.toggle('is-loading', !!(t && t.loading));
    els.reload.title = t && t.loading ? 'Stop (Esc)' : 'Reload (Ctrl+R)';
    if (!state.editingAddress || document.activeElement !== els.address) {
      els.address.value = t ? displayUrl(t.url) : '';
    }
    const url = t && !isNewTabPage(t.url) ? t.url || '' : '';
    els.omniIcon.className = 'omnibox__icon ' + (url.startsWith('https://') ? 'is-secure' : url.startsWith('http://') ? 'is-insecure' : 'is-search');
    els.omniIcon.title = url.startsWith('https://') ? 'Connection is secure' : url.startsWith('http://') ? 'Connection is not secure' : '';
    const bookmarked = !!(t && state.bookmarks.some((b) => b.url === t.url));
    els.star.classList.toggle('is-on', bookmarked);
    els.star.disabled = !t || !/^https?:/.test(url);
    els.star.title = bookmarked ? 'Remove bookmark (Ctrl+D)' : 'Bookmark this page (Ctrl+D)';
    const z = t ? t.zoom : 1;
    const dz = state.settings.defaultZoom || 1;
    els.zoom.hidden = !t || Math.abs(z - dz) < 0.001;
    els.zoom.textContent = Math.round(z * 100) + '%';
    const mode = state.settings.flowTools;
    els.flowtools.hidden = !t || mode === 'never' || (mode === 'auto' && !isFlowUrl(url));
    for (const [panel, id] of Object.entries(FLOW_BUTTONS)) {
      const on = !!(t && t.flowPanel === panel);
      $(id).classList.toggle('is-on', on);
      $(id).setAttribute('aria-pressed', String(on));
    }
  }

  els.back.addEventListener('click', () => state.active && EB.goBack(state.active));
  els.forward.addEventListener('click', () => state.active && EB.goForward(state.active));
  els.reload.addEventListener('click', (e) => {
    const t = activeTab();
    if (!t) return;
    if (t.loading) EB.stop(t.id); else EB.reload(t.id, e.shiftKey || e.ctrlKey);
  });
  $('btn-home').addEventListener('click', () => {
    if (state.active) EB.navigate(state.active, state.settings.homepage);
    else newTab();
  });
  els.zoom.addEventListener('click', () => state.active && EB.zoom(state.active, 0));
  els.star.addEventListener('click', () => toggleBookmark());
  $('btn-new-tab').addEventListener('click', () => newTab());
  $('empty-new-tab').addEventListener('click', () => newTab());
  $('empty-flow').addEventListener('click', () => newTab('https://flow.google.com/'));
  $('btn-menu').addEventListener('click', (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    EB.appMenu(r.right - 4, r.bottom + 2);
  });

  // Address bar
  els.address.addEventListener('focus', () => { state.editingAddress = true; setTimeout(() => els.address.select(), 0); });
  els.address.addEventListener('blur', () => { state.editingAddress = false; setTimeout(renderToolbar, 0); });
  els.address.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const input = els.address.value.trim();
      if (!input) return;
      if (e.altKey || !state.active) newTab(input);
      else EB.navigate(state.active, input);
      state.editingAddress = false;
      els.address.blur();
      if (state.active) EB.focusPage(state.active);
    } else if (e.key === 'Escape') {
      state.editingAddress = false;
      renderToolbar();
      els.address.select();
    }
  });
  els.address.addEventListener('input', () => { state.editingAddress = true; });

  // Flow tools → the extension's shared panel manager in the active tab
  // (content/automation/host-bridge.js). Each button opens its panel, or
  // closes it if it's already open; opening one closes the others.
  const FLOW_BUTTONS = { downloader: 'btn-flow-downloader', automator: 'btn-flow-automator', 'prompt-recovery': 'btn-prompt-recovery' };
  for (const [panel, id] of Object.entries(FLOW_BUTTONS)) {
    $(id).addEventListener('click', () => {
      if (state.active) EB.flowCommand(state.active, { action: 'toggle-panel', panel });
    });
  }

  // ---------------------------------------------------------------- bookmarks
  async function toggleBookmark() {
    const t = activeTab();
    if (!t || !/^https?:/.test(t.url || '')) return;
    const existing = state.bookmarks.find((b) => b.url === t.url);
    state.bookmarks = existing
      ? await EB.bookmarks('remove', { id: existing.id })
      : await EB.bookmarks('add', { url: t.url, title: t.title, favicon: t.favicon });
    renderBookmarksBar();
    renderToolbar();
    if (state.side === 'bookmarks') renderSide();
  }

  function favicon(url, cls = '') {
    return url ? `<img class="${cls}" src="${esc(url)}" alt="" onerror="this.style.visibility='hidden'">` : GLOBE;
  }

  function renderBookmarksBar() {
    els.bmbar.classList.toggle('is-off', !state.settings.showBookmarksBar);
    if (!state.bookmarks.length) {
      els.bmbar.innerHTML = '<span class="bmbar__empty">Bookmark pages with the ☆ in the address bar or Ctrl+D — they appear here.</span>';
      return;
    }
    els.bmbar.innerHTML = state.bookmarks.map((b) =>
      `<button class="bm" data-url="${esc(b.url)}" title="${esc(b.title)}\n${esc(b.url)}">${favicon(b.favicon)}<span>${esc(b.title)}</span></button>`).join('');
  }
  els.bmbar.addEventListener('click', (e) => {
    const b = e.target.closest('.bm');
    if (!b) return;
    if (e.ctrlKey || !state.active) newTab(b.dataset.url, { background: e.ctrlKey });
    else EB.navigate(state.active, b.dataset.url);
  });
  els.bmbar.addEventListener('auxclick', (e) => {
    const b = e.target.closest('.bm');
    if (b && e.button === 1) newTab(b.dataset.url, { background: true });
  });

  // -------------------------------------------------------------- find bar
  let findTimer = null;
  function openFind() {
    if (!state.active) return;
    state.findOpen = true;
    els.findbar.hidden = false;
    els.findInput.focus();
    els.findInput.select();
    if (els.findInput.value) runFind(false);
  }
  function closeFind() {
    state.findOpen = false;
    els.findbar.hidden = true;
    els.findCount.textContent = '';
    els.findbar.classList.remove('is-miss');
    if (state.active) { EB.stopFind(state.active); EB.focusPage(state.active); }
  }
  function runFind(next, forward = true) {
    if (!state.active) return;
    EB.find(state.active, els.findInput.value, forward, next);
  }
  els.findInput.addEventListener('input', () => {
    clearTimeout(findTimer);
    findTimer = setTimeout(() => runFind(false), 120);
  });
  els.findInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); runFind(true, !e.shiftKey); }
    else if (e.key === 'Escape') closeFind();
  });
  $('find-next').addEventListener('click', () => runFind(true, true));
  $('find-prev').addEventListener('click', () => runFind(true, false));
  $('find-close').addEventListener('click', closeFind);
  EB.onFindResult((r) => {
    if (r.tabId !== state.active || !state.findOpen) return;
    const q = els.findInput.value;
    els.findCount.textContent = q ? `${r.matches ? r.active : 0} / ${r.matches}` : '';
    els.findbar.classList.toggle('is-miss', !!q && r.matches === 0);
  });

  // ------------------------------------------------------------ side panel
  function openSide(which) {
    if (state.side === which) { closeSide(); return; }
    state.side = which;
    els.side.hidden = false;
    ['downloads', 'history', 'bookmarks'].forEach((w) => {
      const b = $(w === 'downloads' ? 'btn-downloads' : w === 'history' ? 'btn-panel-history' : 'btn-panel-bookmarks');
      b.classList.toggle('is-on', w === which);
    });
    els.sideSearch.value = '';
    els.sideSearchWrap.hidden = which === 'downloads';
    renderSide();
  }
  function closeSide() {
    state.side = null;
    els.side.hidden = true;
    ['btn-downloads', 'btn-panel-history', 'btn-panel-bookmarks'].forEach((id) => $(id).classList.remove('is-on'));
  }
  $('side-close').addEventListener('click', closeSide);
  $('btn-downloads').addEventListener('click', () => openSide('downloads'));
  $('btn-panel-history').addEventListener('click', () => openSide('history'));
  $('btn-panel-bookmarks').addEventListener('click', () => openSide('bookmarks'));
  let searchTimer = null;
  els.sideSearch.addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(renderSide, 150); });

  function timeAgo(ms) {
    const d = new Date(ms);
    const now = new Date();
    if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
  }
  function dayLabel(ms) {
    const d = new Date(ms), now = new Date();
    const y = new Date(now); y.setDate(now.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'Today';
    if (d.toDateString() === y.toDateString()) return 'Yesterday';
    return d.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' });
  }
  function bytes(n) {
    if (!n || n < 0) return '0 B';
    const u = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < u.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i && n < 10 ? 1 : 0)} ${u[i]}`;
  }

  async function renderSide() {
    const which = state.side;
    if (!which) return;
    const q = els.sideSearch.value.trim().toLowerCase();
    if (which === 'downloads') {
      els.sideTitle.textContent = 'Downloads';
      els.sideActions.innerHTML = '<button class="btn btn--sm" data-side="open-dir">Open folder</button><button class="btn btn--sm" data-side="clear-dl">Clear</button>';
      const list = [...state.downloads.values()].sort((a, b) => b.started - a.started);
      if (!list.length) { els.sideBody.innerHTML = '<div class="side__empty">Files you download appear here.</div>'; return; }
      els.sideBody.innerHTML = list.map(dlHtml).join('');
    } else if (which === 'history') {
      els.sideTitle.textContent = 'History';
      els.sideActions.innerHTML = '<button class="btn btn--sm btn--danger" data-side="clear-history">Clear all</button>';
      const items = await EB.history('list', { query: q });
      if (state.side !== 'history') return;
      if (!items.length) { els.sideBody.innerHTML = `<div class="side__empty">${q ? 'No matches.' : 'Pages you visit appear here.'}</div>`; return; }
      let html = '', last = '';
      for (const h of items) {
        const day = dayLabel(h.time);
        if (day !== last) { html += `<div class="side__group">${esc(day)}</div>`; last = day; }
        html += `<div class="row" data-open="${esc(h.url)}">${favicon(h.favicon, 'row__icon')}<div class="row__main"><div class="row__title">${esc(h.title || h.url)}</div><div class="row__sub">${esc(h.url)}</div></div><span class="row__time">${esc(timeAgo(h.time))}</span><button class="icon-btn icon-btn--sm row__x" data-del-history="${esc(h.url)}" data-time="${h.time}" title="Remove from history">${ICON.close}</button></div>`;
      }
      els.sideBody.innerHTML = html;
    } else if (which === 'bookmarks') {
      els.sideTitle.textContent = 'Bookmarks';
      els.sideActions.innerHTML = '';
      const list = state.bookmarks.filter((b) => !q || b.title.toLowerCase().includes(q) || b.url.toLowerCase().includes(q));
      if (!list.length) { els.sideBody.innerHTML = `<div class="side__empty">${q ? 'No matches.' : 'No bookmarks yet. Press Ctrl+D on a page to add one.'}</div>`; return; }
      els.sideBody.innerHTML = list.map((b) =>
        `<div class="row" data-open="${esc(b.url)}" data-bm="${esc(b.id)}">${favicon(b.favicon, 'row__icon')}<div class="row__main"><div class="row__title">${esc(b.title)}</div><div class="row__sub">${esc(b.url)}</div></div><button class="icon-btn icon-btn--sm row__x" data-rename-bm="${esc(b.id)}" title="Rename"><svg viewBox="0 0 24 24"><path d="M4 20h4L19 9l-4-4L4 16Z"/></svg></button><button class="icon-btn icon-btn--sm row__x" data-del-bm="${esc(b.id)}" title="Delete bookmark">${ICON.close}</button></div>`).join('');
    }
  }

  function dlHtml(d) {
    const pct = d.total > 0 ? Math.round((d.received / d.total) * 100) : 0;
    let meta, cls = '';
    if (d.state === 'progressing') meta = d.paused ? `Paused — ${bytes(d.received)} of ${d.total ? bytes(d.total) : '?'}` : `${bytes(d.received)} of ${d.total ? bytes(d.total) : '?'}${d.total ? ` · ${pct}%` : ''}`;
    else if (d.state === 'completed') { meta = `${bytes(d.received)} · Done`; cls = 'is-ok'; }
    else if (d.state === 'cancelled') { meta = 'Cancelled'; cls = 'is-bad'; }
    else { meta = 'Failed — interrupted'; cls = 'is-bad'; }
    const actions = [];
    if (d.state === 'progressing') {
      actions.push(d.paused ? `<button class="btn btn--sm" data-dl="resume" data-id="${d.id}">Resume</button>` : `<button class="btn btn--sm" data-dl="pause" data-id="${d.id}">Pause</button>`);
      actions.push(`<button class="btn btn--sm btn--danger" data-dl="cancel" data-id="${d.id}">Cancel</button>`);
    } else if (d.state === 'completed') {
      actions.push(`<button class="btn btn--sm btn--primary" data-dl="open" data-id="${d.id}">Open</button>`);
      actions.push(`<button class="btn btn--sm" data-dl="show" data-id="${d.id}">Show in folder</button>`);
    } else if (d.state === 'interrupted' && d.canResume) {
      actions.push(`<button class="btn btn--sm" data-dl="resume" data-id="${d.id}">Retry</button>`);
    }
    actions.push(`<button class="btn btn--sm" data-dl="remove" data-id="${d.id}">Remove</button>`);
    return `<div class="dl"><div class="dl__top"><div class="dl__name" title="${esc(d.savePath || d.filename)}">${esc(d.filename)}</div></div>
      <div class="dl__meta ${cls}">${esc(meta)}</div>
      ${d.state === 'progressing' ? `<div class="dl__bar"><i style="width:${d.total ? pct : 30}%"></i></div>` : ''}
      <div class="dl__actions">${actions.join('')}</div></div>`;
  }

  els.side.addEventListener('click', async (e) => {
    const t = e.target;
    const a = t.closest('[data-side]');
    if (a) {
      const act = a.dataset.side;
      if (act === 'open-dir') EB.openDownloadDir();
      else if (act === 'clear-dl') EB.clearDownloads();
      else if (act === 'clear-history') {
        if (confirm('Clear all browsing history?')) { await EB.history('clear'); renderSide(); }
      }
      return;
    }
    const dl = t.closest('[data-dl]');
    if (dl) { EB.downloadAction(dl.dataset.id, dl.dataset.dl); return; }
    const dh = t.closest('[data-del-history]');
    if (dh) { e.stopPropagation(); await EB.history('remove', { url: dh.dataset.delHistory, time: +dh.dataset.time }); renderSide(); return; }
    const db = t.closest('[data-del-bm]');
    if (db) { e.stopPropagation(); state.bookmarks = await EB.bookmarks('remove', { id: db.dataset.delBm }); renderBookmarksBar(); renderToolbar(); renderSide(); return; }
    const rb = t.closest('[data-rename-bm]');
    if (rb) { e.stopPropagation(); startRename(rb.closest('.row'), rb.dataset.renameBm); return; }
    const row = t.closest('[data-open]');
    if (row && !t.closest('input')) {
      if (e.ctrlKey || !state.active) newTab(row.dataset.open, { background: e.ctrlKey });
      else EB.navigate(state.active, row.dataset.open);
    }
  });
  els.side.addEventListener('auxclick', (e) => {
    const row = e.target.closest('[data-open]');
    if (row && e.button === 1) newTab(row.dataset.open, { background: true });
  });

  function startRename(row, id) {
    const bm = state.bookmarks.find((b) => b.id === id);
    if (!row || !bm) return;
    const titleEl = row.querySelector('.row__title');
    const input = document.createElement('input');
    input.className = 'row__edit';
    input.value = bm.title;
    titleEl.replaceWith(input);
    input.focus();
    input.select();
    const done = async (save) => {
      if (save && input.value.trim()) state.bookmarks = await EB.bookmarks('rename', { id, title: input.value.trim() });
      renderBookmarksBar();
      renderSide();
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); });
    input.addEventListener('blur', () => done(true), { once: true });
  }

  // ---------------------------------------------------------------- downloads
  function renderDlButton() {
    const list = [...state.downloads.values()];
    const active = list.filter((d) => d.state === 'progressing');
    els.dlBadge.hidden = !active.length;
    els.dlBadge.textContent = active.length;
    const total = active.reduce((s, d) => s + (d.total || 0), 0);
    const got = active.reduce((s, d) => s + (d.received || 0), 0);
    els.dlRing.hidden = !active.length || !total;
    els.dlRing.style.setProperty('--p', `${total ? Math.round((got / total) * 100) : 0}%`);
  }
  EB.onDownloadUpdated((d) => {
    state.downloads.set(d.id, d);
    renderDlButton();
    if (state.side === 'downloads') renderSide();
  });
  EB.onDownloadRemoved((id) => { state.downloads.delete(id); renderDlButton(); if (state.side === 'downloads') renderSide(); });
  EB.onDownloadsReset((list) => {
    state.downloads = new Map(list.map((d) => [d.id, d]));
    renderDlButton();
    if (state.side === 'downloads') renderSide();
  });

  // ----------------------------------------------------------------- commands
  // Focus mode: full screen with the app header gone — tabs, toolbar and the
  // Flow tools stay. Only the layout changes; pages are never reloaded.
  function setFocus(on, fromWindow = false, fromStudio = false) {
    on = !!on;
    if (document.body.classList.contains('is-fullscreen')) return; // a video owns the screen
    document.body.classList.toggle('is-focus', on);
    const b = $('btn-focus');
    b.setAttribute('aria-pressed', String(on));
    b.title = on ? 'Exit focus mode (F11)' : 'Focus mode — full screen, toolbar stays (F11)';
    if (!fromWindow) EB.setWindowFullscreen(on);
    if (window.studio && !fromStudio) window.studio.setFocusMode(on); // the studio bar steps aside too
    requestAnimationFrame(syncBounds);
  }
  function toggleFocus() { setFocus(!document.body.classList.contains('is-focus')); }
  // The studio ended focus mode (another module was opened): follow.
  if (window.studio && window.studio.onFocusMode) {
    window.studio.onFocusMode(({ on }) => { if (!on && document.body.classList.contains('is-focus')) setFocus(false, false, true); });
  }
  $('btn-focus').addEventListener('click', toggleFocus);
  $('btn-settings').addEventListener('click', () => openSettings());
  // Leaving OS full screen some other way also leaves focus mode.
  EB.onWindowFullscreen(({ on }) => { if (!on && document.body.classList.contains('is-focus')) setFocus(false, true); });

  const commands = {
    'new-tab': () => newTab(),
    'close-tab': (tabId) => closeTab(tabId || state.active),
    'reopen-tab': () => EB.reopenClosed(),
    'next-tab': () => cycle(1),
    'prev-tab': () => cycle(-1),
    'focus-address': () => { els.address.focus(); els.address.select(); },
    find: () => openFind(),
    bookmark: () => toggleBookmark(),
    history: () => openSide('history'),
    downloads: () => openSide('downloads'),
    bookmarks: () => openSide('bookmarks'),
    'downloads-started': () => { if (state.side !== 'downloads') openSide('downloads'); },
    print: () => state.active && EB.print(state.active),
    reload: () => state.active && EB.reload(state.active, false),
    'hard-reload': () => state.active && EB.reload(state.active, true),
    back: () => state.active && EB.goBack(state.active),
    forward: () => state.active && EB.goForward(state.active),
    'zoom-in': () => state.active && EB.zoom(state.active, 1),
    'zoom-out': () => state.active && EB.zoom(state.active, -1),
    'zoom-reset': () => state.active && EB.zoom(state.active, 0),
    'focus-mode': () => toggleFocus(),
    devtools: () => state.active && EB.openDevTools(state.active),
    settings: () => openSettings(),
    'tab-proxy': (tabId) => { if (tabId) activate(tabId); netForm = null; netScope = 'tab'; openSettings('network'); },
    'toggle-bookmarks-bar': async () => {
      state.settings = await EB.setSettings({ showBookmarksBar: !state.settings.showBookmarksBar });
      renderBookmarksBar();
    },
    escape: () => {
      if (state.settingsOpen) closeSettings();
      else if (state.findOpen) closeFind();
      else { const t = activeTab(); if (t && t.loading) EB.stop(t.id); }
    },
  };
  function run(cmd, tabId) {
    if (/^tab-[1-9]$/.test(cmd)) {
      const n = +cmd.slice(4);
      activate(n === 9 ? state.order[state.order.length - 1] : state.order[n - 1]);
      return;
    }
    const fn = commands[cmd];
    if (fn) fn(tabId);
  }
  EB.onCommand(({ cmd, tabId }) => run(cmd, tabId));

  // The same shortcuts when the host UI (not a page) has focus.
  window.addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    const ctrl = e.ctrlKey || e.metaKey;
    let cmd = null;
    if (ctrl && e.shiftKey && k === 't') cmd = 'reopen-tab';
    else if (ctrl && e.shiftKey && k === 'tab') cmd = 'prev-tab';
    else if (ctrl && k === 'tab') cmd = 'next-tab';
    else if (ctrl && k === 't') cmd = 'new-tab';
    else if (ctrl && k === 'w') cmd = 'close-tab';
    else if (ctrl && k === 'l') cmd = 'focus-address';
    else if (ctrl && k === 'f') cmd = 'find';
    else if (ctrl && k === 'd') cmd = 'bookmark';
    else if (ctrl && k === 'h') cmd = 'history';
    else if (ctrl && k === 'j') cmd = 'downloads';
    else if (ctrl && k === 'p') cmd = 'print';
    else if (ctrl && k === ',') cmd = 'settings';
    else if (ctrl && e.shiftKey && k === 'r') cmd = 'hard-reload';
    else if (ctrl && k === 'r') cmd = 'reload';
    else if (ctrl && (k === '=' || k === '+')) cmd = 'zoom-in';
    else if (ctrl && k === '-') cmd = 'zoom-out';
    else if (ctrl && k === '0') cmd = 'zoom-reset';
    else if (ctrl && /^[1-9]$/.test(k)) cmd = 'tab-' + k;
    else if (e.altKey && k === 'arrowleft') cmd = 'back';
    else if (e.altKey && k === 'arrowright') cmd = 'forward';
    else if (k === 'f5') cmd = e.shiftKey || ctrl ? 'hard-reload' : 'reload';
    else if (k === 'f11') cmd = 'focus-mode';
    else if (k === 'f12') cmd = 'devtools';
    else if (k === 'escape' && state.settingsOpen) cmd = 'escape';
    if (!cmd) return;
    // Let text fields keep their own editing keys.
    const inField = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (inField && ['zoom-in', 'zoom-out', 'zoom-reset', 'back', 'forward'].includes(cmd)) return;
    e.preventDefault();
    run(cmd);
  });

  EB.onPageFullscreen(({ on }) => document.body.classList.toggle('is-fullscreen', on));

  // ----------------------------------------------------------------- settings
  const SECTIONS = {
    general: 'General', appearance: 'Appearance', privacy: 'Privacy & data', downloads: 'Downloads',
    profiles: 'Profiles', network: 'Network & proxy', flow: 'Flow tools & extension',
    shortcuts: 'Keyboard shortcuts', about: 'About',
  };
  let section = 'general';

  async function openSettings(sec) {
    if (sec) section = sec;
    state.settingsOpen = true;
    $('settings').hidden = false;
    setPageHidden(true);
    netForm = null;
    if (section === 'network') state.network = await EB.getNetwork();
    renderSettings();
  }
  function closeSettings() {
    state.settingsOpen = false;
    $('settings').hidden = true;
    setPageHidden(false);
  }
  $('settings-close').addEventListener('click', closeSettings);
  $('settings').addEventListener('mousedown', (e) => { if (e.target.id === 'settings') closeSettings(); });
  $('settings-nav').addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-sec]');
    if (!b) return;
    section = b.dataset.sec;
    if (section === 'network') { netForm = null; state.network = await EB.getNetwork(); }
    renderSettings();
  });

  let toastTimer = null;
  function toast(msg) {
    const t = $('settings-toast');
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 1800);
  }

  async function save(patch, msg = 'Saved') {
    state.settings = await EB.setSettings(patch);
    renderToolbar();
    renderBookmarksBar();
    renderTabs();
    toast(msg);
  }

  const sw = (key, on) => `<label class="switch"><input type="checkbox" data-key="${key}" ${on ? 'checked' : ''}><span></span></label>`;
  const row = (label, desc, ctl) => `<div class="set"><div class="set__txt"><div class="set__label">${label}</div>${desc ? `<div class="set__desc">${desc}</div>` : ''}</div><div class="set__ctl">${ctl}</div></div>`;
  const select = (key, value, opts) => `<select data-key="${key}">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>`;

  function renderSettings() {
    const s = state.settings;
    document.querySelectorAll('#settings-nav button').forEach((b) => b.classList.toggle('is-on', b.dataset.sec === section));
    $('settings-title').textContent = SECTIONS[section];
    let html = '';
    if (section === 'general') {
      html = `<div class="card">
        ${row('Home page', 'Opened by the Home button and for new tabs.', `<input type="url" class="wide" data-key="homepage" value="${esc(s.homepage)}"><button class="btn btn--sm" data-act="home-current">Use current page</button>`)}
        ${row('Search engine', 'Used when you type something that isn’t an address.', select('searchEngine', s.searchEngine, [['google', 'Google'], ['bing', 'Bing'], ['duckduckgo', 'DuckDuckGo'], ['brave', 'Brave Search']]))}
        ${row('On startup', 'What to open when the browser starts.', select('startup', s.startup, [['restore', 'Continue where you left off'], ['home', 'Open the home page']]))}
      </div>`;
    } else if (section === 'appearance') {
      html = `<div class="card">
        ${row('Show bookmarks bar', 'Your bookmarks under the address bar. Ctrl+D bookmarks the current page.', sw('showBookmarksBar', s.showBookmarksBar))}
        ${row('Default page zoom', 'Applies to all tabs; Ctrl+/− adjusts a single page.', select('defaultZoom', s.defaultZoom, [[0.75, '75%'], [0.8, '80%'], [0.9, '90%'], [1, '100%'], [1.1, '110%'], [1.25, '125%'], [1.5, '150%']]))}
      </div>`;
    } else if (section === 'privacy') {
      html = `<div class="card">
        ${row('Save browsing history', 'Keep a list of pages you visit.', sw('saveHistory', s.saveHistory))}
      </div>
      <div class="card__h">Clear browsing data</div>
      <div class="card"><div class="set"><div class="set__txt">
        <div class="set__label">Choose what to clear</div>
        <div class="set__desc">Profile: ${select('clearProfile', s.activeProfile, s.profiles.map((p) => [p.id, p.name]))}</div>
        <label class="check"><input type="checkbox" id="clr-history" checked> Browsing history</label>
        <label class="check"><input type="checkbox" id="clr-cache" checked> Cached images and files</label>
        <label class="check"><input type="checkbox" id="clr-cookies"> Cookies (signs you out of sites)</label>
        <label class="check"><input type="checkbox" id="clr-storage"> Site storage (local storage, IndexedDB, service workers)</label>
      </div><div class="set__ctl"><button class="btn btn--danger" data-act="clear-data">Clear data</button></div></div></div>`;
    } else if (section === 'downloads') {
      html = `<div class="card">
        ${row('Location', `<span class="mono">${esc(s.downloadDir || state.defaultDownloadDir)}</span>`, `<button class="btn btn--sm" data-act="pick-dir">Change…</button>${s.downloadDir ? '<button class="btn btn--sm" data-act="reset-dir">Reset</button>' : ''}<button class="btn btn--sm" data-act="open-dir">Open</button>`)}
        ${row('Ask where to save each file', 'Otherwise files save straight to the location above. Flow Downloader files always go to its own folder there.', sw('askWhereToSave', s.askWhereToSave))}
      </div>`;
    } else if (section === 'profiles') {
      html = `<div class="card__h">Profiles keep separate cookies and sign-ins</div><div class="card">
        ${s.profiles.map((p) => row(
          `<span class="tab__profile" style="display:inline-block;margin-right:8px;background:${profileColor(p.id)}"></span>${esc(p.name)}${p.id === s.activeProfile ? ' <span class="status-ok">· default for new tabs</span>' : ''}`,
          p.id === 'default' ? 'The main profile.' : '',
          `${p.id !== s.activeProfile ? `<button class="btn btn--sm" data-act="use-profile" data-id="${esc(p.id)}">Use for new tabs</button>` : ''}
           <button class="btn btn--sm" data-act="open-profile" data-id="${esc(p.id)}">New tab</button>
           <button class="btn btn--sm" data-act="rename-profile" data-id="${esc(p.id)}">Rename</button>
           ${p.id !== 'default' ? `<button class="btn btn--sm btn--danger" data-act="delete-profile" data-id="${esc(p.id)}">Delete</button>` : ''}`)).join('')}
      </div>
      <div class="card">${row('Add a profile', 'For a second Google account, a client, or testing.', '<input type="text" id="new-profile-name" placeholder="Profile name"><button class="btn btn--primary btn--sm" data-act="add-profile">Add</button>')}</div>`;
    } else if (section === 'network') {
      html = renderNetwork();
    } else if (section === 'flow') {
      const ext = state.extension;
      const status = ext ? (ext.loaded ? `<span class="status-ok">Loaded</span> · v${esc(ext.version || '')}` : `<span class="status-bad">Not loaded</span> — ${esc(ext.error || '')}`) : '<span class="status-bad">Not loaded yet</span> — open a tab first';
      html = `<div class="card">
        ${row('Flow tools on the toolbar', 'Downloader, Automator and Prompt Recovery buttons.', select('flowTools', s.flowTools, [['auto', 'Show on Google Flow pages'], ['always', 'Always show'], ['never', 'Never show']]))}
      </div>
      <div class="card__h">Extension</div>
      <div class="card">
        ${row('VoiceCraft Flow Downloader', status + (ext && ext.path ? `<br><span class="mono">${esc(ext.path)}</span>` : ''), '')}
        ${row('Downloads', 'Flow Downloader files save to <span class="mono">' + esc(s.downloadDir || state.defaultDownloadDir) + '\\Flow Media Downloader</span>.', '<button class="btn btn--sm" data-act="open-dir">Open folder</button>')}
      </div>
      <div class="card__h">Flow connection</div>
      <div class="card" id="flow-diag">${row('Checking…', '', '')}</div>`;
      setTimeout(renderFlowDiag, 0);

    } else if (section === 'shortcuts') {
      const keys = [
        ['New tab', 'Ctrl+T'], ['Close tab', 'Ctrl+W'], ['Reopen closed tab', 'Ctrl+Shift+T'], ['Next / previous tab', 'Ctrl+Tab / Ctrl+Shift+Tab'],
        ['Go to tab 1–8 / last tab', 'Ctrl+1…8 / Ctrl+9'], ['Focus address bar', 'Ctrl+L'], ['Open in new tab from address bar', 'Alt+Enter'],
        ['Back / forward', 'Alt+← / Alt+→'], ['Reload / hard reload', 'Ctrl+R · F5 / Ctrl+Shift+R'], ['Find in page', 'Ctrl+F'],
        ['Bookmark page', 'Ctrl+D'], ['History', 'Ctrl+H'], ['Downloads', 'Ctrl+J'], ['Zoom in / out / reset', 'Ctrl+= / Ctrl+- / Ctrl+0'],
        ['Print', 'Ctrl+P'], ['Settings', 'Ctrl+,'], ['Focus mode', 'F11'], ['Developer tools', 'F12'], ['Close tab', 'Middle-click a tab'],
      ];
      html = `<div class="card keys">${keys.map(([a, b]) => `<div>${esc(a)}</div><div><span class="kbd">${esc(b)}</span></div>`).join('')}</div>`;
    } else if (section === 'about') {
      const v = state.versions;
      html = `<div class="card">
        ${row('Frameloom Studio', 'Built-in browser', `<span class="mono">v${esc(v.app)}</span>`)}
        ${row('Chromium', '', `<span class="mono">${esc(v.chrome)}</span>`)}
        ${row('Electron', '', `<span class="mono">${esc(v.electron)}</span>`)}
        ${row('Node.js', '', `<span class="mono">${esc(v.node)}</span>`)}
      </div>`;
    }
    $('settings-body').innerHTML = html;
  }

  // Settings → Flow tools: what the studio has seen of Google Flow's API
  // (paths only — no tokens), to tell "not signed in" from "Flow changed".
  async function renderFlowDiag() {
    const box = $('flow-diag');
    if (!box || !EB.flowDiagnostics) return;
    const d = await EB.flowDiagnostics();
    const when = d.seenAt ? new Date(d.seenAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '';
    box.innerHTML = row('Flow sign-in', 'The Automator uses the sign-in Flow’s own page sends. Open a Flow project and it’s picked up.',
      d.signedInSeen ? `<span class="status-ok">Seen</span> <span class="mono">${esc(d.authScheme || '')} · ${esc(when)}</span>` : '<span class="status-bad">Not seen yet</span>')
      + row('Flow API calls seen', `${d.calls.length} endpoint${d.calls.length === 1 ? '' : 's'} (paths only, no secrets)`,
        '<button class="btn btn--sm" data-act="copy-flow-diag">Copy for support</button>')
      + (d.calls.length ? `<div class="set"><div class="mono" style="max-height:160px;overflow:auto;white-space:pre">${esc(d.calls.slice(0, 40).join(String.fromCharCode(10)))}</div></div>` : '');
  }

  // ---- website file pickers: the project's files first ----
  // BrowserManager catches a page's <input type=file> and asks here; the
  // answer is the chosen project files, "browse the PC", or nothing.
  const FP_ICON = {
    video: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M10 9l5 3-5 3z"/></svg>',
    image: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/></svg>',
    audio: '<svg viewBox="0 0 24 24"><path d="M9 18V6l10-2v12"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg>',
  };
  let fpReq = null;
  const fpPick = new Set();
  const fpSize = (b) => (b >= 1e9 ? (b / 1e9).toFixed(2) + ' GB' : b >= 1e6 ? (b / 1e6).toFixed(1) + ' MB' : Math.max(1, Math.round((b || 0) / 1e3)) + ' KB');
  const fpClock = (s) => { if (!s) return ''; s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(x).padStart(2, '0'); };
  // Does a file fit the input's accept="…" list?
  function fpAccepts(f, accept) {
    const list = String(accept || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
    if (!list.length) return true;
    const ext = (f.name.match(/\.[^.]+$/) || [''])[0].toLowerCase();
    return list.some((a) => a === ext || a === f.type + '/*' || (a.includes('/') && a.split('/')[0] === f.type));
  }
  function fpRender() {
    const d = fpReq;
    const renders = (d.renders || []).filter((f) => fpAccepts(f, d.accept));
    const media = (d.media || []).filter((f) => fpAccepts(f, d.accept));
    const row = (f, isRender) => {
      const on = fpPick.has(f.path);
      const bits = [isRender && f.version ? 'v' + f.version : '', fpClock(f.duration), fpSize(f.size), new Date(f.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })].filter(Boolean);
      return `<label class="fp__row${on ? ' is-on' : ''}">
        <input type="${d.multiple ? 'checkbox' : 'radio'}" name="fp" value="${esc(f.path)}"${on ? ' checked' : ''}>
        <span class="fp__ic${isRender ? ' is-render' : ''}">${FP_ICON[f.type] || FP_ICON.image}</span>
        <span class="fp__name"><b>${esc(f.name)}</b><span>${esc(bits.join(' · '))}</span></span>
        ${f.pinned ? '<span class="fp__pin">Picked for upload</span>' : ''}
      </label>`;
    };
    let html = '';
    if (!d.project) html = '<p class="fp__empty">No project is open in the studio. Pick one in the studio bar to see its renders here, or browse this PC.</p>';
    else if (!renders.length && !media.length) html = `<p class="fp__empty">Nothing in “${esc(d.project)}” matches what this site accepts${d.accept ? ' (' + esc(d.accept) + ')' : ''}. Browse this PC instead.</p>`;
    else {
      if (renders.length) html += `<div class="fp__sec">Renders · ${esc(d.project)}</div>` + renders.map((f) => row(f, true)).join('');
      if (media.length) html += '<div class="fp__sec">Project media</div>' + media.map((f) => row(f, false)).join('');
    }
    $('fp-body').innerHTML = html;
    $('fp-use').disabled = fpPick.size === 0;
    $('fp-use').textContent = fpPick.size > 1 ? `Upload ${fpPick.size} files` : 'Upload';
  }
  function fpAnswer(answer) {
    if (!fpReq) return;
    EB.answerFileChooser(fpReq.requestId, answer);
    fpReq = null;
    $('filepick').hidden = true;
    setPageHidden(false);
  }
  if (EB.onFileChooser) {
    EB.onFileChooser((d) => {
      if (fpReq) fpAnswer({ paths: [] }); // a newer picker replaces an open one
      fpReq = d;
      fpPick.clear();
      const pinned = (d.renders || []).find((f) => f.pinned && fpAccepts(f, d.accept));
      if (pinned) fpPick.add(pinned.path);
      $('fp-sub').textContent = `${d.site || 'This site'} wants ${d.multiple ? 'files' : 'a file'}${d.accept ? ' (' + d.accept + ')' : ''}.`;
      fpRender();
      $('filepick').hidden = false;
      setPageHidden(true);
    });
  }
  $('fp-body').addEventListener('change', (e) => {
    const inp = e.target.closest('input[name=fp]');
    if (!inp || !fpReq) return;
    if (!fpReq.multiple) fpPick.clear();
    if (inp.checked) fpPick.add(inp.value); else fpPick.delete(inp.value);
    fpRender();
  });
  $('fp-body').addEventListener('dblclick', (e) => {
    const inp = e.target.closest('.fp__row') && e.target.closest('.fp__row').querySelector('input');
    if (inp && fpReq && !fpReq.multiple) fpAnswer({ paths: [inp.value] });
  });
  $('fp-use').addEventListener('click', () => fpAnswer({ paths: [...fpPick] }));
  $('fp-browse').addEventListener('click', () => fpAnswer({ browse: true }));
  $('fp-cancel').addEventListener('click', () => fpAnswer({ paths: [] }));
  $('fp-close').addEventListener('click', () => fpAnswer({ paths: [] }));
  $('filepick').addEventListener('mousedown', (e) => { if (e.target.id === 'filepick') fpAnswer({ paths: [] }); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && fpReq) { e.preventDefault(); e.stopPropagation(); fpAnswer({ paths: [] }); } }, true);

  // Short notices from the studio ("ready to upload", …).
  let appToastTimer = 0;
  if (EB.onToast) {
    EB.onToast(({ text }) => {
      const t = $('app-toast');
      t.textContent = text;
      t.hidden = false;
      clearTimeout(appToastTimer);
      appToastTimer = setTimeout(() => { t.hidden = true; }, 7000);
    });
  }

  // ---- network & proxy ----
  // Apply to the current tab (its own session) or the whole browser.
  let netScope = 'tab';
  let netForm = null; // what's being edited; kept across re-renders
  const NET_TYPES = [['direct', 'Direct'], ['system', 'System'], ['socks5', 'SOCKS5'], ['http', 'HTTP'], ['https', 'HTTPS'], ['custom', 'Custom']];
  const formFrom = (p) => ({ type: p.type, host: p.host || '', port: p.port || '', username: p.username || '', password: '', hasPassword: !!p.hasPassword, rules: p.rules || '', bypass: p.bypass || '<local>' });

  function renderNetwork() {
    const t = activeTab();
    const g = state.settings.proxy || { type: 'system', label: 'System', summary: 'System' };
    if (!t && netScope === 'tab') netScope = 'global';
    if (!netForm) {
      // A tab that follows the browser starts on "Browser setting".
      netForm = netScope === 'tab' && t && t.net && t.net.scope !== 'tab' ? formFrom({ type: 'system' }) : formFrom(netScope === 'tab' && t && t.net ? t.net : g);
    }
    const f = netForm;
    const icon = (p) => (['direct', 'system'].includes(p.type) ? ICON.globe : ICON.lock);
    const others = ((state.network && state.network.tabs) || []).filter((x) => !t || x.id !== t.id);
    const opt = (name, v, label, on) => `<label class="nf__opt${on ? ' is-on' : ''}"><input type="radio" name="${name}" value="${v}" data-net="${name}"${on ? ' checked' : ''}>${label}</label>`;
    const hostPort = ['socks5', 'http', 'https'].includes(f.type);
    const auth = ['http', 'https', 'socks5'].includes(f.type);
    return `<div class="card__h">Now</div>
      <div class="card">
        ${row('Entire browser', 'Every tab that has no proxy of its own.', `<span class="netnow">${icon(g)}${esc(g.summary)}${g.type !== 'system' && g.enabled === false ? ' · off' : ''}</span>`
          + (g.type !== 'system' ? `<button class="btn btn--sm" data-act="net-do" data-scope="global" data-do="${g.enabled === false ? 'enable' : 'disable'}">${g.enabled === false ? 'Turn on' : 'Turn off'}</button><button class="btn btn--sm btn--danger" data-act="net-do" data-scope="global" data-do="remove">Remove</button>` : ''))}
        ${t ? row('This tab', esc(t.title || displayUrl(t.url) || 'New tab'),
          t.net && t.net.scope === 'tab'
            ? `<span class="netnow">${ICON.lock}${esc(t.net.summary)}</span><button class="btn btn--sm" data-act="net-do" data-scope="tab" data-id="${esc(t.id)}" data-do="disable">Turn off</button><button class="btn btn--sm btn--danger" data-act="net-do" data-scope="tab" data-id="${esc(t.id)}" data-do="remove">Remove</button>`
            : t.netOff
              ? `<span class="netnow">Own proxy off (${esc(t.netOff.summary)})</span><button class="btn btn--sm" data-act="net-do" data-scope="tab" data-id="${esc(t.id)}" data-do="enable">Turn on</button><button class="btn btn--sm btn--danger" data-act="net-do" data-scope="tab" data-id="${esc(t.id)}" data-do="remove">Remove</button>`
              : '<span class="netnow">Follows the browser</span>') : ''}
        ${others.map((x) => row(esc(x.title || 'Tab'), 'Has its own proxy', `<span class="netnow">${ICON.lock}${esc(x.proxy.summary)}</span><button class="btn btn--sm" data-act="net-follow" data-id="${esc(x.id)}">Use browser setting</button>`)).join('')}
      </div>
      <div class="card__h">Change</div>
      <div class="card"><div class="nf">
        <div class="nf__row"><span class="nf__k">Apply to</span><div class="nf__opts">
          ${t ? opt('scope', 'tab', 'Current tab', netScope === 'tab') : ''}${opt('scope', 'global', 'Entire browser', netScope === 'global')}
        </div></div>
        <div class="nf__row"><span class="nf__k">Proxy</span><div class="nf__opts">
          ${NET_TYPES.map(([v, l]) => opt('type', v, netScope === 'tab' && v === 'system' ? 'Browser setting' : l, f.type === v)).join('')}
        </div></div>
        ${hostPort ? `<div class="nf__row"><span class="nf__k">Server</span>
          <input type="text" class="nf__host" data-nf="host" placeholder="host or IP" value="${esc(f.host)}" spellcheck="false">
          <input type="number" class="nf__port" data-nf="port" placeholder="port" min="1" max="65535" value="${esc(f.port)}"></div>` : ''}
        ${f.type === 'custom' ? `<div class="nf__row"><span class="nf__k">Rules</span>
          <input type="text" class="nf__wide" data-nf="rules" placeholder="http=host:8080;https=host:8080 · socks5://host:1080 · or a PAC script URL" value="${esc(f.rules)}" spellcheck="false"></div>` : ''}
        ${auth ? `<div class="nf__row"><span class="nf__k">Sign-in</span>
          <input type="text" class="nf__host" data-nf="username" placeholder="username (optional)" value="${esc(f.username)}" autocomplete="off" spellcheck="false">
          <input type="password" class="nf__host" data-nf="password" placeholder="${f.hasPassword ? 'saved — leave empty to keep' : 'password'}" autocomplete="new-password"></div>` : ''}
        ${f.type === 'socks5' ? '<div class="nf__note">With a username and password, the studio signs in to the SOCKS5 server through a private bridge on this computer (Chromium can’t sign in to SOCKS5 itself). Host names are resolved by the proxy.</div>' : ''}
        ${!['direct', 'system'].includes(f.type) ? `<div class="nf__row"><span class="nf__k">Bypass</span>
          <input type="text" class="nf__wide" data-nf="bypass" placeholder="&lt;local&gt;, *.example.com" value="${esc(f.bypass)}" spellcheck="false"></div>` : ''}
        ${netScope === 'tab' ? '<div class="nf__note">The tab reloads in its own private session with this proxy, starting with this profile’s sign-ins. Pages it opens stay on the same proxy. Other tabs aren’t affected.</div>'
          : '<div class="nf__note">Every tab without its own proxy switches right away.</div>'}
        <div class="nf__actions">
          <button class="btn btn--sm" data-act="net-test" ${f.type === 'system' || f.type === 'direct' ? 'disabled' : ''}>Test connection</button>
          <button class="btn btn--sm btn--primary" data-act="net-apply">Apply</button>
          <span class="nf__result" id="nf-result"></span>
        </div>
      </div></div>`;
  }

  async function netAction(act, btn) {
    const t = activeTab();
    const res = $('nf-result');
    const form = { ...netForm };
    delete form.hasPassword;
    btn.disabled = true;
    res.className = 'nf__result';
    res.textContent = act === 'net-test' ? 'Testing…' : 'Applying…';
    try {
      if (act === 'net-test') {
        const r = await EB.testProxy({ form, scope: netScope, tabId: t && t.id });
        res.className = 'nf__result ' + (r.ok ? 'ok' : 'bad');
        res.textContent = r.ok ? `Connected · ${r.ms} ms${r.via ? ` · via ${r.via}` : ''}` : `Failed: ${r.error || 'HTTP ' + r.status}`;
      } else {
        const r = await EB.setProxy({ scope: netScope, tabId: t && t.id, form });
        if (!r || !r.ok) { res.className = 'nf__result bad'; res.textContent = (r && r.error) || 'Could not apply'; return; }
        if (r.settings) state.settings = r.settings;
        state.network = r.network;
        netForm = null;
        renderSettings();
        renderToolbar();
        toast(netScope === 'tab' ? 'Proxy set for this tab' : 'Browser proxy applied');
      }
    } finally { btn.disabled = false; }
  }

  $('settings-body').addEventListener('input', (e) => {
    const k = e.target.dataset && e.target.dataset.nf;
    if (k && netForm) netForm[k] = e.target.value;
  });
  $('settings-body').addEventListener('change', (e) => {
    const k = e.target.dataset && e.target.dataset.net;
    if (!k) return;
    if (k === 'scope') { netScope = e.target.value; netForm = null; }
    else netForm.type = e.target.value;
    renderSettings();
  });
  $('net-chip').addEventListener('click', () => { netScope = 'tab'; netForm = null; openSettings('network'); });

  $('settings-body').addEventListener('change', async (e) => {
    const el = e.target;
    const key = el.dataset && el.dataset.key;
    if (!key || key === 'clearProfile') return;
    let val = el.type === 'checkbox' ? el.checked : el.value;
    if (key === 'defaultZoom') val = parseFloat(val);
    if (key === 'homepage') {
      val = val.trim();
      if (val && !/^[a-z]+:/i.test(val)) val = 'https://' + val;
      if (!val) { renderSettings(); return; }
    }
    await save({ [key]: val });
    if (key === 'proxyMode') renderSettings();
  });

  $('settings-body').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const s = state.settings;
    const act = b.dataset.act;
    if (act === 'home-current') {
      const t = activeTab();
      if (t && /^https?:/.test(t.url)) { await save({ homepage: t.url }); renderSettings(); }
    } else if (act === 'clear-data') {
      const what = {
        history: $('clr-history').checked, cache: $('clr-cache').checked,
        cookies: $('clr-cookies').checked, storage: $('clr-storage').checked,
      };
      if (!Object.values(what).some(Boolean)) return;
      const profile = document.querySelector('[data-key="clearProfile"]').value;
      b.disabled = true;
      await EB.clearData(profile, what);
      b.disabled = false;
      toast('Browsing data cleared');
    } else if (act === 'pick-dir') {
      state.settings = await EB.pickDownloadDir();
      renderSettings();
    } else if (act === 'reset-dir') {
      await save({ downloadDir: '' });
      renderSettings();
    } else if (act === 'open-dir') {
      EB.openDownloadDir();
    } else if (act === 'net-test' || act === 'net-apply') {
      await netAction(act, b);
    } else if (act === 'copy-flow-diag') {
      const d = await EB.flowDiagnostics();
      await navigator.clipboard.writeText([`Flow sign-in seen: ${d.signedInSeen ? 'yes (' + d.authScheme + ')' : 'no'}`, ...d.calls].join(String.fromCharCode(10)));
      toast('Copied');
    } else if (act === 'net-do') {
      const scope = b.dataset.scope;
      const r = await EB.setProxy({ scope, tabId: b.dataset.id, action: b.dataset.do });
      if (r && r.ok) {
        if (r.settings) state.settings = r.settings;
        state.network = r.network;
        netForm = null;
        toast({ disable: 'Proxy turned off', enable: 'Proxy turned on', remove: 'Proxy removed' }[b.dataset.do] || 'Done');
      }
      renderSettings();
      renderToolbar();
    } else if (act === 'net-follow') {
      const r = await EB.setProxy({ scope: 'tab', tabId: b.dataset.id, follow: true });
      if (r && r.ok) { state.network = r.network; netForm = null; toast('Tab uses the browser proxy again'); }
      renderSettings();
    } else if (act === 'add-profile') {
      const name = $('new-profile-name').value.trim();
      if (!name) { $('new-profile-name').focus(); return; }
      const id = 'p' + Date.now().toString(36);
      await save({ profiles: [...s.profiles, { id, name }] }, 'Profile added');
      renderSettings();
    } else if (act === 'use-profile') {
      await save({ activeProfile: b.dataset.id }, 'New tabs will use this profile');
      renderSettings();
    } else if (act === 'open-profile') {
      closeSettings();
      newTab(state.settings.homepage, { profileId: b.dataset.id });
    } else if (act === 'rename-profile') {
      const rowEl = b.closest('.set');
      const label = rowEl.querySelector('.set__label');
      const p = s.profiles.find((x) => x.id === b.dataset.id);
      const input = document.createElement('input');
      input.type = 'text';
      input.value = p.name;
      label.replaceChildren(input);
      input.focus();
      input.select();
      const commit = async () => {
        const name = input.value.trim();
        if (name && name !== p.name) await save({ profiles: s.profiles.map((x) => (x.id === p.id ? { ...x, name } : x)) }, 'Profile renamed');
        renderSettings();
      };
      input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') commit(); else if (ev.key === 'Escape') renderSettings(); });
      input.addEventListener('blur', commit, { once: true });
    } else if (act === 'delete-profile') {
      const p = s.profiles.find((x) => x.id === b.dataset.id);
      if (!p || !confirm(`Delete the profile “${p.name}”? Its tabs stay open until closed; its cookies remain on disk until you clear them.`)) return;
      await save({
        profiles: s.profiles.filter((x) => x.id !== p.id),
        activeProfile: s.activeProfile === p.id ? 'default' : s.activeProfile,
      }, 'Profile deleted');
      renderSettings();
    }
  });

  // ------------------------------------------------------------------- start
  async function start() {
    const init = await EB.init();
    state.settings = init.settings;
    state.newTabUrl = init.newTabUrl || '';
    state.bookmarks = init.bookmarks || [];
    state.versions = init.versions || {};
    state.extension = init.extension;
    state.defaultDownloadDir = init.defaultDownloadDir;
    for (const d of init.downloads || []) state.downloads.set(d.id, d);

    // Tabs survive switching to another workspace and back: re-adopt them.
    for (const t of init.tabs) { state.tabs.set(t.id, t); state.order.push(t.id); }
    state.active = init.activeTabId;

    renderBookmarksBar();
    renderTabs();
    renderToolbar();
    renderDlButton();
    EB.mount(bounds());

    if (!init.tabs.length) {
      const restored = state.settings.startup === 'restore' && init.hasSession ? await EB.restoreSession() : null;
      if (!restored || !restored.length) newTab();
    }
    // Refresh the extension status once a session exists.
    setTimeout(async () => { const again = await EB.init(); state.extension = again.extension; }, 3000);
  }

  window.addEventListener('beforeunload', () => EB.unmount());
  start();
})();
