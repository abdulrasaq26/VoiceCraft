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
  // The project title, used to name every export and stored with the project.
  //
  // This was referenced by project() and never declared. The `titleInput &&`
  // guard there could not help: referencing an undeclared identifier throws a
  // ReferenceError before && is ever evaluated, and the element's id is
  // "title-input" — hyphenated, so not a valid identifier — which is why the
  // browser's implicit global for element ids did not cover it either.
  //
  // saveProject() calls project(), so every save threw. Live, that killed the
  // media queue the moment the first scene finished downloading: the asset was
  // already in hand, the scene was never marked done, no card rendered, and the
  // status sat on "Fetching stock media..." indefinitely.
  const titleInput = $('title-input');

  // Left behind when the cast panel was removed from the Storyboard. The code
  // that touched them still runs and still guards with `if (castEl)`, which
  // throws rather than skipping when the name was never declared at all. The
  // lookups return null now that the markup is gone, so those guards do what
  // they were written to do.
  const castEl = $('sb-cast');
  const castListEl = $('sb-cast-list');
  const progressWrap = $('sb-progress');
  const progressFill = $('sb-progress-fill');
  const statsEl = $('sb-stats');
  const etaEl = $('sb-eta');
  const pauseBtn = $('sb-pause');
  const resumeBtn = $('sb-resume');
  const cancelBtn = $('sb-cancel');
  const bibleEl = $('sb-bible');
  const stockStrategyEl = $('sb-stock-strategy');
  const stockProviderEl = $('sb-stock-provider');
  const formatDisplayEl = $('sb-format-display');
  const styleEl = $('sb-style');
  const styleNotesEl = $('sb-style-notes');
  const presetEl = $('sb-style-preset');
  const presetSaveBtn = $('sb-save-preset');
  const densityEl = $('sb-density');

  // These three decide what gets fetched and how much of it, so losing them on
  // reload is not a cosmetic annoyance: a producer who chose "Modern stock
  // only" to avoid the archive would silently be back on every source after a
  // refresh, and would not know until a beat came back archival.
  const CONTROL_PREFS = 'blvck:storyboard_controls';

  function restoreControls() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(CONTROL_PREFS) || '{}'); } catch { /* defaults */ }
    const pairs = [['strategy', stockStrategyEl], ['provider', stockProviderEl],
                   ['density', densityEl]];
    // Pacing changed meaning: it used to be a target scene length in seconds
    // (20/15/10) and is now the shortest shot worth cutting to (7/4/2.5).
    // Without this a saved choice just fails the options check below and
    // silently reverts to Balanced, quietly discarding the user's setting.
    const PACING_MIGRATION = { '20': '7', '15': '4', '10': '2.5' };
    if (saved.density && PACING_MIGRATION[saved.density]) {
      saved.density = PACING_MIGRATION[saved.density];
    }
    for (const [key, el] of pairs) {
      if (!el || !saved[key]) continue;
      // Only restore a value the control still offers — the options changed
      // once already when the archive was added.
      if ([...el.options].some((o) => o.value === saved[key])) el.value = saved[key];
    }
    for (const [, el] of pairs) {
      if (el) el.addEventListener('change', saveControls);
    }
  }

  function saveControls() {
    try {
      localStorage.setItem(CONTROL_PREFS, JSON.stringify({
        strategy: stockStrategyEl ? stockStrategyEl.value : undefined,
        provider: stockProviderEl ? stockProviderEl.value : undefined,
        density: densityEl ? densityEl.value : undefined
      }));
    } catch { /* a full quota must not break the page */ }
  }
  const assetModeEl = $('sb-asset-mode');
  const generateAllBtn = $('sb-generate-all');
  const scenesEl = $('sb-scenes');
  const exportsEl = $('sb-exports');
  const rawBtn = $('sb-raw');
  const useRefsEl = $('sb-use-refs');

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
  // Beats per Director request.
  //
  // Ten was one all-or-nothing call. Measured against the live service a
  // ten-beat batch takes 60-85s, so a three-fold slowdown breaches the 240s
  // bound and takes every earlier batch down with it. Five halves the work in
  // flight, leaves headroom for a spike, and shows progress while it runs -
  // at the cost of one extra round of queueing latency.
  const SCENE_BATCH = 5;
  // A transient failure is worth exactly one more ask. See the loop below.
  const BATCH_ATTEMPTS = 2;
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
  /** Where a clip lives. The editor reads video from here, stills from String(index). */
  const clipKey = (index) => `clip:${index}`;

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
  // Re-entry guard for Analyze specifically. See analyzeAndGenerate().
  let analyzing = false;
  // The provider's raw reply from the last failure, for the "show raw response"
  // button. It was never declared: under 'use strict' the assignment in the
  // catch below threw a ReferenceError INSIDE the error handler, which
  // destroyed the real provider error and replaced it with a message about a
  // variable. Before Analyze had an outer catch, that turned every failed run
  // into an unhandled rejection - spinner still turning, nothing reported, no
  // way to tell a dead provider from a slow one.
  let lastRaw = '';
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

  // Merge adjacent subtitle cues into narrative story beats.
  //
  // The narration decides where the cuts fall, not a target length. minShotSec
  // is a FLOOR, not a target: a beat closes at the first sentence end AFTER it
  // has run that long, so its duration is whatever that sentence actually took.
  // Segments of 5.8s and 11.3s become beats of 5.8s and 11.3s.
  //
  // This used to be a target of 15s (Balanced), which read as a floor of 15s
  // because a beat could not close before reaching it. Every scene therefore
  // came out at roughly the pacing value regardless of what was being said, and
  // sentences were glued together to reach it. The cue timings were consulted
  // only to decide when the floor had been crossed - never to place the cut.
  //
  // The floor exists because a two-second sentence cannot hold a shot: it would
  // cost a stock lookup and a download for a cut the viewer barely registers.
  // Everything downstream - the excerpt window, the acquisition target
  // duration, the editor's clip length - reads the beat's timestamp, so this is
  // the single place that decides scene length for archive and modern stock
  // alike.
  //
  // minShotSec <= 0 means "no merging" (one image per subtitle line).
  function mergeCuesToBeats(rawCues, minShotSec) {
    if (!minShotSec || minShotSec <= 0 || rawCues.length <= 1) {
      return rawCues.map((c, i) => ({ ...c, index: i + 1 }));
    }
    const WORD_BUDGET = Math.round(minShotSec * 2.6); // ~2.6 spoken words/sec
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
      // How long the beat ALREADY is - not how long it would be with this cue
      // added. Measuring the candidate's end meant a two-second sentence closed
      // as its own beat whenever the next cue happened to reach past the floor,
      // which is how a shot far shorter than the minimum still got made.
      const spanBySec = cur.endS != null && cur.startS != null ? cur.endS - cur.startS : null;
      const overBySec = spanBySec != null && spanBySec >= minShotSec;
      const overByWords = spanBySec == null && cur.words >= WORD_BUDGET;

      // Only break where a sentence ends.
      //
      // Cutting purely on elapsed seconds splits mid-sentence, and the tail
      // becomes a beat of its own with no subject in it. Seen live: a 13s beat
      // ending "...television,.. anime,.." followed by a 2s beat reading
      // "unproduced and radio shows." The Director cannot picture that, so it
      // reaches for the topic of the passage and repeats the previous shot —
      // which is what a repeated visual intent actually was.
      //
      // A beat may run over budget to reach the end of a sentence; it may not
      // start halfway through one. The cap below still bounds the total.
      // A sentence ends with a word (or a closing quote) then terminal
      // punctuation. Fish writes its pause marker as a comma followed by
      // dots — "television,.." — so the character BEFORE the stop is what
      // separates a real sentence end from a breath.
      const endsSentence = /[A-Za-z0-9)"'\]]\s*[.!?]+["')\]]?\s*$/.test(cur.text.trim());
      // Do not hold a beat open forever chasing a full stop: some subtitle
      // tracks have none at all. Deliberately generous, because this is the one
      // path that cuts mid-sentence - the failure the sentence rule exists to
      // prevent. A real sentence almost never runs 18s, so in practice this
      // fires only for a track with no terminal punctuation anywhere.
      const wayOver = spanBySec != null && spanBySec >= Math.max(minShotSec * 4, 18);

      if ((overBySec || overByWords) && (endsSentence || wayOver)) {
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
    // Merge into story beats. The pacing control sets the SHORTEST shot worth
    // cutting to; the narration decides every cut after that.
    const minShotSec = densityEl ? Number(densityEl.value) : 4;
    cues = mergeCuesToBeats(rawCues, minShotSec);
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

  // A label that never changes cannot be told apart from a frozen page, and
  // this step legitimately takes minutes on the fallback provider — measured at
  // 20-44s for a trivial request and longer for a real script. Counting up is
  // the difference between "it is thinking" and "it has died".
  let analyzingTimer = null;

  function setAnalyzing(on, label) {
    analyzeBtn.disabled = on;
    analyzeSpinner.hidden = !on;

    if (analyzingTimer) { clearInterval(analyzingTimer); analyzingTimer = null; }

    if (!on) {
      analyzeLabel.textContent = 'Analyze & generate';
      return;
    }

    const text = label || 'Working…';
    const started = Date.now();
    const paint = () => {
      const secs = Math.round((Date.now() - started) / 1000);
      // Silent for the first few seconds, so a quick step does not flicker a
      // counter at the producer.
      analyzeLabel.textContent = secs < 4 ? text : `${text} ${secs}s`;
    };
    paint();
    analyzingTimer = setInterval(paint, 1000);
  }

  // How long Analyze will wait for the aligner before giving up on it.
  //
  // Finite on purpose. Alignment uploads the whole narration to Fish and can
  // legitimately take a couple of minutes, but a storyboard that sits forever
  // behind an endpoint that has gone away is the failure mode this feature is
  // most likely to introduce - so it is bounded, and running past the bound
  // costs the run nothing except measured timing.
  let autoAlignBudgetMs = 180000;

  function withDeadline(promise, ms, label) {
    let timer;
    const bell = new Promise((_, reject) => {
      timer = setTimeout(() => {
        const e = new Error(label);
        e.timedOut = true;
        reject(e);
      }, ms);
    });
    return Promise.race([promise, bell]).finally(() => clearTimeout(timer));
  }

  /**
   * Measure the narration before planning anything against it.
   *
   * Alignment existed and was wired end to end, but nothing ever ran it: the
   * only caller was the Re-align button. So every project planned against TTS
   * cues, whose per-part lengths are real but whose boundaries inside a part
   * are apportioned by character count - and the Director was told, correctly,
   * that nothing had been measured.
   *
   * Two things have to happen here, not one. Storing the transcript is what
   * gives the Director real word positions. Rewriting the project's subtitles
   * FROM that transcript is what makes the cuts follow it, because beats are
   * built from the cue list and nothing was regenerating the cue list -
   * Transcript.toSRT existed and had no callers at all. Aligning without that
   * second step would light up the badge and change none of the timings.
   *
   * Returns a short outcome for the caller to report. Never throws: a project
   * with no narration yet, an aligner that is down, or an alignment that comes
   * back too thin all mean "carry on with estimated timing", which is what the
   * whole pipeline did until now anyway.
   */
  async function autoAlign() {
    if (!window.BlvckAlign || !window.Transcript) return { ran: false, why: 'alignment unavailable' };

    let state = null;
    try { state = await window.BlvckAlign.status(); } catch (e) { state = null; }
    if (state && state.state === 'aligned') {
      return { ran: false, already: true, wordCount: state.wordCount };
    }
    if (state && state.state === 'unavailable') return { ran: false, why: state.reason };

    // 'none', 'estimated' and 'stale' are all worth measuring. Whether there is
    // any audio to measure is align()'s own question - asking it here would be
    // a second copy of collectNarration's rules, and the two would drift.
    setAnalyzing(true, 'Measuring the narration against the recorded audio…');
    try {
      const res = await withDeadline(
        window.BlvckAlign.align({ force: state && state.state === 'stale' }),
        autoAlignBudgetMs,
        `The aligner did not answer within ${Math.round(autoAlignBudgetMs / 1000)}s.`);

      // Now make the cues themselves measured, or nothing downstream changes.
      let cuesRewritten = false;
      try {
        const srt = window.Transcript.toSRT(res.transcript);
        if (srt && window.BlvckAssets) {
          window.BlvckAssets.setSubtitlesSRT(srt, 'whisper');
          // The storyboard holds its own copy of the imported file, and
          // buildContext reads that copy rather than the project store.
          files = files.filter((f) => !(f.kind === 'subtitles' && f.imported));
          files.push({ name: 'narration-aligned.srt', kind: 'subtitles',
                       content: srt, imported: true });
          renderFileList();
          cuesRewritten = true;
        }
      } catch (e) {
        // A measured transcript that will not render as subtitles is still
        // worth keeping for the Director's word positions.
        console.warn('[Storyboard] aligned, but could not rewrite the cues: ' + e.message);
      }
      return { ran: true, ok: true, wordCount: res.wordCount,
               audioDuration: res.audioDuration, cuesRewritten };
    } catch (err) {
      return { ran: true, ok: false, timedOut: !!err.timedOut, why: err.message };
    }
  }

  /** One plain sentence about what the aligner did, or why it did not. */
  function alignmentNote(a) {
    if (!a) return '';
    if (a.already) return ` Timing: already measured — ${a.wordCount} word timings.`;
    if (!a.ran) return '';
    if (a.ok) {
      return a.cuesRewritten
        ? ` Timing: measured — ${a.wordCount} word timings from ${Number(a.audioDuration || 0).toFixed(1)}s of audio, and the cuts follow them.`
        : ` Timing: measured — ${a.wordCount} word timings, but the cue list could not be rewritten, so the cuts still follow the estimate.`;
    }
    // A failure is not fatal and must not read as one, but it must not be
    // silent either: the difference between measured and estimated timing is
    // exactly what the user asked to be able to see.
    return a.timedOut
      ? ' Timing: still estimated — the aligner did not answer in time. Press Re-align to try again.'
      : ` Timing: still estimated — ${a.why}`;
  }

  async function analyzeAndGenerate() {
    // Two guards, because they cover different things. `running` is the stock
    // queue's flag and this function only ever READ it - it never set one of
    // its own, so nothing here was actually re-entrant-safe. The button being
    // disabled was doing that job by accident, and only from the moment
    // setAnalyzing(true) ran.
    //
    // That stopped being true when alignment moved to the front: autoAlign
    // awaits a status check that decodes the whole narration, and the button
    // sat live and clickable for all of it. A second click started a second
    // concurrent run - two sets of provider calls, two writes to the same
    // scenes array, and a wall-clock far past any single request's timeout.
    if (running || analyzing) return;
    analyzing = true;
    // Disabled before the first await, not after it.
    setAnalyzing(true, 'Preparing…');

    try {
      await analyzeAndGenerateInner();
    } catch (err) {
      // The inner function handles the failures it expects. Anything reaching
      // here is unexpected, and leaving the spinner running would present a
      // crash as work still in progress - which is exactly how a stuck
      // Storyboard has been reported before.
      console.error('[Storyboard] Analyze failed unexpectedly:', err);
      showStatus(`Analyze stopped: ${err && err.message ? err.message : err}`);
    } finally {
      analyzing = false;
      if (analyzeBtn && analyzeBtn.disabled) setAnalyzing(false);
    }
  }

  async function analyzeAndGenerateInner() {
    // Measure the narration FIRST. buildContext() turns the cue list into
    // beats, so an alignment that lands after it would have nothing to change.
    const aligned = await autoAlign();
    renderSignals();

    const ctx = buildContext();
    if (!cues.length) {
      showStatus('Upload a subtitle file (or a script) first.');
      setAnalyzing(false);
      return;
    }
    clearStatus();
    if (rawBtn) rawBtn.hidden = true;
    setAnalyzing(true, 'Analyzing the story & inferring visual style…');
    const onAttempt = (n, max) => { if (n > 1) setAnalyzing(true, `Reformatting response (attempt ${n} of ${max})…`); };
    try {
      // The story bible is no longer generated.
      //
      // It described a cast, locations and a diffusion-era visual style for a
      // pipeline that no longer exists: nothing in the stock/archive/editorial
      // flow reads the characters or the style, and the Director decides the
      // look from the narration itself. Generating it cost a model round trip
      // per storyboard and could rewrite AssetConsistency underneath the run.
      //
      // Whatever bible a previous project stored is still READ where it is
      // genuinely consumed — GraphicRenderer.paletteFor() for the editorial
      // cards, applyContinuity() across batch boundaries — and both handle its
      // absence. So this stops producing it without stranding anything.

      // Scene prompts in batches (with prior summaries for continuity).
      setAnalyzing(true, 'Reading the narration…');
      scenes = [];
      // A new storyboard reuses scene indices for entirely different content,
      // so every render record from the old one is now a lie: it reported
      // "canvas" for beats whose images had already been cleared, which made
      // unrendered scenes look finished and kept them out of the queue.
      if (window.BlvckLTX && window.BlvckLTX.reset) window.BlvckLTX.reset();
      // Measured: one batch is ~34s on the NIM fallback, and a full script is
      // several of them back to back. A label that says "Reading the
      // narration..." for four minutes is indistinguishable from a hang, and
      // was reported as one. Name the batch, so progress is visible even when
      // each step is slow.
      const totalBatches = Math.max(1, Math.ceil(cues.length / SCENE_BATCH));
      for (let i = 0; i < cues.length; i += SCENE_BATCH) {
        const batchNo = Math.floor(i / SCENE_BATCH) + 1;
        const label = totalBatches > 1
          ? `Reading the narration — part ${batchNo} of ${totalBatches}…`
          : 'Reading the narration…';
        setAnalyzing(true, label);
        const batch = cues.slice(i, i + SCENE_BATCH);
        const prior = scenes.slice(-3).map((s) => `${s.camera}: ${s.sceneSummary}`);

        // One slow moment must not discard a run that is minutes old.
        //
        // Measured against the live service: the same ten-beat batch came back
        // in 60s and in 83s, while a two-token request took 26s - almost all of
        // it queueing behind other work. The 240s bound is generous against
        // that, but a spike still breaches it, and losing every completed batch
        // because the last one was unlucky is the wrong trade when asking again
        // costs about a minute.
        //
        // Only for transient failures. A malformed or truncated reply fails the
        // same way twice, so retrying it just doubles the wait before the same
        // error.
        let res = null;
        for (let attempt = 1; attempt <= BATCH_ATTEMPTS && !res; attempt++) {
          try {
            res = await window.AIManager.generateJSON('/api/storyboard/scenes', {
              bible,
              cues: batch,
              style: ctx.style,
              instructions: ctx.instructions,
              priorSummaries: prior
            }, { onAttempt, task: 'storyboard' });
          } catch (e) {
            if (attempt >= BATCH_ATTEMPTS || !(e && e.transient)) throw e;
            console.warn(`[Storyboard] batch ${batchNo} was too slow (${e.message}); asking again`);
            setAnalyzing(true, `${label} the service was slow, asking again`);
          }
        }
        (res.scenes || []).forEach((s) => scenes.push({ ...s, status: 'pending', error: null }));
        renderScenes();
      }
      // Continuity across batch boundaries.
      if (window.BlvckPrompts && window.BlvckPrompts.applyContinuity) {
        scenes = window.BlvckPrompts.applyContinuity(scenes);
        renderScenes();
      }
      saveProject();
    } catch (err) {
      // Nothing in here may throw, or the handler loses the failure it exists
      // to report. Reading lastRawResponse goes through the provider manager,
      // which is exactly the subsystem that has just failed.
      try {
        lastRaw = (err && err.raw)
          || (window.AIManager && window.AIManager.lastRawResponse && window.AIManager.lastRawResponse())
          || '';
      } catch (e) {
        lastRaw = '';
      }
      if (rawBtn) rawBtn.hidden = !lastRaw;
      const cat = err && err.category ? ` [${err.category}]` : '';
      console.error('[Storyboard] Reading the narration failed:', err);
      showStatus(`${err.message}${cat}${lastRaw ? ' — check console for details.' : ''}`);
      setAnalyzing(false);
      return;
    }
    exportsEl.hidden = false;

    // 3. Plan the shots using the Director (previously LTX planner)
    let planned = null;
    if (window.BlvckLTX && window.BlvckLTX.planWithDirector) {
      try {
        setAnalyzing(true, 'Planning shots — deciding what each beat should be…');
        planned = await window.BlvckLTX.planWithDirector();
        renderScenes();
      } catch (err) {
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
        `${scenes.length} beat(s) planned as ${planned.mode || 'default'} — ${mix}.`
        + `${alignmentNote(aligned)} Fetching stock media...${warn}${ret}`,
        'info'
      );
    } else {
      showStatus(`${scenes.length} scenes planned.${alignmentNote(aligned)} `
        + 'Fetching stock media...', 'info');
    }

    runStockQueue();
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

  async function acquireSceneVisual(scene) {
    // ── 1. Canvas/graphic types ─────────────────────────────────────────────
    // Frames that are really about words are typeset on canvas — diffusion
    // models cannot spell, but the canvas renderer draws real text every time,
    // on brand, in milliseconds. Two ways a beat qualifies: the Director
    // planned it as a data visual (chart/map/timeline/whiteboard), or the
    // storyboard model itself gave it a graphic spec.
    const plannedCanvas = !!(window.BlvckLTX && window.BlvckLTX.rendersOnCanvas(scene));
    if (window.BlvckGraphic && (plannedCanvas || window.BlvckGraphic.looksLikeGraphic(scene))) {
      const spec = Object.assign(
        { kind: plannedCanvas ? scene.visualType : 'title' },
        scene.graphic || { title: scene.sceneSummary || scene.subtitle || '' }
      );
      return window.BlvckGraphic.render({
        ...spec,
        theme: graphicTheme(),
        palette: window.BlvckGraphic.paletteFor(bible)
      });
    }

    // ── 2. Editorial text (pure text card, no background footage) ───────────
    // Used when no stock footage can honestly illustrate the concept, or when
    // the beat is a pull quote / section title / abstract transition.
    if (scene.visualType === 'editorial_text') {
      const spec = scene.graphic || {};
      const ov   = scene.textOverlay || {};
      return window.BlvckGraphic.render({
        kind:     spec.kind     || 'title',
        title:    spec.title    || ov.text || scene.sceneSummary || scene.subtitle || '',
        subtitle: spec.subtitle || (ov.text && scene.detectedAction) || '',
        items:    spec.items    || [],
        value:    spec.value    || '',
        label:    spec.label    || '',
        theme:    graphicTheme(),
        palette:  window.BlvckGraphic.paletteFor(bible)
      });
    }

    // ── 3. Stock footage (primary production path) ──────────────────────────
    // Handles stock_video, stock_photo, stock_text, and the legacy t2v/broll
    // types which are now routed to the stock layer when StockMedia is
    // configured. No AI image/video generation API is called here.
    const isStockType  = ['stock_video', 'stock_photo', 'stock_text'].includes(scene.visualType);
    const isLegacyType = scene.visualType === 't2v' || scene.visualType === 'broll' || !scene.visualType;
    if (window.StockMedia && window.StockMedia.isConfigured() && (isStockType || isLegacyType)) {
      try {
        const provider = stockProviderEl ? stockProviderEl.value : 'all';
        const strategy = stockStrategyEl ? stockStrategyEl.value : 'auto';
        const blob = await window.StockMedia.acquire(scene, { provider, strategy });
        if (blob) {
          // If the scene calls for text OVER stock footage, composite it into a final image.
          if (scene.visualType === 'stock_text' && window.BlvckGraphic && window.BlvckGraphic.compositeOverlay) {
            const spec = scene.textOverlay || scene.graphic || {};
            if (!spec.kind) spec.kind = 'stat_overlay';
            spec.theme = graphicTheme();
            spec.palette = window.BlvckGraphic.paletteFor(bible);
            const compBlob = await window.BlvckGraphic.compositeOverlay(blob, spec);
            scene.assetType = 'image'; // The compositor produces a static PNG
            return compBlob;
          }
          return blob;
        }
      } catch (stockErr) {
        console.warn('[Storyboard] Stock acquire failed for scene ' + scene.index + ':', stockErr.message);
      }
      // Stock returned nothing or failed → fall to text+graphic (NOT AI gen).
      const ov  = scene.textOverlay || {};
      const gfx = scene.graphic     || {};
      return window.BlvckGraphic.render({
        kind:     gfx.kind     || 'title',
        title:    ov.text      || gfx.title    || scene.sceneSummary || scene.subtitle || 'Scene ' + scene.index,
        subtitle: gfx.subtitle || scene.detectedAction || '',
        items:    gfx.items    || [],
        theme:    graphicTheme(),
        palette:  window.BlvckGraphic.paletteFor(bible)
      });
    }

    // ── 4. Absolute text-only fallback ──────────────────────────────────────
    // Reached only when StockMedia is not configured
    return window.BlvckGraphic.render({
      kind:     'title',
      title:    scene.sceneSummary || scene.subtitle || 'Scene ' + scene.index,
      subtitle: scene.detectedAction || '',
      theme:    graphicTheme(),
      palette:  window.BlvckGraphic.paletteFor(bible)
    });
  }

  // Stock acquisition pacing
  const THROTTLE_MS = 600;

  async function runStockQueue() {
    if (running) return;
    running = true;
    paused = false;
    cancelRequested = false;
    progressWrap.hidden = false;
    updateControls();

    let quotaHit = false;
    for (const scene of scenes) {
      if (cancelRequested) break;
      
      // Skip if already done
      if (scene.status === 'done' && !scene.stockLocked) continue;
      
      while (paused && !cancelRequested) await sleep(200);
      if (cancelRequested) break;

      scene.status = 'generating';
      renderScenes();
      const t0 = performance.now();
      try {
        const blob = await acquireSceneVisual(scene);
        if (blob) {
            storeAsset(scene.index, blob);
        }
        scene.status = 'done';
        durations.push(performance.now() - t0);
      } catch (err) {
        if (err.quota) {
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
    renderScenes();
    const done = scenes.filter((s) => s.status === 'done').length;
    const remaining = scenes.filter((s) => s.status !== 'done').length;
    if (quotaHit) {
      showStatus(
        `API rate limit reached. ${done} of ${scenes.length} scenes fetched. ` +
          'Wait a moment for the rate limit to clear, then click “Continue”.'
      );
    } else if (cancelRequested) {
      showStatus('Cancelled. Completed scenes are saved.', 'info');
    } else if (remaining) {
      showStatus(`${remaining} scene(s) failed. Retry them individually.`);
    } else {
      showStatus(`Storyboard complete — ${scenes.length} scenes fetched.`, 'info');
    }
  }

  function storeAsset(index, blob) {
    memBlobs.set(index, blob);
    if (urls.has(index)) URL.revokeObjectURL(urls.get(index));
    urls.set(index, URL.createObjectURL(blob));

    // Video goes under the clip key, stills under the scene key.
    //
    // Everything went to the scene key, video included. The Storyboard reads
    // with the same branch it renders by, so the card looked right — real
    // footage, "cached locally, ready for export" — while the editor, which
    // loads video from clip:N, found nothing there and assembled a text card
    // in its place. The whole storyboard came out as typeset cards and a
    // stickman.
    const video = isVideoBlob(blob);
    idbPut(video ? clipKey(index) : String(index), blob);
    const scene = scenes.find((s) => s.index === index);
    if (scene) scene.assetType = video ? 'video' : 'image';
  }

  async function regenerateScene(scene) {
    if (running) {
      showStatus('Wait for the current run to finish, or pause it, before regenerating.');
      return;
    }
    scene.status = 'generating';
    renderScenes();
    try {
      const blob = await acquireSceneVisual(scene);
      if (blob) {
        storeAsset(scene.index, blob);
      }
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
    // The panel is gone from the workspace — it described a cast and a visual
    // style that no longer drive anything the producer can act on. The bible
    // DATA stays: GraphicRenderer.paletteFor() reads it for the editorial
    // cards, and applyContinuity() reads it across batch boundaries. So this
    // is a no-op rather than a deletion.
    if (!bibleEl) return;
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

  // --- Scene card ---------------------------------------------------------
  //
  // The card answers eight questions in the order a producer asks them:
  // what is said, what should be seen, which strategy, which library, which
  // asset, which part of it, may we use it, is it ready. Everything else —
  // licence URLs, archive identifiers, raw timings — lives behind a disclosure,
  // because a card that shows everything shows nothing.
  //
  // Nothing here decides anything. Rights come from RightsUI, credits from
  // AttributionManager, excerpt windows from ArchiveExcerpt, cache state from
  // the StockMedia events. This module arranges them.

  const STRATEGY_LABEL = {
    archival: 'Archival',
    modern_stock: 'Modern stock',
    auto: 'Either'
  };
  const SOURCE_LABEL = {
    archive_org: 'Internet Archive',
    pexels: 'Pexels',
    pixabay: 'Pixabay'
  };
  const TYPE_LABEL = {
    stock_video: 'Stock video',
    stock_photo: 'Stock photo',
    stock_text: 'Stock + text',
    editorial_text: 'Editorial graphic',
    chart: 'Chart', map: 'Map', timeline: 'Timeline', diagram: 'Diagram',
    whiteboard: 'Whiteboard', stickman: 'Stickman',
    t2v: 'Footage', broll: 'Footage', presenter: 'Presenter'
  };

  const clock = (s) => {
    const n = Math.max(0, Number(s) || 0);
    const m = Math.floor(n / 60);
    return `${String(m).padStart(2, '0')}:${(n - m * 60).toFixed(2).padStart(5, '0')}`;
  };

  function el(tag, cls, text) {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text != null) node.textContent = text;
    return node;
  }

  function field(label, node) {
    const wrap = el('div', 'sb-field');
    wrap.appendChild(el('div', 'sb-field-label', label));
    if (typeof node === 'string') wrap.appendChild(el('div', 'sb-field-value', node));
    else if (node) wrap.appendChild(node);
    return wrap;
  }

  function chip(text, kind) {
    return el('span', 'sb-chip' + (kind ? ' sb-chip-' + kind : ''), text);
  }

  /** Where this beat sits on the finished video's clock. */
  function sceneWindow(scene) {
    const a = Number(scene.timelineStart), b = Number(scene.timelineEnd);
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) {
      return { start: a, end: b, measured: true };
    }
    // Fall back to the cue timestamp, which is an estimate and is labelled so.
    const parts = String(scene.timestamp || '').split(/\s*-\s*/);
    const toSec = (t) => {
      const m = String(t || '').match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
      if (!m) return null;
      return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4] || 0) / 1000;
    };
    const s = toSec(parts[0]), e = toSec(parts[1]);
    if (s != null && e != null && e > s) return { start: s, end: e, measured: false };
    return null;
  }

  /** Q1 — what is being said, and do we actually know when. */
  function narrationBlock(scene) {
    const text = scene.subtitle || scene.sceneSummary || '';
    if (!text) return null;
    const wrap = field('Narration', el('div', 'sb-narration', text));
    const t = window.BlvckAlign && window.BlvckAlign.current();
    if (t && window.Transcript && window.Transcript.isMeasured(t)
        && Number.isFinite(Number(scene.timelineStart))) {
      wrap.querySelector('.sb-field-label').appendChild(chip('✓ Whisper aligned', 'ok'));
    }
    return wrap;
  }

  /** Q2 — what the Director thinks the viewer should see. */
  function intentBlock(scene) {
    const r = scene.stockRequirements || {};
    // The concept, not the prompt. Chain-of-thought never reaches the card.
    const intent = r.concept || scene.detectedAction || scene.visualGoal || '';
    if (!intent) return null;
    const wrap = field('Visual intent', el('div', 'sb-intent', intent));
    if (r.sourceReason) wrap.appendChild(el('div', 'sb-rationale', r.sourceReason));
    return wrap;
  }

  /** Q3 and Q4 — which strategy, and which library. */
  function strategyBlock(scene) {
    const r = scene.stockRequirements || {};
    const row = el('div', 'sb-chip-row');
    const type = TYPE_LABEL[scene.visualType] || scene.visualType || 'Footage';
    row.appendChild(chip(type, 'type'));
    if (r.sourceStrategy) {
      row.appendChild(chip(STRATEGY_LABEL[r.sourceStrategy] || r.sourceStrategy,
                           r.sourceStrategy === 'archival' ? 'archival' : 'modern'));
    }
    for (const s of r.preferredSources || []) {
      row.appendChild(chip(SOURCE_LABEL[s] || s, 'source'));
    }
    if (r.timePeriod) {
      const p = r.timePeriod;
      const label = p.label || [p.from, p.to].filter(Boolean).join('–');
      if (label) row.appendChild(chip(label, 'period'));
    }
    return row.children.length ? field('Strategy', row) : null;
  }

  /** What was actually searched for. Archive phrasing is shown separately
      because it is a different kind of query, not a variant of the same one. */
  function searchBlock(scene) {
    const r = scene.stockRequirements || {};
    const stock = r.queries || [];
    const archive = r.archiveQueries || [];
    if (!stock.length && !archive.length) return null;
    const list = el('ul', 'sb-queries');
    for (const q of archive) {
      const li = el('li', 'sb-query-archive', q);
      li.appendChild(chip('archive', 'source'));
      list.appendChild(li);
    }
    for (const q of stock.slice(0, archive.length ? 2 : 4)) list.appendChild(el('li', null, q));
    return field('Search', list);
  }

  /** Q6 — which part of the source is used. Two clocks, never conflated. */
  function excerptBlock(scene) {
    const asset = scene.stockAsset || {};
    const ex = asset.excerpt || (scene.stockRequirements || {}).excerpt || null;
    if (!ex) return null;

    const wrap = el('div', 'sb-excerpt');
    const applied = ex.applied || Number.isFinite(Number(ex.start));
    if (applied) {
      const inn = Number(ex.sourceIn != null ? ex.sourceIn : ex.start);
      const outn = Number(ex.sourceOut != null ? ex.sourceOut : ex.end);
      const table = el('div', 'sb-two-clocks');
      const src = el('div', 'sb-clock');
      src.appendChild(el('span', 'sb-clock-label', 'In the source film'));
      src.appendChild(el('span', 'sb-clock-value', `${clock(inn)} → ${clock(outn)}`));
      if (ex.sourceDuration) {
        src.appendChild(el('span', 'sb-clock-of', `of ${clock(ex.sourceDuration)}`));
      }
      const tl = el('div', 'sb-clock');
      tl.appendChild(el('span', 'sb-clock-label', 'In this video'));
      const w = sceneWindow(scene);
      tl.appendChild(el('span', 'sb-clock-value',
        w ? `${clock(w.start)} → ${clock(w.end)}` : 'not yet placed'));
      table.append(src, tl);
      wrap.appendChild(table);
    } else if (ex.selectionIntent) {
      wrap.appendChild(el('div', 'sb-field-value', 'Excerpt requested, not yet chosen.'));
    }

    if (ex.selectionIntent) {
      wrap.appendChild(el('div', 'sb-rationale', `Looking for: ${ex.selectionIntent}`));
    }
    // The system already records how the window was picked. Saying so is the
    // difference between a producer trusting it and checking it.
    if (ex.method === 'heuristic_window' || ex.reviewSuggested) {
      const warn = el('div', 'sb-warn',
        '⚠ Excerpt estimated — start point not selected by watching the footage.');
      wrap.appendChild(warn);
    } else if (ex.method) {
      wrap.appendChild(el('div', 'sb-ok-note', '✓ Excerpt chosen from the film’s own frames.'));
    }
    return field('Excerpt', wrap);
  }

  /** Q7 — may we use it. Rendered by RightsUI; nothing decided here. */
  function rightsBlock(scene) {
    if (!window.RightsUI || !window.RightsUI.sceneRightsHtml) return null;
    const html = window.RightsUI.sceneRightsHtml(scene);
    if (!html) return null;
    const host = el('div', 'sb-rights');
    host.innerHTML = html;
    return host;
  }

  /** The credit line, when one is owed, with somewhere to put it. */
  function attributionBlock(scene) {
    const AM = window.AttributionManager;
    if (!AM || !AM.forAsset) return null;
    const credit = AM.forAsset(scene.stockAsset);
    if (!credit) return null;

    const wrap = el('div', 'sb-attribution');
    const line = AM.onScreenLine ? AM.onScreenLine(scene.stockAsset) : '';
    const text = line || [credit.title, credit.creator && `by ${credit.creator}`,
                          credit.licenseName].filter(Boolean).join(' · ');
    wrap.appendChild(el('div', 'sb-credit', text));

    const actions = el('div', 'sb-inline-actions');
    const copy = el('button', 'btn ghost small', 'Copy attribution');
    copy.type = 'button';
    copy.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(text);
        copy.textContent = 'Copied';
        setTimeout(() => { copy.textContent = 'Copy attribution'; }, 1500);
      } catch (e) { copy.textContent = 'Copy failed'; }
    });
    const where = el('button', 'btn ghost small', 'Where it appears');
    where.type = 'button';
    where.addEventListener('click', () => {
      const desc = AM.youtubeDescription ? AM.youtubeDescription(scenes) : '';
      showRawResponse(desc || text);
    });
    actions.append(copy, where);
    wrap.appendChild(actions);
    return field('Attribution required', wrap);
  }

  /** The card the renderer will draw, and when. */
  function overlayBlock(scene) {
    const ov = scene.editorialOverlay;
    if (!ov || !ov.enabled) return null;
    const wrap = el('div', 'sb-overlay');
    wrap.appendChild(el('div', 'sb-overlay-text', ov.text || ''));
    wrap.appendChild(el('div', 'sb-field-value', `${clock(ov.start)} → ${clock(ov.end)}`));
    if (ov.method === 'spoken_phrase' && ov.anchoredTo) {
      wrap.appendChild(el('div', 'sb-rationale', `On the words "${ov.anchoredTo}".`));
    } else if (ov.method === 'shot_window') {
      wrap.appendChild(el('div', 'sb-rationale', 'Placed in the shot — the phrase was not found in the narration.'));
    }
    return field('Editorial overlay', wrap);
  }

  /**
   * A compact picture of the beat's clock.
   *
   * Deliberately not an editing surface: it answers "does the overlay land
   * inside the shot, and which slice of the film is this" at a glance, and
   * nothing more.
   */
  function timingBar(scene) {
    const w = sceneWindow(scene);
    if (!w) return null;
    const span = w.end - w.start;
    if (!(span > 0)) return null;

    const bar = el('div', 'sb-timing');
    const head = el('div', 'sb-timing-head');
    head.append(el('span', null, clock(w.start)), el('span', null, clock(w.end)));
    bar.appendChild(head);

    const lane = (label, from, to, cls) => {
      const row = el('div', 'sb-lane');
      row.appendChild(el('span', 'sb-lane-label', label));
      const track = el('div', 'sb-lane-track');
      const fill = el('div', 'sb-lane-fill' + (cls ? ' ' + cls : ''));
      const left = Math.max(0, Math.min(100, ((from - w.start) / span) * 100));
      const width = Math.max(1, Math.min(100 - left, ((to - from) / span) * 100));
      fill.style.left = left + '%';
      fill.style.width = width + '%';
      track.appendChild(fill);
      row.appendChild(track);
      return row;
    };

    bar.appendChild(lane('Narration', w.start, w.end, 'sb-lane-narration'));
    bar.appendChild(lane('Visual', w.start, w.end, 'sb-lane-visual'));
    const ov = scene.editorialOverlay;
    if (ov && ov.enabled && Number.isFinite(Number(ov.start))) {
      bar.appendChild(lane('Overlay', Number(ov.start), Number(ov.end), 'sb-lane-overlay'));
    }
    const ex = (scene.stockAsset || {}).excerpt;
    if (ex && (ex.applied || Number.isFinite(Number(ex.start)))) {
      const row = lane('Archive', w.start, w.end, 'sb-lane-archive');
      const inn = Number(ex.sourceIn != null ? ex.sourceIn : ex.start);
      const outn = Number(ex.sourceOut != null ? ex.sourceOut : ex.end);
      row.querySelector('.sb-lane-fill').textContent = `${clock(inn)} → ${clock(outn)}`;
      bar.appendChild(row);
    }
    if (!w.measured) {
      bar.appendChild(el('div', 'sb-rationale', 'Estimated from the cue list — narration not aligned.'));
    }
    return bar;
  }

  /** Everything a producer only wants when something looks wrong. */
  function detailsBlock(scene) {
    const asset = scene.stockAsset;
    if (!asset) return null;
    const box = el('details', 'sb-details');
    box.appendChild(el('summary', null, 'Asset details'));
    const dl = el('dl', 'sb-dl');
    const add = (k, v) => {
      if (v == null || v === '') return;
      dl.appendChild(el('dt', null, k));
      dl.appendChild(el('dd', null, String(v)));
    };
    add('Provider', asset.provider);
    add('Asset id', asset.id);
    const a = asset.archive || {};
    add('Archive item', a.identifier);
    add('Title', a.title);
    add('Creator', a.creator);
    add('Date', a.date);
    add('Collection', Array.isArray(a.collection) ? a.collection.join(', ') : a.collection);
    if (asset.duration) add('Duration', `${Number(asset.duration).toFixed(1)}s`);
    if (asset.width && asset.height) add('Resolution', `${asset.width}×${asset.height}`);
    add('Orientation', asset.orientation);
    if (asset.license) {
      add('Licence', asset.license.label || asset.license.tier);
      add('Licence URL', asset.license.licenseUrl);
    }
    add('Source page', asset.sourceUrl);
    if (asset.treatment) add('Framing', asset.treatment.note || asset.treatment.fit);
    if ((asset.queriesUsed || []).length) add('Queries used', asset.queriesUsed.join(' · '));
    if (asset.fallback) add('Fallback tier', asset.fallback);
    box.appendChild(dl);
    return box;
  }

  /** The media itself, which is what the card is actually about. */
  function mediaBlock(scene) {
    const url = urls.get(scene.index);
    const isVideo = sceneAssetType(scene) === 'video';
    const stage = el('div', 'sb-media');

    if (url && scene.status === 'done') {
      let thumb;
      if (isVideo) {
        thumb = document.createElement('video');
        thumb.className = 'sb-thumb sb-thumb-video';
        thumb.src = url;
        thumb.muted = true; thumb.loop = true; thumb.playsInline = true; thumb.controls = true;
        // 'metadata' loads duration but decodes no picture, so a rendered clip
        // shows as a black player until someone presses play.
        thumb.preload = 'auto';
        thumb.addEventListener('loadeddata', () => {
          if (thumb.currentTime === 0) {
            try { thumb.currentTime = 0.1; } catch { /* some codecs refuse an early seek */ }
          }
        }, { once: true });
      } else {
        thumb = document.createElement('img');
        thumb.className = 'sb-thumb';
        thumb.src = url;
        thumb.alt = `Scene ${scene.index}`;
      }
      thumb.style.cursor = 'zoom-in';
      thumb.title = 'Click to preview full size';
      thumb.addEventListener('click', (e) => {
        if (isVideo && e.target !== thumb) return;   // let the controls work
        if (isVideo) e.preventDefault();
        openPreview(scene, url, isVideo);
      });
      stage.appendChild(thumb);
    } else {
      const ph = el('div', 'sb-thumb-placeholder');
      ph.textContent = scene.status === 'generating' ? 'Finding media…'
                     : scene.status === 'error' ? 'No media'
                     : 'Queued';
      stage.appendChild(ph);
    }
    return stage;
  }

  /** Q8, per scene: what is stopping this beat reaching the export. */
  function sceneState(scene) {
    if (scene.status === 'error') return { label: 'Media error', kind: 'bad' };
    if (scene.status === 'generating') return { label: 'Searching', kind: 'busy' };
    if (scene.stockLocked) return { label: 'Locked', kind: 'ok' };

    const asset = scene.stockAsset;
    if (asset && asset.rightsStatus && !asset.rightsStatus.usable) {
      return asset.rightsStatus.humanReviewRequired
        ? { label: 'Needs review', kind: 'warn' }
        : { label: 'Rights blocked', kind: 'bad' };
    }
    if ((scene.editorialCandidates || []).length && !asset) {
      return { label: 'Needs review', kind: 'warn' };
    }
    if (scene.status !== 'done') return { label: 'Planning', kind: 'idle' };
    if (asset && asset.fallback) return { label: 'Fallback used', kind: 'warn' };
    return { label: 'Ready', kind: 'ok' };
  }

  function sceneActions(scene) {
    const bar = el('div', 'sb-scene-actions');

    const regen = el('button', 'btn ghost small', scene.status === 'error' ? 'Retry' : 'Search again');
    regen.type = 'button';
    regen.disabled = running || !!scene.stockLocked;
    regen.title = scene.stockLocked ? 'Unlock the clip first' : 'Search again with the Director’s queries';
    regen.addEventListener('click', () => regenerateScene(scene));
    bar.appendChild(regen);

    if (window.StockMedia && window.StockMedia.isConfigured()) {
      const replace = el('button', 'btn ghost small', 'Replace');
      replace.type = 'button';
      replace.disabled = running || !!scene.stockLocked;
      replace.addEventListener('click', async () => {
        const suggested = ((scene.stockRequirements || {}).queries || [])[0] || '';
        const q = prompt('Search for a replacement clip:', suggested);
        if (!q) return;
        scene.status = 'generating';
        renderScenes();
        try {
          const blob = await window.StockMedia.replaceClip(scene, q);
          if (blob) storeAsset(scene.index, blob);
          scene.status = 'done';
          scene.error = null;
        } catch (err) {
          scene.status = 'error';
          scene.error = err.message;
        }
        saveProject();
        renderScenes();
      });
      bar.appendChild(replace);
    }

    // Only where there is a film to take an excerpt from.
    const asset = scene.stockAsset;
    if (asset && asset.provider === 'archive_org' && window.ArchiveExcerpt) {
      const edit = el('button', 'btn ghost small', 'Edit excerpt');
      edit.type = 'button';
      edit.disabled = running;
      edit.addEventListener('click', () => editExcerpt(scene));
      bar.appendChild(edit);
    }

    const lock = el('label', 'sb-lock');
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = !!scene.stockLocked;
    box.disabled = running || (!scene.stockAsset && scene.status !== 'done');
    box.addEventListener('change', () => {
      scene.stockLocked = box.checked;
      saveProject();
      renderScenes();
    });
    lock.append(box, document.createTextNode('Lock'));
    lock.title = 'A locked clip keeps its asset, excerpt, rights and cache through a re-plan';
    bar.appendChild(lock);

    if (scene.status === 'done' && urls.get(scene.index)) {
      const ext = sceneAssetType(scene) === 'video' ? videoExt(memBlobs.get(scene.index)) : 'png';
      const dl = document.createElement('a');
      dl.className = 'sb-download';
      dl.href = urls.get(scene.index);
      dl.download = `${project()} Scene ${String(scene.index).padStart(2, '0')}.${ext}`;
      dl.textContent = 'Download';
      bar.appendChild(dl);
    }
    return bar;
  }

  /** Set In / Set Out against the existing excerpt logic. */
  async function editExcerpt(scene) {
    const asset = scene.stockAsset || {};
    const ex = asset.excerpt || {};
    const currentIn = Number(ex.sourceIn != null ? ex.sourceIn : ex.start) || 0;
    const currentOut = Number(ex.sourceOut != null ? ex.sourceOut : ex.end) || (currentIn + 6);

    const inn = prompt(
      `Set In — seconds into the source film (it runs ${Number(asset.duration || ex.sourceDuration || 0).toFixed(1)}s):`,
      String(currentIn));
    if (inn === null) return;
    const outn = prompt('Set Out — seconds into the source film:', String(currentOut));
    if (outn === null) return;

    try {
      const chosen = window.ArchiveExcerpt.setManualExcerpt({
        sourceDuration: Number(asset.duration || ex.sourceDuration || 0),
        sourceIn: Number(inn),
        sourceOut: Number(outn)
      });
      if (!chosen) throw new Error('That window does not fit inside the film.');
      scene.stockAsset = Object.assign({}, asset, { excerpt: chosen });
      saveProject();
      renderScenes();
      showStatus(`Scene ${scene.index}: excerpt set to ${clock(chosen.sourceIn != null ? chosen.sourceIn : chosen.start)}`
        + ` → ${clock(chosen.sourceOut != null ? chosen.sourceOut : chosen.end)}.`, 'info');
    } catch (err) {
      showStatus(`Could not set that excerpt: ${err.message}`);
    }
  }

  function renderScenes() {
    // A preview left open would point at a blob URL this re-render revokes.
    closePreview();
    scenesEl.innerHTML = '';

    scenes.forEach((scene) => {
      const state = sceneState(scene);
      const card = el('article', 'sb-scene sb-card' + (scene.status === 'generating' ? ' is-generating' : '')
        + (scene.status === 'error' ? ' is-error' : ''));

      // ── header ──────────────────────────────────────────────────────────
      const head = el('header', 'sb-card-head');
      const idBlock = el('div', 'sb-card-id');
      idBlock.appendChild(el('span', 'sb-scene-no', `SCENE ${String(scene.index).padStart(2, '0')}`));
      const w = sceneWindow(scene);
      if (w) {
        idBlock.appendChild(el('span', 'sb-scene-time',
          `${clock(w.start)} → ${clock(w.end)} · ${(w.end - w.start).toFixed(2)}s`));
      }
      head.appendChild(idBlock);
      head.appendChild(chip(state.label, state.kind));
      card.appendChild(head);

      // ── body: media on one side, the reasoning on the other ─────────────
      const body = el('div', 'sb-card-body');
      body.appendChild(mediaBlock(scene));

      const facts = el('div', 'sb-card-facts');
      for (const block of [narrationBlock(scene), intentBlock(scene), strategyBlock(scene),
                           searchBlock(scene), excerptBlock(scene), overlayBlock(scene)]) {
        if (block) facts.appendChild(block);
      }
      body.appendChild(facts);
      card.appendChild(body);

      const bar = timingBar(scene);
      if (bar) card.appendChild(bar);

      const rights = rightsBlock(scene);
      if (rights) card.appendChild(rights);
      const credit = attributionBlock(scene);
      if (credit) card.appendChild(credit);

      if (scene.stockAsset) card.appendChild(buildCacheRow(scene));

      const details = detailsBlock(scene);
      if (details) card.appendChild(details);

      if (scene.status === 'error' && scene.error) {
        card.appendChild(el('div', 'sb-error', scene.error.slice(0, 160)));
      }

      card.appendChild(sceneActions(scene));
      scenesEl.appendChild(card);
    });

    renderSummary();
    renderSignals();
    updateProgress();
    updateControls();
    auditCacheRows();
  }

  // --- Project summary ------------------------------------------------------
  //
  // Counted from the scenes on every render. Nothing here is configured or
  // remembered, so it cannot drift from what the cards show.

  let policyMounted = false;
  function mountRightsPolicy() {
    const host = $('sb-rights-policy');
    if (!host || policyMounted || !window.RightsUI || !window.RightsUI.policySelectorHtml) return;
    host.innerHTML = window.RightsUI.policySelectorHtml();
    window.RightsUI.bindPolicySelector(host);
    policyMounted = true;
  }

  function renderSummary() {
    mountRightsPolicy();
    const host = $('sb-summary');
    if (!host) return;
    if (!scenes.length) { host.hidden = true; return; }
    host.hidden = false;
    host.innerHTML = '';

    const byType = new Map();
    let cleared = 0, attribution = 0, review = 0, blocked = 0;
    for (const s of scenes) {
      const label = TYPE_LABEL[s.visualType] || 'Footage';
      byType.set(label, (byType.get(label) || 0) + 1);

      const asset = s.stockAsset;
      if (!asset) continue;
      const lic = asset.license || {};
      const verdict = asset.rightsStatus || {};
      if (verdict.humanReviewRequired) review++;
      else if (verdict.usable === false) blocked++;
      else if (lic.requiresAttribution) attribution++;
      else cleared++;
    }

    const group = (title, rows) => {
      const box = el('div', 'sb-summary-group');
      box.appendChild(el('div', 'sb-summary-title', title));
      for (const [k, v] of rows) {
        const line = el('div', 'sb-summary-row');
        line.append(el('span', 'sb-summary-count', String(v).padStart(2, '0')),
                    el('span', 'sb-summary-label', k));
        box.appendChild(line);
      }
      return box;
    };

    host.appendChild(group(`${scenes.length} scene${scenes.length === 1 ? '' : 's'}`,
                           [...byType.entries()].sort((a, b) => b[1] - a[1])));

    const rights = [['Cleared', cleared], ['Attribution required', attribution],
                    ['Review required', review]];
    if (blocked) rights.push(['Not cleared', blocked]);
    host.appendChild(group('Rights', rights));

    renderReadiness({ review, blocked });
  }

  /** Q8 for the project. Asks the export gate rather than re-deciding. */
  function renderReadiness(counts) {
    const host = $('sb-export-readiness');
    if (!host) return;
    const problems = [];

    // Ask the audit for the count rather than deriving one. Counting locally
    // produced "0 scenes not cleared for export", which is both wrong and
    // exactly the kind of statement that stops being believed.
    if (window.AttributionManager && window.AttributionManager.audit && window.RightsUI) {
      const report = window.AttributionManager.audit(scenes, window.RightsUI.currentPolicy());
      const n = (report.blockers || []).length;
      if (!report.canExport && n) {
        problems.push({ kind: 'bad', text: `${n} scene${n === 1 ? '' : 's'} not cleared for export` });
      } else if (!report.canExport) {
        problems.push({ kind: 'bad', text: 'Rights policy blocks this export' });
      }
    }
    void counts;
    const missing = scenes.filter((s) => s.status === 'error').length;
    if (missing) problems.push({ kind: 'bad', text: `${missing} scene${missing === 1 ? '' : 's'} with no media` });
    const pending = scenes.filter((s) => s.status !== 'done' && s.status !== 'error').length;
    if (pending) problems.push({ kind: 'warn', text: `${pending} scene${pending === 1 ? '' : 's'} still being fetched` });

    host.hidden = !scenes.length;
    host.innerHTML = '';
    if (!problems.length) {
      host.className = 'sb-readiness ok';
      host.appendChild(el('span', null, '✓ Ready for export'));
      return;
    }
    host.className = 'sb-readiness ' + (problems.some((p) => p.kind === 'bad') ? 'bad' : 'warn');
    host.appendChild(el('span', null, problems.map((p) => p.text).join(' · ')));
  }


  // --- Signals --------------------------------------------------------------
  //
  // Which brain is answering, and whether the narration timing can be trusted.
  // Both are read from the systems themselves on every render — a badge that
  // asserts "Whisper aligned" without asking is worse than no badge.

  async function renderSignals() {
    const host = $('sb-signals');
    if (!host) return;
    host.innerHTML = '';

    // Which Director.
    //
    // AIProviderManager already health-checks on DOMContentLoaded and repaints
    // every .ai-provider-status element, so this joins that mechanism instead
    // of running a second check — one definition of "is Qwen up", not two. The
    // initial text comes from the state it has already established, so a fresh
    // Storyboard does not sit on "checking…" waiting for an unrelated request.
    const mgr = window.AIManager;
    const brain = el('div', 'sb-signal ai-provider-status');
    const choice = mgr && mgr.providerChoice ? mgr.providerChoice() : 'auto';
    if (choice !== 'auto') {
      // Chosen in Settings. Nothing to discover, and nothing to wait for.
      brain.classList.add('ok');
    } else if (mgr && mgr.isQwenHealthy === true) {
      brain.classList.add('ok');
    } else if (mgr && mgr.isQwenHealthy === false) {
      brain.classList.add('warn');
    } else {
      brain.innerHTML = '○ Director — checking…';
    }
    host.appendChild(brain);
    // Let the manager write the text, so this badge cannot disagree with the
    // one in the header about which brain is in use — it painted its own copy
    // from isQwenHealthy, which says nothing about a provider chosen by hand.
    if (mgr && mgr.updateUIStatus) mgr.updateUIStatus();
    // Only worth asking when the answer decides something.
    if (choice === 'auto' && mgr && mgr.isQwenHealthy === null && mgr.checkHealth) {
      mgr.checkHealth().catch(() => {});
    }

    // Narration timing. `stale` is the one that matters: re-recorded audio
    // leaves timings describing something that no longer exists.
    const timing = el('div', 'sb-signal');
    if (window.BlvckAlign) {
      let state = null;
      try { state = await window.BlvckAlign.status(); } catch (e) { state = null; }
      if (!state || state.state === 'none') {
        timing.textContent = '○ Narration timing — not measured';
      } else if (state.state === 'stale') {
        timing.className = 'sb-signal warn';
        timing.textContent = '⚠ Narration timing stale — re-align required';
        const fix = el('button', 'btn ghost small', 'Re-align');
        fix.type = 'button';
        fix.addEventListener('click', () => realign());
        timing.appendChild(fix);
      } else if (state.state === 'aligned') {
        timing.className = 'sb-signal ok';
        timing.textContent = `✓ Whisper aligned — ${state.wordCount} word timings`;
      } else {
        timing.textContent = '○ Timing estimated from text, not measured';
        const fix = el('button', 'btn ghost small', 'Align narration');
        fix.type = 'button';
        fix.addEventListener('click', () => realign());
        timing.appendChild(fix);
      }
    }
    host.appendChild(timing);

    const fmt = $('sb-format-display');
    if (fmt && window.StockMedia && window.StockMedia.projectOrientation) {
      const o = window.StockMedia.projectOrientation();
      fmt.textContent = o === 'portrait' ? '9:16 Portrait'
                      : o === 'square' ? '1:1 Square' : '16:9 Landscape';
    }
  }

  /** Run the real alignment, and say plainly when it comes back short. */
  async function realign() {
    showStatus('Aligning the narration against the recorded audio…', 'info');
    try {
      const res = await window.BlvckAlign.align({ force: true });
      showStatus(`Narration aligned — ${res.wordCount} word timings from ${res.audioDuration.toFixed(1)}s of audio.`, 'info');
    } catch (err) {
      // The coverage guard rejects a partial alignment rather than storing it,
      // and a retry usually succeeds, so say that rather than just failing.
      showStatus(err.message);
    }
    renderSignals();
    renderScenes();
  }

  // --- Director progress ----------------------------------------------------
  //
  // A plan is minutes of work, batched one beat per request. A spinner for that
  // long reads as a hang, so this reports which beat and roughly how long is
  // left, from the measured pace of this run rather than a guess.

  let directorStartedAt = 0;

  window.addEventListener('blvck:director-progress', (ev) => {
    const d = (ev && ev.detail) || {};
    const host = $('sb-director-progress');
    if (!host) return;

    if (!directorStartedAt) directorStartedAt = Date.now();
    const done = Number(d.done) || 0;
    const total = Number(d.total) || 0;

    if (!total || done >= total) {
      host.hidden = true;
      directorStartedAt = 0;
      return;
    }

    host.hidden = false;
    host.innerHTML = '';
    const head = el('div', 'sb-dp-head');
    head.appendChild(el('span', null, 'Generating visual plan'));
    head.appendChild(el('span', null, `Beat ${done + 1} of ${total}`));
    host.appendChild(head);

    const track = el('div', 'sb-dp-track');
    const fill = el('div', 'sb-dp-fill');
    fill.style.width = Math.round((done / total) * 100) + '%';
    track.appendChild(fill);
    host.appendChild(track);

    // Estimated from this run's own pace once there is a beat to measure. A
    // beat has taken anywhere from 116s to 296s, so a fixed estimate would be
    // wrong in both directions.
    let note = 'The Director is working. You can keep using the rest of AETHER.';
    if (done > 0) {
      const perBeat = (Date.now() - directorStartedAt) / done;
      const left = Math.round((perBeat * (total - done)) / 60000);
      if (left >= 1) note = `About ${left} minute${left === 1 ? '' : 's'} left. ` + note;
    }
    host.appendChild(el('div', 'sb-dp-note', note));
  });

  // --- Local cache status -------------------------------------------------
  //
  // Export refuses to record until every clip is cached locally. Without this
  // the storyboard looks finished while the export button is about to say no,
  // and a 90 MB archival download would run with no visible progress.

  // sceneIndex -> { pct, received, total } while a download is in flight.
  const downloading = new Map();

  function cacheKeyFor(scene) {
    const sa = scene && scene.stockAsset;
    return sa && sa.provider && sa.id ? `${sa.provider}:${sa.id}` : null;
  }

  function buildCacheRow(scene) {
    const row = document.createElement('div');
    row.className = 'sb-scene-insight';
    row.dataset.cacheRow = String(scene.index);
    paintCacheRow(row, scene, downloading.has(scene.index) ? 'downloading' : 'unknown');
    return row;
  }

  function paintCacheRow(row, scene, state) {
    row.innerHTML = '';
    const label = document.createElement('span');

    if (state === 'downloading') {
      const p = downloading.get(scene.index) || {};
      const mb = p.total ? ` of ${(p.total / 1048576).toFixed(0)} MB` : '';
      label.innerHTML = `<strong>Local cache:</strong> downloading `
        + `${p.pct == null ? '' : p.pct + '% '}`
        + `<span style="color:#9aa4b2">(${((p.received || 0) / 1048576).toFixed(1)} MB${mb})</span>`;
      row.appendChild(label);
      return;
    }

    if (state === 'cached') {
      label.innerHTML = '<strong>Local cache:</strong> '
        + '<span style="color:var(--success,#3ddc84)">cached locally · ready for export</span>';
      row.appendChild(label);
      return;
    }

    if (state === 'missing') {
      label.innerHTML = '<strong>Local cache:</strong> '
        + '<span style="color:var(--warning)">not cached — export is blocked until it is</span>';
      row.appendChild(label);
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = 'Download now';
      btn.style.cssText = 'margin-left:8px;font-size:0.72rem;padding:2px 8px';
      btn.addEventListener('click', () => cacheSceneAsset(scene, btn));
      row.appendChild(btn);
      return;
    }

    label.innerHTML = '<strong>Local cache:</strong> <span style="color:#9aa4b2">checking…</span>';
    row.appendChild(label);
  }

  function rowFor(index) {
    return scenesEl.querySelector(`[data-cache-row="${index}"]`);
  }

  async function auditCacheRows() {
    if (!window.StockMedia || !window.StockMedia.isCached) return;
    for (const scene of scenes) {
      if (!cacheKeyFor(scene)) continue;
      const row = rowFor(scene.index);
      if (!row) continue;
      if (downloading.has(scene.index)) { paintCacheRow(row, scene, 'downloading'); continue; }
      const ok = await window.StockMedia.isCached(scene.stockAsset);
      const live = rowFor(scene.index);              // the list may have re-rendered
      if (live) paintCacheRow(live, scene, ok ? 'cached' : 'missing');
    }
  }

  // Downloading is placement. An asset that has not cleared the rights policy
  // must not land in the production cache just because someone pressed a button
  // next to it — the same gate acquire() applies, applied here too rather than
  // reimplemented.
  async function cacheSceneAsset(scene, btn) {
    const asset = scene.stockAsset;
    if (!asset || !window.StockMedia) return;

    if (window.StockMedia.clearForProduction
        && !window.StockMedia.clearForProduction(asset, scene)) {
      const row = rowFor(scene.index);
      if (row) {
        row.innerHTML = '';
        const s = document.createElement('span');
        s.innerHTML = '<strong>Local cache:</strong> '
          + '<span style="color:var(--danger)">not downloaded — this source has not cleared '
          + 'the project’s rights policy</span>';
        row.appendChild(s);
      }
      saveProject();
      return;
    }

    if (btn) btn.disabled = true;
    downloading.set(scene.index, { pct: null, received: 0, total: 0 });
    const row = rowFor(scene.index);
    if (row) paintCacheRow(row, scene, 'downloading');

    try {
      await window.StockMedia.downloadAsset(asset);
      downloading.delete(scene.index);
      const live = rowFor(scene.index);
      if (live) paintCacheRow(live, scene, 'cached');
    } catch (err) {
      downloading.delete(scene.index);
      const live = rowFor(scene.index);
      if (live) {
        live.innerHTML = '';
        const s = document.createElement('span');
        s.innerHTML = `<strong>Local cache:</strong> `
          + `<span style="color:var(--danger)">download failed: ${esc(String(err.message).slice(0, 90))}</span>`;
        live.appendChild(s);
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Retry';
        retry.style.cssText = 'margin-left:8px;font-size:0.72rem;padding:2px 8px';
        retry.addEventListener('click', () => cacheSceneAsset(scene, retry));
        live.appendChild(retry);
      }
    }
  }

  window.addEventListener('blvck:asset-progress', (ev) => {
    const d = (ev && ev.detail) || {};
    const scene = scenes.find((s) => cacheKeyFor(s) === d.cacheKey);
    if (!scene) return;
    if (d.done) {
      downloading.delete(scene.index);
      const row = rowFor(scene.index);
      if (row) paintCacheRow(row, scene, 'cached');
      return;
    }
    downloading.set(scene.index, { pct: d.pct, received: d.received, total: d.total });
    const row = rowFor(scene.index);
    if (row) paintCacheRow(row, scene, 'downloading');
  });

  window.addEventListener('blvck:asset-cached', (ev) => {
    const d = (ev && ev.detail) || {};
    const scene = scenes.find((s) => cacheKeyFor(s) === d.cacheKey);
    if (!scene) return;
    downloading.delete(scene.index);
    const row = rowFor(scene.index);
    if (row) paintCacheRow(row, scene, 'cached');
  });

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
      // The transcript is written by the alignment bridge, not by this module,
      // and it is the thing editor.js reads to decide whether the project is on
      // a measured clock. Rebuilding this payload from scratch used to delete it
      // on the very next save, so alignment could succeed and be gone a moment
      // later. Carry through whatever is already stored rather than assuming
      // this module knows every key.
      let existing = null;
      try { existing = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { existing = null; }

      localStorage.setItem(
        LS_KEY,
        JSON.stringify(Object.assign({}, existing, {
          project: project(),
          cues,
          bible,
          assetMode,
          useRefs: useRefsEl ? useRefsEl.checked : true,
          scenes: scenes.map(({ ...s }) => s)
        }))
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
  restoreControls();
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
      // 3. Kick off the stock acquisition queue immediately.
      // (The user can replace or search again later).
      if (!cancelRequested) {
        runStockQueue();
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
    /** The live scene list.
     *
     *  A later stage - the Renderer decides what goes ON a beat once its
     *  picture exists - has to write onto THESE objects, not onto a copy read
     *  out of localStorage. saveProject() rebuilds the stored scenes from this
     *  array every time, so anything written only to storage is erased by the
     *  next save from anywhere. That is how the transcript used to disappear. */
    scenes: () => scenes,
    /** Persist what a later stage just wrote onto those scenes. */
    save: () => saveProject(),
    /** What this specific scene should produce: 'image' or 'video'. */
    assetTypeFor: (scene) => sceneAssetType(scene || {}),
    /** Render one scene's still (or canvas card) exactly as the storyboard does. */
    generateStill: (scene) => generateSceneAsset(scene),
    /** How long Analyze will wait for the aligner. Exported so a test can
        prove the bound holds without sitting through the real one. */
    autoAlignBudgetMs: () => autoAlignBudgetMs,
    _setAutoAlignBudget: (ms) => { autoAlignBudgetMs = Number(ms) || autoAlignBudgetMs; },
    /** Persist a rendered asset against a scene, so it appears on the card. */
    attachAsset: async (scene, blob, kind) => {
      // Same convention as storeAsset: the editor reads video from clip:N.
      const video = kind === 'video' || isVideoBlob(blob);
      await idbPut(video ? clipKey(scene.index) : String(scene.index), blob);
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
