(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const card = $('storyboard-card');
  const fileInput = $('sb-files');
  const fileList = $('sb-filelist');
  const analyzeBtn = $('sb-analyze');
  const analyzeSpinner = analyzeBtn.querySelector('.spinner');
  const analyzeLabel = analyzeBtn.querySelector('.btn-label');
  const clearBtn = $('sb-clear');
  const statusEl = $('sb-status');
  const progressWrap = $('sb-progress');
  const progressFill = $('sb-progress-fill');
  const statsEl = $('sb-stats');
  const etaEl = $('sb-eta');
  const pauseBtn = $('sb-pause');
  const resumeBtn = $('sb-resume');
  const cancelBtn = $('sb-cancel');
  const bibleEl = $('sb-bible');
  const exportsEl = $('sb-exports');
  const scenesEl = $('sb-scenes');
  const titleInput = $('title-input');

  const KINDS = ['subtitles', 'script', 'style', 'characters', 'instructions'];
  const KIND_LABELS = {
    subtitles: 'Subtitles',
    script: 'Script',
    style: 'Visual style',
    characters: 'Characters',
    instructions: 'Instructions'
  };
  const LS_KEY = 'blvck-tts:storyboard';
  const SCENE_BATCH = 10;
  const ASPECT = '16:9';

  // --- IndexedDB (storyboard images) -------------------------------------

  const DB_NAME = 'blvck-storyboard';
  const STORE = 'images';
  const memBlobs = new Map(); // index -> Blob
  const urls = new Map(); // index -> object URL

  function idbOpen() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('no idb'));
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbPut(key, blob) {
    try {
      const db = await idbOpen();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(blob, key);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    } catch {
      /* best effort */
    }
  }
  async function idbGet(key) {
    try {
      const db = await idbOpen();
      const v = await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readonly');
        const rq = tx.objectStore(STORE).get(key);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => rej(rq.error);
      });
      db.close();
      return v;
    } catch {
      return null;
    }
  }
  async function idbClear() {
    try {
      const db = await idbOpen();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    } catch {
      /* ignore */
    }
  }

  // --- State -------------------------------------------------------------

  let files = []; // { name, kind, content, cues? }
  let cues = []; // { index, timestamp, text }
  let bible = null;
  let scenes = []; // { index, timestamp, subtitle, sceneType, camera, visualFocus, sceneSummary, prompt, status, error }
  let running = false;
  let paused = false;
  let cancelRequested = false;
  const durations = [];

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function showStatus(msg, type = 'error') {
    statusEl.textContent = msg;
    statusEl.className = `status ${type}`;
    statusEl.hidden = false;
  }
  function clearStatus() {
    statusEl.hidden = true;
  }

  function project() {
    const raw = (titleInput && titleInput.value ? titleInput.value : 'Storyboard').trim();
    return (
      raw
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60) || 'Storyboard'
    );
  }

  // --- File parsing ------------------------------------------------------

  function guessKind(name, content) {
    const n = name.toLowerCase();
    if (n.endsWith('.srt') || n.endsWith('.vtt') || /-->/.test(content)) return 'subtitles';
    if (/style|visual/.test(n)) return 'style';
    if (/char/.test(n)) return 'characters';
    if (/instruct|rule/.test(n)) return 'instructions';
    if (/script|story|full/.test(n)) return 'script';
    return 'script';
  }

  function tcToLabel(tc) {
    return tc.replace(/[.,]\d+$/, ''); // HH:MM:SS
  }

  // Parse SRT/VTT/timestamped text into cues. Returns [] if no timecodes.
  function parseSubtitles(content) {
    const text = content.replace(/^﻿/, '').replace(/\r/g, '');
    const re = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})([^\n]*)\n([\s\S]*?)(?=\n\s*\n|\n\d+\s*\n\d|\n*$)/g;
    const out = [];
    let m;
    let i = 1;
    while ((m = re.exec(text))) {
      const body = m[4]
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^\d+$/.test(l) && !/-->/.test(l))
        .join(' ')
        .trim();
      if (!body) continue;
      out.push({ index: i++, timestamp: `${tcToLabel(m[1])} - ${tcToLabel(m[2])}`, text: body });
    }
    return out;
  }

  // Fallback: split a raw script into scene-sized beats (one sentence each).
  function cuesFromScript(script) {
    const sentences = script
      .replace(/\s+/g, ' ')
      .match(/[^.!?…]+[.!?…]+|\S[^.!?…]*$/g);
    const list = (sentences || []).map((s) => s.trim()).filter(Boolean);
    // Merge very short fragments into the previous beat.
    const merged = [];
    for (const s of list) {
      if (merged.length && (s.length < 25 || merged[merged.length - 1].length < 25)) {
        merged[merged.length - 1] += ' ' + s;
      } else {
        merged.push(s);
      }
    }
    return merged.map((text, i) => ({ index: i + 1, timestamp: '', text }));
  }

  function readFiles(fileObjs) {
    return Promise.all(
      [...fileObjs].map(
        (f) =>
          new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => {
              const content = String(reader.result || '');
              resolve({ name: f.name, kind: guessKind(f.name, content), content });
            };
            reader.onerror = () => resolve({ name: f.name, kind: 'script', content: '' });
            reader.readAsText(f);
          })
      )
    );
  }

  function renderFileList() {
    fileList.innerHTML = '';
    files.forEach((f, idx) => {
      const row = document.createElement('div');
      row.className = 'sb-file';
      const name = document.createElement('span');
      name.className = 'sb-file-name';
      name.textContent = f.name;
      const sel = document.createElement('select');
      KINDS.forEach((k) => {
        const opt = document.createElement('option');
        opt.value = k;
        opt.textContent = KIND_LABELS[k];
        if (k === f.kind) opt.selected = true;
        sel.appendChild(opt);
      });
      sel.addEventListener('change', () => {
        f.kind = sel.value;
      });
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = 'Remove';
      rm.addEventListener('click', () => {
        files.splice(idx, 1);
        renderFileList();
      });
      row.append(name, sel, rm);
      fileList.appendChild(row);
    });
  }

  function buildContext() {
    const ctx = {};
    let subs = files.find((f) => f.kind === 'subtitles');
    if (subs) {
      cues = parseSubtitles(subs.content);
      if (!cues.length) cues = cuesFromScript(subs.content); // txt without timecodes
      ctx.subtitles = cues.map((c) => `#${c.index} [${c.timestamp}] ${c.text}`).join('\n');
    }
    const script = files.find((f) => f.kind === 'script');
    if (script) {
      ctx.script = script.content;
      if (!cues.length) cues = cuesFromScript(script.content);
    }
    const style = files.find((f) => f.kind === 'style');
    if (style) ctx.style = style.content;
    const chars = files.find((f) => f.kind === 'characters');
    if (chars) ctx.characters = chars.content;
    const instr = files.find((f) => f.kind === 'instructions');
    if (instr) ctx.instructions = instr.content;
    return ctx;
  }

  // --- Analyze + generate ------------------------------------------------

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.hint ? `${data.error} — ${data.hint}` : data.error || `Request failed (${res.status})`);
    return data;
  }

  function setAnalyzing(on, label) {
    analyzeBtn.disabled = on;
    analyzeSpinner.hidden = !on;
    analyzeLabel.textContent = on ? label || 'Working…' : 'Analyze & generate';
  }

  async function analyzeAndGenerate() {
    if (running) return;
    const ctx = buildContext();
    if (!cues.length) {
      showStatus('Upload a subtitle file (or a script) first.');
      return;
    }
    clearStatus();
    setAnalyzing(true, 'Reading the story…');
    try {
      // 1. Story bible
      const bibleRes = await postJson('/api/storyboard/bible', { context: ctx });
      bible = bibleRes.bible;
      renderBible();

      // 2. Scene prompts in batches (with prior summaries for continuity)
      setAnalyzing(true, 'Writing scene prompts…');
      scenes = [];
      for (let i = 0; i < cues.length; i += SCENE_BATCH) {
        const batch = cues.slice(i, i + SCENE_BATCH);
        const prior = scenes.slice(-3).map((s) => `${s.camera}: ${s.sceneSummary}`);
        const res = await postJson('/api/storyboard/scenes', {
          bible,
          cues: batch,
          style: ctx.style,
          instructions: ctx.instructions,
          priorSummaries: prior
        });
        (res.scenes || []).forEach((s) => scenes.push({ ...s, status: 'pending', error: null }));
        renderScenes();
      }
      saveProject();
    } catch (err) {
      showStatus(err.message);
      setAnalyzing(false);
      return;
    }
    setAnalyzing(false);
    exportsEl.hidden = false;
    // 3. Generate images
    runImageQueue();
  }

  async function generateSceneImage(scene) {
    const res = await fetch('/api/image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: scene.prompt, aspect: ASPECT })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || `Request failed (${res.status})`);
      err.status = res.status;
      err.quota = res.status === 429 || /quota|exceeded|rate limit|billing/i.test(body.error || '');
      throw err;
    }
    return res.blob();
  }

  const THROTTLE_MS = 600; // gentle pacing to ease per-minute rate limits

  async function runImageQueue() {
    if (running) return;
    running = true;
    paused = false;
    cancelRequested = false;
    progressWrap.hidden = false;
    updateControls();

    let quotaHit = false;
    for (const scene of scenes) {
      if (cancelRequested) break;
      if (scene.status === 'done') continue;
      while (paused && !cancelRequested) await sleep(200);
      if (cancelRequested) break;

      scene.status = 'generating';
      renderScenes();
      const t0 = performance.now();
      try {
        const blob = await generateSceneImage(scene);
        storeImage(scene.index, blob);
        scene.status = 'done';
        durations.push(performance.now() - t0);
      } catch (err) {
        if (err.quota) {
          // Don't burn through the rest of the batch — stop and let the user
          // resume once the quota resets or billing is enabled. Keep the
          // scene queued (not failed) so "Continue" picks up where it left off.
          scene.status = 'pending';
          quotaHit = true;
          saveProject();
          renderScenes();
          break;
        }
        scene.status = 'error';
        scene.error = err.message;
      }
      saveProject();
      renderScenes();
      updateProgress();
      if (!cancelRequested) await sleep(THROTTLE_MS);
    }

    running = false;
    updateControls();
    updateProgress();
    const done = scenes.filter((s) => s.status === 'done').length;
    const remaining = scenes.filter((s) => s.status !== 'done').length;
    if (quotaHit) {
      showStatus(
        `Image quota reached — Google returned "quota exceeded". ${done} of ${scenes.length} scenes generated. ` +
          'Enable billing on your Gemini API key, or wait for the free-tier quota to reset, then click “Continue”.'
      );
    } else if (cancelRequested) {
      showStatus('Cancelled. Completed scenes are saved.', 'info');
    } else if (remaining) {
      showStatus(`${remaining} scene(s) failed. Regenerate them individually.`);
    } else {
      showStatus(`Storyboard complete — ${scenes.length} scenes generated.`, 'info');
    }
  }

  function storeImage(index, blob) {
    memBlobs.set(index, blob);
    if (urls.has(index)) URL.revokeObjectURL(urls.get(index));
    urls.set(index, URL.createObjectURL(blob));
    idbPut(String(index), blob);
  }

  async function regenerateScene(scene) {
    if (running) {
      showStatus('Wait for the current run to finish, or pause it, before regenerating.');
      return;
    }
    scene.status = 'generating';
    renderScenes();
    try {
      const blob = await generateSceneImage(scene);
      storeImage(scene.index, blob);
      scene.status = 'done';
      scene.error = null;
    } catch (err) {
      scene.status = 'error';
      scene.error = err.message;
    }
    saveProject();
    renderScenes();
  }

  // --- Progress / controls ----------------------------------------------

  function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    const m = Math.floor(s / 60);
    return m ? `${m}m ${s % 60}s` : `${s}s`;
  }

  function updateProgress() {
    const total = scenes.length;
    const done = scenes.filter((s) => s.status === 'done').length;
    const pct = total ? Math.round((done / total) * 100) : 0;
    progressFill.style.width = `${pct}%`;
    const gen = scenes.find((s) => s.status === 'generating');
    statsEl.textContent = gen
      ? `Generating scene ${gen.index} of ${total} · ${pct}%`
      : `${done} of ${total} images · ${pct}%`;
    const remaining = scenes.filter((s) => s.status === 'pending' || s.status === 'generating').length;
    if (running && remaining && durations.length) {
      const avg = durations.reduce((a, b) => a + b, 0) / durations.length;
      etaEl.textContent = `~${fmtDuration(avg * remaining)} remaining`;
    } else {
      etaEl.textContent = '';
    }
  }

  function updateControls() {
    const hasPending = scenes.some((s) => s.status === 'pending' || s.status === 'error');
    pauseBtn.hidden = !(running && !paused);
    resumeBtn.hidden = !((running && paused) || (!running && hasPending && scenes.length));
    resumeBtn.textContent = running ? 'Resume' : 'Continue';
    cancelBtn.hidden = !running;
  }

  // --- Rendering ---------------------------------------------------------

  function renderBible() {
    if (!bible) {
      bibleEl.hidden = true;
      return;
    }
    bibleEl.hidden = false;
    const chars = bible.characters.map((c) => `<div class="sb-bible-item"><strong>${esc(c.name)}:</strong> ${esc(c.description)}</div>`).join('');
    const locs = bible.locations.map((l) => `<div class="sb-bible-item"><strong>${esc(l.name)}:</strong> ${esc(l.description)}</div>`).join('');
    bibleEl.innerHTML =
      `<h3>Story bible — ${esc(bible.title)}</h3>` +
      `<div class="sb-bible-item"><strong>Period:</strong> ${esc(bible.period)} · <strong>Tone:</strong> ${esc(bible.tone)}</div>` +
      (chars ? `<h3 style="margin-top:.6rem">Characters</h3>${chars}` : '') +
      (locs ? `<h3 style="margin-top:.6rem">Locations</h3>${locs}` : '');
  }

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }

  function renderScenes() {
    scenesEl.innerHTML = '';
    scenes.forEach((scene) => {
      const row = document.createElement('div');
      row.className = 'sb-scene' + (scene.status === 'generating' ? ' is-generating' : '') + (scene.status === 'error' ? ' is-error' : '');

      const url = urls.get(scene.index);
      let thumb;
      if (url && scene.status === 'done') {
        thumb = document.createElement('img');
        thumb.className = 'sb-thumb';
        thumb.src = url;
        thumb.alt = `Scene ${scene.index}`;
      } else {
        thumb = document.createElement('div');
        thumb.className = 'sb-thumb-placeholder';
        thumb.textContent =
          scene.status === 'generating' ? 'Generating…' : scene.status === 'error' ? 'Failed' : 'Queued';
      }

      const body = document.createElement('div');
      body.className = 'sb-scene-body';

      const head = document.createElement('div');
      head.className = 'sb-scene-head';
      const tag = document.createElement('span');
      tag.className = 'sb-scene-tag';
      tag.textContent = `Scene ${scene.index}`;
      head.appendChild(tag);
      const meta = document.createElement('span');
      meta.textContent = `${scene.timestamp ? scene.timestamp + ' · ' : ''}${scene.camera} · ${scene.sceneType}`;
      head.appendChild(meta);

      const subtitle = document.createElement('div');
      subtitle.className = 'sb-scene-subtitle';
      subtitle.textContent = scene.subtitle || scene.sceneSummary;

      const prompt = document.createElement('div');
      prompt.className = 'sb-scene-prompt';
      prompt.textContent = scene.prompt;
      prompt.title = 'Click to expand';
      prompt.addEventListener('click', () => prompt.classList.toggle('expanded'));

      const actions = document.createElement('div');
      actions.className = 'sb-scene-actions';
      const regen = document.createElement('button');
      regen.type = 'button';
      regen.textContent = scene.status === 'error' ? 'Retry' : 'Regenerate';
      regen.addEventListener('click', () => regenerateScene(scene));
      actions.appendChild(regen);
      if (scene.status === 'done' && url) {
        const dl = document.createElement('a');
        dl.href = url;
        dl.download = `${project()} Scene ${String(scene.index).padStart(2, '0')}.png`;
        dl.textContent = 'Download';
        actions.appendChild(dl);
      }
      if (scene.status === 'error' && scene.error) {
        const err = document.createElement('span');
        err.style.color = 'var(--danger)';
        err.style.fontSize = '0.72rem';
        err.textContent = scene.error.slice(0, 80);
        actions.appendChild(err);
      }

      body.append(head, subtitle, prompt, actions);
      row.append(thumb, body);
      scenesEl.appendChild(row);
    });
    updateProgress();
    updateControls();
  }

  // --- Persistence -------------------------------------------------------

  function saveProject() {
    try {
      localStorage.setItem(
        LS_KEY,
        JSON.stringify({ project: project(), cues, bible, scenes: scenes.map(({ ...s }) => s) })
      );
    } catch {
      /* quota — non-fatal */
    }
    // Let the video editor know new scenes/images are available.
    window.dispatchEvent(new CustomEvent('blvck-storyboard-updated'));
  }

  async function restoreProject() {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
    } catch {
      saved = null;
    }
    if (!saved || !saved.scenes || !saved.scenes.length) return;
    cues = saved.cues || [];
    bible = saved.bible || null;
    scenes = saved.scenes.map((s) => (s.status === 'generating' ? { ...s, status: 'pending' } : s));
    for (const s of scenes) {
      if (s.status === 'done') {
        const blob = await idbGet(String(s.index));
        if (blob) {
          memBlobs.set(s.index, blob);
          urls.set(s.index, URL.createObjectURL(blob));
        } else {
          s.status = 'pending';
        }
      }
    }
    renderBible();
    renderScenes();
    exportsEl.hidden = false;
    const pending = scenes.filter((s) => s.status !== 'done').length;
    if (pending) showStatus(`Restored a storyboard with ${pending} scene(s) left. Click “Continue”.`, 'info');
  }

  async function clearProject() {
    if (running) return;
    files = [];
    cues = [];
    bible = null;
    scenes = [];
    durations.length = 0;
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls.clear();
    memBlobs.clear();
    await idbClear();
    localStorage.removeItem(LS_KEY);
    fileInput.value = '';
    renderFileList();
    renderBible();
    scenesEl.innerHTML = '';
    exportsEl.hidden = true;
    progressWrap.hidden = true;
    clearStatus();
  }

  // --- Exports -----------------------------------------------------------

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }

  function promptsText() {
    return (
      scenes
        .map(
          (s) =>
            `Scene ${s.index}${s.timestamp ? ` (${s.timestamp})` : ''}\n` +
            `Camera: ${s.camera} · ${s.sceneType}\n` +
            `Subtitle: ${s.subtitle}\n` +
            `Prompt: ${s.prompt}\n`
        )
        .join('\n') + '\n'
    );
  }

  function sceneJson() {
    return JSON.stringify({ project: project(), bible, scenes }, null, 2);
  }

  async function blobToJpeg(blob) {
    const img = await createImageBitmap(blob);
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    canvas.getContext('2d').drawImage(img, 0, 0);
    const jpegBlob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.85));
    return { data: new Uint8Array(await jpegBlob.arrayBuffer()), w: img.width, h: img.height };
  }

  async function downloadZip() {
    const enc = new TextEncoder();
    const doneScenes = scenes.filter((s) => s.status === 'done' && memBlobs.has(s.index));
    if (!doneScenes.length) {
      showStatus('No generated images to export yet.');
      return;
    }
    const filesOut = [];
    for (const s of doneScenes) {
      const blob = memBlobs.get(s.index);
      filesOut.push({
        name: `${project()} Scene ${String(s.index).padStart(2, '0')}.png`,
        data: new Uint8Array(await blob.arrayBuffer())
      });
    }
    filesOut.push({ name: 'prompts.txt', data: enc.encode(promptsText()) });
    filesOut.push({ name: 'scenes.json', data: enc.encode(sceneJson()) });
    download(`${project()} storyboard.zip`, window.BlvckZip.create(filesOut));
  }

  async function downloadPdf() {
    const doneScenes = scenes.filter((s) => s.status === 'done' && memBlobs.has(s.index));
    if (!doneScenes.length) {
      showStatus('No generated images to export yet.');
      return;
    }
    showStatus('Building storyboard PDF…', 'info');
    const pages = [];
    for (const s of doneScenes) {
      const { data, w, h } = await blobToJpeg(memBlobs.get(s.index));
      pages.push({
        jpeg: data,
        w,
        h,
        lines: [
          `Scene ${s.index}${s.timestamp ? `  —  ${s.timestamp}` : ''}`,
          `${s.camera}  ·  ${s.sceneType}`,
          `Subtitle: ${s.subtitle}`,
          ...wrap(`Prompt: ${s.prompt}`, 95)
        ]
      });
    }
    download(`${project()} storyboard.pdf`, window.BlvckPDF.create(pages));
    clearStatus();
  }

  function wrap(text, max) {
    const words = text.split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w;
      if (cand.length <= max) cur = cand;
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 10);
  }

  // --- Events ------------------------------------------------------------

  fileInput.addEventListener('change', async () => {
    if (!fileInput.files.length) return;
    const added = await readFiles(fileInput.files);
    files.push(...added);
    renderFileList();
    clearStatus();
  });

  analyzeBtn.addEventListener('click', analyzeAndGenerate);
  clearBtn.addEventListener('click', clearProject);
  pauseBtn.addEventListener('click', () => {
    paused = true;
    updateControls();
    showStatus('Paused. The current image finishes, then generation waits.', 'info');
  });
  resumeBtn.addEventListener('click', () => {
    if (running) {
      paused = false;
      updateControls();
      clearStatus();
    } else {
      clearStatus();
      runImageQueue();
    }
  });
  cancelBtn.addEventListener('click', () => {
    cancelRequested = true;
    paused = false;
  });

  $('sb-zip').addEventListener('click', downloadZip);
  $('sb-prompts').addEventListener('click', () => download(`${project()} prompts.txt`, new Blob([promptsText()], { type: 'text/plain;charset=utf-8' })));
  $('sb-json').addEventListener('click', () => download(`${project()} scenes.json`, new Blob([sceneJson()], { type: 'application/json' })));
  $('sb-pdf').addEventListener('click', downloadPdf);

  // --- Init --------------------------------------------------------------

  (async () => {
    try {
      const res = await fetch('/api/health');
      const body = await res.json();
      if (body.storyboardConfigured) {
        card.hidden = false;
        restoreProject();
      }
    } catch {
      /* leave hidden */
    }
  })();
})();
