// VoiceCraft Studio shell: one window, three live modules.
//
// The window shows a slim studio bar (public/studio-shell.html) and, below it,
// one WebContentsView per module — VoiceCraft, AutoEditor, Browser. Each
// module's view is created the first time it's opened and then only shown or
// hidden, so switching never reloads a page: generation, timelines and Flow
// all keep running. Links between modules (and window.open) are turned into
// switches. The studio also owns the current project and its asset library.
import { WebContentsView, ipcMain, shell, Menu, protocol, net, session, app } from 'electron';
import path from 'path';
import fs from 'fs';
import { pathToFileURL, fileURLToPath } from 'url';
import { AssetLibrary } from './studio-assets.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const BAR_HEIGHT = 44;

export const MODULES = {
  voicecraft: { label: 'VoiceCraft', path: '/index.html' },
  autoeditor: { label: 'AutoEditor', path: '/auto-editor/index.html' },
  browser: { label: 'Browser', path: '/browser.html' },
};

// Which module a URL on the local server belongs to (null = not a module page).
export function moduleForUrl(url, base) {
  let u;
  try { u = new URL(url); } catch { return null; }
  if (!base || u.origin !== new URL(base).origin) return null;
  const p = u.pathname;
  if (p === '/' || p === '/index.html') return 'voicecraft';
  if (p.startsWith('/auto-editor')) return 'autoeditor';
  if (p === '/browser.html') return 'browser';
  return null;
}

// vcasset://<projectId>/<assetId> → the asset's file. Call before app ready.
export function registerAssetScheme() {
  protocol.registerSchemesAsPrivileged([{
    scheme: 'vcasset',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
  }]);
}

export class Studio {
  constructor(mainWindow, { baseUrl, browserManager }) {
    this.win = mainWindow;
    this.base = baseUrl;
    this.browser = browserManager;
    this.assets = new AssetLibrary();
    this.views = new Map();
    this.active = null;
    this.stateFile = path.join(app.getPath('userData'), 'studio', 'state.json');
    this.state = { project: null, lastModule: 'voicecraft' };
    try { this.state = { ...this.state, ...JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) }; } catch { /* first run */ }

    this.handleAssetScheme();
    this.setupIPC();
    this.win.on('resize', () => this.layout());
    this.win.on('enter-full-screen', () => setTimeout(() => this.layout(), 50));
    this.win.on('leave-full-screen', () => setTimeout(() => this.layout(), 50));
  }

  saveState() {
    try {
      fs.mkdirSync(path.dirname(this.stateFile), { recursive: true });
      fs.writeFileSync(this.stateFile, JSON.stringify(this.state));
    } catch { /* ignore */ }
  }

  handleAssetScheme() {
    session.defaultSession.protocol.handle('vcasset', (req) => {
      const u = new URL(req.url);
      const file = this.assets.filePath(decodeURIComponent(u.hostname), decodeURIComponent(u.pathname.slice(1)));
      if (!file) return new Response('Not found', { status: 404 });
      return net.fetch(pathToFileURL(file).toString(), { headers: req.headers });
    });
  }

  // ---- layout & switching ----
  barHeight() { return this.focusMode ? 0 : BAR_HEIGHT; }

  layout() {
    const [w, h] = this.win.getContentSize();
    const y = this.barHeight();
    for (const v of this.views.values()) v.view.setBounds({ x: 0, y, width: w, height: Math.max(0, h - y) });
    if (this.browser) this.browser.setOffset({ x: 0, y });
  }

  ensure(name) {
    if (this.views.has(name)) return this.views.get(name);
    const view = new WebContentsView({
      webPreferences: {
        preload: path.join(__dirname, 'preload.cjs'),
        contextIsolation: true, nodeIntegration: false, sandbox: true,
        // Hidden modules keep working at full speed (Flow, long renders).
        backgroundThrottling: false,
      },
    });
    view.setBackgroundColor('#0d0d0f');
    const wc = view.webContents;
    const entry = { name, view, wc };
    this.views.set(name, entry);
    this.wireNavigation(entry);
    this.win.contentView.addChildView(view);
    view.setVisible(false);
    this.layout();
    if (name === 'autoeditor') {
      // Messages for the AutoEditor wait until its page has its listeners up
      // (it says so with studio:editor-ready); a reload starts over.
      this.aeReady = false;
      this.aeQueue = [];
      wc.on('did-start-navigation', (d) => { if (d.isMainFrame && !d.isSameDocument) this.aeReady = false; });
    }
    wc.loadURL(this.base + MODULES[name].path);
    if (name === 'browser' && this.browser) this.browser.setHost(wc);
    return entry;
  }

  // Ctrl+Shift+1/2/3 switch modules from anywhere.
  moduleKey(input) {
    if (input.type !== 'keyDown' || !input.control || !input.shift) return false;
    const i = ['1', '2', '3'].indexOf(input.key);
    if (i < 0) return false;
    this.switchTo(['voicecraft', 'autoeditor', 'browser'][i]);
    return true;
  }

  wireNavigation(entry) {
    const { wc, name } = entry;
    wc.on('before-input-event', (e, input) => { if (this.moduleKey(input)) e.preventDefault(); });
    wc.on('will-navigate', (e, url) => {
      const target = moduleForUrl(url, this.base);
      if (target && target !== name) {
        e.preventDefault();
        this.switchTo(target, { url });
      }
    });
    wc.setWindowOpenHandler(({ url }) => {
      const target = moduleForUrl(url, this.base);
      if (target) {
        this.switchTo(target, { url, opened: true });
        return { action: 'deny' };
      }
      if (/^https?:/i.test(url)) {
        // Web links from a module open in the built-in browser.
        this.switchTo('browser');
        if (this.browser) this.browser.createTab(url);
        return { action: 'deny' };
      }
      shell.openExternal(url).catch(() => {});
      return { action: 'deny' };
    });
  }

  switchTo(name, { url, opened } = {}) {
    if (!MODULES[name]) return;
    const created = !this.views.has(name);
    const target = this.ensure(name);
    for (const [n, v] of this.views) if (n !== name) v.view.setVisible(false);
    target.view.setVisible(true);
    this.active = name;
    this.state.lastModule = name;
    this.saveState();
    if (this.browser) this.browser.setModuleVisible(name === 'browser');
    target.wc.focus();
    this.broadcast('studio:module-changed', { module: name });
    // VoiceCraft handing narration to an already-open AutoEditor: tell it to
    // pick up the transfer (a fresh one does that on load by itself).
    if (name === 'autoeditor' && !created && (opened || (url && url.includes('transfer')))) {
      target.wc.send('studio:check-transfer');
    }
  }

  broadcast(channel, payload) {
    if (!this.win.isDestroyed()) this.win.webContents.send(channel, payload);
    for (const v of this.views.values()) if (!v.wc.isDestroyed()) v.wc.send(channel, payload);
  }

  setFocusMode(on) {
    this.focusMode = !!on;
    this.layout();
    this.broadcast('studio:focus-mode', { on: this.focusMode });
  }

  // ---- project ----
  setProject(project) {
    const p = project && project.id ? { id: String(project.id), name: String(project.name || 'Untitled project') } : null;
    const same = (this.state.project && this.state.project.id) === (p && p.id) && (this.state.project && this.state.project.name) === (p && p.name);
    this.state.project = p;
    this.saveState();
    if (!same) {
      this.broadcast('studio:project-changed', p);
      if (this.browser) this.browser.broadcastToTabs({ action: 'studio-project', project: p });
    }
    return p;
  }

  // Called by the browser for every finished Flow download.
  addFlowAsset({ savePath, meta }) {
    const p = this.state.project;
    if (!p || !savePath) return null;
    try {
      const asset = this.assets.add(p.id, {
        srcPath: savePath,
        filename: path.basename(savePath),
        source: (meta && meta.source) || 'flow',
        type: meta && meta.type,
        metadata: {
          flowName: (meta && meta.name) || null,
          prompt: (meta && meta.prompt) || null,
          flowMediaId: (meta && meta.flowMediaId) || null,
          savedTo: savePath,
        },
      });
      this.broadcast('studio:asset-added', asset);
      return asset;
    } catch (e) {
      console.warn('[Studio] could not add Flow asset:', e.message);
      return null;
    }
  }

  // Move assets into the AutoEditor: switch there and hand them over.
  sendToEditor(projectId, assetIds) {
    const pid = projectId || (this.state.project && this.state.project.id);
    if (!pid) return;
    this.switchTo('autoeditor');
    this.toEditor('studio:import-assets', { projectId: pid, assetIds: assetIds || null });
  }

  // Send to the AutoEditor now, or as soon as it is ready.
  toEditor(channel, payload) {
    const ae = this.ensure('autoeditor');
    if (this.aeReady && !ae.wc.isDestroyed()) ae.wc.send(channel, payload);
    else this.aeQueue.push([channel, payload]);
  }

  // From the Automator: its results (by Flow media id), or all Flow results.
  sendFlowToEditor(flowMediaIds) {
    const p = this.state.project;
    if (!p) return;
    const want = flowMediaIds && flowMediaIds.length ? new Set(flowMediaIds) : null;
    const ids = this.assets.list(p.id)
      .filter((a) => String(a.source || '').startsWith('flow') && (!want || want.has(a.metadata && a.metadata.flowMediaId)))
      .map((a) => a.id);
    if (ids.length) this.sendToEditor(p.id, ids);
  }

  // ---- IPC ----
  setupIPC() {
    const fromUs = (e) => e.sender === this.win.webContents || [...this.views.values()].some((v) => v.wc === e.sender);
    const handle = (ch, fn) => ipcMain.handle(ch, (e, arg) => (fromUs(e) ? fn(arg, e) : null));
    const on = (ch, fn) => ipcMain.on(ch, (e, arg) => { if (fromUs(e)) fn(arg, e); });

    handle('studio:get-state', () => ({
      active: this.active, project: this.state.project, modules: MODULES, focusMode: !!this.focusMode,
      loaded: [...this.views.keys()],
    }));
    on('studio:switch', (name) => this.switchTo(name));
    handle('studio:set-project', (p) => this.setProject(p));
    handle('studio:assets', ({ projectId } = {}) => this.assets.list(projectId || (this.state.project && this.state.project.id)));
    handle('studio:asset-counts', (ids) => this.assets.counts(ids));
    handle('studio:add-asset', ({ projectId, bytes, filename, type, mime, source, duration, metadata } = {}) => {
      const pid = projectId || (this.state.project && this.state.project.id);
      if (!pid) throw new Error('Pick a project first.');
      const asset = this.assets.add(pid, { buffer: Buffer.from(bytes), filename, type, mime, source, duration, metadata });
      this.broadcast('studio:asset-added', asset);
      return asset;
    });
    handle('studio:remove-asset', ({ projectId, assetId }) => {
      const ok = this.assets.remove(projectId, assetId);
      if (ok) this.broadcast('studio:asset-removed', { projectId, assetId });
      return ok;
    });
    handle('studio:delete-project-assets', (ids) => {
      for (const id of ids || []) this.assets.deleteProject(id);
      if (this.state.project && (ids || []).includes(this.state.project.id)) this.setProject(null);
      this.broadcast('studio:projects-deleted', ids);
      return true;
    });
    on('studio:editor-ready', (_, e) => {
      const ae = this.views.get('autoeditor');
      if (!ae || ae.wc !== e.sender) return;
      this.aeReady = true;
      const q = this.aeQueue.splice(0);
      for (const [ch, payload] of q) e.sender.send(ch, payload);
    });
    on('studio:send-to-editor', ({ projectId, assetIds } = {}) => this.sendToEditor(projectId, assetIds));
    // Native project menu for the studio bar (draws over the module views).
    on('studio:project-menu', ({ x, y, projects } = {}) => {
      const cur = this.state.project && this.state.project.id;
      const items = (projects || []).slice(0, 20).map((p) => ({
        label: p.name || 'Untitled project', type: 'radio', checked: p.id === cur,
        click: () => this.setProject(p),
      }));
      if (items.length) items.push({ type: 'separator' });
      items.push({ label: 'New project…', click: () => { this.switchTo('autoeditor'); this.toEditor('studio:new-project'); } });
      items.push({ label: 'All projects', click: () => { this.switchTo('autoeditor'); this.toEditor('studio:show-projects'); } });
      if (cur) {
        items.push({ type: 'separator' });
        items.push({ label: 'Close project', click: () => this.setProject(null) });
      }
      Menu.buildFromTemplate(items).popup({ window: this.win, x: Math.round(x), y: Math.round(y) });
    });
    on('studio:focus-mode', (on) => this.setFocusMode(on));
  }
}
