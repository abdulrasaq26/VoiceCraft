// content/automation/automator-engine.js
//
// VoiceCraft Automator — queues prompts and runs them through Google Flow's
// own interface in the user's signed-in tab: type the prompt into Flow's
// prompt box, press Generate, wait for the new results to appear on the
// page, download them, move on. It does exactly what the user would do by
// hand, so Flow's own settings (model, aspect ratio, outputs) and Google's
// own checks all apply as normal.

(function () {
  if (window.VCAutomatorEngine) return;

  const STORE_KEY = 'vc_automator_v2';
  const DEFAULT_SETTINGS = {
    mode: 'image',          // default type for prompts without [IMAGE]/[VIDEO]
    expected: 1,            // results to wait for per prompt (match Flow's output count)
    delay: 4,               // seconds between prompts
    imageTimeout: 180,      // seconds to wait for image results
    videoTimeout: 600,      // seconds to wait for video results
    settle: 5,              // seconds with no new result before accepting fewer than expected
    retries: 1,             // extra attempts for a prompt that fails
    autoDownload: true,
    submit: 'button',       // button | enter | compat — see automator-adapter.js
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

  function deepQuery(selector, root = document, acc = []) {
    root.querySelectorAll(selector).forEach((el) => acc.push(el));
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node;
    while ((node = walker.nextNode())) {
      // Never look inside VoiceCraft's own panels.
      if (node.shadowRoot && !/^(flow-media-downloader-host|fmd-automator-host)$/.test(node.id)) {
        deepQuery(selector, node.shadowRoot, acc);
      }
    }
    return acc;
  }

  // Every media URL currently on the page (images, videos, CSS backgrounds).
  function pageMediaUrls() {
    const urls = new Set();
    deepQuery('img').forEach((el) => { const u = el.currentSrc || el.src; if (u) urls.add(u); });
    deepQuery('video, video source').forEach((el) => { const u = el.currentSrc || el.src; if (u) urls.add(u); });
    deepQuery('div, a, span, button').forEach((el) => {
      const bg = el.style && el.style.backgroundImage;
      const m = bg && /url\(['"]?([^'")]+)['"]?\)/i.exec(bg);
      if (m) urls.add(m[1]);
    });
    return urls;
  }

  // New result media of `type` that weren't on the page before submitting.
  function newResults(type, baseline) {
    const found = [];
    const els = deepQuery(type === 'video' ? 'video' : 'img');
    for (const el of els) {
      if (el.closest && el.closest('#flow-media-downloader-host, #fmd-automator-host')) continue;
      if (window.FlowAdapter && window.FlowAdapter.shouldIgnore(el)) continue;
      const url = el.currentSrc || el.src;
      if (!url || baseline.has(url) || url.startsWith('data:')) continue;
      if (type === 'image') {
        const w = el.naturalWidth || el.clientWidth, h = el.naturalHeight || el.clientHeight;
        if (!el.complete || w < 120 || h < 120) continue; // still loading, or an icon
      }
      const norm = window.MediaNormalizer ? window.MediaNormalizer.normalize(el) : null;
      found.push({ url, element: el, mimeType: (norm && norm.mimeType) || '' });
    }
    return found;
  }

  function promptText(el) {
    if (!el) return '';
    return (el.tagName === 'TEXTAREA' || el.tagName === 'INPUT' ? el.value : el.textContent) || '';
  }

  // ---- engine ------------------------------------------------------------
  class AutomatorEngine {
    constructor(adapter) {
      this.adapter = adapter;
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
      const set = (status) => { job.status = status; this.save(); this.emit(); };
      try {
        set('submitting');
        // 1. Flow's prompt box must be on screen (an open Flow project).
        let input = null;
        for (let i = 0; i < 20 && !input; i++) {
          input = this.adapter.findElement(this.adapter.selectors.promptInput);
          if (!input) { if (!(await this.wait(500))) throw new Error('stopped'); }
        }
        if (!input) throw new Error("Couldn't find Flow's prompt box — open a Flow project first.");

        // 2. Snapshot what's on the page, then type and submit the prompt.
        const baseline = pageMediaUrls();
        await this.adapter.enterPrompt(job.prompt);
        const typed = promptText(this.adapter.findElement(this.adapter.selectors.promptInput));
        if (!typed.includes(job.prompt.slice(0, Math.min(24, job.prompt.length)))) {
          throw new Error("Flow's prompt box didn't accept the text.");
        }
        await this.adapter.clickGenerate(this.settings.submit);
        set('generating');

        // 3. Wait for new results of this prompt's type.
        const limit = (job.type === 'video' ? this.settings.videoTimeout : this.settings.imageTimeout) * 1000;
        const started = Date.now();
        const results = new Map();
        let lastNew = 0;
        while (Date.now() - started < limit) {
          if (!(await this.wait(1500))) throw new Error('stopped');
          for (const r of newResults(job.type, baseline)) {
            if (!results.has(r.url)) { results.set(r.url, r); lastNew = Date.now(); }
          }
          job.results = results.size;
          this.emit();
          if (results.size >= this.settings.expected) break;
          if (results.size > 0 && Date.now() - lastNew > this.settings.settle * 1000) break;
        }
        if (!results.size) throw new Error(`No ${job.type} appeared within ${Math.round(limit / 1000)}s.`);

        // 4. Download them into <folder>/<project>/<batch>/<id>.<ext>.
        if (this.settings.autoDownload) {
          set('downloading');
          let i = 0, ok = 0;
          for (const r of results.values()) {
            i++;
            const status = await this.download(job, r, i, results.size);
            if (status === 'downloaded') ok++;
          }
          if (!ok) throw new Error('Results appeared but downloading them failed.');
        }
        job.finishedAt = Date.now();
        set('completed');
        this.note(`${job.id} done — ${results.size} ${job.type}${results.size === 1 ? '' : 's'}`);
      } catch (e) {
        if (e && e.message === 'stopped') return; // Stop already reset the job
        const msg = (e && e.message) || String(e);
        if (job.attempts <= this.settings.retries) {
          job.status = 'waiting';
          job.error = `Attempt ${job.attempts} failed: ${msg} — retrying`;
        } else {
          job.status = 'error';
          job.error = msg;
        }
        this.save();
        this.note(`${job.id}: ${msg}`);
      }
    }

    download(job, r, index, total) {
      const mediaId = 'vca_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      const stem = total > 1 ? `${job.id}_${index}` : job.id;
      const mediaItem = {
        id: mediaId, url: r.url, type: job.type, mimeType: r.mimeType, title: stem,
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
