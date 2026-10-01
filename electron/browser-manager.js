// Built-in browser: tabs are WebContentsViews laid over the host page's
// viewport element. The host page (public/browser.html) owns the UI; this
// class owns the pages, their sessions, downloads, menus and the bridge that
// lets the Flow Downloader extension work without Chrome-only APIs.
import { WebContentsView, BrowserWindow, session, ipcMain, Menu, clipboard, shell, app, dialog } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { BrowserStore } from './browser-store.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ZOOM_LEVELS = [0.25, 0.33, 0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5];
const SEARCH_URLS = {
  google: 'https://www.google.com/search?q=',
  bing: 'https://www.bing.com/search?q=',
  duckduckgo: 'https://duckduckgo.com/?q=',
  brave: 'https://search.brave.com/search?q=',
};

// The extension ships unpacked next to the app (loadExtension can't read asar).
export function flowExtensionPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'flow-extension')
    : path.join(__dirname, '..', 'VoiceCraft Flow Downloader');
}

// Google refuses sign-in from UAs that advertise Electron or an unknown app;
// present as the Chrome build Electron actually embeds.
function cleanUserAgent(ua) {
  const keep = new Set(['Mozilla', 'AppleWebKit', 'Chrome', 'Safari']);
  return ua.replace(/\s([A-Za-z][\w.-]*)\/(\S+)/g, (m, name) => (keep.has(name) ? m : ''));
}

function partitionFor(profileId) {
  return !profileId || profileId === 'default' ? 'persist:browser' : `persist:browser-${profileId}`;
}

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function errorPage(title, detail, url) {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#0d0d0f;color:#f2f2f4;font:15px/1.5 "Segoe UI",system-ui,sans-serif}
.c{max-width:520px;padding:32px}h1{font-size:22px;margin:0 0 10px}p{color:#9b9ba3;margin:0 0 8px;word-break:break-word}
code{color:#c7c9ff;font-size:13px}a{display:inline-block;margin-top:18px;padding:9px 18px;border-radius:9px;background:#6366f1;color:#fff;text-decoration:none;font-weight:600}</style></head>
<body><div class="c"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(detail)}</p>${url ? `<p><code>${escapeHtml(url)}</code></p><a href="${escapeHtml(url)}">Try again</a>` : ''}</div></body></html>`;
  return 'data:text/html;charset=utf-8,' + encodeURIComponent(html);
}

// Windows-safe relative path under the downloads folder; no escaping it.
function safeRelPath(rel) {
  const parts = String(rel || '').split(/[\\/]+/)
    .map((p) => p.replace(/[<>:"|?*\x00-\x1f]/g, '-').replace(/[. ]+$/g, '').trim())
    .filter((p) => p && p !== '.' && p !== '..');
  return parts.length ? path.join(...parts) : 'download';
}

function uniquePath(p) {
  if (!fs.existsSync(p)) return p;
  const dir = path.dirname(p), ext = path.extname(p), base = path.basename(p, ext);
  for (let i = 1; i < 10000; i++) {
    const c = path.join(dir, `${base} (${i})${ext}`);
    if (!fs.existsSync(c)) return c;
  }
  return p;
}

export class BrowserManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    // The page that shows the browser UI (public/browser.html). In the studio
    // it's the Browser module's own view, placed below the studio bar.
    this.host = mainWindow.webContents;
    this.offset = { x: 0, y: 0 };
    this.moduleVisible = true;
    this.onFlowAsset = null; // studio hook: (savePath, meta) for finished Flow downloads
    this.store = new BrowserStore();
    this.tabs = new Map();          // tabId -> tab
    this.order = [];                // tab ids in strip order
    this.activeTabId = null;
    this.tabCounter = 0;
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    this.mounted = false;           // host page is showing the browser
    this.hidden = false;            // a host modal covers the viewport
    this.attachedId = null;         // tab whose view is in the window now
    this.sessions = new Map();      // partition -> Promise<Session>
    this.downloads = new Map();     // download id -> record
    this.dlCounter = 0;
    this.pendingFlow = [];          // Flow bridge downloads awaiting will-download
    this.closedTabs = [];           // for "reopen closed tab"
    this.mainWorldSrc = null;

    this.setupIPC();
    this.applyProxy(this.store.settings);

    this.watchHost(this.host);
    app.on('before-quit', () => this.store.flush());
    mainWindow.on('leave-full-screen', () => this.send('browser:window-fullscreen', { on: false }));
  }

  send(channel, payload) {
    if (this.host && !this.host.isDestroyed()) this.host.send(channel, payload);
  }

  // Leaving browser.html (reload, navigation) must take the pages off screen
  // even if the page's own unmount message never arrives.
  watchHost(wc) {
    wc.on('did-start-navigation', (e, url, inPlace, isMainFrame) => {
      if (isMainFrame && !inPlace && wc === this.host) { this.mounted = false; this.syncAttachment(); }
    });
  }

  setHost(wc) {
    if (wc === this.host) return;
    this.host = wc;
    this.watchHost(wc);
  }

  setOffset(offset) {
    this.offset = offset || { x: 0, y: 0 };
    this.applyBounds();
  }

  // The studio shows/hides the Browser module; tab pages follow it.
  setModuleVisible(visible) {
    this.moduleVisible = !!visible;
    this.syncAttachment(true);
  }

  // ---------------------------------------------------------------- sessions
  ensureSession(profileId) {
    const partition = partitionFor(profileId);
    if (this.sessions.has(partition)) return this.sessions.get(partition);
    const p = (async () => {
      const ses = session.fromPartition(partition);
      ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
      ses.on('will-download', (e, item, wc) => this.onWillDownload(item, wc));
      await this.applyProxyTo(ses, this.store.settings);
      const ext = flowExtensionPath();
      if (fs.existsSync(path.join(ext, 'manifest.json'))) {
        try {
          const loaded = ses.getAllExtensions ? ses.getAllExtensions() : [];
          if (!loaded.some((x) => x.name === 'VoiceCraft Flow Downloader')) {
            const info = await ses.loadExtension(ext, { allowFileAccess: true });
            this.extensionInfo = { name: info.name, version: info.version, path: ext, loaded: true };
          }
        } catch (err) {
          this.extensionInfo = { name: 'VoiceCraft Flow Downloader', path: ext, loaded: false, error: err.message };
          console.warn('[Browser] extension failed to load:', err.message);
        }
      } else {
        this.extensionInfo = { name: 'VoiceCraft Flow Downloader', path: ext, loaded: false, error: 'Extension folder not found' };
      }
      return ses;
    })();
    this.sessions.set(partition, p);
    return p;
  }

  async applyProxyTo(ses, s) {
    try {
      if (s.proxyMode === 'direct') await ses.setProxy({ mode: 'direct' });
      else if (s.proxyMode === 'fixed' && s.proxyRules) await ses.setProxy({ mode: 'fixed_servers', proxyRules: s.proxyRules });
      else await ses.setProxy({ mode: 'system' });
    } catch (e) { console.warn('[Browser] proxy:', e.message); }
  }

  async applyProxy(s) {
    for (const p of this.sessions.values()) this.applyProxyTo(await p, s);
  }

  // --------------------------------------------------------------------- IPC
  setupIPC() {
    const on = (ch, fn) => ipcMain.on(ch, (e, arg) => { if (e.sender === this.host) fn(arg, e); });
    const handle = (ch, fn) => ipcMain.handle(ch, (e, arg) => (e.sender === this.host ? fn(arg, e) : null));

    on('browser:mount', (bounds) => { this.mounted = true; if (bounds) this.bounds = bounds; this.syncAttachment(); });
    on('browser:unmount', () => { this.mounted = false; this.syncAttachment(); });
    on('browser:resize', (bounds) => { this.bounds = bounds; this.applyBounds(); });
    on('browser:set-hidden', (hidden) => { this.hidden = !!hidden; this.syncAttachment(); });

    handle('browser:init', () => ({
      tabs: this.order.map((id) => this.tabData(id)),
      activeTabId: this.activeTabId,
      settings: this.store.settings,
      bookmarks: this.store.data.bookmarks,
      session: this.store.data.session,
      downloads: [...this.downloads.values()].map((d) => this.dlData(d)),
      extension: this.extensionInfo || null,
      versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
      defaultDownloadDir: app.getPath('downloads'),
    }));

    handle('browser:create-tab', ({ url, profileId, background, index } = {}) => this.createTab(url, profileId, { background, index }));
    on('browser:close-tab', (tabId) => this.closeTab(tabId));
    on('browser:activate-tab', (tabId) => this.activateTab(tabId));
    on('browser:set-order', (ids) => {
      if (Array.isArray(ids)) this.order = ids.filter((id) => this.tabs.has(id)).concat(this.order.filter((id) => !ids.includes(id)));
      this.saveSession();
    });
    handle('browser:reopen-closed', () => {
      const last = this.closedTabs.pop();
      return last ? this.createTab(last.url, last.profileId, { index: last.index }) : null;
    });

    on('browser:navigate', ({ tabId, input }) => {
      const tab = this.tabs.get(tabId);
      if (tab) this.loadInTab(tab, this.resolveInput(input));
    });
    on('browser:go-back', (tabId) => { const wc = this.wc(tabId); if (wc && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack(); });
    on('browser:go-forward', (tabId) => { const wc = this.wc(tabId); if (wc && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward(); });
    on('browser:reload', ({ tabId, hard }) => {
      const tab = this.tabs.get(tabId);
      if (!tab) return;
      if (tab.error || tab.crashed) { const u = tab.error ? tab.error.url : tab.url; tab.error = null; tab.crashed = false; this.loadInTab(tab, u); return; }
      if (hard) tab.view.webContents.reloadIgnoringCache(); else tab.view.webContents.reload();
    });
    on('browser:stop', (tabId) => { const wc = this.wc(tabId); if (wc) wc.stop(); });
    on('browser:focus-page', (tabId) => { const wc = this.wc(tabId); if (wc) wc.focus(); });
    on('browser:open-devtools', (tabId) => { const wc = this.wc(tabId); if (wc) wc.openDevTools({ mode: 'detach' }); });
    on('browser:print', (tabId) => { const wc = this.wc(tabId); if (wc) wc.print({}, () => {}); });
    on('browser:toggle-mute', (tabId) => {
      const tab = this.tabs.get(tabId);
      if (tab) { tab.view.webContents.setAudioMuted(!tab.view.webContents.isAudioMuted()); this.notify(tabId); }
    });
    on('browser:zoom', ({ tabId, dir }) => this.zoom(tabId, dir));

    // `followUp` = step to the next/previous match of the current search.
    // Electron's own `findNext` means the opposite: "start a new session".
    on('browser:find', ({ tabId, text, forward = true, followUp = false }) => {
      const wc = this.wc(tabId);
      if (!wc) return;
      if (!text) { wc.stopFindInPage('clearSelection'); this.send('browser:find-result', { tabId, matches: 0, active: 0 }); return; }
      wc.findInPage(text, { forward, findNext: !followUp });
    });
    on('browser:stop-find', (tabId) => { const wc = this.wc(tabId); if (wc) wc.stopFindInPage('clearSelection'); });

    on('browser:tab-menu', ({ tabId }) => this.showTabMenu(tabId));
    // Focus mode fills the screen; only the window changes, pages are untouched.
    on('browser:set-window-fullscreen', (on) => {
      if (this.mainWindow.isFullScreen() !== !!on) this.mainWindow.setFullScreen(!!on);
    });
    on('browser:app-menu', ({ x, y }) => this.showAppMenu(x, y));

    // Flow tools on the toolbar → the extension's content scripts in the tab.
    on('browser:flow-command', ({ tabId, action }) => {
      const wc = this.wc(tabId);
      if (wc) wc.send('flow-host:to-ext', typeof action === 'object' && action ? action : { action });
    });

    // Settings / data
    handle('browser:set-settings', async (patch) => {
      const prev = this.store.settings;
      const s = this.store.setSettings(patch || {});
      if (patch && ('proxyMode' in patch || 'proxyRules' in patch)) await this.applyProxy(s);
      if (patch && 'defaultZoom' in patch && prev.defaultZoom !== s.defaultZoom) {
        for (const t of this.tabs.values()) { t.view.webContents.setZoomFactor(s.defaultZoom); this.notify(t.id); }
      }
      return s;
    });
    handle('browser:pick-download-dir', async () => {
      const r = await dialog.showOpenDialog(this.mainWindow, { properties: ['openDirectory', 'createDirectory'], defaultPath: this.downloadDir() });
      if (r.canceled || !r.filePaths[0]) return this.store.settings;
      return this.store.setSettings({ downloadDir: r.filePaths[0] });
    });
    handle('browser:clear-data', async ({ profileId, what }) => {
      const ses = await this.ensureSession(profileId || 'default');
      const w = what || {};
      if (w.cache) await ses.clearCache();
      const storages = [];
      if (w.cookies) storages.push('cookies');
      if (w.storage) storages.push('localstorage', 'indexdb', 'websql', 'serviceworkers', 'cachestorage', 'filesystem', 'shadercache');
      if (storages.length) await ses.clearStorageData({ storages });
      if (w.history) this.store.clearHistory();
      return true;
    });
    handle('browser:bookmarks', ({ op, ...a }) => {
      if (op === 'add') return this.store.addBookmark(a);
      if (op === 'remove') return this.store.removeBookmark(a.id || a.url);
      if (op === 'rename') return this.store.renameBookmark(a.id, a.title);
      if (op === 'move') return this.store.moveBookmark(a.id, a.index);
      return this.store.data.bookmarks;
    });
    handle('browser:history', ({ op, query, url, time } = {}) => {
      if (op === 'clear') { this.store.clearHistory(); return []; }
      if (op === 'remove') this.store.removeHistory(url, time);
      const q = (query || '').toLowerCase();
      const h = this.store.data.history;
      return (q ? h.filter((e) => e.url.toLowerCase().includes(q) || (e.title || '').toLowerCase().includes(q)) : h).slice(0, 500);
    });

    // Downloads
    on('browser:download-action', ({ id, action }) => {
      const d = this.downloads.get(id);
      if (!d) return;
      if (action === 'pause' && d.item && d.item.canResume !== undefined) d.item.pause();
      else if (action === 'resume' && d.item && d.item.canResume()) d.item.resume();
      else if (action === 'cancel' && d.item) d.item.cancel();
      else if (action === 'open' && d.state === 'completed') shell.openPath(d.savePath);
      else if (action === 'show' && d.savePath) shell.showItemInFolder(d.savePath);
      else if (action === 'remove') { if (d.state === 'progressing' && d.item) d.item.cancel(); this.downloads.delete(id); this.send('browser:download-removed', id); }
      if (d.item) { d.paused = d.item.isPaused(); this.send('browser:download-updated', this.dlData(d)); }
    });
    on('browser:downloads-clear', () => {
      for (const [id, d] of this.downloads) if (d.state !== 'progressing') this.downloads.delete(id);
      this.send('browser:downloads-reset', [...this.downloads.values()].map((d) => this.dlData(d)));
    });
    on('browser:open-download-dir', () => shell.openPath(this.downloadDir()));

    // ---- Flow bridge (from the tab preload, not the host page) ----
    ipcMain.on('flow-host:download', (e, req) => this.flowDownload(e.sender, req));
    // The Automator's page-side script, run in the page's own world when the
    // page's CSP stops the extension adding it as a <script>. Only this file.
    ipcMain.on('flow-host:inject-main', (e, { file } = {}) => {
      if (file !== 'content/automation/flow-api-main.js' || !this.tabByWebContents(e.sender)) return;
      try {
        const src = fs.readFileSync(path.join(flowExtensionPath(), file), 'utf8');
        e.sender.executeJavaScript(src, true).catch((err) => console.warn('[Browser] inject-main:', err.message));
      } catch (err) { console.warn('[Browser] inject-main:', err.message); }
    });
    // Studio hand-offs from the Automator.
    ipcMain.on('flow-host:send-to-editor', (e, { flowMediaIds } = {}) => {
      if (this.tabByWebContents(e.sender) && this.onSendToEditor) this.onSendToEditor(flowMediaIds || null);
    });
    ipcMain.handle('flow-host:get-project', (e) => (this.tabByWebContents(e.sender) && this.getStudioProject ? this.getStudioProject() : null));
    ipcMain.on('flow-host:panel-state', (e, { open } = {}) => {
      const tab = this.tabByWebContents(e.sender);
      if (tab && tab.flowPanel !== (open || null)) { tab.flowPanel = open || null; this.notify(tab.id); }
    });
    ipcMain.handle('flow-host:exec-main-world', (e, payload) => this.flowExecMainWorld(e.sender, payload));
  }

  // -------------------------------------------------------------------- tabs
  wc(tabId) {
    const t = this.tabs.get(tabId);
    return t ? t.view.webContents : null;
  }

  tabByWebContents(wc) {
    for (const t of this.tabs.values()) if (t.view.webContents === wc) return t;
    return null;
  }

  resolveInput(input) {
    const s = String(input || '').trim();
    if (!s) return this.store.settings.homepage;
    if (/^(https?|file|data|view-source|about):/i.test(s)) return s;
    if (/^localhost(:\d+)?(\/|$)/i.test(s) || /^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(s)) return 'http://' + s;
    if (!/\s/.test(s) && /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/.*)?$/i.test(s)) return 'https://' + s;
    const base = SEARCH_URLS[this.store.settings.searchEngine] || SEARCH_URLS.google;
    return base + encodeURIComponent(s);
  }

  loadInTab(tab, url) {
    tab.error = null;
    tab.crashed = false;
    tab.url = url;
    tab.view.webContents.loadURL(url).catch(() => { /* reported via did-fail-load */ });
    this.notify(tab.id);
  }

  async createTab(url, profileId, { background = false, index, openerWc } = {}) {
    profileId = profileId || this.store.settings.activeProfile || 'default';
    if (!this.store.settings.profiles.some((p) => p.id === profileId)) profileId = 'default';
    await this.ensureSession(profileId);

    const tabId = 'tab-' + (++this.tabCounter);
    const partition = partitionFor(profileId);
    const view = new WebContentsView({
      webPreferences: {
        partition,
        preload: path.join(__dirname, 'tab-preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: true,
        // Keep Flow (and the Automator in it) running at full speed while the
        // tab or the whole Browser module is in the background.
        backgroundThrottling: false,
      },
    });
    view.setBackgroundColor('#ffffff');

    const tab = {
      id: tabId, url: url || this.store.settings.homepage, title: 'New tab', favicon: null,
      loading: true, profileId, partition, view, error: null, crashed: false, audible: false,
    };
    this.tabs.set(tabId, tab);
    if (typeof index === 'number' && index >= 0 && index <= this.order.length) this.order.splice(index, 0, tabId);
    else if (openerWc) {
      const opener = this.tabByWebContents(openerWc);
      const i = opener ? this.order.indexOf(opener.id) : -1;
      if (i >= 0) this.order.splice(i + 1, 0, tabId); else this.order.push(tabId);
    } else this.order.push(tabId);

    this.wireTab(tab);
    view.webContents.setZoomFactor(this.store.settings.defaultZoom || 1);
    this.send('browser:tab-created', { tab: this.tabData(tabId), index: this.order.indexOf(tabId) });
    this.loadInTab(tab, tab.url);
    if (!background || !this.activeTabId) this.activateTab(tabId);
    this.saveSession();
    return tabId;
  }

  wireTab(tab) {
    const wc = tab.view.webContents;
    const id = tab.id;

    wc.on('did-start-loading', () => { tab.loading = true; this.notify(id); });
    wc.on('did-stop-loading', () => {
      tab.loading = false;
      if (!tab.error) { tab.url = wc.getURL() || tab.url; tab.title = wc.getTitle() || tab.url; }
      this.notify(id);
      this.saveSession();
    });
    wc.on('page-title-updated', (e, title) => {
      if (tab.error) return;
      tab.title = title;
      this.store.updateHistoryTitle(wc.getURL(), title);
      this.notify(id);
    });
    wc.on('page-favicon-updated', (e, favicons) => {
      if (favicons && favicons.length) {
        tab.favicon = favicons[0];
        this.store.updateHistoryTitle(wc.getURL(), null, tab.favicon);
        this.notify(id);
      }
    });
    wc.on('did-navigate', (e, url) => {
      if (url.startsWith('data:text/html') && tab.error) return; // our error page
      tab.error = null;
      tab.url = url;
      tab.favicon = null;
      tab.flowPanel = null; // a new document starts with no extension panel open
      this.store.addHistory(url, wc.getTitle());
      this.notify(id);
    });
    wc.on('did-navigate-in-page', (e, url, isMainFrame) => {
      if (!isMainFrame) return;
      tab.url = url;
      this.store.addHistory(url, wc.getTitle(), tab.favicon);
      this.notify(id);
    });
    wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
      // -3 = aborted (user navigated away / stopped); not an error to show.
      if (!isMainFrame || code === -3) return;
      tab.error = { code, desc, url };
      tab.url = url;
      tab.title = 'Page failed to load';
      tab.loading = false;
      wc.loadURL(errorPage("This page couldn't be loaded", `${desc} (${code})`, url)).catch(() => {});
      this.notify(id);
    });
    wc.on('render-process-gone', (e, details) => {
      if (details.reason === 'clean-exit') return;
      tab.crashed = true;
      tab.loading = false;
      tab.title = 'Tab crashed';
      this.notify(id);
      const u = tab.url;
      setTimeout(() => {
        if (!this.tabs.has(id)) return;
        tab.error = { code: 0, desc: details.reason, url: u };
        wc.loadURL(errorPage('This tab crashed', `Reason: ${details.reason}. Reload to try again.`, u)).catch(() => {});
      }, 50);
    });
    wc.on('audio-state-changed', (e) => { tab.audible = !!e.audible; this.notify(id); });
    wc.on('found-in-page', (e, r) => this.send('browser:find-result', { tabId: id, matches: r.matches, active: r.activeMatchOrdinal, final: r.finalUpdate }));
    // A page going fullscreen (video player) takes the whole window.
    wc.on('enter-html-full-screen', () => {
      this.send('browser:page-fullscreen', { tabId: id, on: true });
      this.wasFullScreen = this.mainWindow.isFullScreen();
      this.mainWindow.setFullScreen(true);
    });
    wc.on('leave-html-full-screen', () => {
      this.send('browser:page-fullscreen', { tabId: id, on: false });
      if (!this.wasFullScreen) this.mainWindow.setFullScreen(false);
    });

    // Shortcuts pressed while a page has focus never reach the host page.
    wc.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      if (this.onModuleKey && this.onModuleKey(input)) { event.preventDefault(); return; }
      const cmd = this.shortcutFor(input);
      if (cmd) {
        event.preventDefault();
        this.send('browser:command', { cmd, tabId: id });
      }
    });

    wc.on('context-menu', (e, params) => this.showPageMenu(tab, params));

    wc.setWindowOpenHandler((details) => {
      // Real popups (sign-in flows that talk back to window.opener) stay popups.
      if (details.disposition === 'new-window') {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            parent: this.mainWindow, autoHideMenuBar: true, backgroundColor: '#ffffff',
            width: 520, height: 680,
            webPreferences: { partition: tab.partition, contextIsolation: true, sandbox: true },
          },
        };
      }
      this.createTab(details.url, tab.profileId, { background: details.disposition === 'background-tab', openerWc: wc });
      return { action: 'deny' };
    });
  }

  shortcutFor(i) {
    const k = (i.key || '').toLowerCase();
    const ctrl = i.control || i.meta;
    if (ctrl && i.shift && k === 't') return 'reopen-tab';
    if (ctrl && i.shift && k === 'tab') return 'prev-tab';
    if (ctrl && k === 'tab') return 'next-tab';
    if (ctrl && !i.shift && k === 't') return 'new-tab';
    if (ctrl && k === 'w') return 'close-tab';
    if (ctrl && k === 'l') return 'focus-address';
    if (ctrl && k === 'f') return 'find';
    if (ctrl && k === 'd') return 'bookmark';
    if (ctrl && k === 'h') return 'history';
    if (ctrl && k === 'j') return 'downloads';
    if (ctrl && k === 'p') return 'print';
    if (ctrl && k === ',') return 'settings';
    if (ctrl && i.shift && k === 'r') return 'hard-reload';
    if (ctrl && k === 'r') return 'reload';
    if (ctrl && (k === '=' || k === '+')) return 'zoom-in';
    if (ctrl && k === '-') return 'zoom-out';
    if (ctrl && k === '0') return 'zoom-reset';
    if (ctrl && /^[1-9]$/.test(k)) return 'tab-' + k;
    if (i.alt && k === 'arrowleft') return 'back';
    if (i.alt && k === 'arrowright') return 'forward';
    if (k === 'f5') return i.shift || ctrl ? 'hard-reload' : 'reload';
    if (k === 'f11') return 'focus-mode';
    if (k === 'f12' || (ctrl && i.shift && k === 'i')) return 'devtools';
    return null;
  }

  closeTab(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const idx = this.order.indexOf(tabId);
    const url = tab.error ? tab.error.url : tab.url;
    if (url && !url.startsWith('data:')) {
      this.closedTabs.push({ url, profileId: tab.profileId, index: idx });
      if (this.closedTabs.length > 25) this.closedTabs.shift();
    }
    if (this.attachedId === tabId) {
      try { this.mainWindow.contentView.removeChildView(tab.view); } catch { /* not attached */ }
      this.attachedId = null;
    }
    this.tabs.delete(tabId);
    this.order.splice(idx, 1);
    // Actually tear the page down, or its audio/timers keep running.
    try { if (!tab.view.webContents.isDestroyed()) tab.view.webContents.close(); } catch { /* already gone */ }

    if (this.activeTabId === tabId) {
      this.activeTabId = null;
      const next = this.order[Math.min(idx, this.order.length - 1)];
      if (next) this.activateTab(next);
      else this.send('browser:active-tab-changed', null);
    }
    this.send('browser:tab-closed', tabId);
    this.saveSession();
  }

  activateTab(tabId) {
    if (!this.tabs.has(tabId)) return;
    this.activeTabId = tabId;
    this.syncAttachment();
    this.send('browser:active-tab-changed', tabId);
    this.notify(tabId);
    this.saveSession();
  }

  // Exactly one view is attached: the active tab, while the browser is on
  // screen and no host modal is covering it.
  syncAttachment(raise = false) {
    const want = this.mounted && this.moduleVisible && !this.hidden && this.activeTabId && this.tabs.has(this.activeTabId) ? this.activeTabId : null;
    if (this.attachedId === want && !(raise && want)) { this.applyBounds(); return; }
    if (this.attachedId && this.tabs.has(this.attachedId)) {
      try { this.mainWindow.contentView.removeChildView(this.tabs.get(this.attachedId).view); } catch { /* ignore */ }
    }
    this.attachedId = null;
    if (want) {
      this.mainWindow.contentView.addChildView(this.tabs.get(want).view);
      this.attachedId = want;
      this.applyBounds();
    }
  }

  applyBounds() {
    if (!this.attachedId || !this.tabs.has(this.attachedId)) return;
    // Host-page CSS pixels → window DIPs (the host page may be zoomed and,
    // in the studio, sits below the studio bar).
    const z = (this.host && !this.host.isDestroyed() && this.host.getZoomFactor()) || 1;
    const b = this.bounds;
    this.tabs.get(this.attachedId).view.setBounds({
      x: Math.round(b.x * z + this.offset.x), y: Math.round(b.y * z + this.offset.y),
      width: Math.max(0, Math.round(b.width * z)), height: Math.max(0, Math.round(b.height * z)),
    });
  }

  zoom(tabId, dir) {
    const wc = this.wc(tabId);
    if (!wc) return;
    const cur = wc.getZoomFactor();
    let next;
    if (dir === 0) next = this.store.settings.defaultZoom || 1;
    else if (dir > 0) next = ZOOM_LEVELS.find((z) => z > cur + 0.001) || ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
    else next = [...ZOOM_LEVELS].reverse().find((z) => z < cur - 0.001) || ZOOM_LEVELS[0];
    wc.setZoomFactor(next);
    this.notify(tabId);
  }

  tabData(tabId) {
    const t = this.tabs.get(tabId);
    if (!t) return null;
    const wc = t.view.webContents;
    const alive = !wc.isDestroyed();
    return {
      id: t.id,
      url: t.error ? t.error.url : t.url,
      title: t.title,
      favicon: t.favicon,
      loading: t.loading,
      canGoBack: alive && wc.navigationHistory.canGoBack(),
      canGoForward: alive && wc.navigationHistory.canGoForward(),
      zoom: alive ? +wc.getZoomFactor().toFixed(2) : 1,
      audible: t.audible,
      muted: alive && wc.isAudioMuted(),
      profileId: t.profileId,
      error: t.error,
      crashed: t.crashed,
      flowPanel: t.flowPanel || null,
    };
  }

  notify(tabId) {
    const d = this.tabData(tabId);
    if (d) this.send('browser:tab-updated', d);
  }

  saveSession() {
    clearTimeout(this.sessionTimer);
    this.sessionTimer = setTimeout(() => {
      const tabs = this.order.map((id) => this.tabs.get(id)).filter(Boolean)
        .map((t) => ({ url: t.error ? t.error.url : t.url, profileId: t.profileId }))
        .filter((t) => t.url && !t.url.startsWith('data:'));
      if (!tabs.length) return; // keep the last real session if everything was closed
      this.store.setSession({ tabs, active: Math.max(0, this.order.indexOf(this.activeTabId)) });
    }, 500);
  }

  // ------------------------------------------------------------------- menus
  showPageMenu(tab, p) {
    const wc = tab.view.webContents;
    const items = [];
    const open = (url, background) => this.createTab(url, tab.profileId, { background, openerWc: wc });
    const search = (q) => (SEARCH_URLS[this.store.settings.searchEngine] || SEARCH_URLS.google) + encodeURIComponent(q);

    if (p.misspelledWord && p.dictionarySuggestions && p.dictionarySuggestions.length) {
      for (const s of p.dictionarySuggestions.slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
      items.push({ label: 'Add to dictionary', click: () => wc.session.addWordToSpellCheckerDictionary(p.misspelledWord) });
      items.push({ type: 'separator' });
    }
    if (p.linkURL) {
      items.push({ label: 'Open link in new tab', click: () => open(p.linkURL, true) });
      items.push({ label: 'Copy link address', click: () => clipboard.writeText(p.linkURL) });
      items.push({ type: 'separator' });
    }
    if (p.mediaType === 'image' && p.srcURL) {
      items.push({ label: 'Open image in new tab', click: () => open(p.srcURL, true) });
      items.push({ label: 'Save image as…', click: () => wc.downloadURL(p.srcURL) });
      items.push({ label: 'Copy image', click: () => wc.copyImageAt(p.x, p.y) });
      items.push({ label: 'Copy image address', click: () => clipboard.writeText(p.srcURL) });
      items.push({ type: 'separator' });
    }
    if ((p.mediaType === 'video' || p.mediaType === 'audio') && p.srcURL && !p.srcURL.startsWith('blob:')) {
      items.push({ label: `Save ${p.mediaType} as…`, click: () => wc.downloadURL(p.srcURL) });
      items.push({ label: `Open ${p.mediaType} in new tab`, click: () => open(p.srcURL, true) });
      items.push({ type: 'separator' });
    }
    if (p.isEditable) {
      items.push({ role: 'undo', enabled: p.editFlags.canUndo }, { role: 'redo', enabled: p.editFlags.canRedo }, { type: 'separator' });
      items.push({ role: 'cut', enabled: p.editFlags.canCut }, { role: 'copy', enabled: p.editFlags.canCopy },
        { role: 'paste', enabled: p.editFlags.canPaste }, { role: 'selectAll' }, { type: 'separator' });
    } else if (p.selectionText && p.selectionText.trim()) {
      const q = p.selectionText.trim();
      items.push({ role: 'copy' });
      items.push({ label: `Search for “${q.length > 30 ? q.slice(0, 30) + '…' : q}”`, click: () => open(search(q), false) });
      items.push({ type: 'separator' });
    }
    if (!p.linkURL && p.mediaType === 'none' && !p.isEditable && !(p.selectionText && p.selectionText.trim())) {
      items.push({ label: 'Back', enabled: wc.navigationHistory.canGoBack(), click: () => wc.navigationHistory.goBack() });
      items.push({ label: 'Forward', enabled: wc.navigationHistory.canGoForward(), click: () => wc.navigationHistory.goForward() });
      items.push({ label: 'Reload', click: () => wc.reload() });
      items.push({ type: 'separator' });
      items.push({ label: 'Save page as…', click: () => this.savePage(wc) });
      items.push({ label: 'Print…', click: () => wc.print({}, () => {}) });
      items.push({ label: 'Bookmark this page', click: () => this.send('browser:command', { cmd: 'bookmark', tabId: tab.id }) });
      items.push({ type: 'separator' });
      items.push({ label: 'View page source', click: () => open('view-source:' + wc.getURL(), false) });
    }
    items.push({ label: 'Inspect', click: () => { wc.inspectElement(p.x, p.y); if (wc.isDevToolsOpened()) wc.devToolsWebContents && wc.devToolsWebContents.focus(); } });
    Menu.buildFromTemplate(items).popup({ window: this.mainWindow });
  }

  async savePage(wc) {
    const title = (wc.getTitle() || 'page').replace(/[<>:"/\\|?*]/g, '-').slice(0, 80);
    const r = await dialog.showSaveDialog(this.mainWindow, {
      defaultPath: path.join(this.downloadDir(), title + '.html'),
      filters: [{ name: 'Web page, complete', extensions: ['html'] }],
    });
    if (!r.canceled && r.filePath) wc.savePage(r.filePath, 'HTMLComplete').catch((e) => dialog.showErrorBox('Save failed', e.message));
  }

  showTabMenu(tabId) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const idx = this.order.indexOf(tabId);
    const cmd = (c) => () => this.send('browser:command', { cmd: c, tabId });
    const muted = tab.view.webContents.isAudioMuted();
    Menu.buildFromTemplate([
      { label: 'New tab to the right', click: () => this.createTab(this.store.settings.homepage, tab.profileId, { index: idx + 1 }) },
      { type: 'separator' },
      { label: 'Reload', click: () => tab.view.webContents.reload() },
      { label: 'Duplicate', click: () => this.createTab(tab.error ? tab.error.url : tab.url, tab.profileId, { index: idx + 1 }) },
      { label: muted ? 'Unmute site' : 'Mute site', click: () => { tab.view.webContents.setAudioMuted(!muted); this.notify(tabId); } },
      { label: 'Bookmark tab', click: cmd('bookmark') },
      { type: 'separator' },
      { label: 'Close tab', accelerator: 'Ctrl+W', click: () => this.closeTab(tabId) },
      { label: 'Close other tabs', enabled: this.order.length > 1, click: () => this.order.filter((id) => id !== tabId).forEach((id) => this.closeTab(id)) },
      { label: 'Close tabs to the right', enabled: idx < this.order.length - 1, click: () => this.order.slice(idx + 1).forEach((id) => this.closeTab(id)) },
      { type: 'separator' },
      { label: 'Reopen closed tab', accelerator: 'Ctrl+Shift+T', enabled: this.closedTabs.length > 0, click: cmd('reopen-tab') },
    ]).popup({ window: this.mainWindow });
  }

  showAppMenu(x, y) {
    const s = this.store.settings;
    const cmd = (c) => () => this.send('browser:command', { cmd: c, tabId: this.activeTabId });
    const has = !!this.activeTabId;
    const zoom = has ? Math.round(this.wc(this.activeTabId).getZoomFactor() * 100) : 100;
    Menu.buildFromTemplate([
      { label: 'New tab', accelerator: 'Ctrl+T', click: cmd('new-tab') },
      {
        label: 'New tab in profile',
        submenu: s.profiles.map((p) => ({ label: p.name, click: () => this.createTab(s.homepage, p.id) })),
      },
      { label: 'Reopen closed tab', accelerator: 'Ctrl+Shift+T', enabled: this.closedTabs.length > 0, click: cmd('reopen-tab') },
      { type: 'separator' },
      { label: 'History', accelerator: 'Ctrl+H', click: cmd('history') },
      { label: 'Downloads', accelerator: 'Ctrl+J', click: cmd('downloads') },
      { label: 'Bookmarks', click: cmd('bookmarks') },
      { label: s.showBookmarksBar ? 'Hide bookmarks bar' : 'Show bookmarks bar', click: cmd('toggle-bookmarks-bar') },
      { type: 'separator' },
      {
        label: `Zoom (${zoom}%)`, enabled: has,
        submenu: [
          { label: 'Zoom in', accelerator: 'Ctrl+=', click: cmd('zoom-in') },
          { label: 'Zoom out', accelerator: 'Ctrl+-', click: cmd('zoom-out') },
          { label: 'Reset', accelerator: 'Ctrl+0', click: cmd('zoom-reset') },
        ],
      },
      { label: 'Find in page…', accelerator: 'Ctrl+F', enabled: has, click: cmd('find') },
      { label: 'Print…', accelerator: 'Ctrl+P', enabled: has, click: cmd('print') },
      { label: 'Save page as…', enabled: has, click: () => has && this.savePage(this.wc(this.activeTabId)) },
      { type: 'separator' },
      { label: 'Focus mode', accelerator: 'F11', click: cmd('focus-mode') },
      { label: 'Developer tools', accelerator: 'F12', enabled: has, click: cmd('devtools') },
      { type: 'separator' },
      { label: 'Settings', accelerator: 'Ctrl+,', click: cmd('settings') },
    ]).popup({ window: this.mainWindow, x: Math.round(x), y: Math.round(y) });
  }

  // --------------------------------------------------------------- downloads
  downloadDir() {
    const d = this.store.settings.downloadDir;
    return d && fs.existsSync(d) ? d : app.getPath('downloads');
  }

  onWillDownload(item, wc) {
    const url = item.getURL();
    const fi = this.pendingFlow.findIndex((p) => p.url === url);
    const flow = fi >= 0 ? this.pendingFlow.splice(fi, 1)[0] : null;
    const id = 'dl-' + (++this.dlCounter);

    let savePath = null;
    if (flow) {
      savePath = uniquePath(path.join(this.downloadDir(), safeRelPath(flow.relPath)));
    } else if (!this.store.settings.askWhereToSave) {
      savePath = uniquePath(path.join(this.downloadDir(), safeRelPath(item.getFilename())));
    } else {
      item.setSaveDialogOptions({ defaultPath: path.join(this.downloadDir(), item.getFilename()) });
    }
    if (savePath) {
      try { fs.mkdirSync(path.dirname(savePath), { recursive: true }); } catch { /* setSavePath will fail loudly */ }
      item.setSavePath(savePath);
    }

    const d = {
      id, item, url, filename: savePath ? path.basename(savePath) : item.getFilename(),
      savePath, state: 'progressing', received: 0, total: item.getTotalBytes(), paused: false,
      started: Date.now(), flow,
    };
    this.downloads.set(id, d);
    this.send('browser:download-updated', this.dlData(d));
    if (!flow) this.send('browser:command', { cmd: 'downloads-started' });

    let last = 0;
    item.on('updated', (e, state) => {
      d.state = state === 'interrupted' ? 'interrupted' : 'progressing';
      d.received = item.getReceivedBytes();
      d.total = item.getTotalBytes();
      d.paused = item.isPaused();
      if (!d.savePath && item.getSavePath()) { d.savePath = item.getSavePath(); d.filename = path.basename(d.savePath); }
      const now = Date.now();
      if (now - last > 250) {
        last = now;
        this.send('browser:download-updated', this.dlData(d));
        if (flow) this.flowProgress(flow, 'downloading', d.total ? Math.round((d.received / d.total) * 100) : 0);
      }
    });
    item.once('done', (e, state) => {
      d.state = state; // completed | cancelled | interrupted
      d.received = item.getReceivedBytes();
      if (item.getSavePath()) { d.savePath = item.getSavePath(); d.filename = path.basename(d.savePath); }
      d.item = null;
      this.send('browser:download-updated', this.dlData(d));
      if (flow) this.flowProgress(flow, state === 'completed' ? 'downloaded' : 'error', state === 'completed' ? 100 : 0);
      // Flow results also become assets of the studio's current project.
      if (flow && state === 'completed' && d.savePath && this.onFlowAsset) {
        try { this.onFlowAsset(d.savePath, flow.meta); } catch (e) { console.warn('[Browser] project asset:', e.message); }
      }
    });
  }

  dlData(d) {
    return {
      id: d.id, url: d.url, filename: d.filename, savePath: d.savePath, state: d.state,
      received: d.received, total: d.total, paused: d.paused, started: d.started,
      canResume: !!(d.item && d.item.canResume()),
    };
  }

  // ------------------------------------------------------------- Flow bridge
  flowDownload(sender, req) {
    const tab = this.tabByWebContents(sender);
    if (!tab || !req || !req.url) return;
    const flow = { url: req.url, relPath: req.relPath || 'Flow Media Downloader/download', mediaId: req.mediaId, wc: sender, meta: req.meta || null };
    this.pendingFlow.push(flow);
    this.flowProgress(flow, 'downloading', 0);
    try {
      sender.downloadURL(req.url);
    } catch (e) {
      this.pendingFlow = this.pendingFlow.filter((p) => p !== flow);
      this.flowProgress(flow, 'error', 0);
    }
    // If will-download never fires (bad URL), don't leave it pending forever.
    setTimeout(() => {
      const i = this.pendingFlow.indexOf(flow);
      if (i >= 0) { this.pendingFlow.splice(i, 1); this.flowProgress(flow, 'error', 0); }
    }, 60000);
  }

  // A message to the Flow extension in every open tab.
  broadcastToTabs(message) {
    for (const t of this.tabs.values()) {
      const wc = t.view.webContents;
      if (!wc.isDestroyed()) wc.send('flow-host:to-ext', message);
    }
  }

  flowProgress(flow, status, progress) {
    if (flow.wc && !flow.wc.isDestroyed()) {
      flow.wc.send('flow-host:to-ext', { action: 'downloadProgress', mediaId: flow.mediaId, status, progress });
    }
  }

  // The extension's service worker injects this into the page's main world
  // with chrome.scripting, which Electron lacks; run the same function here.
  loadMainWorldSource() {
    if (this.mainWorldSrc) return this.mainWorldSrc;
    const sw = fs.readFileSync(path.join(flowExtensionPath(), 'background', 'service-worker.js'), 'utf8');
    const m = sw.match(/function mainWorldBypass\(payload\)\s*\{[\s\S]*?\n\}\n/);
    if (!m) throw new Error('mainWorldBypass not found in the extension service worker');
    this.mainWorldSrc = m[0];
    return this.mainWorldSrc;
  }

  async flowExecMainWorld(sender, payload) {
    if (!this.tabByWebContents(sender)) return { status: 'error', error: 'not a browser tab' };
    try {
      const src = this.loadMainWorldSource();
      await sender.executeJavaScript(`(${src})(${JSON.stringify(payload || {})});`, true);
      return { status: 'success' };
    } catch (e) {
      return { status: 'error', error: String(e && e.message ? e.message : e) };
    }
  }
}
