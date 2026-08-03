// Scene objects — the figure IN the scene rather than in front of it.
//
// Rendering the reference beat exposed this. Asked for "he had far too much to
// do", the stage produced a figure standing in an empty office, arms out,
// essentially identical across three beats. The reference image for the same
// beat has a character SITTING at a desk, HOLDING a list, with six crumpled
// drafts on the floor, pencils on the desk and a clock in a thought bubble.
//
// None of that difference is drawing quality. Every bit of it is
// representation the model did not have:
//
//   support     what the body rests on. The pose space describes what the
//               body does above its own feet and deliberately says nothing
//               about the ground, so `sit` was unreachable.
//   relation    an object is HELD, or ON a surface, or ON the floor, or in a
//               thought. The old PROPS table drew one object at a hand and had
//               no other place to put anything.
//   count       and this is the one that is easy to miss. Six crumpled drafts
//               are not decoration. They are the only thing in the frame
//               saying attempts already happened before it began. Nothing in
//               the model could express "he has been at this a while", which
//               is why beats read as repetitive even when state moved.
//
// ACCUMULATION IS WHY THE SCATTER IS SEEDED. Positions come from a
// deterministic hash of the object's index, so object #3 is always in the same
// spot. Raising the count from two to six adds four without moving the first
// two, and across beats the viewer reads drafts piling up rather than a random
// mess reshuffling. A random scatter would destroy the exact signal this
// exists to carry.
(() => {
  'use strict';

  const W = 1280;
  const H = 720;
  const GROUND = 0.84;

  const px = (x) => x * W;
  const py = (y) => y * H;

  // Cheap deterministic hash -> 0..1. Stable across frames and sessions.
  function rnd(i, salt) {
    const x = Math.sin(i * 127.1 + (salt || 0) * 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  function stroke(g, t, w) {
    g.strokeStyle = (t && (t.ink || t.text)) || '#e8edf6';
    g.lineWidth = w == null ? 3 : w;
    g.lineJoin = 'round';
    g.lineCap = 'round';
  }

  // --- the objects ---------------------------------------------------------
  //
  // Each draws centred on (x, y) at size s. Kept small and legible rather than
  // detailed: at 1280x720 with a figure 200px tall, a sheet of paper is 40px.

  const OBJECTS = {
    paper: (g, t, x, y, s) => {
      stroke(g, t, Math.max(2, s * 0.06));
      g.beginPath();
      g.moveTo(x - s * 0.34, y - s * 0.44);
      g.lineTo(x + s * 0.34, y - s * 0.40);
      g.lineTo(x + s * 0.30, y + s * 0.44);
      g.lineTo(x - s * 0.36, y + s * 0.40);
      g.closePath();
      g.stroke();
      for (let i = 0; i < 4; i++) {
        g.beginPath();
        g.moveTo(x - s * 0.24, y - s * 0.24 + i * s * 0.18);
        g.lineTo(x + s * 0.20, y - s * 0.22 + i * s * 0.18);
        g.stroke();
      }
    },
    // The evidence object. Irregular on purpose — a circle reads as a ball,
    // and a ball does not read as a discarded attempt.
    crumpled: (g, t, x, y, s) => {
      stroke(g, t, Math.max(2, s * 0.07));
      const n = 9;
      g.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const r = s * (0.26 + rnd(i, x) * 0.16);
        const px_ = x + Math.cos(a) * r;
        const py_ = y + Math.sin(a) * r * 0.9;
        if (i) g.lineTo(px_, py_); else g.moveTo(px_, py_);
      }
      g.closePath();
      g.stroke();
      // A couple of creases, which is what separates crumpled from lumpy.
      g.beginPath();
      g.moveTo(x - s * 0.16, y - s * 0.06); g.lineTo(x + s * 0.10, y + s * 0.12);
      g.moveTo(x + s * 0.04, y - s * 0.18); g.lineTo(x - s * 0.06, y + s * 0.16);
      g.stroke();
    },
    pencil: (g, t, x, y, s) => {
      stroke(g, t, Math.max(2, s * 0.07));
      g.beginPath();
      g.moveTo(x - s * 0.42, y);
      g.lineTo(x + s * 0.30, y);
      g.stroke();
      g.beginPath();
      g.moveTo(x + s * 0.30, y - s * 0.09);
      g.lineTo(x + s * 0.46, y);
      g.lineTo(x + s * 0.30, y + s * 0.09);
      g.closePath();
      g.stroke();
    },
    laptop: (g, t, x, y, s) => {
      stroke(g, t, Math.max(2, s * 0.06));
      g.beginPath();
      g.moveTo(x - s * 0.34, y + s * 0.20);
      g.lineTo(x - s * 0.24, y - s * 0.30);
      g.lineTo(x + s * 0.34, y - s * 0.30);
      g.lineTo(x + s * 0.34, y + s * 0.20);
      g.closePath();
      g.stroke();
      g.beginPath();
      g.moveTo(x - s * 0.44, y + s * 0.22);
      g.lineTo(x + s * 0.44, y + s * 0.22);
      g.stroke();
    },
    cup: (g, t, x, y, s) => {
      stroke(g, t, Math.max(2, s * 0.07));
      g.beginPath();
      g.moveTo(x - s * 0.20, y - s * 0.24);
      g.lineTo(x - s * 0.14, y + s * 0.26);
      g.lineTo(x + s * 0.14, y + s * 0.26);
      g.lineTo(x + s * 0.20, y - s * 0.24);
      g.closePath();
      g.stroke();
    },
    book: (g, t, x, y, s) => {
      stroke(g, t, Math.max(2, s * 0.06));
      g.strokeRect(x - s * 0.30, y - s * 0.22, s * 0.60, s * 0.44);
      g.beginPath();
      g.moveTo(x, y - s * 0.22); g.lineTo(x, y + s * 0.22);
      g.stroke();
    },
    phone: (g, t, x, y, s) => {
      stroke(g, t, Math.max(2, s * 0.07));
      g.strokeRect(x - s * 0.16, y - s * 0.28, s * 0.32, s * 0.56);
    },
    clock: (g, t, x, y, s) => {
      stroke(g, t, Math.max(2, s * 0.07));
      g.beginPath(); g.arc(x, y, s * 0.38, 0, Math.PI * 2); g.stroke();
      g.beginPath();
      g.moveTo(x, y); g.lineTo(x, y - s * 0.26);
      g.moveTo(x, y); g.lineTo(x + s * 0.20, y + s * 0.08);
      g.stroke();
    }
  };

  // --- support -------------------------------------------------------------
  //
  // What the body rests on. The seat is drawn behind the actor; the
  // compositor lowers and folds the figure to match.

  const SUPPORT = {
    ground: { seatY: null, sit: false },
    chair: { seatY: GROUND - 0.11, sit: true, back: true },
    stool: { seatY: GROUND - 0.09, sit: true, back: false },
    bed: { seatY: GROUND - 0.07, sit: true, back: false, wide: true },
    floor: { seatY: GROUND + 0.01, sit: true, back: false }
  };

  /** Draw the thing being sat on. Behind the figure, so it reads as support. */
  function drawSupport(g, t, name, x) {
    const s = SUPPORT[name];
    if (!s || !s.sit || s.seatY == null) return null;
    const cx = x == null ? 0.5 : x;
    const w = s.wide ? 0.20 : 0.11;
    stroke(g, t, 4);
    // Seat.
    g.beginPath();
    g.moveTo(px(cx - w), py(s.seatY));
    g.lineTo(px(cx + w), py(s.seatY));
    g.stroke();
    // Legs.
    [-w * 0.85, w * 0.85].forEach((d) => {
      g.beginPath();
      g.moveTo(px(cx + d), py(s.seatY));
      g.lineTo(px(cx + d), py(GROUND + 0.06));
      g.stroke();
    });
    if (s.back) {
      g.beginPath();
      g.moveTo(px(cx - w), py(s.seatY));
      g.lineTo(px(cx - w - 0.012), py(s.seatY - 0.19));
      g.stroke();
      for (let i = 0; i < 2; i++) {
        g.beginPath();
        g.moveTo(px(cx - w - 0.004 - i * 0.004), py(s.seatY - 0.07 - i * 0.055));
        g.lineTo(px(cx - w + 0.075), py(s.seatY - 0.07 - i * 0.055));
        g.stroke();
      }
    }
    return s;
  }

  // --- placement -----------------------------------------------------------

  /**
   * Put objects where their RELATION says they go.
   *
   *   held      at the actor's hand
   *   surface   on the desk line, spread along it
   *   floor     scattered near the feet — this is where evidence accumulates
   *   thought   inside a bubble above and to the side, for what is on the mind
   *
   * `frame` carries where the actor actually ended up, so held objects follow
   * the figure rather than the stage's default spot. Same lesson the metaphor
   * layer had to learn.
   */
  function place(ctx, theme, spec, frame) {
    const t = theme || {};
    const f = frame || {};
    const objects = (spec && spec.objects) || [];
    const actorX = f.x == null ? 0.5 : f.x;
    const actorY = f.y == null ? GROUND : f.y;
    const unit = f.unit || 42;
    const drawn = [];

    let surfaceIdx = 0;
    let floorIdx = 0;

    objects.forEach((o, oi) => {
      const draw = OBJECTS[o.kind];
      if (!draw) return;
      const count = Math.max(1, Math.min(24, Number(o.count) || 1));
      for (let i = 0; i < count; i++) {
        let x;
        let y;
        let size;
        switch (o.rel) {
          case 'held':
            // Slightly forward of the body, at hand height.
            x = actorX + 0.085;
            y = actorY - unit * 1.9 / H;
            size = unit * 1.5;
            break;
          case 'surface': {
            const k = surfaceIdx++;
            x = 0.62 + rnd(k, 7) * 0.26;
            y = (f.surfaceY == null ? GROUND - 0.10 : f.surfaceY) - 0.012;
            size = unit * 1.0;
            break;
          }
          case 'thought':
            x = actorX + 0.24;
            y = actorY - unit * 4.6 / H;
            size = unit * 1.5;
            break;
          case 'floor':
          default: {
            // Seeded, so raising the count ADDS without moving what is there.
            const k = floorIdx++;
            x = 0.20 + rnd(k, 3) * 0.66;
            y = GROUND + 0.035 + rnd(k, 11) * 0.10;
            size = unit * (0.62 + rnd(k, 5) * 0.26);
            break;
          }
        }
        // Never draw over the face.
        if (o.rel === 'floor' && Math.abs(x - actorX) < 0.05) x += 0.09;
        ctx.save();
        ctx.globalAlpha = o.rel === 'floor' ? 0.85 : 1;
        draw(ctx, t, px(x), py(y), size);
        ctx.restore();
        drawn.push({ kind: o.kind, rel: o.rel || 'floor', x: +x.toFixed(3), y: +y.toFixed(3) });
      }
    });

    // The bubble is drawn after, around whatever went in it.
    const thought = drawn.find((d) => d.rel === 'thought');
    if (thought) {
      ctx.save();
      stroke(ctx, t, 3);
      ctx.beginPath();
      ctx.ellipse(px(thought.x), py(thought.y), unit * 1.5, unit * 1.25, 0, 0, Math.PI * 2);
      ctx.stroke();
      [[0.055, 0.5, 9], [0.078, 0.72, 6]].forEach(([dx, dy, r]) => {
        ctx.beginPath();
        ctx.arc(px(thought.x - dx), py(thought.y + unit * dy / H * H / H + unit * dy), r, 0, Math.PI * 2);
        ctx.stroke();
      });
      ctx.restore();
    }
    return drawn;
  }

  window.BlvckObjects = {
    OBJECTS, SUPPORT, place, drawSupport, GROUND,
    kinds: () => Object.keys(OBJECTS),
    supports: () => Object.keys(SUPPORT)
  };
})();
