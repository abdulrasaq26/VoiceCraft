// Environments — illustrated places, not wireframes.
//
// The first pass drew a few stroked rectangles and called it a kitchen. A
// figure standing in an empty box with three lines reads as unfinished, and the
// environment is part of the storytelling language: it tells the viewer WHERE
// before a word is spoken.
//
// So these are built as illustrations:
//
//   depth      a floor plane and a wall plane, so the figure stands IN a room
//              rather than in front of a diagram of one
//   fill       shapes are filled, not outlined — an outline reads as a plan,
//              a fill reads as a place
//   layering   back wall, mid furniture, foreground props, each darker or
//              lighter than the last so the eye separates them
//   style      the same room drawn as marker on whiteboard, as flat vector, or
//              as clean line art, following the project's visual style
//
// Actors are drawn on top by the compositor and are never obscured: everything
// here stays behind the figure line, and foreground pieces are kept to the
// frame edges.
(() => {
  'use strict';

  const W = 1280;
  const H = 720;
  const HORIZON = 0.58;   // where the wall meets the floor
  const GROUND = 0.84;    // where actors' feet land

  // --- colour ---------------------------------------------------------------

  function toRGB(hex) {
    const h = String(hex).replace('#', '');
    const n = h.length === 3
      ? h.split('').map((c) => parseInt(c + c, 16))
      : [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    return n.some(isNaN) ? [0, 0, 0] : n;
  }

  const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));
  const toHex = (rgb) =>
    '#' + rgb.map((v) => clamp255(v).toString(16).padStart(2, '0')).join('');

  /**
   * Push a colour warm or cold and drain or restore its saturation.
   *
   * This is the mechanism the room's state runs through. `warmth` above zero
   * lifts red and drops blue (afternoon light, recovery); below zero does the
   * reverse (a cold, clinical, failing room). `life` below 1 pulls every
   * channel toward its own grey, which is what a place looks like when the
   * story has gone wrong — not darker, drained.
   */
  function temper(hex, warmth, life) {
    const [r, g, b] = toRGB(hex);
    const grey = r * 0.299 + g * 0.587 + b * 0.114;
    const k = life == null ? 1 : life;
    let out = [grey + (r - grey) * k, grey + (g - grey) * k, grey + (b - grey) * k];
    const w = warmth || 0;
    out = [out[0] + w * 26, out[1] + w * 6, out[2] - w * 22];
    return toHex(out);
  }

  // --- palettes per visual style ------------------------------------------
  //
  // The same geometry, three different materials. A whiteboard room is marker
  // on white; a flat-2D room is filled shapes; a stickman room is clean line
  // art with light washes so it never competes with the figure.
  //
  // `mood` is optional. When it is supplied the palette is no longer fixed:
  // the same room, drawn at two points in the story, comes back as two
  // different places. See temper() above.
  function skinFor(style, t, mood) {
    const s = basePalette(style, t);
    if (!mood) return s;

    // wellbeing 0.55 is the neutral room. Above it the place warms and its
    // colour returns; below it the place cools and drains.
    const well = mood.wellbeing == null ? 0.55 : mood.wellbeing;
    const warmth = Math.max(-1, Math.min(1, (well - 0.55) * 1.9));
    const life = Math.max(0.35, Math.min(1.1, 0.62 + well * 0.7));

    ['wall', 'floor', 'solid', 'soft', 'line'].forEach((k) => {
      if (s[k]) s[k] = temper(s[k], warmth * 0.9, life);
    });
    // The accent is the room's light. It holds its hue but loses its strength.
    s.accent = temper(s.accent, warmth, Math.max(0.45, life));
    s.light = Math.max(0.12, Math.min(1, 0.25 + well * 1.1));
    s.warmth = warmth;
    s.life = life;
    return s;
  }

  function basePalette(style, t) {
    const accent = (t && t.accent) || '#f5b301';
    switch (style) {
      case 'whiteboard':
        return {
          wall: '#f7f5ef', floor: '#efece3', line: '#2b2b2b',
          solid: '#ffffff', soft: '#e6e2d6', accent, ink: '#2b2b2b', lineW: 3.4, rough: true
        };
      case 'flat2d':
        return {
          wall: '#26324a', floor: '#1b2437', line: '#0f1523',
          solid: '#33415c', soft: '#2b3852', accent, ink: '#e8edf6', lineW: 0, rough: false
        };
      default: // stickman / line art
        return {
          wall: '#141a24', floor: '#0e131b', line: '#39465c',
          solid: '#1b2432', soft: '#161d28', accent, ink: '#c7d2e2', lineW: 2.4, rough: false
        };
    }
  }

  // --- primitives ----------------------------------------------------------

  const px = (x) => x * W;
  const py = (y) => y * H;

  /** A filled shape with an optional outline — the workhorse. */
  function shape(g, s, pts, fill, stroke) {
    g.beginPath();
    pts.forEach((p, i) => (i ? g.lineTo(px(p[0]), py(p[1])) : g.moveTo(px(p[0]), py(p[1]))));
    g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (s.lineW && stroke !== false) { g.strokeStyle = s.line; g.lineWidth = s.lineW; g.stroke(); }
  }

  const rect = (g, s, x, y, w, h, fill, stroke) =>
    shape(g, s, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], fill, stroke);

  /**
   * A box drawn with a visible side face, so furniture has volume.
   * `dir` is which side the depth falls away to.
   */
  function solid(g, s, x, y, w, h, depth, fill, side, dir) {
    const d = depth == null ? 0.018 : depth;
    const sx = dir === 'left' ? -d : d;
    shape(g, s, [[x, y], [x + w, y], [x + w + sx, y - d * 0.62], [x + sx, y - d * 0.62]], side || s.soft);
    rect(g, s, x, y, w, h, fill || s.solid);
  }

  /** Room shell: back wall, floor, and the line where they meet. */
  function room(g, s, opts = {}) {
    rect(g, s, 0, 0, 1, HORIZON, s.wall, false);
    rect(g, s, 0, HORIZON, 1, 1 - HORIZON, s.floor, false);
    if (s.lineW) {
      g.strokeStyle = s.line;
      g.lineWidth = s.lineW;
      g.beginPath();
      g.moveTo(0, py(HORIZON));
      g.lineTo(W, py(HORIZON));
      g.stroke();
    }
    // Perspective lines on the floor give depth without any 3D work.
    if (opts.perspective !== false) {
      g.save();
      g.globalAlpha = 0.18;
      g.strokeStyle = s.line || s.ink;
      g.lineWidth = 2;
      [0.12, 0.38, 0.62, 0.88].forEach((x) => {
        g.beginPath();
        g.moveTo(px(x), py(HORIZON));
        g.lineTo(px(x < 0.5 ? x - 0.16 : x + 0.16), py(1));
        g.stroke();
      });
      g.restore();
    }
  }

  const window_ = (g, s, x, y, w, h) => {
    solid(g, s, x, y, w, h, 0.012, s.soft);
    g.save();
    // The pane is how bright the world outside is, and every room has one.
    // This is the single lever that makes a good day and a bad day look
    // different without redrawing any furniture.
    g.globalAlpha = 0.18 + (s.light == null ? 0.5 : s.light) * 0.62;
    rect(g, s, x + 0.008, y + 0.012, w - 0.016, h - 0.024, s.accent, false);
    g.restore();
    // Remembered so draw() can throw light from it across the floor.
    s._window = { x: x + w / 2, y: y + h, w, h };
    if (s.lineW) {
      g.strokeStyle = s.line; g.lineWidth = s.lineW * 0.7;
      g.beginPath(); g.moveTo(px(x + w / 2), py(y)); g.lineTo(px(x + w / 2), py(y + h)); g.stroke();
      g.beginPath(); g.moveTo(px(x), py(y + h / 2)); g.lineTo(px(x + w), py(y + h / 2)); g.stroke();
    }
  };

  const doorway = (g, s, x, w) => {
    solid(g, s, x, HORIZON - 0.30, w, 0.30, 0.014, s.soft);
    rect(g, s, x + 0.012, HORIZON - 0.27, w - 0.024, 0.27, s.floor);
  };

  const poster = (g, s, x, y, w, h, colour) => {
    solid(g, s, x, y, w, h, 0.008, colour || s.soft);
  };

  const plant = (g, s, x, base) => {
    rect(g, s, x - 0.018, base - 0.05, 0.036, 0.05, s.soft);
    g.fillStyle = s.accent;
    g.globalAlpha = 0.75;
    [[0, -0.09, 0.028], [-0.026, -0.06, 0.022], [0.026, -0.065, 0.022]].forEach(([dx, dy, r]) => {
      g.beginPath();
      g.ellipse(px(x + dx), py(base + dy), px(r) * 0.6, py(r), 0, 0, Math.PI * 2);
      g.fill();
    });
    g.globalAlpha = 1;
  };

  // --- rooms ---------------------------------------------------------------
  //
  // Each fills the frame and leaves the centre clear for actors.

  const ENVIRONMENTS = {
    none: null,

    kitchen(g, s) {
      room(g, s);
      // Counter run along the left, cabinets above.
      solid(g, s, 0.02, HORIZON - 0.02, 0.30, 0.22, 0.02, s.solid);
      rect(g, s, 0.02, HORIZON - 0.04, 0.30, 0.03, s.soft);
      poster(g, s, 0.04, 0.16, 0.12, 0.16);
      poster(g, s, 0.18, 0.16, 0.12, 0.16);
      // Appliance on the right, window above the sink.
      solid(g, s, 0.80, HORIZON - 0.04, 0.16, 0.26, 0.018, s.solid, null, 'left');
      window_(g, s, 0.56, 0.14, 0.18, 0.22);
      plant(g, s, 0.74, HORIZON + 0.02);
    },

    clinic(g, s) {
      room(g, s);
      // Bed with a raised head end.
      solid(g, s, 0.60, HORIZON + 0.02, 0.34, 0.10, 0.022, s.solid, null, 'left');
      rect(g, s, 0.60, HORIZON - 0.06, 0.05, 0.08, s.soft);
      // Cabinet, screen and a chart on the wall.
      solid(g, s, 0.03, HORIZON - 0.02, 0.14, 0.20, 0.016, s.solid);
      poster(g, s, 0.05, 0.14, 0.14, 0.20, s.soft);
      window_(g, s, 0.30, 0.13, 0.20, 0.24);
    },

    gym(g, s) {
      room(g, s);
      solid(g, s, 0.62, HORIZON + 0.06, 0.30, 0.08, 0.02, s.solid, null, 'left');
      // Treadmill upright.
      rect(g, s, 0.88, HORIZON - 0.10, 0.02, 0.18, s.soft);
      // Weight rack.
      rect(g, s, 0.04, HORIZON - 0.02, 0.16, 0.03, s.soft);
      [0.06, 0.11, 0.16].forEach((x) => rect(g, s, x, HORIZON - 0.07, 0.03, 0.05, s.solid));
      window_(g, s, 0.34, 0.12, 0.24, 0.26);
    },

    office(g, s) {
      room(g, s);
      // Desk with a monitor and a chair back.
      solid(g, s, 0.56, HORIZON + 0.04, 0.34, 0.05, 0.022, s.solid, null, 'left');
      rect(g, s, 0.66, HORIZON - 0.08, 0.14, 0.11, s.soft);
      rect(g, s, 0.71, HORIZON + 0.03, 0.04, 0.02, s.soft);
      // Shelving and a window.
      solid(g, s, 0.03, HORIZON - 0.20, 0.13, 0.38, 0.014, s.solid);
      [0.06, 0.16, 0.26].forEach((dy) => rect(g, s, 0.04, HORIZON - 0.20 + dy, 0.11, 0.012, s.soft));
      window_(g, s, 0.24, 0.12, 0.22, 0.26);
      plant(g, s, 0.50, HORIZON + 0.04);
    },

    meeting(g, s) {
      room(g, s);
      solid(g, s, 0.22, HORIZON + 0.08, 0.56, 0.06, 0.026, s.solid);
      [0.30, 0.70].forEach((x) => rect(g, s, x, HORIZON + 0.14, 0.03, 0.10, s.soft));
      poster(g, s, 0.34, 0.12, 0.32, 0.24, s.soft);
      window_(g, s, 0.02, 0.14, 0.16, 0.24);
    },

    classroom(g, s) {
      room(g, s);
      // Board across the back.
      solid(g, s, 0.10, 0.10, 0.46, 0.28, 0.014, s.soft);
      rect(g, s, 0.12, 0.12, 0.42, 0.24, s.wall);
      // Desks in two rows, smaller behind for depth.
      [[0.16, 0.72, 0.14], [0.38, 0.72, 0.14], [0.62, 0.66, 0.11]].forEach(([x, y, w]) =>
        solid(g, s, x, y, w, 0.04, 0.016, s.solid));
      window_(g, s, 0.74, 0.14, 0.20, 0.24);
    },

    store(g, s) {
      room(g, s);
      solid(g, s, 0.58, HORIZON + 0.02, 0.36, 0.14, 0.022, s.solid, null, 'left');
      // Stocked shelving behind.
      solid(g, s, 0.03, HORIZON - 0.26, 0.24, 0.42, 0.016, s.solid);
      [0.08, 0.20, 0.32].forEach((dy) => {
        rect(g, s, 0.04, HORIZON - 0.26 + dy, 0.22, 0.012, s.soft);
        [0.06, 0.12, 0.18].forEach((x) => rect(g, s, x, HORIZON - 0.30 + dy, 0.04, 0.04, s.soft));
      });
    },

    street(g, s) {
      // No interior: sky, pavement, buildings receding.
      rect(g, s, 0, 0, 1, HORIZON, s.wall, false);
      rect(g, s, 0, HORIZON, 1, 1 - HORIZON, s.floor, false);
      [[0.00, 0.16, 0.20], [0.20, 0.24, 0.16], [0.72, 0.20, 0.15], [0.87, 0.28, 0.13]]
        .forEach(([x, y, w]) => {
          solid(g, s, x, y, w, HORIZON - y, 0.012, s.solid);
          for (let r = 0; r < 3; r++)
            for (let c = 0; c < 2; c++)
              rect(g, s, x + 0.02 + c * (w / 2.4), y + 0.05 + r * 0.09, w / 4, 0.05, s.soft);
        });
      // Kerb line.
      g.save(); g.globalAlpha = 0.4;
      g.strokeStyle = s.line || s.ink; g.lineWidth = 3;
      g.beginPath(); g.moveTo(0, py(HORIZON + 0.10)); g.lineTo(W, py(HORIZON + 0.10)); g.stroke();
      g.restore();
    },

    field(g, s) {
      rect(g, s, 0, 0, 1, HORIZON, s.wall, false);
      // Rolling ground rather than a flat line.
      g.beginPath();
      g.moveTo(0, py(HORIZON + 0.04));
      for (let x = 0; x <= 1.001; x += 0.04)
        g.lineTo(px(x), py(HORIZON + 0.04 - Math.sin(x * 5.2) * 0.028));
      g.lineTo(W, H); g.lineTo(0, H); g.closePath();
      g.fillStyle = s.floor; g.fill();
      if (s.lineW) { g.strokeStyle = s.line; g.lineWidth = s.lineW; g.stroke(); }
      // Crop rows converging, which is what sells a field.
      g.save(); g.globalAlpha = 0.3;
      g.strokeStyle = s.accent; g.lineWidth = 2;
      for (let i = 0; i < 9; i++) {
        g.beginPath();
        g.moveTo(px(0.5 + (i - 4) * 0.02), py(HORIZON + 0.06));
        g.lineTo(px(0.5 + (i - 4) * 0.16), py(1));
        g.stroke();
      }
      g.restore();
      [[0.08, 0.44], [0.90, 0.47]].forEach(([x, y]) => {
        rect(g, s, x - 0.006, y, 0.012, HORIZON - y + 0.02, s.soft);
        g.fillStyle = s.solid;
        g.beginPath(); g.ellipse(px(x), py(y), px(0.035) * 0.6, py(0.05), 0, 0, Math.PI * 2); g.fill();
      });
    },

    home(g, s) {
      room(g, s);
      // Sofa with back and arms.
      solid(g, s, 0.58, HORIZON + 0.04, 0.32, 0.10, 0.022, s.solid, null, 'left');
      rect(g, s, 0.58, HORIZON - 0.06, 0.32, 0.10, s.soft);
      rect(g, s, 0.86, HORIZON - 0.02, 0.04, 0.12, s.solid);
      // Rug, lamp, picture.
      g.save(); g.globalAlpha = 0.28;
      g.fillStyle = s.accent;
      g.beginPath(); g.ellipse(px(0.44), py(0.88), px(0.22), py(0.05), 0, 0, Math.PI * 2); g.fill();
      g.restore();
      poster(g, s, 0.20, 0.16, 0.16, 0.14, s.soft);
      window_(g, s, 0.02, 0.14, 0.14, 0.22);
    },

    car(g, s) {
      // Interior: dashboard low, windscreen high, road beyond.
      rect(g, s, 0, 0, 1, 0.52, s.wall, false);
      g.save(); g.globalAlpha = 0.5;
      rect(g, s, 0.10, 0.06, 0.80, 0.40, s.accent, false);
      g.restore();
      rect(g, s, 0, 0.52, 1, 0.48, s.solid, false);
      solid(g, s, 0, 0.50, 1, 0.10, 0.018, s.soft);
      // Wheel.
      g.strokeStyle = s.line || s.ink; g.lineWidth = 6;
      g.beginPath(); g.arc(px(0.30), py(0.72), px(0.075), 0, Math.PI * 2); g.stroke();
      rect(g, s, 0.68, 0.56, 0.16, 0.06, s.soft);
    }
  };

  /**
   * Light and shadow thrown across a finished room.
   *
   * Everything above draws the same geometry every time. This is where the
   * room stops being a backdrop and starts reporting the story: light falls
   * from wherever the window is and reaches further on a good day, and
   * darkness pools out of the corners and up off the floor on a bad one.
   */
  function atmosphere(g, s, mood) {
    const light = s.light == null ? 0.6 : s.light;
    const well = mood.wellbeing == null ? 0.55 : mood.wellbeing;
    const win = s._window;

    // The shaft. Reaches most of the way across a bright room and barely
    // clears the sill in a dark one.
    if (win && light > 0.2) {
      const reach = 0.10 + light * 0.52;
      const spread = win.w * (1.4 + light * 2.2);
      const grad = g.createLinearGradient(0, py(win.y), 0, py(win.y + reach));
      grad.addColorStop(0, s.accent);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.save();
      g.globalAlpha = 0.06 + light * 0.20;
      g.globalCompositeOperation = 'lighter';
      g.fillStyle = grad;
      g.beginPath();
      g.moveTo(px(win.x - win.w / 2), py(win.y));
      g.lineTo(px(win.x + win.w / 2), py(win.y));
      g.lineTo(px(win.x + spread / 2), py(win.y + reach));
      g.lineTo(px(win.x - spread / 2), py(win.y + reach));
      g.closePath();
      g.fill();
      g.restore();
    }

    // The pooling. Below neutral, dark collects in the corners and creeps up
    // from the floor — the room closing in rather than merely being dimmer.
    const gloom = Math.max(0, 0.58 - well);
    if (gloom > 0.02) {
      g.save();
      const rise = g.createLinearGradient(0, H, 0, py(HORIZON - 0.05));
      rise.addColorStop(0, 'rgba(0,0,0,' + Math.min(0.72, gloom * 1.5).toFixed(3) + ')');
      rise.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = rise;
      g.fillRect(0, py(HORIZON - 0.05), W, H - py(HORIZON - 0.05));

      const corner = g.createRadialGradient(W / 2, H * 0.52, H * 0.26, W / 2, H * 0.52, H * 0.95);
      corner.addColorStop(0, 'rgba(0,0,0,0)');
      corner.addColorStop(1, 'rgba(0,0,0,' + Math.min(0.78, gloom * 1.7).toFixed(3) + ')');
      g.fillStyle = corner;
      g.fillRect(0, 0, W, H);
      g.restore();
    }
  }

  /**
   * Draw an environment in the project's visual style.
   *
   * `mood` is optional — without it the room is drawn in its neutral palette,
   * which is what a scene with no story state behind it should look like.
   */
  function draw(ctx, name, theme, style, mood) {
    const fn = ENVIRONMENTS[name];
    if (!fn) return false;
    const s = skinFor(style || 'stickman', theme || {}, mood);
    ctx.save();
    fn(ctx, s);
    if (mood) atmosphere(ctx, s, mood);
    ctx.restore();
    return true;
  }

  window.BlvckEnv = {
    ENVIRONMENTS,
    draw,
    skinFor,
    HORIZON,
    GROUND,
    names: () => Object.keys(ENVIRONMENTS)
  };
})();
