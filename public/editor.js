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
    // With measured timing the narration defines the project, not the sum of
    // the clips — the clips were placed against it.
    if (authoritative() && audio.totalMs) return audio.totalMs;
    const clipsTotal = clips.reduce((a, c) => a + c.durationSec * 1000, 0);
    return Math.max(clipsTotal, audio.totalMs || 0);
  }

  function clipAt(ms) {
    if (!clips.length) return null;

    // ── Authoritative path: position is stored, not inferred ────────────────
    if (authoritative()) {
      let last = null;
      for (const c of clips) {
        const startMs = c.timelineStart * 1000;
        const endMs = c.timelineEnd * 1000;
        if (ms >= startMs && ms < endMs) {
          return { clip: c, localMs: ms - startMs, startMs };
        }
        if (endMs <= ms) last = c;   // most recent beat that has already ended
      }

      // Nothing covers this moment. Never restart the footage: a viewer seeing
      // the opening shot again under closing narration reads as a mistake,
      // because it is one. Hold the last real frame instead — a still that
      // outstays its beat is a lesser fault than footage that lies about
      // where it is in the story.
      if (last) {
        const heldFor = last.timelineEnd - last.timelineStart;
        return {
          clip: last,
          localMs: Math.max(0, heldFor * 1000 - 1),   // parked on its final frame
          startMs: last.timelineStart * 1000,
          held: true
        };
      }
      // Before the first beat begins.
      const first = clips[0];
      return { clip: first, localMs: 0, startMs: first.timelineStart * 1000, held: true };
    }

    // ── Legacy path: sequential, and it may still cycle ─────────────────────
    // Untouched on purpose. An estimated timeline has no authority to hold a
    // frame against, and existing projects depend on this behaviour.
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

  /**
   * Reject a timeline the renderer must not be asked to draw.
   *
   * Returns problems rather than throwing so the caller can report all of them
   * at once. Deliberately not silently repaired: a shot ending after the
   * narration is a planning fault, and quietly clamping it would hide the bug
   * that produced it.
   */
  function validateTimeline(list, projectDurationSec) {
    const problems = [];
    (list || []).forEach((c, i) => {
      const s = Number(c.timelineStart);
      const e = Number(c.timelineEnd);
      const at = `clip ${i} (scene ${c.sceneIndex})`;
      if (!Number.isFinite(s) || !Number.isFinite(e)) {
        problems.push(`${at}: timelineStart/timelineEnd missing`);
        return;
      }
      if (s < 0) problems.push(`${at}: starts before zero (${s.toFixed(2)}s)`);
      if (e <= s) problems.push(`${at}: ends at or before it starts (${s.toFixed(2)}→${e.toFixed(2)}s)`);
      if (Number.isFinite(projectDurationSec) && projectDurationSec > 0
          && e > projectDurationSec + 0.05) {
        problems.push(`${at}: ends after the narration (${e.toFixed(2)}s of ${projectDurationSec.toFixed(2)}s)`);
      }
    });
    return problems;
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
  // ── Timing authority ──────────────────────────────────────────────────────
  //
  // Two kinds of timeline reach this module, and they must not be treated the
  // same way. An estimated timeline is a guess at how long each beat runs, and
  // stretching it to fit the audio makes it better. A Whisper timeline is a
  // measurement of when each word was actually spoken, and stretching it makes
  // it wrong — the overlay that was anchored to "forty percent" at 3.18s slides
  // off the word it was written for.
  //
  // So `timingSource` is not decoration. Every timing decision below asks it
  // first, and 'whisper' means the numbers are already right.
  let timingSource = 'estimated';

  function authoritative() {
    return timingSource === 'whisper'
      && clips.length > 0
      && clips.every((c) => Number.isFinite(c.timelineStart) && Number.isFinite(c.timelineEnd));
  }

  function rescaleClipsToAudio() {
    if (!audio || !audio.totalMs || !clips.length) return 0;

    // Measured timing is the authority, not a starting point to be adjusted.
    // The Director placed these beats against real word offsets; a proportional
    // stretch to close a rounding gap would desynchronise every one of them.
    if (authoritative()) return 0;

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

  /**
   * Draw a card for a beat that has no asset.
   *
   * Uses whatever the Director already decided — a chart beat draws a chart,
   * a stickman beat draws figures — and falls back to a title card carrying
   * the narration. Rendered in about a millisecond, so a full rough cut is
   * available immediately instead of after an hour of GPU time.
   */
  async function fallbackCard(scene) {
    if (!window.BlvckGraphic) return null;
    const text = scene.subtitle || scene.sceneSummary || '';
    if (!text.trim()) return null;
    const vt = String(scene.visualType || '');
    const canvasKind = window.BlvckScenes && window.BlvckScenes.rendersOnCanvas({ visualType: vt });
    try {
      const blob = await window.BlvckGraphic.render({
        // Honour the plan when there is one; otherwise a title card, which
        // reads as a deliberate beat rather than a missing asset.
        kind: canvasKind ? vt : 'title',
        title: (scene.graphic && scene.graphic.title) || text,
        subtitle: (scene.graphic && scene.graphic.subtitle) || '',
        items: (scene.graphic && scene.graphic.items) || [],
        palette: window.BlvckGraphic.paletteFor(text)
      });
      if (!blob) return null;
      // Keep it, so a re-assemble does not redraw and the scene card shows it.
      await idbPut(SB_DB, SB_STORE, String(scene.index), blob);
      return await loadImage(blob);
    } catch (err) {
      console.warn('[Editor] fallback card failed for scene', scene.index, err.message);
      return null;
    }
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
    // Which clock is this project on?
    //
    // Measured timing requires BOTH halves: a transcript that came from real
    // forced alignment, and scenes the Director actually placed against it. A
    // transcript alone proves nothing about the storyboard, and timeline fields
    // on an estimated project would claim an authority they do not have — so
    // one without the other falls back to the legacy sequential path.
    const transcript = (sb && sb.transcript) || null;
    const measured = !!(window.Transcript && window.Transcript.isMeasured(transcript));
    const placed = scenes.some((s) => Number.isFinite(Number(s.timelineStart))
                                   && Number.isFinite(Number(s.timelineEnd)));
    timingSource = (measured && placed) ? 'whisper' : 'estimated';

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
        // Draw one rather than skipping the beat.
        //
        // A scene that has narration is ALWAYS renderable — text is a
        // legitimate explainer visual, and in a procedural-first product
        // there is no reason for assembly to fail waiting on a generator.
        // The old behaviour banked the time onto the previous clip, so a
        // project whose images had not been generated produced either
        // nothing or one enormous held frame.
        img = await fallbackCard(s);
        if (!img) {
          if (clips.length) clips[clips.length - 1].durationSec += secs;
          else heldSec += secs;
          continue;
        }
      }
      // Split the beat's screen time between its parts. The parts sum to the
      // beat, so the narration stays aligned however many cuts it became.
      const n = Math.max(1, videos.length);
      const total = secs + heldSec;
      for (let part = 0; part < n; part++) {
        const share = part === n - 1
          ? total - (total / n) * (n - 1)   // last part absorbs rounding
          : total / n;
        // Absolute position on the finished video's clock. Present only when
        // the Director worked against a measured transcript; otherwise the
        // legacy sequential path still governs placement.
        const beatStart = Number(s.timelineStart);
        const beatEnd = Number(s.timelineEnd);
        const timed = Number.isFinite(beatStart) && Number.isFinite(beatEnd) && beatEnd > beatStart;
        // A beat cut into several parts divides its own window between them,
        // so the parts still add up to the narration it was timed against.
        const partStart = timed ? beatStart + ((beatEnd - beatStart) / n) * part : null;
        const partEnd = timed
          ? (part === n - 1 ? beatEnd : beatStart + ((beatEnd - beatStart) / n) * (part + 1))
          : null;

        clips.push({
          sceneIndex: s.index,
          // Which cut of a split beat this is. Saved because the storyboard
          // stores the parts under clip:N, clip:N:1, clip:N:2 - without it a
          // reopened project cannot tell them apart and every part of the beat
          // would come back as the first one.
          part,
          // The subtitle belongs to the beat, not the cut; repeating it on
          // every part would stutter the caption.
          subtitle: part === 0 ? (s.subtitle || s.sceneSummary || '') : '',
          camera: s.camera || '',
          durationSec: timed ? partEnd - partStart : share,
          timelineStart: partStart,
          timelineEnd: partEnd,
          effect: autoEffect(clips.length, s.camera),
          // Per-scene presenter layout, set by the Director's plan. Undefined
          // means "use the channel default".
          hostLayout: s.hostOverlay || null,
          // The excerpt window, so driveVideo knows where the shot's zero is
          // inside a long archival source. Carried per clip because a replaced
          // clip must not inherit the previous one's in-point.
          excerpt: (s.stockAsset && s.stockAsset.excerpt) || s.excerpt || null,
          // How to fit the frame. From the asset's own treatment when the
          // acquisition layer chose one; otherwise fitFor() falls back to the
          // aspect, so archival material is never cropped by default.
          treatment: (s.stockAsset && s.stockAsset.treatment) || s.treatment || null,
          stockAsset: s.stockAsset || null,
          // Only the first part of a split beat carries the overlay: repeating
          // a statistic card on every cut of the same beat would flash it.
          editorialOverlay: part === 0 ? (s.editorialOverlay || null) : null,
          img: part === 0 ? img : null,
          video: videos[part] || null
        });
      }
      heldSec = 0;
    }
    if (!clips.length) {
      showStatus('Scenes were found but nothing could be drawn for them. Plan shots with the Director, then generate — every procedural beat renders in milliseconds.');
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

  /**
   * Fit the whole frame inside the canvas, padding the remainder.
   *
   * The counterpart to drawCover, which fills the frame by cropping whatever
   * does not fit. For modern stock that is the right trade — a stock clip is
   * shot with room to spare and losing its edges costs nothing. For archival
   * footage it is the wrong trade: a 4:3 newsreel in a 16:9 timeline loses a
   * third of its height to a crop, and in historical material the edges are
   * routinely the subject — the crowd at the margin, the sign above the door,
   * the machine being operated at the bottom of frame.
   *
   * So this preserves the complete historical frame and pads the sides. The
   * padding is black rather than a blurred fill: a period frame surrounded by
   * a smeared copy of itself reads as a mistake.
   */
  function drawContain(g, img, cw, ch, scale, txF, tyF) {
    if (!img) return;
    const iw = img.naturalWidth || img.videoWidth || img.width;
    const ih = img.naturalHeight || img.videoHeight || img.height;
    if (!iw || !ih) return;

    const s = Math.min(cw / iw, ch / ih) * (scale || 1);
    const dw = iw * s;
    const dh = ih * s;
    const x = (cw - dw) / 2 + (txF || 0) * cw;
    const y = (ch - dh) / 2 + (tyF || 0) * ch;
    g.drawImage(img, x, y, dw, dh);
  }

  /**
   * How much of the source survives a cover crop.
   *
   * 1.0 means the aspect matches the canvas and nothing is lost. 0.32 means a
   * portrait clip in a landscape timeline: filling the frame throws away two
   * thirds of the picture.
   */
  function coverVisibleFraction(img, cw, ch) {
    const iw = img && (img.naturalWidth || img.videoWidth || img.width);
    const ih = img && (img.naturalHeight || img.videoHeight || img.height);
    if (!iw || !ih || !cw || !ch) return 1;
    const ir = iw / ih;
    const cr = cw / ch;
    return Math.min(ir / cr, cr / ir);
  }

  /**
   * Which fit this clip gets.
   *
   * Explicit rather than inferred wherever possible: the Director's or the
   * asset's own treatment wins.
   *
   * Below that, the question is not "is this archival" but "how much of the
   * picture would cropping destroy". Cover is the right trade when the aspects
   * are close - a 16:10 clip losing a sliver of its edges costs nothing, and
   * filling the frame looks better than bars. It is the wrong trade when the
   * source is a different shape entirely: a 9:16 stock clip cover-fitted into a
   * 16:9 timeline is drawn 2276px tall inside a 720px frame, so the viewer sees
   * a third of it and the subject is usually not in that third.
   *
   * This used to apply only to archive_org material, which meant a portrait or
   * square clip from Pexels or Pixabay was silently cropped to a vertical strip.
   * The reason archival needed it first was never that it was archival - it was
   * that it was a different shape.
   */
  const COVER_KEEPS_ENOUGH = 0.8;   // below this, cropping loses too much

  function fitFor(clip, img, cw, ch) {
    const declared = clip && clip.treatment && clip.treatment.fit;
    if (declared === 'contain' || declared === 'pillarbox' || declared === 'letterbox') return 'contain';
    if (declared === 'cover' || declared === 'crop' || declared === 'fill') return 'cover';
    if (!img) return 'cover';

    // Archival keeps its tighter rule: in period material the edges are
    // routinely the subject, so even a small crop is a real loss.
    const isArchive = !!(clip && ((clip.stockAsset && clip.stockAsset.provider === 'archive_org')
                                   || (clip.excerpt && clip.excerpt.sourceIn != null)));
    const iw = img.naturalWidth || img.videoWidth || img.width;
    const ih = img.naturalHeight || img.videoHeight || img.height;
    if (!iw || !ih) return 'cover';

    if (isArchive) {
      const drift = Math.abs((iw / ih) - (16 / 9)) / (16 / 9);
      return drift > 0.05 ? 'contain' : 'cover';
    }
    // Everything else: crop only while most of the frame survives it.
    const width = cw || 16;
    const height = ch || 9;
    return coverVisibleFraction(img, width, height) < COVER_KEEPS_ENOUGH ? 'contain' : 'cover';
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
  /**
   * Position a video element for this moment of the timeline.
   *
   * `clip` carries the excerpt window when one was chosen. An archive item is
   * a whole film — an eleven-minute newsreel for a six-second beat — so the
   * shot's zero is `sourceIn`, not the file's zero. Playing from zero gives the
   * scene the film's opening title card instead of the footage the Director
   * picked, which is what happened before this offset existed.
   *
   * Playback is clamped to `sourceOut`: at the end of the window the element is
   * held on its last frame rather than allowed to run on into whatever the film
   * does next.
   */
  function driveVideo(v, localMs, clip) {
    if (!v || !v.duration || Number.isNaN(v.duration)) return;

    const ex = (clip && clip.excerpt) || null;
    const hasWindow = ex
      && Number.isFinite(Number(ex.sourceIn))
      && Number.isFinite(Number(ex.sourceOut))
      && Number(ex.sourceOut) > Number(ex.sourceIn);

    // The file is the final authority on what exists: a sourceOut past the end
    // of the decoded media would seek nowhere and freeze on a blank frame.
    const inPoint = hasWindow ? Math.max(0, Math.min(Number(ex.sourceIn), v.duration - 0.001)) : 0;
    const outPoint = hasWindow ? Math.min(Number(ex.sourceOut), v.duration) : v.duration;

    const want = Math.max(inPoint, Math.min(outPoint - 0.001, inPoint + localMs / 1000));

    if (realtime) {
      if (v.paused) {
        v.currentTime = want;
        const p = v.play();
        if (p && p.catch) p.catch(() => {});
      } else if (v.currentTime >= outPoint - 0.001) {
        // Reached the end of the excerpt. Stop rather than continue into the
        // rest of the film, and stay on the final frame.
        v.pause();
        v.currentTime = Math.max(inPoint, outPoint - 0.001);
      } else if (Math.abs(v.currentTime - want) > 0.25) {
        // Only correct genuine drift; small differences are normal at 1x.
        v.currentTime = want;
      }
    } else {
      if (!v.paused) v.pause();
      if (Math.abs(v.currentTime - want) > 0.04) v.currentTime = want;
    }
  }

  // -- Source readiness -----------------------------------------------------
  //
  // A streamed film that has not buffered the region around its in-point cannot
  // be drawn, and the old code then fell through to clip.img -- null for a
  // video-only clip -- and drew nothing. The export encoded black footage and
  // said nothing about it. Measured on a real archive item: 390 frames of a
  // 6.5s shot, zero of them drawable, while the element itself was healthy
  // seconds later.
  const renderErrors = [];

  // How long to wait for a streamed source to become drawable at its in-point.
  //
  // Not a magic number: archive.org serves byte ranges from storage nodes that
  // have been measured intermittently answering 500, and seeking 272s into a
  // film means fetching a range the browser has not touched. The first
  // measurement of this path saw 390 frames with zero drawable inside a 6.5s
  // shot, so the budget has to be generous relative to the shot, not to it.
  //
  // Overridable because the right value depends on the connection, not on the
  // code: window.BlvckEditorTiming.setReadinessTimeout(ms), or
  // localStorage 'blvck:source_readiness_ms'.
  const DEFAULT_READINESS_MS = 20000;
  let readinessTimeoutMs = (() => {
    const stored = Number(localStorage.getItem('blvck:source_readiness_ms'));
    return Number.isFinite(stored) && stored >= 1000 ? stored : DEFAULT_READINESS_MS;
  })();

  function setReadinessTimeout(ms) {
    const n = Number(ms);
    if (Number.isFinite(n) && n >= 1000) {
      readinessTimeoutMs = n;
      localStorage.setItem('blvck:source_readiness_ms', String(n));
    }
    return readinessTimeoutMs;
  }

  function noteRenderError(clip, message) {
    // One entry per clip; a per-frame log would bury the useful line under
    // hundreds of copies of itself.
    const key = String(clip.sceneIndex);
    if (renderErrors.some((e) => e.key === key)) return;
    renderErrors.push({ key, scene: clip.sceneIndex, message, at: Date.now() });
    console.warn('[Editor] ' + message);
  }

  // `loadedmetadata` only means the duration is known. HAVE_CURRENT_DATA (2) is
  // the first state where the frame at currentTime can actually be drawn.
  function videoDrawable(v) {
    return !!v && v.readyState >= 2 && !!v.videoWidth;
  }

  /**
   * Get every video clip ready before recording starts.
   *
   * Seeks each element to its own in-point, not to zero: a shot excerpting
   * 272.2s needs 272.2s buffered, and having the opening buffered is no use to
   * it. Returns a report rather than throwing, because a project with one
   * unavailable clip should still export via the fallback, with the
   * substitution recorded.
   */
  // --- Export requires local media ----------------------------------------
  //
  // A video element pointed at an http URL streams while it records, and
  // recording happens once, at wall-clock speed: a re-buffer is a hole in the
  // finished file, not a stall the user can wait out. Measured against
  // archive.org, readiness for the identical seek took 5.1s, 16.7s and over
  // 20.3s across three runs of the same test. Nothing built on that is a
  // production export path.
  //
  // So the bytes must be on this machine first. Preview may still stream —
  // there, a stall is just a stall.

  function sourceIsLocal(v) {
    const s = (v && (v.currentSrc || v.src)) || '';
    // blob: is the cache-backed case, file:/data: cover local uploads.
    return /^(blob:|data:|file:)/.test(s);
  }

  // Re-acquisition deliberately stops at "download this asset again".
  // Choosing a different file or a different candidate is acquisition policy
  // and lives in stock-media.js with the rights gate; reimplementing a slice
  // of it here would be a second acquisition pipeline that ages separately.
  async function recoverToLocal(clip) {
    const asset = clip.stockAsset;
    if (!asset || !asset.provider || !asset.id || !window.StockMedia) return false;
    try {
      const blob = await window.StockMedia.downloadAsset(asset);
      if (!blob || !blob.size) return false;
      const v = await loadVideo(blob);
      clip.video = v;
      return true;
    } catch (e) {
      return false;
    }
  }

  async function validateLocalSources() {
    const report = { ok: true, checked: [], problems: [] };

    for (const clip of clips) {
      if (!clip.video) continue;
      const note = (code, detail) => {
        report.ok = false;
        report.problems.push({ scene: clip.sceneIndex, code, detail });
      };

      let recovered = false;
      if (!sourceIsLocal(clip.video)) {
        recovered = await recoverToLocal(clip);
        if (!recovered) {
          note('remote_source',
            'still streaming from the network; open the scene in the storyboard and '
            + 'let it finish caching, or replace the footage');
          continue;
        }
      }

      const dur = Number(clip.video.duration);
      if (!Number.isFinite(dur) || dur <= 0) {
        note('unreadable', 'the cached file decoded but reports no duration — it is probably truncated');
        continue;
      }

      // An excerpt window that runs past the end of the file cannot be
      // rendered, and the failure looks like a frozen frame rather than an
      // error, so it is worth catching before recording rather than after.
      const ex = clip.excerpt;
      if (ex && ex.applied) {
        const inP = Number(ex.sourceIn), outP = Number(ex.sourceOut);
        if (!Number.isFinite(inP) || !Number.isFinite(outP) || outP <= inP) {
          note('bad_excerpt', `sourceIn=${ex.sourceIn} sourceOut=${ex.sourceOut} is not a usable window`);
          continue;
        }
        if (outP > dur + 0.25) {
          note('excerpt_past_end',
            `excerpt ends at ${outP.toFixed(1)}s but the file is only ${dur.toFixed(1)}s`);
          continue;
        }
      }

      report.checked.push({
        scene: clip.sceneIndex,
        durationSec: Math.round(dur * 100) / 100,
        redownloaded: recovered,
        provider: (clip.stockAsset && clip.stockAsset.provider) || 'local'
      });
    }

    return report;
  }

  async function prepareClipsForExport(opts) {
    const timeoutMs = (opts && opts.timeoutMs) || readinessTimeoutMs;
    renderErrors.length = 0;
    const report = { prepared: [], failed: [] };

    for (const clip of clips) {
      if (!clip.video) continue;
      // Per-export state, so diagnostics describe this run and not the last one.
      clip.entrySnapshot = null;
      clip.rebufferCount = 0;
      clip.rebufferFailed = false;
      const inPoint = (clip.excerpt && Number.isFinite(Number(clip.excerpt.sourceIn)))
        ? Number(clip.excerpt.sourceIn) : 0;

      const startedAt = performance.now();
      let pollCount = 0;
      const ok = await new Promise((resolve) => {
        let settled = false;
        const finish = (value) => {
          if (settled) return;
          settled = true;
          clip.video.removeEventListener('seeked', onReady);
          clip.video.removeEventListener('canplay', onReady);
          clearInterval(poll);
          resolve(value);
        };
        const onReady = () => { pollCount++; if (videoDrawable(clip.video)) finish(true); };

        clip.video.addEventListener('seeked', onReady);
        clip.video.addEventListener('canplay', onReady);
        // Buffering a remote byte range emits no single reliable event, so poll
        // as well as listen; whichever notices first wins.
        const poll = setInterval(onReady, 150);
        setTimeout(() => finish(videoDrawable(clip.video)), timeoutMs);

        try {
          const target = Math.max(0, Math.min(inPoint, (clip.video.duration || 1e9) - 0.05));
          if (Math.abs(clip.video.currentTime - target) < 0.01) onReady();
          clip.video.currentTime = target;
        } catch (e) {
          finish(false);
        }
      });

      if (ok) {
        // Snapshot the frame we just proved we can draw. When the browser later
        // evicts the buffered range — measured happening across an 18.5s idle
        // gap — this is a held frame from the RIGHT source position, which is a
        // far better failure than a marker and costs one canvas per clip.
        try {
          const snap = document.createElement('canvas');
          snap.width = clip.video.videoWidth;
          snap.height = clip.video.videoHeight;
          snap.getContext('2d').drawImage(clip.video, 0, 0);
          clip.preparedFrame = snap;
        } catch (e) { clip.preparedFrame = null; }

        report.prepared.push({
          scene: clip.sceneIndex,
          sourceIn: inPoint,
          // Measured, so the timeout can be tuned from evidence rather than
          // guessed at again.
          waitedMs: Math.round(performance.now() - startedAt),
          readyState: clip.video.readyState,
          sourceTimeAtReady: Math.round(clip.video.currentTime * 100) / 100,
          polls: pollCount
        });
        continue;
      }

      // Not ready in time. Build the fallback now rather than discovering the
      // hole mid-recording, where there is no time left to render anything.
      noteRenderError(clip,
        'Scene ' + clip.sceneIndex + ': video unavailable at sourceIn=' + inPoint.toFixed(1));
      if (!clip.img) {
        clip.fallbackImg = await fallbackCard({
          index: clip.sceneIndex, subtitle: clip.subtitle, visualType: 'editorial_text'
        });
      }
      report.failed.push({
        scene: clip.sceneIndex, sourceIn: inPoint, readyState: clip.video.readyState,
        waitedMs: Math.round(performance.now() - startedAt), polls: pollCount,
        timeoutMs,
        fallback: clip.img ? 'still image' : (clip.fallbackImg ? 'editorial graphic' : 'none available')
      });
    }
    return report;
  }

  /**
   * Make sure a shot's source is drawable now that the timeline has reached it.
   *
   * Deliberately NOT async. renderTo runs inside requestAnimationFrame during
   * recording, so awaiting here would either stall the recorder or, worse, be
   * a floating promise that does nothing. Instead this starts a rebuffer and
   * returns immediately; the caller renders a fallback for the frames in
   * between and the video resumes as soon as the seek lands.
   *
   * Preparation before recording is not enough on its own. Both real-stream
   * runs reached readyState 4 at sourceIn, and one of them still collapsed to
   * 41 drawable frames out of 391 — the archive shot does not begin until
   * 18.5s, and the browser is free to evict the range it fetched while the
   * element sits idle.
   */
  function ensureVideoReadyForShot(clip) {
    const v = clip.video;
    if (!v) return false;

    // The first call in an export pass IS shot entry — this runs per frame, so
    // only the first observation describes entry. Recorded here because reading
    // currentTime after the recording ends reports where the film stopped, which
    // reads like entry evidence and is not.
    if (!clip.entrySnapshot) {
      clip.entrySnapshot = {
        ready: videoDrawable(v),
        readyState: v.readyState,
        sourceTime: Math.round((v.currentTime || 0) * 100) / 100
      };
    }

    if (videoDrawable(v)) {
      clip.rebuffering = false;
      return true;
    }
    if (clip.rebuffering) return false;      // one seek per episode, not per frame

    const inPoint = (clip.excerpt && Number.isFinite(Number(clip.excerpt.sourceIn)))
      ? Number(clip.excerpt.sourceIn) : 0;

    clip.rebuffering = true;
    clip.rebufferCount = (clip.rebufferCount || 0) + 1;
    noteRenderError(clip, 'Scene ' + clip.sceneIndex + ': buffer lost before shot entry, '
      + 're-seeking to ' + inPoint.toFixed(1) + 's (attempt ' + clip.rebufferCount + ')');

    const settle = () => {
      v.removeEventListener('canplay', settle);
      v.removeEventListener('seeked', settle);
      clearTimeout(clip._rebufferTimer);
      clip.rebuffering = false;
    };
    v.addEventListener('canplay', settle);
    v.addEventListener('seeked', settle);
    // Uses the one configurable budget rather than introducing another number.
    clip._rebufferTimer = setTimeout(() => {
      settle();
      clip.rebufferFailed = true;
      noteRenderError(clip, 'Scene ' + clip.sceneIndex + ': still not drawable after '
        + readinessTimeoutMs + 'ms — using fallback');
    }, readinessTimeoutMs);

    try {
      // Back to the in-point, never to zero and never to wherever the element
      // happens to sit.
      v.currentTime = Math.max(0, Math.min(inPoint, (v.duration || 1e9) - 0.05));
    } catch (e) {
      settle();
    }
    return false;
  }

  /** Per-shot diagnostics, for tuning readiness against real streams. */
  function shotDiagnostics() {
    return clips.filter((c) => c.video).map((c) => ({
      scene: c.sceneIndex,
      timelineStart: c.timelineStart,
      timelineEnd: c.timelineEnd,
      sourceIn: c.excerpt ? c.excerpt.sourceIn : null,
      sourceOut: c.excerpt ? c.excerpt.sourceOut : null,
      // Captured at the first render call of the shot, not read back now.
      shotEntryReady: c.entrySnapshot ? c.entrySnapshot.ready : null,
      shotEntryReadyState: c.entrySnapshot ? c.entrySnapshot.readyState : null,
      shotEntrySourceTime: c.entrySnapshot ? c.entrySnapshot.sourceTime : null,
      // Where the element sits now — useful, but a different claim.
      currentReadyState: c.video.readyState,
      currentSourceTime: Math.round((c.video.currentTime || 0) * 100) / 100,
      sourceIsLocal: sourceIsLocal(c.video),
      rebufferCount: c.rebufferCount || 0,
      rebufferFailed: !!c.rebufferFailed,
      hasPreparedFrame: !!c.preparedFrame,
      fallbackUsed: c.fallbackUsed || null
    }));
  }

  /**
   * Drive a real-time render loop to completion.
   *
   * requestAnimationFrame is the right clock while the tab is visible — it is
   * paced to the compositor, which is what MediaRecorder is capturing. But a
   * backgrounded tab suspends it entirely, and the old loop then waited forever
   * on a callback that would never arrive: the recorder kept running, the
   * canvas stopped changing, and the export produced a file that ends wherever
   * the user happened to switch away.
   *
   * So rAF leads and a timer follows. If no frame arrives within a beat, the
   * timer takes over — throttled to roughly one tick a second in a hidden tab,
   * which is a poor frame rate but a finished video rather than a hung one.
   * When the tab comes back rAF resumes and the timer stands down.
   */
  function driveRealtimeLoop(totalMs, onFrame) {
    return new Promise((resolve) => {
      const started = performance.now();
      let done = false;
      let usedFallback = false;
      let watchdog = 0;

      const tick = (viaFallback) => {
        if (done) return;
        if (viaFallback) usedFallback = true;
        const ms = performance.now() - started;
        onFrame(Math.min(ms, totalMs));
        if (ms >= totalMs) {
          done = true;
          clearTimeout(watchdog);
          return resolve({ usedFallback, elapsedMs: Math.round(ms) });
        }
        schedule();
      };

      const schedule = () => {
        clearTimeout(watchdog);
        requestAnimationFrame(() => tick(false));
        // If the compositor has not called us back in ~250ms, the tab is very
        // likely hidden. Keep going rather than stalling.
        watchdog = setTimeout(() => tick(true), 250);
      };
      schedule();
    });
  }

  function pauseInactiveVideos(activeClip) {
    for (const c of clips) {
      if (c.video && c !== activeClip && !c.video.paused) c.video.pause();
    }
  }

  // ── Editorial overlays ────────────────────────────────────────────────────
  //
  // Distinct from captions, and deliberately so. drawSubs renders what was
  // SAID; this renders what the beat MEANS — a statistic, a pulled quote, a
  // headline bar. Burning the narration twice, once as a caption and once as
  // giant type, is the failure mode to avoid.
  //
  // Timing is the overlay's own. It is anchored to the moment a phrase is
  // spoken, which is usually not the start of its shot: on the measured
  // narration, "forty percent" lands at 3.18s of a 4.55s clip, so a card
  // placed at the top of the beat would appear three seconds before the words.
  const OVERLAY_KIND = {
    statistic: 'stat_overlay',
    stat: 'stat_overlay',
    number: 'stat_overlay',
    quote: 'quote_overlay',
    headline: 'editorial_bar',
    editorial_bar: 'editorial_bar',
    label: 'title',
    emphasis: 'title',
    title: 'title'
  };

  function overlayActiveAt(clip, ms) {
    const ov = clip && clip.editorialOverlay;
    if (!ov || !ov.enabled) return null;
    const start = Number(ov.start);
    const end = Number(ov.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const t = ms / 1000;
    return (t >= start && t < end) ? ov : null;
  }

  function drawEditorialOverlay(g, cw, ch, clip, ms) {
    const ov = overlayActiveAt(clip, ms);
    if (!ov) return false;

    const G = window.BlvckGraphic;
    if (!G || !G.drawStatOverlay) return false;   // primitives unavailable

    const kind = OVERLAY_KIND[String(ov.style || 'emphasis').toLowerCase()] || 'title';
    const theme = (G.THEMES && G.THEMES.dark) || {};
    const spec = {
      value: ov.text || '',
      title: ov.text || '',
      label: ov.emphasis || '',
      subtitle: ''
    };

    // A short fade so the card arrives rather than snapping in. Kept inside the
    // overlay's own window so it cannot bleed past `end`.
    const span = Number(ov.end) - Number(ov.start);
    const into = ms / 1000 - Number(ov.start);
    const fade = Math.min(0.25, span / 4);
    const alpha = fade > 0
      ? Math.min(1, Math.min(into / fade, (span - into) / fade))
      : 1;

    g.save();
    g.globalAlpha = Math.max(0, Math.min(1, alpha));
    // The primitives are written against a fixed 1280x720 stage; scale rather
    // than duplicate them for every export resolution.
    const stage = G.OVERLAY_STAGE || { w: 1280, h: 720 };
    g.scale(cw / stage.w, ch / stage.h);
    try {
      if (kind === 'stat_overlay') G.drawStatOverlay(g, theme, spec);
      else if (kind === 'quote_overlay') G.drawQuoteOverlay(g, theme, spec);
      else if (kind === 'editorial_bar') G.drawEditorialBar(g, theme, spec);
      else G.drawTitle(g, theme, spec);
    } finally {
      g.restore();
    }
    return true;
  }

  // Drawn only when a shot has no usable visual at all. Deliberately legible
  // rather than tasteful: this frame is a bug report, and it should be obvious
  // in a preview long before anyone publishes it.
  function drawUnavailable(g, cw, ch, clip) {
    g.save();
    g.fillStyle = '#2a1416';
    g.fillRect(0, 0, cw, ch);
    g.fillStyle = '#ef4444';
    g.font = '600 ' + Math.round(ch * 0.045) + 'px system-ui, sans-serif';
    g.textAlign = 'center';
    g.fillText('Visual unavailable', cw / 2, ch * 0.48);
    g.fillStyle = '#9aa4b2';
    g.font = '400 ' + Math.round(ch * 0.032) + 'px system-ui, sans-serif';
    g.fillText('scene ' + clip.sceneIndex, cw / 2, ch * 0.56);
    g.restore();
  }

  function renderClipVisual(g, cw, ch, clip, localMs) {
    // An LTX clip already contains real camera motion, so the Ken Burns
    // fallback is not just unnecessary — it fights the footage and reads as a
    // second, wrong camera move on top of the intended one.
    if (clip.video) {
      // Checked as the shot becomes active, not only before recording: a range
      // buffered during preparation can be gone by the time the timeline
      // arrives. Non-blocking — it starts a rebuffer and we draw a fallback
      // until the frame lands.
      if (ensureVideoReadyForShot(clip)) {
        driveVideo(clip.video, localMs, clip);
        if (videoDrawable(clip.video)) {
          clip.fallbackUsed = null;
          const fit = fitFor(clip, clip.video, cw, ch);
          (fit === 'contain' ? drawContain : drawCover)(g, clip.video, cw, ch, 1, 0, 0);
          return;
        }
      }
    }

    // Prepared frame first: it is real footage from the correct source position,
    // which a still from elsewhere in the project is not.
    const still = clip.preparedFrame || clip.img || clip.fallbackImg;
    if (clip.video && still) {
      clip.fallbackUsed = clip.preparedFrame === still ? 'prepared frame'
        : (clip.img === still ? 'still image' : 'editorial graphic');
    }
    if (!still) {
      // Nothing at all to draw. A visible marker beats a black frame, because a
      // black frame looks like a rendering choice and this is a fault.
      if (clip.video) clip.fallbackUsed = 'marker';
      drawUnavailable(g, cw, ch, clip);
      return;
    }
    const p = Math.max(0, Math.min(1, localMs / (clip.durationSec * 1000)));
    const t = effectTransform(clip.effect, p);
    // A contained frame is not panned or zoomed: a Ken Burns move on a
    // pillarboxed archival still slides the picture out of its own letterbox.
    const fit = fitFor(clip, still, cw, ch);
    if (fit === 'contain') drawContain(g, still, cw, ch, 1, 0, 0);
    else drawCover(g, still, cw, ch, t.scale, t.tx, t.ty);
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

    // Editorial overlay above the footage and the host, below the captions —
    // it is a graphic element, so it may cover the picture, but it must never
    // cover the words being spoken. Timed on the absolute clock rather than the
    // clip's local one: the overlay was anchored to a moment in the narration,
    // not to an offset within its shot.
    drawEditorialOverlay(g, cw, ch, at.clip, ms);

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

  /**
   * Put a frame of the actual footage on the scene card.
   *
   * The card used to draw clip.img and nothing else, which is wrong for every
   * beat that is a video: clip.img is either absent, or - worse - a stale
   * placeholder. fallbackCard() persists its title card into the storyboard's
   * still store under String(index), so a project assembled once before its
   * footage had been acquired keeps that card on disk permanently. The next
   * assemble then finds it under the still key while the real clip sits under
   * clip:N, so the canvas plays the footage and the strip underneath shows the
   * narration as text. One clip, two different pictures, and the strip is the
   * one that is lying.
   *
   * Drawn from the decoded element rather than re-read from storage, because
   * the element is already loaded and is the same source the canvas draws.
   */
  function paintPoster(imgEl, clip) {
    const v = clip.video;
    if (!v) return;

    const paint = () => {
      const w = v.videoWidth;
      const h = v.videoHeight;
      if (!w || !h) return false;
      const c = document.createElement('canvas');
      const scale = Math.min(1, 320 / w);
      c.width = Math.max(1, Math.round(w * scale));
      c.height = Math.max(1, Math.round(h * scale));
      try {
        c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
        imgEl.src = c.toDataURL('image/jpeg', 0.72);
        return true;
      } catch (e) {
        return false;   // keep whatever the still gave us
      }
    };

    // An archival excerpt is a window into a longer film, so frame zero is
    // usually leader or a slate rather than the shot the Director chose.
    const inPoint = (clip.excerpt && Number.isFinite(Number(clip.excerpt.sourceIn)))
      ? Math.max(0, Number(clip.excerpt.sourceIn))
      : 0;
    // Seek rather than draw whatever is there. readyState >= 2 says a frame is
    // DECODABLE, not that one has been presented, and drawing a paused element
    // straight after load intermittently gives a black rectangle. A seek always
    // decodes and presents the frame at the position asked for, and 'seeked'
    // fires when it has. requestVideoFrameCallback looks like the right tool
    // and is not: it waits for a frame to be PRESENTED, which for an element
    // that is paused and never played does not happen.
    const target = inPoint > 0.05 ? inPoint : 0.05;

    // Safe on a playing clip too: drawFrame reasserts currentTime on the active
    // clip every frame, so a card repositioning an element cannot desync it.
    if (Math.abs((v.currentTime || 0) - target) > 0.02) {
      let done = false;
      const settle = () => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        v.removeEventListener('seeked', settle);
        paint();
      };
      const timer = setTimeout(settle, 2000);
      v.addEventListener('seeked', settle);
      try {
        v.currentTime = Math.min(target, Math.max(0, (v.duration || 1e9) - 0.05));
      } catch (e) {
        settle();
      }
      return;
    }
    paint();
  }

  function renderTimeline() {
    timelineEl.innerHTML = '';
    clips.forEach((clip, i) => {
      const el = document.createElement('div');
      el.className = 'ed-clip';

      const num = document.createElement('div');
      num.className = 'ed-clip-num';
      num.innerHTML = `<span>Scene ${i + 1}</span><span>${clip.camera || ''}</span>`;

      const img = document.createElement('img');
      // The still is only the fallback here. See posterFor().
      if (clip.img) img.src = clip.img.src;
      paintPoster(img, clip);

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

  // What a persisted clip is. Media elements are deliberately absent: an <img>
  // or <video> cannot be serialised, and both are recoverable — stills from the
  // storyboard image store, footage from the stock cache, each keyed by
  // identifiers that ARE saved here.
  /**
   * May this timeline be exported under the project's rights policy?
   *
   * Reads the clips, not the storyboard scenes: once a clip has been replaced
   * or locked the two diverge, and the thing about to be encoded is the clip.
   *
   * Deliberately thin. Classification, policy and the review decision all live
   * in ArchiveLicense / AttributionManager, and a second copy of that reasoning
   * here would be a second answer to a question that must only have one.
   */
  function exportRightsCheck() {
    if (!window.AttributionManager || !window.RightsUI) {
      // No rights system loaded: allow, because refusing on the basis of a
      // missing module would block projects with no archival material at all.
      return { canExport: true, blockers: [], reason: 'rights system not loaded' };
    }
    const scenes = clips.map((c) => ({
      index: c.sceneIndex,
      stockAsset: c.stockAsset || null,
      rightsApproval: c.rightsApproval || null
    }));
    const audit = window.AttributionManager.audit(scenes, window.RightsUI.currentPolicy());
    return {
      canExport: audit.canExport,
      blockers: audit.blockers,
      attributions: audit.attributions,
      policy: window.RightsUI.currentPolicy()
    };
  }

  function serialiseClip(c) {
    return {
      sceneIndex: c.sceneIndex,
      part: c.part || 0,
      subtitle: c.subtitle,
      camera: c.camera,
      durationSec: c.durationSec,
      effect: c.effect,

      // Absolute position on the finished video's clock.
      timelineStart: c.timelineStart,
      timelineEnd: c.timelineEnd,

      // Which slice of a long archival source this shot uses. Without it a
      // reopened project would play the film from its opening title card.
      excerpt: c.excerpt || null,

      // How the frame is fitted — pillarbox for archival 4:3, cover for modern
      // stock. Recomputable from the aspect, but the Director's explicit choice
      // is not.
      treatment: c.treatment || null,

      // Provenance and rights. The one thing that genuinely cannot be
      // reconstructed later: which item this footage came from and on what
      // terms.
      stockAsset: c.stockAsset || null,

      // The editorial card and the moment it was anchored to.
      editorialOverlay: c.editorialOverlay || null,

      // Presenter layout, when the Director placed the host in this beat.
      hostLayout: c.hostLayout || null,

      // A locked clip must come back as the same clip.
      locked: !!c.locked,

      // Review decisions are the user's, and re-asking would be worse than
      // useless — it would invite a different answer to the same question.
      rightsApproval: c.rightsApproval || null
    };
  }

  function saveTimeline() {
    try {
      localStorage.setItem(
        ED_LS,
        JSON.stringify({
          project: project(),
          subStyle,
          transitionsOn,
          // The whole clip, not five fields of it. Everything below is a
          // decision made upstream — by Whisper, by the Director, by the rights
          // gate — and dropping any of it on save means the project cannot be
          // reopened, only rebuilt. `serialiseClip` is the single definition of
          // what a persisted clip is; the package export uses it too, so the two
          // cannot drift.
          timingSource,
          clips: clips.map(serialiseClip)
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
    // Timing authority has to come back too, or a reopened Whisper project
    // would be rescaled to fit the audio on its first render — the exact bug
    // Step 1 removed.
    timingSource = saved.timingSource === 'whisper' ? 'whisper' : 'estimated';

    clips = [];
    for (const c of saved.clips) {
      const blob = await idbGet(SB_DB, SB_STORE, String(c.sceneIndex));
      const clip = { ...c, img: blob ? await loadImage(blob) : null };

      // Footage first, from where the storyboard actually wrote it.
      //
      // This used to go only through the stock cache below, which recovers a
      // clip solely from stockAsset.provider + id. A beat rendered by the video
      // generator, or acquired before that field was carried, has no such pair —
      // so its footage was silently dropped on reload and the scene fell back to
      // whatever sat under the still key. When that still is a placeholder card
      // left by fallbackCard(), a reopened project quietly replaces its video
      // with the narration as text.
      const part = Number(c.part) || 0;
      try {
        const own = await idbGet(SB_DB, SB_STORE,
          part === 0 ? `clip:${c.sceneIndex}` : `clip:${c.sceneIndex}:${part}`);
        if (own && own.size > 0) clip.video = await loadVideo(own);
      } catch (e) {
        console.warn(`[Editor] stored clip for scene ${c.sceneIndex} would not decode: ${e.message}`);
      }

      // Rehydrate footage from the stock cache. It is keyed provider:id, and
      // both halves survive in stockAsset — so a reopened project keeps its
      // archive excerpt as playable video rather than degrading to a still.
      if (!clip.video && c.stockAsset && c.stockAsset.provider && c.stockAsset.id) {
        const key = `${c.stockAsset.provider}:${c.stockAsset.id}`;
        try {
          const media = await idbGet('blvck-stock-cache', 'assets', key);
          if (media && media.size > 0 && c.stockAsset.type !== 'photo') {
            clip.video = await loadVideo(media);
          } else if (media && media.size > 0 && !clip.img) {
            clip.img = await loadImage(media);
          }
        } catch (e) {
          // Cache miss is recoverable — the scene falls back the same way it
          // would for any unavailable source, and says so.
          console.warn(`[Editor] cached media missing for ${key}: ${e.message}`);
        }
      }
      clips.push(clip);
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

      // Before anything is encoded. A blocked asset that reaches the recorder
      // has already been published as far as this code is concerned — the file
      // exists and nothing downstream will re-examine it.
      const rights = exportRightsCheck();
      if (!rights.canExport) {
        const lines = rights.blockers
          .map((b) => `scene ${String(b.index).padStart(2, '0')}: ${b.headline}`);
        showStatus(`Export blocked by the "${rights.policy}" rights policy — `
          + `${rights.blockers.length} scene(s) unresolved. ${lines.join('; ')}. `
          + 'Replace the footage, or review it in the storyboard, then export again.');
        return;
      }

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
      showStatus('Recording in real time — keep this tab visible and in the foreground. '
        + 'A backgrounded tab drops to a much lower frame rate.', 'info');

      const finished = new Promise((resolve) => {
        rec.onstop = () => {
          download(`${project()}.webm`, new Blob(chunks, { type: 'video/webm' }));
          resolve();
        };
      });

      // Every source must be on this machine before the tape rolls. This is a
      // hard gate, not a warning: a network stall during a real-time recording
      // is baked into the file.
      showStatus('Checking that every clip is cached locally…', 'info');
      const local = await validateLocalSources();
      if (!local.ok) {
        const lines = local.problems
          .map((p) => `scene ${String(p.scene).padStart(2, '0')}: ${p.detail}`);
        showStatus(`Export needs every clip cached locally — ${local.problems.length} `
          + `not ready. ${lines.join('; ')}.`, 'warn');
        if (exportVideoBtn) exportVideoBtn.disabled = false;
        return;
      }
      const redownloaded = local.checked.filter((c) => c.redownloaded).length;
      if (redownloaded) {
        showStatus(`Re-downloaded ${redownloaded} clip(s) that were not cached. Continuing…`, 'info');
      }

      // Get every source to its own in-point BEFORE the tape rolls. A file that
      // has not decoded the region it is excerpting cannot be drawn, and once
      // recording starts there is no time left to wait for it.
      showStatus('Preparing sources — seeking each clip to its in-point…', 'info');
      const readiness = await prepareClipsForExport();
      if (readiness.failed.length) {
        const lines = readiness.failed
          .map((f) => `scene ${f.scene}: unavailable at ${f.sourceIn.toFixed(1)}s → ${f.fallback}`);
        showStatus(`${readiness.failed.length} clip(s) could not be prepared. `
          + `Exporting with fallbacks: ${lines.join('; ')}`, 'warn');
      }

      if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
      rec.start();
      if (recDest) activeSources = scheduleAudio(0, recDest);
      const start = performance.now();
      // The recording runs at wall-clock speed, so video clips must play rather
      // than be seeked frame by frame.
      realtime = true;
      const loop = await driveRealtimeLoop(total, (ms) => renderTo(g, w, h, ms));
      if (loop.usedFallback) {
        console.warn('[Editor] export ran partly on the timer fallback — the tab '
          + 'was backgrounded, so the frame rate will be uneven.');
      }
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
        // Same definition as the local save, plus where the still sits in the
        // package. A package that carried less than the browser's own save
        // would be a lossy export dressed as an archive.
        timingSource,
        clips: clips.map((c, i) => Object.assign(serialiseClip(c), {
          order: i + 1,
          image: `images/scene-${String(i + 1).padStart(3, '0')}.png`
        }))
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

  /**
   * Push the current subtitle style onto the controls.
   *
   * Guarded, because two of these controls are not in the page: #ed-sub-pos and
   * #ed-crossfade have no markup, so $() returns null for both. Every LISTENER
   * below already guards for exactly that; this function did not, so it threw
   * TypeError on the first missing one.
   *
   * That mattered far beyond the subtitle controls. restoreTimeline() calls
   * this before it rebuilds the clips, so the throw aborted the restore — and a
   * reopened project came back with an EMPTY editor no matter what had been
   * assembled into it. It only ever fired when a saved timeline existed, which
   * is why the editor looked fine right up until you reloaded the page.
   */
  function applySubControls() {
    if (subFont) subFont.value = subStyle.font;
    if (subSize) subSize.value = subStyle.size;
    if (subSizeVal) subSizeVal.textContent = subStyle.size;
    if (subPos) subPos.value = subStyle.pos;
    if (subColor) subColor.value = subStyle.color;
    if (subOn) subOn.checked = subStyle.on;
    if (crossfadeToggle) crossfadeToggle.checked = transitionsOn;
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

  // --- Timing surface ------------------------------------------------------
  //
  // The timing rules decide what the exported video actually shows, so they
  // need to be testable without a canvas, an audio context or a storyboard in
  // localStorage. Exposed deliberately narrow: the four functions that answer
  // "which clip, at what point in its source, at this moment" — plus a way to
  // set up the state they read.
  window.BlvckEditorTiming = {
    clipAt,
    videoDrawable,
    prepareClipsForExport,
    setReadinessTimeout,
    serialiseClip,
    exportRightsCheck,
    validateLocalSources,
    sourceIsLocal,
    driveRealtimeLoop,
    ensureVideoReadyForShot,
    shotDiagnostics,
    getReadinessTimeout: () => readinessTimeoutMs,
    renderErrors,
    noteRenderError,
    drawContain,
    fitFor,
    overlayActiveAt,
    drawEditorialOverlay,
    renderTo,
    totalMs,
    rescaleClipsToAudio,
    driveVideo,
    validateTimeline,
    authoritative,
    _setState({ clips: c, audio: a, timingSource: t, realtime: r }) {
      if (Array.isArray(c)) clips = c;
      if (a) audio = a;
      if (typeof t === 'string') timingSource = t;
      if (typeof r === 'boolean') realtime = r;
    },
    _getState: () => ({ clips, audio, timingSource, realtime })
  };

  // --- Init --------------------------------------------------------------

  (async () => {
    card.hidden = false;
    await restoreTimeline();
  })();
})();
