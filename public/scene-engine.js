// Scene Engine — the canonical scene model and every way to produce one.
//
// The bug that forced this: "Auto Assemble" refused with "No storyboard scenes
// yet". But assembly never needed a storyboard — tracing it showed the renderer
// touches exactly six fields (index, timestamp, subtitle, sceneSummary, camera,
// hostOverlay) plus an asset keyed by index. None of that is storyboard- or
// LTX-specific.
//
// The real dependency was that storyboard.js was the ONLY code allowed to
// create the scenes array. The guard was not defending a requirement; it was
// defending the only door.
//
// So scenes become the shared model and gain several producers:
//
//   storyboard  the existing manual path, kept for people who want to art-direct
//   timeline    the new default — narration alone is enough
//   director    a plan, straight to scenes, no storyboard involved
//
// This file also holds the visual ROUTING logic that used to live in
// ltx-video.js. That logic decides whether a beat is drawn or generated, which
// has nothing to do with LTX and must outlive it — otherwise removing the
// renderer deletes the renderer's brain.
(() => {
  'use strict';

  const SB_LS = 'blvck-tts:storyboard';

  // --- canonical schema ----------------------------------------------------

  /** Every producer returns scenes in exactly this shape. */
  function makeScene(partial) {
    const s = partial || {};
    return {
      index: Number(s.index) || 0,
      timestamp: String(s.timestamp || ''),      // "00:00:00 - 00:00:14"
      subtitle: String(s.subtitle || ''),        // what is spoken over it
      sceneSummary: String(s.sceneSummary || s.subtitle || ''),
      camera: String(s.camera || ''),
      hostOverlay: s.hostOverlay || null,
      visualType: String(s.visualType || ''),    // set by the Director
      graphic: s.graphic || null,                // typeset content
      duration: Number(s.duration) || 0,
      status: s.status || 'pending',
      error: s.error || null,
      // Anything a producer wants to carry through untouched.
      ...(s.extra || {})
    };
  }

  const hms = (sec) => {
    const s = Math.max(0, Number(sec) || 0);
    const h = String(Math.floor(s / 3600)).padStart(2, '0');
    const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
    const ss = String(Math.floor(s % 60)).padStart(2, '0');
    return `${h}:${m}:${ss}`;
  };

  const stamp = (start, end) => `${hms(start)} - ${hms(end)}`;

  // --- visual routing (extracted, LTX-independent) -------------------------
  //
  // Beats that are TYPESET or DRAWN. Charts, maps, timelines, whiteboards and
  // stickmen are made of text and precise shapes — exactly what diffusion
  // models cannot do and a canvas does perfectly, in about a millisecond.
  const CANVAS_TYPES = ['stickman', 'whiteboard', 'chart', 'map', 'timeline', 'diagram'];

  // Beats that need a generator. In a procedural-first product these are the
  // exception, not the default.
  const GENERATED_TYPES = ['t2v', 'broll', 'presenter'];

  const rendersOnCanvas = (scene) =>
    CANVAS_TYPES.indexOf(String((scene && scene.visualType) || '')) > -1;

  const needsGenerator = (scene) =>
    GENERATED_TYPES.indexOf(String((scene && scene.visualType) || '')) > -1;

  /**
   * Does this beat's content support the card the Director chose?
   *
   * A map with no place named, or a timeline with one date, renders as an empty
   * frame with a title on it — which reads as a bug rather than a design
   * choice. Deliberately conservative: it only rejects on clear evidence of
   * absence, since a false rejection throws away a good card.
   */
  function validateVisualType(scene) {
    const s = scene || {};
    const vt = String(s.visualType || '');
    const text = [s.sceneSummary, s.subtitle, s.detectedAction, s.visualGoal,
      s.graphic && s.graphic.title, s.graphic && (s.graphic.items || []).join(' ')]
      .filter(Boolean).join(' ');

    if (vt === 'map') {
      const ready = window.BlvckGeo && window.BlvckGeo.isLoaded();
      if (ready && !window.BlvckGeo.detectCountries(text).length) {
        return { ok: false, reason: 'no country or region named in this beat', reroute: 'stickman' };
      }
      return { ok: true };
    }
    if (vt === 'timeline') {
      const years = new Set(text.match(/\b(1[0-9]{3}|20[0-9]{2})\b/g) || []);
      const items = (s.graphic && s.graphic.items) || [];
      if (years.size < 2 && items.length < 2) {
        return { ok: false, reason: 'fewer than two dated events', reroute: 'stickman' };
      }
      return { ok: true };
    }
    if (vt === 'chart') {
      const nums = text.match(/\b\d[\d,.]*\s*(%|percent|million|billion|thousand)?\b/gi) || [];
      const items = ((s.graphic && s.graphic.items) || []).filter((i) => /\d/.test(String(i)));
      if (nums.length < 2 && items.length < 2) {
        return { ok: false, reason: 'fewer than two numeric values', reroute: 'stickman' };
      }
      return { ok: true };
    }
    if (vt === 'presenter' && !(window.BlvckHost && window.BlvckHost.isConfigured())) {
      return { ok: false, reason: 'no channel host configured', reroute: 'stickman' };
    }
    if (vt === 'whiteboard') {
      const items = (s.graphic && s.graphic.items) || [];
      if (items.length < 2 && text.length < 40) {
        return { ok: false, reason: 'nothing stepwise to draw', reroute: 'stickman' };
      }
      return { ok: true };
    }
    return { ok: true };
  }

  // --- producers -----------------------------------------------------------

  /** Producer A — whatever the storyboard has already built. */
  function fromStoryboard() {
    try {
      const sb = JSON.parse(localStorage.getItem(SB_LS) || 'null');
      const scenes = (sb && Array.isArray(sb.scenes) && sb.scenes) || [];
      return scenes.map(makeScene);
    } catch {
      return [];
    }
  }

  /**
   * Producer B — narration alone. The new default.
   *
   * One scene per sentence, timed from the aligned timeline. This is a BETTER
   * timing source than the storyboard ever was: storyboard cues came from
   * parsing an SRT, while these come from forced alignment against the actual
   * audio, including real pauses.
   *
   * Very short sentences are merged forward, because a one-second beat is a
   * flash rather than a shot.
   */
  function fromTimeline(timeline, opts = {}) {
    const tl = timeline || (window.BlvckPlayback && window.BlvckPlayback.timeline());
    if (!tl || !tl.sentences || !tl.sentences.length) return [];

    const minSec = opts.minSec == null ? 2.5 : opts.minSec;
    const maxSec = opts.maxSec == null ? 15 : opts.maxSec;

    // Merge sentences that are too brief to hold a shot.
    const beats = [];
    let cur = null;
    tl.sentences.forEach((s) => {
      if (!cur) {
        cur = { start: s.start, end: s.end, text: s.text };
      } else if ((cur.end - cur.start) < minSec && (s.end - cur.start) <= maxSec) {
        cur.end = s.end;
        cur.text += ' ' + s.text;
      } else {
        beats.push(cur);
        cur = { start: s.start, end: s.end, text: s.text };
      }
    });
    if (cur) beats.push(cur);

    return beats.map((b, i) => makeScene({
      index: i + 1,
      timestamp: stamp(b.start, b.end),
      subtitle: b.text.trim(),
      sceneSummary: b.text.trim(),
      duration: Math.round((b.end - b.start) * 1000) / 1000,
      status: 'pending'
    }));
  }

  /** Producer C — a Director plan, with no storyboard involved. */
  function fromPlan(plan, timeline) {
    const scenes = fromTimeline(timeline);
    if (!plan || !Array.isArray(plan.scenes)) return scenes;
    const byIndex = new Map(plan.scenes.map((p) => [p.index, p]));
    return scenes.map((s) => {
      const p = byIndex.get(s.index);
      return p ? makeScene({ ...s, ...p, index: s.index, timestamp: s.timestamp, subtitle: s.subtitle }) : s;
    });
  }

  /**
   * The scenes to render, from whichever producer can supply them.
   *
   * Storyboard first when it exists, because a user who art-directed a
   * storyboard means it. Otherwise narration is enough — nobody should be
   * forced through a storyboard to get a video.
   */
  function currentScenes(opts = {}) {
    if (opts.prefer !== 'timeline') {
      const sb = fromStoryboard();
      if (sb.length) return { scenes: sb, producer: 'storyboard' };
    }
    const tl = fromTimeline(opts.timeline);
    if (tl.length) return { scenes: tl, producer: 'timeline' };
    return { scenes: [], producer: 'none' };
  }

  /** Persist produced scenes so the rest of the app sees them. */
  function save(scenes, meta) {
    let sb = {};
    try {
      sb = JSON.parse(localStorage.getItem(SB_LS) || '{}') || {};
    } catch {
      sb = {};
    }
    sb.scenes = scenes.map(makeScene);
    sb.producedBy = (meta && meta.producer) || 'scene-engine';
    sb.producedAt = Date.now();
    try {
      localStorage.setItem(SB_LS, JSON.stringify(sb));
    } catch {
      /* non-fatal */
    }
    try {
      window.dispatchEvent(new CustomEvent('blvck:scenes-changed', { detail: { count: sb.scenes.length } }));
    } catch {
      /* no-op */
    }
    return sb.scenes;
  }

  /**
   * Everything Auto Assemble needs, without demanding a storyboard.
   *
   * Produces scenes from narration when none exist, so the workflow blocker
   * simply cannot occur: if there is a timeline, there is a video.
   */
  async function ensureScenes(opts = {}) {
    const found = currentScenes(opts);
    if (found.scenes.length) return found;

    // Nothing stored — try to build from narration.
    const tl = opts.timeline || (window.BlvckPlayback && window.BlvckPlayback.timeline());
    if (!tl || !tl.sentences || !tl.sentences.length) {
      return { scenes: [], producer: 'none', reason: 'no storyboard and no narration timeline' };
    }
    const scenes = fromTimeline(tl, opts);
    if (!scenes.length) return { scenes: [], producer: 'none', reason: 'timeline produced no sentences' };
    save(scenes, { producer: 'timeline' });
    return { scenes, producer: 'timeline', created: true };
  }

  window.BlvckScenes = {
    makeScene,
    fromStoryboard,
    fromTimeline,
    fromPlan,
    currentScenes,
    ensureScenes,
    save,
    // routing, extracted so it outlives any particular renderer
    rendersOnCanvas,
    needsGenerator,
    validateVisualType,
    CANVAS_TYPES,
    GENERATED_TYPES,
    stamp
  };
})();
