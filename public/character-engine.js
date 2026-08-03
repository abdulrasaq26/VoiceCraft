// 2D Character Engine — skeleton, clips, state machine, emotion layer, skins.
//
// This replaces a pose table. A table stores "point" and "facepalm" as fixed
// joint angles, which cannot blend, cannot transition, and multiplies: point ×
// 15 emotions is 15 poses to hand-tune. That approach produced figures whose
// facepalm did not read as a facepalm and whose sad, confused and crying all
// resolved to the same scowl.
//
// Four ideas replace it, each borrowed from how animation actually works:
//
//   BONES      a parent-child hierarchy. A bone's world transform is its
//              parent's, composed with its own local rotation, so moving the
//              torso carries the arms with it — for free, and correctly.
//
//   CLIPS      keyframes over time, not a single frozen pose. The engine
//              interpolates, so "wave" is a motion rather than a snapshot.
//
//   STATES     a machine that cross-fades between clips. Nothing ever snaps.
//
//   EMOTION    an entirely separate layer. Body says "point", face says
//              "angry", and the combination costs nothing — which is the whole
//              reason the pose table had to go.
//
// The renderer is a SKIN, taking resolved world positions and drawing them.
// One skeleton drives stickman, whiteboard and flat-2D looks; adding a style
// means adding a draw function, never another animation system.
(() => {
  'use strict';

  // --- skeleton ------------------------------------------------------------
  //
  // Lengths are in units (~head radius). Angles are degrees, clockwise, with
  // 0 pointing DOWN the parent — so a hanging arm is zero and a rest pose is
  // all zeros, which makes clips readable.
  const RIG = [
    { name: 'root',     parent: null,      len: 0,    rest: 0 },
    { name: 'torso',    parent: 'root',    len: 2.6,  rest: 180 },  // up from the hip
    { name: 'neck',     parent: 'torso',   len: 0.45, rest: 0 },
    { name: 'head',     parent: 'neck',    len: 1.05, rest: 0 },
    { name: 'armL',     parent: 'torso',   len: 1.25, rest: 168 },
    { name: 'forearmL', parent: 'armL',    len: 1.15, rest: 6 },
    { name: 'handL',    parent: 'forearmL', len: 0.2, rest: 0 },
    { name: 'armR',     parent: 'torso',   len: 1.25, rest: -168 },
    { name: 'forearmR', parent: 'armR',    len: 1.15, rest: -6 },
    { name: 'handR',    parent: 'forearmR', len: 0.2, rest: 0 },
    { name: 'legL',     parent: 'root',    len: 1.5,  rest: 7 },
    { name: 'shinL',    parent: 'legL',    len: 1.45, rest: 2 },
    { name: 'footL',    parent: 'shinL',   len: 0.42, rest: 70 },
    { name: 'legR',     parent: 'root',    len: 1.5,  rest: -7 },
    { name: 'shinR',    parent: 'legR',    len: 1.45, rest: -2 },
    { name: 'footR',    parent: 'shinR',   len: 0.42, rest: -70 }
  ];

  const BONE = {};
  RIG.forEach((b) => { BONE[b.name] = b; });

  const rad = (d) => (d * Math.PI) / 180;
  const lerp = (a, b, t) => a + (b - a) * t;

  /**
   * Resolve every bone to world space.
   *
   * Each bone inherits its parent's tip and accumulated rotation, which is what
   * makes the hierarchy worth having: lean the torso and the arms follow
   * automatically, instead of every pose needing to re-specify them.
   */
  function solve(pose, unit, origin) {
    const out = {};
    const ox = (origin && origin.x) || 0;
    const oy = (origin && origin.y) || 0;
    RIG.forEach((b) => {
      const local = (b.rest || 0) + (pose[b.name] || 0);
      const parent = b.parent ? out[b.parent] : null;
      const angle = parent ? parent.angle + local : local;
      const x0 = parent ? parent.x1 : ox;
      const y0 = parent ? parent.y1 : oy;
      const x1 = x0 + Math.sin(rad(angle)) * b.len * unit;
      const y1 = y0 + Math.cos(rad(angle)) * b.len * unit;
      out[b.name] = { x0, y0, x1, y1, angle, len: b.len * unit };
    });
    return out;
  }

  // --- clips ---------------------------------------------------------------
  //
  // A clip is keyframes over normalised time. Only the bones that MOVE appear;
  // everything else stays at rest, so a clip reads as intent rather than as a
  // wall of numbers. `loop` clips cycle; others hold their last frame.
  const CLIPS = {
    idle: {
      loop: true, dur: 4,
      keys: [
        { t: 0,   p: {} },
        { t: 0.5, p: { torso: 0.8, neck: -0.6, armL: -2, armR: 2 } },
        { t: 1,   p: {} }
      ]
    },
    talk: {
      loop: true, dur: 2.4,
      keys: [
        { t: 0,    p: { armR: -18, forearmR: -30 } },
        { t: 0.3,  p: { armR: -34, forearmR: -54, torso: 1 } },
        { t: 0.62, p: { armR: -22, forearmR: -38, neck: -2 } },
        { t: 1,    p: { armR: -18, forearmR: -30 } }
      ]
    },
    explain: {
      loop: true, dur: 3,
      keys: [
        { t: 0,   p: { armL: 42, forearmL: 60, armR: -42, forearmR: -60 } },
        { t: 0.4, p: { armL: 58, forearmL: 40, armR: -30, forearmR: -74, torso: 1.5 } },
        { t: 0.7, p: { armL: 34, forearmL: 66, armR: -52, forearmR: -50 } },
        { t: 1,   p: { armL: 42, forearmL: 60, armR: -42, forearmR: -60 } }
      ]
    },
    point: {
      dur: 0.7,
      keys: [
        { t: 0,   p: {} },
        { t: 0.6, p: { armR: -104, forearmR: -8, neck: -3, torso: 1 } },
        { t: 1,   p: { armR: -96, forearmR: -4, neck: -3 } }
      ]
    },
    wave: {
      loop: true, dur: 1.1,
      keys: [
        { t: 0,   p: { armR: -140, forearmR: -30, neck: -4 } },
        { t: 0.5, p: { armR: -140, forearmR: -76, neck: -4 } },
        { t: 1,   p: { armR: -140, forearmR: -30, neck: -4 } }
      ]
    },
    think: {
      dur: 0.9,
      keys: [
        { t: 0,   p: {} },
        { t: 1,   p: { armR: -52, forearmR: -118, neck: -7, torso: 2, head: 4 } }
      ]
    },
    // SILHOUETTE RULE for everything below.
    //
    // Turn the figure into a solid black shape: you must still know what is
    // happening. Arm angle alone fails that test — five clips differing only
    // in forearm rotation are the same shape. So each clip commits to a whole
    // BODY: stance width, torso lean, head height, vertical lift.
    //
    //   collapsed   narrow stance · torso folded · head down · low
    //   open        wide stance   · torso tall   · head up   · arms out
    //
    // Those two read at 128x72. Arm positions are detail on top.
    facepalm: {
      // Defeat is a COMPRESSED shape: knees together, torso folded, head
      // buried. The hand reaching the face is the last 10% of the read, not
      // the whole of it.
      dur: 0.8,
      keys: [
        { t: 0,   p: {} },
        { t: 0.5, p: { armR: -70, forearmR: -80, neck: 8, legL: -3, legR: 3 } },
        { t: 1,   p: { armR: -40, forearmR: -132, neck: 22, torso: 10, head: 10,
                       legL: -4, legR: 4, kneeL: 10, kneeR: -10, armL: 6 }, lift: -0.14 }
      ]
    },
    shrug: {
      // Shoulders up and elbows OUT — the width is what says "who knows".
      dur: 0.8,
      keys: [
        { t: 0,   p: {} },
        { t: 0.6, p: { armL: 84, forearmL: 92, armR: -84, forearmR: -92, neck: 6, torso: 0 } },
        { t: 1,   p: { armL: 78, forearmL: 98, armR: -78, forearmR: -98, neck: 5,
                       legL: 12, legR: -12 } }
      ]
    },
    celebrate: {
      // Fully vertical arms and a wide base: the most OPEN shape in the set,
      // and the exact opposite silhouette to facepalm.
      loop: true, dur: 1.2,
      keys: [
        { t: 0,   p: { armL: 158, forearmL: 14, armR: -158, forearmR: -14,
                       legL: 20, legR: -20, neck: -6 } },
        { t: 0.5, p: { armL: 174, forearmL: 4, armR: -174, forearmR: -4,
                       legL: 24, legR: -24, neck: -9, torso: -3 }, lift: 0.3 },
        { t: 1,   p: { armL: 158, forearmL: 14, armR: -158, forearmR: -14,
                       legL: 20, legR: -20, neck: -6 } }
      ]
    },
    // KNEEL. A support state, not a posture: it is the body's relationship
    // to the ground, which every pose-space axis explicitly excludes. One
    // knee down and back, the other up and forward, spine tall — that
    // verticality is what separates kneeling from crouching or collapsing.
    kneel: {
      dur: 0.7,
      keys: [
        { t: 0, p: {} },
        { t: 1, p: { legL: 76, shinL: -78, legR: -14, shinR: 96,
                     torso: -3, armL: 12, armR: -12 }, lift: -0.62 }
      ]
    },
    // Two clips that exist purely as silhouettes, for state to reach for.
    defeated: {
      dur: 0.9,
      keys: [
        { t: 0,   p: {} },
        { t: 1,   p: { torso: 14, neck: 26, head: 8, armL: 4, armR: -4,
                       legL: -4, legR: 4, kneeL: 14, kneeR: -14 }, lift: -0.2 }
      ]
    },
    open: {
      dur: 0.9,
      keys: [
        { t: 0,   p: {} },
        { t: 1,   p: { armL: 86, forearmL: 22, armR: -86, forearmR: -22,
                       legL: 22, legR: -22, neck: -8, torso: -4 } }
      ]
    },
    clap: {
      loop: true, dur: 0.5,
      keys: [
        { t: 0,   p: { armL: 58, forearmL: 74, armR: -58, forearmR: -74 } },
        { t: 0.5, p: { armL: 40, forearmL: 96, armR: -40, forearmR: -96 } },
        { t: 1,   p: { armL: 58, forearmL: 74, armR: -58, forearmR: -74 } }
      ]
    },
    write: {
      loop: true, dur: 1.6,
      keys: [
        { t: 0,   p: { armR: -74, forearmR: -54, torso: 5, neck: 7, armL: 18 } },
        { t: 0.5, p: { armR: -66, forearmR: -62, torso: 5, neck: 8, armL: 18 } },
        { t: 1,   p: { armR: -74, forearmR: -54, torso: 5, neck: 7, armL: 18 } }
      ]
    },
    read: {
      loop: true, dur: 3.2,
      keys: [
        { t: 0,   p: { armL: 54, forearmL: 92, armR: -54, forearmR: -92, neck: 9, torso: 3 } },
        { t: 0.5, p: { armL: 54, forearmL: 92, armR: -54, forearmR: -92, neck: 11, torso: 3 } },
        { t: 1,   p: { armL: 54, forearmL: 92, armR: -54, forearmR: -92, neck: 9, torso: 3 } }
      ]
    },
    walk: {
      loop: true, dur: 1,
      keys: [
        { t: 0,    p: { legL: 26, shinL: -14, legR: -24, shinR: 18, armL: -22, armR: 22 }, lift: 0 },
        { t: 0.25, p: { legL: 12, shinL: -4,  legR: -8,  shinR: 6,  armL: -10, armR: 10 }, lift: 0.07 },
        { t: 0.5,  p: { legL: -24, shinL: 18, legR: 26, shinR: -14, armL: 22, armR: -22 }, lift: 0 },
        { t: 0.75, p: { legL: -8, shinL: 6,   legR: 12, shinR: -4,  armL: 10, armR: -10 }, lift: 0.07 },
        { t: 1,    p: { legL: 26, shinL: -14, legR: -24, shinR: 18, armL: -22, armR: 22 }, lift: 0 }
      ]
    },
    run: {
      loop: true, dur: 0.62,
      keys: [
        { t: 0,   p: { legL: 48, shinL: -62, legR: -44, shinR: 54, armL: -58, forearmL: -70, armR: 58, forearmR: 70, torso: 11 }, lift: 0 },
        { t: 0.5, p: { legL: -44, shinL: 54, legR: 48, shinR: -62, armL: 58, forearmL: 70, armR: -58, forearmR: -70, torso: 11 }, lift: 0.2 },
        { t: 1,   p: { legL: 48, shinL: -62, legR: -44, shinR: 54, armL: -58, forearmL: -70, armR: 58, forearmR: 70, torso: 11 }, lift: 0 }
      ]
    },
    sit: {
      dur: 0.7,
      keys: [
        { t: 0, p: {} },
        { t: 1, p: { legL: 84, shinL: -86, legR: -80, shinR: 88, torso: 3, armL: 16, armR: -16 }, lift: -0.9 }
      ]
    },
    jump: {
      dur: 0.8,
      keys: [
        { t: 0,   p: {} },
        { t: 0.3, p: { legL: 30, shinL: -48, legR: -30, shinR: 48, torso: 8 }, lift: -0.28 },
        { t: 0.6, p: { legL: 12, shinL: -6, legR: -12, shinR: 6, armL: 150, armR: -150 }, lift: 0.85 },
        { t: 1,   p: {} }
      ]
    }
  };

  /** Sample a clip at normalised time, interpolating between its keyframes. */
  function sample(clipName, t01) {
    const clip = CLIPS[clipName] || CLIPS.idle;
    const keys = clip.keys;
    let t = clip.loop ? (t01 % 1 + 1) % 1 : Math.max(0, Math.min(1, t01));
    let a = keys[0];
    let b = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) {
      if (t >= keys[i].t && t <= keys[i + 1].t) { a = keys[i]; b = keys[i + 1]; break; }
    }
    const span = (b.t - a.t) || 1;
    const k = (t - a.t) / span;
    // Smoothstep: linear interpolation between keys reads mechanical, and
    // easing is most of what separates animation from a slideshow.
    const e = k * k * (3 - 2 * k);
    const pose = {};
    RIG.forEach((bone) => {
      const av = a.p[bone.name] || 0;
      const bv = b.p[bone.name] || 0;
      if (av || bv) pose[bone.name] = lerp(av, bv, e);
    });
    pose.__lift = lerp(a.lift || 0, b.lift || 0, e);
    return pose;
  }

  /** Cross-fade two poses. This is what makes state changes not snap. */
  function mix(p1, p2, w) {
    const out = {};
    const names = new Set([...Object.keys(p1), ...Object.keys(p2)]);
    names.forEach((n) => { out[n] = lerp(p1[n] || 0, p2[n] || 0, w); });
    return out;
  }

  // --- procedural life -----------------------------------------------------
  //
  // A perfectly still figure reads as broken. These run continuously on top of
  // whatever clip is playing, at amplitudes small enough to never fight it.
  function alive(pose, time, seed) {
    const s = seed || 0;
    const breathe = Math.sin(time * 1.6 + s) * 0.9;
    const sway = Math.sin(time * 0.7 + s * 1.7) * 0.7;
    const glance = Math.sin(time * 0.45 + s * 2.3) * 2.2;
    return Object.assign({}, pose, {
      torso: (pose.torso || 0) + breathe * 0.35 + sway * 0.4,
      neck: (pose.neck || 0) - breathe * 0.3,
      head: (pose.head || 0) + glance * 0.35
    });
  }

  // --- emotion layer -------------------------------------------------------
  //
  // Entirely independent of the body. This is the point: point+angry,
  // point+sad and point+crying cost one clip and three face entries, not three
  // hand-tuned poses.
  const EMOTIONS = {
    neutral:   { browIn: 0,  browOut: 0,  lid: 0,    mouth: 0.05, open: 0.05 },
    happy:     { browIn: -1, browOut: -1, lid: 0,    mouth: 0.6,  open: 0.08 },
    laughing:  { browIn: -2, browOut: -2, lid: 0.85, mouth: 0.8,  open: 0.45 },
    sad:       { browIn: -4, browOut: 3.5, lid: 0.25, mouth: -0.55, open: 0.05 },
    crying:    { browIn: -5, browOut: 4,  lid: 0.7,  mouth: -0.65, open: 0.34, tears: true },
    angry:     { browIn: 4.5, browOut: -4, lid: 0.35, mouth: -0.45, open: 0.08 },
    thinking:  { browIn: -1.5, browOut: 2, lid: 0.2, mouth: 0.04, open: 0.04, look: [0.5, -0.6] },
    confused:  { browIn: -4.5, browOut: 1.5, lid: 0, mouth: 0,   open: 0.07, squiggle: true, look: [0.4, 0] },
    excited:   { browIn: -3, browOut: -3, lid: -0.3, mouth: 0.66, open: 0.36 },
    surprised: { browIn: -4.5, browOut: -4.5, lid: -0.5, mouth: 0, open: 0.5 },
    nervous:   { browIn: -3.5, browOut: 1, lid: 0.3, mouth: -0.2, open: 0.07, sweat: true },
    confident: { browIn: 1,  browOut: -2.5, lid: 0.15, mouth: 0.36, open: 0.05 },
    scared:    { browIn: -5, browOut: -2, lid: -0.55, mouth: -0.32, open: 0.42 },
    bored:     { browIn: 1,  browOut: 1,  lid: 0.55, mouth: -0.14, open: 0.04 },
    sleeping:  { browIn: 0,  browOut: 0,  lid: 1,    mouth: 0.1,  open: 0.1, zzz: true }
  };

  // Mouth shapes for lip sync. Fish Speech gives word timing; without phonemes
  // the renderer cycles these on syllable boundaries, which reads correctly at
  // this level of abstraction.
  const VISEMES = { closed: 0.02, open: 0.34, wide: 0.5, round: 0.22, smile: 0.12 };

  function face(emotion, time, opts = {}) {
    const e = Object.assign({}, EMOTIONS[emotion] || EMOTIONS.neutral);
    // Blink: quick, occasional, and never during a closed-eye emotion.
    if (e.lid < 0.8) {
      const phase = (time * 0.37 + (opts.seed || 0)) % 1;
      if (phase > 0.965) e.lid = Math.max(e.lid, 1);
    }
    // Mouth comes from the narration timeline, never from elapsed time.
    // Cycling visemes on a clock is how a mouth ends up moving while the
    // narrator is silent; the controller knows which word is being spoken.
    if (window.BlvckPlayback && window.BlvckPlayback.timeline()) {
      e.open = Math.max(e.open, window.BlvckPlayback.state().mouth);
    } else if (opts.speaking) {
      // No timeline bound (a preview, a test card): hold a neutral open
      // mouth rather than fake speech that cannot be in sync with anything.
      e.open = Math.max(e.open, VISEMES.open * 0.5);
    }
    return e;
  }

  // --- state machine -------------------------------------------------------
  //
  // The Director sets a state; the machine cross-fades into it. Nothing snaps,
  // and a state change never needs a bespoke transition pose.
  function Actor(opts = {}) {
    this.state = opts.state || 'idle';
    this.prev = null;
    this.blend = 1;
    this.time = 0;
    this.seed = opts.seed || Math.random() * 10;
    this.emotion = opts.emotion || 'neutral';
    this.speaking = !!opts.speaking;
  }
  Actor.prototype.setState = function (name, fadeSec) {
    if (name === this.state || !CLIPS[name]) return;
    this.prev = this.state;
    this.prevTime = this.time;
    this.state = name;
    this.blend = 0;
    this.fade = fadeSec == null ? 0.28 : fadeSec;
  };
  Actor.prototype.update = function (dt) {
    // When a timeline is playing, the controller is the clock: an actor
    // accumulating its own dt drifts against the audio and cannot be seeked.
    if (this.followTimeline !== false && window.BlvckPlayback && window.BlvckPlayback.timeline()) {
      this.time = window.BlvckPlayback.time();
    } else {
      this.time += dt;
    }
    if (this.blend < 1) this.blend = Math.min(1, this.blend + dt / (this.fade || 0.28));
  };
  Actor.prototype.pose = function () {
    const clip = CLIPS[this.state] || CLIPS.idle;
    const cur = sample(this.state, this.time / (clip.dur || 1));
    let p = cur;
    if (this.prev && this.blend < 1) {
      const pc = CLIPS[this.prev] || CLIPS.idle;
      p = mix(sample(this.prev, this.prevTime / (pc.dur || 1)), cur, this.blend);
    }
    return alive(p, this.time, this.seed);
  };

  // --- skins ---------------------------------------------------------------
  //
  // A skin draws resolved bones. Adding a look means adding one function here,
  // never another animation system — which is the reason the skeleton and the
  // drawing are separate in the first place.
  const SKINS = {};

  function drawFace(ctx, b, unit, e, colour, lineW) {
    const head = b.head;
    const r = unit * 0.62;
    const cx = (head.x0 + head.x1) / 2;
    const cy = (head.y0 + head.y1) / 2;
    ctx.lineWidth = Math.max(1.4, lineW * 0.55);
    ctx.strokeStyle = colour;
    ctx.fillStyle = colour;

    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();

    const ey = cy - r * 0.14;
    const dx = r * 0.35;
    const lx = (e.look && e.look[0]) || 0;
    const ly = (e.look && e.look[1]) || 0;

    [-1, 1].forEach((s) => {
      const x = cx + s * dx;
      if (e.lid >= 0.9) {
        ctx.beginPath();
        ctx.moveTo(x - r * 0.17, ey);
        ctx.quadraticCurveTo(x, ey + r * 0.1, x + r * 0.17, ey);
        ctx.stroke();
      } else {
        ctx.beginPath();
        ctx.arc(x + lx * r * 0.1, ey + ly * r * 0.08, r * (e.lid < 0 ? 0.15 : 0.11), 0, Math.PI * 2);
        ctx.fill();
      }
      // Brow: inner and outer ends move independently, which is what actually
      // distinguishes sad from angry from confused.
      ctx.beginPath();
      ctx.moveTo(x - s * r * 0.2, ey - r * 0.32 + e.browOut * r * 0.045);
      ctx.lineTo(x + s * r * 0.17, ey - r * 0.32 + e.browIn * r * 0.045);
      ctx.stroke();
    });

    const my = cy + r * 0.36;
    ctx.beginPath();
    if (e.squiggle) {
      const w = r * 0.4;
      ctx.moveTo(cx - w, my);
      for (let i = 0; i <= 6; i++) ctx.lineTo(cx - w + (2 * w * i) / 6, my + (i % 2 ? r * 0.07 : -r * 0.07));
      ctx.stroke();
    } else if (e.open > 0.22) {
      ctx.ellipse(cx, my, r * 0.23, r * 0.34 * (e.open * 1.5), 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.moveTo(cx - r * 0.27, my);
      ctx.quadraticCurveTo(cx, my + r * 0.46 * e.mouth, cx + r * 0.27, my);
      ctx.stroke();
    }

    if (e.tears) [-1, 1].forEach((s) => {
      ctx.beginPath();
      ctx.moveTo(cx + s * dx, ey + r * 0.17);
      ctx.lineTo(cx + s * dx, ey + r * 0.55);
      ctx.stroke();
    });
    if (e.sweat) { ctx.beginPath(); ctx.arc(cx + r * 0.8, cy - r * 0.4, r * 0.1, 0, Math.PI * 2); ctx.stroke(); }
    if (e.zzz) {
      ctx.font = `700 ${Math.round(r * 0.55)}px system-ui`;
      ctx.fillText('z', cx + r * 0.95, cy - r * 0.75);
      ctx.fillText('z', cx + r * 1.4, cy - r * 1.2);
    }
  }

  function boneLine(ctx, b, names) {
    names.forEach((n) => {
      const s = b[n];
      if (!s || !s.len) return;
      ctx.beginPath();
      ctx.moveTo(s.x0, s.y0);
      ctx.lineTo(s.x1, s.y1);
      ctx.stroke();
    });
  }

  SKINS.stickman = function (ctx, b, o) {
    ctx.strokeStyle = o.colour;
    ctx.lineWidth = o.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    boneLine(ctx, b, ['torso', 'neck', 'armL', 'forearmL', 'armR', 'forearmR',
      'legL', 'shinL', 'footL', 'legR', 'shinR', 'footR']);
    drawFace(ctx, b, o.unit, o.face, o.colour, o.lineWidth);
  };

  SKINS.whiteboard = function (ctx, b, o) {
    // Same skeleton, marker feel: a doubled slightly-offset stroke reads as
    // hand-drawn without needing a different rig or different clips.
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = o.colour;
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = o.lineWidth * 1.6;
    ctx.save();
    ctx.translate(o.unit * 0.03, o.unit * 0.03);
    boneLine(ctx, b, ['torso', 'neck', 'armL', 'forearmL', 'armR', 'forearmR',
      'legL', 'shinL', 'footL', 'legR', 'shinR', 'footR']);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.lineWidth = o.lineWidth;
    boneLine(ctx, b, ['torso', 'neck', 'armL', 'forearmL', 'armR', 'forearmR',
      'legL', 'shinL', 'footL', 'legR', 'shinR', 'footR']);
    drawFace(ctx, b, o.unit, o.face, o.colour, o.lineWidth);
  };

  SKINS.flat2d = function (ctx, b, o) {
    // Limbs as tapered capsules and a filled torso — a different LOOK from the
    // identical animation, which is the entire argument for skins.
    const cap = (n, w) => {
      const s = b[n];
      if (!s || !s.len) return;
      ctx.beginPath();
      ctx.lineWidth = w;
      ctx.lineCap = 'round';
      ctx.moveTo(s.x0, s.y0);
      ctx.lineTo(s.x1, s.y1);
      ctx.stroke();
    };
    ctx.strokeStyle = o.colour;
    const t = o.lineWidth * 2.6;
    ['legL', 'legR'].forEach((n) => cap(n, t));
    ['shinL', 'shinR'].forEach((n) => cap(n, t * 0.85));
    cap('torso', t * 1.5);
    ['armL', 'armR'].forEach((n) => cap(n, t * 0.9));
    ['forearmL', 'forearmR'].forEach((n) => cap(n, t * 0.75));
    ctx.fillStyle = o.skin || '#f2c9a0';
    const h = b.head;
    ctx.beginPath();
    ctx.arc((h.x0 + h.x1) / 2, (h.y0 + h.y1) / 2, o.unit * 0.62, 0, Math.PI * 2);
    ctx.fill();
    drawFace(ctx, b, o.unit, o.face, '#1d2026', o.lineWidth);
  };

  /** Draw one actor with a chosen skin. */
  function drawActor(ctx, actor, opts = {}) {
    const unit = opts.scale || 26;
    const pose = actor.pose ? actor.pose() : actor;
    const lift = (pose.__lift || 0) * unit;
    const bones = solve(pose, unit, { x: opts.x || 0, y: (opts.y || 0) - lift });
    const skin = SKINS[opts.skin] || SKINS.stickman;
    ctx.save();
    skin(ctx, bones, {
      unit,
      colour: opts.colour || '#1d2026',
      skin: opts.skinTone,
      lineWidth: opts.lineWidth || Math.max(2, unit * 0.13),
      // GAZE. `look` already existed but was chosen by the emotion, so every
      // figure looked wherever its mood said regardless of what was in the
      // scene with it. An explicit look overrides it, which is what lets two
      // people look AT each other — or lets one refuse to.
      face: (() => {
        const f = face(actor.emotion || opts.emotion || 'neutral', actor.time || 0,
          { seed: actor.seed || 0, speaking: actor.speaking });
        if (opts.look) f.look = opts.look;
        return f;
      })()
    });
    ctx.restore();
    return bones;
  }

  window.BlvckChar = {
    RIG, CLIPS, EMOTIONS, SKINS, VISEMES,
    Actor, solve, sample, mix, face, drawActor,
    clips: () => Object.keys(CLIPS),
    emotions: () => Object.keys(EMOTIONS),
    skins: () => Object.keys(SKINS)
  };
})();
