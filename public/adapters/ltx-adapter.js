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

    const res = await fetch(`${PROXY}/generate`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
      // No AbortSignal here on purpose: a T4 render legitimately runs for
      // minutes and any client-side timeout would abort perfectly good work.
      signal: o.signal
    });

    const text = await res.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`LTX returned a non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    if (!res.ok || json.error) throw new Error(json.error || `LTX error (HTTP ${res.status})`);
    if (!json.video_url) throw new Error('LTX response contained no video_url.');

    const blob = await fetchClip(json.video_url);
    return { blob, meta: json };
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
    fetchClip,
    pickDuration,
    DURATIONS,
    MAX_REFS
  };
})();
