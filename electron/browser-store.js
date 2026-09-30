// Persistent state for the built-in browser: settings, bookmarks, history and
// the last session's tabs. One JSON file in userData, written debounced.
import { app } from 'electron';
import fs from 'fs';
import path from 'path';

const HISTORY_MAX = 3000;

export const DEFAULT_SETTINGS = {
  homepage: 'https://flow.google.com/',
  searchEngine: 'google',          // google | bing | duckduckgo | brave
  startup: 'restore',              // restore | home
  showBookmarksBar: true,
  defaultZoom: 1,
  downloadDir: '',                 // '' = the OS Downloads folder
  askWhereToSave: false,
  proxyMode: 'system',             // system | direct | fixed
  proxyRules: '',
  flowTools: 'auto',               // auto | always | never
  saveHistory: true,
  activeProfile: 'default',
  profiles: [{ id: 'default', name: 'Default' }],
};

export class BrowserStore {
  constructor() {
    this.file = path.join(app.getPath('userData'), 'browser-data.json');
    this.data = { settings: { ...DEFAULT_SETTINGS }, bookmarks: [], history: [], session: null };
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.data = {
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings || {}) },
        bookmarks: Array.isArray(raw.bookmarks) ? raw.bookmarks : [],
        history: Array.isArray(raw.history) ? raw.history : [],
        session: raw.session || null,
      };
    } catch { /* first run or unreadable: start fresh */ }
    if (!this.data.settings.profiles.some((p) => p.id === 'default')) {
      this.data.settings.profiles.unshift({ id: 'default', name: 'Default' });
    }
    this.timer = null;
  }

  save() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush() {
    clearTimeout(this.timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data));
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.warn('[Browser] could not save browser data:', e.message);
    }
  }

  get settings() { return this.data.settings; }

  setSettings(patch) {
    this.data.settings = { ...this.data.settings, ...patch };
    this.save();
    return this.data.settings;
  }

  // ---- Bookmarks ----
  addBookmark({ url, title, favicon }) {
    if (!url || this.data.bookmarks.some((b) => b.url === url)) return this.data.bookmarks;
    this.data.bookmarks.push({ id: 'bm-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), url, title: title || url, favicon: favicon || null, added: Date.now() });
    this.save();
    return this.data.bookmarks;
  }
  removeBookmark(idOrUrl) {
    this.data.bookmarks = this.data.bookmarks.filter((b) => b.id !== idOrUrl && b.url !== idOrUrl);
    this.save();
    return this.data.bookmarks;
  }
  renameBookmark(id, title) {
    const b = this.data.bookmarks.find((x) => x.id === id);
    if (b && title) { b.title = title; this.save(); }
    return this.data.bookmarks;
  }
  moveBookmark(id, toIndex) {
    const i = this.data.bookmarks.findIndex((b) => b.id === id);
    if (i === -1) return this.data.bookmarks;
    const [b] = this.data.bookmarks.splice(i, 1);
    this.data.bookmarks.splice(Math.max(0, Math.min(toIndex, this.data.bookmarks.length)), 0, b);
    this.save();
    return this.data.bookmarks;
  }

  // ---- History ----
  addHistory(url, title, favicon) {
    if (!this.data.settings.saveHistory) return;
    if (!/^https?:/i.test(url)) return;
    const h = this.data.history;
    // Collapse repeat visits to the same page in a row (SPA route churn).
    if (h.length && h[0].url === url) {
      h[0].time = Date.now();
      if (title) h[0].title = title;
    } else {
      h.unshift({ url, title: title || url, favicon: favicon || null, time: Date.now() });
      if (h.length > HISTORY_MAX) h.length = HISTORY_MAX;
    }
    this.save();
  }
  updateHistoryTitle(url, title, favicon) {
    const e = this.data.history.find((x) => x.url === url);
    if (e) {
      if (title) e.title = title;
      if (favicon) e.favicon = favicon;
      this.save();
    }
  }
  removeHistory(url, time) {
    this.data.history = this.data.history.filter((x) => !(x.url === url && x.time === time));
    this.save();
  }
  clearHistory() { this.data.history = []; this.save(); }

  // ---- Session ----
  setSession(session) { this.data.session = session; this.save(); }
}
