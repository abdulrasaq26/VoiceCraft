// Retention analysis — the pass that asks "would anyone keep watching this?"
//
// Everything upstream optimises for a scene being CORRECT. Nothing checks
// whether the sequence is watchable, and those are different failures: a video
// can be perfectly continuous, perfectly on-model and still lose the viewer at
// forty seconds because eleven consecutive beats are the same kind of shot.
//
// Deliberately a checker rather than a generator. It reads a finished plan and
// names specific, located problems ("beats 7-12 are all t2v") instead of
// producing a vague quality score, because a located problem can be fixed and a
// score cannot.
(() => {
  'use strict';

  // The opening decides most of the retention curve, so it gets its own rules.
  const HOOK_SEC = 15;

  // Above this, a single shot starts to feel like a held frame rather than a
  // moment. LTX tops out at 30s anyway.
  const LONG_BEAT_SEC = 14;

  // Runs longer than this read as monotony regardless of how good each beat is.
  const MAX_RUN_SAME_TYPE = 4;
  const MAX_RUN_SAME_SHOT = 5;

  function durationOf(scene) {
    if (window.BlvckLTX && window.BlvckLTX.sceneDuration) return window.BlvckLTX.sceneDuration(scene);
    return 5;
  }

  function longestRun(list, key) {
    let best = { value: null, len: 0, start: 0 };
    let cur = null;
    let len = 0;
    let start = 0;
    list.forEach((s, i) => {
      const v = String(s[key] || '');
      if (v && v === cur) {
        len++;
      } else {
        cur = v;
        len = 1;
        start = i;
      }
      if (len > best.len) best = { value: cur, len, start };
    });
    return best;
  }

  /**
   * @param {Array} scenes  planned scenes, in order
   * @returns {{issues: Array<{severity, where, message}>, stats: object}}
   */
  function analyze(scenes) {
    const list = (Array.isArray(scenes) ? scenes : []).filter(Boolean);
    const issues = [];
    if (!list.length) return { issues, stats: {} };

    const durations = list.map(durationOf);
    const total = durations.reduce((a, b) => a + b, 0);
    const avg = total / list.length;

    // --- the opening ------------------------------------------------------
    let acc = 0;
    const opening = [];
    for (let i = 0; i < list.length && acc < HOOK_SEC; i++) {
      opening.push(list[i]);
      acc += durations[i];
    }
    if (opening.length === 1 && durations[0] >= HOOK_SEC) {
      issues.push({
        severity: 'high',
        where: 'beat 1',
        message: `The first ${Math.round(durations[0])}s is a single shot. The opening decides the retention curve — break it into at least two beats.`
      });
    }
    const openingTypes = new Set(opening.map((s) => s.visualType));
    if (opening.length > 1 && openingTypes.size === 1) {
      issues.push({
        severity: 'medium',
        where: `beats 1-${opening.length}`,
        message: `The first ${HOOK_SEC}s is all "${[...openingTypes][0]}". Mixing two visual kinds early signals the video has range.`
      });
    }

    // --- monotony ---------------------------------------------------------
    const runType = longestRun(list, 'visualType');
    if (runType.len > MAX_RUN_SAME_TYPE) {
      issues.push({
        severity: runType.len > MAX_RUN_SAME_TYPE * 2 ? 'high' : 'medium',
        where: `beats ${runType.start + 1}-${runType.start + runType.len}`,
        message: `${runType.len} consecutive "${runType.value}" beats. This is the stretch where a viewer leaves — break it with a chart, a whiteboard or the host.`
      });
    }

    const runShot = longestRun(list, 'shotType');
    if (runShot.len > MAX_RUN_SAME_SHOT && runShot.value) {
      issues.push({
        severity: 'medium',
        where: `beats ${runShot.start + 1}-${runShot.start + runShot.len}`,
        message: `${runShot.len} consecutive "${runShot.value}" shots. Varying scale is what makes a cut feel edited rather than assembled.`
      });
    }

    const runMove = longestRun(list, 'cameraMovement');
    if (runMove.len > MAX_RUN_SAME_SHOT && runMove.value && runMove.value !== 'Static') {
      issues.push({
        severity: 'low',
        where: `beats ${runMove.start + 1}-${runMove.start + runMove.len}`,
        message: `${runMove.len} consecutive "${runMove.value}" moves. Constant camera motion reads as restless.`
      });
    }

    // --- pacing -----------------------------------------------------------
    const longOnes = [];
    durations.forEach((d, i) => {
      if (d > LONG_BEAT_SEC) longOnes.push(i + 1);
    });
    if (longOnes.length) {
      issues.push({
        severity: longOnes.length > list.length / 3 ? 'high' : 'low',
        where: `beat${longOnes.length > 1 ? 's' : ''} ${longOnes.slice(0, 6).join(', ')}${longOnes.length > 6 ? '…' : ''}`,
        message: `${longOnes.length} beat(s) run over ${LONG_BEAT_SEC}s. Long holds are where attention drops; consider splitting those narration segments.`
      });
    }

    // Uniform beat lengths feel metronomic. Compare spread to the mean.
    if (list.length >= 6) {
      const sd = Math.sqrt(durations.reduce((a, d) => a + (d - avg) ** 2, 0) / durations.length);
      if (sd / avg < 0.18) {
        issues.push({
          severity: 'low',
          where: 'whole video',
          message: `Every beat is close to ${avg.toFixed(1)}s. Even pacing feels mechanical — varying shot length is half of what makes an edit feel human.`
        });
      }
    }

    // --- motion -----------------------------------------------------------
    const still = list.filter((s) => window.BlvckLTX && window.BlvckLTX.isTextDriven(s) && !String(s.motion || '').trim());
    if (still.length) {
      issues.push({
        severity: 'medium',
        where: `${still.length} beat(s)`,
        message: `${still.length} filmed beat(s) describe no motion. Without it the model tends to return a near-still frame, which is exactly the slideshow look.`
      });
    }

    // --- variety ----------------------------------------------------------
    const types = {};
    list.forEach((s) => {
      types[s.visualType || 't2v'] = (types[s.visualType || 't2v'] || 0) + 1;
    });
    if (Object.keys(types).length < 3 && list.length >= 8) {
      issues.push({
        severity: 'high',
        where: 'whole video',
        message: `Only ${Object.keys(types).length} visual kind(s) across ${list.length} beats. This is the difference between a production and a slideshow.`
      });
    }

    const order = { high: 0, medium: 1, low: 2 };
    issues.sort((a, b) => order[a.severity] - order[b.severity]);

    return {
      issues,
      stats: {
        beats: list.length,
        totalSec: Math.round(total),
        avgSec: Math.round(avg * 10) / 10,
        types,
        openingBeats: opening.length
      }
    };
  }

  function summarize(result) {
    const r = result || { issues: [], stats: {} };
    if (!r.issues.length) return 'No retention problems found in the plan.';
    const high = r.issues.filter((i) => i.severity === 'high').length;
    return `${r.issues.length} retention note(s)${high ? `, ${high} serious` : ''}: ` +
      r.issues.slice(0, 3).map((i) => `[${i.where}] ${i.message}`).join(' ');
  }

  window.BlvckRetention = { analyze, summarize, HOOK_SEC, LONG_BEAT_SEC };
})();
