// Channel metric — how distinguishable are two stagings, and who owns the gap.
//
// This exists because the project's recent progress has come from instruments
// rather than features. Every significant bug in the last stretch was one
// where the trace agreed with me and the rendered image did not: a gesture
// layer reporting `facepalm` while drawing idle, an accumulation correct in
// data and invisible in pixels, an assertion returning true over a
// one-element array. Judgement is the unreliable part, so it gets measured.
//
// WHAT IT MEASURES. For any two stagings, how many INDEPENDENT channels carry
// the distinction between them. Two scenes separated by one channel are
// fragile: change the environment, the style, the figure scale and they merge.
// Scenes separated by four or five survive all of it. This is closer to an
// information measure of robustness than to a readability score.
//
// TWO KINDS OF CHANNEL, and the split is the useful part.
//
//   intrinsic   belongs to the actors — gap, lean, reach, reachY, scale,
//               vertical, facing, posture. Owned by INTERACTION.
//   extrinsic   belongs to the world — a desk, a podium, a bedside. Owned by
//               ARRANGEMENT, which does not exist yet.
//
// The distinction is not academic. `across_desk` sits at two channels against
// three different patterns, and no amount of gap or lean tuning will make it
// read as an interview, because its missing information is extrinsic: the
// desk. A pattern can EXHAUST its intrinsic channels, and when it has, more
// interaction work is wasted effort. The metric detects that and says so.
//
// A third owner appears too. `propose` needs a kneel, which is neither
// intrinsic nor extrinsic — it is the actor's relationship to the ground, and
// belongs to SUPPORT.
(() => {
  'use strict';

  // Smallest difference visible in a rendered frame.
  //
  // AUTHORED, NOT MEASURED. These are judgement calls about perceptibility and
  // they set the whole matrix, so the ranking below is relative and not
  // absolute. Calibrating them properly means finding, per channel, the
  // smallest change at which viewers stop confusing two scenes — a blind
  // classification test, not something derivable from the code.
  const THRESHOLDS = {
    gap: 0.06, vertical: 0.04, scale: 0.10, facing: 0.5,
    lean: 5, reach: 0.25, reachY: 0.30, posture: 0.35
  };

  // Not every channel carries the same amount. `part` uses four of eight
  // channels and still scores 5 on uniqueness — it is carried almost entirely
  // by gap and facing, which suggests orientation and distance are
  // high-bandwidth and a wrist angle is not.
  //
  // TREAT THESE WITH MORE SUSPICION THAN THE THRESHOLDS, NOT LESS. Weighting
  // replaces eight invented constants with sixteen, and a weighted score looks
  // more rigorous while resting on more judgement. So the report carries BOTH
  // the unweighted count and the weighted score, and disagreement between them
  // is itself a signal: it means the verdict depends on numbers nobody has
  // measured. The blind classification test would learn these, not just
  // validate the thresholds.
  const WEIGHTS = {
    facing: 2.2, gap: 1.8, scale: 1.4, vertical: 1.3,
    posture: 1.0, lean: 1.0, reach: 0.9, reachY: 0.8
  };

  const AXES = ['compression', 'openness', 'stability', 'energy', 'confidence', 'asymmetry'];

  // Extrinsic requirements the engine can actually satisfy today.
  const WORLD_PROVIDES = [];            // arrangement does not exist yet
  const SUPPORT_PROVIDES = ['ground', 'chair', 'stool', 'bed', 'floor'];

  /** Reduce a staging pattern to its channel vector. */
  function vectorFor(it) {
    const biasSum = (o) => AXES.reduce((s, k) => s + Math.abs((o.bias && o.bias[k]) || 0), 0);
    return {
      gap: Math.abs(it.b.x - it.a.x),
      vertical: Math.abs((it.a.y || 0) - (it.b.y || 0)),
      scale: it.a.scale / it.b.scale,
      facing: (it.a.flip ? 1 : 0) * 2 + (it.b.flip ? 1 : 0),
      lean: ((it.a.lean || 0) + (it.b.lean || 0)) / 2,
      reach: ((it.a.reach || 0) + (it.b.reach || 0)) / 2,
      reachY: ((it.a.reachY || 0) + (it.b.reachY || 0)) / 2,
      posture: biasSum(it.a) + biasSum(it.b)
    };
  }

  /**
   * Which channels separate two patterns.
   *
   * `n` counts them — no weighting, no assumptions beyond the thresholds.
   * `score` weights them. Both are returned because they can disagree, and
   * when they do the ranking is resting on unmeasured constants.
   */
  function distance(a, b) {
    const va = vectorFor(a);
    const vb = vectorFor(b);
    const on = Object.keys(THRESHOLDS).filter((k) => Math.abs(va[k] - vb[k]) >= THRESHOLDS[k]);
    const score = on.reduce((s, k) => s + (WEIGHTS[k] || 1), 0);
    return { n: on.length, score: Math.round(score * 10) / 10, on };
  }

  /**
   * How much genuinely new territory a pattern occupies.
   *
   * The question this answers is one every growing vocabulary eventually
   * faces: do we really need another primitive? If a new pattern's nearest
   * neighbour is one channel away, it is a parameterisation of something that
   * already exists, not a new primitive — forty patterns each a channel apart
   * are really about ten. High uniqueness means the pattern is doing real
   * representational work.
   */
  function uniqueness(set, name) {
    const others = Object.keys(set).filter((n) => n !== name);
    if (!others.length) return { min: Infinity, nearest: null, sharedWith: [] };
    let best = null;
    others.forEach((n) => {
      const d = distance(set[name], set[n]);
      if (!best || d.n < best.n) best = { min: d.n, score: d.score, nearest: n, differsOn: d.on };
    });
    return best;
  }

  /**
   * Route a pattern's weakness to the subsystem that owns it.
   *
   * This is the point of the whole instrument. Ranking weaknesses tells you
   * what to work on; routing them tells you WHERE, and stops interaction work
   * being spent on a problem interaction cannot solve.
   */
  function diagnose(set, name) {
    const it = set[name];
    const u = uniqueness(set, name);
    const v = vectorFor(it);

    // Which intrinsic channels this pattern leaves unused entirely.
    const unused = ['lean', 'reach', 'reachY', 'vertical']
      .filter((k) => Math.abs(v[k]) < THRESHOLDS[k]);

    const needsWorld = (it.requires || []).filter((r) => WORLD_PROVIDES.indexOf(r) === -1);
    const needsSupport = (it.support || []).filter((s) => SUPPORT_PROVIDES.indexOf(s) === -1);

    let owner = 'interaction';
    let because = unused.length
      ? 'has ' + unused.length + ' unused intrinsic channels'
      : 'intrinsic channels are in use';

    // Extrinsic need outranks unused intrinsic channels: a pattern can be
    // fully tuned and still not read if the world cannot supply its object.
    if (needsSupport.length) {
      owner = 'support';
      because = 'needs ' + needsSupport.join(', ') + ', not in the support vocabulary';
    }
    if (needsWorld.length) {
      owner = 'arrangement';
      because = 'needs ' + needsWorld.join(', ') + ', which nothing can place';
    }
    // A pattern with no spare intrinsic channels AND an unmet world need has
    // exhausted what interaction can do for it.
    const exhausted = !unused.length && (needsWorld.length > 0 || needsSupport.length > 0);

    return {
      pattern: name,
      uniqueness: u.min,
      nearest: u.nearest,
      differsOn: u.differsOn,
      unusedChannels: unused,
      owner,
      because,
      intrinsicExhausted: exhausted
    };
  }

  /** Full report over a set of patterns. */
  function report(set) {
    const names = Object.keys(set);
    const pairs = [];
    for (let i = 0; i < names.length; i++) {
      for (let j = i + 1; j < names.length; j++) {
        const d = distance(set[names[i]], set[names[j]]);
        pairs.push({ pair: names[i] + ' / ' + names[j], n: d.n, on: d.on });
      }
    }
    pairs.sort((a, b) => a.n - b.n);
    const ns = pairs.map((p) => p.n).sort((a, b) => a - b);
    const diagnoses = names.map((n) => diagnose(set, n))
      .sort((a, b) => a.uniqueness - b.uniqueness);
    const byOwner = {};
    diagnoses.forEach((d) => { byOwner[d.owner] = (byOwner[d.owner] || 0) + 1; });
    return {
      patterns: names.length,
      pairs: pairs.length,
      median: ns[Math.floor(ns.length / 2)],
      fragile: pairs.filter((p) => p.n <= 1).length,
      weakestPairs: pairs.slice(0, 4),
      diagnoses,
      routedTo: byOwner
    };
  }

  const ALL_INTRINSIC = ['gap', 'vertical', 'scale', 'facing', 'lean', 'reach', 'reachY', 'posture'];

  /**
   * A stable audit for one pattern — the instrument's actual interface.
   *
   * Reports completeness per subsystem, names the owner AND the reason, and
   * ends with the work that follows from it. The last part is the point: a
   * measurement that stops at a number leaves an engineer to argue about what
   * to do next, which is exactly the arguing this was built to replace.
   */
  function audit(set, name) {
    const it = set[name];
    if (!it) return null;
    const v = vectorFor(it);
    const u = uniqueness(set, name);

    const used = ALL_INTRINSIC.filter((k) => Math.abs(v[k]) >= THRESHOLDS[k]);
    const unused = ALL_INTRINSIC.filter((k) => used.indexOf(k) === -1);
    const required = it.requires || [];
    const metWorld = required.filter((r) => WORLD_PROVIDES.indexOf(r) > -1);
    const needsWorld = required.filter((r) => WORLD_PROVIDES.indexOf(r) === -1);
    const needsSupport = (it.support || []).filter((s) => SUPPORT_PROVIDES.indexOf(s) === -1);

    // Reasons, per subsystem, structured rather than prose — so a caller can
    // act on them without parsing a sentence.
    const reasons = {
      interaction: unused.length ? { unusedChannels: unused } : null,
      arrangement: needsWorld.length ? { missingAnchors: needsWorld } : null,
      support: needsSupport.length ? { missingSupport: needsSupport } : null
    };

    // Primary owner is whoever blocks the pattern outright; unused intrinsic
    // channels are an opportunity, an unplaceable desk is a wall.
    const order = [];
    if (reasons.arrangement) order.push('arrangement');
    if (reasons.support) order.push('support');
    if (reasons.interaction) order.push('interaction');

    const work = [];
    needsWorld.forEach((r) => work.push('add ' + r + ' anchor (arrangement)'));
    needsSupport.forEach((s) => work.push('add ' + s + ' to support vocabulary'));
    // Only recommend intrinsic work when the pattern is actually close to
    // something else; unused channels on a distinctive pattern are fine.
    if (u.min <= 3) unused.slice(0, 3).forEach((k) => work.push('use ' + k + ' channel'));

    return {
      pattern: name,
      intrinsic: used.length + ' / ' + ALL_INTRINSIC.length,
      extrinsic: metWorld.length + ' / ' + required.length,
      nearest: u.nearest,
      distance: u.min,
      weighted: u.score,
      owner: order[0] || 'none',
      secondary: order[1] || null,
      reasons,
      calibrated: false,
      work: work.length ? work : ['none — pattern is distinct and complete']
    };
  }

  window.BlvckMetric = {
    THRESHOLDS, WEIGHTS, vectorFor, distance, uniqueness, diagnose, report, audit,
    calibrated: false   // thresholds AND weights are authored; see notes above
  };
})();
