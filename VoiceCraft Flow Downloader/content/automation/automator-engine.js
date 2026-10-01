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
    project: 'Flow Automator',
    batch: 'Batch 01',
  };

  // ---- prompt parsing -------------------------------------------------
  // Blocks separated by blank lines are prompts (multi-line prompts allowed);
  // with no blank lines at all, each line is a prompt. A block may start with
  // an id ("#12" / "#scene-3") and/or a type tag ("[IMAGE]" / "[VIDEO]").
  function parsePrompts(text, defaultType, startNumber) {
    const src = String(text || '').replace(/\r/g, '').trim();
    if (!src) return [];
    const blocks = /\n\s*\n/.test(src) ? src.split(/\n\s*\n/) : src.split('\n');
    let n = startNumber || 1;
    const out = [];
    for (let raw of blocks) {
      raw = raw.trim();
      if (!raw) continue;
      let id = null, type = null;
      let m = raw.match(/^(#[\w-]+)\s*/);
      if (m) { id = m[1]; raw = raw.slice(m[0].length); }
      m = raw.match(/^\[(IMAGE|VIDEO)\]\s*/i);
      if (m) { type = m[1].toLowerCase(); raw = raw.slice(m[0].length); }
      const prompt = raw.replace(/\s*\n\s*/g, ' ').trim();
      if (!prompt) continue;
      // Only prompts without their own id use up an automatic number.
      if (!id) { id = '#' + String(n).padStart(3, '0'); n++; }
      out.push({ id, type: type || defaultType || 'image', prompt });
    }
    return out;
  }

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
          const jobs = this.jobs.map(({ id, type, prompt, status, attempts, error, results, finishedAt }) =>
            ({ id, type, prompt, status, attempts, error, results, finishedAt }));
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
      for (const j of this.jobs) { const m = /^#(\d+)$/.exec(j.id); if (m) max = Math.max(max, +m[1]); }
      return max + 1;
    }

    addPrompts(text) {
      const parsed = parsePrompts(text, this.settings.mode, this.nextNumber());
      const taken = new Set(this.jobs.map((j) => j.id));
      let added = 0;
      for (const p of parsed) {
        let id = p.id;
        for (let k = 2; taken.has(id); k++) id = `${p.id}-${k}`;
        taken.add(id);
        this.jobs.push({ id, type: p.type, prompt: p.prompt, status: 'waiting', attempts: 0, error: null, results: 0 });
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
      if (j && j !== this.current) { j.status = 'waiting'; j.error = null; j.attempts = 0; this.save(); this.emit(); }
    }
    retryFailed() {
      for (const j of this.jobs) if (j.status === 'error') { j.status = 'waiting'; j.error = null; j.attempts = 0; }
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
      return this.jobs.filter((j) => j.status === 'error').map((j) => `${j.id} [${j.type.toUpperCase()}] ${j.prompt}`).join('\n\n');
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
        for (let n = 1; n <= want; n++) {
          if (stopped()) throw Object.assign(new Error('Stopped'), { stopped: true });
          set('generating', want > 1 ? `${n} of ${want}` : '');
          try {
            const r = job.type === 'video'
              ? await this.api.generateVideo(
                { prompt: job.prompt, quality: st.videoQuality, ratio: st.videoRatio },
                { timeoutSec: st.videoTimeout, shouldStop: stopped, onPoll: (s) => set('generating', `${want > 1 ? `${n} of ${want} · ` : ''}${s}s`) })
              : await this.api.generateImage({ prompt: job.prompt, model: st.model, aspect: st.aspect });
            results.push(r);
            job.results = results.length;
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
      const stem = total > 1 ? `${job.id}_${index}` : job.id;
      const mediaItem = {
        id: mediaId, url: r.url, type: job.type, mimeType: job.type === 'video' ? 'video/mp4' : 'image/png', title: stem,
        isAutomated: true, project: this.settings.project, batch: this.settings.batch, jobId: stem,
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
