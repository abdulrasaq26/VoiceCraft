// Timeline validation, and the two clocks an archival edit has to keep apart.
//
// The Director proposes timings; this decides whether they are usable. That
// split matters because a model asked for a number will always produce one,
// and a shot ending after the narration does or an overlay outside its parent
// shot is not a judgement call — it is arithmetic, and arithmetic belongs here.
//
// The second job is keeping two timelines from being confused. An archival
// excerpt has a position in the finished video AND a position inside the source
// film, and they are unrelated numbers:
//
//   timelineStart/timelineEnd   where it sits in the export     18.5 → 25.1
//   sourceIn/sourceOut          where it comes from in the film 222.2 → 228.8
//
// Storing one pair and inferring the other is how a cut ends up playing the
// wrong six seconds.
(() => {
  'use strict';

  const EPSILON = 0.05;   // 50ms: below one frame at 24fps, not worth flagging

  function num(v) { const n = Number(v); return Number.isFinite(n) ? n : NaN; }

  /**
   * Validate one shot against the audio timeline.
   *
   * Returns problems rather than throwing: a storyboard with one bad shot
   * should be repairable, not rejected wholesale.
   */
  function validateShot(shot, { audioDuration, index = 0 } = {}) {
    const problems = [];
    const start = num(shot && shot.timelineStart);
    const end = num(shot && shot.timelineEnd);

    if (!Number.isFinite(start)) problems.push('timelineStart is missing or not a number');
    if (!Number.isFinite(end)) problems.push('timelineEnd is missing or not a number');
    if (!Number.isFinite(start) || !Number.isFinite(end)) return problems;

    if (start < -EPSILON) problems.push(`starts before the video begins (${start.toFixed(2)}s)`);
    if (end <= start + EPSILON) {
      problems.push(`has no duration (${start.toFixed(2)}s → ${end.toFixed(2)}s)`);
    }
    if (Number.isFinite(audioDuration) && audioDuration > 0 && end > audioDuration + EPSILON) {
      problems.push(`runs past the narration (${end.toFixed(2)}s of ${audioDuration.toFixed(2)}s)`);
    }

    // An overlay belongs to its shot. Outside it, the text appears over
    // different footage than the words it was written for.
    const ov = shot && shot.editorialOverlay;
    if (ov && ov.enabled) {
      const os = num(ov.start), oe = num(ov.end);
      if (Number.isFinite(os) && Number.isFinite(oe)) {
        if (os < start - EPSILON || oe > end + EPSILON) {
          problems.push(`overlay ${os.toFixed(2)}–${oe.toFixed(2)}s falls outside its shot`);
        }
        if (oe <= os + EPSILON) problems.push('overlay has no duration');
      }
    }

    // An excerpt has to fit both clocks: long enough to cover the shot, and
    // inside the source film.
    const ex = shot && shot.excerpt;
    if (ex && ex.applied) {
      const inn = num(ex.sourceIn), out = num(ex.sourceOut);
      if (Number.isFinite(inn) && Number.isFinite(out)) {
        if (inn < -EPSILON) problems.push('excerpt sourceIn is negative');
        if (out <= inn + EPSILON) problems.push('excerpt has no source duration');
        const sourceLen = num(ex.sourceDuration);
        if (Number.isFinite(sourceLen) && sourceLen > 0 && out > sourceLen + EPSILON) {
          problems.push(`excerpt runs past the end of the source film (${out.toFixed(1)}s of ${sourceLen.toFixed(1)}s)`);
        }
        // The excerpt must cover the shot, or the last part of the shot has no
        // picture.
        if ((out - inn) + EPSILON < (end - start)) {
          problems.push(`excerpt is ${(out - inn).toFixed(2)}s but the shot needs ${(end - start).toFixed(2)}s`);
        }
      }
    }
    return problems;
  }

  /**
   * Validate a whole storyboard: each shot, plus the relationships between them.
   */
  function validatePlan(shots, { audioDuration, allowOverlap = false, maxGap = 0.75 } = {}) {
    const list = Array.isArray(shots) ? shots : [];
    const issues = [];

    list.forEach((shot, i) => {
      validateShot(shot, { audioDuration, index: i })
        .forEach((msg) => issues.push({ index: i, shot: shot && shot.shotId, severity: 'error', message: msg }));
    });

    // Order and continuity. Sorted by start rather than trusting array order,
    // because a plan out of order is a separate problem from an overlap.
    const timed = list
      .map((s, i) => ({ i, shotId: s && s.shotId, start: num(s && s.timelineStart), end: num(s && s.timelineEnd) }))
      .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end))
      .sort((a, b) => a.start - b.start);

    for (let k = 1; k < timed.length; k++) {
      const prev = timed[k - 1], cur = timed[k];
      if (cur.start + EPSILON < prev.end) {
        if (!allowOverlap) {
          issues.push({
            index: cur.i, shot: cur.shotId, severity: 'error',
            message: `overlaps the previous shot by ${(prev.end - cur.start).toFixed(2)}s`
          });
        }
      } else if (cur.start - prev.end > maxGap) {
        // A hole in the visuals is a black frame under live narration.
        issues.push({
          index: cur.i, shot: cur.shotId, severity: 'warning',
          message: `${(cur.start - prev.end).toFixed(2)}s gap with no visual before this shot`
        });
      }
    }

    if (list.length && timed.length !== list.length) {
      issues.push({ index: -1, severity: 'error', message: 'some shots have unusable timings' });
    }

    // Does the plan actually cover the narration?
    if (Number.isFinite(audioDuration) && audioDuration > 0 && timed.length) {
      const first = timed[0], last = timed[timed.length - 1];
      if (first.start > maxGap) {
        issues.push({ index: 0, severity: 'warning',
          message: `narration starts at 0s but the first visual is at ${first.start.toFixed(2)}s` });
      }
      if (audioDuration - last.end > maxGap) {
        issues.push({ index: timed.length - 1, severity: 'warning',
          message: `${(audioDuration - last.end).toFixed(2)}s of narration has no visual at the end` });
      }
    }

    const errors = issues.filter((i) => i.severity === 'error');
    return {
      valid: errors.length === 0,
      errors,
      warnings: issues.filter((i) => i.severity === 'warning'),
      issues,
      coverage: coverageOf(timed, audioDuration)
    };
  }

  function coverageOf(timed, audioDuration) {
    if (!Number.isFinite(audioDuration) || audioDuration <= 0 || !timed.length) return null;
    // Union of the shot spans, so overlaps do not count twice.
    const merged = [];
    for (const s of timed) {
      const last = merged[merged.length - 1];
      if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
      else merged.push({ start: s.start, end: s.end });
    }
    const covered = merged.reduce((n, m) => n + (m.end - m.start), 0);
    return Math.round(Math.min(1, covered / audioDuration) * 1000) / 1000;
  }

  /**
   * Pull a shot back inside the timeline rather than discarding it.
   *
   * Used only after validation has reported the problem — clamping silently
   * would hide a Director that is systematically inventing times.
   */
  function clampShot(shot, audioDuration) {
    const out = Object.assign({}, shot);
    let start = num(shot.timelineStart);
    let end = num(shot.timelineEnd);
    if (!Number.isFinite(start)) start = 0;
    if (!Number.isFinite(end)) end = start + 1;

    start = Math.max(0, start);
    if (Number.isFinite(audioDuration) && audioDuration > 0) {
      end = Math.min(end, audioDuration);
      start = Math.min(start, Math.max(0, audioDuration - 0.5));
    }
    if (end <= start) end = start + 0.5;

    out.timelineStart = Math.round(start * 100) / 100;
    out.timelineEnd = Math.round(end * 100) / 100;
    out.timingClamped = out.timelineStart !== num(shot.timelineStart)
      || out.timelineEnd !== num(shot.timelineEnd);

    if (out.editorialOverlay && out.editorialOverlay.enabled) {
      const ov = Object.assign({}, out.editorialOverlay);
      ov.start = Math.max(out.timelineStart, Math.min(num(ov.start) || out.timelineStart, out.timelineEnd - 0.2));
      ov.end = Math.min(out.timelineEnd, Math.max(num(ov.end) || ov.start + 0.5, ov.start + 0.2));
      out.editorialOverlay = ov;
    }
    return out;
  }

  // ── The two clocks (spec section 9) ───────────────────────────────────────

  /**
   * Bind a chosen excerpt to its position in the finished video.
   *
   * Keeps both pairs explicitly. `sourceIn/sourceOut` is where the footage
   * lives in the archival film; `timelineStart/timelineEnd` is when the viewer
   * sees it. They are never derived from one another.
   */
  function bindExcerpt(excerpt, { timelineStart, timelineEnd }) {
    if (!excerpt) return null;
    const tStart = num(timelineStart), tEnd = num(timelineEnd);
    const needed = Math.max(0, tEnd - tStart);

    const sourceIn = num(excerpt.start);
    let sourceOut = num(excerpt.end);

    // The shot is the authority on length: the excerpt is stretched or trimmed
    // in the SOURCE clock to cover it, never the other way round.
    if (Number.isFinite(needed) && needed > 0 && Number.isFinite(sourceIn)) {
      sourceOut = sourceIn + needed;
      const sourceLen = num(excerpt.sourceDuration);
      if (Number.isFinite(sourceLen) && sourceOut > sourceLen) {
        // Not enough film after the in-point: slide the window back.
        const slid = Math.max(0, sourceLen - needed);
        return finish(slid, slid + needed);
      }
    }
    return finish(sourceIn, sourceOut);

    function finish(inn, out) {
      return Object.assign({}, excerpt, {
        sourceIn: Math.round(inn * 100) / 100,
        sourceOut: Math.round(out * 100) / 100,
        timelineStart: Math.round(tStart * 100) / 100,
        timelineEnd: Math.round(tEnd * 100) / 100,
        // Kept for readers; the two pairs above are what the renderer uses.
        duration: Math.round((out - inn) * 100) / 100
      });
    }
  }

  /**
   * Anchor an overlay to the moment a phrase is actually spoken (section 8).
   *
   * Returns null when the phrase was not found in the narration, so the caller
   * can leave the overlay off rather than place it on the wrong word.
   */
  function anchorOverlay(transcript, phrase, { shot, lead = 0.15, minDuration = 1.2 } = {}) {
    if (!window.Transcript || !transcript) return null;
    const hit = window.Transcript.findPhrase(transcript, phrase,
      { after: shot ? num(shot.timelineStart) - 0.5 : 0 });
    if (!hit) return null;

    // A beat early so the words and the card land together rather than the
    // card chasing them.
    let start = Math.max(0, hit.start - lead);
    let end = Math.max(hit.end, start + minDuration);

    if (shot) {
      const ss = num(shot.timelineStart), se = num(shot.timelineEnd);
      if (Number.isFinite(ss)) start = Math.max(ss, start);
      if (Number.isFinite(se)) end = Math.min(se, Math.max(start + 0.3, end));
    }
    return {
      start: Math.round(start * 100) / 100,
      end: Math.round(end * 100) / 100,
      anchoredTo: hit.matched,
      spokenAt: Math.round(hit.start * 100) / 100
    };
  }

  window.Timing = {
    EPSILON,
    validateShot,
    validatePlan,
    clampShot,
    bindExcerpt,
    anchorOverlay
  };
})();
