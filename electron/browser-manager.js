// Built-in browser: tabs are WebContentsViews laid over the host page's
// viewport element. The host page (public/browser.html) owns the UI; this
// class owns the pages, their sessions, downloads, menus and the bridge that
// lets the Flow Downloader extension work without Chrome-only APIs.
import { WebContentsView, BrowserWindow, session, ipcMain, Menu, clipboard, shell, app, dialog, net } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { BrowserStore } from './browser-store.js';
import {
  normalizeProxy, validateProxy, publicProxy, proxyFromForm,
  applyToSession, copyCookies, testProxy, pruneBridges,
} from './browser-proxy.js';
import crypto from 'crypto';

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

// Google refuses to sign in from browsers it takes for embedded apps
// ("This browser or app may not be secure"). On Google's sign-in pages only,
// tabs present themselves as standard Firefox, whose sign-in Google accepts;
// everywhere else they stay Chrome. The sign-in cookies then serve Flow etc.
const SIGNIN_HOST = /^accounts\.google\.com$/i;
const SIGNIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0';
const isSignin = (url) => { try { return SIGNIN_HOST.test(new URL(url).hostname); } catch { return false; } };

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
    this.tabSessions = new Set();   // partitions that belong to tabs with their own proxy
    this.sessionCreds = new Map();  // partition -> proxy sign-in its proxy will ask for (or null)
    this.baseUrl = '';              // the app's local server (new-tab page)
    this.downloads = new Map();     // download id -> record
    this.dlCounter = 0;
    this.pendingFlow = [];          // Flow bridge downloads awaiting will-download
    this.closedTabs = [];           // for "reopen closed tab"
    this.mainWorldSrc = null;

    this.removeOldTabSessions();
    this.setupIPC();

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
    return this.ensurePartition(partitionFor(profileId));
  }

  // A browsing session with everything a tab needs: user agent, downloads,
  // the Flow extension, and its proxy. Profile sessions follow the global
  // proxy; a tab's own session (`tabProxy`) has its own and starts with a
  // copy of its profile's cookies.
  ensurePartition(partition, { tabProxy = null, seedFrom = null } = {}) {
    if (this.sessions.has(partition)) return this.sessions.get(partition);
    const p = (async () => {
      const ses = session.fromPartition(partition);
      ses.setUserAgent(cleanUserAgent(ses.getUserAgent()));
      ses.on('will-download', (e, item, wc) => this.onWillDownload(item, wc));
      this.watchFlowApi(ses, partition);
      this.sessionCreds.set(partition, await applyToSession(ses, tabProxy || this.globalProxy()));
      if (seedFrom) await copyCookies(await this.ensurePartition(seedFrom), ses);
      const ext = flowExtensionPath();
      if (fs.existsSync(path.join(ext, 'manifest.json'))) {
        try {
          const loaded = ses.getAllExtensions ? ses.getAllExtensions() : [];
          if (!loaded.some((x) => (x.name === 'Frameloom Flow Tools' || x.name === 'VoiceCraft Flow Downloader'))) {
            const info = await ses.loadExtension(ext, { allowFileAccess: true });
            this.extensionInfo = { name: info.name, version: info.version, path: ext, loaded: true };
          }
        } catch (err) {
          this.extensionInfo = { name: 'Frameloom Flow Tools', path: ext, loaded: false, error: err.message };
          console.warn('[Browser] extension failed to load:', err.message);
        }
      } else {
        this.extensionInfo = { name: 'Frameloom Flow Tools', path: ext, loaded: false, error: 'Extension folder not found' };
      }
      return ses;
    })();
    this.sessions.set(partition, p);
    if (tabProxy) this.tabSessions.add(partition);
    return p;
  }

  globalProxy() { return normalizeProxy(this.store.settings.proxy); }

  // Google Flow's new site (flow.google.com) signs its API calls itself; the
  // Automator reuses that sign-in rather than a session endpoint the new site
  // no longer has. Kept in memory per session, never saved. Which endpoints
  // Flow calls (paths only) is kept for the diagnostics in Settings.
  watchFlowApi(ses, partition) {
    this.flowAuth = this.flowAuth || new Map();   // partition -> { authorization, authUser, at }
    this.flowCalls = this.flowCalls || new Map(); // "METHOD host/path" -> { n, at, auth }
    const fromFlow = (d) => {
      const u = d.referrer || (d.webContents && !d.webContents.isDestroyed() ? d.webContents.getURL() : '') || '';
      return /^https:\/\/(flow\.google\.com|labs\.google)\//.test(u);
    };
    ses.webRequest.onBeforeSendHeaders({ urls: ['https://*.googleapis.com/*', 'https://flow.google.com/*', 'https://labs.google/*', 'https://accounts.google.com/*'] }, (d, cb) => {
      // Google sign-in pages: the Firefox identity, without Chromium's client hints.
      if (isSignin(d.url)) {
        const h = { ...d.requestHeaders, 'User-Agent': SIGNIN_UA };
        for (const k of Object.keys(h)) if (/^sec-ch-ua/i.test(k)) delete h[k];
        cb({ requestHeaders: h });
        return;
      }
      try {
        if (fromFlow(d) && /^(GET|POST|PATCH|PUT|DELETE)$/.test(d.method) && d.resourceType !== 'image' && d.resourceType !== 'media') {
          const u = new URL(d.url);
          const h = d.requestHeaders || {};
          const auth = h.Authorization || h.authorization || '';
          const key = `${d.method} ${u.host}${u.pathname.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ':id')}`;
          if (/googleapis\.com$/.test(u.host) || /\/api\//.test(u.pathname)) {
            const c = this.flowCalls.get(key) || { n: 0 };
            this.flowCalls.set(key, { n: c.n + 1, at: Date.now(), auth: auth ? auth.split(' ')[0] : c.auth || '' });
            if (this.flowCalls.size > 300) this.flowCalls.delete(this.flowCalls.keys().next().value);
          }
          if (auth && /googleapis\.com$/.test(u.host)) {
            this.flowAuth.set(partition, { authorization: auth, authUser: h['X-Goog-AuthUser'] || h['x-goog-authuser'] || null, at: Date.now() });
          }
        }
      } catch { /* never block a request over bookkeeping */ }
      cb({});
    });
  }

  flowDiagnostics() {
    const calls = [...(this.flowCalls || new Map()).entries()].sort((a, b) => b[1].at - a[1].at)
      .map(([k, v]) => `${k}  ×${v.n}${v.auth ? '  [' + v.auth + ']' : ''}`);
    const auth = [...(this.flowAuth || new Map()).values()].sort((a, b) => b.at - a.at)[0];
    return { signedInSeen: !!auth, authScheme: auth ? auth.authorization.split(' ')[0] : null, seenAt: auth ? auth.at : null, calls };
  }

  // Sessions of proxied tabs from earlier runs (restored tabs get new ones).
  removeOldTabSessions() {
    const dir = path.join(app.getPath('userData'), 'Partitions');
    let names = [];
    try { names = fs.readdirSync(dir); } catch { return; }
    for (const n of names) {
      if (!/^browser-tab-[0-9a-f-]{36}$/i.test(n)) continue;
      try { fs.rmSync(path.join(dir, n), { recursive: true, force: true }); } catch { /* in use; next time */ }
    }
  }

  // The browser-wide proxy goes to every profile session (tab sessions keep theirs).
  async applyGlobalProxy() {
    const g = this.globalProxy();
    for (const [partition, p] of this.sessions) {
      if (!this.tabSessions.has(partition)) this.sessionCreds.set(partition, await applyToSession(await p, g));
    }
    this.pruneBridges();
  }

  // Download a URL the way a tab would — its cookies, its proxy — from the
  // main process. Requests made through a tab's own session crash Electron 33
  // (it has the extension loaded), so a plain helper session with the same
  // proxy carries them, with the tab's cookies attached.
  async fetchForTab(tab, url, timeoutMs = 60000) {
    this.fetchSessions = this.fetchSessions || new Map();
    let helper = this.fetchSessions.get(tab.partition);
    if (!helper) {
      helper = session.fromPartition('media-fetch-' + this.fetchSessions.size + '-' + Date.now());
      helper.setUserAgent(cleanUserAgent(helper.getUserAgent()));
      this.fetchSessions.set(tab.partition, helper);
    }
    const creds = await applyToSession(helper, tab.proxy || this.globalProxy());
    const tabSes = (await this.sessions.get(tab.partition)) || session.fromPartition(tab.partition);
    let cookie = '';
    try { cookie = (await tabSes.cookies.get({ url })).map((c) => `${c.name}=${c.value}`).join('; '); } catch { /* none */ }
    return new Promise((resolve, reject) => {
      const req = net.request({ url, session: helper, useSessionCookies: false });
      if (cookie) req.setHeader('Cookie', cookie);
      const chunks = [];
      let tries = 0;
      const timer = setTimeout(() => { try { req.abort(); } catch { /* gone */ } reject(new Error('Timed out')); }, timeoutMs);
      req.on('login', (authInfo, cb) => { if (authInfo.isProxy && creds && tries++ < 1) cb(creds.username, creds.password); else cb(); });
      req.on('response', (res) => {
        if (res.statusCode >= 400) { clearTimeout(timer); res.on('data', () => {}); reject(new Error('HTTP ' + res.statusCode)); return; }
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          clearTimeout(timer);
          const ct = res.headers['content-type'];
          resolve({ buffer: Buffer.concat(chunks), mime: String(Array.isArray(ct) ? ct[0] : ct || '').split(';')[0] || null });
        });
      });
      req.on('error', (e) => { clearTimeout(timer); reject(e); });
      req.end();
    });
  }

  // SOCKS5 sign-in bridges nothing uses any more are closed.
  pruneBridges() {
    pruneBridges([this.globalProxy(), ...[...this.tabs.values()].map((t) => t.proxy).filter(Boolean)]);
  }

  // A tab's own session goes away with the last tab using it.
  releasePartition(partition) {
    if (!this.tabSessions.has(partition)) return;
    if ([...this.tabs.values()].some((t) => t.partition === partition)) return;
    const p = this.sessions.get(partition);
    this.sessions.delete(partition);
    this.tabSessions.delete(partition);
    this.sessionCreds.delete(partition);
    setTimeout(() => this.pruneBridges(), 0);
    if (p) p.then((ses) => ses.clearStorageData().catch(() => {})).catch(() => {});
  }

  // Settings as the UI sees them: the proxy without its password.
  publicSettings() {
    return { ...this.store.settings, proxy: publicProxy(this.store.settings.proxy, 'global') };
  }

  networkState() {
    return {
      global: publicProxy(this.store.settings.proxy, 'global'),
      tabs: this.order.map((id) => this.tabs.get(id)).filter((t) => t && t.proxy)
        .map((t) => {
          let title = t.title;
          if (!title || title === 'New tab') { try { title = new URL(t.url).host; } catch { title = 'Tab'; } }
          return { id: t.id, title, proxy: publicProxy(t.proxy, 'tab') };
        }),
    };
  }

  // Put a tab on its own proxy (or back on the browser-wide one). The page's
  // session can't change, so the tab is rebuilt in place with the same URL.
  async setTabProxy(tabId, proxy, { savedProxy } = {}) {
    const tab = this.tabs.get(tabId);
    if (!tab) return null;
    const idx = this.order.indexOf(tabId);
    const wasActive = this.activeTabId === tabId;
    const url = tab.error ? tab.error.url : tab.url;
    const newId = await this.createTab(url, tab.profileId, { index: idx, background: !wasActive, proxy, savedProxy });
    this.closeTab(tabId, { replaced: true });
    if (wasActive) this.activateTab(newId);
    return newId;
  }

  // What a new tab opens when no URL is given: Flow first, Arena second,
  // then the new-tab page (or the home page, if the user prefers).
  defaultTabUrl() {
    const s = this.store.settings;
    const n = this.order.length;
    if (n === 0 && s.firstTabUrl) return s.firstTabUrl;
    if (n === 1 && s.secondTabUrl) return s.secondTabUrl;
    if (s.newTabPage === 'home' || !this.baseUrl) return s.homepage;
    return `${this.baseUrl}/newtab.html?engine=${encodeURIComponent(s.searchEngine || 'google')}`;
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
      settings: this.publicSettings(),
      bookmarks: this.store.data.bookmarks,
      hasSession: !!(this.store.data.session && this.store.data.session.tabs && this.store.data.session.tabs.length),
      newTabUrl: this.baseUrl ? `${this.baseUrl}/newtab.html` : '',
      downloads: [...this.downloads.values()].map((d) => this.dlData(d)),
      extension: this.extensionInfo || null,
      versions: { app: app.getVersion(), electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
      defaultDownloadDir: app.getPath('downloads'),
    }));

    handle('browser:create-tab', ({ url, profileId, background, index } = {}) => this.createTab(url, profileId, { background, index }));
    // Last session's tabs (with their proxies), restored here so stored
    // proxy secrets never pass through the UI.
    handle('browser:restore-session', async () => {
      const sess = this.store.data.session;
      if (!sess || !Array.isArray(sess.tabs) || !sess.tabs.length) return null;
      const ids = [];
      for (const t of sess.tabs) ids.push(await this.createTab(t.url, t.profileId, { background: true, proxy: t.proxy || null, savedProxy: t.savedProxy || null }));
      const pick = ids[Math.min(sess.active || 0, ids.length - 1)];
      if (pick) this.activateTab(pick);
      return ids;
    });
    on('browser:close-tab', (tabId) => this.closeTab(tabId));
    on('browser:activate-tab', (tabId) => this.activateTab(tabId));
    on('browser:set-order', (ids) => {
      if (Array.isArray(ids)) this.order = ids.filter((id) => this.tabs.has(id)).concat(this.order.filter((id) => !ids.includes(id)));
      this.saveSession();
    });
    handle('browser:reopen-closed', () => {
      const last = this.closedTabs.pop();
      return last ? this.createTab(last.url, last.profileId, { index: last.index, proxy: last.proxy || null }) : null;
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
      patch = { ...(patch || {}) };
      delete patch.proxy; // only through browser:set-proxy
      const s = this.store.setSettings(patch);
      if (patch && 'defaultZoom' in patch && prev.defaultZoom !== s.defaultZoom) {
        for (const t of this.tabs.values()) { t.view.webContents.setZoomFactor(s.defaultZoom); this.notify(t.id); }
      }
      return this.publicSettings();
    });

    // ---- network / proxy ----
    handle('browser:get-network', () => this.networkState());
    // { scope: 'tab' | 'global', tabId, form, follow, action }
    //   follow: tab back to the browser proxy; action: 'disable' | 'enable' | 'remove'
    handle('browser:set-proxy', async ({ scope, tabId, form, follow, action } = {}) => {
      if (scope === 'tab' && action) {
        const tab = this.tabs.get(tabId);
        if (!tab) return { ok: false, error: 'That tab is gone.' };
        let newId = tabId;
        if (action === 'disable' && tab.proxy) newId = await this.setTabProxy(tabId, null, { savedProxy: tab.proxy });
        else if (action === 'enable' && tab.savedProxy) newId = await this.setTabProxy(tabId, { ...tab.savedProxy, enabled: true });
        else if (action === 'remove') {
          if (tab.proxy) newId = await this.setTabProxy(tabId, null);
          else { tab.savedProxy = null; this.notify(tabId); this.saveSession(); }
        }
        return { ok: true, tabId: newId, network: this.networkState() };
      }
      if (scope !== 'tab' && action) {
        const cur = this.globalProxy();
        const next = action === 'remove' ? { type: 'system' } : { ...cur, enabled: action === 'enable' };
        this.store.setSettings({ proxy: normalizeProxy(next) });
        await this.applyGlobalProxy();
        for (const id of this.order) this.notify(id);
        return { ok: true, settings: this.publicSettings(), network: this.networkState() };
      }
      if (scope === 'tab') {
        const tab = this.tabs.get(tabId);
        if (!tab) return { ok: false, error: 'That tab is gone.' };
        let proxy = null;
        if (!follow) {
          proxy = proxyFromForm(form || {}, tab.proxy);
          const err = validateProxy(proxy);
          if (err) return { ok: false, error: err };
          if (proxy.type === 'system') proxy = null; // = follow the browser
        }
        const newId = await this.setTabProxy(tabId, proxy);
        return { ok: true, tabId: newId, network: this.networkState() };
      }
      const proxy = proxyFromForm(form || {}, this.globalProxy());
      const err = validateProxy(proxy);
      if (err) return { ok: false, error: err };
      this.store.setSettings({ proxy });
      await this.applyGlobalProxy();
      for (const id of this.order) this.notify(id);
      return { ok: true, settings: this.publicSettings(), network: this.networkState() };
    });
    handle('browser:test-proxy', async ({ form, scope, tabId } = {}) => {
      const prev = scope === 'tab' ? (this.tabs.get(tabId) || {}).proxy : this.globalProxy();
      return testProxy(proxyFromForm(form || {}, prev));
    });
    handle('browser:pick-download-dir', async () => {
      const r = await dialog.showOpenDialog(this.mainWindow, { properties: ['openDirectory', 'createDirectory'], defaultPath: this.downloadDir() });
      if (r.canceled || !r.filePaths[0]) return this.publicSettings();
      this.store.setSettings({ downloadDir: r.filePaths[0] });
      return this.publicSettings();
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
    on('browser:file-chooser-result', ({ requestId, paths, browse } = {}) => {
      const resolve = this.fileChoosers && this.fileChoosers.get(requestId);
      if (!resolve) return;
      this.fileChoosers.delete(requestId);
      resolve({ paths: Array.isArray(paths) ? paths.map(String) : [], browse: !!browse });
    });

    // Flow Downloader → AutoEditor. Only a Flow tab may add media to the
    // project (any other site could otherwise push files into it).
    ipcMain.handle('flow-host:import-media', async (e, { items } = {}) => {
      const tab = this.tabByWebContents(e.sender);
      if (!tab || !this.onImportMedia) return { ok: false, error: 'Not available here.' };
      let host = '';
      try { host = new URL(e.sender.getURL()).host; } catch { /* no URL */ }
      const own = this.baseUrl && e.sender.getURL().startsWith(this.baseUrl + '/__t/');
      if (!own && !/(^|\.)flow\.google\.com$|(^|\.)labs\.google$/.test(host)) return { ok: false, error: 'Only Google Flow pages can send media to the AutoEditor.' };
      return this.onImportMedia(items || [], (url) => this.fetchForTab(tab, url));
    });

    // The Automator, on Flow's new site: the sign-in Flow's own calls use.
    ipcMain.handle('flow-host:get-flow-auth', (e) => {
      const tab = this.tabByWebContents(e.sender);
      if (!tab) return null;
      let host = '';
      try { host = new URL(e.sender.getURL()).host; } catch { /* none */ }
      if (!/(^|\.)flow\.google\.com$|(^|\.)labs\.google$/.test(host)) return null;
      const a = this.flowAuth && this.flowAuth.get(tab.partition);
      return a && Date.now() - a.at < 50 * 60 * 1000 ? { authorization: a.authorization, authUser: a.authUser } : null;
    });
    handle('browser:flow-diagnostics', () => this.flowDiagnostics());

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

  // `proxy`: this tab's own proxy (its own session); `shareWith`: open in an
  // existing tab's session (pages opened from a proxied tab stay on its proxy).
  async createTab(url, profileId, { background = false, index, openerWc, proxy = null, shareWith = null, savedProxy = null } = {}) {
    profileId = profileId || this.store.settings.activeProfile || 'default';
    if (!this.store.settings.profiles.some((p) => p.id === profileId)) profileId = 'default';
    url = url || this.defaultTabUrl();

    let partition = partitionFor(profileId);
    if (shareWith && shareWith.proxy && this.sessions.has(shareWith.partition)) {
      partition = shareWith.partition;
      proxy = shareWith.proxy;
    } else if (proxy) {
      proxy = normalizeProxy(proxy);
      // Persistent (Electron loads extensions — the Flow tools — only into
      // persistent sessions); its folder is cleared when the tab closes and
      // removed at the next start.
      partition = 'persist:browser-tab-' + crypto.randomUUID();
      await this.ensurePartition(partition, { tabProxy: proxy, seedFrom: partitionFor(profileId) });
    }
    await this.ensurePartition(partition);

    const tabId = 'tab-' + (++this.tabCounter);
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
      proxy: proxy || null, proxyAuthTries: 0,
      savedProxy: proxy ? null : (savedProxy ? normalizeProxy(savedProxy) : null), // its own proxy, switched off
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

  // A website's file picker (<input type=file>) opens the studio's project
  // picker instead: the project's renders and media first, the computer one
  // click away. Chromium's DevTools protocol lets us catch the picker and
  // hand the input its files; the page can't tell the difference.
  watchFileChooser(tab) {
    const wc = tab.view.webContents;
    const dbg = wc.debugger;
    const attach = async () => {
      if (wc.isDestroyed() || dbg.isAttached()) return;
      if (isSignin(wc.getURL())) return; // Google's sign-in treats an attached debugger as automation
      try {
        dbg.attach('1.3');
        await dbg.sendCommand('Page.enable');
        await dbg.sendCommand('Page.setInterceptFileChooserDialog', { enabled: true });
      } catch (e) { /* another debugger owns it: the normal dialog is used */ }
    };
    dbg.on('message', async (e, method, params) => {
      if (method !== 'Page.fileChooserOpened') return;
      const { backendNodeId, mode } = params || {};
      let accept = '';
      try {
        await dbg.sendCommand('DOM.enable');
        const { object } = await dbg.sendCommand('DOM.resolveNode', { backendNodeId });
        const r = await dbg.sendCommand('Runtime.callFunctionOn', {
          objectId: object.objectId, functionDeclaration: 'function () { return this.accept || ""; }', returnByValue: true,
        });
        accept = (r && r.result && r.result.value) || '';
      } catch { /* no accept info */ }
      try {
        const files = await this.pickFiles(tab, { multiple: mode === 'selectMultiple', accept });
        if (files && files.length) await dbg.sendCommand('DOM.setFileInputFiles', { files, backendNodeId });
      } catch (err) {
        console.warn('[Browser] file picker:', err.message);
      } finally {
        try { await dbg.sendCommand('DOM.disable'); } catch { /* fine */ }
      }
    });
    // A new document needs the interception again.
    wc.on('did-start-navigation', (e, url, inPlace, isMainFrame) => {
      if (!isMainFrame || inPlace) return;
      if (isSignin(url)) { try { if (dbg.isAttached()) dbg.detach(); } catch { /* gone */ } return; }
      setTimeout(attach, 0);
    });
    wc.on('dom-ready', attach);
    attach();
  }

  // Ask the browser UI which files to give the page (or open the OS dialog).
  async pickFiles(tab, { multiple, accept }) {
    const files = this.getProjectFiles ? this.getProjectFiles() : null;
    const browseOS = async () => {
      const filters = [];
      const exts = String(accept || '').split(',').map((x) => x.trim()).filter((x) => x.startsWith('.')).map((x) => x.slice(1));
      if (exts.length) filters.push({ name: 'Allowed files', extensions: exts });
      if (/video\//.test(accept)) filters.push({ name: 'Videos', extensions: ['mp4', 'mov', 'webm', 'mkv', 'avi', 'm4v'] });
      if (/image\//.test(accept)) filters.push({ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] });
      if (/audio\//.test(accept)) filters.push({ name: 'Audio', extensions: ['mp3', 'wav', 'm4a', 'ogg', 'flac'] });
      filters.push({ name: 'All files', extensions: ['*'] });
      const r = await dialog.showOpenDialog(this.mainWindow, {
        properties: multiple ? ['openFile', 'multiSelections'] : ['openFile'], filters,
        defaultPath: files && files.rendersDir && fs.existsSync(files.rendersDir) ? files.rendersDir : undefined,
      });
      return r.canceled ? [] : r.filePaths;
    };
    if (!files || !this.host || this.host.isDestroyed() || !this.moduleVisible) return browseOS();
    const requestId = 'fc' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const answer = await new Promise((resolve) => {
      this.fileChoosers = this.fileChoosers || new Map();
      this.fileChoosers.set(requestId, resolve);
      this.send('browser:file-chooser', { requestId, multiple: !!multiple, accept, site: (() => { try { return new URL(tab.view.webContents.getURL()).host; } catch { return ''; } })(), ...files });
    });
    if (answer && answer.browse) return browseOS();
    // Only files the studio offered can come back (the UI can't name others).
    const allowed = new Set([...(files.renders || []), ...(files.media || [])].map((f) => f.path));
    return ((answer && answer.paths) || []).filter((p) => allowed.has(p));
  }

  wireTab(tab) {
    const wc = tab.view.webContents;
    const id = tab.id;
    this.watchFileChooser(tab);
    // Sign-in identity for this tab while it's on Google's sign-in pages.
    const normalUA = wc.getUserAgent();
    wc.on('did-start-navigation', (e, url, inPlace, isMainFrame) => {
      if (!isMainFrame) return;
      const want = isSignin(url) ? SIGNIN_UA : normalUA;
      if (wc.getUserAgent() !== want) wc.setUserAgent(want);
    });

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

    // Proxy sign-in (HTTP/HTTPS proxies): the tab's own proxy, or the
    // browser-wide one. Give up after a wrong answer instead of looping.
    wc.on('login', (e, details, authInfo, callback) => {
      if (!authInfo.isProxy) return;
      e.preventDefault();
      const creds = this.sessionCreds.get(tab.partition);
      if (creds && tab.proxyAuthTries++ < 2) callback(creds.username, creds.password);
      else callback();
    });
    wc.on('did-finish-load', () => { tab.proxyAuthTries = 0; });

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
      this.createTab(details.url, tab.profileId, { background: details.disposition === 'background-tab', openerWc: wc, shareWith: tab });
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

  closeTab(tabId, { replaced = false } = {}) {
    const tab = this.tabs.get(tabId);
    if (!tab) return;
    const idx = this.order.indexOf(tabId);
    const url = tab.error ? tab.error.url : tab.url;
    if (!replaced && url && !url.startsWith('data:')) {
      this.closedTabs.push({ url, profileId: tab.profileId, index: idx, proxy: tab.proxy });
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
    this.releasePartition(tab.partition);

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
      net: publicProxy(t.proxy || this.store.settings.proxy, t.proxy ? 'tab' : 'global'),
      netOff: t.savedProxy ? publicProxy(t.savedProxy, 'tab') : null,
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
        .map((t) => ({ url: t.error ? t.error.url : t.url, profileId: t.profileId, proxy: t.proxy || undefined, savedProxy: t.savedProxy || undefined }))
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
      { label: 'New tab to the right', click: () => this.createTab(null, tab.profileId, { index: idx + 1 }) },
      { type: 'separator' },
      { label: 'Reload', click: () => tab.view.webContents.reload() },
      { label: 'Duplicate', click: () => this.createTab(tab.error ? tab.error.url : tab.url, tab.profileId, { index: idx + 1, proxy: tab.proxy }) },
      { label: tab.proxy ? 'Use the browser proxy for this tab' : 'Proxy for this tab…', click: tab.proxy ? () => this.setTabProxy(tabId, null) : cmd('tab-proxy') },
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
        submenu: s.profiles.map((p) => ({ label: p.name, click: () => this.createTab(null, p.id) })),
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
