// Multi-scene LTX video pipeline.
//
// Turns finished storyboard scenes into video clips, one scene at a time, and
// keeps the result aligned with the narration.
//
// Three decisions drive the design:
//
// 1. Scene-by-scene, never one giant prompt. Each clip gets its own references
//    and its own duration, which is the only way continuity and A/V sync both
//    survive.
// 2. References beat text. The MSR LoRA conditions on actual pixels, so a
//    character's stored portrait does far more for consistency than any amount
//    of describing their face. Text fills in what pixels cannot: action, camera,
//    light, weather.
// 3. Duration comes from the audio, not from the model. Each scene's timestamp
//    was derived from measured narration, so that is what the clip must match —
//    the backend renders the next size up and trims to the exact length.
(() => {
  'use strict';

  const SB_LS = 'blvck-tts:storyboard';
  const DB_NAME = 'blvck-storyboard';
  const STORE = 'images';
  const STATE_LS = 'blvck-tts:ltx-clips';

  const clipKey = (index) => `clip:${index}`;

  // --- storage -------------------------------------------------------------

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

  async function idbGet(key) {
    try {
      const db = await idbOpen();
      const val = await new Promise((res, rej) => {
        const tx = db.transaction(STORE, 'readonly');
        const rq = tx.objectStore(STORE).get(key);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => rej(rq.error);
      });
      db.close();
      return val;
    } catch {
      return null;
    }
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
      return true;
    } catch {
      return false;
    }
  }

  function readState() {
    try {
      const v = JSON.parse(localStorage.getItem(STATE_LS) || '{}');
      return v && typeof v === 'object' ? v : {};
    } catch {
      return {};
    }
  }

  function writeState(s) {
    try {
      localStorage.setItem(STATE_LS, JSON.stringify(s));
    } catch {
      /* non-fatal */
    }
    try {
      window.dispatchEvent(new CustomEvent('blvck:ltx-changed'));
    } catch {
      /* no-op */
    }
  }

  function scenes() {
    try {
      const sb = JSON.parse(localStorage.getItem(SB_LS) || 'null');
      return (sb && Array.isArray(sb.scenes) && sb.scenes) || [];
    } catch {
      return [];
    }
  }

  // --- timing --------------------------------------------------------------

  function hmsToSec(ts) {
    const m = String(ts || '').trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d{1,3}))?$/);
    if (!m) return null;
    const [, h, mm, ss, ms] = m;
    return (Number(h || 0) * 3600) + (Number(mm) * 60) + Number(ss) + (Number(ms || 0) / 1000);
  }

  // A scene's slice of the narration. Same parsing the editor uses, so the two
  // agree about how long this shot is on screen.
  function sceneDuration(scene) {
    const parts = String((scene && scene.timestamp) || '').split(/\s*-\s*/);
    if (parts.length < 2) return 5;
    const a = hmsToSec(parts[0]);
    const b = hmsToSec(parts[1]);
    if (a == null || b == null) return 5;
    const d = b - a;
    return d >= 1 ? d : 5;
  }

  // --- prompt construction -------------------------------------------------

  // LTX responds to plain cinematographic prose, not to labels. These translate
  // our controlled vocabulary into the phrasing the model was trained on.
  const MOVE_TEXT = {
    'Static': 'static locked-off camera',
    'Slow Push In': 'slow push in',
    'Dolly In': 'smooth dolly in',
    'Dolly Out': 'smooth dolly out',
    'Pan Left': 'camera pans left',
    'Pan Right': 'camera pans right',
    'Crane Up': 'crane rises upward',
    'Crane Down': 'crane descends',
    'Handheld': 'handheld camera with subtle natural shake',
    'Drone': 'aerial drone shot'
  };

  const SHOT_TEXT = {
    'Extreme Wide': 'extreme wide shot',
    'Wide': 'wide shot',
    'Medium': 'medium shot',
    'Close Up': 'close-up',
    'Extreme Close Up': 'extreme close-up',
    'Over Shoulder': 'over-the-shoulder shot',
    'POV': 'point-of-view shot'
  };

  function styleText(vs) {
    if (!vs) return '';
    if (typeof vs === 'string') return vs;
    return [vs.description || vs.name, vs.lighting, vs.colorGrading]
      .map((s) => String(s || '').trim())
      .filter(Boolean)
      .join(', ');
  }

  /**
   * Build the LTX prompt for a scene.
   *
   * Deliberately does NOT reuse the storyboard's still-image prompt verbatim:
   * that prompt describes a frozen instant, while LTX needs to know what moves.
   * The action and motion lead, then the camera, then the people, then the
   * world, then the grade.
   */
  function promptFor(scene, bible) {
    const s = scene || {};
    const bits = [];

    // Presenter beats describe the HOST in their set, not the story world.
    if (String(s.visualType || '') === 'presenter' && window.BlvckHost && window.BlvckHost.isConfigured()) {
      const shotP = SHOT_TEXT[s.shotType] || 'medium shot';
      const moveP = MOVE_TEXT[s.cameraMovement] || MOVE_TEXT.Static;
      const host = window.BlvckHost.descriptor();
      const back = window.BlvckHost.backgroundText();
      const said = String(s.detectedAction || s.sceneSummary || '').trim();
      return [
        `${shotP}, ${moveP}`,
        host ? `${host}, speaking directly to camera` : 'a presenter speaking directly to camera',
        back,
        said,
        s.emotion ? `mood: ${String(s.emotion).trim()}` : '',
        styleText(bible && bible.visualStyle)
      ].filter(Boolean).join('. ');
    }

    const shot = SHOT_TEXT[s.shotType] || '';
    const move = MOVE_TEXT[s.cameraMovement] || MOVE_TEXT.Static;
    if (shot) bits.push(`${shot}, ${move}`);
    else bits.push(move);

    // What actually happens.
    const action = String(s.detectedAction || s.sceneSummary || s.subtitle || '').trim();
    if (action) bits.push(action);

    // What moves. Without this LTX tends to produce a near-still frame.
    const motion = String(s.motion || '').trim();
    if (motion) bits.push(motion);

    // Who is in it — canonical descriptors, identical every time they appear.
    if (window.BlvckCast) {
      const cast = window.BlvckCast.promptBlockFor(s.characters || []);
      if (cast) bits.push(cast);
    }

    // Where and when.
    const world = [s.environment, s.timeOfDay, s.weather, s.lighting]
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .join(', ');
    if (world) bits.push(world);

    if (s.emotion) bits.push(`mood: ${String(s.emotion).trim()}`);

    const style = styleText(bible && bible.visualStyle);
    if (style) bits.push(style);

    return bits.filter(Boolean).join('. ');
  }

  // --- reference assembly --------------------------------------------------

  function blobToBase64(blob) {
    return new Promise((resolve) => {
      const r = new FileReader();
      r.onload = () => {
        const url = String(r.result || '');
        const i = url.indexOf(',');
        resolve(i > -1 ? url.slice(i + 1) : '');
      };
      r.onerror = () => resolve('');
      r.readAsDataURL(blob);
    });
  }

  /**
   * Decide the mode and gather reference images for a scene.
   *
   * KI puts the storyboard still first as the background plate and adds the
   * cast behind it — the strongest option, because the scene keeps the
   * composition we already approved AND the faces stay locked.
   *
   * With only a still and no cast, KI is unavailable (it needs 2+ images), so
   * the still goes in as a lone subject under I.
   */
  // Beats that are TYPESET, not generated. Charts, maps, timelines and
  // whiteboards are made of text and precise shapes — exactly what diffusion
  // models cannot draw. They go to the canvas renderer, never to the GPU.
  const CANVAS_TYPES = ['whiteboard', 'chart', 'map', 'timeline'];

  function rendersOnCanvas(scene) {
    return CANVAS_TYPES.indexOf(String((scene && scene.visualType) || '')) > -1;
  }

  // Beats the video model can render from the script alone — no storyboard
  // still required, which is the whole point of the text-to-video workflow.
  function isTextDriven(scene) {
    const vt = String((scene && scene.visualType) || '');
    return vt === 't2v' || vt === 'broll' || vt === 'presenter';
  }

  async function referencesFor(scene) {
    const vt = String(scene.visualType || 't2v');

    if (rendersOnCanvas({ visualType: vt })) {
      return { mode: 'CANVAS', images: [], usedStill: false, usedCast: [] };
    }

    // Presenter beats are the exception the host system exists for: the face is
    // a fixed uploaded asset, so it IS conditioned on references.
    if (vt === 'presenter' && window.BlvckHost && window.BlvckHost.isConfigured()) {
      const refs = await window.BlvckHost.referenceBase64List();
      if (refs.length) {
        return { mode: 'I', images: refs.slice(0, 4), usedStill: false, usedCast: ['(host)'] };
      }
    }

    // Text-to-video is the primary content path: the script describes the
    // moment and the model renders it, with no image standing in the way.
    // Content beats have no recurring face to hold, so reference conditioning
    // buys nothing and costs composition freedom.
    //
    // This is also the fallback for a presenter beat with no uploaded face —
    // a generic presenter beats failing the scene outright.
    if (vt === 't2v' || vt === 'broll' || vt === 'presenter') {
      return { mode: 'T2V', images: [], usedStill: false, usedCast: [] };
    }

    const still = await idbGet(String(scene.index));
    const names = Array.isArray(scene.characters) ? scene.characters.filter(Boolean) : [];

    const portraits = [];
    if (window.BlvckCast) {
      for (const n of names) {
        // KI caps at 5 images total; the still takes one slot.
        if (portraits.length >= 4) break;
        const b64 = await window.BlvckCast.referenceBase64(n);
        if (b64) portraits.push({ name: n, b64 });
      }
    }

    if (still && portraits.length) {
      const cap = portraits.slice(0, 4);
      return {
        mode: 'KI',
        images: [await blobToBase64(still)].concat(cap.map((p) => p.b64)),
        usedStill: true,
        usedCast: cap.map((p) => p.name)
      };
    }
    if (still) {
      return { mode: 'I', images: [await blobToBase64(still)], usedStill: true, usedCast: [] };
    }
    if (portraits.length) {
      const cap = portraits.slice(0, 4);
      return { mode: 'I', images: cap.map((p) => p.b64), usedStill: false, usedCast: cap.map((p) => p.name) };
    }
    return { mode: 'I', images: [], usedStill: false, usedCast: [] };
  }

  // --- generation ----------------------------------------------------------

  let cancelled = false;
  let running = false;

  function cancel() {
    cancelled = true;
  }

  function isRunning() {
    return running;
  }

  function status(index) {
    return readState()[String(index)] || null;
  }

  // Whole map in one read. Callers that need many statuses must use this —
  // looping status() re-parses localStorage on every single lookup.
  function allStatus() {
    return readState();
  }

  // A finished beat is a finished beat: a typeset card is as complete as a
  // rendered clip. Counting only 'done' reported "0/6 rendered" while two
  // canvas beats sat there successfully drawn.
  function doneCount() {
    return Object.values(readState())
      .filter((r) => r && (r.status === 'done' || r.status === 'canvas')).length;
  }

  async function clipBlob(index) {
    return idbGet(clipKey(index));
  }

  function bible() {
    try {
      const sb = JSON.parse(localStorage.getItem(SB_LS) || 'null');
      return (sb && sb.bible) || null;
    } catch {
      return null;
    }
  }

  /** Generate one scene. Returns the state record written for it. */
  async function generateScene(scene, opts = {}) {
    const st = readState();
    const key = String(scene.index);
    const bib = opts.bible || bible();

    try {
      const refs = await referencesFor(scene);

      // Typeset beats never reach the GPU — the canvas renderer draws them, and
      // it draws real text correctly. Stored under the scene's own image key so
      // the editor picks them up exactly like a generated still.
      if (refs.mode === 'CANVAS') {
        if (!window.BlvckGraphic) throw new Error('graphic renderer unavailable');
        const g = scene.graphic || {};
        const blob = await window.BlvckGraphic.render({
          kind: scene.visualType,
          title: g.title || scene.sceneSummary || scene.subtitle || '',
          subtitle: g.subtitle || '',
          items: g.items || [],
          value: g.value || '',
          label: g.label || '',
          palette: window.BlvckGraphic.paletteFor(
            [scene.sceneSummary, scene.subtitle, g.title].filter(Boolean).join(' ')
          )
        });
        await idbPut(String(scene.index), blob);
        try {
          window.dispatchEvent(new CustomEvent('blvck:clip-rendered', {
            detail: { index: scene.index, kind: 'image' }
          }));
        } catch {
          /* no-op */
        }
        st[key] = {
          status: 'canvas',
          visualType: scene.visualType,
          bytes: blob.size,
          at: Date.now()
        };
        writeState(st);
        return st[key];
      }

      // Reference modes need pixels; T2V by definition does not.
      if (refs.mode !== 'T2V' && !refs.images.length) {
        throw new Error(
          `mode ${refs.mode} needs a reference image but none was available for this scene`
        );
      }

      // LTX tops out at 30s. ffmpeg can trim a clip DOWN to the narration
      // length but obviously cannot stretch one up, so a longer beat would come
      // back short and freeze on its last frame for the remainder of the shot.
      // Clamp deliberately and record it, rather than let it look like the
      // model quietly under-delivered.
      const MAX_SEC = 30;
      const wanted = Math.round((opts.targetSec || sceneDuration(scene)) * 1000) / 1000;
      const targetSec = Math.min(wanted, MAX_SEC);
      const truncated = wanted > MAX_SEC;
      const prompt = promptFor(scene, bib);
      // Same seed the still used, so the clip stays in the same neighbourhood
      // of latent space as the frame the user already approved.
      const seed = Number.isFinite(scene.seed)
        ? scene.seed
        : (window.BlvckCast && (scene.characters || [])[0]
          ? window.BlvckCast.seedFor(scene.characters[0])
          : -1);

      const { blob, meta } = await window.LTXAdapter.generateScene({
        prompt,
        images: refs.images,
        mode: refs.mode,
        seed,
        targetSec,
        resolution: opts.resolution || '720p',
        aspect: opts.aspect || '16:9 Landscape',
        guideScale: opts.guideScale,
        steps: opts.steps,
        msrScale: opts.msrScale,
        outputHeight: opts.outputHeight,
        // Renders run for minutes; surface the wait rather than freezing the UI.
        onProgress: opts.onSceneProgress,
        // Write the job id down the instant it exists. The GPU keeps working
        // whatever the browser does, so as long as we still hold the id the
        // result can be collected after a reload, a crash, or a closed tab.
        onEnqueued: (jobId) => {
          const cur = readState();
          cur[key] = Object.assign({}, cur[key], {
            status: 'rendering',
            jobId,
            visualType: scene.visualType,
            startedAt: Date.now()
          });
          writeState(cur);
        }
      });

      await idbPut(clipKey(scene.index), blob);
      // Tell the storyboard a clip exists, so the scene card stops showing
      // whatever failure it was left with and starts showing the footage.
      // Without this a rendered beat still displays the old SDXL error and a
      // Retry button, which reads as "nothing happened".
      try {
        window.dispatchEvent(new CustomEvent('blvck:clip-rendered', {
          detail: { index: scene.index, kind: 'video' }
        }));
      } catch {
        /* no-op */
      }
      st[key] = {
        status: 'done',
        mode: refs.mode,
        seed: meta.seed,
        usedStill: refs.usedStill,
        usedCast: refs.usedCast,
        generatedSec: meta.generated_sec,
        finalSec: meta.final_sec,
        // The scene needs more screen time than LTX can render in one go; the
        // clip will hold its last frame for the remainder.
        truncated,
        shortBy: truncated ? Math.round((wanted - MAX_SEC) * 10) / 10 : 0,
        bytes: blob.size,
        prompt,
        at: Date.now()
      };
      writeState(st);
      return st[key];
    } catch (err) {
      // A lost connection is not a lost render. Keep the scene marked
      // 'rendering' with its job id so collectPending() can pick the result up
      // once the tunnel recovers — marking it 'error' here is what caused the
      // same beat to be queued three times.
      const cur = readState();
      const prev = cur[key] || {};
      if (err && err.recoverable && prev.jobId) {
        cur[key] = Object.assign({}, prev, { status: 'rendering', lastError: err.message, at: Date.now() });
      } else {
        cur[key] = { status: 'error', error: err.message, at: Date.now() };
      }
      writeState(cur);
      throw err;
    }
  }

  /**
   * Run the whole storyboard.
   *
   * Serial by necessity — the notebook launches uvicorn against a single GPU
   * with max_threads=1, so concurrent requests would queue on the backend
   * anyway, but with no progress reporting and a much higher chance of an OOM.
   *
   * Already-rendered scenes are skipped unless `regenerate` is set, which makes
   * this safe to re-run after a Kaggle session drops mid-way.
   */
  async function generateAll(opts = {}) {
    if (running) throw new Error('An LTX render is already running.');
    running = true;
    cancelled = false;

    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {};
    // Every PLANNED scene is renderable: text-driven beats need no still and
    // canvas beats draw themselves. Only an unplanned scene is skipped, and
    // planWithDirector is what fixes that. Requiring status 'done' here was a
    // leftover from when every scene had to be animated from an image.
    const all = scenes().filter((s) => s.visualType || s.status === 'done');
    // Collect anything already finished on the GPU before deciding what is
    // left, so a scene whose render completed while the browser was away is
    // not queued a second time.
    if (!opts.regenerate && pendingCount()) {
      try {
        await collectPending();
      } catch {
        /* best effort — a failed collect must not block the run */
      }
    }

    const st = readState();
    const todo = opts.regenerate
      ? all
      : all.filter((s) => {
        const rec = st[String(s.index)];
        if (!rec) return true;
        // Done and canvas beats are finished. 'rendering' means the GPU is
        // ALREADY working on this scene: re-queueing it burns another full
        // render for a duplicate result. Three identical jobs were observed
        // in flight for one beat before this check existed.
        return rec.status !== 'done' && rec.status !== 'canvas' && rec.status !== 'rendering';
      });

    const result = { total: todo.length, done: 0, failed: 0, skipped: all.length - todo.length, errors: [] };
    const bib = bible();

    try {
      for (let i = 0; i < todo.length; i++) {
        if (cancelled) break;
        const scene = todo[i];
        onProgress({ phase: 'start', index: scene.index, i, total: todo.length, scene });
        try {
          const rec = await generateScene(scene, Object.assign({ bible: bib }, opts));
          result.done++;
          onProgress({ phase: 'done', index: scene.index, i, total: todo.length, rec });
        } catch (err) {
          result.failed++;
          result.errors.push({ index: scene.index, error: err.message });
          onProgress({ phase: 'error', index: scene.index, i, total: todo.length, error: err.message });
          if (opts.stopOnError) break;
        }
      }
    } finally {
      running = false;
    }

    result.cancelled = cancelled;
    return result;
  }

  // Seconds of GPU time per second of finished video, MEASURED on a Kaggle T4
  // at 8 steps. Two real data points, same prompt and seed:
  //
  //   480p (832x480, 399k px)   5s clip -> 301s   =  60.2 s/s
  //   720p (1248x704, 879k px)  5s clip -> 758s   = 151.6 s/s
  //
  // Cost tracks pixel count closely (2.20x the pixels, 2.52x the time), so the
  // untested resolutions are scaled from 480p by area rather than guessed. The
  // previous version of this function was invented and wrong by roughly 20x,
  // which is worse than having no estimate at all — a number on screen gets
  // believed.
  // Cost is NOT proportional to clip length. Measured on a Kaggle T4, 480p,
  // 8 steps, same prompt and seed:
  //
  //    2s ( 49 frames)  269s
  //    3s ( 73 frames)  302s
  //    5s (121 frames)  301s     <- 60 s per second of video, the sweet spot
  //   15s (361 frames) 1200s     <- 80 s/s, markedly worse
  //
  // There is a hard floor around 300s that even a 2s clip pays, and beyond
  // about 5s the marginal cost climbs steeply. So a 15s beat rendered as three
  // 5s clips costs ~900s instead of 1200s -- 25% cheaper AND better paced,
  // since the retention check wants shot variety anyway.
  //
  // Two earlier versions of this were guesses: first "cost scales with
  // duration" (wrong), then "duration barely matters" (also wrong, from three
  // points that happened to sit under the floor). This one is fitted to all
  // four measurements and reproduces each within 2%.
  const CLIP_FLOOR_SEC = 300;   // 480p; nothing is faster than this
  const FLOOR_COVERS_SEC = 5;   // the floor already pays for this much video
  const MARGINAL_SEC = 90;      // 480p cost of each extra second beyond that

  // Scaled by pixel count, anchored on the measured 480p/720p pair
  // (758/301 = 2.52 at 5s).
  const RES_SCALE = { '480p': 1, '540p': 1.31, '720p': 2.52, '1080p': 5.23 };

  /** GPU seconds for one clip of `sec` seconds at `resolution`. */
  function clipCostSec(sec, resolution) {
    const scale = RES_SCALE[resolution] || RES_SCALE['480p'];
    return (CLIP_FLOOR_SEC + Math.max(0, sec - FLOOR_COVERS_SEC) * MARGINAL_SEC) * scale;
  }

  /**
   * Wall-clock estimate for rendering a set of scenes.
   *
   * Uses the duration LTX will actually render, not the narration length:
   * a 6.4s beat is rendered at 8s and trimmed, so it costs 8s of GPU time.
   * Canvas beats cost nothing.
   */
  function estimateMinutes(sceneList, resolution) {
    const res = resolution || '480p';
    const list = sceneList || scenes().filter((s) => s.visualType || s.status === 'done');
    const gpuSec = list.reduce((a, s) => {
      if (rendersOnCanvas(s)) return a;
      const target = Math.min(sceneDuration(s), 30);
      const rendered = window.LTXAdapter ? window.LTXAdapter.pickDuration(target) : Math.ceil(target);
      return a + clipCostSec(rendered, res);
    }, 0);
    return Math.round(gpuSec / 60);
  }

  /**
   * What a full run will cost, broken down. The point is to make an
   * unaffordable plan visible BEFORE it starts, not after two hours.
   */
  function estimateRun(resolution) {
    // Must use the SAME filter as generateAll, or the summary describes a
    // different run from the one the button performs. Filtering on
    // isTextDriven() dropped canvas beats before counting them, so a 6-beat
    // storyboard reported "4 total, 0 drawn instantly".
    const list = scenes().filter((s) => s.visualType || s.status === 'done');
    const st = readState();
    const todo = list.filter((s) => !(st[String(s.index)] && st[String(s.index)].status === 'done'));
    const gpu = todo.filter((s) => !rendersOnCanvas(s));
    const canvas = todo.length - gpu.length;
    const minutes = estimateMinutes(gpu, resolution);
    return {
      total: list.length,
      todo: todo.length,
      gpuBeats: gpu.length,
      canvasBeats: canvas,
      minutes,
      hours: Math.round((minutes / 60) * 10) / 10,
      resolution: resolution || '480p'
    };
  }

  function reset() {
    writeState({});
  }

  /**
   * Reconnect to renders this browser started but never collected.
   *
   * The GPU does not care what the browser is doing: once /generate returns a
   * job id, the work continues and the finished mp4 sits on the backend
   * regardless of reloads, crashes or closed tabs. The only thing that gets
   * lost is the id — so it is written to storage the moment it exists, and
   * this walks those ids back.
   *
   * Safe to run at any time: it only touches scenes recorded as 'rendering',
   * and only downloads jobs the backend reports as done.
   */
  async function collectPending(opts = {}) {
    const st = readState();
    const pending = Object.entries(st)
      .filter(([, r]) => r && r.status === 'rendering' && r.jobId);

    const out = { checked: pending.length, collected: 0, stillRunning: 0, failed: 0, lost: 0 };
    if (!pending.length) return out;

    for (const [key, rec] of pending) {
      let job;
      try {
        job = await window.LTXAdapter.jobStatus(rec.jobId);
      } catch (err) {
        // The backend may have restarted and forgotten the job entirely.
        out.lost++;
        st[key] = { status: 'error', error: `lost track of render (${err.message})`, at: Date.now() };
        continue;
      }

      if (job.status === 'running' || job.status === 'queued') {
        out.stillRunning++;
        continue;
      }
      if (job.status === 'error') {
        out.failed++;
        st[key] = { status: 'error', error: job.error || 'render failed', at: Date.now() };
        continue;
      }
      if (job.status === 'done' && job.video_url) {
        try {
          const blob = await window.LTXAdapter.fetchClip(job.video_url);
          await idbPut(clipKey(Number(key)), blob);
          st[key] = {
            status: 'done',
            mode: job.mode,
            seed: job.seed,
            generatedSec: job.generated_sec,
            finalSec: job.final_sec,
            bytes: blob.size,
            recovered: true,
            at: Date.now()
          };
          out.collected++;
          try {
            window.dispatchEvent(new CustomEvent('blvck:clip-rendered', {
              detail: { index: Number(key), kind: 'video' }
            }));
          } catch {
            /* no-op */
          }
        } catch (err) {
          out.failed++;
          st[key] = { status: 'error', error: `could not download finished clip: ${err.message}`, at: Date.now() };
        }
      }
      if (typeof opts.onProgress === 'function') opts.onProgress(out);
    }

    writeState(st);
    return out;
  }

  /** How many renders are recorded as in-flight (for UI hints). */
  function pendingCount() {
    return Object.values(readState()).filter((r) => r && r.status === 'rendering' && r.jobId).length;
  }

  /**
   * Director pass: plan how every storyboard frame should move before any GPU
   * time is spent.
   *
   * Worth doing as its own step because the storyboard model was writing for a
   * still image — it had no reason to think about what moves, whether a camera
   * move suits the beat, or whether shot types repeat. This pass sees the whole
   * sequence at once, which is also the only way to catch continuity drift
   * between batches.
   *
   * Writes the result back onto the stored storyboard so promptFor() picks it
   * up, and returns the strategy and any warnings for display.
   */
  async function planWithDirector(opts = {}) {
    // Plan EVERY scene, whatever happened to its still.
    //
    // This used to require status 'done', which created a deadlock the moment
    // text-to-video existed: planning needs no image, but it assigned the
    // visualType that told the renderer a beat needed no image. With SDXL
    // offline every scene sat at 'error', so there was nothing to plan, so
    // nothing ever got a visualType, so nothing could render. The Director
    // works from narration text and timing — neither depends on a picture.
    const list = scenes();
    if (!list.length) throw new Error('No storyboard scenes to plan — generate a storyboard first.');

    const cast = window.BlvckCast
      ? window.BlvckCast.list().map((c) => ({
        name: c.name,
        descriptor: window.BlvckCast.descriptorFor(c.name)
      }))
      : [];

    const mode = window.BlvckModes ? window.BlvckModes.current() : null;
    const hostConfigured = !!(window.BlvckHost && window.BlvckHost.isConfigured());

    const plan = await window.BlvckAI.generateJSON('/api/video/plan', {
      scenes: list.map((s) => ({
        index: s.index,
        timestamp: s.timestamp,
        durationSec: sceneDuration(s),
        subtitle: s.subtitle,
        detectedAction: s.detectedAction,
        sceneSummary: s.sceneSummary,
        environment: s.environment,
        timeOfDay: s.timeOfDay,
        weather: s.weather,
        lighting: s.lighting,
        characters: s.characters
      })),
      bible: bible(),
      characters: cast,
      modeBrief: window.BlvckModes ? window.BlvckModes.briefFor(mode) : '',
      host: hostConfigured ? window.BlvckHost.descriptor() : ''
    }, { task: 'storyboard' });

    // Merge onto the stored scenes by index.
    const byIndex = new Map((plan.scenes || []).map((p) => [p.index, p]));
    let applied = 0;
    try {
      const sb = JSON.parse(localStorage.getItem(SB_LS) || 'null');
      if (sb && Array.isArray(sb.scenes)) {
        sb.scenes = sb.scenes.map((s) => {
          const p = byIndex.get(s.index);
          if (!p) return s;
          applied++;
          // A mode with no host (History, Faceless) must win over the model's
          // suggestion — and so must an unconfigured host. Planning a presenter
          // beat with nothing to render it from just fails later.
          let overlay = p.hostOverlay || 'none';
          if (!hostConfigured || (mode && mode.host.share <= 0)) overlay = 'none';
          return Object.assign({}, s, {
            visualType: p.visualType || s.visualType || 't2v',
            hostOverlay: overlay,
            shotType: p.shotType || s.shotType,
            cameraMovement: p.cameraMovement || s.cameraMovement,
            motion: p.motion || s.motion,
            emotion: p.emotion || s.emotion,
            transition: p.transition || 'cut'
          });
        });
        localStorage.setItem(SB_LS, JSON.stringify(sb));
        // Tell the storyboard to pull the plan into ITS copy of the scenes.
        // It holds them in memory and writes that array back on every save, so
        // without this the very next saveProject() overwrites the plan with
        // unplanned scenes and the whole pass is silently undone.
        try {
          window.dispatchEvent(new CustomEvent('blvck:scenes-planned', {
            detail: { scenes: sb.scenes }
          }));
        } catch {
          /* no-op */
        }
      }
    } catch (err) {
      throw new Error(`Could not save the video plan: ${err.message}`);
    }

    // Report the visual mix — a plan that is 40 identical t2v beats is exactly
    // the "AI slideshow" failure mode, and the user should see it before
    // spending hours of GPU time on it.
    const mix = {};
    for (const p of plan.scenes || []) mix[p.visualType] = (mix[p.visualType] || 0) + 1;
    const hostShots = hostConfigured && mode && mode.host.share > 0
      ? (plan.scenes || []).filter((p) => p.hostOverlay && p.hostOverlay !== 'none').length
      : 0;

    // Measure the plan against what the mode asked for. This is the check that
    // makes a mode more than decoration — "Documentary" that came back 85% t2v
    // is a slideshow wearing a documentary label, and the user should know
    // before spending GPU hours on it.
    const drift = window.BlvckModes ? window.BlvckModes.compareMix(mode, mix) : [];

    // Audit the plan for watchability before any GPU time is spent on it. Runs
    // against the SAVED scenes, so it sees the merged result rather than the
    // model's raw answer.
    const retention = window.BlvckRetention
      ? window.BlvckRetention.analyze(scenes().filter((s) => byIndex.has(s.index)))
      : { issues: [], stats: {} };

    return {
      strategy: plan.strategy,
      warnings: plan.warnings || [],
      applied,
      mix,
      hostShots,
      mode: mode ? mode.label : '',
      mixDrift: drift,
      retention
    };
  }

  window.BlvckLTX = {
    promptFor,
    referencesFor,
    sceneDuration,
    generateScene,
    generateAll,
    planWithDirector,
    estimateMinutes,
    estimateRun,
    clipCostSec,
    RES_SCALE,
    clipBlob,
    status,
    allStatus,
    doneCount,
    rendersOnCanvas,
    isTextDriven,
    collectPending,
    pendingCount,
    CANVAS_TYPES,
    cancel,
    isRunning,
    reset,
    MOVE_TEXT,
    SHOT_TEXT
  };
})();
