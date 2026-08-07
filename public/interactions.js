// Interactions — A doing something TO B.
//
// The 25-scene battery produced the hardest number this project has: THIRTEEN
// of twenty-five situations collapsed into TWO pictures. Nine two-person
// scenes -- bad news, soldier home, argument, proposal, job loss, interview,
// reunion, teaching, goodbye -- rendered as the same image, and four group
// scenes rendered as a second one.
//
// The reason is structural rather than artistic. placeActors returns
// y = GROUND for every layout, and its pair positions are 0.30/0.70 and
// 0.36/0.64: symmetric about centre and coplanar. The staging system could
// not produce an asymmetric two-shot even if something asked it to.
//
// WHY THIS IS NOT A RELATIONSHIP VALUE. A scalar -- warmth, trust, hostility
// -- would have adjusted the gap between two figures still standing on one
// line. That is not what separates a proposal from an argument. A proposal is
// one figure LOW and one HIGH, close, the low one reaching up. An argument is
// two figures at equal height, apart, both leaning in, arms asymmetric. The
// difference is a PATTERN of relative placement, height, orientation and
// posture, not a number.
//
// So an interaction returns per-actor staging:
//
//   x        where each stands. Deliberately NOT symmetric about 0.5.
//   y        vertical offset. Kneeling, sitting and collapsing all live here,
//            and this axis alone was previously unreachable.
//   scale    who is nearer the camera, which is who the shot is about.
//   flip     which way each faces. Turning away is a statement.
//   bias     per-actor pose-space nudge, so the two bodies differ.
//
// Every pattern below breaks symmetry on purpose. Real scenes are composed
// off-centre; a balanced frame reads as a diagram of two people rather than a
// moment between them.
(() => {
  'use strict';

  const GROUND = 0.84;

  // CHANNELS. The first pass had four -- spacing, vertical offset, scale,
  // facing -- plus a pose bias, and it was not enough: `confront` still read
  // as "conversation with emotion" because two upright figures at a distance
  // is a conversation whatever their expressions say. Two more channels,
  // chosen because each is independently visible:
  //
  //   lean    signed degrees, positive = toward the other. The whole body
  //           rotates about its own feet. This is what makes an argument an
  //           argument: both bodies committed forward into the space between.
  //   reach   0..1, how far the near arm extends toward the other. An offered
  //           hand is the difference between kneeling and merely being lower.
  //   reachY  -1..1, WHERE that hand goes: down, level, or up and around.
  //           Added because the channel-distance metric found confront and
  //           embrace separated by only two channels -- both lean in, both
  //           face each other, same scale, same height -- so an argument and
  //           an embrace differed only by distance and arm extension. Arms
  //           around the shoulders versus a hand levelled at the chest is the
  //           distinction a viewer actually reads.
  //
  // bias values are added to the pose-space axes, -1..1 before clamping.
  const INTERACTIONS = {
    // Two equals, apart, both pressing in. Height equal is the point: neither
    // yields. Off-centre so the frame has a heavier side.
    // Both committed FORWARD into the space between them, and closer than is
    // comfortable. Equal height so neither yields.
    confront: {
      requires: [], support: [],
      means: 'argument, confrontation, standing your ground',
      a: { x: 0.34, y: 0, scale: 1.08, flip: false, lean: 13, reach: 0.55, reachY: -0.10, gaze: 'partner', z: 1,
           bias: { openness: 0.18, compression: -0.10, asymmetry: 0.35 } },
      b: { x: 0.60, y: 0, scale: 1.00, flip: true, lean: 10, reach: 0.35, reachY: -0.05, gaze: 'partner', z: 0,
           bias: { openness: 0.14, compression: -0.05, asymmetry: -0.30 } }
    },

    // The bearer stands, the receiver drops. Distance stays respectful --
    // closeness would read as comfort, and this is not comfort yet.
    deliver_bad_news: {
      requires: [], support: [],
      means: 'bad news, diagnosis, dismissal',
      a: { x: 0.34, y: -0.02, scale: 0.96, flip: false, gaze: 'partner', z: 0,
           bias: { compression: 0.15, openness: -0.10, confidence: 0.1 } },
      b: { x: 0.64, y: 0.05, scale: 1.10, flip: true, gaze: 'down', z: 1,
           bias: { compression: 0.45, openness: -0.35, stability: -0.3, confidence: -0.4 } }
    },

    // One low and reaching, one high and still. The height difference IS the
    // proposal; nothing else in the frame has to say it.
    // The weakest pattern of the first eight, because being LOWER is not the
    // gesture — offering is. Now: down hard, folded, tilted up toward her,
    // one arm fully extended. She draws back and away.
    propose: {
      requires: [], support: ['kneel'],
      means: 'proposal, plea, asking',
      a: { x: 0.36, y: 0.17, scale: 1.02, flip: false, lean: 16, reach: 1.0, reachY: 0.20, support: 'kneel', gaze: 'up', z: 0,
           bias: { compression: 0.62, openness: 0.30, stability: -0.45, confidence: -0.1 } },
      b: { x: 0.58, y: -0.02, scale: 1.08, flip: true, lean: -9, reach: 0.15, reachY: 0.10, gaze: 'partner', z: 1,
           bias: { compression: -0.10, openness: 0.20, confidence: 0.2 } }
    },

    // Almost no gap, both leaning in, near-equal. The only pattern where the
    // figures overlap.
    embrace: {
      requires: [], support: [],
      means: 'reunion, homecoming, comfort',
      a: { x: 0.42, y: 0, scale: 1.04, flip: false, lean: 9, reach: 0.9, reachY: 0.75, gaze: 'partner', z: 0,
           bias: { openness: 0.4, compression: -0.1, confidence: 0.2 } },
      b: { x: 0.55, y: 0, scale: 1.00, flip: true, lean: 8, reach: 0.85, reachY: 0.70, gaze: 'partner', z: 1,
           bias: { openness: 0.38, compression: -0.08, confidence: 0.18 } }
    },

    // One turned AWAY. Orientation carries this: a back is unambiguous.
    part: {
      requires: [], support: [],
      means: 'goodbye, estrangement, walking out',
      a: { x: 0.28, y: 0, scale: 0.94, flip: false, gaze: 'partner', z: 0,
           bias: { openness: 0.15, compression: 0.05 } },
      b: { x: 0.68, y: -0.01, scale: 1.08, flip: false, gaze: 'away', z: 1,
           bias: { compression: 0.2, openness: -0.3, confidence: -0.15 } }
    },

    // Side by side, facing the same way, close. Nobody opposes anybody.
    instruct: {
      requires: [], support: [],
      means: 'teaching, mentoring, showing',
      a: { x: 0.40, y: 0, scale: 1.10, flip: false, gaze: 'down', z: 1,
           bias: { openness: 0.3, confidence: 0.25, stability: 0.2 } },
      b: { x: 0.55, y: 0.06, scale: 0.82, flip: false, gaze: 'away', z: 0,
           bias: { openness: 0.05, compression: 0.1, stability: -0.1 } }
    },

    // Both seated, a surface between them, unequal scale so one is the
    // subject and one is the examiner.
    across_desk: {
      requires: ['desk'], support: ['chair'],
      means: 'interview, negotiation, questioning',
      a: { x: 0.32, y: 0, scale: 0.92, flip: false, support: 'chair', gaze: 'partner', z: 0,
           bias: { confidence: 0.2, compression: -0.05 } },
      b: { x: 0.66, y: 0, scale: 1.08, flip: true, support: 'chair', gaze: 'partner', z: 1,
           bias: { compression: 0.25, openness: -0.25, confidence: -0.25 } }
    },

    // One presents, the rest receive. Asymmetric by count, not just position.
    address: {
      requires: ['podium'], support: [],
      means: 'on stage, verdict, announcement',
      a: { x: 0.30, y: -0.04, scale: 1.18, flip: false, gaze: 'away', z: 1,
           bias: { openness: 0.4, confidence: 0.35, stability: 0.25 } },
      b: { x: 0.70, y: 0.03, scale: 0.72, flip: true, gaze: 'partner', z: 0,
           bias: { openness: -0.15, compression: 0.1 } }
    }
  };

  // Which interaction a line of narration is reaching for. Ordered: the
  // specific before the general.
  const HINTS = [
    [/\b(argu\w*|shout\w*|row|confront\w*|accus\w*|blam\w*|furious)\b/i, 'confront'],
    [/\b(told (?:her|him|them) the news|diagnos\w*|bad news|let (?:him|her|them) go|fired|dismiss\w*|sentenc\w*)\b/i, 'deliver_bad_news'],
    [/\b(propos\w*|asked (?:her|him) to marry|knelt|begged|pleaded)\b/i, 'propose'],
    [/\b(embrac\w*|hugged|held (?:each other|her|him)|came home|reunited|met again)\b/i, 'embrace'],
    [/\b(said goodbye|left (?:her|him|them)|walked (?:out|away)|parted|stopped speaking|farewell)\b/i, 'part'],
    [/\b(taught|showed (?:her|him|them)|trained|coached|explained to)\b/i, 'instruct'],
    [/\b(interview\w*|questioned|negotiat\w*|across the desk|applied for)\b/i, 'across_desk'],
    [/\b(on stage|verdict|announc\w*|awarded|presented|addressed)\b/i, 'address']
  ];

  function infer(text) {
    const hay = String(text || '');
    for (const [re, name] of HINTS) if (re.test(hay)) return name;
    return null;
  }

  /**
   * Staging for the two actors, in the compositor's own terms.
   *
   * Returns spots shaped like placeActors' output so the compositor can use
   * them without a special path — plus `bias`, which the pose space applies.
   */
  function stage(name, baseScale) {
    const it = INTERACTIONS[name];
    if (!it) return null;
    const s = baseScale == null ? 0.42 : baseScale;
    return [
      { x: it.a.x, y: GROUND + it.a.y, scale: s * it.a.scale, flip: it.a.flip,
        bias: it.a.bias, lean: it.a.lean || 0, reach: it.a.reach || 0, reachY: it.a.reachY || 0, support: it.a.support || null, gaze: it.a.gaze || null, z: it.a.z || 0 },
      { x: it.b.x, y: GROUND + it.b.y, scale: s * it.b.scale, flip: it.b.flip,
        bias: it.b.bias, lean: it.b.lean || 0, reach: it.b.reach || 0, reachY: it.b.reachY || 0, support: it.b.support || null, gaze: it.b.gaze || null, z: it.b.z || 0 }
    ];
  }

  window.BlvckInteract = {
    INTERACTIONS, stage, infer,
    means: (n) => (INTERACTIONS[n] ? INTERACTIONS[n].means : null),
    names: () => Object.keys(INTERACTIONS)
  };
})();
