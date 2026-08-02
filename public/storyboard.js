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
    // What the scene ACTUALLY holds wins over what the project is set to
    // produce. A typeset beat is a PNG even in a video project, and rendering
    // it into a <video> gives a black player that never plays — which is
    // exactly how finished charts and maps appeared to be missing.
    if (scene && scene.assetType) return scene.assetType === 'video' ? 'video' : 'image';
    // Nothing stored yet: fall back to what this project intends to make, so
    // the placeholder says "Queued (video)" rather than guessing wrong.
    if (assetMode === 'video') return 'video';
    if (assetMode === 'image') return 'image';
    return 'image'; // mixed, undecided
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
    // Fall back to the project's own subtitles even when the user never clicked
    // "Import from project".
    //
    // This is not a convenience. Timecodes are the ONLY thing that ties a scene
    // to a moment in the narration — without them every beat gets a flat
    // default and the pictures drift against the voice. Making that depend on
    // remembering a button meant the most common path silently produced an
    // out-of-sync video.
    if (!rawCues.some((c) => c.timestamp) && window.BlvckAssets) {
      const projectSrt = window.BlvckAssets.subtitlesSRT();
      if (projectSrt) {
        const timed = parseSubtitles(projectSrt);
        if (timed.length) rawCues = timed;
      }
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
      const bibleRes = await window.BlvckAI.generateJSON('/api/storyboard/bible', { context: ctx }, { onAttempt, task: 'bible' });
      bible = bibleRes.bible;
      syncBibleToConsistency();
      renderBible();

      // 2. Scene prompts in batches (with prior summaries for continuity)
      setAnalyzing(true, 'Writing scene prompts…');
      scenes = [];
      // A new storyboard reuses scene indices for entirely different content,
      // so every render record from the old one is now a lie: it reported
      // "canvas" for beats whose images had already been cleared, which made
      // unrendered scenes look finished and kept them out of the queue.
      if (window.BlvckLTX && window.BlvckLTX.reset) window.BlvckLTX.reset();
      for (let i = 0; i < cues.length; i += SCENE_BATCH) {
        const batch = cues.slice(i, i + SCENE_BATCH);
        const prior = scenes.slice(-3).map((s) => `${s.camera}: ${s.sceneSummary}`);
        const res = await window.BlvckAI.generateJSON('/api/storyboard/scenes', {
          bible,
          cues: batch,
          style: ctx.style,
          instructions: ctx.instructions,
          priorSummaries: prior
        }, { onAttempt, task: 'storyboard' });
        (res.scenes || []).forEach((s) => scenes.push({ ...s, status: 'pending', error: null }));
        renderScenes();
      }
      // Continuity across batch boundaries. parseScenes already carried
      // environment/time/weather/lighting forward WITHIN each batch, but the
      // model never sees earlier batches, so the first scene of batch 2 usually
      // comes back blank. One pass over the finished list closes those seams.
      if (window.BlvckPrompts && window.BlvckPrompts.applyContinuity) {
        scenes = window.BlvckPrompts.applyContinuity(scenes);
        renderScenes();
      }
      // Seed the character library from the bible so every recurring person has
      // a profile to attach a portrait (and later an LTX subject reference) to.
      if (window.BlvckCast) window.BlvckCast.importFromBible(bible);
      saveProject();
      // Build reference portraits for anyone who actually recurs, before the
      // scene queue runs, so the cast is locked in first.
      await autoBuildRecurringReferences();
    } catch (err) {
      lastRaw = (err && err.raw) || (window.BlvckAI.lastRawResponse && window.BlvckAI.lastRawResponse()) || '';
      if (rawBtn) rawBtn.hidden = !lastRaw;
      const cat = err && err.category ? ` [${err.category}]` : '';
      showStatus(`${err.message}${cat}${lastRaw ? ' — click “View raw response” to inspect.' : ''}`);
      setAnalyzing(false);
      return;
    }
    exportsEl.hidden = false;

    // 3. Plan the shots BEFORE generating anything.
    //
    // This used to jump straight into rendering a still for every scene, which
    // is work decided before anyone knew what the scenes were for. Planning is
    // one cheap LLM call and it determines what each beat actually needs: a
    // chart or map is drawn on canvas and needs no image at all, and a filmed
    // beat is rendered from text and needs no image either. Generating first
    // meant paying for pictures the video would never use.
    let planned = null;
    if (window.BlvckLTX && window.BlvckLTX.planWithDirector) {
      try {
        setAnalyzing(true, 'Planning shots — deciding what each beat should be…');
        planned = await window.BlvckLTX.planWithDirector();
        renderScenes();
      } catch (err) {
        // A failed plan is not fatal; the scenes are still usable by hand.
        console.warn('[Storyboard] Shot planning failed:', err.message);
      }
    }
    setAnalyzing(false);

    if (planned) {
      const mix = Object.entries(planned.mix || {})
        .sort((a, b) => b[1] - a[1])
        .map(([k, n]) => `${n}× ${k}`)
        .join(', ');
      const warn = planned.warnings && planned.warnings.length
        ? ` ⚠ ${planned.warnings.join('; ')}`
        : '';
      const ret = planned.retention && planned.retention.issues && planned.retention.issues.length
        ? ` 📉 ${planned.retention.issues.slice(0, 2).map((i) => `[${i.where}] ${i.message}`).join(' ')}`
        : '';
      showStatus(
        `${scenes.length} beat(s) planned as ${planned.mode || 'default'} — ${mix}. ` +
        `Review below, then click “Generate all scene clips”.${warn}${ret}`,
        'info'
      );
      if (generateAllBtn) generateAllBtn.hidden = false;
      return;
    }

    // No planner available — fall back to the original still-image behaviour.
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

  // bible.visualStyle is an OBJECT ({name, description, lighting, colorGrading,
  // negative}). Interpolating it straight into a template literal produced the
  // literal text "[object Object]", so every scene prompt carried that instead
  // of the style, and the image model was left with no style anchor at all —
  // which is why output drifted between scenes and ignored the chosen look.
  // Copy the project's cast, locations and style into the consistency engine.
  //
  // These were two disconnected stores: the bible held characters and
  // locations, AssetConsistency held its own, and nothing moved between them.
  // Since buildConsistencyPromptBlock only emits a CHARACTER or LOCATION line
  // when its OWN store knows that name, it never emitted any — the engine had
  // no idea who was in the film.
  function syncBibleToConsistency() {
    const AC = window.AssetConsistency;
    if (!AC || !bible) return;
    (bible.characters || []).forEach((c) => {
      if (!c || !c.name) return;
      const existing = (AC.getBibles().characters || {})[c.name] || {};
      // Keep any reference portrait already captured for this character.
      AC.setCharacter(c.name, { ...existing, traits: c.description || existing.traits || '' });
    });
    (bible.locations || []).forEach((l) => {
      if (!l || !l.name) return;
      AC.setLocation(l.name, { description: l.description || '' });
    });
    const vs = bible.visualStyle || {};
    if (vs.name || vs.description) {
      AC.setStyle(vs.name || 'Project style', {
        palette: vs.colorGrading || '',
        camera: ''
      });
    }
  }

  // Which of the bible's locations this scene is set in, if any. Used to pull
  // that location's canonical description into the prompt so the same place
  // looks the same every time it appears.
  function sceneLocation(scene) {
    const locs = (bible && bible.locations) || [];
    if (!locs.length) return '';
    const hay = `${scene.sceneSummary || ''} ${scene.prompt || ''} ${scene.visualFocus || ''}`.toLowerCase();
    const hit = locs.find((l) => l.name && hay.includes(String(l.name).toLowerCase()));
    return hit ? hit.name : '';
  }

  // A seed derived from the project title, so every scene in one video draws
  // from the same corner of the model's latent space and a re-run reproduces
  // the same frame. The scene index is folded in only lightly — identical
  // seeds across scenes would push every frame toward the same composition.
  // Match the card background to the project's own grade so graphics cut
  // against the footage rather than flashing white in a dark video.
  function graphicTheme() {
    const vs = (bible && bible.visualStyle) || {};
    const hay = `${vs.description || ''} ${vs.colorGrading || ''} ${vs.lighting || ''}`.toLowerCase();
    return /bright|light|airy|white|daylight|clean|pastel/.test(hay) ? 'light' : 'dark';
  }

  function hash32(s) {
    let h = 2166136261;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return Math.abs(h % 1000000);
  }

  function projectSeed() {
    return hash32((window.BlvckAssets && window.BlvckAssets.title()) || 'aether');
  }

  // Seeding strategy, and why it is shaped this way:
  //
  // Our Stable Diffusion adapter is text2img only, so the character reference
  // PORTRAITS cannot be fed back in as an init image — the imageUrl we pass is
  // dropped by that path. With no img2img, the only lever that actually keeps a
  // face recognisable between scenes is the seed. So every scene featuring a
  // given character is rendered from that character's own fixed seed, which
  // puts them in the same region of latent space each time; the prompts still
  // differ per scene, so composition and action vary.
  //
  // Scenes with no character fall back to the project seed offset by index, so
  // they stay in the project's look without all collapsing into one frame.
  function sceneSeed(scene) {
    const base = projectSeed();
    const names = Array.isArray(scene && scene.characters) ? scene.characters.filter(Boolean) : [];
    if (names.length) {
      const primary = String(names[0]).trim().toLowerCase();
      return (base + hash32(primary)) % 1000000;
    }
    const idx = Number.isFinite(scene && scene.index) ? scene.index : 0;
    return (base + idx * 17) % 1000000;
  }

  function styleText(vs) {
    if (!vs) return '';
    if (typeof vs === 'string') return vs;
    return [vs.description || vs.name, vs.lighting, vs.colorGrading]
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  function styleNegative(vs) {
    if (!vs || typeof vs === 'string') return '';
    return String(vs.negative || '').trim();
  }

  async function generateSceneAsset(scene) {
    // Frames that are really about words are typeset, not generated. Diffusion
    // models cannot spell, so a checklist or a big number rendered on the GPU
    // comes back as pseudo-lettering; drawn here it is correct every time, on
    // brand, and returns in milliseconds without touching the queue's GPU time.
    // Two ways a beat qualifies as typeset: the storyboard model gave it a
    // graphic spec, or the Director planned it as one of the data types
    // (chart/map/timeline/whiteboard). The second case is why this check can
    // no longer rely on looksLikeGraphic alone — a beat planned as "chart"
    // carries no `graphic` from the storyboard pass, so it used to fall
    // through and be rendered PHOTOGRAPHICALLY, which is precisely the
    // scrambled-lettering failure the canvas renderer exists to avoid.
    const plannedCanvas = !!(window.BlvckLTX && window.BlvckLTX.rendersOnCanvas(scene));
    if (window.BlvckGraphic && (plannedCanvas || window.BlvckGraphic.looksLikeGraphic(scene))) {
      const spec = Object.assign(
        // The Director's visualType is the card kind; the storyboard's own
        // spec (checklist/stat/title) wins when it supplied one.
        { kind: plannedCanvas ? scene.visualType : 'title' },
        scene.graphic || { title: scene.sceneSummary || scene.subtitle || '' }
      );
      // Palette comes from the project's own subject, so a safety video's cards
      // read as safety and a finance video's do not look identical to them.
      return window.BlvckGraphic.render({
        ...spec,
        theme: graphicTheme(),
        palette: window.BlvckGraphic.paletteFor(bible)
      });
    }

    // Build from the Director's structured decisions when it has planned this
    // beat, not from scene.prompt — that string was written during the
    // storyboard pass, BEFORE the Director ran, so shot scale, place, time of
    // day, weather, light, props and mood were reaching video prompts and
    // silently missing image prompts. Same intelligence, both paths.
    let finalPrompt = scene.prompt || '';
    if (scene.visualType && window.BlvckLTX && window.BlvckLTX.stillPromptFor) {
      const chosenStyle = styleEl && styleEl.value && styleEl.value !== 'auto' ? styleEl.value : '';
      const planned = window.BlvckLTX.stillPromptFor(scene, bible, chosenStyle);
      if (planned) finalPrompt = planned;
    } else if (scene.visualType === 'presenter' && window.BlvckHost && window.BlvckHost.isConfigured()) {
      // No planner available: keep the host rule at minimum.
      finalPrompt = [
        `${window.BlvckHost.descriptor()}, speaking directly to camera`,
        window.BlvckHost.backgroundText(),
        scene.detectedAction || scene.sceneSummary || ''
      ].filter(Boolean).join('. ');
    }

    // Append the master visual style so every scene shares one look.
    const styled = styleText(bible && bible.visualStyle);
    if (styled) {
      if (!finalPrompt.toLowerCase().includes(styled.slice(0, 24).toLowerCase())) {
        finalPrompt = `${finalPrompt}. Visual style: ${styled}`;
      }
    } else if (styleEl && styleEl.value && styleEl.value !== 'auto') {
      finalPrompt = `${finalPrompt}. Visual style: ${styleEl.value}`;
    }
    // The style's negatives go to the engine's own negative_prompt where one
    // exists (Stable Diffusion, SDXL). They must NOT be appended to the
    // positive prompt: writing "avoid sepia, film grain" there describes those
    // things to the sampler and makes them MORE likely, not less.
    const styleNeg = window.BlvckLTX && window.BlvckLTX.stillNegativeFor
      ? window.BlvckLTX.stillNegativeFor(bible, styleEl && styleEl.value !== 'auto' ? styleEl.value : '')
      : '';
    const negative = [styleNeg, styleNegative(bible && bible.visualStyle)].filter(Boolean).join(', ');

    if (sceneAssetType(scene) === 'video') {
      return window.BlvckAI.generateVideo(finalPrompt, { seconds: 5, size: '1280x720' });
    }
    const imageUrl = sceneReference(scene);
    // characters/location were never passed, so the consistency engine always
    // received empty arrays and could not emit the per-character or
    // per-location rules that keep a cast and a world looking the same.
    return window.BlvckAI.generateImage(finalPrompt, ASPECT, {
      ...(imageUrl ? { imageUrl } : {}),
      seed: sceneSeed(scene),
      // Tell the backend which style LoRA to apply. The prompt alone cannot
      // move a checkpoint off what it was fine-tuned for.
      style: chosenStyle || '',
      negative_prompt: negative || undefined,
      // Character continuity holds a SEQUENCE together. For a single still
      // generated from text with no init image, it only spends prompt weight
      // that composition needs more.
      characters: imageUrl ? (Array.isArray(scene.characters) ? scene.characters : []) : [],
      location: sceneLocation(scene)
    });
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
      // Skip only when this scene already has a STILL. A scene marked 'done'
      // because the LTX pipeline rendered it a video clip has no image yet, and
      // the two tracks are deliberately independent: clips live under
      // clip:<index>, stills under <index>, so generating one never destroys
      // the other and either can be produced first.
      if (scene.status === 'done' && scene.assetType !== 'video') continue;
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
    if (pauseBtn) pauseBtn.hidden = !(running && !paused);
    if (resumeBtn) {
      resumeBtn.hidden = !((running && paused) || (!running && hasPending && scenes.length));
      resumeBtn.textContent = running ? 'Resume' : 'Continue';
    }
    if (cancelBtn) cancelBtn.hidden = !running;
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

  // A character is worth a reference sheet once they appear in more than one
  // scene — a one-off extra does not need locking down, and generating a
  // portrait for every named person in the script wastes a lot of GPU time.
  function recurringCharacters(minScenes = 2) {
    const counts = new Map();
    scenes.forEach((s) => {
      (Array.isArray(s.characters) ? s.characters : []).forEach((n) => {
        const key = String(n || '').trim();
        if (key) counts.set(key, (counts.get(key) || 0) + 1);
      });
    });
    const named = (bible && bible.characters) || [];
    return [...counts.entries()]
      .filter(([, n]) => n >= minScenes)
      .map(([name]) => {
        const match = named.find((c) => c.name && c.name.toLowerCase() === name.toLowerCase());
        return { name, description: (match && match.description) || '', scenes: counts.get(name) };
      });
  }

  async function autoBuildRecurringReferences() {
    const recurring = recurringCharacters();
    if (!recurring.length) return;
    const todo = recurring.filter((c) => !refDataUrls.has(c.name));
    if (!todo.length) return;

    setAnalyzing(true, `Building reference portraits for ${todo.length} recurring character(s)…`);
    for (const c of todo) {
      try {
        // Each portrait uses that character's own seed — the same one their
        // scenes will use — so the sheet and the scenes agree.
        const blob = await window.BlvckAI.generateImage(
          referencePrompt(c.name, c.description), '1:1',
          { seed: (projectSeed() + hash32(c.name.toLowerCase())) % 1000000 }
        );
        await setReference(c.name, blob);
      } catch (err) {
        console.warn(`[Storyboard] Could not build a reference for ${c.name}:`, err.message);
      }
    }
    renderCast();
    saveProject();
    setAnalyzing(false);
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

  // Full-size preview for a scene's asset. Built on demand and torn down on
  // close: a paused-but-alive <video> holding a blob URL keeps the decoder and
  // the blob in memory, and with a dozen scenes that adds up.
  let previewEl = null;

  function closePreview() {
    if (!previewEl) return;
    const v = previewEl.querySelector('video');
    if (v) {
      v.pause();
      v.removeAttribute('src');
      v.load();
    }
    previewEl.remove();
    previewEl = null;
    document.removeEventListener('keydown', onPreviewKey);
  }

  function onPreviewKey(e) {
    if (e.key === 'Escape') closePreview();
  }

  function openPreview(scene, url, isVideo) {
    closePreview();
    if (!url) return;

    previewEl = document.createElement('div');
    previewEl.className = 'sb-preview';
    previewEl.setAttribute('role', 'dialog');
    previewEl.setAttribute('aria-label', `Scene ${scene.index} preview`);
    previewEl.style.cssText =
      'position:fixed;inset:0;z-index:9999;background:rgba(0,0,0,.88);' +
      'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:12px;padding:24px;cursor:zoom-out';

    const media = isVideo ? document.createElement('video') : document.createElement('img');
    media.src = url;
    media.style.cssText = 'max-width:min(1280px,94vw);max-height:82vh;border-radius:10px;box-shadow:0 24px 60px rgba(0,0,0,.6);cursor:default';
    if (isVideo) {
      media.controls = true;
      media.autoplay = true;
      media.loop = true;
      media.playsInline = true;
    } else {
      media.alt = `Scene ${scene.index}`;
    }
    // Clicks on the media itself must not close the dialog — scrubbing a video
    // would dismiss it constantly.
    media.addEventListener('click', (e) => e.stopPropagation());

    const caption = document.createElement('div');
    caption.style.cssText = 'color:#e8ecf2;font:500 14px/1.5 system-ui;max-width:min(1280px,94vw);text-align:center';
    const bits = [
      `Scene ${scene.index}`,
      scene.timestamp || '',
      scene.visualType || '',
      isVideo ? 'video' : 'image'
    ].filter(Boolean);
    caption.textContent = `${bits.join(' · ')}${scene.subtitle ? ` — ${scene.subtitle}` : ''}`;

    const hint = document.createElement('div');
    hint.style.cssText = 'color:#9aa4b2;font:400 12px system-ui';
    hint.textContent = 'Click anywhere or press Esc to close';

    previewEl.append(media, caption, hint);
    previewEl.addEventListener('click', closePreview);
    document.addEventListener('keydown', onPreviewKey);
    document.body.appendChild(previewEl);
  }

  function renderScenes() {
    // A preview left open would point at a blob URL this re-render is about to
    // revoke.
    closePreview();
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
          // 'metadata' loads duration but decodes no picture, so the card shows
          // a black player until the user presses play — a rendered clip looks
          // like a failed one. Nudge past the first frame to force a poster.
          thumb.preload = 'auto';
          thumb.addEventListener('loadeddata', () => {
            if (thumb.currentTime === 0) {
              try {
                thumb.currentTime = 0.1;
              } catch {
                /* some codecs refuse an early seek; the player still works */
              }
            }
          }, { once: true });
        } else {
          thumb = document.createElement('img');
          thumb.className = 'sb-thumb';
          thumb.src = url;
          thumb.alt = `Scene ${scene.index}`;
        }
        // Open the full-size preview. On a video the controls are inside the
        // element, so only a click on the frame itself should open the
        // lightbox — otherwise hitting play would fill the screen instead.
        thumb.style.cursor = 'zoom-in';
        thumb.title = 'Click to preview full size';
        thumb.addEventListener('click', (e) => {
          if (isVideo && e.target !== thumb) return;
          if (isVideo) e.preventDefault();
          openPreview(scene, url, isVideo);
        });
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

  // The Director writes its plan into localStorage, but this module keeps its
  // own in-memory copy of `scenes` and writes that back on every save. Without
  // pulling the plan in here, the next saveProject() would overwrite it — the
  // plan would appear to work and then silently vanish.
  //
  // Only the planned fields are copied; status, prompt and image state stay
  // whatever this module already believes, since it owns those.
  window.addEventListener('blvck:scenes-planned', (ev) => {
    const planned = (ev && ev.detail && ev.detail.scenes) || [];
    if (!planned.length || !scenes.length) return;
    const byIndex = new Map(planned.map((s) => [s.index, s]));
    const FIELDS = ['visualType', 'hostOverlay', 'shotType', 'cameraMovement', 'motion', 'emotion', 'transition'];
    scenes = scenes.map((s) => {
      const p = byIndex.get(s.index);
      if (!p) return s;
      const out = { ...s };
      FIELDS.forEach((f) => {
        if (p[f] !== undefined && p[f] !== '') out[f] = p[f];
      });
      return out;
    });
    renderScenes();
  });

  // A beat rendered by the LTX pipeline (a video clip, or a typeset card drawn
  // on canvas). The scene card is driven by scene.status and the `urls` map,
  // neither of which that pipeline touches — so without this the beat keeps
  // displaying whatever error it last failed with, plus a Retry button, while
  // its finished footage sits in storage unseen.
  window.addEventListener('blvck:clip-rendered', async (ev) => {
    const d = (ev && ev.detail) || {};
    const scene = scenes.find((s) => s.index === d.index);
    if (!scene) return;

    const isVideo = d.kind === 'video';
    const blob = await idbGet(isVideo ? `clip:${d.index}` : String(d.index));
    if (!blob) return;

    if (urls.has(d.index)) URL.revokeObjectURL(urls.get(d.index));
    urls.set(d.index, URL.createObjectURL(blob));

    scene.status = 'done';
    scene.error = null;
    // Drives the <video> vs <img> choice in renderScenes().
    scene.assetType = isVideo ? 'video' : 'image';

    renderScenes();
    saveProject();
  });

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
    // Pick up anything the LTX pipeline rendered.
    //
    // Those beats are stored outside this module's own image queue — clips
    // under clip:<index>, typeset cards under <index> — and the event that
    // announces them only fires at render time. Without this reconciliation, a
    // clip rendered before a reload would sit in storage while its card kept
    // showing the failure it had before, which looks exactly like the render
    // never happened.
    if (window.BlvckLTX && window.BlvckLTX.allStatus) {
      const rendered = window.BlvckLTX.allStatus();
      for (const s of scenes) {
        const rec = rendered[String(s.index)];
        if (!rec || (rec.status !== 'done' && rec.status !== 'canvas')) continue;
        const isVideo = rec.status === 'done';
        const blob = await idbGet(isVideo ? `clip:${s.index}` : String(s.index));
        if (!blob) continue;
        if (urls.has(s.index)) URL.revokeObjectURL(urls.get(s.index));
        urls.set(s.index, URL.createObjectURL(blob));
        s.status = 'done';
        s.error = null;
        s.assetType = isVideo ? 'video' : 'image';
      }
    }

    renderBible();
    renderScenes();
    exportsEl.hidden = false;
    const pending = scenes.filter((s) => s.status !== 'done').length;
    if (pending) showStatus(`Restored a storyboard with ${pending} scene(s) left. Click “Continue”.`, 'info');
  }

  // Reset only the in-memory + DOM state (no storage deletion). Shared by the
  // full clear and by the data-manager refresh hook.
  function resetMemory() {
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
    fileInput.value = '';
    renderFileList();
    renderBible();
    scenesEl.innerHTML = '';
    exportsEl.hidden = true;
    progressWrap.hidden = true;
    clearStatus();
  }

  async function clearProject() {
    if (running) return;
    resetMemory();
    await idbClear();
    localStorage.removeItem(LS_KEY);
  }

  // Re-hydrate from storage (used by the data manager after a clear or undo).
  async function refresh() {
    if (running) return;
    resetMemory();
    await restoreProject();
  }

  // Remove only completed ('done') or failed ('error') scenes, deleting their
  // images. Returns how many were removed. Used by the smart-clear options.
  async function clearScenes(filter) {
    if (running || !scenes.length) return 0;
    const match = filter === 'completed' ? 'done' : 'error';
    const removed = scenes.filter((s) => s.status === match);
    if (!removed.length) return 0;
    for (const s of removed) {
      await idbDelete(String(s.index));
      const u = urls.get(s.index);
      if (u) { URL.revokeObjectURL(u); urls.delete(s.index); }
      memBlobs.delete(s.index);
    }
    scenes = scenes.filter((s) => s.status !== match);
    saveProject();
    renderScenes();
    if (!scenes.length) exportsEl.hidden = true;
    return removed.length;
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
  // The #sb-clear button carries data-clear="storyboard", so the data manager
  // wires it (confirm + undo). Fall back to a direct clear only if the data
  // manager isn't present.
  if (window.BlvckData) {
    window.BlvckData.register('storyboard', refresh);
    window.BlvckData.registerScenes(clearScenes);
  } else {
    clearBtn.addEventListener('click', clearProject);
  }
  if (assetModeEl) {
    assetModeEl.addEventListener('change', () => {
      assetMode = assetModeEl.value;
      saveProject();
      renderScenes();
      // The render panel prices and labels itself from this choice, so it has
      // to hear about the change. Without this it kept offering to generate
      // "clips" for a stills project, and quoting video minutes for it.
      try {
        window.dispatchEvent(new CustomEvent('blvck:ltx-changed'));
      } catch {
        /* no-op */
      }
    });
  }
  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      paused = true;
      updateControls();
      showStatus('Paused. The current image finishes, then generation waits.', 'info');
    });
  }
  if (resumeBtn) {
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
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', () => {
      cancelRequested = true;
      paused = false;
      showStatus('Cancelling image queue…', 'info');
      updateControls();
    });
  }

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

  // Expose what the render queue needs to honour the user's choice.
  //
  // "Scene Assets: Still images" lived only inside this module, so the LTX
  // queue rendered video regardless — the setting was real, respected here,
  // and invisible to the one place that most needed it. A user who picked
  // stills was told a run would take an hour of GPU time when it should have
  // taken seconds.
  window.BlvckStoryboard = {
    assetMode: () => assetMode,
    /** What this specific scene should produce: 'image' or 'video'. */
    assetTypeFor: (scene) => sceneAssetType(scene || {}),
    /** Render one scene's still (or canvas card) exactly as the storyboard does. */
    generateStill: (scene) => generateSceneAsset(scene),
    /** Persist a rendered asset against a scene, so it appears on the card. */
    attachAsset: async (scene, blob, kind) => {
      await idbPut(String(scene.index), blob);
      const s = scenes.find((x) => x.index === scene.index);
      if (s) {
        s.status = 'done';
        s.error = null;
        s.assetType = kind || 'image';
      }
      if (urls.has(scene.index)) URL.revokeObjectURL(urls.get(scene.index));
      urls.set(scene.index, URL.createObjectURL(blob));
      saveProject();
      renderScenes();
    }
  };
})();
