// Pose space — posture as continuous axes, not a list of poses.
//
// The environment became expressive and the character did not, and the reason
// was never art. The room is driven by continuous values:
//
//   brightness  0..1      warmth  -1..1      shadow  0..1
//
// so every fractional change in state produces a fractional change on screen.
// The character was driven by a classifier:
//
//   if (stress > 0.65) return 'defeated';
//
// which throws away everything except which side of a threshold you landed on.
// Stress 0.66 and stress 0.98 rendered the same figure. Adding fifty authored
// poses would not fix that — it would be a classifier with fifty branches, and
// a state engine that computes real numbers would still be reporting them as
// categories.
//
// So posture is a POINT IN A SPACE. Five axes, each continuous:
//
//   compression   tall and extended  ->  folded, knees in, head down
//   openness      arms at the sides  ->  wide, then overhead
//   stability     narrow, unbalanced ->  wide, planted
//   energy        drooping           ->  lifted, carried high
//   confidence    shrinking          ->  chest out, head up
//
// plus `asymmetry`, which is signed: nobody under stress stands evenly, and a
// perfectly symmetrical figure is the main thing that reads as a diagram
// rather than a person.
//
// "Defeated" stops being a pose and becomes a REGION — high compression, low
// everything else. "Confident" is another region. Everything between them is
// reachable, which is the whole point: the same handful of axes gives
// thousands of postures, and state drives them directly.
//
// The authored clips in character-engine.js do not go away. They become
// landmarks in this space (see LANDMARKS) and transient GESTURES layered on
// top — a facepalm is a thing you do, not a way you stand.
//
// WHAT THIS SPACE IS NOT
//
// Posture space describes BODY EXPRESSION: what the body does above its own
// feet. It deliberately does not describe:
//
//   support      the actor's relationship to the ground and to furniture —
//                standing, sitting, kneeling, lying, leaning. This is why
//                `sit` cannot be reproduced here and is not listed as a
//                landmark. It is a different dimension of representation, not
//                a tuning problem, and forcing it in would hide the limit
//                rather than solve it.
//   location     where the actor is on the stage. That belongs to the
//                compositor, which resolves it once from mood and metaphor.
//   relation     how two actors are arranged toward each other. That needs a
//                second entity and does not exist yet.
//
// Each of those wants its own small continuous space eventually. Naming the
// boundary is what stops this one from quietly growing into a junk drawer.
(() => {
  'use strict';

  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const clamp11 = (v) => Math.max(-1, Math.min(1, Number(v) || 0));

  const AXES = ['compression', 'openness', 'stability', 'energy', 'confidence', 'asymmetry'];

  /** A neutral standing figure — the origin of the space. */
  function neutral() {
    return {
      compression: 0.2, openness: 0.08, stability: 0.55,
      energy: 0.5, confidence: 0.5, asymmetry: 0
    };
  }

  /**
   * Axes -> joint angles.
   *
   * The magnitudes are calibrated against the authored clips, so the space
   * passes through the shapes that were already known to read: compression 0.9
   * lands near `defeated` (torso 14, neck 26, lift -0.2), openness 1.0 near
   * `celebrate` (arms overhead, wide base), openness 0.5 near `open` (arms
   * horizontal). Those clips were tuned by silhouette; matching them keeps the
   * space honest instead of inventing a new set of proportions.
   */
  function poseFrom(axes) {
    const a = Object.assign(neutral(), axes || {});
    const c = clamp01(a.compression);
    const o = clamp01(a.openness);
    const s = clamp01(a.stability);
    const e = clamp01(a.energy);
    const f = clamp01(a.confidence);
    const asym = clamp11(a.asymmetry);

    // Spine: compression folds it, confidence straightens it.
    const torso = c * 16 - f * 5;
    const neck = c * 26 - f * 9 - e * 5;
    const head = c * 9 - f * 3;

    // Stance: stability widens, compression pulls the knees together.
    const width = -6 + s * 30 - c * 8;
    const knee = c * 14;

    // Arms: one continuous sweep from at-the-sides to overhead.
    const arm = 10 + o * 150;
    // Elbows bend most in the middle of the sweep and straighten overhead,
    // which is what the authored clips do (open 22, celebrate 14).
    const forearm = 22 * Math.sin(o * Math.PI) + o * 10;

    const pose = {
      torso: torso + asym * 3,
      neck,
      head: head + asym * 4,
      armL: arm + asym * 12,
      armR: -arm + asym * 12,
      forearmL: forearm,
      forearmR: -forearm,
      legL: width + asym * 10,
      legR: -width + asym * 10,
      kneeL: knee,
      kneeR: -knee - asym * 8
    };
    // Height off the ground: energy lifts, compression sinks.
    pose.__lift = e * 0.10 - c * 0.20;
    return pose;
  }

  // Where the authored clips sit in the space. Used to name a point when
  // tracing a frame, and to prove the space still contains the shapes that
  // were verified by silhouette.
  //
  // `sit` is deliberately NOT here. Tested against the authored clip, the
  // space cannot reach it and no re-tuning would help: sitting changes the
  // figure's relationship to the GROUND, and every axis here describes what
  // the body does above its own feet. Support (standing / sitting / lying) is
  // a separate concept and stays an authored clip until it has one. Listing it
  // as a landmark would have quietly claimed coverage the space does not have.
  const LANDMARKS = {
    defeated:  { compression: 0.90, openness: 0.05, stability: 0.15, energy: 0.10, confidence: 0.05 },
    idle:      { compression: 0.20, openness: 0.08, stability: 0.55, energy: 0.50, confidence: 0.50 },
    explain:   { compression: 0.12, openness: 0.28, stability: 0.60, energy: 0.60, confidence: 0.65 },
    open:      { compression: 0.05, openness: 0.50, stability: 0.85, energy: 0.80, confidence: 0.90 },
    celebrate: { compression: 0.00, openness: 1.00, stability: 0.90, energy: 1.00, confidence: 1.00 }
  };

  /** The nearest named region, so a frame can be described without a category driving it. */
  function describe(axes) {
    const a = Object.assign(neutral(), axes || {});
    let best = null;
    let bestD = Infinity;
    Object.keys(LANDMARKS).forEach((name) => {
      const L = LANDMARKS[name];
      let d = 0;
      Object.keys(L).forEach((k) => { d += (a[k] - L[k]) * (a[k] - L[k]); });
      if (d < bestD) { bestD = d; best = name; }
    });
    return { nearest: best, distance: Math.round(Math.sqrt(bestD) * 100) / 100 };
  }

  /**
   * State -> axes. The join that replaces the classifier.
   *
   * Every attribute contributes to several axes, because a body does not have
   * one dial either: losing confidence closes the arms AND rounds the spine,
   * and stress both compresses and unbalances. Weights are signed shares that
   * sum to roughly 1 per axis so each stays in range without clamping doing
   * the work.
   */
  function axesFromState(state) {
    const s = state || {};
    const health = s.health == null ? 0.8 : clamp01(s.health);
    const energy = s.energy == null ? 0.7 : clamp01(s.energy);
    const wealth = s.wealth == null ? 0.5 : clamp01(s.wealth);
    const conf = s.confidence == null ? 0.6 : clamp01(s.confidence);
    const stress = s.stress == null ? 0.2 : clamp01(s.stress);
    // Stance attributes. These describe how someone is holding themselves
    // rather than how they are doing, and they are what let a beat like "he
    // had to choose" move the body without pretending his circumstances got
    // worse.
    const doubt = s.uncertainty == null ? 0.2 : clamp01(s.uncertainty);
    const resolve = s.resolve == null ? 0.5 : clamp01(s.resolve);
    const duty = s.obligation == null ? 0.2 : clamp01(s.obligation);

    return {
      // Obligation presses down the way a burden does; resolve holds the
      // spine up against it.
      compression: clamp01(
        stress * 0.34 + (1 - conf) * 0.24 + (1 - health) * 0.18 + (1 - wealth) * 0.08
        + duty * 0.20 - resolve * 0.12 - 0.10),
      // Doubt closes the arms in. Resolve opens them.
      openness: clamp01(
        conf * 0.38 + energy * 0.18 + (1 - stress) * 0.18 + health * 0.08
        + resolve * 0.20 - doubt * 0.26 - 0.22),
      // This is where uncertainty reads most: an undecided body is an
      // unplanted one. Weight is not committed to either foot.
      stability: clamp01(
        health * 0.30 + conf * 0.24 + (1 - stress) * 0.18 + wealth * 0.08
        + resolve * 0.24 - doubt * 0.34),
      energy: clamp01(energy * 0.62 + health * 0.20 + (1 - stress) * 0.10 + resolve * 0.10),
      confidence: clamp01(
        conf * 0.58 + wealth * 0.12 + (1 - stress) * 0.10 + resolve * 0.20 - doubt * 0.22),
      // Stress and doubt both break the symmetry, and only once they are real.
      // Being torn is literally leaning two ways at once.
      asymmetry: clamp11(Math.max(0, stress - 0.35) * 0.7 + Math.max(0, doubt - 0.3) * 0.9)
    };
  }

  /** Blend two points in the space — used to ease between beats. */
  function blend(a, b, w) {
    const out = {};
    const A = Object.assign(neutral(), a || {});
    const B = Object.assign(neutral(), b || {});
    AXES.forEach((k) => { out[k] = A[k] + (B[k] - A[k]) * w; });
    return out;
  }

  window.BlvckPose = {
    AXES, LANDMARKS, neutral, poseFrom, axesFromState, describe, blend
  };
})();
