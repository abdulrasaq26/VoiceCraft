// content/automation/automator-engine.js
//
// VoiceCraft Automator — queues prompts and generates them in Google Flow
// for the project open in this tab, then downloads the results. Generation
// goes through content/automation/flow-api.js, which sends the same requests
// Flow's own Generate button sends, from the Flow page, with the signed-in
// session — so the account's credits and limits apply as normal.

(function () {
  if (window.VCAutomatorEngine) return;

  const STORE_KEY = 'vc_automator_v2';
  const DEFAULT_SETTINGS = {
    mode: 'image',            // default type for prompts without [IMAGE]/[VIDEO]
    expected: 1,              // outputs per prompt
    model: 'nano-banana-2',   // image model: nano-banana-2 | nano-banana-pro | nano-banana-lite
    aspect: '16:9',           // image: 16:9 | 4:3 | 1:1 | 3:4 | 9:16
    videoQuality: 'fast',     // video: lite | fast | quality
    videoRatio: '16:9',       // video: 16:9 | 9:16
    delay: 4,                 // seconds between prompts
    videoTimeout: 600,        // seconds to wait for a video
    retries: 1,               // extra attempts for a prompt that fails
    autoDownload: true,
    renameInFlow: true,       // name generated pictures in Flow so later prompts can @reference them
    refs: [],                 // default references: [{ mediaId, handle }] for prompts without @name
    project: 'Flow Automator',
    batch: 'Batch 01',
  };

  // ---- prompt parsing -------------------------------------------------
  // Blocks separated by blank lines are prompts (multi-line prompts allowed);
  // with no blank lines at all, each line is a prompt.
  //   #00-00 / #[scene one]  the prompt's name — files save as "00-00", and the
  //                          picture is named "00-00" in Flow (@00-00 later)
  //   [IMAGE] / [VIDEO]      type, at the start
  //   @hero / @[old hero]    use that picture from the Flow project as a reference
  const NAME_RE = /(^|\s)#\[([^\]]+)\]|(^|\s)#([\p{L}0-9_-]+)/u;

  function parsePrompts(text, defaultType, startNumber) {
    const src = String(text || '').replace(/\r/g, '').trim();
    if (!src) return [];
    const blocks = /\n\s*\n/.test(src) ? src.split(/\n\s*\n/) : src.split('\n');
    let n = startNumber || 1;
    const out = [];
    for (let raw of blocks) {
      raw = raw.trim();
      if (!raw) continue;
      let name = null, type = null;
      const nm = NAME_RE.exec(raw);
      if (nm) {
        name = (nm[2] || nm[4]).trim();
        raw = (raw.slice(0, nm.index) + ' ' + raw.slice(nm.index + nm[0].length)).trim();
      }
      const tm = raw.match(/^\[(IMAGE|VIDEO)\]\s*/i);
      if (tm) { type = tm[1].toLowerCase(); raw = raw.slice(tm[0].length); }
      const prompt = raw.replace(/\s*\n\s*/g, ' ').replace(/\s{2,}/g, ' ').trim();
      if (!prompt) continue;
      // Only prompts without their own name use up an automatic number.
      if (!name) { name = String(n).padStart(3, '0'); n++; }
      out.push({ name, id: '#' + name, type: type || defaultType || 'image', prompt });
    }
    return out;
  }

  // File-safe version of a prompt name.
  const fileStem = (name) => String(name || '').replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, '_').replace(/^[._]+|[._]+$/g, '').slice(0, 80) || 'image';
  // Handles match case-insensitively, with or without a file extension.
  const handleKeys = (h) => {
    const k = String(h || '').trim().toLowerCase();
    const bare = k.replace(/\.(png|jpe?g|webp|gif|bmp|heic|avif)$/i, '');
    return bare && bare !== k ? [k, bare] : [k];
  };

  // ---- page helpers ------------------------------------------------------
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ---- engine ------------------------------------------------------------
  class AutomatorEngine {
    constructor(api) {
      this.api = api;
      this.settings = { ...DEFAULT_SETTINGS };
      this.jobs = [];
      this.state = 'idle';     // idle | running | pausing | paused
      this.current = null;
      this.listeners = new Set();
      this.downloadWaiters = new Map(); // mediaId -> resolve(status)
      this.abort = null;
      this.log = [];
      this.handles = new Map();  // handle key -> [{ mediaId, handle, createTime, session }]
      this.libraryInfo = null;   // last library() result, for the picker
      this.libraryAt = 0;
      this.studioProject = null; // VoiceCraft Studio's current project (results go into it)
      this.inStudio = !!(document.documentElement && document.documentElement.hasAttribute('data-voicecraft-host'));
      this.loaded = this.load();
    }

    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit() { for (const fn of this.listeners) { try { fn(this); } catch (e) { console.warn('[VC Automator]', e); } } }
    note(msg) {
      this.log.unshift({ t: Date.now(), msg });
      if (this.log.length > 50) this.log.length = 50;
      this.emit();
    }

    async load() {
      try {
        const saved = await new Promise((r) => chrome.storage.local.get([STORE_KEY], (x) => r(x && x[STORE_KEY])));
        if (saved) {
          this.settings = { ...DEFAULT_SETTINGS, ...(saved.settings || {}) };
          this.jobs = (saved.jobs || []).map((j) => ({
            ...j,
            // Anything interrupted mid-run (reload, closed tab) goes back in line.
            status: ['submitting', 'generating', 'downloading'].includes(j.status) ? 'waiting' : j.status,
          }));
        }
      } catch (e) { /* storage unavailable: start empty */ }
      this.emit();
    }

    save() {
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => {
        try {
          const jobs = this.jobs.map(({ id, name, type, prompt, status, attempts, error, results, outputs, finishedAt }) =>
            ({ id, name, type, prompt, status, attempts, error, results, outputs, finishedAt }));
          chrome.storage.local.set({ [STORE_KEY]: { settings: this.settings, jobs } });
        } catch (e) { /* ignore */ }
      }, 300);
    }

    setSettings(patch) {
      this.settings = { ...this.settings, ...patch };
      this.save();
      this.emit();
    }

    nextNumber() {
      let max = 0;
      for (const j of this.jobs) { const m = /^(\d+)$/.exec(j.name || ''); if (m) max = Math.max(max, +m[1]); }
      return max + 1;
    }

    addPrompts(text) {
      const parsed = parsePrompts(text, this.settings.mode, this.nextNumber());
      const taken = new Set(this.jobs.map((j) => j.id));
      let added = 0;
      for (const p of parsed) {
        let id = p.id, name = p.name;
        for (let k = 2; taken.has(id); k++) { id = `${p.id}-${k}`; name = `${p.name}-${k}`; }
        taken.add(id);
        this.jobs.push({ id, name, type: p.type, prompt: p.prompt, status: 'waiting', attempts: 0, error: null, results: 0, outputs: [] });
        added++;
      }
      this.save();
      this.emit();
      return added;
    }

    remove(id) {
      if (this.current && this.current.id === id) return;
      this.jobs = this.jobs.filter((j) => j.id !== id);
      this.save(); this.emit();
    }
    retry(id) {
      const j = this.jobs.find((x) => x.id === id);
      if (j && j !== this.current) { j.status = 'waiting'; j.error = null; j.attempts = 0; j.outputs = []; this.save(); this.emit(); }
    }
    retryFailed() {
      for (const j of this.jobs) if (j.status === 'error') { j.status = 'waiting'; j.error = null; j.attempts = 0; j.outputs = []; }
      this.save(); this.emit();
    }
    clearDone() {
      this.jobs = this.jobs.filter((j) => j.status !== 'completed' || j === this.current);
      this.save(); this.emit();
    }
    clearAll() {
      if (this.state === 'running' || this.state === 'pausing') this.stop();
      this.jobs = [];
      this.save(); this.emit();
    }
    failedPromptsText() {
      return this.jobs.filter((j) => j.status === 'error').map((j) => `#${j.name || j.id.replace(/^#/, '')} [${j.type.toUpperCase()}] ${j.prompt}`).join('\n\n');
    }

    counts() {
      const c = { total: this.jobs.length, waiting: 0, done: 0, failed: 0, active: 0 };
      for (const j of this.jobs) {
        if (j.status === 'completed') c.done++;
        else if (j.status === 'error') c.failed++;
        else if (j.status === 'waiting') c.waiting++;
        else c.active++;
      }
      return c;
    }

    // ---- VoiceCraft Studio ----
    setStudioProject(p) { this.studioProject = p; this.emit(); }

    // Hand results to the AutoEditor (all Flow results of the project if no jobs given).
    sendToEditor(jobIds) {
      if (!this.inStudio) return false;
      let ids = null;
      if (jobIds) {
        ids = [];
        for (const j of this.jobs) if (jobIds.includes(j.id)) for (const o of j.outputs || []) if (o.name) ids.push(o.name);
        if (!ids.length) return false;
      }
      window.postMessage({ channel: 'voicecraft-flow:to-host', type: 'send-to-editor', flowMediaIds: ids }, '*');
      this.note(ids ? `Sent ${ids.length} result${ids.length === 1 ? '' : 's'} to the AutoEditor` : 'Sent all Flow results to the AutoEditor');
      return true;
    }

    // ---- the project's pictures ----
    remember(handle, mediaId, createTime, session) {
      for (const k of handleKeys(handle)) {
        const list = this.handles.get(k) || [];
        const hit = list.find((x) => x.mediaId === mediaId);
        if (hit) { if (session) hit.session = true; continue; }
        list.push({ handle, mediaId, createTime: createTime || new Date().toISOString(), session: !!session });
        this.handles.set(k, list);
      }
    }

    // Pictures made in this run win, then the newest.
    lookup(handle) {
      const list = this.handles.get(String(handle || '').trim().toLowerCase());
      if (!list || !list.length) return null;
      return [...list].sort((a, b) => (b.session - a.session) || String(b.createTime).localeCompare(String(a.createTime)))[0].mediaId;
    }

    async loadLibrary() {
      const lib = await this.api.library();
      if (this.libraryInfo && this.libraryInfo.projectId !== lib.projectId) this.handles.clear(); // another project
      // Keep this run's own names; refresh everything else.
      for (const [k, list] of this.handles) {
        const keep = list.filter((x) => x.session);
        if (keep.length) this.handles.set(k, keep); else this.handles.delete(k);
      }
      for (const n of lib.named) this.remember(n.handle, n.mediaId, n.createTime, false);
      this.libraryInfo = lib;
      this.libraryAt = Date.now();
      // Default references that have been deleted from the project drop out.
      const alive = new Set(lib.pictures.map((p) => p.mediaId));
      const refs = (this.settings.refs || []).filter((r) => alive.has(r.mediaId));
      if (refs.length !== (this.settings.refs || []).length) this.settings.refs = refs;
      this.save();
      this.emit();
      return lib;
    }

    toggleRef(mediaId, handle) {
      const refs = [...(this.settings.refs || [])];
      const i = refs.findIndex((r) => r.mediaId === mediaId);
      if (i >= 0) refs.splice(i, 1); else refs.push({ mediaId, handle: handle || null });
      this.setSettings({ refs });
    }

    // Upload pictures, name each after its file, and use them as references.
    async uploadRefs(files) {
      let ok = 0;
      for (const f of files) {
        try {
          const mediaId = await this.api.upload(f);
          this.remember(f.name, mediaId, null, true);
          const refs = [...(this.settings.refs || [])];
          if (!refs.some((r) => r.mediaId === mediaId)) refs.push({ mediaId, handle: f.name });
          this.settings.refs = refs;
          ok++;
          this.note(`Uploaded ${f.name} — use it as @${f.name.replace(/\.[^.]+$/, '')}`);
        } catch (e) {
          this.note(`Upload failed: ${f.name} — ${e.message}`);
        }
      }
      this.save();
      try { await this.loadLibrary(); } catch (_) { this.emit(); }
      return ok;
    }

    // ---- run control ----
    start() {
      if (this.state === 'running') return;
      if (this.state === 'pausing') { this.state = 'running'; this.emit(); return; }
      this.state = 'running';
      this.note('Started');
      this.loop();
    }
    pause() {
      if (this.state !== 'running') return;
      this.state = this.current ? 'pausing' : 'paused';
      this.note(this.current ? 'Pausing after this prompt…' : 'Paused');
    }
    stop() {
      if (this.state === 'idle') return;
      this.state = 'idle';
      if (this.abort) this.abort();
      if (this.current) this.api.abort();
      if (this.current && this.current.status !== 'completed') { this.current.status = 'waiting'; this.current.error = null; }
      this.current = null;
      this.save();
      this.note('Stopped');
    }

    async loop() {
      if (this._looping) return;
      this._looping = true;
      try {
        while (this.state === 'running') {
          const job = this.jobs.find((j) => j.status === 'waiting');
          if (!job) { this.state = 'idle'; this.note('Queue finished'); break; }
          this.current = job;
          await this.runJob(job);
          this.current = null;
          this.save();
          if (this.state === 'pausing') { this.state = 'paused'; this.note('Paused'); break; }
          if (this.state !== 'running') break;
          if (this.jobs.some((j) => j.status === 'waiting')) await this.wait(this.settings.delay * 1000);
        }
      } finally {
        this._looping = false;
        this.current = null;
        this.emit();
      }
    }

    // Interruptible sleep (Stop cancels it).
    wait(ms) {
      return new Promise((resolve) => {
        const t = setTimeout(() => { this.abort = null; resolve(true); }, ms);
        this.abort = () => { clearTimeout(t); this.abort = null; resolve(false); };
      });
    }

    async runJob(job) {
      job.attempts = (job.attempts || 0) + 1;
      job.error = null;
      job.results = 0;
      const st = this.settings;
      const set = (status, detail) => { job.status = status; job.detail = detail || ''; this.save(); this.emit(); };
      const stopped = () => this.state === 'idle';
      try {
        set('submitting', 'Connecting to Flow…');
        await this.api.connect();
        const want = Math.max(1, Math.min(4, +st.expected || 1));
        const results = [];
        job.outputs = [];

        // @references → prompt parts + image inputs.
        let parts = null, imageInputs = [];
        if (/(^|[\s(["'])@\S/.test(job.prompt)) {
          if (job.type === 'video') {
            throw Object.assign(new Error('@references work for images only — remove them from this video prompt.'), { final: true });
          }
          if (!this.libraryAt || Date.now() - this.libraryAt > 60000) await this.loadLibrary();
          let r = window.VCResolveReferences(job.prompt, (h) => this.lookup(h));
          if (r.missing.length) { await this.loadLibrary(); r = window.VCResolveReferences(job.prompt, (h) => this.lookup(h)); }
          if (r.missing.length) {
            throw Object.assign(new Error(`No picture named ${r.missing.map((m) => '@' + m).join(', ')} in this Flow project.`), { final: true });
          }
          parts = r.parts;
          imageInputs = window.VCToImageInputs(r.refs);
        }
        if (!imageInputs.length && job.type === 'image' && (st.refs || []).length) {
          imageInputs = window.VCToImageInputs(st.refs.map((x) => x.mediaId));
        }
        for (let n = 1; n <= want; n++) {
          if (stopped()) throw Object.assign(new Error('Stopped'), { stopped: true });
          set('generating', want > 1 ? `${n} of ${want}` : '');
          try {
            const r = job.type === 'video'
              ? await this.api.generateVideo(
                { prompt: job.prompt, quality: st.videoQuality, ratio: st.videoRatio },
                { timeoutSec: st.videoTimeout, shouldStop: stopped, onPoll: (s) => set('generating', `${want > 1 ? `${n} of ${want} · ` : ''}${s}s`) })
              : await this.api.generateImage({ prompt: job.prompt, parts, imageInputs, model: st.model, aspect: st.aspect });
            results.push(r);
            job.results = results.length;
            job.outputs.push({ name: r.name || null, url: r.url, thumb: r.thumb || r.url, type: job.type });
            this.save(); this.emit();
            // Name it in Flow so later prompts can use @name (newest wins).
            if (job.type === 'image' && st.renameInFlow && job.name && r.name) {
              if (r.workflowId) {
                this.api.rename(r.workflowId, job.name).catch((e) => this.note(`${job.id}: couldn't name it in Flow — ${e.message}`));
              }
              this.remember(job.name, r.name, null, true);
            }
          } catch (e) {
            // Keep what already succeeded; fail outright on stop/limits/blocks.
            if (e.stopped || e.fatal || !results.length) throw e;
            this.note(`${job.id}: output ${n} failed — ${e.message}`);
          }
          if (n < want && !stopped()) await this.wait(1500);
        }

        if (st.autoDownload) {
          set('downloading');
          let ok = 0;
          for (let i = 0; i < results.length; i++) {
            const status = await this.download(job, results[i], i + 1, results.length);
            if (status === 'downloaded') ok++;
          }
          if (!ok) throw new Error('Generated in Flow, but downloading failed — the results are in your Flow project.');
        }
        job.finishedAt = Date.now();
        set('completed');
        this.note(`${job.id} done — ${results.length} ${job.type}${results.length === 1 ? '' : 's'}`);
      } catch (e) {
        if (e && e.stopped) return; // Stop already put the job back in line
        const msg = (e && e.message) || String(e);
        // Retrying won't help a limit, a block, or a prompt Flow refuses.
        if (!e.fatal && !e.final && job.attempts <= st.retries) {
          job.status = 'waiting';
          job.error = `Attempt ${job.attempts} failed: ${msg} — retrying`;
        } else {
          job.status = 'error';
          job.error = msg;
        }
        this.save();
        this.note(`${job.id}: ${msg}`);
        // Daily limits and blocks affect every prompt: stop rather than burn the queue.
        if (e.fatal && this.state === 'running') { this.state = 'paused'; this.note('Paused — fix the problem above, then Resume.'); }
      }
    }

    download(job, r, index, total) {
      const mediaId = 'vca_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const base = fileStem(job.name || job.id.replace(/^#/, ''));
      const stem = total > 1 ? `${base}_v${index}` : base;
      const mediaItem = {
        id: mediaId, url: r.url, type: job.type, mimeType: job.type === 'video' ? 'video/mp4' : 'image/png', title: stem,
        isAutomated: true, project: this.settings.project, batch: this.settings.batch, jobId: stem,
        prompt: job.prompt, flowMediaId: r.name || '',
      };
      return new Promise((resolve) => {
        const timer = setTimeout(() => { this.downloadWaiters.delete(mediaId); resolve('timeout'); }, 180000);
        this.downloadWaiters.set(mediaId, (status) => { clearTimeout(timer); resolve(status); });
        try {
          chrome.runtime.sendMessage({ action: 'download', mediaItem });
        } catch (e) {
          clearTimeout(timer); this.downloadWaiters.delete(mediaId); resolve('error');
        }
      });
    }

    // Called with every downloadProgress message (from the app or the
    // extension's service worker).
    onDownloadProgress(message) {
      const done = message.status === 'downloaded' || message.status === 'error';
      if (!done) return;
      const fn = this.downloadWaiters.get(message.mediaId);
      if (fn) { this.downloadWaiters.delete(message.mediaId); fn(message.status); }
    }
  }

  window.VCAutomatorEngine = AutomatorEngine;
  window.VCParsePrompts = parsePrompts;
})();
