// Does the scene actually work?
//
// TWO LAYERS, AND MOST OF IT IS NOT A MODEL'S JOB.
//
// Whether two components overlap, whether type runs off the frame, whether
// something sits in the band the subtitles are burned into — those are
// measurements. Asking a language model to eyeball them is slower, costs a
// call, and gives a worse answer than reading getBoundingClientRect. The
// structural pass measures the real layout in a hidden iframe and returns
// facts.
//
// Whether the picture COMMUNICATES THE IDEA is the one question measurement
// cannot answer, and that is what the vision model is for: a frame is pulled
// out of the rendered video, described by a model that was not told what it was
// supposed to be looking at, and the description is compared with what the
// Visual Director said the beat had to get across. A describer told the answer
// agrees with it — the same separation the footage evaluator already keeps.
//
// BOUNDED REVISION, NEVER A LOOP. At most one retry, and only for problems a
// retry could plausibly fix. A scene that is still wrong after that is reported
// as wrong and kept, because a pipeline that regenerates until it likes the
// answer will regenerate forever on the beat it cannot do.
(() => {
  'use strict';

  // Below this a caption at 1080p is unreadable on a phone. Not a preference:
  // 24px on a 1920-wide frame is about 1.2% of the height, which on a handset
  // is smaller than the smallest text any platform ships.
  const MIN_TEXT_PX = 22;
  const FRAME_W = 1920;
  const FRAME_H = 1080;

  const str = (v) => String(v == null ? '' : v).trim();

  // ── The structural pass: measurement, no model ───────────────────────────

  /**
   * Lay the composition out for real and measure what happened.
   *
   * An iframe rather than a guess, and the scripts are stripped so the timeline
   * never runs: this asks where things ARE, and a half-played GSAP tween would
   * report a position no viewer ever sees.
   */
  async function inspectLayout(source, { captionBand = 0.24 } = {}) {
    const frame = document.createElement('iframe');
    frame.style.cssText = 'position:fixed;left:-9999px;top:0;width:1920px;height:1080px;border:0';
    document.body.appendChild(frame);
    try {
      frame.srcdoc = String(source).replace(new RegExp('<script[^]*?</' + 'script>', 'g'), '');
      await new Promise((r) => { frame.onload = r; setTimeout(r, 4000); });
      const doc = frame.contentDocument;
      if (!doc) return { ok: false, problems: [{ kind: 'unreadable', why: 'the composition would not lay out' }] };

      const els = [...doc.querySelectorAll('.clip')].map((el) => {
        const b = el.getBoundingClientRect();
        return { id: el.id || '(unnamed)', tag: el.tagName.toLowerCase(),
                 x: Math.round(b.x), y: Math.round(b.y),
                 w: Math.round(b.width), h: Math.round(b.height) };
      });

      const problems = [];

      // Two things in the same place. Every component is correct alone; this is
      // the failure that only exists between them, and it is the one that made
      // a real scene unreadable while every other check passed.
      for (let i = 0; i < els.length; i++) {
        for (let j = i + 1; j < els.length; j++) {
          const a = els[i], b = els[j];
          const ox = Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x));
          const oy = Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
          // A full-frame background is meant to be underneath everything.
          const backdrop = (e) => e.w >= FRAME_W - 4 && e.h >= FRAME_H - 4;
          if (backdrop(a) || backdrop(b)) continue;
          if (ox > 8 && oy > 8) {
            problems.push({ kind: 'overlap', why: `${a.id} and ${b.id} are drawn on top of one another`,
                            fixable: true });
          }
        }
      }

      // The band the compositor burns subtitles into. Anything here is written
      // over by words the viewer needs more than the graphic.
      const bandTop = FRAME_H * (1 - captionBand);
      for (const e of els) {
        if (e.h >= FRAME_H - 4) continue;                    // the backdrop may fill it
        if (e.y + e.h > bandTop + 8) {
          problems.push({ kind: 'caption_collision',
                          why: `${e.id} reaches into the caption band`, fixable: true });
        }
      }

      // Off the edge. A frame is not a page; there is no scrolling to reveal it.
      for (const e of els) {
        if (e.x < -8 || e.y < -8 || e.x + e.w > FRAME_W + 8 || e.y + e.h > FRAME_H + 8) {
          if (e.w >= FRAME_W - 4 && e.h >= FRAME_H - 4) continue;
          problems.push({ kind: 'clipped', why: `${e.id} extends past the frame`, fixable: true });
        }
      }

      // Type nobody can read.
      const small = [];
      for (const el of doc.querySelectorAll('.clip *')) {
        if (!str(el.textContent) || el.children.length) continue;
        const size = parseFloat(getComputedStyle(el).fontSize) || 0;
        if (size > 0 && size < MIN_TEXT_PX) small.push((el.id || el.className) + ` @${Math.round(size)}px`);
      }
      if (small.length) {
        problems.push({ kind: 'unreadable_text',
                        why: `text below ${MIN_TEXT_PX}px: ${small.slice(0, 4).join(', ')}`,
                        fixable: false });
      }

      // How full the frame is. Both ends are failures: a scene with almost
      // nothing on it is a wasted beat, and one that is packed cannot be read
      // in the seconds it is on screen.
      const ink = els.filter((e) => !(e.w >= FRAME_W - 4 && e.h >= FRAME_H - 4))
                     .reduce((a, e) => a + e.w * e.h, 0);
      const density = Math.round((ink / (FRAME_W * FRAME_H)) * 100) / 100;
      if (els.length && density < 0.04) {
        problems.push({ kind: 'sparse', why: `only ${Math.round(density * 100)}% of the frame carries anything`,
                        fixable: true });
      }
      if (density > 0.72) {
        problems.push({ kind: 'crowded', why: `${Math.round(density * 100)}% of the frame is occupied`,
                        fixable: true });
      }

      return { ok: problems.length === 0, problems, elements: els, density,
               bandTop: Math.round(bandTop) };
    } finally {
      frame.remove();
    }
  }

  // ── The semantic pass: the one question measurement cannot answer ────────

  /** A still from the rendered video, as a data URL. */
  async function frameFrom(blob, atFraction = 0.6) {
    const url = URL.createObjectURL(blob);
    try {
      const v = document.createElement('video');
      v.muted = true; v.src = url;
      const ready = await new Promise((res) => {
        v.onloadeddata = () => res(true); v.onerror = () => res(false);
        setTimeout(() => res(v.readyState >= 2), 20000);
      });
      if (!ready) return null;
      await new Promise((res) => {
        v.onseeked = () => res();
        try { v.currentTime = (v.duration || 1) * atFraction; } catch (e) { res(); }
        setTimeout(res, 8000);
      });
      const c = document.createElement('canvas');
      c.width = 1280; c.height = 720;
      c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
      return c.toDataURL('image/jpeg', 0.85);
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  /**
   * Does the picture say what the beat needed it to say?
   *
   * The describer is NOT told the concept. It reports what it sees and the
   * comparison happens here, because a model told what it is looking for finds
   * it — measured on this project's footage evaluator, where a primed describer
   * reported a named stage act in a clip tagged "band, orchestra, brass".
   */
  async function readsAsIntended(blob, intent) {
    const E = window.BlvckVisualEvaluator;
    if (!E || !E.available || !E.available()) {
      return { ran: false, why: 'no vision model is available' };
    }
    const picture = await frameFrom(blob);
    if (!picture) return { ran: false, why: 'no frame could be read from the render' };

    let sees = '';
    try {
      const d = await E._describe({ thumbnailUrl: picture });
      sees = str(d && d.sees);
    } catch (err) {
      return { ran: false, why: 'the describer failed: ' + err.message };
    }
    if (!sees) return { ran: false, why: 'the describer returned nothing' };

    // A plain overlap between what the beat had to convey and what a stranger
    // saw. Deliberately not another model call: this is a sanity check on the
    // picture, not a second opinion about the script.
    const want = [intent && intent.concept, ...((intent && intent.conveys) || [])]
      .filter(Boolean).join(' ').toLowerCase();
    const words = [...new Set(want.split(/\W+/).filter((w) => w.length > 4))];
    const hit = words.filter((w) => sees.toLowerCase().includes(w));
    return {
      ran: true, sees,
      matched: hit,
      overlap: words.length ? Math.round((hit.length / words.length) * 100) / 100 : null
    };
  }

  // ── Both, with one revision at most ──────────────────────────────────────

  /**
   * Evaluate a rendered scene.
   *
   * Structural problems are facts and are always reported. The semantic read is
   * recorded rather than used as a gate: a low overlap between a description
   * and a concept is worth a producer's eye, not an automatic rejection, and
   * turning it into one would have the pipeline rebuilding perfectly good
   * scenes because a describer used different words.
   */
  async function evaluate({ source, blob, intent, captionBand } = {}) {
    const layout = await inspectLayout(source, { captionBand });
    const reading = blob ? await readsAsIntended(blob, intent || {}) : { ran: false, why: 'nothing rendered' };
    const blocking = layout.problems.filter((p) => p.fixable);
    return {
      ok: layout.ok,
      problems: layout.problems,
      fixable: blocking,
      elements: layout.elements,
      density: layout.density,
      reading,
      at: Date.now()
    };
  }

  /** What to tell a Composer that is being asked to try again. */
  function revisionNote(evaluation) {
    const p = (evaluation && evaluation.fixable) || [];
    if (!p.length) return '';
    return 'The previous attempt had these problems and they must not recur: '
      + p.map((x) => x.why).join('; ')
      + '. Ask for fewer components, or shorter text, so the frame has room.';
  }

  window.BlvckHyperFrameEvaluator = {
    evaluate, inspectLayout, readsAsIntended, frameFrom, revisionNote,
    MIN_TEXT_PX
  };
})();
