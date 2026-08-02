// LTX-2.3 22B Distilled MSR adapter — self-hosted video backend.
//
// Talks to AETHER_LTX_Kaggle.ipynb's FastAPI layer through the server.js proxy
// at /api/proxy/ltx (the notebook lives behind an ngrok URL, so the browser
// cannot reach it directly without CORS/TLS grief).
//
// The important thing to know about this backend: it has NO text-to-video mode.
// The LiconStudio MSR LoRA conditions on 1–4 subject images (optionally plus a
// background), and the notebook rejects a request with no references. Every call
// therefore needs at least one image — which is why the pipeline generates
// storyboard stills first and feeds them in here.
(() => {
  'use strict';

  const PROXY = '/api/proxy/ltx';
  const LS_ENDPOINT = 'blvck-tts:ltx-endpoint';

  let capsCache = null;
  let capsAt = 0;

  function endpoint() {
    try {
      return String(localStorage.getItem(LS_ENDPOINT) || '').trim();
    } catch {
      return '';
    }
  }

  function setEndpoint(url) {
    try {
      localStorage.setItem(LS_ENDPOINT, String(url || '').trim());
    } catch {
      /* non-fatal */
    }
    capsCache = null;
    capsAt = 0;
  }

  function headers(extra) {
    const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
    const ep = endpoint();
    if (ep) h['x-ltx-endpoint'] = ep;
    return h;
  }

  // Capability probe. Reports what the backend actually supports rather than
  // what we assume — the same lesson as the SDXL /openapi.json probe.
  async function capabilities({ force = false } = {}) {
    if (!force && capsCache && Date.now() - capsAt < 60000) return capsCache;
    const res = await fetch(`${PROXY}/v1/health`, {
      headers: headers(),
      signal: AbortSignal.timeout(8000)
    });
    if (!res.ok) throw new Error(`LTX health check failed (HTTP ${res.status})`);
    const json = await res.json();
    capsCache = json;
    capsAt = Date.now();
    return json;
  }

  async function checkOnline() {
    try {
      const caps = await capabilities({ force: true });
      return { online: caps && caps.status === 'ok', caps };
    } catch (err) {
      // Report the real reason. An adapter that swallows this and returns a
      // cheerful "offline" teaches the user nothing about what to fix.
      return { online: false, error: err.message, caps: null };
    }
  }

  const MAX_REFS = { I: 4, KI: 5, T2V: 0 };

  /**
   * Ask the backend to actually try text-to-video and report what happened.
   *
   * The notebook loads the MSR (reference-conditioned) build, so whether it can
   * also render from text alone is an empirical question, not a documented one.
   * This runs a real 2s/480p generation there — slow, but it replaces a guess
   * with a fact, and the answer is cached in /v1/health afterwards.
   */
  async function selfTestTextToVideo() {
    const res = await fetch(`${PROXY}/selftest/t2v`, { method: 'POST', headers: headers() });
    const json = await res.json().catch(() => ({}));
    capsCache = null; // health now reports a measured value
    if (!res.ok) throw new Error(json.error || `self-test failed (HTTP ${res.status})`);
    return json;
  }

  // Fixed ladder the backend exposes; frames = 24 * sec + 1 at 24fps.
  const DURATIONS = [2, 3, 5, 8, 10, 15, 20, 25, 30];

  function pickDuration(targetSec) {
    const t = Number(targetSec) || 0;
    for (const d of DURATIONS) if (d >= t - 0.001) return d;
    return DURATIONS[DURATIONS.length - 1];
  }

  /**
   * Generate one scene clip.
   *
   * `images` are base64 payloads WITHOUT the data: prefix. In "KI" mode the
   * FIRST image is the background plate and the rest are subjects; in "I" mode
   * they are all subjects and the background comes from the prompt.
   *
   * `targetSec` is the exact length wanted. The backend renders the next size up
   * from the fixed ladder and trims down, so the returned clip matches the
   * narration segment precisely instead of being rounded to 5s.
   */
  async function generateScene(opts) {
    const o = opts || {};
    const images = (o.images || []).filter(Boolean);
    let mode = String(o.mode || 'I').toUpperCase();
    if (mode !== 'KI' && mode !== 'T2V') mode = 'I';

    if (mode === 'T2V') {
      // Text-to-video carries no references by design; sending them would
      // silently switch the backend back to conditioned generation.
      if (images.length) images.length = 0;
    } else {
      if (!images.length) {
        throw new Error(
          `LTX mode ${mode} needs at least one reference image. ` +
          'Use mode "T2V" to render a scene from text alone.'
        );
      }
      const limit = MAX_REFS[mode];
      if (images.length > limit) {
        throw new Error(`LTX mode ${mode} accepts at most ${limit} reference images (got ${images.length}).`);
      }
    }

    const body = {
      prompt: String(o.prompt || ''),
      images,
      mode,
      seed: Number.isFinite(o.seed) ? o.seed : -1,
      target_sec: Number(o.targetSec) || 5,
      resolution: o.resolution || '720p',
      aspect: o.aspect || '16:9 Landscape',
      guide_scale: Number(o.guideScale) || 4.0,
      steps: Number(o.steps) || 8,
      msr_lora_scale: Number(o.msrScale) || 1.0,
      keep_audio: !!o.keepAudio
    };
    // Only send a crop when asked; the backend leaves height alone otherwise.
    if (o.outputHeight) body.output_height = Number(o.outputHeight);

    // Enqueue, then poll.
    //
    // This is NOT a stylistic choice. Measured against the live tunnel: a 269s
    // render returned fine, while 301s and 302s renders both died with
    // ERR_NGROK_3004 — ngrok cuts any single request at ~300 seconds, and every
    // useful render here takes longer than that. A blocking request would throw
    // away work the GPU had already done.
    const started = await enqueue(body, o);
    // Hand the id back before waiting, so the caller can persist it. A job id
    // that only exists in the memory of a running loop is lost on reload, and
    // with it the handle to work the GPU is still doing.
    if (typeof o.onEnqueued === 'function') o.onEnqueued(started.job);

    const job = await pollJob(started.job, o);
    if (!job.video_url) throw new Error('Finished job contained no video_url.');
    const blob = await fetchClip(job.video_url);
    return { blob, meta: job };
  }

  /** Start a render and return { job } immediately, without waiting. */
  async function enqueue(body, o = {}) {
    const res = await fetch(`${PROXY}/generate`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      signal: o.signal
    });
    const started = await readJson(res, 'starting the render');
    if (!started.job) throw new Error('LTX did not return a job id.');
    return started;
  }

  /** One-shot status check — does not wait. Used when reconnecting to a job. */
  async function jobStatus(jobId) {
    const res = await fetch(`${PROXY}/jobs/${jobId}`, { headers: headers() });
    return readJson(res, 'checking a render');
  }

  async function readJson(res, what) {
    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      // The ngrok interstitial and error pages are HTML — say so plainly
      // rather than dumping markup at the user.
      const looksHtml = /^\s*</.test(text);
      throw new Error(
        looksHtml
          ? `The LTX tunnel returned an error page while ${what}. Check the endpoint is still live.`
          : `LTX returned a non-JSON response (HTTP ${res.status}) while ${what}: ${text.slice(0, 160)}`
      );
    }
    if (!res.ok || json.error) throw new Error(json.error || `LTX error (HTTP ${res.status})`);
    return json;
  }

  /** Poll a job to completion. Reports progress through opts.onProgress. */
  async function pollJob(jobId, opts = {}) {
    const intervalMs = opts.pollMs || 5000;
    const maxMs = opts.maxWaitMs || 60 * 60 * 1000; // an hour is generous even for 30s at 1080p
    // A poll is a status question, not the work. The GPU keeps rendering
    // whatever the tunnel does, so a dropped request must not destroy a job
    // that is running perfectly well.
    //
    // This is not hypothetical: three scenes were marked failed by a single
    // "backend unavailable" blip while their renders continued on the backend,
    // and re-running then queued duplicates of work already in progress.
    const maxConsecutiveErrors = opts.maxPollErrors || 12; // ~1 minute of blips
    const t0 = Date.now();
    let consecutiveErrors = 0;

    for (;;) {
      if (opts.signal && opts.signal.aborted) throw new Error('Render cancelled.');
      await new Promise((r) => setTimeout(r, intervalMs));

      let job;
      try {
        const res = await fetch(`${PROXY}/jobs/${jobId}`, { headers: headers() });
        job = await readJson(res, 'checking render progress');
        consecutiveErrors = 0;
      } catch (err) {
        consecutiveErrors++;
        if (typeof opts.onProgress === 'function') {
          opts.onProgress({ status: 'unreachable', attempt: consecutiveErrors, error: err.message });
        }
        if (consecutiveErrors >= maxConsecutiveErrors) {
          const e = new Error(
            `Lost contact with the backend for ${Math.round(consecutiveErrors * intervalMs / 1000)}s ` +
            `(${err.message}). The render may still be running — use “Collect finished renders” later.`
          );
          e.jobId = jobId;
          e.recoverable = true;
          throw e;
        }
        continue;
      }

      if (typeof opts.onProgress === 'function') {
        opts.onProgress({ status: job.status, elapsedSec: job.elapsed_sec || 0, job });
      }
      if (job.status === 'done') return job;
      if (job.status === 'error') throw new Error(job.error || 'render failed');

      if (Date.now() - t0 > maxMs) {
        throw new Error(`Render still ${job.status} after ${Math.round(maxMs / 60000)} minutes — giving up.`);
      }
    }
  }

  async function fetchClip(videoUrl) {
    const res = await fetch(`${PROXY}${videoUrl}`, {
      headers: { 'x-ltx-endpoint': endpoint() }
    });
    if (!res.ok) throw new Error(`Could not download the rendered clip (HTTP ${res.status}).`);
    return res.blob();
  }

  window.LTXAdapter = {
    endpoint,
    setEndpoint,
    capabilities,
    checkOnline,
    selfTestTextToVideo,
    generateScene,
    enqueue,
    jobStatus,
    pollJob,
    fetchClip,
    pickDuration,
    DURATIONS,
    MAX_REFS
  };
})();
