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
   * Force the composition's length back to the timeline's.
   *
   * Only ever applied to a source a HUMAN edited. The Composer's output is
   * built FROM this number, so there is nothing to correct; an edited source is
   * the one case where the two can disagree, and the rule from Timing has never
   * been about who is asking. The model may not authoritatively set start, end
   * or duration, and neither may an editor typing into a textarea - the window
   * belongs to the measured narration.
   *
   * This is the same disagreement 83ce3ce removed between runRoute and
   * renderScene, arriving by a different door: the renderer obeys
   * data-duration, so a source that says 8 makes an 8s file while the record
   * says 7, and the workspace reports the record.
   */
  function atTimelineDuration(source, seconds) {
    const text = String(source == null ? '' : source);
    // The root carries the composition's own length. Per-clip data-duration
    // values are internal animation timing and are the composition's business.
    const root = /(<[^>]*data-composition-id="main"[^>]*)/i.exec(text);
    if (!root) return { source: text, forced: false, was: null };
    const had = /data-duration="([^"]*)"/i.exec(root[1]);
    if (had && Number(had[1]) === Number(seconds)) {
      return { source: text, forced: false, was: Number(had[1]) };
    }
    const fixed = had
      ? root[1].replace(/data-duration="[^"]*"/i, `data-duration="${seconds}"`)
      : root[1] + ` data-duration="${seconds}"`;
    return { source: text.replace(root[1], fixed), forced: true,
             was: had ? Number(had[1]) : null };
  }

  /**
   * Render a scene's composition and attach it as that scene's visual.
   *
   * Stored under clip:N through the storyboard's own writer, which is what
   * makes the rest of the pipeline indifferent to where the video came from.
   */
  /**
   * `seconds` is the length the COMPOSITION was built for, when the caller has
   * one. Two places used to compute this window independently — here, and in
   * the route that bakes data-duration into the source — and only the second
   * governs the file, because that is what the renderer reads. They agreed, so
   * nothing showed it; a probe that lengthened the composition by a second
   * produced a file of 8s carrying a scene that recorded 7s, which the
   * workspace would have reported as the truth. One number now.
   */
  async function renderScene(scene, { source, format = 'mp4', assets = [], vendor = [], seconds: given, handEdited = false } = {}) {
    const win = window.BlvckRenderer && window.BlvckRenderer._shotWindowOf
      ? window.BlvckRenderer._shotWindowOf(scene) : null;
    if (!win && !(Number(given) > 0)) throw new Error('this scene has no place on the timeline yet');
    const seconds = Number(given) > 0
      ? Number(given)
      : Math.round((win.timelineEnd - win.timelineStart) * 100) / 100;

    const fixed = handEdited ? atTimelineDuration(source, seconds) : { source, forced: false };
    const blob = await render({ source: fixed.source, seconds, format, assets, vendor });

    const SBM = window.BlvckStoryboard;
    if (!SBM || !SBM.attachAsset) throw new Error('the storyboard is not available to store the render');
    await SBM.attachAsset(scene, blob, 'video');

    // What this scene is built from, kept HERE rather than in the route that
    // happened to generate it.
    //
    // runRoute set hyperFrameSource on its way past, which meant the source
    // survived only for scenes the Composer built: a hand-authored composition
    // - the Phase 1 slice, and anything rendered without the model - went
    // through this function and kept nothing, so its scene could be inspected
    // and re-rendered by nobody. Every render passes through here, so this is
    // where the record of what was rendered belongs. For an edited source it is
    // the CORRECTED text, because that is what the renderer was given.
    scene.hyperFrameSource = fixed.source;

    scene.hyperFrame = Object.assign({}, scene.hyperFrame, {
      mode: (scene.hyperFrame && scene.hyperFrame.mode) || 'FULL_FRAME',
      status: 'ready',
      renderedKey: 'clip:' + scene.index,
      version: ((scene.hyperFrame && scene.hyperFrame.version) || 0) + 1,
      handEdited: !!handEdited,
      durationForced: !!fixed.forced,
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

  /**
   * Render a transparent composition and keep it beside the footage.
   *
   * OVERLAY does not become the scene's clip - the footage still is. The
   * transparent WebM is stored under its own key and the compositor draws it
   * over the shot, which is the case HYBRID-in-HyperFrame cannot serve: a
   * graphic that has to span a cut, or outlive the shot it started on.
   *
   * Measured before this was built: a transparent WebM decoded into a <video>
   * and drawn with drawImage keeps its alpha - 54108 of 57600 sampled pixels
   * showed the ground through, and none came back black. That is why this is a
   * WebM and not an RGBA png-sequence.
   */
  async function renderOverlay(scene, { source, assets = [], vendor = [], handEdited = false } = {}) {
    const win = window.BlvckRenderer && window.BlvckRenderer._shotWindowOf
      ? window.BlvckRenderer._shotWindowOf(scene) : null;
    if (!win) throw new Error('this scene has no place on the timeline yet');
    const seconds = Math.round((win.timelineEnd - win.timelineStart) * 100) / 100;

    const fixed = handEdited ? atTimelineDuration(source, seconds) : { source, forced: false };
    const blob = await render({ source: fixed.source, seconds, format: 'webm', assets, vendor });

    const SBM = window.BlvckStoryboard;
    if (!SBM || !SBM.putOverlay) throw new Error('the storyboard cannot store an overlay');
    await SBM.putOverlay(scene, blob);

    scene.hyperFrameSource = fixed.source;

    scene.hyperFrame = Object.assign({}, scene.hyperFrame, {
      mode: 'OVERLAY', status: 'ready',
      overlayKey: 'hfov:' + scene.index,
      version: ((scene.hyperFrame && scene.hyperFrame.version) || 0) + 1,
      handEdited: !!handEdited,
      durationForced: !!fixed.forced,
      durationSec: seconds, renderMs: blob.renderMs, bytes: blob.size,
      at: Date.now(), failure: null
    });
    return { blob, seconds, renderMs: blob.renderMs };
  }

  window.BlvckHyperFrame = {
    available, render, renderScene, renderOverlay, gsap,
    _atTimelineDuration: atTimelineDuration,
    RENDER_TIMEOUT_MS
  };
})();
