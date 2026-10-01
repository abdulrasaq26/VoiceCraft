// Frameloom Studio shell: one window, three live modules.
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
import { BRAND } from './brand.js';

// "What Happened If…?" → a folder/file name Windows accepts.
const fsName = (s, max = 80) => String(s || 'Untitled project').replace(/[<>:"/\\|?*\x00-\x1f]/g, '').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, max) || 'Untitled project';

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
    // Focus mode belongs to the module that asked for it: leaving it brings
    // the studio bar back (modules hear it and leave their own focus mode).
    if (this.focusMode && this.active && this.active !== name) this.setFocusMode(false);
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
      // The file on disk may be "0-12 (1).png" because an older 0-12.png was
      // already there; the asset keeps Flow's name so it lands at 0:12.
      let filename = path.basename(savePath);
      const ext = path.extname(filename);
      const stem = path.basename(filename, ext);
      const flowName = meta && meta.name ? String(meta.name).replace(/^#/, '') : '';
      if (flowName && stem.replace(/ \(\d+\)$/, '') === flowName) filename = flowName + ext;
      const sourceKey = meta && meta.flowMediaId ? 'flow:' + meta.flowMediaId : null;
      let hash = null;
      try { hash = AssetLibrary.hashOf(fs.readFileSync(savePath)); } catch { /* unreadable */ }
      const dup = this.assets.findDuplicate(p.id, { hash, sourceKey, filename });
      if (dup) return dup;
      const asset = this.assets.add(p.id, {
        srcPath: savePath,
        filename,
        source: (meta && meta.source) || 'flow',
        type: meta && meta.type,
        metadata: {
          flowName: (meta && meta.name) || null,
          prompt: (meta && meta.prompt) || null,
          flowMediaId: (meta && meta.flowMediaId) || null,
          sourceKey,
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

  // ---- renders: finished AutoEditor videos, kept with the project ----------
  // Written to Videos/<studio>/Projects/<project>/renders/<project>-vN.mp4
  // (a folder people can find, open and upload from), registered as project
  // assets, and never deleted unless the user deletes one.
  rendersDir(project) {
    // Videos, not Documents: Documents is often synced to OneDrive, and renders are big.
    return path.join(app.getPath('videos'), BRAND.name, 'Projects', fsName(project.name), 'renders');
  }

  listRenders(projectId) {
    return this.assets.list(projectId).filter((a) => a.source === 'render');
  }

  renderBegin({ projectId, projectName, ext = '.mp4' } = {}) {
    const pid = projectId || (this.state.project && this.state.project.id);
    if (!pid) throw new Error('No project selected.');
    const project = { id: pid, name: projectName || (this.state.project && this.state.project.id === pid ? this.state.project.name : 'Untitled project') };
    const dir = this.rendersDir(project);
    fs.mkdirSync(dir, { recursive: true });
    const version = this.listRenders(pid).reduce((m, a) => Math.max(m, (a.metadata && a.metadata.version) || 0), 0) + 1;
    const base = fsName(project.name, 60).replace(/\s+/g, '-');
    let file = path.join(dir, `${base}-v${version}${ext}`);
    for (let i = 2; fs.existsSync(file); i++) file = path.join(dir, `${base}-v${version}-${i}${ext}`);
    const id = 'rn_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    const part = file + '.part';
    this.renderJobs = this.renderJobs || new Map();
    this.renderJobs.set(id, { pid, project, file, part, version, fd: fs.openSync(part, 'w'), bytes: 0 });
    return { id, file, version };
  }

  renderChunk({ id, bytes } = {}) {
    const job = this.renderJobs && this.renderJobs.get(id);
    if (!job) throw new Error('Unknown render.');
    const buf = Buffer.from(bytes);
    fs.writeSync(job.fd, buf);
    job.bytes += buf.length;
    return job.bytes;
  }

  renderFinish({ id, meta = {} } = {}) {
    const job = this.renderJobs && this.renderJobs.get(id);
    if (!job) throw new Error('Unknown render.');
    this.renderJobs.delete(id);
    fs.closeSync(job.fd);
    fs.renameSync(job.part, job.file);
    const asset = this.assets.addExternal(job.pid, {
      absPath: job.file, filename: path.basename(job.file), type: 'video', mime: 'video/mp4', source: 'render',
      duration: meta.duration || null,
      metadata: {
        version: job.version, status: meta.status || 'complete', width: meta.width || null, height: meta.height || null,
        fps: meta.fps || null, engine: meta.engine || null, audioIssue: meta.audioIssue || null,
      },
    });
    this.broadcast('studio:asset-added', asset);
    return asset;
  }

  renderAbort({ id } = {}) {
    const job = this.renderJobs && this.renderJobs.get(id);
    if (!job) return false;
    this.renderJobs.delete(id);
    try { fs.closeSync(job.fd); } catch { /* closed */ }
    try { fs.unlinkSync(job.part); } catch { /* gone */ }
    return true;
  }

  // What a website's file picker offers (see BrowserManager.pickFiles):
  // the current project's renders (newest first; the one picked with
  // "Upload…" on top) and its media.
  projectFiles() {
    const p = this.state.project;
    if (!p) return { project: null, renders: [], media: [], rendersDir: null };
    const all = this.assets.list(p.id);
    const file = (a) => ({
      id: a.id, path: this.assets.filePath(p.id, a.id), name: a.filename, type: a.type, size: a.size,
      createdAt: a.createdAt, duration: a.duration || null, version: (a.metadata && a.metadata.version) || null,
      pinned: !!(this.uploadPick && this.uploadPick.assetId === a.id),
    });
    const renders = all.filter((a) => a.source === 'render').map(file)
      .sort((a, b) => (b.pinned - a.pinned) || (b.createdAt - a.createdAt));
    const media = all.filter((a) => a.source !== 'render' && ['image', 'video', 'audio'].includes(a.type)).map(file);
    return { project: p.name, renders, media, rendersDir: this.rendersDir(p) };
  }

  // "Upload…" on a render: off to the browser, with that video offered first.
  useForUpload({ projectId, assetId } = {}) {
    this.uploadPick = { projectId, assetId, at: Date.now() };
    const a = this.assets.list(projectId).find((x) => x.id === assetId);
    this.switchTo('browser');
    if (this.browser && a) {
      setTimeout(() => this.browser.send('browser:toast', {
        text: `“${a.filename}” is ready to upload — use the website's file picker and it's listed first.`,
      }), 400);
    }
    return true;
  }

  // Open / reveal / rename / delete a project file (renders, mostly).
  async assetAction({ projectId, assetId, action, name } = {}) {
    const file = this.assets.filePath(projectId, assetId);
    if (!file) return { ok: false, error: 'That file is gone.' };
    if (action === 'open') { const err = await shell.openPath(file); return { ok: !err, error: err || null }; }
    if (action === 'reveal') { shell.showItemInFolder(file); return { ok: true }; }
    if (action === 'rename') {
      const a = this.assets.list(projectId).find((x) => x.id === assetId);
      const ext = path.extname(file);
      const clean = fsName(String(name || '').replace(new RegExp(ext.replace('.', '\\.') + '$', 'i'), ''), 120);
      if (!clean) return { ok: false, error: 'Enter a name.' };
      const next = path.join(path.dirname(file), clean + ext);
      if (next !== file) {
        if (fs.existsSync(next)) return { ok: false, error: 'A file with that name already exists.' };
        fs.renameSync(file, next);
      }
      const patch = a.absPath ? { absPath: next, filename: clean + ext } : { filename: clean + ext };
      const asset = this.assets.update(projectId, assetId, patch);
      this.broadcast('studio:asset-updated', asset);
      return { ok: true, asset };
    }
    if (action === 'delete') {
      const ok = this.assets.remove(projectId, assetId);
      if (ok) this.broadcast('studio:asset-removed', { projectId, assetId });
      return { ok };
    }
    return { ok: false, error: 'Unknown action.' };
  }

  // The Flow Downloader's "Send to AutoEditor": media from a Flow tab (bytes,
  // or URLs fetched with that tab's own session) become project assets —
  // reusing ones the project already has — and go to the AutoEditor in order.
  async importFlowMedia(items, fetchUrl) {
    const p = this.state.project;
    if (!p) return { ok: false, error: 'No project selected — pick or create one in the studio bar first.' };
    const EXT = { 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/gif': '.gif', 'video/mp4': '.mp4', 'video/webm': '.webm' };
    const ids = [];
    let added = 0, existing = 0;
    const failed = [];
    for (const it of (items || []).slice(0, 1000)) {
      const name = String(it.name || '').replace(/^#/, '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').trim().slice(0, 120) || 'flow';
      try {
        let buf = null, mime = it.mime || null;
        const url = String(it.url || '');
        if (it.bytes) buf = Buffer.from(it.bytes);
        else if (url.startsWith('data:')) {
          const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(url);
          if (!m) throw new Error('bad data URL');
          mime = mime || m[1] || null;
          buf = m[2] ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
        } else if (/^https?:/i.test(url)) {
          const r = await fetchUrl(url);
          mime = mime || r.mime;
          buf = r.buffer;
        } else throw new Error('no data');
        if (!buf.length) throw new Error('empty file');
        const type = it.type === 'video' || /^video\//.test(mime || '') ? 'video' : 'image';
        const ext = EXT[mime] || (type === 'video' ? '.mp4' : '.png');
        const sourceKey = it.flowMediaId ? 'flow:' + it.flowMediaId : (it.key ? 'flowkey:' + it.key : null);
        const dup = this.assets.findDuplicate(p.id, { hash: AssetLibrary.hashOf(buf), sourceKey, filename: name + ext });
        if (dup) { ids.push(dup.id); existing++; continue; }
        const asset = this.assets.add(p.id, {
          buffer: buf, filename: name + ext, type, mime, source: 'flow-downloader',
          metadata: { flowName: name, sourceKey, flowMediaId: it.flowMediaId || null },
        });
        this.broadcast('studio:asset-added', asset);
        ids.push(asset.id);
        added++;
      } catch (e) {
        failed.push({ name, error: e.message });
      }
    }
    if (ids.length) this.sendToEditor(p.id, ids);
    return { ok: ids.length > 0 || !failed.length, project: p.name, added, existing, failed };
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
      const buffer = Buffer.from(bytes);
      const dup = this.assets.findDuplicate(pid, { hash: AssetLibrary.hashOf(buffer), filename });
      if (dup) return dup;
      const asset = this.assets.add(pid, { buffer, filename, type, mime, source, duration, metadata });
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
    handle('studio:render-begin', (a) => this.renderBegin(a));
    handle('studio:render-chunk', (a) => this.renderChunk(a));
    handle('studio:render-finish', (a) => this.renderFinish(a));
    handle('studio:render-abort', (a) => this.renderAbort(a));
    handle('studio:asset-action', (a) => this.assetAction(a));
    handle('studio:use-for-upload', (a) => this.useForUpload(a));
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
