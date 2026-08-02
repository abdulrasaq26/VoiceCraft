(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const card = $('editor-card');
  const assembleBtn = $('ed-assemble');
  const summaryEl = $('ed-summary');
  const statusEl = $('ed-status');
  const stage = $('ed-stage');
  const canvas = $('ed-canvas');
  const ctx = canvas.getContext('2d');
  const playBtn = $('ed-play');
  const seek = $('ed-seek');
  const timeLabel = $('ed-time');
  const timelineEl = $('ed-timeline');
  const subFont = $('ed-sub-font');
  const subSize = $('ed-sub-size');
  const subSizeVal = $('ed-sub-size-val');
  const subPos = $('ed-sub-pos');
  const subColor = $('ed-sub-color');
  const subOn = $('ed-sub-on');
  const resSel = $('ed-res');
  const exportVideoBtn = $('ed-export-video');
  const exportPkgBtn = $('ed-export-package');
  const titleInput = $('title-input');
  const upImages = $('ed-up-images');
  const upAudio = $('ed-up-audio');
  const upSubs = $('ed-up-subs');
  const buildManualBtn = $('ed-build-manual');
  const manualToggle = $('ed-manual-toggle');
  const manualPanel = $('ed-manual');
  const crossfadeToggle = $('ed-crossfade');

  const SB_LS = 'blvck-tts:storyboard';
  const SB_DB = 'blvck-storyboard';
  const SB_STORE = 'images';
  const AUDIO_LS = 'blvck-tts:batch';
  const AUDIO_DB = 'blvck-tts';
  const AUDIO_STORE = 'audio';
  const ED_LS = 'blvck-tts:editor';
  // Manually-uploaded narration lives in its own store so it's part of the
  // project snapshot without clashing with generated TTS audio.
  const MANUAL_DB = 'blvck-editor';
  const MANUAL_STORE = 'audio';
  const MANUAL_KEY = 'narration';

  const EFFECTS = ['zoom-in', 'zoom-out', 'push-in', 'pull-back', 'pan-left', 'pan-right', 'drift', 'focus-shift'];
  const EFFECT_LABELS = {
    'zoom-in': 'Zoom in',
    'zoom-out': 'Zoom out',
    'push-in': 'Push in',
    'pull-back': 'Pull back',
    'pan-left': 'Pan left',
    'pan-right': 'Pan right',
    drift: 'Drift',
    'focus-shift': 'Focus shift'
  };

  let clips = []; // { sceneIndex, subtitle, camera, durationSec, effect, img }
  const subStyle = { font: 'Arial, sans-serif', size: 42, pos: 'bottom', color: '#ffffff', on: true };
  let transitionsOn = true;
  const TRANSITION_MS = 500; // default crossfade duration between scenes
  let audio = { buffers: [], offsets: [], totalMs: 0 };

  // Playback state
  let playing = false;
  // True whenever the timeline is advancing on its own — preview playback OR
  // the real-time export recording. Video clips play through in that regime and
  // seek frame-exactly outside it.
  let realtime = false;
  let rafId = 0;
  let clockStart = 0;
  let offsetMs = 0;
  let audioCtx = null;
  let activeSources = [];

  function showStatus(msg, type = 'error') {
    statusEl.textContent = msg;
    statusEl.className = `status ${type}`;
    statusEl.hidden = false;
  }
  const clearStatus = () => (statusEl.hidden = true);

  function project() {
    const raw = (titleInput && titleInput.value ? titleInput.value : 'Video').trim();
    return raw.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Video';
  }

  // --- IndexedDB (read-only, cross-module) -------------------------------

  function idbGet(dbName, store, key) {
    return new Promise((resolve) => {
      let req;
      try {
        req = indexedDB.open(dbName);
      } catch {
        return resolve(null);
      }
      req.onsuccess = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(store)) {
          db.close();
          return resolve(null);
        }
        const tx = db.transaction(store, 'readonly');
        const rq = tx.objectStore(store).get(key);
        rq.onsuccess = () => {
          const v = rq.result || null;
          db.close();
          resolve(v);
        };
        rq.onerror = () => {
          db.close();
          resolve(null);
        };
      };
      req.onerror = () => resolve(null);
    });
  }

  // Write a blob, creating the store (and bumping the DB version) if needed.
  async function idbPut(dbName, store, key, blob) {
    function rawOpen(version) {
      return new Promise((resolve, reject) => {
        const req = version ? indexedDB.open(dbName, version) : indexedDB.open(dbName);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains(store)) req.result.createObjectStore(store);
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    try {
      let db = await rawOpen();
      if (!db.objectStoreNames.contains(store)) {
        const v = db.version + 1;
        db.close();
        db = await rawOpen(v);
      }
      await new Promise((res, rej) => {
        const tx = db.transaction(store, 'readwrite');
        tx.objectStore(store).put(blob, key);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    } catch {
      /* best effort */
    }
  }

  async function nextManualKey() {
    // Continue numbering after any existing scene image keys.
    let max = 0;
    try {
      const db = await new Promise((resolve, reject) => {
        const req = indexedDB.open(SB_DB);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
      if (db.objectStoreNames.contains(SB_STORE)) {
        const keys = await new Promise((resolve) => {
          const out = [];
          const rq = db.transaction(SB_STORE, 'readonly').objectStore(SB_STORE).openKeyCursor();
          rq.onsuccess = () => {
            const c = rq.result;
            if (c) {
              out.push(c.key);
              c.continue();
            } else resolve(out);
          };
          rq.onerror = () => resolve(out);
        });
        for (const k of keys) {
          const n = parseInt(String(k).replace(/\D/g, ''), 10);
          if (Number.isFinite(n)) max = Math.max(max, n);
        }
      }
      db.close();
    } catch {
      /* ignore */
    }
    return max;
  }

  // --- Timeline math -----------------------------------------------------

  function hmsToSec(s) {
    if (!s) return 0;
    const str = String(s).trim();
    const parts = str.split(':').map((p) => parseFloat(p) || 0);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    if (parts.length === 1 && !isNaN(parts[0])) return parts[0];
    return 0;
  }
  function clipDuration(ts) {
    if (!ts) return 15;
    const parts = String(ts).split(/\s*-\s*/);
    if (parts.length < 2) return 15;
    const d = hmsToSec(parts[1]) - hmsToSec(parts[0]);
    return d >= 1 ? d : 15;
  }
  function autoEffect(i, camera) {
    const c = (camera || '').toLowerCase();
    if (c.includes('close') || c.includes('object')) return i % 2 ? 'push-in' : 'zoom-in';
    if (c.includes('wide') || c.includes('environment') || c.includes('establish')) return i % 2 ? 'zoom-out' : 'pull-back';
    if (c.includes('crowd')) return 'pan-right';
    return EFFECTS[i % EFFECTS.length];
  }
  function totalMs() {
    const clipsTotal = clips.reduce((a, c) => a + c.durationSec * 1000, 0);
    return Math.max(clipsTotal, audio.totalMs || 0);
  }
  function clipAt(ms) {
    if (!clips.length) return null;
    let acc = 0;
    for (const c of clips) {
      const end = acc + c.durationSec * 1000;
      if (ms < end) return { clip: c, localMs: ms - acc, startMs: acc };
      acc = end;
    }
    const clipsLen = clips.reduce((a, c) => a + c.durationSec * 1000, 0) || 1;
    const cycledMs = ms % clipsLen;
    let acc2 = 0;
    for (const c of clips) {
      const end = acc2 + c.durationSec * 1000;
      if (cycledMs < end) return { clip: c, localMs: cycledMs - acc2, startMs: acc2 };
      acc2 = end;
    }
    const last = clips[clips.length - 1];
    return last ? { clip: last, localMs: last.durationSec * 1000, startMs: acc - last.durationSec * 1000 } : null;
  }

  // --- Assembly ----------------------------------------------------------

  function loadImage(blob) {
    return new Promise((resolve) => {
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }

  // Decode an LTX clip into a seekable, muted video element. Muted + playsInline
  // matters: the narration is mixed separately, and an unmuted element would
  // double up any audio LTX emitted.
  function loadVideo(blob) {
    return new Promise((resolve, reject) => {
      const v = document.createElement('video');
      v.muted = true;
      v.playsInline = true;
      v.preload = 'auto';
      v.src = URL.createObjectURL(blob);
      const fail = () => reject(new Error('could not decode clip'));
      v.onerror = fail;
      // loadeddata alone can fire before duration is known for fragmented mp4.
      v.onloadeddata = () => {
        if (v.readyState >= 2) resolve(v);
        else v.oncanplay = () => resolve(v);
      };
    });
  }

  async function loadAudio(forceBatch = false) {
    audio = { buffers: [], offsets: [], totalMs: 0 };
    const ctx = () => (audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)());

    // 1. Manually uploaded narration takes priority unless forceBatch is true.
    if (!forceBatch) {
      const manual = await idbGet(MANUAL_DB, MANUAL_STORE, MANUAL_KEY);
      if (manual) {
        try {
          const buf = await ctx().decodeAudioData(await manual.arrayBuffer());
          audio.buffers = [buf];
          audio.offsets = [0];
          audio.totalMs = buf.duration * 1000;
          return;
        } catch {}
      }
    }

    // 2. Otherwise load ALL items from the generated TTS audio batch.
    let meta;
    try {
      meta = JSON.parse(localStorage.getItem(AUDIO_LS) || 'null');
    } catch {
      meta = null;
    }
    if (!meta || !meta.items) return;
    let acc = 0;
    for (const item of meta.items) {
      let blob = await idbGet(AUDIO_DB, AUDIO_STORE, `${meta.id}:${item.index}`);
      if (!blob) blob = await idbGet(AUDIO_DB, AUDIO_STORE, String(item.index));
      if (!blob) continue;
      try {
        const buf = await ctx().decodeAudioData(await blob.arrayBuffer());
        audio.buffers.push(buf);
        audio.offsets.push(acc);
        acc += buf.duration * 1000;
      } catch {}
    }
    audio.totalMs = acc;
  }

  // Stretch/squeeze the picture track so it ends with the narration.
  // Returns the drift in ms that was corrected (0 when already in sync, or
  // when there is no narration to sync against). Clip minimums are applied
  // first, then any residual is absorbed by the last clip so the total lands
  // exactly on the audio length rather than merely close to it.
  function rescaleClipsToAudio() {
    if (!audio || !audio.totalMs || !clips.length) return 0;
    const target = audio.totalMs;
    const current = clips.reduce((a, c) => a + c.durationSec * 1000, 0);
    if (!current) return 0;
    // Ignore sub-second differences — not worth reporting or touching.
    const drift = target - current;
    if (Math.abs(drift) < 1000) return 0;

    const factor = target / current;
    for (const c of clips) c.durationSec = Math.max(1, c.durationSec * factor);
    // The Math.max(1, …) floor can push the total back over target on very
    // short clips, so settle whatever is left over.
    let rem = (target - clips.reduce((a, c) => a + c.durationSec * 1000, 0)) / 1000;
    if (rem > 0.01) {
      // Growing has no upper bound; the tail clip can take it all.
      clips[clips.length - 1].durationSec += rem;
    } else if (rem < -0.01) {
      // Shrinking: only clips above the 1s floor have time to give back, and
      // no single clip is guaranteed to hold the whole remainder. Take from
      // each in proportion to its headroom so nothing crosses the floor.
      for (let pass = 0; pass < 8 && rem < -0.01; pass++) {
        const avail = clips.reduce((a, c) => a + Math.max(0, c.durationSec - 1), 0);
        if (avail <= 0.01) break; // genuinely cannot be shortened any further
        const take = Math.min(-rem, avail);
        for (const c of clips) {
          const head = Math.max(0, c.durationSec - 1);
          if (head > 0) c.durationSec -= take * (head / avail);
        }
        rem += take;
      }
    }
    for (const c of clips) c.durationSec = Math.round(c.durationSec * 1000) / 1000;
    return drift;
  }

  // Parse SRT/VTT into [{ durationSec, text }].
  function parseSubs(content) {
    const text = String(content).replace(/^﻿/, '').replace(/\r/g, '');
    const re = /(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})\s*-->\s*(\d{1,2}:\d{2}:\d{2}[.,]\d{1,3})[^\n]*\n([\s\S]*?)(?=\n\s*\n|\n*$)/g;
    const toSec = (t) => {
      const m = t.match(/(\d{1,2}):(\d{2}):(\d{2})[.,](\d{1,3})/);
      return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] + +m[4] / 1000 : 0;
    };
    const out = [];
    let m;
    while ((m = re.exec(text))) {
      const body = m[3]
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l && !/^\d+$/.test(l) && !/-->/.test(l))
        .join(' ')
        .trim();
      const dur = toSec(m[2]) - toSec(m[1]);
      out.push({ durationSec: dur > 0 ? dur : 4, text: body });
    }
    return out;
  }

  async function buildFromManual() {
    clearStatus();
    const imageFiles = [...(upImages.files || [])].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
    if (!imageFiles.length) {
      showStatus('Add at least one image — images become the scenes.');
      return;
    }
    buildManualBtn.disabled = true;
    summaryEl.textContent = 'Building…';

    // Subtitles → per-scene timing + captions.
    let cues = [];
    if (upSubs.files && upSubs.files[0]) {
      cues = parseSubs(await upSubs.files[0].text());
    }

    // Manual audio → dedicated store.
    if (upAudio.files && upAudio.files[0]) {
      await idbPut(MANUAL_DB, MANUAL_STORE, MANUAL_KEY, upAudio.files[0]);
    }

    let base = await nextManualKey();
    clips = [];
    for (let i = 0; i < imageFiles.length; i++) {
      const f = imageFiles[i];
      const key = `manual-${++base}`;
      await idbPut(SB_DB, SB_STORE, key, f);
      const img = await loadImage(f);
      const cue = cues[i];
      clips.push({
        sceneIndex: key,
        subtitle: cue ? cue.text : '',
        camera: '',
        durationSec: cue ? Math.min(30, Math.max(1, cue.durationSec)) : 4,
        effect: autoEffect(i, ''),
        img
      });
    }

    await loadAudio();
    await loadHost();
    // Same guarantee as the storyboard path: if there were fewer cues than
    // images (the 4s fallback above) the picture track would otherwise end
    // nowhere near the narration.
    rescaleClipsToAudio();
    buildManualBtn.disabled = false;
    stage.hidden = false;
    offsetMs = 0;
    saveTimeline();
    renderTimeline();
    drawFrame(0);
    const secs = Math.round(totalMs() / 1000);
    summaryEl.textContent = `${clips.length} scenes · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}${
      audio.totalMs ? ' · narration loaded' : ' · no audio'
    }`;
    showStatus('Timeline built from your uploads. Press play to preview, then export.', 'info');
    // Clear the file inputs so re-building doesn't double-add.
    upImages.value = '';
    upAudio.value = '';
    upSubs.value = '';
  }

  async function assemble() {
    clearStatus();
    let sb;
    try {
      sb = JSON.parse(localStorage.getItem(SB_LS) || 'null');
    } catch {
      sb = null;
    }
    // Scenes come from the Scene Engine, not from the storyboard specifically.
    // Assembly never needed a storyboard: it needs index, timestamp, subtitle
    // and an asset. The old guard defended the only DOOR to the scenes array,
    // not a real requirement — so a procedural project with narration but no
    // storyboard was blocked for no reason.
    let scenes = (sb && sb.scenes) || [];
    if (!scenes.length && window.BlvckScenes) {
      const made = await window.BlvckScenes.ensureScenes();
      scenes = made.scenes;
      if (made.created) {
        showStatus(`Built ${scenes.length} scene(s) from the narration timeline — no storyboard needed.`, 'info');
      }
    }
    if (!scenes.length) {
      showStatus('Nothing to assemble yet. Generate narration (or a storyboard) first — scenes are built from either.');
      return;
    }
    // Deliberately NOT gated on scenes having stills. A text-to-video project
    // never generates any, and a canvas beat writes its image without the
    // scene's status ever becoming 'done'. Whether there is anything to show is
    // decided below, from what actually loaded.
    assembleBtn.disabled = true;
    summaryEl.textContent = 'Assembling…';

    clips = [];
    // Walk EVERY scene, not only the ones that produced an image. A scene's
    // timestamp is its slice of the real narration, so skipping a failed scene
    // used to delete that slice from the video while the audio still played
    // it — every picture after the gap then ran early against the voice, for
    // the rest of the video. Instead, hold the neighbouring image across the
    // gap so picture and audio stay locked to the same clock.
    let heldSec = 0;
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i];
      const secs = Math.max(1, clipDuration(s.timestamp));
      // Ask storage, don't trust the label: a canvas-rendered chart writes its
      // image without ever flipping the scene's status to 'done'.
      const blob = await idbGet(SB_DB, SB_STORE, String(s.index));
      let img = null;
      if (blob) {
        try {
          img = await loadImage(blob);
        } catch {
          img = null;
        }
      }
      // Prefer a rendered LTX clip over the still. The still stays attached as
      // a fallback so a video that fails to decode still shows something rather
      // than a black hole in the timeline.
      // A long beat is rendered as several clips under the same scene index —
      // cheaper on the GPU and better paced. Load every part; each becomes its
      // own cut, sharing the beat's narration slot between them.
      const videos = [];
      for (let part = 0; part < 12; part++) {
        const key = part === 0 ? `clip:${s.index}` : `clip:${s.index}:${part}`;
        const b = await idbGet(SB_DB, SB_STORE, key);
        if (!b) break;
        try {
          videos.push(await loadVideo(b));
        } catch {
          /* skip an undecodable part rather than lose the whole beat */
        }
      }
      const video = videos[0] || null;

      if (!img && !video) {
        // Bank the time onto the previous clip, or carry it forward to the
        // first clip that does have something to show.
        if (clips.length) clips[clips.length - 1].durationSec += secs;
        else heldSec += secs;
        continue;
      }
      // Split the beat's screen time between its parts. The parts sum to the
      // beat, so the narration stays aligned however many cuts it became.
      const n = Math.max(1, videos.length);
      const total = secs + heldSec;
      for (let part = 0; part < n; part++) {
        const share = part === n - 1
          ? total - (total / n) * (n - 1)   // last part absorbs rounding
          : total / n;
        clips.push({
          sceneIndex: s.index,
          // The subtitle belongs to the beat, not the cut; repeating it on
          // every part would stutter the caption.
          subtitle: part === 0 ? (s.subtitle || s.sceneSummary || '') : '',
          camera: s.camera || '',
          durationSec: share,
          effect: autoEffect(clips.length, s.camera),
          // Per-scene presenter layout, set by the Director's plan. Undefined
          // means "use the channel default".
          hostLayout: s.hostOverlay || null,
          img: part === 0 ? img : null,
          video: videos[part] || null
        });
      }
      heldSec = 0;
    }
    if (!clips.length) {
      showStatus('Storyboard scenes found but their images could not be loaded.');
      assembleBtn.disabled = false;
      return;
    }
    await loadAudio(true);
    await loadHost();
    assembleBtn.disabled = false;

    // Final guarantee: the picture track must run exactly as long as the voice
    // that will actually play. The decoded narration is the only ground truth
    // here — scene timestamps can be stale (storyboard built against an older
    // take) or absent entirely (a script pasted without timecodes falls back
    // to a flat 15s per scene). Either way the video would end well before or
    // after the voice. Scale the scenes proportionally so they stay in their
    // intended relative pacing while ending on the same frame as the audio.
    const drift = rescaleClipsToAudio();

    stage.hidden = false;
    offsetMs = 0;
    saveTimeline();
    renderTimeline();
    drawFrame(0);
    const secs = Math.round(totalMs() / 1000);
    summaryEl.textContent = `${clips.length} scenes · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}${
      audio.totalMs ? ' · narration loaded' : ' · no narration audio found'
    }`;
    if (drift) {
      showStatus(
        `Rough cut assembled. Scene timings were ${drift > 0 ? 'stretched' : 'tightened'} by ` +
          `${Math.abs(Math.round(drift / 100) / 10)}s to lock the picture to the narration.`,
        'info'
      );
    } else {
      showStatus('Rough cut assembled. Press play to preview, then export.', 'info');
    }
  }

  // --- Rendering ---------------------------------------------------------

  function effectTransform(effect, p) {
    switch (effect) {
      case 'zoom-in':
        return { scale: 1.03 + 0.12 * p, tx: 0, ty: 0 };
      case 'zoom-out':
        return { scale: 1.15 - 0.12 * p, tx: 0, ty: 0 };
      case 'push-in':
        return { scale: 1.0 + 0.16 * p, tx: 0, ty: 0 };
      case 'pull-back':
        return { scale: 1.16 - 0.16 * p, tx: 0, ty: 0 };
      case 'pan-left':
        return { scale: 1.1, tx: 0.06 - 0.12 * p, ty: 0 };
      case 'pan-right':
        return { scale: 1.1, tx: -0.06 + 0.12 * p, ty: 0 };
      case 'drift':
        return { scale: 1.08, tx: -0.04 + 0.08 * p, ty: -0.03 + 0.06 * p };
      case 'focus-shift':
        return { scale: 1.05 + 0.06 * p, tx: 0.02 - 0.04 * p, ty: 0 };
      default:
        return { scale: 1.05 + 0.08 * p, tx: 0, ty: 0 };
    }
  }

  function drawCover(g, img, cw, ch, scale, txF, tyF) {
    if (!img) return;
    // Works for both <img> and <video>: a video element's .width/.height are
    // the (usually unset) HTML attributes, so the intrinsic size has to come
    // from videoWidth/videoHeight or the aspect ratio comes out NaN.
    const iw = img.naturalWidth || img.videoWidth || img.width;
    const ih = img.naturalHeight || img.videoHeight || img.height;
    if (!iw || !ih) return;
    const ir = iw / ih;
    const cr = cw / ch;
    let dw;
    let dh;
    if (ir > cr) {
      dh = ch * scale;
      dw = dh * ir;
    } else {
      dw = cw * scale;
      dh = dw / ir;
    }
    const x = (cw - dw) / 2 + txF * cw;
    const y = (ch - dh) / 2 + tyF * ch;
    g.drawImage(img, x, y, dw, dh);
  }

  // --- Channel host overlay ------------------------------------------------
  //
  // Composited onto the finished frame rather than generated. A corner facecam
  // is a compositing problem, not a diffusion problem: the host's face is a
  // fixed asset, so drawing it directly is both free and perfectly consistent —
  // no model can drift a face it never renders.

  let hostImg = null;
  let hostCfg = null;

  async function loadHost() {
    hostImg = null;
    hostCfg = null;
    if (!window.BlvckHost || !window.BlvckHost.isConfigured()) return;
    hostCfg = window.BlvckHost.get();
    if (hostCfg.layout === 'none') return;
    const blob = await window.BlvckHost.faceBlob();
    if (blob) {
      try {
        hostImg = await loadImage(blob);
      } catch {
        hostImg = null;
      }
    }
  }

  // Cover-fit an image into an arbitrary rect (drawCover targets the whole
  // canvas; the overlay needs a box).
  function drawCoverInto(g, img, x, y, w, h) {
    const iw = img.naturalWidth || img.videoWidth || img.width;
    const ih = img.naturalHeight || img.videoHeight || img.height;
    if (!iw || !ih) return;
    const ir = iw / ih;
    const r = w / h;
    let dw;
    let dh;
    if (ir > r) {
      dh = h;
      dw = dh * ir;
    } else {
      dw = w;
      dh = dw / ir;
    }
    g.drawImage(img, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh);
  }

  function roundRect(g, x, y, w, h, r) {
    const rr = Math.min(r, w / 2, h / 2);
    g.beginPath();
    g.moveTo(x + rr, y);
    g.arcTo(x + w, y, x + w, y + h, rr);
    g.arcTo(x + w, y + h, x, y + h, rr);
    g.arcTo(x, y + h, x, y, rr);
    g.arcTo(x, y, x + w, y, rr);
    g.closePath();
  }

  function drawHostOverlay(g, cw, ch, layoutOverride) {
    if (!hostImg || !hostCfg) return;
    const layout = layoutOverride || hostCfg.layout || 'none';
    if (layout === 'none') return;

    if (layout === 'full') {
      drawCoverInto(g, hostImg, 0, 0, cw, ch);
      return;
    }

    const sizes = (window.BlvckHost && window.BlvckHost.SIZES) || { medium: 0.22 };
    const frac = sizes[hostCfg.size] || sizes.medium || 0.22;
    const h = Math.round(ch * frac);
    // Circle is 1:1; the facecam boxes are 4:3, which is what a real webcam
    // crop looks like and reads better than 16:9 at this scale.
    const w = layout === 'circle' ? h : Math.round(h * (4 / 3));
    const m = Math.round(ch * 0.035);
    const pos = hostCfg.position || 'bottom-right';
    const x = pos.indexOf('right') > -1 ? cw - w - m : m;
    const y = pos.indexOf('bottom') > -1 ? ch - h - m : m;
    const ring = Math.max(2, Math.round(h * 0.018));

    g.save();
    g.shadowColor = 'rgba(0,0,0,0.55)';
    g.shadowBlur = Math.round(h * 0.14);
    g.shadowOffsetY = Math.round(h * 0.025);

    if (layout === 'circle') {
      // Fill behind the clip so the drop shadow has an opaque shape to cast.
      g.beginPath();
      g.arc(x + w / 2, y + h / 2, h / 2, 0, Math.PI * 2);
      g.fillStyle = '#000';
      g.fill();
      g.restore();

      g.save();
      g.beginPath();
      g.arc(x + w / 2, y + h / 2, h / 2, 0, Math.PI * 2);
      g.clip();
      drawCoverInto(g, hostImg, x, y, w, h);
      g.restore();

      g.save();
      g.beginPath();
      g.arc(x + w / 2, y + h / 2, h / 2 - ring / 2, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(255,255,255,0.92)';
      g.lineWidth = ring;
      g.stroke();
      g.restore();
      return;
    }

    // rect + corner. `corner` is the same box with a heavier rounding and no
    // hard border, so it sits into the frame rather than on top of it.
    const radius = layout === 'corner' ? Math.round(h * 0.14) : Math.round(h * 0.06);
    roundRect(g, x, y, w, h, radius);
    g.fillStyle = '#000';
    g.fill();
    g.restore();

    g.save();
    roundRect(g, x, y, w, h, radius);
    g.clip();
    drawCoverInto(g, hostImg, x, y, w, h);
    g.restore();

    if (layout === 'rect') {
      g.save();
      roundRect(g, x + ring / 2, y + ring / 2, w - ring, h - ring, radius);
      g.strokeStyle = 'rgba(255,255,255,0.9)';
      g.lineWidth = ring;
      g.stroke();
      g.restore();
    }
  }

  function wrapText(g, text, maxW) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = '';
    for (const w of words) {
      const cand = cur ? `${cur} ${w}` : w;
      if (g.measureText(cand).width <= maxW) cur = cand;
      else {
        if (cur) lines.push(cur);
        cur = w;
      }
    }
    if (cur) lines.push(cur);
    return lines.slice(0, 3);
  }

  function drawSubs(g, cw, ch, text) {
    if (!subStyle.on || !text) return;
    const size = subStyle.size * (ch / 720);
    g.font = `bold ${size}px ${subStyle.font}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const lines = wrapText(g, text, cw * 0.86);
    const lineH = size * 1.28;
    let cy;
    if (subStyle.pos === 'top') cy = ch * 0.1 + lineH / 2;
    else if (subStyle.pos === 'center') cy = ch * 0.5 - (lines.length - 1) * lineH * 0.5;
    else cy = ch - ch * 0.07 - (lines.length - 1) * lineH - lineH / 2;
    for (const line of lines) {
      g.lineWidth = size * 0.17;
      g.strokeStyle = 'rgba(0,0,0,0.85)';
      g.lineJoin = 'round';
      g.strokeText(line, cw / 2, cy);
      g.fillStyle = subStyle.color;
      g.fillText(line, cw / 2, cy);
      cy += lineH;
    }
  }

  // Drive a clip's video element from the timeline position.
  //
  // Two very different regimes. When the timeline is running (preview playback
  // or the real-time export recording) the element must actually PLAY —
  // seeking once per animation frame would stall the decoder and the export
  // would record duplicated frames. When the user is scrubbing, the opposite:
  // pause and seek exactly, so the frame matches the playhead.
  function driveVideo(v, localMs) {
    if (!v || !v.duration || Number.isNaN(v.duration)) return;
    const want = Math.max(0, Math.min(v.duration - 0.001, localMs / 1000));
    if (realtime) {
      if (v.paused) {
        v.currentTime = want;
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      } else if (Math.abs(v.currentTime - want) > 0.25) {
        // Only correct genuine drift; small differences are normal at 1x.
        v.currentTime = want;
      }
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - want) > 0.04) v.currentTime = want;
    }
  }

  function pauseInactiveVideos(activeClip) {
    for (const c of clips) {
      if (c.video && c !== activeClip && !c.video.paused) c.video.pause();
    }
  }

  function renderClipVisual(g, cw, ch, clip, localMs) {
    // An LTX clip already contains real camera motion, so the Ken Burns
    // fallback is not just unnecessary — it fights the footage and reads as a
    // second, wrong camera move on top of the intended one.
    if (clip.video) {
      driveVideo(clip.video, localMs);
      if (clip.video.readyState >= 2) {
        drawCover(g, clip.video, cw, ch, 1, 0, 0);
        return;
      }
    }
    const p = Math.max(0, Math.min(1, localMs / (clip.durationSec * 1000)));
    const t = effectTransform(clip.effect, p);
    drawCover(g, clip.img, cw, ch, t.scale, t.tx, t.ty);
  }

  function renderTo(g, cw, ch, ms) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, cw, ch);
    const at = clipAt(ms);
    if (!at) return;
    pauseInactiveVideos(at.clip);
    renderClipVisual(g, cw, ch, at.clip, at.localMs);

    // Default crossfade: dissolve into the next clip during this clip's tail.
    if (transitionsOn) {
      const idx = clips.indexOf(at.clip);
      const next = clips[idx + 1];
      const remaining = at.clip.durationSec * 1000 - at.localMs;
      if (next && (next.img || next.video) && remaining < TRANSITION_MS) {
        g.save();
        g.globalAlpha = 1 - remaining / TRANSITION_MS;
        renderClipVisual(g, cw, ch, next, TRANSITION_MS - remaining);
        g.restore();
      }
    }

    // Host sits above the footage but below the captions — a facecam that
    // covers the subtitles is worse than no facecam. A scene may override the
    // layout (the Director decides when the presenter is on screen), falling
    // back to the channel default.
    drawHostOverlay(g, cw, ch, at.clip.hostLayout);

    drawSubs(g, cw, ch, at.clip.subtitle);
  }

  function drawFrame(ms) {
    renderTo(ctx, canvas.width, canvas.height, ms);
    const total = totalMs();
    seek.value = total ? Math.round((ms / total) * 1000) : 0;
    timeLabel.textContent = `${fmt(ms)} / ${fmt(total)}`;
    highlightActive(ms);
  }

  function fmt(ms) {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function highlightActive(ms) {
    const at = clipAt(ms);
    [...timelineEl.children].forEach((el, i) => el.classList.toggle('active', at && clips[i] === at.clip));
  }

  // --- Playback ----------------------------------------------------------

  function scheduleAudio(fromMs, dest) {
    const out = [];
    if (!audioCtx || !audio.buffers.length) return out;
    const targetDest = dest || audioCtx.destination;
    const now = audioCtx.currentTime;
    audio.buffers.forEach((buf, i) => {
      const partStart = audio.offsets[i];
      const partEnd = partStart + buf.duration * 1000;
      if (partEnd <= fromMs) return;
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(targetDest);
      const when = now + Math.max(0, (partStart - fromMs) / 1000);
      const off = Math.max(0, (fromMs - partStart) / 1000);
      src.start(when, off);
      out.push(src);
    });
    return out;
  }

  function stopAudio() {
    activeSources.forEach((s) => {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    });
    activeSources = [];
  }

  // The editor no longer runs a clock. It subscribes to the one in
  // playback.js and draws whatever is true at the reported position.
  //
  // It used to accumulate performance.now() deltas in its own rAF loop, which
  // is a SECOND clock over the same audio: the two drift, seeking in one does
  // not move the other, and the preview cannot stay in step with the
  // narration timeline that everything else now reads.
  let syncBound = false;

  function bindSync() {
    if (syncBound || !window.BlvckPlayback) return;
    syncBound = true;
    const P = window.BlvckPlayback;

    P.on('frame', ({ time }) => {
      // Only draw when this stage is the thing being played.
      if (!playing) return;
      const ms = time * 1000;
      offsetMs = ms;
      drawFrame(Math.min(ms, totalMs()));
    });

    P.on('ended', () => {
      if (!playing) return;
      drawFrame(totalMs());
      stop();
    });

    P.on('seek', ({ time }) => {
      offsetMs = time * 1000;
      if (!playing) drawFrame(offsetMs);
    });
  }

  async function play() {
    if (playing) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
    playing = true;
    realtime = true;
    if (playBtn) playBtn.textContent = '⏸ Pause';
    if (offsetMs >= totalMs()) offsetMs = 0;
    activeSources = scheduleAudio(offsetMs, audioCtx ? audioCtx.destination : null);

    // Hand the clock over. The editor still owns its Web Audio scheduling —
    // that is playback, not timing — but the POSITION now comes from the one
    // controller, so the preview, the character engine and every scheduled
    // event advance together.
    bindSync();
    if (window.BlvckPlayback) {
      window.BlvckPlayback.setDuration(totalMs() / 1000);
      window.BlvckPlayback.seek(offsetMs / 1000);
      window.BlvckPlayback.play();
    }
  }

  function pause() {
    if (!playing) return;
    // Position comes from the controller; the editor no longer derives it.
    if (window.BlvckPlayback) {
      window.BlvckPlayback.pause();
      offsetMs = window.BlvckPlayback.time() * 1000;
    }
    stopPlayback();
  }

  function stop() {
    offsetMs = 0;
    if (window.BlvckPlayback) {
      window.BlvckPlayback.pause();
      window.BlvckPlayback.seek(0);
    }
    stopPlayback();
    drawFrame(0);
  }

  function stopPlayback() {
    playing = false;
    realtime = false;
    playBtn.textContent = '▶ Play';
    if (window.BlvckPlayback && window.BlvckPlayback.isPlaying()) window.BlvckPlayback.pause();
    stopAudio();
    for (const c of clips) if (c.video && !c.video.paused) c.video.pause();
  }

  // --- Timeline UI -------------------------------------------------------

  function renderTimeline() {
    timelineEl.innerHTML = '';
    clips.forEach((clip, i) => {
      const el = document.createElement('div');
      el.className = 'ed-clip';

      const num = document.createElement('div');
      num.className = 'ed-clip-num';
      num.innerHTML = `<span>Scene ${i + 1}</span><span>${clip.camera || ''}</span>`;

      const img = document.createElement('img');
      if (clip.img) img.src = clip.img.src;

      const durLabel = document.createElement('label');
      durLabel.textContent = 'Seconds';
      const dur = document.createElement('input');
      dur.type = 'number';
      dur.min = '1';
      dur.max = '30';
      dur.step = '0.5';
      dur.value = clip.durationSec;
      dur.addEventListener('change', () => {
        clip.durationSec = Math.min(30, Math.max(1, Number(dur.value) || clip.durationSec));
        dur.value = clip.durationSec;
        saveTimeline();
        drawFrame(0);
      });

      const effLabel = document.createElement('label');
      effLabel.textContent = 'Motion';
      const eff = document.createElement('select');
      EFFECTS.forEach((e) => {
        const o = document.createElement('option');
        o.value = e;
        o.textContent = EFFECT_LABELS[e];
        if (e === clip.effect) o.selected = true;
        eff.appendChild(o);
      });
      eff.addEventListener('change', () => {
        clip.effect = eff.value;
        saveTimeline();
      });

      const btns = document.createElement('div');
      btns.className = 'ed-clip-btns';
      const mk = (label, fn) => {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = label;
        b.addEventListener('click', fn);
        return b;
      };
      btns.append(
        mk('◀', () => move(i, -1)),
        mk('▶', () => move(i, 1)),
        mk('Replace', () => replaceImage(clip)),
        mk('✕', () => removeClip(i))
      );

      el.append(num, img, durLabel, dur, effLabel, eff, btns);
      timelineEl.appendChild(el);
    });
  }

  function move(i, dir) {
    const j = i + dir;
    if (j < 0 || j >= clips.length) return;
    [clips[i], clips[j]] = [clips[j], clips[i]];
    saveTimeline();
    renderTimeline();
    drawFrame(0);
  }
  function removeClip(i) {
    clips.splice(i, 1);
    saveTimeline();
    renderTimeline();
    drawFrame(0);
  }
  function replaceImage(clip) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.addEventListener('change', async () => {
      const f = input.files[0];
      if (!f) return;
      // Persist under a fresh key so the replacement survives refresh/export.
      const key = `manual-${(await nextManualKey()) + 1}`;
      await idbPut(SB_DB, SB_STORE, key, f);
      clip.sceneIndex = key;
      clip.img = await loadImage(f);
      saveTimeline();
      renderTimeline();
      drawFrame(0);
    });
    input.click();
  }

  // --- Persistence -------------------------------------------------------

  function saveTimeline() {
    try {
      localStorage.setItem(
        ED_LS,
        JSON.stringify({
          project: project(),
          subStyle,
          transitionsOn,
          clips: clips.map((c) => ({ sceneIndex: c.sceneIndex, subtitle: c.subtitle, camera: c.camera, durationSec: c.durationSec, effect: c.effect }))
        })
      );
    } catch {
      /* quota — non-fatal */
    }
  }

  async function restoreTimeline() {
    let saved;
    try {
      saved = JSON.parse(localStorage.getItem(ED_LS) || 'null');
    } catch {
      saved = null;
    }
    if (!saved || !saved.clips || !saved.clips.length) return false;
    Object.assign(subStyle, saved.subStyle || {});
    if (typeof saved.transitionsOn === 'boolean') transitionsOn = saved.transitionsOn;
    applySubControls();
    clips = [];
    for (const c of saved.clips) {
      const blob = await idbGet(SB_DB, SB_STORE, String(c.sceneIndex));
      clips.push({ ...c, img: blob ? await loadImage(blob) : null });
    }
    await loadAudio();
    stage.hidden = false;
    renderTimeline();
    drawFrame(0);
    return true;
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
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  function pickMime() {
    const opts = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
    return opts.find((m) => window.MediaRecorder && MediaRecorder.isTypeSupported(m)) || 'video/webm';
  }

  async function exportVideo() {
    if (!clips.length) {
      showStatus('No scenes in timeline to export. Assemble a video first.');
      return;
    }
    if (!window.MediaRecorder) {
      showStatus('This browser can’t record video. Use the editor package export instead.');
      return;
    }
    try {
      pause();
      const h = resSel ? Number(resSel.value) || 720 : 720;
      const w = Math.round((h * 16) / 9);
      const off = document.createElement('canvas');
      off.width = w;
      off.height = h;
      const g = off.getContext('2d');

      const stream = off.captureStream(30);
      let recDest = null;
      if (audioCtx && audio.buffers.length) {
        recDest = audioCtx.createMediaStreamDestination();
      }
      const tracks = [...stream.getVideoTracks()];
      if (recDest) tracks.push(...recDest.stream.getAudioTracks());
      const combined = new MediaStream(tracks);
      const rec = new MediaRecorder(combined, { mimeType: pickMime() });
      const chunks = [];
      rec.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);

      const total = totalMs();
      if (exportVideoBtn) exportVideoBtn.disabled = true;
      showStatus('Recording video in real time — please keep this tab open…', 'info');

      const finished = new Promise((resolve) => {
        rec.onstop = () => {
          download(`${project()}.webm`, new Blob(chunks, { type: 'video/webm' }));
          resolve();
        };
      });

      if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
      rec.start();
      if (recDest) activeSources = scheduleAudio(0, recDest);
      const start = performance.now();
      // The recording runs at wall-clock speed, so video clips must play rather
      // than be seeked frame by frame.
      realtime = true;
      await new Promise((resolve) => {
        const step = () => {
          const ms = performance.now() - start;
          renderTo(g, w, h, Math.min(ms, total));
          if (ms >= total) return resolve();
          requestAnimationFrame(step);
        };
        step();
      });
      realtime = false;
      for (const c of clips) if (c.video && !c.video.paused) c.video.pause();
      stopAudio();
      rec.stop();
      await finished;
      if (exportVideoBtn) exportVideoBtn.disabled = false;
      showStatus('Video exported (WebM). Saved to your downloads!', 'info');
    } catch (err) {
      // Must clear here too: leaving realtime set would make the timeline try
      // to play videos while the user is scrubbing a stopped editor.
      realtime = false;
      if (exportVideoBtn) exportVideoBtn.disabled = false;
      showStatus(`Export video failed: ${err.message}`);
    }
  }

  function buildSrt() {
    let acc = 0;
    const fmtT = (ms) => {
      const t = Math.round(ms);
      const h = Math.floor(t / 3600000);
      const m = Math.floor((t % 3600000) / 60000);
      const s = Math.floor((t % 60000) / 1000);
      const mm = t % 1000;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(mm).padStart(3, '0')}`;
    };
    return (
      clips
        .map((c, i) => {
          const start = acc;
          acc += c.durationSec * 1000;
          return `${i + 1}\n${fmtT(start)} --> ${fmtT(acc)}\n${c.subtitle}`;
        })
        .join('\n\n') + '\n'
    );
  }

  async function exportPackage() {
    if (!clips.length) {
      showStatus('No scenes in timeline to export. Assemble a video first.');
      return;
    }
    try {
      showStatus('Creating video ZIP package...', 'info');
      const enc = new TextEncoder();
      const files = [];
      for (let i = 0; i < clips.length; i++) {
        const blob = await idbGet(SB_DB, SB_STORE, String(clips[i].sceneIndex));
        if (blob) {
          files.push({ name: `images/scene-${String(i + 1).padStart(3, '0')}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
        }
      }
      // Narration audio — manually uploaded track first, else the TTS parts.
      const manualAudio = await idbGet(MANUAL_DB, MANUAL_STORE, MANUAL_KEY);
      if (manualAudio) {
        const ext = (manualAudio.type && manualAudio.type.split('/')[1]) || 'mp3';
        files.push({ name: `audio/narration.${ext}`, data: new Uint8Array(await manualAudio.arrayBuffer()) });
      } else {
        try {
          const meta = JSON.parse(localStorage.getItem(AUDIO_LS) || 'null');
          if (meta && meta.items) {
            for (const item of meta.items) {
              let blob = await idbGet(AUDIO_DB, AUDIO_STORE, `${meta.id}:${item.index}`);
              if (!blob) blob = await idbGet(AUDIO_DB, AUDIO_STORE, String(item.index));
              if (blob) files.push({ name: `audio/part-${String(item.part || item.index).padStart(3, '0')}.${meta.ext || 'mp3'}`, data: new Uint8Array(await blob.arrayBuffer()) });
            }
          }
        } catch {
          /* no audio */
        }
      }
      const edl = {
        project: project(),
        fps: 30,
        resolution: resSel ? `${resSel.value}p` : '720p',
        subtitleStyle: subStyle,
        clips: clips.map((c, i) => ({ order: i + 1, scene: c.sceneIndex, image: `images/scene-${String(i + 1).padStart(3, '0')}.png`, durationSec: c.durationSec, effect: c.effect, subtitle: c.subtitle }))
      };
      files.push({ name: 'subtitles.srt', data: enc.encode(buildSrt()) });
      files.push({ name: 'edl.json', data: enc.encode(JSON.stringify(edl, null, 2)) });
      files.push({
        name: 'README.txt',
        data: enc.encode(
          'Blvck TTS editor package\n\n' +
            'images/  — scene stills in order\n' +
            'audio/   — narration parts (concatenate in order)\n' +
            'subtitles.srt — subtitle track matching the assembled timeline\n' +
            'edl.json — scene order, durations, motion effects and subtitle style\n\n'
        )
      });
      download(`${project()} editor package.zip`, window.BlvckZip.create(files));
      showStatus('Editor package ZIP exported successfully!', 'info');
    } catch (err) {
      showStatus(`Export ZIP failed: ${err.message}`);
    }
  }

  // --- Sub controls ------------------------------------------------------

  function applySubControls() {
    subFont.value = subStyle.font;
    subSize.value = subStyle.size;
    subSizeVal.textContent = subStyle.size;
    subPos.value = subStyle.pos;
    subColor.value = subStyle.color;
    subOn.checked = subStyle.on;
    crossfadeToggle.checked = transitionsOn;
  }

  // --- Events ------------------------------------------------------------

  if (assembleBtn) assembleBtn.addEventListener('click', assemble);
  if (buildManualBtn) buildManualBtn.addEventListener('click', buildFromManual);
  if (manualToggle && manualPanel) {
    manualToggle.addEventListener('click', () => {
      manualPanel.hidden = !manualPanel.hidden;
      manualToggle.textContent = manualPanel.hidden ? 'Open Manual Editor' : 'Hide Manual Editor';
    });
  }
  if (crossfadeToggle) {
    crossfadeToggle.addEventListener('change', () => {
      transitionsOn = crossfadeToggle.checked;
      saveTimeline();
      drawFrame(offsetMs);
    });
  }
  if (playBtn) playBtn.addEventListener('click', () => (playing ? pause() : play()));
  if (seek) {
    seek.addEventListener('input', () => {
      pause();
      offsetMs = (Number(seek.value) / 1000) * totalMs();
      if (window.BlvckPlayback) window.BlvckPlayback.seek(offsetMs / 1000);
      drawFrame(offsetMs);
    });
  }
  if (subFont) {
    subFont.addEventListener('change', () => {
      subStyle.font = subFont.value;
      saveTimeline();
      drawFrame(offsetMs);
    });
  }
  if (subSize) {
    subSize.addEventListener('input', () => {
      subStyle.size = Number(subSize.value);
      if (subSizeVal) subSizeVal.textContent = subStyle.size;
      drawFrame(offsetMs);
    });
    subSize.addEventListener('change', saveTimeline);
  }
  if (subPos) {
    subPos.addEventListener('change', () => {
      subStyle.pos = subPos.value;
      saveTimeline();
      drawFrame(offsetMs);
    });
  }
  if (subColor) {
    subColor.addEventListener('input', () => {
      subStyle.color = subColor.value;
      drawFrame(offsetMs);
    });
    subColor.addEventListener('change', saveTimeline);
  }
  if (subOn) {
    subOn.addEventListener('change', () => {
      subStyle.on = subOn.checked;
      saveTimeline();
      drawFrame(offsetMs);
    });
  }
  if (exportVideoBtn) exportVideoBtn.addEventListener('click', exportVideo);
  if (exportPkgBtn) exportPkgBtn.addEventListener('click', exportPackage);

  // The editor is a standalone tool (upload your own images/audio/subtitles),
  // so it's always available — no storyboard required.

  // Re-hydrate from storage (used by the data manager after a clear or undo).
  async function refresh() {
    clips = [];
    timelineEl.innerHTML = '';
    stage.hidden = true;
    const summary = $('ed-summary');
    if (summary) summary.textContent = '';
    await restoreTimeline();
  }
  if (window.BlvckData) window.BlvckData.register('editor', refresh);

  // --- Init --------------------------------------------------------------

  (async () => {
    card.hidden = false;
    await restoreTimeline();
  })();
})();
