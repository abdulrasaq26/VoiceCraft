// Visual metaphors — the picture for a thing that has no picture.
//
// The last gap in the mute test. Everything else on the stage handles the
// concrete: a room is a place, a prop is an object, an actor is a person. But
// scripts are mostly ABOUT things that cannot be photographed — progress,
// setback, obstacle, choice, burden, risk, deadline. Those arrive as words
// and leave as words, so with the narration muted and the captions hidden
// they leave nothing behind at all.
//
// A metaphor is not a prop. The difference matters and it drives the API:
//
//   a prop      is small, is held, belongs to the actor, means "he has a
//               laptop"
//   a metaphor  is frame-scale, is STAGED, and the actor stands in relation
//               to it. It means "he is halfway up" or "it is in his way"
//
// So every metaphor here returns an `anchor`: where the figure must stand for
// the image to be true. A staircase with the figure planted centre-frame says
// nothing; the same staircase with the figure on the second step of six says
// "barely started", and on the fifth says "almost there". The staircase is
// not the meaning. The figure's position on it is the meaning.
//
// Progress is supplied by story state (wellbeing), so these read the same arc
// everything else on the stage reads.
(() => {
  'use strict';

  const W = 1280;
  const H = 720;
  const GROUND = 0.84;

  const px = (x) => x * W;
  const py = (y) => y * H;
  const clamp01 = (v) => Math.max(0, Math.min(1, v));

  function ink(t) { return (t && (t.ink || t.text)) || '#e8edf6'; }
  function accent(t) { return (t && t.accent) || '#f5b301'; }
  function dim(t) { return (t && t.dim) || 'rgba(160,175,200,0.45)'; }

  function line(g, pts, colour, w) {
    g.strokeStyle = colour;
    g.lineWidth = w == null ? 4 : w;
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(px(p[0]), py(p[1])) : g.moveTo(px(p[0]), py(p[1]))));
    g.stroke();
  }

  function fill(g, pts, colour, alpha) {
    g.save();
    if (alpha != null) g.globalAlpha = alpha;
    g.fillStyle = colour;
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(px(p[0]), py(p[1])) : g.moveTo(px(p[0]), py(p[1]))));
    g.closePath();
    g.fill();
    g.restore();
  }

  /** An arrowhead pointing along a direction, used by several metaphors. */
  function head(g, x, y, dx, dy, size, colour) {
    const len = Math.hypot(dx, dy) || 1;
    const ux = dx / len;
    const uy = dy / len;
    const nx = -uy;
    const ny = ux;
    fill(g, [
      [x, y],
      [x - ux * size + nx * size * 0.55, y - uy * size + ny * size * 0.55],
      [x - ux * size - nx * size * 0.55, y - uy * size - ny * size * 0.55]
    ], colour);
  }

  // --- the vocabulary -------------------------------------------------------
  //
  // Each entry draws at frame scale and reports where the actor belongs.
  // `p` is progress through the idea, 0..1, taken from story state.

  const METAPHORS = {
    /** Effort that is paying off. Steps rising left to right. */
    climb: {
      means: 'progress through difficulty',
      draw(g, t, p) {
        const n = 6;
        const x0 = 0.16;
        const w = 0.66 / n;
        const rise = 0.052;
        for (let i = 0; i < n; i++) {
          const x = x0 + i * w;
          const top = GROUND - (i + 1) * rise;
          const reached = i / n <= p;
          fill(g, [[x, top], [x + w, top], [x + w, GROUND], [x, GROUND]],
            reached ? accent(t) : dim(t), reached ? 0.30 : 0.13);
          line(g, [[x, top], [x + w, top], [x + w, top + rise]],
            reached ? accent(t) : dim(t), reached ? 5 : 3);
        }
        // Where it leads, so "up" has a destination rather than just a slope.
        head(g, px(x0 + 0.66 + 0.03), py(GROUND - n * rise - 0.04), 1, -0.6, 26, accent(t));
      },
      anchor(p) {
        const n = 6;
        const i = Math.min(n - 1, Math.floor(clamp01(p) * n));
        return { x: 0.16 + (i + 0.5) * (0.66 / 6), y: GROUND - (i + 1) * 0.052, scale: 0.92 };
      }
    },

    /** The same shape inverted. Descending steps, the figure partway down. */
    fall: {
      means: 'decline or loss',
      draw(g, t, p) {
        const n = 6;
        const x0 = 0.16;
        const w = 0.66 / n;
        const drop = 0.05;
        // p is wellbeing everywhere on the stage, so falling reads it inverted:
        // the worse things are, the further down the flight you have come.
        const gone = 1 - p;
        for (let i = 0; i < n; i++) {
          const x = x0 + i * w;
          const top = GROUND - (n - i) * drop;
          const passed = i / n <= gone;
          fill(g, [[x, top], [x + w, top], [x + w, GROUND], [x, GROUND]],
            passed ? dim(t) : accent(t), passed ? 0.16 : 0.24);
          line(g, [[x, top], [x + w, top], [x + w, top + drop]], dim(t), 3.5);
        }
        head(g, px(x0 + 0.66 + 0.03), py(GROUND - 0.02), 0.6, 1, 24, dim(t));
      },
      anchor(p) {
        const n = 6;
        const i = Math.min(n - 1, Math.floor((1 - clamp01(p)) * n));
        return { x: 0.16 + (i + 0.5) * (0.66 / 6), y: GROUND - (n - i) * 0.05, scale: 0.92 };
      }
    },

    /** Something in the way. The wall is between the figure and the light. */
    barrier: {
      means: 'obstacle or blocker',
      draw(g, t, p) {
        const x = 0.60;
        const top = GROUND - 0.34;
        fill(g, [[x, top], [x + 0.07, top], [x + 0.07, GROUND], [x, GROUND]], dim(t), 0.5);
        line(g, [[x, top], [x + 0.07, top], [x + 0.07, GROUND], [x, GROUND], [x, top]], ink(t), 4);
        // Courses of brick, so it reads as built rather than as a bar.
        for (let i = 1; i < 6; i++)
          line(g, [[x, top + i * 0.057], [x + 0.07, top + i * 0.057]], ink(t), 2);
        // What is on the other side, and how much of it is still out of reach.
        g.save();
        g.globalAlpha = 0.22 + clamp01(p) * 0.5;
        fill(g, [[x + 0.12, GROUND - 0.22], [x + 0.30, GROUND - 0.22],
                 [x + 0.30, GROUND], [x + 0.12, GROUND]], accent(t), 1);
        g.restore();
        // Blocked: the attempt stops at the wall.
        if (p < 0.5) {
          head(g, px(x - 0.03), py(GROUND - 0.16), 1, 0, 22, ink(t));
          line(g, [[x - 0.14, GROUND - 0.16], [x - 0.04, GROUND - 0.16]], ink(t), 4);
        }
      },
      anchor(p) {
        // Past the wall once the idea resolves; stuck short of it before.
        return p >= 0.5
          ? { x: 0.80, y: GROUND, scale: 1 }
          : { x: 0.38, y: GROUND, scale: 1 };
      }
    },

    /** Two futures, one body. The figure stands at the split, not past it. */
    fork: {
      means: 'a choice between two paths',
      draw(g, t, p) {
        const jx = 0.44;
        const jy = GROUND - 0.02;
        line(g, [[0.10, GROUND + 0.06], [jx, jy]], ink(t), 5);
        const taken = p >= 0.5;
        line(g, [[jx, jy], [0.86, GROUND - 0.24]], taken ? accent(t) : dim(t), taken ? 6 : 4);
        line(g, [[jx, jy], [0.86, GROUND + 0.08]], taken ? dim(t) : accent(t), taken ? 4 : 6);
        head(g, px(0.86), py(GROUND - 0.24), 1, -0.34, 20, taken ? accent(t) : dim(t));
        head(g, px(0.86), py(GROUND + 0.08), 1, 0.14, 20, taken ? dim(t) : accent(t));
      },
      anchor() { return { x: 0.40, y: GROUND, scale: 1 }; }
    },

    /** Load. It sits ON the figure, and it is heavier when things are worse. */
    weight: {
      means: 'burden, cost or pressure',
      draw(g, t, p, spot) {
        const heavy = 1 - clamp01(p);
        const x = (spot && spot.x) || 0.5;
        const w = 0.13 + heavy * 0.13;
        const h = 0.07 + heavy * 0.07;
        // Resting ON the figure, not hovering over it. A weight that is not
        // touching anyone is a floating rectangle, and the whole meaning of
        // this one is contact.
        const y = ((spot && spot.y) || GROUND) - 0.42;
        fill(g, [[x - w / 2, y - h], [x + w / 2, y - h], [x + w / 2, y], [x - w / 2, y]],
          dim(t), 0.55);
        line(g, [[x - w / 2, y - h], [x + w / 2, y - h], [x + w / 2, y], [x - w / 2, y],
                 [x - w / 2, y - h]], ink(t), 4);
        // Pressing down.
        [-1, 1].forEach((s) => head(g, px(x + s * w * 0.3), py(y + 0.035), 0, 1, 16, ink(t)));
      },
      anchor() { return null; }   // stays wherever the figure already is
    },

    /** Risk as a hole in the floor, with the far side visible. */
    gap: {
      means: 'risk, shortfall or a missing piece',
      draw(g, t, p) {
        const left = 0.40;
        const right = 0.40 + 0.24 * (1 - clamp01(p) * 0.75);
        fill(g, [[0.02, GROUND], [left, GROUND], [left, 1], [0.02, 1]], dim(t), 0.35);
        fill(g, [[right, GROUND], [0.98, GROUND], [0.98, 1], [right, 1]], dim(t), 0.35);
        line(g, [[0.02, GROUND], [left, GROUND]], ink(t), 5);
        line(g, [[right, GROUND], [0.98, GROUND]], ink(t), 5);
        line(g, [[left, GROUND], [left, GROUND + 0.10]], ink(t), 4);
        line(g, [[right, GROUND], [right, GROUND + 0.10]], ink(t), 4);
        // Closing it is the resolution.
        if (p > 0.6) line(g, [[left, GROUND - 0.005], [right, GROUND - 0.005]], accent(t), 6);
      },
      anchor(p) { return { x: p > 0.6 ? 0.62 : 0.26, y: GROUND, scale: 1 }; }
    },

    /** Time. A vessel that is emptying, and it empties as progress runs out. */
    drain: {
      means: 'time running out or a resource depleting',
      draw(g, t, p) {
        const left = clamp01(p);   // p is wellbeing, which here IS what remains
        const x = 0.74;
        const y = GROUND - 0.40;
        const w = 0.14;
        const h = 0.34;
        // Hourglass shell.
        line(g, [[x - w / 2, y], [x + w / 2, y], [x + w * 0.06, y + h / 2],
                 [x + w / 2, y + h], [x - w / 2, y + h], [x - w * 0.06, y + h / 2],
                 [x - w / 2, y]], ink(t), 4.5);
        // Upper charge shrinks; lower pile grows.
        const uh = (h / 2 - 0.012) * left;
        fill(g, [[x - w * 0.42 * left - w * 0.06, y + h / 2 - uh],
                 [x + w * 0.42 * left + w * 0.06, y + h / 2 - uh],
                 [x + w * 0.06, y + h / 2], [x - w * 0.06, y + h / 2]], accent(t), 0.8);
        const lh = (h / 2 - 0.012) * (1 - left);
        fill(g, [[x - w * 0.06, y + h / 2], [x + w * 0.06, y + h / 2],
                 [x + w * 0.44 * (1 - left) + w * 0.05, y + h / 2 + lh],
                 [x - w * 0.44 * (1 - left) - w * 0.05, y + h / 2 + lh]], accent(t), 0.55);
        if (left > 0.04 && left < 0.98)
          line(g, [[x, y + h / 2], [x, y + h / 2 + lh * 0.8]], accent(t), 2);
      },
      anchor() { return { x: 0.34, y: GROUND, scale: 1 }; }
    },

    /** What was missing, once it is there. Two ledges and a span between. */
    bridge: {
      means: 'a connection, a solution, a link',
      draw(g, t, p) {
        const left = 0.34;
        const right = 0.68;
        fill(g, [[0.02, GROUND], [left, GROUND], [left, 1], [0.02, 1]], dim(t), 0.35);
        fill(g, [[right, GROUND], [0.98, GROUND], [0.98, 1], [right, 1]], dim(t), 0.35);
        line(g, [[0.02, GROUND], [left, GROUND]], ink(t), 5);
        line(g, [[right, GROUND], [0.98, GROUND]], ink(t), 5);
        // Built as far as it has got.
        const built = left + (right - left) * clamp01(p);
        line(g, [[left, GROUND - 0.01], [built, GROUND - 0.01]], accent(t), 7);
        for (let x = left; x < built - 0.001; x += 0.045)
          line(g, [[x, GROUND - 0.01], [x, GROUND + 0.05]], accent(t), 3);
        // The rest as intent.
        if (built < right - 0.001) {
          g.save();
          g.globalAlpha = 0.35;
          g.setLineDash([10, 10]);
          line(g, [[built, GROUND - 0.01], [right, GROUND - 0.01]], dim(t), 4);
          g.setLineDash([]);
          g.restore();
        }
      },
      anchor(p) { return { x: 0.20 + clamp01(p) * 0.6, y: GROUND, scale: 0.95 }; }
    }
  };

  // --- inference ------------------------------------------------------------
  //
  // Ordered: the first match wins, so the more specific ideas are listed
  // before the general ones. These fire on the abstract vocabulary that has no
  // object behind it — the words that currently leave nothing on screen.
  const HINTS = [
    [/\b(deadline|running out|no time|too late|urgen|expir|countdown|dwindl|depleti?ng?)\b/i, 'drain'],
    [/\b(choice|choose|decide|decision|either|two options|alternative|crossroads|which path)\b/i, 'fork'],
    [/\b(obstacle|blocked?|barrier|in the way|stuck|prevent|stop(?:ped|ping)? (?:him|her|them|us)|hurdle|wall)\b/i, 'barrier'],
    [/\b(burden|weight|pressure|overwhelm|carry|heavy|strain|load|stress(?:ed|ful)?)\b/i, 'weight'],
    [/\b(risk|gap|shortfall|missing|dangerous|exposed|fall short|chasm|divide)\b/i, 'gap'],
    [/\b(connect|bridge|link|solution|solve|fix|bring together|close the gap|reach)\b/i, 'bridge'],
    [/\b(decline|fell|fall|drop|lost|losing|worse|collapse|down(?:turn|ward)|shrink|decreas)\b/i, 'fall'],
    [/\b(progress|climb|grow|growth|improve|better|rise|rising|advance|step by step|build up|increas|recover|rebuil|bounce(?:d)? back|turn(?:ed)? (?:it )?around)\w*/i, 'climb']
  ];

  /** The metaphor a line of script is reaching for, or null if it is concrete. */
  function infer(text) {
    const hay = String(text || '');
    for (const [re, name] of HINTS) if (re.test(hay)) return name;
    return null;
  }

  /**
   * Draw one, and report where the figure has to stand for it to be true.
   *
   * `progress` is 0..1 from story state. Callers that have no state should
   * pass nothing and get the midpoint, which still reads as a picture — just
   * not as a moment in an arc.
   */
  function draw(ctx, name, theme, progress, spot) {
    const m = METAPHORS[name];
    if (!m) return null;
    const p = progress == null ? 0.5 : clamp01(progress);
    ctx.save();
    m.draw(ctx, theme || {}, p, spot);
    ctx.restore();
    return m.anchor ? m.anchor(p) : null;
  }

  /** Where the figure belongs, without drawing. */
  function anchorFor(name, progress) {
    const m = METAPHORS[name];
    if (!m || !m.anchor) return null;
    return m.anchor(progress == null ? 0.5 : clamp01(progress));
  }

  window.BlvckMetaphor = {
    METAPHORS,
    draw,
    infer,
    anchorFor,
    means: (n) => (METAPHORS[n] ? METAPHORS[n].means : null),
    names: () => Object.keys(METAPHORS)
  };
})();
