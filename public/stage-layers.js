// Stage Layers — environments, props, and multi-actor staging.
//
// The correction this implements: the compositor was presenter-centric. It
// assumed one actor standing beside information, which is ONE storytelling
// mode out of several. A stickman should often BE the story, not narrate it.
//
// Composition priority is inverted from where it started:
//
//   1. What is happening?        the action
//   2. Who is involved?          actors and their roles
//   3. Where?                    environment
//   4. With what?                props
//   5. Does it need support?     information graphics — LAST, and optional
//
// So a beat about someone skipping breakfast is a tired figure leaving a
// kitchen, not a chart about meal frequency with a small figure beside it. The
// audience follows characters, actions and relationships; charts are context.
//
// Everything here is vector and procedural. No generation, no assets to ship.
(() => {
  'use strict';

  const W = 1280;
  const H = 720;

  // --- actor roles ---------------------------------------------------------
  //
  // Each decides how many actors appear and how they are arranged. This is the
  // difference between narrating a comparison and BEING one.
  const ROLES = {
    // Explains information. One actor, to the side. The old default, now one
    // mode among several.
    presenter: { count: 1, layout: 'aside', infoWeight: 0.7 },
    // The actor IS the explanation — "a man skips breakfast" is a figure
    // leaving a kitchen, not a chart about meal frequency.
    demonstrate: { count: 1, layout: 'centre', infoWeight: 0.28 },
    // A character in a narrative the viewer follows.
    story: { count: 1, layout: 'centre', infoWeight: 0 },
    // Two actors ARE the comparison — "one invested early, the other waited".
    compare: { count: 2, layout: 'pair', infoWeight: 0.3 },
    // Two actors in relationship: doctor/patient, buyer/seller.
    social: { count: 2, layout: 'facing', infoWeight: 0.22 },
    // Many figures for scale: population, demand, spread.
    crowd: { count: 9, layout: 'crowd', infoWeight: 0.25 }
  };

  // --- environments --------------------------------------------------------
  //
  // Deliberately crude: a few shapes that say "kitchen" or "office" without
  // competing with the actors. A detailed background would pull focus from the
  // figure, which is the thing carrying the story.
  const ENVIRONMENTS = {
    none: null,
    kitchen: (g, t) => { counter(g, t); shelf(g, t, 0.16, 0.30); box(g, t, 0.74, 0.42, 0.12, 0.22); },
    clinic: (g, t) => { bed(g, t); shelf(g, t, 0.72, 0.24); },
    gym: (g, t) => { treadmill(g, t); shelf(g, t, 0.10, 0.26); },
    office: (g, t) => { desk(g, t); window_(g, t, 0.68, 0.16); },
    meeting: (g, t) => { table(g, t); window_(g, t, 0.10, 0.16); },
    classroom: (g, t) => { board(g, t); desk(g, t, 0.62); },
    store: (g, t) => { counter(g, t); shelf(g, t, 0.12, 0.22); shelf(g, t, 0.12, 0.36); },
    street: (g, t) => { building(g, t, 0.06, 0.30); building(g, t, 0.78, 0.26); },
    field: (g, t) => { hills(g, t); },
    home: (g, t) => { sofa(g, t); window_(g, t, 0.70, 0.18); }
  };

  // Simple primitives, all relative so they scale with the frame.
  const px = (x) => x * W;
  const py = (y) => y * H;
  const GROUND = 0.84;

  function line(g, t, x1, y1, x2, y2, w) {
    g.strokeStyle = t.dim;
    g.lineWidth = w || 3;
    g.beginPath();
    g.moveTo(px(x1), py(y1));
    g.lineTo(px(x2), py(y2));
    g.stroke();
  }
  function box(g, t, x, y, w, h) {
    g.strokeStyle = t.dim;
    g.lineWidth = 3;
    g.strokeRect(px(x), py(y), px(w), py(h));
  }
  const counter = (g, t) => { box(g, t, 0.06, 0.62, 0.30, 0.22); line(g, t, 0.06, 0.62, 0.36, 0.62, 5); };
  const shelf = (g, t, x, y) => { line(g, t, x, y, x + 0.16, y, 4); line(g, t, x, y + 0.09, x + 0.16, y + 0.09, 4); };
  const bed = (g, t) => { box(g, t, 0.60, 0.60, 0.32, 0.14); line(g, t, 0.60, 0.60, 0.60, 0.52, 4); };
  const treadmill = (g, t) => { box(g, t, 0.58, 0.68, 0.30, 0.10); line(g, t, 0.86, 0.68, 0.90, 0.46, 4); };
  const desk = (g, t, x) => { const a = x == null ? 0.58 : x; box(g, t, a, 0.62, 0.32, 0.06); line(g, t, a + 0.02, 0.68, a + 0.02, 0.84, 4); line(g, t, a + 0.28, 0.68, a + 0.28, 0.84, 4); };
  const table = (g, t) => { box(g, t, 0.30, 0.64, 0.40, 0.05); line(g, t, 0.36, 0.69, 0.36, 0.84, 4); line(g, t, 0.64, 0.69, 0.64, 0.84, 4); };
  const board = (g, t) => { box(g, t, 0.08, 0.16, 0.38, 0.30); };
  const window_ = (g, t, x, y) => { box(g, t, x, y, 0.20, 0.22); line(g, t, x + 0.10, y, x + 0.10, y + 0.22, 2); };
  const building = (g, t, x, y) => { box(g, t, x, y, 0.16, GROUND - y); for (let i = 0; i < 3; i++) box(g, t, x + 0.03, y + 0.06 + i * 0.12, 0.04, 0.06); };
  const sofa = (g, t) => { box(g, t, 0.58, 0.62, 0.30, 0.14); line(g, t, 0.58, 0.62, 0.58, 0.54, 4); };
  const hills = (g, t) => {
    g.strokeStyle = t.dim; g.lineWidth = 3; g.beginPath();
    g.moveTo(0, py(GROUND));
    for (let x = 0; x <= 1.001; x += 0.05) g.lineTo(px(x), py(GROUND - 0.05 - Math.sin(x * 6) * 0.03));
    g.stroke();
  };

  // Environment inferred from what the beat says, so nobody has to author it.
  const ENV_HINTS = [
    [/\b(kitchen|breakfast|meal|cook|eat|food|dinner)\b/i, 'kitchen'],
    [/\b(clinic|hospital|patient|doctor|nurse|ward|surgery)\b/i, 'clinic'],
    [/\b(gym|exercise|workout|training|jog|run|fitness)\b/i, 'gym'],
    [/\b(office|work|job|desk|employee|boss|colleague)\b/i, 'office'],
    [/\b(meeting|boardroom|negotiat|presentation|pitch)\b/i, 'meeting'],
    [/\b(class|school|student|teacher|lesson|lecture)\b/i, 'classroom'],
    [/\b(shop|store|buy|sell|customer|market stall|retail)\b/i, 'store'],
    [/\b(street|city|town|traffic|road|commut)\b/i, 'street'],
    [/\b(farm|field|crop|harvest|soil|rural|village)\b/i, 'field'],
    [/\b(home|house|living room|family|sofa|bedroom)\b/i, 'home']
  ];

  function inferEnvironment(text) {
    const hay = String(text || '');
    for (const [re, env] of ENV_HINTS) if (re.test(hay)) return env;
    return 'none';
  }

  // --- props ---------------------------------------------------------------
  //
  // Drawn at a hand position, so they belong to the actor rather than floating.
  const PROPS = {
    laptop: (g, t, x, y, s) => { g.strokeStyle = t.ink; g.lineWidth = 3; g.strokeRect(x - s * .5, y - s * .35, s, s * .7); g.beginPath(); g.moveTo(x - s * .6, y + s * .35); g.lineTo(x + s * .6, y + s * .35); g.stroke(); },
    phone: (g, t, x, y, s) => { g.strokeStyle = t.ink; g.lineWidth = 3; g.strokeRect(x - s * .18, y - s * .3, s * .36, s * .6); },
    document: (g, t, x, y, s) => { g.strokeStyle = t.ink; g.lineWidth = 3; g.strokeRect(x - s * .25, y - s * .32, s * .5, s * .64); for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(x - s * .16, y - s * .16 + i * s * .16); g.lineTo(x + s * .16, y - s * .16 + i * s * .16); g.stroke(); } },
    money: (g, t, x, y, s) => { g.strokeStyle = t.ink; g.lineWidth = 3; g.strokeRect(x - s * .32, y - s * .2, s * .64, s * .4); g.beginPath(); g.arc(x, y, s * .1, 0, Math.PI * 2); g.stroke(); },
    cup: (g, t, x, y, s) => { g.strokeStyle = t.ink; g.lineWidth = 3; g.beginPath(); g.moveTo(x - s * .2, y - s * .22); g.lineTo(x - s * .14, y + s * .24); g.lineTo(x + s * .14, y + s * .24); g.lineTo(x + s * .2, y - s * .22); g.closePath(); g.stroke(); },
    bottle: (g, t, x, y, s) => { g.strokeStyle = t.ink; g.lineWidth = 3; g.strokeRect(x - s * .14, y - s * .1, s * .28, s * .5); g.strokeRect(x - s * .07, y - s * .3, s * .14, s * .2); },
    briefcase: (g, t, x, y, s) => { g.strokeStyle = t.ink; g.lineWidth = 3; g.strokeRect(x - s * .3, y - s * .18, s * .6, s * .4); g.beginPath(); g.arc(x, y - s * .18, s * .12, Math.PI, 0); g.stroke(); },
    book: (g, t, x, y, s) => { g.strokeStyle = t.ink; g.lineWidth = 3; g.strokeRect(x - s * .3, y - s * .22, s * .6, s * .44); g.beginPath(); g.moveTo(x, y - s * .22); g.lineTo(x, y + s * .22); g.stroke(); }
  };

  const PROP_HINTS = [
    [/\blaptop|computer|coding|software\b/i, 'laptop'],
    [/\bphone|call|text|mobile\b/i, 'phone'],
    [/\bdocument|report|paper|contract|form\b/i, 'document'],
    [/\bmoney|cash|salary|pay|price|cost|invest\b/i, 'money'],
    [/\bcoffee|drink|tea|cup\b/i, 'cup'],
    [/\bmedicine|pill|drug|dose|bottle\b/i, 'bottle'],
    [/\bbriefcase|business trip|commut\b/i, 'briefcase'],
    [/\bbook|read|study|textbook\b/i, 'book']
  ];

  function inferProp(text) {
    const hay = String(text || '');
    for (const [re, prop] of PROP_HINTS) if (re.test(hay)) return prop;
    return null;
  }

  // --- actor placement -----------------------------------------------------

  /** Where each actor stands, given the role's layout. */
  function placeActors(role, count) {
    const n = Math.max(1, count || ROLES[role]?.count || 1);
    const y = GROUND;
    switch (ROLES[role]?.layout) {
      case 'aside':
        return [{ x: 0.13, y, scale: 0.30, flip: false }];
      case 'centre':
        return [{ x: 0.5, y, scale: 0.46, flip: false }];
      case 'pair':
        return [{ x: 0.30, y, scale: 0.40, flip: false }, { x: 0.70, y, scale: 0.40, flip: true }];
      case 'facing':
        // Turned toward each other — the arrangement IS the relationship.
        return [{ x: 0.36, y, scale: 0.42, flip: false }, { x: 0.64, y, scale: 0.42, flip: true }];
      case 'crowd': {
        // Rows, smaller and paler toward the back, so a group reads as depth
        // rather than as a line of clones.
        const out = [];
        const rows = 3;
        for (let r = 0; r < rows; r++) {
          const per = Math.ceil(n / rows);
          for (let i = 0; i < per && out.length < n; i++) {
            out.push({
              x: 0.18 + (i + (r % 2) * 0.5) * (0.64 / per),
              y: y - r * 0.055,
              scale: 0.30 - r * 0.045,
              flip: false,
              depth: r
            });
          }
        }
        return out;
      }
      default:
        return [{ x: 0.5, y, scale: 0.42, flip: false }];
    }
  }

  window.BlvckStageLayers = {
    ROLES,
    ENVIRONMENTS,
    PROPS,
    GROUND,
    inferEnvironment,
    inferProp,
    placeActors,
    roles: () => Object.keys(ROLES),
    environments: () => Object.keys(ENVIRONMENTS),
    props: () => Object.keys(PROPS)
  };
})();
