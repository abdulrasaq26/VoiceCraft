// Stickman engine — skeletal vector characters, drawn not generated.
//
// A stick figure is the one thing a diffusion model is worst at and a few
// hundred lines of geometry is best at. Measured on the real backend: an SDXL
// beat costs seconds of GPU and comes back slightly different every time; this
// draws in under a millisecond and is identical on every run, so a character
// keeps the same proportions across a whole video for free.
//
// The figure is a SKELETON, not a picture. Poses are joint angles, so any pose
// can be blended into any other and new actions are data, not new artwork.
//
//   BlvckStick.draw(ctx, opts)          one frame
//   BlvckStick.render(spec)             -> Blob (a finished card)
//   BlvckStick.POSES / EXPRESSIONS      the libraries
(() => {
  'use strict';

  // Proportions in "units"; one unit ~ the head radius. Keeping everything
  // relative means scale is a single multiplier and the figure never distorts.
  const P = {
    head: 1.0,
    neck: 0.45,
    torso: 2.6,
    upperArm: 1.25,
    lowerArm: 1.15,
    upperLeg: 1.5,
    lowerLeg: 1.45,
    foot: 0.42,
    hand: 0.16
  };

  // Angles are degrees clockwise from straight DOWN, because limbs hang. That
  // makes a rest pose all zeros and every pose readable at a glance.
  const REST = {
    lean: 0,           // torso tilt
    headTilt: 0,
    shoulderL: 8, elbowL: 4,
    shoulderR: -8, elbowR: -4,
    hipL: 6, kneeL: 2,
    hipR: -6, kneeR: -2,
    bounce: 0          // vertical offset in units, for walk/jump
  };

  const pose = (o) => Object.assign({}, REST, o);

  // --- pose library --------------------------------------------------------
  const POSES = {
    stand: pose({}),
    standRelaxed: pose({ shoulderL: 14, elbowL: 10, shoulderR: -12, elbowR: -8, lean: 1 }),
    point: pose({ shoulderR: -95, elbowR: -95, shoulderL: 12, elbowL: 8 }),
    pointUp: pose({ shoulderR: -150, elbowR: -160, shoulderL: 10 }),
    wave: pose({ shoulderR: -140, elbowR: -105, shoulderL: 10, headTilt: -4 }),
    explain: pose({ shoulderL: 55, elbowL: 75, shoulderR: -55, elbowR: -75, lean: 0 }),
    shrug: pose({ shoulderL: 62, elbowL: 100, shoulderR: -62, elbowR: -100, headTilt: 0 }),
    think: pose({ shoulderR: -60, elbowR: -128, shoulderL: 16, elbowL: 10, headTilt: -8, lean: 2 }),
    facepalm: pose({ shoulderR: -55, elbowR: -150, shoulderL: 12, headTilt: 10, lean: 4 }),
    celebrate: pose({ shoulderL: 155, elbowL: 155, shoulderR: -155, elbowR: -155, headTilt: 0, bounce: -0.25 }),
    thumbsUp: pose({ shoulderR: -48, elbowR: -110, shoulderL: 12 }),
    thumbsDown: pose({ shoulderR: -20, elbowR: -30, shoulderL: 12 }),
    write: pose({ shoulderR: -78, elbowR: -60, shoulderL: 20, elbowL: 26, lean: 6, headTilt: 8 }),
    read: pose({ shoulderL: 58, elbowL: 96, shoulderR: -58, elbowR: -96, headTilt: 10, lean: 4 }),
    type: pose({ shoulderL: 48, elbowL: 92, shoulderR: -48, elbowR: -92, lean: 5, headTilt: 6 }),
    sit: pose({ hipL: 82, kneeL: -80, hipR: 78, kneeR: -84, lean: 3, shoulderL: 16, shoulderR: -16 }),
    walk: pose({ hipL: 26, kneeL: -12, hipR: -24, kneeR: 16, shoulderL: -20, elbowL: -14, shoulderR: 22, elbowR: 16 }),
    run: pose({ hipL: 46, kneeL: -58, hipR: -42, kneeR: 52, shoulderL: -54, elbowL: -76, shoulderR: 56, elbowR: 74, lean: 12, bounce: -0.18 }),
    jump: pose({ hipL: 34, kneeL: -52, hipR: -34, kneeR: -52, shoulderL: 150, elbowL: 140, shoulderR: -150, elbowR: -140, bounce: -0.75 }),
    push: pose({ shoulderL: 78, elbowL: 8, shoulderR: -78, elbowR: -8, lean: 14, hipL: 14, hipR: -20 }),
    pull: pose({ shoulderL: 40, elbowL: 96, shoulderR: -40, elbowR: -96, lean: -10, hipL: -12, hipR: 16 }),
    lookAround: pose({ headTilt: -14, shoulderL: 12, shoulderR: -12 }),
    gesture: pose({ shoulderR: -70, elbowR: -40, shoulderL: 14, elbowL: 10, headTilt: -3 })
  };

  // --- expression library --------------------------------------------------
  //
  // brow: [innerY, outerY] offsets; eye: shape; mouth: a curve amount plus
  // opening. Small numbers do a lot of work at this scale.
  const EXPRESSIONS = {
    neutral:   { brow: [0, 0],    eye: 'open',   mouth: 0,     open: 0.06 },
    happy:     { brow: [-1, -1],  eye: 'open',   mouth: 0.55,  open: 0.10 },
    laughing:  { brow: [-2, -2],  eye: 'closed', mouth: 0.75,  open: 0.42 },
    sad:       { brow: [-3, 3],   eye: 'open',   mouth: -0.5,  open: 0.06 },
    crying:    { brow: [-3, 3],   eye: 'closed', mouth: -0.6,  open: 0.30, tears: true },
    angry:     { brow: [4, -4],   eye: 'narrow', mouth: -0.42, open: 0.10 },
    thinking:  { brow: [-2, 2],   eye: 'up',     mouth: 0.06,  open: 0.05 },
    confused:  { brow: [-4, 2],   eye: 'open',   mouth: 0.02,  open: 0.08, squiggle: true },
    excited:   { brow: [-3, -3],  eye: 'wide',   mouth: 0.62,  open: 0.34 },
    surprised: { brow: [-4, -4],  eye: 'wide',   mouth: 0,     open: 0.44 },
    nervous:   { brow: [-3, 1],   eye: 'narrow', mouth: -0.18, open: 0.08, sweat: true },
    confident: { brow: [1, -2],   eye: 'open',   mouth: 0.34,  open: 0.07 },
    scared:    { brow: [-5, -2],  eye: 'wide',   mouth: -0.3,  open: 0.36 },
    bored:     { brow: [1, 1],    eye: 'narrow', mouth: -0.12, open: 0.05 },
    sleeping:  { brow: [0, 0],    eye: 'closed', mouth: 0.08,  open: 0.12, zzz: true },
    talking:   { brow: [0, 0],    eye: 'open',   mouth: 0.2,   open: 0.30 }
  };

  const rad = (d) => (d * Math.PI) / 180;
  const lerp = (a, b, t) => a + (b - a) * t;

  /** Blend two poses. Animation is interpolation, so every action is reusable. */
  function blend(a, b, t) {
    const out = {};
    Object.keys(REST).forEach((k) => {
      out[k] = lerp(a[k] == null ? REST[k] : a[k], b[k] == null ? REST[k] : b[k], t);
    });
    return out;
  }

  function posed(name, t) {
    const base = POSES[name] || POSES.stand;
    if (!t) return base;
    return blend(POSES.stand, base, Math.max(0, Math.min(1, t)));
  }

  // Walk/run read as motion only if the legs cycle; a static "walk" pose looks
  // like someone standing oddly.
  function cycle(name, phase) {
    if (name !== 'walk' && name !== 'run') return POSES[name] || POSES.stand;
    const p = POSES[name];
    const mirrored = Object.assign({}, p, {
      hipL: p.hipR, kneeL: p.kneeR, hipR: p.hipL, kneeR: p.kneeL,
      shoulderL: p.shoulderR, elbowL: p.elbowR, shoulderR: p.shoulderL, elbowR: p.elbowL
    });
    const t = (Math.sin(phase * Math.PI * 2) + 1) / 2;
    const out = blend(p, mirrored, t);
    // Body rises at mid-stride.
    out.bounce = (p.bounce || 0) - Math.abs(Math.sin(phase * Math.PI * 2)) * (name === 'run' ? 0.16 : 0.07);
    return out;
  }

  /** Walk a limb: returns the far end of a two-segment chain and draws it. */
  function limb(ctx, x, y, a1, l1, a2, l2, u) {
    const x1 = x + Math.sin(rad(a1)) * l1 * u;
    const y1 = y + Math.cos(rad(a1)) * l1 * u;
    const x2 = x1 + Math.sin(rad(a1 + a2)) * l2 * u;
    const y2 = y1 + Math.cos(rad(a1 + a2)) * l2 * u;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    return [x2, y2, x1, y1];
  }

  function drawFace(ctx, cx, cy, r, ex, u, colour) {
    const e = EXPRESSIONS[ex] || EXPRESSIONS.neutral;
    const eyeY = cy - r * 0.12;
    const dx = r * 0.36;
    ctx.lineWidth = Math.max(1.5, u * 0.09);

    // Eyes
    [-1, 1].forEach((side) => {
      const x = cx + side * dx;
      ctx.beginPath();
      if (e.eye === 'closed') {
        ctx.moveTo(x - r * 0.16, eyeY);
        ctx.quadraticCurveTo(x, eyeY + r * 0.12, x + r * 0.16, eyeY);
        ctx.stroke();
      } else if (e.eye === 'narrow') {
        ctx.moveTo(x - r * 0.16, eyeY);
        ctx.lineTo(x + r * 0.16, eyeY);
        ctx.stroke();
      } else {
        const rr = e.eye === 'wide' ? r * 0.15 : r * 0.11;
        const oy = e.eye === 'up' ? -r * 0.06 : 0;
        ctx.arc(x, eyeY + oy, rr, 0, Math.PI * 2);
        ctx.fillStyle = colour;
        ctx.fill();
      }
    });

    // Brows — the strongest single signal of mood on a face this simple.
    [-1, 1].forEach((side, i) => {
      const x = cx + side * dx;
      const inner = e.brow[0] * r * 0.045;
      const outer = e.brow[1] * r * 0.045;
      ctx.beginPath();
      ctx.moveTo(x - side * r * 0.19, eyeY - r * 0.3 + (side < 0 ? outer : outer));
      ctx.lineTo(x + side * r * 0.16, eyeY - r * 0.3 + inner);
      ctx.stroke();
    });

    // Mouth
    const my = cy + r * 0.34;
    ctx.beginPath();
    if (e.squiggle) {
      const w = r * 0.42;
      ctx.moveTo(cx - w, my);
      for (let i = 0; i <= 6; i++) {
        ctx.lineTo(cx - w + (w * 2 * i) / 6, my + (i % 2 ? r * 0.07 : -r * 0.07));
      }
      ctx.stroke();
    } else if (e.open > 0.25) {
      ctx.ellipse(cx, my, r * 0.24, r * 0.3 * e.open * 1.6, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.moveTo(cx - r * 0.28, my);
      ctx.quadraticCurveTo(cx, my + r * 0.5 * e.mouth, cx + r * 0.28, my);
      ctx.stroke();
    }

    // Small tells that carry a lot of meaning for very little geometry.
    if (e.tears) {
      [-1, 1].forEach((s) => {
        ctx.beginPath();
        ctx.moveTo(cx + s * dx, eyeY + r * 0.16);
        ctx.lineTo(cx + s * dx, eyeY + r * 0.52);
        ctx.stroke();
      });
    }
    if (e.sweat) {
      ctx.beginPath();
      ctx.arc(cx + r * 0.78, cy - r * 0.42, r * 0.11, 0, Math.PI * 2);
      ctx.stroke();
    }
    if (e.zzz) {
      ctx.font = `700 ${Math.round(r * 0.6)}px system-ui`;
      ctx.fillStyle = colour;
      ctx.fillText('z', cx + r * 0.9, cy - r * 0.7);
      ctx.fillText('z', cx + r * 1.35, cy - r * 1.15);
    }
  }

  /**
   * Draw one figure.
   * opts: { x, y, scale, action, expression, phase, colour, lineWidth, flip }
   */
  function draw(ctx, opts = {}) {
    const u = opts.scale || 26;             // one unit in pixels
    const colour = opts.colour || '#1d2026';
    const action = opts.action || 'stand';
    const p = opts.phase != null ? cycle(action, opts.phase) : posed(action);
    const flip = opts.flip ? -1 : 1;

    ctx.save();
    ctx.translate(opts.x || 0, (opts.y || 0) + (p.bounce || 0) * u);
    ctx.scale(flip, 1);
    ctx.strokeStyle = colour;
    ctx.lineWidth = opts.lineWidth || Math.max(2, u * 0.13);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    // Torso runs from the neck down to the hips, leaning from the hip.
    const hipX = 0;
    const hipY = 0;
    const lean = rad(p.lean);
    const neckX = hipX - Math.sin(lean) * P.torso * u;
    const neckY = hipY - Math.cos(lean) * P.torso * u;

    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(neckX, neckY);
    ctx.stroke();

    // Legs from the hip, arms from the shoulder (just below the neck).
    limb(ctx, hipX, hipY, p.hipL, P.upperLeg, p.kneeL, P.lowerLeg, u);
    limb(ctx, hipX, hipY, p.hipR, P.upperLeg, p.kneeR, P.lowerLeg, u);
    const shX = neckX;
    const shY = neckY + P.neck * 0.2 * u;
    limb(ctx, shX, shY, p.shoulderL, P.upperArm, p.elbowL, P.lowerArm, u);
    limb(ctx, shX, shY, p.shoulderR, P.upperArm, p.elbowR, P.lowerArm, u);

    // Head sits above the neck, tilting with it.
    const headR = P.head * u * 0.62;
    const tilt = rad(p.lean + p.headTilt);
    const hx = neckX - Math.sin(tilt) * (P.neck * u + headR);
    const hy = neckY - Math.cos(tilt) * (P.neck * u + headR);
    ctx.beginPath();
    ctx.moveTo(neckX, neckY);
    ctx.lineTo(hx + Math.sin(tilt) * headR, hy + Math.cos(tilt) * headR);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(hx, hy, headR, 0, Math.PI * 2);
    ctx.stroke();

    // The face is drawn unflipped so text-like marks never mirror.
    ctx.save();
    ctx.scale(flip, 1);
    drawFace(ctx, hx * flip, hy, headR, opts.expression, u, colour);
    ctx.restore();

    ctx.restore();
    return { headX: hx, headY: hy, hipX, hipY, unit: u };
  }

  // --- finished card -------------------------------------------------------

  const W = 1280;
  const H = 720;

  /**
   * A whole scene: figures on a plain ground with an optional caption.
   * spec: { title, figures:[{action,expression,x,scale,flip}], caption, theme }
   */
  async function render(spec = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const light = spec.theme !== 'dark';
    const bg = light ? '#f7f6f1' : '#12141a';
    const ink = light ? '#1d2026' : '#f2f4f8';
    const accent = spec.accent || '#f5b301';

    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    if (spec.title) {
      ctx.fillStyle = ink;
      ctx.font = `800 54px "Segoe UI", Arial, sans-serif`;
      ctx.fillText(String(spec.title), 80, 112);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(80, 136);
      ctx.lineTo(80 + Math.min(ctx.measureText(String(spec.title)).width, W - 200), 136);
      ctx.stroke();
    }

    const figures = Array.isArray(spec.figures) && spec.figures.length
      ? spec.figures
      : [{ action: 'explain', expression: 'happy' }];

    const groundY = H - 150;
    // Ground line, so figures stand on something rather than float.
    ctx.strokeStyle = light ? '#d8d4c8' : '#252a34';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(60, groundY + 2);
    ctx.lineTo(W - 60, groundY + 2);
    ctx.stroke();

    figures.forEach((f, i) => {
      const n = figures.length;
      const x = f.x != null ? f.x : W * ((i + 1) / (n + 1));
      draw(ctx, {
        x,
        y: groundY,
        scale: f.scale || 62,
        action: f.action || 'stand',
        expression: f.expression || 'neutral',
        phase: f.phase,
        flip: f.flip,
        colour: f.colour || ink
      });
    });

    if (spec.caption) {
      ctx.fillStyle = ink;
      ctx.font = `600 34px "Segoe UI", Arial, sans-serif`;
      const t = String(spec.caption);
      const w = ctx.measureText(t).width;
      ctx.fillText(t, Math.max(60, (W - w) / 2), H - 56);
    }

    return new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));
  }

  window.BlvckStick = {
    draw,
    render,
    blend,
    cycle,
    POSES,
    EXPRESSIONS,
    actions: () => Object.keys(POSES),
    expressions: () => Object.keys(EXPRESSIONS)
  };
})();
