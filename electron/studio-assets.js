// Studio project asset library — the media that belongs to a project,
// whichever module produced it (VoiceCraft narration, Flow images/videos,
// captions, imports). Files live on disk under userData/studio/projects/<id>/;
// an index (assets.json) holds the metadata. Pages read files through the
// vcasset:// scheme (see studio.js) and hear about new assets live.
import { app } from 'electron';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const EXT_TYPE = {
  '.png': 'image', '.jpg': 'image', '.jpeg': 'image', '.webp': 'image', '.gif': 'image',
  '.mp4': 'video', '.webm': 'video', '.mov': 'video',
  '.wav': 'audio', '.mp3': 'audio', '.m4a': 'audio', '.ogg': 'audio', '.flac': 'audio',
  '.srt': 'caption', '.vtt': 'caption', '.json': 'caption',
};

export function typeFromName(name, mime) {
  const t = EXT_TYPE[path.extname(String(name || '')).toLowerCase()];
  if (t) return t;
  if (/^image\//.test(mime || '')) return 'image';
  if (/^video\//.test(mime || '')) return 'video';
  if (/^audio\//.test(mime || '')) return 'audio';
  return 'other';
}

const safeName = (n) => String(n || 'asset').replace(/[<>:"/\\|?*\x00-\x1f]/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120) || 'asset';
const safeId = (id) => String(id || '').replace(/[^\w.-]/g, '_').replace(/^\.+/, '_').slice(0, 100) || '_';

export class AssetLibrary {
  constructor() {
    this.root = path.join(app.getPath('userData'), 'studio', 'projects');
    fs.mkdirSync(this.root, { recursive: true });
    this.cache = new Map(); // projectId -> assets[]
  }

  dir(projectId) { return path.join(this.root, safeId(projectId)); }
  indexFile(projectId) { return path.join(this.dir(projectId), 'assets.json'); }

  list(projectId) {
    if (!projectId) return [];
    if (this.cache.has(projectId)) return this.cache.get(projectId);
    let list = [];
    try { list = JSON.parse(fs.readFileSync(this.indexFile(projectId), 'utf8')); } catch { /* none yet */ }
    // Drop entries whose file has gone (cleaned up by hand, etc.).
    list = list.filter((a) => a && (a.file || a.absPath) && fs.existsSync(this.pathOf(projectId, a)));
    this.cache.set(projectId, list);
    return list;
  }

  writeIndex(projectId) {
    const file = this.indexFile(projectId);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmp = file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.list(projectId), null, 1));
    fs.renameSync(tmp, file);
  }

  // Where an asset's file is: in the project folder, or (renders) a file the
  // studio keeps somewhere the user can see it.
  pathOf(projectId, a) {
    return a.absPath ? a.absPath : path.join(this.dir(projectId), a.file);
  }

  // An asset already in the project from the same origin (e.g. Flow media
  // id), or with the same content *and* name — sending it again reuses it.
  // (Same picture under another name is a deliberate second use, e.g. one
  // image at 0-05 and 0-20, so content alone doesn't count.)
  findDuplicate(projectId, { hash, sourceKey, filename } = {}) {
    return this.list(projectId).find((a) => (sourceKey && a.metadata && a.metadata.sourceKey === sourceKey)
      || (hash && a.hash === hash && (!filename || a.filename === filename))) || null;
  }

  static hashOf(buffer) {
    return crypto.createHash('sha1').update(buffer).digest('hex');
  }

  // Store bytes (Buffer) or copy a file (srcPath) into the project.
  add(projectId, { buffer, srcPath, filename, type, mime, source, duration = null, metadata = {} }) {
    if (!projectId) throw new Error('No project selected');
    const id = 'as_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    const name = safeName(filename || (srcPath && path.basename(srcPath)) || 'asset');
    const kind = type || typeFromName(name, mime);
    const file = `${id}${path.extname(name) || ''}`;
    const dest = path.join(this.dir(projectId), file);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (buffer) fs.writeFileSync(dest, buffer);
    else fs.copyFileSync(srcPath, dest);
    const size = fs.statSync(dest).size;
    let hash = null;
    try { hash = AssetLibrary.hashOf(buffer || (size < 512 * 1024 * 1024 ? fs.readFileSync(dest) : Buffer.alloc(0))); } catch { /* unhashed */ }
    const asset = {
      id, projectId, type: kind, filename: name, source: source || 'import',
      createdAt: Date.now(), duration, size, mime: mime || null, metadata, file, hash,
    };
    // Re-generating "2-33" adds a second 2-33 asset rather than overwriting
    // the first; the AutoEditor uses the newest when they share a name.
    this.list(projectId).push(asset);
    this.writeIndex(projectId);
    return asset;
  }

  // Register a file that stays where it is (renders in the project folder).
  addExternal(projectId, { absPath, filename, type, mime, source, duration = null, metadata = {} }) {
    if (!projectId) throw new Error('No project selected');
    const id = 'as_' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');
    const asset = {
      id, projectId, type: type || typeFromName(absPath, mime), filename: filename || path.basename(absPath),
      source: source || 'import', createdAt: Date.now(), duration, size: fs.statSync(absPath).size,
      mime: mime || null, metadata, absPath, hash: null,
    };
    this.list(projectId).push(asset);
    this.writeIndex(projectId);
    return asset;
  }

  update(projectId, assetId, patch) {
    const a = this.list(projectId).find((x) => x.id === assetId);
    if (!a) return null;
    Object.assign(a, patch);
    this.writeIndex(projectId);
    return a;
  }

  remove(projectId, assetId) {
    const list = this.list(projectId);
    const i = list.findIndex((a) => a.id === assetId);
    if (i < 0) return false;
    const [a] = list.splice(i, 1);
    try { fs.unlinkSync(this.pathOf(projectId, a)); } catch { /* already gone */ }
    this.writeIndex(projectId);
    return true;
  }

  filePath(projectId, assetId) {
    const a = this.list(projectId).find((x) => x.id === assetId);
    return a ? this.pathOf(projectId, a) : null;
  }

  counts(projectIds) {
    const out = {};
    for (const id of projectIds || []) {
      const c = { audio: 0, image: 0, video: 0, caption: 0, other: 0 };
      for (const a of this.list(id)) c[a.type in c ? a.type : 'other']++;
      out[id] = c;
    }
    return out;
  }

  // Only this project's own folder — never anything shared.
  deleteProject(projectId) {
    const dir = this.dir(projectId);
    if (!dir.startsWith(this.root + path.sep)) return false;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ }
    this.cache.delete(projectId);
    return true;
  }
}
