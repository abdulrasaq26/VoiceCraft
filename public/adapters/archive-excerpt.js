// Finding the right moment inside a long archival film.
//
// The problem this solves: an archive item is an eleven-minute newsreel and the
// scene wants six seconds of it. The previous behaviour skipped the opening
// titles and took the next six seconds, which is not selection — it is a guess
// wearing a timecode.
//
// What makes real selection affordable is that archive.org has already done the
// sampling. Every video item carries a `.thumbs/` directory of JPEGs named for
// their timestamp in seconds — sixteen frames, sixty seconds apart, five to
// seven kilobytes each. A whole film can be surveyed for about a hundred
// kilobytes without fetching a single frame of video.
//
// Two levels of scoring, and the honest distinction between them matters:
//
//   Level B  cheap visual features. Finds black frames, leader, title cards and
//            static stretches, and prefers a window where the picture is
//            actually moving. It does NOT know what is in the shot.
//   Level C  the Director's own model looking at the frames. Qwen3.8 is a
//            vision model and the GGUF ships mmproj, so this needs no second
//            model — the same brain that wrote the selection intent judges
//            which frames match it.
//
// Level B always runs; it is the floor. Level C runs when the vision endpoint
// is available and refines the ranking. `selectionMethod` on the result says
// which one actually decided, so nothing here can be mistaken for semantic
// matching that did not happen.
(() => {
  'use strict';

  const PROXY = '/api/proxy/archive';

  // ── Frame index from item metadata ────────────────────────────────────────

  const THUMB_TIME = /_(\d+)\.jpg$/i;

  /**
   * The sampled frames archive.org already made, with their timestamps.
   *
   * `bytes` is kept because it is a real signal at zero cost: a JPEG of a black
   * frame or a plain title card compresses to a fraction of a photographed
   * scene. On a measured item, frame t=1 was 1075 bytes against 6919 for t=60.
   */
  function frameIndex(metadata) {
    const identifier = ((metadata && metadata.metadata) || {}).identifier || '';
    const files = (metadata && metadata.files) || [];
    const frames = [];

    for (const file of files) {
      if (String(file.format || '').toLowerCase() !== 'thumbnail') continue;
      const match = THUMB_TIME.exec(String(file.name || ''));
      if (!match) continue;
      frames.push({
        t: Number(match[1]),
        bytes: Number(file.size || 0),
        url: `${PROXY}/download/${encodeURIComponent(identifier)}/${encodeURI(file.name)}`
      });
    }
    return frames.sort((a, b) => a.t - b.t);
  }

  // ── Level B: features that need no understanding ──────────────────────────

  /**
   * Classify frames from compressed size alone.
   *
   * Crude, and deliberately so — this runs before anything is downloaded. The
   * threshold is relative to the item's own median because an old 320x240 scan
   * and a clean 640x480 transfer have entirely different baselines.
   */
  function classifyBySize(frames) {
    const sizes = frames.map((f) => f.bytes).filter((n) => n > 0).sort((a, b) => a - b);
    if (!sizes.length) return frames.map((f) => Object.assign({}, f, { sparse: false }));
    const median = sizes[Math.floor(sizes.length / 2)];

    return frames.map((f) => Object.assign({}, f, {
      // Well under the item's own median: black, leader, a fade, or a title
      // card on a plain ground. Not somewhere to start an excerpt.
      sparse: f.bytes > 0 && f.bytes < median * 0.45,
      relativeDetail: median ? Math.min(2, f.bytes / median) : 1
    }));
  }

  /**
   * Per-frame features from actual pixels. Browser only — needs a canvas.
   *
   * Returns luma, contrast and colourfulness. Between them these separate a
   * photographed scene from a title card (high contrast, near-zero colour) and
   * from leader or a fade (very low or very high luma, no contrast).
   */
  async function frameFeatures(url) {
    const img = await loadImage(url);
    const w = 32, h = 32;                     // enough for statistics, cheap
    const canvas = document.createElement('canvas');
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const { data } = ctx.getImageData(0, 0, w, h);

    let sum = 0, sumSq = 0, colour = 0;
    const n = w * h;
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i], g = data[i + 1], b = data[i + 2];
      const luma = 0.299 * r + 0.587 * g + 0.114 * b;
      sum += luma;
      sumSq += luma * luma;
      colour += Math.max(r, g, b) - Math.min(r, g, b);
    }
    const mean = sum / n;
    const variance = Math.max(0, sumSq / n - mean * mean);

    return {
      luma: mean / 255,
      contrast: Math.sqrt(variance) / 128,
      colourfulness: (colour / n) / 255,
      histogram: null
    };
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`could not load frame ${url}`));
      img.src = url;
    });
  }

  /** A single frame's fitness as excerpt material, from Level B features. */
  function frameScore(frame) {
    let score = 50;

    if (frame.sparse) score -= 35;                       // metadata said thin
    score += Math.round((frame.relativeDetail || 1) * 10);

    const f = frame.features;
    if (f) {
      if (f.luma < 0.06 || f.luma > 0.96) score -= 40;   // black or blown out
      if (f.contrast < 0.04) score -= 30;                // flat: fade or card
      // A title card is high-contrast and almost colourless. Photographed
      // material nearly always carries some colour, even on aged monochrome.
      if (f.contrast > 0.34 && f.colourfulness < 0.03) score -= 25;
      if (f.colourfulness > 0.05) score += 10;
      if (f.contrast >= 0.08 && f.contrast <= 0.32) score += 12;
    }
    return score;
  }

  // ── Candidate windows ─────────────────────────────────────────────────────

  /**
   * Score a continuous window rather than a frame.
   *
   * The requirement is a usable shot, not a good still: a window that opens on
   * a title card and cuts to footage halfway is worse than a slightly duller
   * one that holds. So the weakest frame in the window is weighted heavily,
   * and change between adjacent frames is rewarded only up to a point —
   * movement is life, but a window straddling a hard cut is not one shot.
   */
  function scoreWindow(frames, startT, duration) {
    const endT = startT + duration;
    // Frames bracketing the window, since sampling is coarser than the window.
    const inside = frames.filter((f) => f.t >= startT - 1 && f.t <= endT + 1);
    const nearest = inside.length ? inside : [closestFrame(frames, startT)].filter(Boolean);
    if (!nearest.length) return null;

    const scores = nearest.map(frameScore);
    const worst = Math.min(...scores);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;

    // The floor dominates: one bad frame ruins the excerpt.
    let score = worst * 0.6 + mean * 0.4;

    // Openings are titles and credits far more often than they are footage.
    if (startT < 10) score -= 30;
    else if (startT < 25) score -= 10;

    // Motion between samples, where we can see it.
    if (nearest.length > 1) {
      const drift = adjacentChange(nearest);
      if (drift > 0.35) score -= 15;        // likely a cut inside the window
      else if (drift > 0.06) score += 12;   // something is happening
      else score -= 8;                      // a held frame or a still
    }
    return { start: startT, end: endT, duration, score: Math.round(score), frames: nearest.length };
  }

  function adjacentChange(frames) {
    let total = 0, pairs = 0;
    for (let i = 1; i < frames.length; i++) {
      const a = frames[i - 1].features, b = frames[i].features;
      if (!a || !b) continue;
      total += Math.abs(a.luma - b.luma) + Math.abs(a.colourfulness - b.colourfulness);
      pairs++;
    }
    return pairs ? total / pairs : 0;
  }

  function closestFrame(frames, t) {
    let best = null, bestGap = Infinity;
    for (const f of frames) {
      const gap = Math.abs(f.t - t);
      if (gap < bestGap) { bestGap = gap; best = f; }
    }
    return best;
  }

  /** Candidate windows anchored on the sampled frames. */
  function candidateWindows(frames, duration, sourceDuration) {
    const out = [];
    const limit = Math.max(0, (sourceDuration || 0) - duration);
    for (const f of frames) {
      // Start slightly before the sampled frame so it sits inside the window
      // rather than exactly on its edge.
      const start = Math.min(limit, Math.max(0, f.t - duration * 0.25));
      const w = scoreWindow(frames, Math.round(start * 10) / 10, duration);
      if (w) out.push(w);
    }
    return out.sort((a, b) => b.score - a.score);
  }

  // ── Level C: the Director's own eyes ──────────────────────────────────────
  //
  // Qwen3.8 is a vision model and the GGUF ships mmproj, so the model that
  // wrote "workers operating wartime production machinery" can be shown the
  // frames and asked which match. No second model, which is the point.
  //
  // Returns null when the endpoint is absent — and the caller then reports
  // Level B as the method, because claiming semantic selection that did not
  // happen is worse than admitting the excerpt was chosen on brightness.
  async function visionRank(frames, selectionIntent, { timeoutMs = 120000 } = {}) {
    if (!selectionIntent || !frames.length) return null;
    if (!window.AIManager || !window.AIManager.rankFrames) return null;

    try {
      const scored = await Promise.race([
        window.AIManager.rankFrames({
          intent: selectionIntent,
          frames: frames.map((f) => ({ t: f.t, url: f.url }))
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('vision timeout')), timeoutMs))
      ]);
      if (!Array.isArray(scored) || !scored.length) return null;
      // Expected shape: [{ t, relevance }] with relevance in 0..1
      const byTime = new Map(scored.map((s) => [Number(s.t), Number(s.relevance)]));
      return frames.map((f) => Object.assign({}, f, {
        relevance: byTime.has(f.t) ? byTime.get(f.t) : null
      }));
    } catch (err) {
      console.warn('[ArchiveExcerpt] vision ranking unavailable:', err.message);
      return null;
    }
  }

  /**
   * Choose the excerpt.
   *
   * Order matters and is not negotiable: rights are settled before any of this
   * runs (see clearForProduction in stock-media.js). A good-looking segment
   * inside an uncleared item is still uncleared — analysis cannot promote it.
   */
  async function selectExcerpt({
    metadata, sourceDuration, targetDuration = 6, selectionIntent = '',
    sampleFrames = true, useVision = true
  }) {
    // A source barely longer than the beat needs no selection — take it as is.
    if (!sourceDuration || sourceDuration <= targetDuration * 1.5) return null;

    // Discard samples that fall outside the film. A thumbnail stamped past the
    // declared duration means the metadata and the file disagree, and scoring
    // a frame that cannot exist would put the window somewhere there is no
    // footage at all.
    const raw = frameIndex(metadata).filter((f) => f.t < sourceDuration);
    if (!raw.length) return null;

    let frames = classifyBySize(raw);

    // Pixel features, best-effort. A frame that will not load is skipped
    // rather than failing the selection.
    if (sampleFrames && typeof document !== 'undefined' && document.createElement) {
      for (const f of frames) {
        try { f.features = await frameFeatures(f.url); } catch (_) { f.features = null; }
      }
    }

    let method = 'visual_features';
    let confidence = 0.35;

    if (useVision) {
      const ranked = await visionRank(frames, selectionIntent);
      if (ranked) {
        frames = ranked;
        method = 'visual_semantic_analysis';
      }
    }

    // Fold semantic relevance into the frame scores when we have it.
    const scored = frames.map((f) => Object.assign({}, f, {
      _base: frameScore(f),
      _boost: typeof f.relevance === 'number' ? Math.round(f.relevance * 60) : 0
    }));
    const withBoost = scored.map((f) => Object.assign({}, f, {
      relativeDetail: f.relativeDetail,
      features: f.features,
      sparse: f.sparse,
      _score: f._base + f._boost
    }));

    const candidates = candidateWindows(withBoost, targetDuration, sourceDuration)
      .map((w) => {
        const anchor = closestFrame(withBoost, w.start + targetDuration / 2);
        return Object.assign({}, w, {
          relevance: anchor && typeof anchor.relevance === 'number' ? anchor.relevance : null,
          score: w.score + (anchor ? (anchor._boost || 0) : 0)
        });
      })
      .sort((a, b) => b.score - a.score);

    if (!candidates.length) return null;
    const best = candidates[0];

    if (method === 'visual_semantic_analysis' && typeof best.relevance === 'number') {
      confidence = Math.round(Math.min(0.95, 0.4 + best.relevance * 0.55) * 100) / 100;
    } else {
      // Level B cannot express confidence about meaning, only about having
      // avoided obviously unusable footage. Capped low on purpose.
      confidence = Math.round(Math.min(0.5, Math.max(0.15, best.score / 200)) * 100) / 100;
    }

    return {
      required: true,
      applied: true,
      start: best.start,
      end: best.end,
      duration: targetDuration,
      sourceDuration,
      selectionIntent,
      selectionMethod: method,
      // About visual matching only. Not a statement about rights, and named so
      // it cannot be read as one.
      confidence,
      framesSampled: frames.length,
      candidatesEvaluated: candidates.length,
      candidates: candidates.slice(0, 5).map((c) => ({
        start: c.start, end: c.end, score: c.score, relevance: c.relevance
      })),
      userAdjustable: true,
      note: method === 'visual_semantic_analysis'
        ? 'Chosen by matching sampled frames against the stated intent for this scene. Check it before publishing.'
        : 'Chosen by avoiding titles, black frames and static shots. The system did not identify what is IN the shot — check it covers the moment you want.'
    };
  }

  /** A user-set in/out point replaces the automatic one, keeping provenance. */
  function setManualExcerpt(existing, start, end) {
    const s = Math.max(0, Number(start) || 0);
    const e = Math.max(s + 0.5, Number(end) || s + 1);
    return Object.assign({}, existing || {}, {
      required: true,
      applied: true,
      start: Math.round(s * 10) / 10,
      end: Math.round(e * 10) / 10,
      duration: Math.round((e - s) * 10) / 10,
      selectionMethod: 'user_selected',
      confidence: null,          // a person chose it; a score would be noise
      userAdjustable: true,
      note: 'In and out points set by you.'
    });
  }

  window.ArchiveExcerpt = {
    selectExcerpt,
    setManualExcerpt,
    visionRank,
    frameIndex,
    classifyBySize,
    frameFeatures,
    frameScore,
    scoreWindow,
    candidateWindows,
    closestFrame,
    _internal: { adjacentChange, loadImage }
  };
})();
