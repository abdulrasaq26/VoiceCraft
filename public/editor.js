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

  const SB_LS = 'blvck-tts:storyboard';
  const SB_DB = 'blvck-storyboard';
  const SB_STORE = 'images';
  const AUDIO_LS = 'blvck-tts:batch';
  const AUDIO_DB = 'blvck-tts';
  const AUDIO_STORE = 'audio';
  const ED_LS = 'blvck-tts:editor';

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
  let audio = { buffers: [], offsets: [], totalMs: 0 };

  // Playback state
  let playing = false;
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

  // --- Timeline math -----------------------------------------------------

  function hmsToSec(s) {
    const m = String(s).match(/(\d{1,2}):(\d{2}):(\d{2})/);
    return m ? +m[1] * 3600 + +m[2] * 60 + +m[3] : 0;
  }
  function clipDuration(ts) {
    if (!ts) return 4;
    const parts = ts.split(/\s*-\s*/);
    if (parts.length < 2) return 4;
    const d = hmsToSec(parts[1]) - hmsToSec(parts[0]);
    return d >= 1 ? d : 4;
  }
  function autoEffect(i, camera) {
    const c = (camera || '').toLowerCase();
    if (c.includes('close') || c.includes('object')) return i % 2 ? 'push-in' : 'zoom-in';
    if (c.includes('wide') || c.includes('environment') || c.includes('establish')) return i % 2 ? 'zoom-out' : 'pull-back';
    if (c.includes('crowd')) return 'pan-right';
    return EFFECTS[i % EFFECTS.length];
  }
  function totalMs() {
    return clips.reduce((a, c) => a + c.durationSec * 1000, 0);
  }
  function clipAt(ms) {
    let acc = 0;
    for (const c of clips) {
      const end = acc + c.durationSec * 1000;
      if (ms < end) return { clip: c, localMs: ms - acc, startMs: acc };
      acc = end;
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

  async function loadAudio() {
    audio = { buffers: [], offsets: [], totalMs: 0 };
    let meta;
    try {
      meta = JSON.parse(localStorage.getItem(AUDIO_LS) || 'null');
    } catch {
      meta = null;
    }
    if (!meta || !meta.items) return;
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    let acc = 0;
    for (const item of meta.items) {
      const blob = await idbGet(AUDIO_DB, AUDIO_STORE, `${meta.id}:${item.index}`);
      if (!blob) continue;
      try {
        const buf = await audioCtx.decodeAudioData(await blob.arrayBuffer());
        audio.buffers.push(buf);
        audio.offsets.push(acc);
        acc += buf.duration * 1000;
      } catch {
        /* skip undecodable part */
      }
    }
    audio.totalMs = acc;
  }

  async function assemble() {
    clearStatus();
    let sb;
    try {
      sb = JSON.parse(localStorage.getItem(SB_LS) || 'null');
    } catch {
      sb = null;
    }
    const scenes = (sb && sb.scenes) || [];
    const done = scenes.filter((s) => s.status === 'done');
    if (!done.length) {
      showStatus('No generated storyboard images found. Generate a storyboard first (its images are the video scenes).');
      return;
    }
    assembleBtn.disabled = true;
    summaryEl.textContent = 'Assembling…';

    clips = [];
    for (let i = 0; i < done.length; i++) {
      const s = done[i];
      const blob = await idbGet(SB_DB, SB_STORE, String(s.index));
      if (!blob) continue;
      const img = await loadImage(blob);
      clips.push({
        sceneIndex: s.index,
        subtitle: s.subtitle || s.sceneSummary || '',
        camera: s.camera || '',
        durationSec: Math.min(12, Math.max(2.5, clipDuration(s.timestamp))),
        effect: autoEffect(i, s.camera),
        img
      });
    }
    if (!clips.length) {
      showStatus('Storyboard scenes found but their images could not be loaded.');
      assembleBtn.disabled = false;
      return;
    }
    await loadAudio();
    assembleBtn.disabled = false;

    stage.hidden = false;
    offsetMs = 0;
    saveTimeline();
    renderTimeline();
    drawFrame(0);
    const secs = Math.round(totalMs() / 1000);
    summaryEl.textContent = `${clips.length} scenes · ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}${
      audio.totalMs ? ' · narration loaded' : ' · no narration audio found'
    }`;
    showStatus('Rough cut assembled. Press play to preview, then export.', 'info');
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
    const ir = img.width / img.height;
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

  function renderTo(g, cw, ch, ms) {
    g.fillStyle = '#000';
    g.fillRect(0, 0, cw, ch);
    const at = clipAt(ms);
    if (!at) return;
    const p = Math.max(0, Math.min(1, at.localMs / (at.clip.durationSec * 1000)));
    const t = effectTransform(at.clip.effect, p);
    drawCover(g, at.clip.img, cw, ch, t.scale, t.tx, t.ty);
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
    const now = audioCtx.currentTime;
    audio.buffers.forEach((buf, i) => {
      const partStart = audio.offsets[i];
      const partEnd = partStart + buf.duration * 1000;
      if (partEnd <= fromMs) return;
      const src = audioCtx.createBufferSource();
      src.buffer = buf;
      src.connect(dest);
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

  function tick() {
    const ms = offsetMs + (performance.now() - clockStart);
    if (ms >= totalMs()) {
      drawFrame(totalMs());
      stop();
      return;
    }
    drawFrame(ms);
    rafId = requestAnimationFrame(tick);
  }

  async function play() {
    if (playing) return;
    if (audioCtx && audioCtx.state === 'suspended') await audioCtx.resume();
    playing = true;
    playBtn.textContent = '⏸ Pause';
    clockStart = performance.now();
    if (offsetMs >= totalMs()) offsetMs = 0;
    activeSources = scheduleAudio(offsetMs, audioCtx ? audioCtx.destination : null);
    rafId = requestAnimationFrame(tick);
  }

  function pause() {
    if (!playing) return;
    offsetMs += performance.now() - clockStart;
    stopPlayback();
  }

  function stop() {
    offsetMs = 0;
    stopPlayback();
    drawFrame(0);
  }

  function stopPlayback() {
    playing = false;
    playBtn.textContent = '▶ Play';
    cancelAnimationFrame(rafId);
    stopAudio();
  }

  // --- Timeline UI -------------------------------------------------------

  function renderTimeline() {
    timelineEl.innerHTML = '';
    clips.forEach((clip, i) => {
      const el = document.createElement('div');
      el.className = 'ed-clip';

      const num = document.createElement('div');
      num.className = 'ed-clip-num';
      num.innerHTML = `<span>Scene ${clip.sceneIndex}</span><span>${clip.camera}</span>`;

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
      clip.img = await loadImage(f);
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
    if (!clips.length) return;
    if (!window.MediaRecorder) {
      showStatus('This browser can’t record video. Use the editor package export instead.');
      return;
    }
    pause();
    const h = Number(resSel.value);
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
    exportVideoBtn.disabled = true;
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
    await new Promise((resolve) => {
      const step = () => {
        const ms = performance.now() - start;
        renderTo(g, w, h, Math.min(ms, total));
        if (ms >= total) return resolve();
        requestAnimationFrame(step);
      };
      step();
    });
    stopAudio();
    rec.stop();
    await finished;
    exportVideoBtn.disabled = false;
    showStatus('Video exported (WebM). For a 4K MP4, use the editor package + your video tool.', 'info');
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
    if (!clips.length) return;
    const enc = new TextEncoder();
    const files = [];
    for (let i = 0; i < clips.length; i++) {
      const blob = await idbGet(SB_DB, SB_STORE, String(clips[i].sceneIndex));
      if (blob) {
        files.push({ name: `images/scene-${String(i + 1).padStart(3, '0')}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
      }
    }
    // Narration audio parts
    try {
      const meta = JSON.parse(localStorage.getItem(AUDIO_LS) || 'null');
      if (meta && meta.items) {
        for (const item of meta.items) {
          const blob = await idbGet(AUDIO_DB, AUDIO_STORE, `${meta.id}:${item.index}`);
          if (blob) files.push({ name: `audio/part-${String(item.part).padStart(3, '0')}.${meta.ext || 'mp3'}`, data: new Uint8Array(await blob.arrayBuffer()) });
        }
      }
    } catch {
      /* no audio */
    }
    const edl = {
      project: project(),
      fps: 30,
      resolution: `${resSel.value}p`,
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
          'edl.json — scene order, durations, motion effects and subtitle style\n\n' +
          'Import these into Premiere / DaVinci Resolve / CapCut, or render a 4K MP4 with\n' +
          'ffmpeg using edl.json (each clip = one image held for durationSec with a Ken Burns\n' +
          'zoom/pan, narration audio muxed, subtitles.srt burned or attached).\n'
      )
    });
    download(`${project()} editor package.zip`, window.BlvckZip.create(files));
  }

  // --- Sub controls ------------------------------------------------------

  function applySubControls() {
    subFont.value = subStyle.font;
    subSize.value = subStyle.size;
    subSizeVal.textContent = subStyle.size;
    subPos.value = subStyle.pos;
    subColor.value = subStyle.color;
    subOn.checked = subStyle.on;
  }

  // --- Events ------------------------------------------------------------

  assembleBtn.addEventListener('click', assemble);
  playBtn.addEventListener('click', () => (playing ? pause() : play()));
  seek.addEventListener('input', () => {
    pause();
    offsetMs = (Number(seek.value) / 1000) * totalMs();
    drawFrame(offsetMs);
  });
  subFont.addEventListener('change', () => {
    subStyle.font = subFont.value;
    saveTimeline();
    drawFrame(offsetMs);
  });
  subSize.addEventListener('input', () => {
    subStyle.size = Number(subSize.value);
    subSizeVal.textContent = subStyle.size;
    drawFrame(offsetMs);
  });
  subSize.addEventListener('change', saveTimeline);
  subPos.addEventListener('change', () => {
    subStyle.pos = subPos.value;
    saveTimeline();
    drawFrame(offsetMs);
  });
  subColor.addEventListener('input', () => {
    subStyle.color = subColor.value;
    drawFrame(offsetMs);
  });
  subColor.addEventListener('change', saveTimeline);
  subOn.addEventListener('change', () => {
    subStyle.on = subOn.checked;
    saveTimeline();
    drawFrame(offsetMs);
  });
  exportVideoBtn.addEventListener('click', exportVideo);
  exportPkgBtn.addEventListener('click', exportPackage);

  function storyboardReady() {
    let sb = null;
    try {
      sb = JSON.parse(localStorage.getItem(SB_LS) || 'null');
    } catch {
      sb = null;
    }
    return Boolean(sb && sb.scenes && sb.scenes.some((s) => s.status === 'done'));
  }

  // Reveal the editor as soon as the storyboard produces images this session.
  window.addEventListener('blvck-storyboard-updated', () => {
    if (card.hidden && storyboardReady()) card.hidden = false;
  });

  // --- Init --------------------------------------------------------------

  (async () => {
    if (!storyboardReady() && !localStorage.getItem(ED_LS)) return;
    card.hidden = false;
    await restoreTimeline();
  })();
})();
