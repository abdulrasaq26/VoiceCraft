// content/automation/host-bridge.js
//
// Inside VoiceCraft Studio's built-in browser (Electron), the extension's
// service worker can't use chrome.downloads or chrome.scripting — Electron
// doesn't implement them. The tab preload marks the page with
// data-voicecraft-host and relays window messages to the app, so here we
// route those three background calls to the app instead, and deliver the
// app's toolbar commands and download progress to the normal message handler.
// In Chrome this file does nothing.
(function () {
  if (window.__vcHostBridge) return;
  window.__vcHostBridge = true;

  const TO_HOST = 'voicecraft-flow:to-host';
  const TO_EXT = 'voicecraft-flow:to-ext';
  const inHost = () => !!(document.documentElement && document.documentElement.hasAttribute('data-voicecraft-host'));
  if (!inHost()) return;

  const post = (msg) => window.postMessage(Object.assign({ channel: TO_HOST }, msg), '*');
  const pending = new Map(); // requestId -> callback
  let seq = 0;

  // ---- download naming: mirrors background/download-manager.js ----
  function getSettings() {
    return new Promise((resolve) => {
      const defaults = { baseFolder: 'Flow Media Downloader', filenameTemplate: '{title}.{ext}' };
      try {
        chrome.storage.local.get(defaults, (s) => resolve(Object.assign({}, defaults, s || {})));
      } catch (e) {
        resolve(defaults);
      }
    });
  }

  const clean = (s) => String(s || '').replace(/[/\\?%*:|"<>\n\r]/g, '-');

  function buildRelPath(item, settings, batchId) {
    if (settings.baseFolder === 'GoogleFlow' || settings.baseFolder === 'Flow Downloader') settings.baseFolder = 'Flow Media Downloader';
    const now = new Date();
    const dateStr = now.toISOString().split('T')[0];
    const timeStr = now.toTimeString().split(' ')[0].replace(/:/g, '');
    let ext = item.type === 'video' ? 'mp4' : 'png';
    const mt = item.mimeType || '';
    if (mt.includes('webp')) ext = 'webp';
    else if (mt.includes('jpeg') || mt.includes('jpg')) ext = 'jpg';
    else if (mt.includes('gif')) ext = 'gif';
    else if (mt.includes('webm')) ext = 'webm';

    const id = String(item.id || '').split('_').pop() || Math.random().toString(36).substr(2, 6);
    let title = item.title ? clean(item.title).substring(0, 100) : 'Flow';
    if (!item.title) {
      try {
        if (item.url && !item.url.startsWith('blob:') && !item.url.startsWith('data:')) {
          const part = item.url.split('/').pop().split('?')[0];
          if (part && part.includes('.')) title = part.split('.')[0];
        }
      } catch (e) { /* keep default */ }
    }
    if (!title.trim()) title = 'Flow';

    let filename = settings.filenameTemplate
      .replace('{title}', title).replace('{date}', dateStr).replace('{time}', timeStr)
      .replace('{id}', id).replace('{type}', item.type || '').replace('{ext}', ext)
      .replace(/--+/g, '-').replace(/__+/g, '_');

    if (item.isAutomated) {
      return `${settings.baseFolder}/${clean(item.project)}/${clean(item.batch)}/${clean(item.jobId)}.${ext}`;
    }
    return `${settings.baseFolder}/${item.batchId || batchId || dateStr}/${filename}`;
  }

  function newBatchId() {
    const d = new Date();
    return `batch_${d.toISOString().split('T')[0]}_${d.toTimeString().split(' ')[0].replace(/:/g, '-')}`;
  }

  // Sequential queue, like the service worker's, so Flow isn't hammered.
  const queue = [];
  const waiting = new Map(); // mediaId -> resolve (download finished)
  let busy = false;

  function deliver(message) {
    const fn = window.__vcDispatchExtensionMessage;
    if (typeof fn === 'function') {
      try { fn(message, { id: 'voicecraft-host' }, () => {}); } catch (e) { console.warn('[VoiceCraft bridge]', e); }
    }
  }

  async function pump() {
    if (busy) return;
    busy = true;
    const settings = await getSettings();
    while (queue.length) {
      const { item, batchId } = queue.shift();
      deliver({ action: 'downloadProgress', mediaId: item.id, status: 'downloading', progress: 0 });
      const done = new Promise((resolve) => waiting.set(item.id, resolve));
      post({
        type: 'download', url: item.url, mediaId: item.id, relPath: buildRelPath(item, settings, batchId),
        // Lets VoiceCraft Studio file the result under the current project.
        meta: {
          source: item.isAutomated ? 'flow-automator' : 'flow-downloader',
          name: item.jobId || item.title || '', prompt: item.prompt || '', type: item.type || '', flowMediaId: item.flowMediaId || '',
        },
      });
      await done;
    }
    busy = false;
  }

  function enqueue(items) {
    const batchId = newBatchId();
    for (const item of items) {
      if (!item || !item.url) continue;
      queue.push({ item, batchId });
      deliver({ action: 'downloadProgress', mediaId: item.id, status: 'queued', progress: 0 });
    }
    pump();
  }

  // ---- extension panels: one shared open/close manager ----
  // The panels' own DOM is the source of truth, so closing one with its own
  // ✕ button is picked up too. Opening a panel closes the others.
  const shown = (el) => !!el && el.style.display !== 'none' && el.style.display !== '';
  const panels = {
    downloader: {
      el: () => window.FlowTray && window.FlowTray.trayEl,
      isOpen() { return !!(window.FlowTray && window.FlowTray.isVisible && shown(this.el())); },
      open: () => deliver({ action: 'scan' }), // fresh scan, then shows the tray
      close: () => window.FlowTray && window.FlowTray.hide(),
    },
    automator: {
      el: () => window.FlowAutomatorPanel && window.FlowAutomatorPanel.container,
      isOpen() { return shown(this.el()); },
      open: () => window.FlowAutomatorPanel && window.FlowAutomatorPanel.show(),
      close: () => {
        const p = window.FlowAutomatorPanel;
        if (p) { p.isVisible = false; p.container.style.display = 'none'; }
      },
    },
    'prompt-recovery': {
      el: () => window.promptRecoveryUI && window.promptRecoveryUI.container,
      isOpen() { return shown(this.el()) && this.el().style.display === 'flex'; },
      open: () => {
        if (!window.promptRecoveryUI && window.PromptRecoveryUI) window.promptRecoveryUI = new window.PromptRecoveryUI();
        if (window.promptRecoveryUI) window.promptRecoveryUI.show();
      },
      close: () => window.promptRecoveryUI && window.promptRecoveryUI.hide(),
    },
  };
  const openPanel = () => Object.keys(panels).find((k) => { try { return panels[k].isOpen(); } catch (e) { return false; } }) || null;
  let lastReported;
  const reportPanels = () => {
    const open = openPanel();
    if (open !== lastReported) { lastReported = open; post({ type: 'panel-state', open }); }
  };
  const watched = new WeakSet();
  const watchPanels = () => {
    for (const k of Object.keys(panels)) {
      const el = panels[k].el();
      if (el && !watched.has(el)) {
        watched.add(el);
        new MutationObserver(reportPanels).observe(el, { attributes: true, attributeFilter: ['style'] });
      }
    }
  };
  const extensionPanelManager = {
    toggle(name) {
      const p = panels[name];
      if (!p) return;
      if (p.isOpen()) p.close();
      else {
        for (const k of Object.keys(panels)) if (k !== name && panels[k].isOpen()) panels[k].close();
        p.open();
      }
      // Panels can be created lazily by open(); watch them, then report.
      setTimeout(() => { watchPanels(); reportPanels(); }, 50);
    },
  };
  window.__vcPanels = extensionPanelManager;

  // ---- messages from the app ----
  window.addEventListener('message', (e) => {
    const d = e.data;
    if (e.source !== window || !d || d.channel !== TO_EXT) return;
    if (d.type === 'reply') {
      const cb = pending.get(d.replyTo);
      pending.delete(d.replyTo);
      if (cb) cb(d.result);
    } else if (d.type === 'message' && d.message) {
      const m = d.message;
      if (m.action === 'toggle-panel') { extensionPanelManager.toggle(m.panel); return; }
      if (m.action === 'query-panels') { lastReported = undefined; watchPanels(); reportPanels(); return; }
      if (m.action === 'downloadProgress' && (m.status === 'downloaded' || m.status === 'error')) {
        const resolve = waiting.get(m.mediaId);
        waiting.delete(m.mediaId);
        if (resolve) resolve();
      }
      deliver(m);
    }
  });

  // ---- route the background-only calls to the app ----
  const original = chrome.runtime.sendMessage.bind(chrome.runtime);
  const routed = function (message, ...rest) {
    const cb = typeof rest[rest.length - 1] === 'function' ? rest[rest.length - 1] : null;
    const action = message && message.action;
    if (action === 'download' && message.mediaItem) {
      enqueue([message.mediaItem]);
      if (cb) setTimeout(() => cb({ status: 'queued' }), 0);
      return;
    }
    if (action === 'downloadSelected' && Array.isArray(message.items)) {
      enqueue(message.items);
      if (cb) setTimeout(() => cb({ status: 'queued', count: message.items.length }), 0);
      return;
    }
    if (action === 'executeMainWorld') {
      const requestId = 'r' + (++seq);
      if (cb) pending.set(requestId, cb);
      post({ type: 'exec-main-world', requestId, payload: message.payload });
      return;
    }
    return original(message, ...rest);
  };
  try {
    chrome.runtime.sendMessage = routed;
  } catch (e) { /* read-only binding */ }
  if (chrome.runtime.sendMessage !== routed) {
    try {
      Object.defineProperty(chrome.runtime, 'sendMessage', { value: routed, configurable: true, writable: true });
    } catch (e) {
      console.warn('[VoiceCraft bridge] could not route chrome.runtime.sendMessage:', e);
    }
  }

  post({ type: 'hello' });
  post({ type: 'get-project' }); // which VoiceCraft Studio project results go into
})();
