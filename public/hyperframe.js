// HyperFrame: a scene whose visual is rendered from code rather than filmed.
//
// The whole integration rests on one observation about this pipeline: it has
// never assumed a scene comes from stock footage. BlvckLTX.rendersOnCanvas
// already routes chart, map and timeline beats away from acquisition and into
// BlvckGraphic, and assemble() deliberately walks EVERY scene rather than only
// the ones that produced an image, so a beat without footage keeps its slice of
// the narration clock instead of collapsing the timeline.
//
// So a HyperFrame scene is not a new kind of thing. It is that same beat with a
// better renderer behind it, and it enters the pipeline exactly where a stock
// clip does:
//
//   composition source
//        ↓  POST /api/hyperframe/render        (node, puppeteer, ffmpeg)
//   video blob
//        ↓  BlvckStoryboard.attachAsset(scene, blob, 'video')
//   clip:N in IndexedDB
//        ↓  assemble() → renderTo() → export   UNCHANGED
//
// Nothing in the compositor, the export gate or the timing system needed to
// learn about this.
//
// TWO CLOCKS, AND THEY DO NOT MEET. The scene's window on the documentary
// timeline is AETHER's, from Timing.anchorOverlay and the measured narration;
// it is passed down as the composition's total duration and is the only number
// this module sends. What happens INSIDE those seconds - when a title enters,
// when a bar grows - is the composition's own business, expressed in its own
// data-start attributes, and never travels back up. They live in different
// files, which is the cheapest possible enforcement.
(() => {
  'use strict';

  const RENDER_URL = '/api/hyperframe/render';
  const STATUS_URL = '/api/hyperframe/status';

  // Long enough for a real scene: rendering is roughly 5-10x slower than real
  // time, so a 30s scene can take five minutes.
  const RENDER_TIMEOUT_MS = 11 * 60 * 1000;

  let readiness = null;

  /**
   * Can this machine render at all?
   *
   * Cached after the first answer because it cannot change without a restart,
   * and every caller wants to ask.
   */
  async function available(force) {
    if (readiness && !force) return readiness;
    try {
      const res = await fetch(STATUS_URL, { cache: 'no-store' });
      readiness = await res.json();
    } catch (err) {
      readiness = { ready: false, reasons: ['the render service did not answer: ' + err.message] };
    }
    return readiness;
  }

  /**
   * Render a composition and get the video back.
   *
   * Returns a Blob. Throws with the renderer's own words on failure - a
   * composition that will not render is a fact worth reading, not a generic
   * "render failed".
   */
  async function render({ source, seconds, format = 'mp4', assets = [], vendor = [] } = {}) {
    if (!String(source || '').trim()) throw new Error('there is no composition to render');
    if (!(Number(seconds) > 0)) {
      throw new Error('a composition needs its scene window; that number comes from the timeline');
    }

    const ctrl = new AbortController();
    const bell = setTimeout(() => ctrl.abort(), RENDER_TIMEOUT_MS);
    let res;
    try {
      res = await fetch(RENDER_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, seconds: Number(seconds), format, assets, vendor }),
        signal: ctrl.signal
      });
    } catch (err) {
      throw new Error(err.name === 'AbortError'
        ? `the render did not finish within ${RENDER_TIMEOUT_MS / 60000} minutes`
        : 'the render service could not be reached: ' + err.message);
    } finally {
      clearTimeout(bell);
    }

    if (!res.ok) {
      let why = `HTTP ${res.status}`;
      try { why = (await res.json()).error || why; } catch (e) { /* not json */ }
      throw new Error(why);
    }
    const blob = await res.blob();
    if (!blob || blob.size === 0) throw new Error('the renderer returned an empty file');
    blob.renderMs = Number(res.headers.get('X-Render-Ms')) || null;
    blob.jobId = res.headers.get('X-Job-Id') || '';
    return blob;
  }

  /**
   * GSAP, as text, to be vendored into the composition.
   *
   * The renderer runs with no network, so a composition cannot pull GSAP from a
   * CDN the way the framework's own scaffold does. Fetched once from our own
   * origin and reused.
   */
  let gsapText = null;
  async function gsap() {
    if (gsapText != null) return gsapText;
    const res = await fetch('/vendor/gsap.min.js', { cache: 'force-cache' });
    if (!res.ok) throw new Error('GSAP is not served at /vendor/gsap.min.js');
    gsapText = await res.text();
    return gsapText;
  }

  /**
   * Render a scene's composition and attach it as that scene's visual.
   *
   * Stored under clip:N through the storyboard's own writer, which is what
   * makes the rest of the pipeline indifferent to where the video came from.
   */
  async function renderScene(scene, { source, format = 'mp4', assets = [], vendor = [] } = {}) {
    const win = window.BlvckRenderer && window.BlvckRenderer._shotWindowOf
      ? window.BlvckRenderer._shotWindowOf(scene) : null;
    if (!win) throw new Error('this scene has no place on the timeline yet');
    const seconds = Math.round((win.timelineEnd - win.timelineStart) * 100) / 100;

    const blob = await render({ source, seconds, format, assets, vendor });

    const SBM = window.BlvckStoryboard;
    if (!SBM || !SBM.attachAsset) throw new Error('the storyboard is not available to store the render');
    await SBM.attachAsset(scene, blob, 'video');

    scene.hyperFrame = Object.assign({}, scene.hyperFrame, {
      mode: (scene.hyperFrame && scene.hyperFrame.mode) || 'FULL_FRAME',
      status: 'ready',
      renderedKey: 'clip:' + scene.index,
      // Derived from the scene window, never authored. If this and the window
      // ever disagree, the window wins - it is the measured one.
      durationSec: seconds,
      renderMs: blob.renderMs,
      bytes: blob.size,
      at: Date.now(),
      failure: null
    });
    return { blob, seconds, renderMs: blob.renderMs };
  }

  window.BlvckHyperFrame = {
    available, render, renderScene, gsap,
    RENDER_TIMEOUT_MS
  };
})();
