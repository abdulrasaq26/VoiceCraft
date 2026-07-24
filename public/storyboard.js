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
  const castEl = $('sb-cast');
  const castListEl = $('sb-cast-list');
  const useRefsEl = $('sb-use-refs');
  const exportsEl = $('sb-exports');
  const scenesEl = $('sb-scenes');
  const assetModeEl = $('sb-asset-mode');
  const styleEl = $('sb-style');
  const presetEl = $('sb-preset');
  const modeEl = $('sb-mode');
  const densityEl = $('sb-density');
  const styleNotesEl = $('sb-style-notes');
  const presetSaveBtn = $('sb-preset-save');
  const generateAllBtn = $('sb-generate-all');
  const rawBtn = $('sb-raw');
  const titleInput = $('title-input');

  const STYLE_KEY = 'blvck-tts:sb-style';
  const PRESETS_KEY = 'blvck-tts:sb-presets';
  let lastRaw = ''; // raw model response from the last analyze (for "View raw")

  // Built-in visual presets: a style id + extra notes, reusable across projects.
  const BUILTIN_PRESETS = [
    { name: 'Born Back Then (historical)', style: 'historical-illustration', notes: 'Warm atmospheric lighting, realistic period architecture, consistent color grading, faceless framing.' },
    { name: 'Modern Documentary', style: 'documentary', notes: 'Photoreal, natural lighting, candid documentary framing.' },
    { name: 'Business Explainer', style: 'modern-explainer', notes: 'Clean flat vector shapes, bright friendly colors, generous negative space.' },
    { name: 'Finance Explainer', style: 'infographic', notes: 'Charts, icons, bold flat colors, clear visual hierarchy.' },
    { name: 'Tech Explainer', style: 'tech-ui', notes: 'Sleek UI-inspired shapes, cool gradients, modern product-design look.' },
    { name: 'Self-help / Lifestyle', style: 'lifestyle', notes: 'Bright natural light, relatable modern settings, aspirational but authentic.' },
    { name: 'Animated Explainer', style: '2d-animation', notes: 'Clean vector style, bright colors, simple iconography.' },
    { name: 'Cinematic Realism', style: 'cinematic', notes: 'Dramatic lighting, filmic grade, shallow depth of field.' },
    { name: 'Anime Storytelling', style: 'anime', notes: 'Dramatic anime key-art, expressive characters, detailed backgrounds.' },
    { name: "Children's Educational", style: 'childrens-book', notes: 'Friendly rounded shapes, cheerful colors, simple clear scenes.' }
  ];

  // Project-level asset mode: 'image' | 'video' | 'mixed'. In mixed mode each
  // scene carries its own assetType (default 'image', togglable per scene).
  let assetMode = 'image';

  function sceneAssetType(scene) {
    if (assetMode === 'video') return 'video';
    if (assetMode === 'image') return 'image';
    return scene.assetType === 'video' ? 'video' : 'image'; // mixed
  }
  function isVideoBlob(blob) {
    return Boolean(blob && blob.type && blob.type.startsWith('video/'));
  }
  function videoExt(blob) {
    const t = (blob && blob.type) || '';
    if (t.includes('mp4')) return 'mp4';
    if (t.includes('webm')) return 'webm';
    return 'mp4';
  }

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

  // Character reference images (for cross-scene consistency).
  const refBlobs = new Map(); // name -> Blob
  const refUrls = new Map(); // name -> object URL
  const refDataUrls = new Map(); // name -> data: URL (passed to txt2img image_url)
  const refKey = (name) => `ref:${name}`;

  function blobToDataUrl(blob) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result || ''));
      r.onerror = () => resolve('');
      r.readAsDataURL(blob);
    });
  }
  async function setReference(name, blob) {
    refBlobs.set(name, blob);
    if (refUrls.has(name)) URL.revokeObjectURL(refUrls.get(name));
    refUrls.set(name, URL.createObjectURL(blob));
    refDataUrls.set(name, await blobToDataUrl(blob));
    await idbPut(refKey(name), blob);
  }

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
  async function idbDelete(key) {
    try {
      const db = await idbOpen();
      await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
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

  // Parse "HH:MM:SS" (from a "HH:MM:SS - HH:MM:SS" range) to seconds.
  function tsToSeconds(ts) {
    const m = String(ts || '').match(/(\d{1,2}):(\d{2}):(\d{2})/);
    if (!m) return null;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }

  // Merge adjacent subtitle cues into narrative story beats so we generate one
  // image per beat (~targetSec of runtime) instead of one per micro-caption.
  // targetSec <= 0 means "no merging" (one image per subtitle line).
  function mergeCuesToBeats(rawCues, targetSec) {
    if (!targetSec || targetSec <= 0 || rawCues.length <= 1) {
      return rawCues.map((c, i) => ({ ...c, index: i + 1 }));
    }
    const WORD_BUDGET = Math.round(targetSec * 2.6); // ~2.6 spoken words/sec
    const MAX_BEATS = 80;
    const beats = [];
    let cur = null;
    for (const c of rawCues) {
      const start = tsToSeconds((c.timestamp || '').split('-')[0]);
      const end = tsToSeconds((c.timestamp || '').split('-')[1]) ?? start;
      if (!cur) {
        cur = { startS: start, endS: end, startTs: c.timestamp, endTs: c.timestamp, words: c.text.split(/\s+/).length, text: c.text };
        continue;
      }
      const spanBySec = start != null && cur.startS != null ? (end ?? start) - cur.startS : null;
      const overBySec = spanBySec != null && spanBySec >= targetSec;
      const overByWords = spanBySec == null && cur.words >= WORD_BUDGET;
      if (overBySec || overByWords) {
        beats.push(cur);
        cur = { startS: start, endS: end, startTs: c.timestamp, endTs: c.timestamp, words: c.text.split(/\s+/).length, text: c.text };
      } else {
        cur.text += ' ' + c.text;
        cur.words += c.text.split(/\s+/).length;
        cur.endTs = c.timestamp;
        cur.endS = end ?? start;
      }
    }
    if (cur) beats.push(cur);
    // If we blew past a sane cap, coalesce further.
    let out = beats;
    if (out.length > MAX_BEATS) {
      const factor = Math.ceil(out.length / MAX_BEATS);
      const coalesced = [];
      for (let i = 0; i < out.length; i += factor) {
        const group = out.slice(i, i + factor);
        coalesced.push({
          startTs: group[0].startTs,
          endTs: group[group.length - 1].endTs,
          text: group.map((g) => g.text).join(' ')
        });
      }
      out = coalesced;
    }
    return out.map((b, i) => {
      const startLbl = (b.startTs || '').split('-')[0].trim();
      const endLbl = (b.endTs || '').split('-').pop().trim();
      const timestamp = startLbl && endLbl ? `${startLbl} - ${endLbl}` : (b.startTs || '');
      return { index: i + 1, timestamp, text: b.text.trim() };
    });
  }

  function buildContext() {
    const ctx = {};
    let subs = files.find((f) => f.kind === 'subtitles');
    let rawCues = [];
    if (subs) {
      rawCues = parseSubtitles(subs.content);
      if (!rawCues.length) rawCues = cuesFromScript(subs.content); // txt without timecodes
    }
    const script = files.find((f) => f.kind === 'script');
    if (script) {
      ctx.script = script.content;
      if (!rawCues.length) rawCues = cuesFromScript(script.content);
    }
    // Merge into story beats per the pacing control.
    const targetSec = densityEl ? Number(densityEl.value) : 15;
    cues = mergeCuesToBeats(rawCues, targetSec);
    if (cues.length) {
      ctx.subtitles = cues.map((c) => `#${c.index} [${c.timestamp}] ${c.text}`).join('\n');
    }
    const style = files.find((f) => f.kind === 'style');
    if (style) ctx.style = style.content;
    const chars = files.find((f) => f.kind === 'characters');
    if (chars) ctx.characters = chars.content;
    const instr = files.find((f) => f.kind === 'instructions');
    if (instr) ctx.instructions = instr.content;
    // Visual style direction from the UI.
    ctx.styleChoice = styleEl ? styleEl.value : 'auto';
    ctx.styleNotes = styleNotesEl ? styleNotesEl.value.trim() : '';
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
    if (rawBtn) rawBtn.hidden = true;
    setAnalyzing(true, 'Analyzing the story & inferring visual style…');
    const onAttempt = (n, max) => { if (n > 1) setAnalyzing(true, `Reformatting response (attempt ${n} of ${max})…`); };
    try {
      // 1. Project profile (story + inferred/selected visual style)
      const bibleRes = await window.BlvckAI.generateJSON('/api/storyboard/bible', { context: ctx }, { onAttempt });
      bible = bibleRes.bible;
      renderBible();

      // 2. Scene prompts in batches (with prior summaries for continuity)
      setAnalyzing(true, 'Writing scene prompts…');
      scenes = [];
      for (let i = 0; i < cues.length; i += SCENE_BATCH) {
        const batch = cues.slice(i, i + SCENE_BATCH);
        const prior = scenes.slice(-3).map((s) => `${s.camera}: ${s.sceneSummary}`);
        const res = await window.BlvckAI.generateJSON('/api/storyboard/scenes', {
          bible,
          cues: batch,
          style: ctx.style,
          instructions: ctx.instructions,
          priorSummaries: prior
        }, { onAttempt });
        (res.scenes || []).forEach((s) => scenes.push({ ...s, status: 'pending', error: null }));
        renderScenes();
      }
      saveProject();
    } catch (err) {
      lastRaw = (err && err.raw) || (window.BlvckAI.lastRawResponse && window.BlvckAI.lastRawResponse()) || '';
      if (rawBtn) rawBtn.hidden = !lastRaw;
      const cat = err && err.category ? ` [${err.category}]` : '';
      showStatus(`${err.message}${cat}${lastRaw ? ' — click “View raw response” to inspect.' : ''}`);
      setAnalyzing(false);
      return;
    }
    setAnalyzing(false);
    exportsEl.hidden = false;
    // 3. Generate assets — unless the user wants to review/edit prompts first.
    if (modeEl && modeEl.value === 'review') {
      if (generateAllBtn) generateAllBtn.hidden = false;
      showStatus(`${scenes.length} scene prompt(s) ready. Review or edit them, then click “Generate all images”.`, 'info');
    } else {
      runImageQueue();
    }
  }

  // Pick a reference image for a scene: the first character present in the
  // scene that has a reference portrait. Returns a data URL or null.
  function sceneReference(scene) {
    if (!useRefsEl || !useRefsEl.checked) return null;
    const names = Array.isArray(scene.characters) ? scene.characters : [];
    for (const n of names) {
      if (refDataUrls.has(n)) return refDataUrls.get(n);
    }
    return null;
  }

  async function generateSceneAsset(scene) {
    if (sceneAssetType(scene) === 'video') {
      // Puter txt2vid. Video clips are short (a few seconds) and slower than
      // images; the queue throttle and progress ETA account for that.
      return window.BlvckAI.generateVideo(scene.prompt, { seconds: 5, size: '1280x720' });
    }
    // Condition on a character reference where available (image scenes only).
    const imageUrl = sceneReference(scene);
    return window.BlvckAI.generateImage(scene.prompt, ASPECT, imageUrl ? { imageUrl } : {});
  }

  // Video generation is far slower than images; pace the queue accordingly.
  const THROTTLE_MS = 600;

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
        const blob = await generateSceneAsset(scene);
        storeAsset(scene.index, blob);
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
    renderScenes(); // re-render so run-gated controls (mixed toggles) reappear
    const done = scenes.filter((s) => s.status === 'done').length;
    const remaining = scenes.filter((s) => s.status !== 'done').length;
    if (quotaHit) {
      showStatus(
        `Generation limit reached. ${done} of ${scenes.length} scenes generated. ` +
          'Wait a moment for the rate limit to clear, then click “Continue”.'
      );
    } else if (cancelRequested) {
      showStatus('Cancelled. Completed scenes are saved.', 'info');
    } else if (remaining) {
      showStatus(`${remaining} scene(s) failed. Regenerate them individually.`);
    } else {
      showStatus(`Storyboard complete — ${scenes.length} scenes generated.`, 'info');
    }
  }

  function storeAsset(index, blob) {
    memBlobs.set(index, blob);
    if (urls.has(index)) URL.revokeObjectURL(urls.get(index));
    urls.set(index, URL.createObjectURL(blob));
    idbPut(String(index), blob);
    // Remember what kind of asset this scene ended up with, so the render
    // path and downloads work correctly after a reload.
    const scene = scenes.find((s) => s.index === index);
    if (scene) scene.assetType = isVideoBlob(blob) ? 'video' : 'image';
  }

  async function regenerateScene(scene) {
    if (running) {
      showStatus('Wait for the current run to finish, or pause it, before regenerating.');
      return;
    }
    scene.status = 'generating';
    renderScenes();
    try {
      const blob = await generateSceneAsset(scene);
      storeAsset(scene.index, blob);
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
    const vs = bible.visualStyle || {};
    const profileBits = [
      bible.genre && `<strong>Genre:</strong> ${esc(bible.genre)}`,
      bible.period && `<strong>Era:</strong> ${esc(bible.period)}`,
      bible.tone && `<strong>Tone:</strong> ${esc(bible.tone)}`,
      bible.audience && `<strong>Audience:</strong> ${esc(bible.audience)}`,
      bible.format && `<strong>Format:</strong> ${esc(bible.format)}`
    ].filter(Boolean).join(' · ');
    bibleEl.innerHTML =
      `<h3>Project profile — ${esc(bible.title)}</h3>` +
      (profileBits ? `<div class="sb-bible-item">${profileBits}</div>` : '') +
      (vs.name || vs.description
        ? `<div class="sb-bible-item sb-visualstyle"><strong>🎨 Visual style:</strong> ${esc(vs.name)}${vs.description ? ` — ${esc(vs.description)}` : ''}</div>`
        : '') +
      (chars ? `<h3 style="margin-top:.6rem">Characters</h3>${chars}` : '') +
      (locs ? `<h3 style="margin-top:.6rem">Locations</h3>${locs}` : '');
    renderCast();
  }

  // --- Character references (cross-scene consistency) --------------------

  let refBusy = false;

  function referencePrompt(name, description) {
    const vs = (bible && bible.visualStyle) || {};
    return (
      `Character reference portrait of ${name}. ${description}. ` +
      `Head-and-shoulders, neutral plain background, front-facing, clear consistent character design. ` +
      `${vs.description || ''}${vs.lighting ? `, ${vs.lighting}` : ''}`.trim()
    );
  }

  async function generateCharacterReference(name, description) {
    if (refBusy) return;
    refBusy = true;
    renderCast();
    try {
      const blob = await window.BlvckAI.generateImage(referencePrompt(name, description), '1:1');
      await setReference(name, blob);
      showStatus(`Reference for ${name} saved. Scenes with ${name} will use it.`, 'info');
    } catch (err) {
      showStatus(`Could not generate a reference for ${name}: ${err.message}`);
    } finally {
      refBusy = false;
      renderCast();
      saveProject();
    }
  }

  async function uploadCharacterReference(name, file) {
    if (!file) return;
    try {
      await setReference(name, file);
      renderCast();
      saveProject();
      showStatus(`Uploaded a reference for ${name}.`, 'info');
    } catch {
      showStatus(`Could not read the reference image for ${name}.`);
    }
  }

  function renderCast() {
    if (!castEl || !castListEl) return;
    const characters = (bible && bible.characters) || [];
    if (!characters.length) {
      castEl.hidden = true;
      return;
    }
    castEl.hidden = false;
    castListEl.innerHTML = '';
    characters.forEach((c) => {
      const name = c.name || '';
      if (!name) return;
      const card = document.createElement('div');
      card.className = 'sb-cast-card';

      const thumb = document.createElement('div');
      thumb.className = 'sb-cast-thumb';
      if (refUrls.has(name)) {
        const img = document.createElement('img');
        img.src = refUrls.get(name);
        img.alt = name;
        thumb.appendChild(img);
      } else {
        thumb.textContent = '—';
      }

      const info = document.createElement('div');
      info.className = 'sb-cast-info';
      const nm = document.createElement('div');
      nm.className = 'sb-cast-name';
      nm.textContent = name + (refUrls.has(name) ? ' ✓' : '');
      const actions = document.createElement('div');
      actions.className = 'sb-cast-actions';

      const gen = document.createElement('button');
      gen.type = 'button';
      gen.className = 'btn ghost small';
      gen.textContent = refUrls.has(name) ? 'Regenerate' : 'Generate';
      gen.disabled = refBusy || running;
      gen.addEventListener('click', () => generateCharacterReference(name, c.description || ''));

      const up = document.createElement('label');
      up.className = 'btn ghost small sb-cast-upload';
      up.textContent = 'Upload';
      const file = document.createElement('input');
      file.type = 'file';
      file.accept = 'image/*';
      file.hidden = true;
      file.addEventListener('change', () => { if (file.files[0]) uploadCharacterReference(name, file.files[0]); });
      up.appendChild(file);

      actions.append(gen, up);
      if (refUrls.has(name)) {
        const clr = document.createElement('button');
        clr.type = 'button';
        clr.className = 'btn ghost small';
        clr.textContent = 'Clear';
        clr.disabled = refBusy || running;
        clr.addEventListener('click', async () => {
          refBlobs.delete(name);
          if (refUrls.has(name)) URL.revokeObjectURL(refUrls.get(name));
          refUrls.delete(name);
          refDataUrls.delete(name);
          await idbDelete(refKey(name));
          renderCast();
          saveProject();
        });
        actions.appendChild(clr);
      }

      info.append(nm, actions);
      card.append(thumb, info);
      castListEl.appendChild(card);
    });
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
      const isVideo = sceneAssetType(scene) === 'video';
      let thumb;
      if (url && scene.status === 'done') {
        if (isVideo) {
          thumb = document.createElement('video');
          thumb.className = 'sb-thumb sb-thumb-video';
          thumb.src = url;
          thumb.muted = true;
          thumb.loop = true;
          thumb.playsInline = true;
          thumb.controls = true;
          thumb.preload = 'metadata';
        } else {
          thumb = document.createElement('img');
          thumb.className = 'sb-thumb';
          thumb.src = url;
          thumb.alt = `Scene ${scene.index}`;
        }
      } else {
        thumb = document.createElement('div');
        thumb.className = 'sb-thumb-placeholder';
        const noun = isVideo ? 'video' : 'image';
        thumb.textContent =
          scene.status === 'generating'
            ? `Generating ${noun}…`
            : scene.status === 'error'
              ? 'Failed'
              : `Queued (${noun})`;
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

      // Prompt transparency: show the detected action + visual goal, and let
      // the user edit the actual image prompt before generating.
      let insight = null;
      if (scene.detectedAction || scene.visualGoal) {
        insight = document.createElement('div');
        insight.className = 'sb-scene-insight';
        insight.innerHTML =
          (scene.detectedAction ? `<span><strong>Action:</strong> ${esc(scene.detectedAction)}</span>` : '') +
          (scene.visualGoal ? `<span><strong>Goal:</strong> ${esc(scene.visualGoal)}</span>` : '');
      }

      const prompt = document.createElement('textarea');
      prompt.className = 'sb-scene-prompt';
      prompt.value = scene.prompt;
      prompt.rows = 2;
      prompt.spellcheck = false;
      prompt.title = 'Edit the image prompt before generating';
      prompt.addEventListener('change', () => {
        scene.prompt = prompt.value.trim();
        saveProject();
      });

      const actions = document.createElement('div');
      actions.className = 'sb-scene-actions';
      const regen = document.createElement('button');
      regen.type = 'button';
      regen.textContent = scene.status === 'error' ? 'Retry' : 'Regenerate';
      regen.addEventListener('click', () => regenerateScene(scene));
      actions.appendChild(regen);

      // In mixed mode, let each scene switch between image and video. Changing
      // the type then Regenerate picks up the new asset kind.
      if (assetMode === 'mixed') {
        const toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.textContent = isVideo ? '→ Make image' : '→ Make video';
        toggle.title = 'Switch this scene’s asset type, then Regenerate';
        toggle.disabled = running;
        toggle.addEventListener('click', () => {
          scene.assetType = isVideo ? 'image' : 'video';
          saveProject();
          renderScenes();
        });
        actions.appendChild(toggle);
      }

      if (scene.status === 'done' && url) {
        const ext = isVideo ? videoExt(memBlobs.get(scene.index)) : 'png';
        const dl = document.createElement('a');
        dl.href = url;
        dl.download = `${project()} Scene ${String(scene.index).padStart(2, '0')}.${ext}`;
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

      body.append(head, subtitle);
      if (insight) body.appendChild(insight);
      body.append(prompt, actions);
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
        JSON.stringify({
          project: project(),
          cues,
          bible,
          assetMode,
          useRefs: useRefsEl ? useRefsEl.checked : true,
          scenes: scenes.map(({ ...s }) => s)
        })
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
    if (saved.assetMode && assetModeEl) {
      assetMode = saved.assetMode;
      assetModeEl.value = assetMode;
    }
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
    // Restore character reference images.
    if (useRefsEl && typeof saved.useRefs === 'boolean') useRefsEl.checked = saved.useRefs;
    for (const c of (bible && bible.characters) || []) {
      if (!c.name) continue;
      const blob = await idbGet(refKey(c.name));
      if (blob) {
        refBlobs.set(c.name, blob);
        refUrls.set(c.name, URL.createObjectURL(blob));
        refDataUrls.set(c.name, await blobToDataUrl(blob));
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
    refUrls.forEach((u) => URL.revokeObjectURL(u));
    refUrls.clear();
    refBlobs.clear();
    refDataUrls.clear();
    if (castEl) castEl.hidden = true;
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
      const ext = isVideoBlob(blob) ? videoExt(blob) : 'png';
      filesOut.push({
        name: `${project()} Scene ${String(s.index).padStart(2, '0')}.${ext}`,
        data: new Uint8Array(await blob.arrayBuffer())
      });
    }
    filesOut.push({ name: 'prompts.txt', data: enc.encode(promptsText()) });
    filesOut.push({ name: 'scenes.json', data: enc.encode(sceneJson()) });
    download(`${project()} storyboard.zip`, window.BlvckZip.create(filesOut));
  }

  async function downloadPdf() {
    // The PDF is an image contact sheet; video scenes have no still to embed.
    const doneScenes = scenes.filter(
      (s) => s.status === 'done' && memBlobs.has(s.index) && !isVideoBlob(memBlobs.get(s.index))
    );
    if (!doneScenes.length) {
      showStatus('No generated still images to export as a PDF yet.');
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

  // --- Visual style + presets --------------------------------------------

  function customPresets() {
    try { return JSON.parse(localStorage.getItem(PRESETS_KEY) || '[]'); } catch { return []; }
  }
  function saveCustomPresets(list) {
    try { localStorage.setItem(PRESETS_KEY, JSON.stringify(list)); } catch { /* quota */ }
  }

  function populateStyleSelect() {
    if (!styleEl || !window.VISUAL_STYLES) return;
    styleEl.innerHTML = '';
    Object.entries(window.VISUAL_STYLES).forEach(([id, def]) => {
      const o = document.createElement('option');
      o.value = id;
      o.textContent = def.label;
      styleEl.appendChild(o);
    });
    const saved = localStorage.getItem(STYLE_KEY);
    if (saved && window.VISUAL_STYLES[saved]) styleEl.value = saved;
  }

  function populatePresetSelect() {
    if (!presetEl) return;
    const prev = presetEl.value;
    presetEl.innerHTML = '<option value="">Presets…</option>';
    const add = (label, key) => {
      const o = document.createElement('option');
      o.value = key;
      o.textContent = label;
      presetEl.appendChild(o);
    };
    BUILTIN_PRESETS.forEach((p, i) => add(p.name, `builtin:${i}`));
    customPresets().forEach((p, i) => add(`★ ${p.name}`, `custom:${i}`));
    if ([...presetEl.options].some((o) => o.value === prev)) presetEl.value = prev;
  }

  function applyPreset(key) {
    let preset = null;
    if (key.startsWith('builtin:')) preset = BUILTIN_PRESETS[Number(key.slice(8))];
    else if (key.startsWith('custom:')) preset = customPresets()[Number(key.slice(7))];
    if (!preset) return;
    if (styleEl && window.VISUAL_STYLES[preset.style]) {
      styleEl.value = preset.style;
      localStorage.setItem(STYLE_KEY, preset.style);
    }
    if (styleNotesEl) styleNotesEl.value = preset.notes || '';
  }

  if (styleEl) {
    populateStyleSelect();
    styleEl.addEventListener('change', () => localStorage.setItem(STYLE_KEY, styleEl.value));
  }
  if (presetEl) {
    populatePresetSelect();
    presetEl.addEventListener('change', () => { if (presetEl.value) applyPreset(presetEl.value); });
  }
  if (presetSaveBtn) {
    presetSaveBtn.addEventListener('click', () => {
      const name = window.prompt('Name this visual preset:');
      if (!name) return;
      const list = customPresets();
      list.push({ name: name.trim().slice(0, 60), style: styleEl ? styleEl.value : 'auto', notes: styleNotesEl ? styleNotesEl.value.trim() : '' });
      saveCustomPresets(list);
      populatePresetSelect();
      showStatus(`Preset “${name}” saved.`, 'info');
    });
  }
  if (generateAllBtn) {
    generateAllBtn.addEventListener('click', () => {
      generateAllBtn.hidden = true;
      clearStatus();
      runImageQueue();
    });
  }
  if (rawBtn) {
    rawBtn.addEventListener('click', () => showRawResponse(lastRaw));
  }

  function showRawResponse(raw) {
    const w = window.open('', '_blank');
    if (w) {
      w.document.title = 'Raw model response';
      const pre = w.document.createElement('pre');
      pre.style.cssText = 'white-space:pre-wrap;word-break:break-word;font:13px monospace;padding:16px;';
      pre.textContent = raw || '(empty)';
      w.document.body.appendChild(pre);
    } else {
      // Popup blocked — fall back to a copy prompt.
      window.prompt('Raw model response (copy):', raw || '(empty)');
    }
  }

  // Import subtitles/script already generated earlier in the workflow, so the
  // user never has to download-then-re-upload files between modules.
  function importFromProject() {
    if (!window.BlvckAssets) { showStatus('Project assets are unavailable.'); return; }
    const srt = window.BlvckAssets.subtitlesSRT();
    const scriptText = window.BlvckAssets.script();
    const already = (kind) => files.some((f) => f.kind === kind && f.imported);
    let added = 0;
    if (srt && !already('subtitles')) {
      files = files.filter((f) => !(f.kind === 'subtitles' && f.imported));
      files.push({ name: 'project-subtitles.srt', kind: 'subtitles', content: srt, imported: true });
      added++;
    }
    if (scriptText && !already('script')) {
      files = files.filter((f) => !(f.kind === 'script' && f.imported));
      files.push({ name: 'project-script.txt', kind: 'script', content: scriptText, imported: true });
      added++;
    }
    if (!added && !srt && !scriptText) {
      showStatus('No project subtitles or script yet — generate them in the Script or Voice section first.');
      return;
    }
    renderFileList();
    const bits = [];
    if (srt) bits.push('subtitles');
    if (scriptText) bits.push('script');
    showStatus(`Imported ${bits.join(' + ')} from your project. Click “Analyze & generate”.`, 'info');
  }

  const importBtn = $('sb-import');
  if (importBtn) importBtn.addEventListener('click', importFromProject);
  if (useRefsEl) useRefsEl.addEventListener('change', saveProject);
  analyzeBtn.addEventListener('click', analyzeAndGenerate);
  clearBtn.addEventListener('click', clearProject);
  if (assetModeEl) {
    assetModeEl.addEventListener('change', () => {
      assetMode = assetModeEl.value;
      saveProject();
      renderScenes();
    });
  }
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
      card.hidden = false;
      restoreProject();
    } catch {
      /* leave hidden */
    }
  })();
})();
