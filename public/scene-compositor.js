// Scene Compositor — every scene is layers, not a single visual type.
//
// The reframe this implements: a stickman is not a kind of visual competing
// with charts and maps. It is the ACTOR. The chart is what the actor is
// explaining.
//
// The wrong question was "should this beat be a stickman or a chart?" The right
// one is "what is the actor doing in relation to the chart?" — which is how
// educational YouTube actually works. Viewers follow a character; the diagram
// is support. A channel is remembered for its presenter and presentation style,
// not for its diagrams.
//
//   Scene
//     ├── Information layer   chart · map · diagram · timeline · whiteboard
//     ├── Actor layer         the persistent stickman, staged against it
//     ├── Annotation layer    pointer line from actor to what matters
//     └── Caption layer       handled by the editor, on top
//
// Consequence: the actor is CONSTANT across a whole video while the information
// changes per beat. That constancy is the channel's identity.
(() => {
  'use strict';

  const W = 1280;
  const H = 720;

  // How the two layers share the frame. The actor is never larger than the
  // information it is explaining — it is the guide, not the subject.
  const STAGINGS = {
    // Actor at the left edge, information filling the rest. The default: we
    // read left-to-right, so the guide comes first and the content follows.
    beside: {
      info: { x: 0.26, y: 0.10, w: 0.70, h: 0.74 },
      actor: { x: 0.13, y: 0.86, scale: 0.30 },
      facing: 1
    },
    // Mirrored, for variety across consecutive beats.
    besideRight: {
      info: { x: 0.04, y: 0.10, w: 0.70, h: 0.74 },
      actor: { x: 0.87, y: 0.86, scale: 0.30 },
      facing: -1
    },
    // Information dominant, actor small in the corner — for dense data the
    // viewer needs to read rather than be talked through.
    corner: {
      info: { x: 0.04, y: 0.06, w: 0.92, h: 0.80 },
      actor: { x: 0.90, y: 0.94, scale: 0.19 },
      facing: -1
    },
    // No information at all: the actor carries the beat alone.
    solo: {
      info: null,
      actor: { x: 0.5, y: 0.86, scale: 0.42 },
      facing: 1
    }
  };

  // Which action suits the actor's relationship to the information. The
  // Director may override; this is the sensible default per information type.
  const ACTION_FOR = {
    chart: 'point',
    map: 'point',
    timeline: 'point',
    diagram: 'explain',
    whiteboard: 'write',
    title: 'explain',
    stat: 'point',
    checklist: 'explain',
    none: 'explain'
  };

  function pick(staging, index) {
    if (STAGINGS[staging]) return STAGINGS[staging];
    // Alternate sides across beats so a long video does not sit static.
    return index % 2 ? STAGINGS.besideRight : STAGINGS.beside;
  }

  /**
   * Draw the information layer into a sub-rectangle of the frame.
   *
   * Renders the card at full size then scales it down, rather than asking the
   * renderer to lay out at an odd size — the card designs assume 1280x720 and
   * their type sizes are tuned for it.
   */
  async function drawInformation(ctx, spec, rect, palette) {
    if (!window.BlvckGraphic || !spec || !spec.kind || spec.kind === 'none') return false;
    let blob;
    try {
      blob = await window.BlvckGraphic.render({ ...spec, palette });
    } catch (err) {
      console.warn('[Compositor] information layer failed:', err.message);
      return false;
    }
    if (!blob) return false;
    const bmp = await createImageBitmap(blob);

    const x = rect.x * W;
    const y = rect.y * H;
    const w = rect.w * W;
    const h = rect.h * H;

    // Contain, so a card is never distorted to fit its slot.
    const r = Math.min(w / bmp.width, h / bmp.height);
    const dw = bmp.width * r;
    const dh = bmp.height * r;
    const dx = x + (w - dw) / 2;
    const dy = y + (h - dh) / 2;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,.35)';
    ctx.shadowBlur = 26;
    ctx.shadowOffsetY = 8;
    ctx.drawImage(bmp, dx, dy, dw, dh);
    ctx.restore();
    return { x: dx, y: dy, w: dw, h: dh };
  }

  /** A light line from the actor's hand toward the information it references. */
  function drawPointer(ctx, from, toRect, colour) {
    if (!from || !toRect) return;
    const tx = toRect.x + (from.x < toRect.x ? 0 : toRect.w);
    const ty = toRect.y + toRect.h * 0.42;
    ctx.save();
    ctx.strokeStyle = colour;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 3;
    ctx.setLineDash([9, 8]);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.quadraticCurveTo((from.x + tx) / 2, from.y - 60, tx, ty);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * Compose one scene.
   *
   * scene: { information:{kind,title,items,…}, actor:{role,action,emotion},
   *          staging, index }
   */
  async function compose(scene = {}, opts = {}) {
    const canvas = opts.canvas || document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const L = window.BlvckStageLayers;

    const palette = window.BlvckGraphic
      ? window.BlvckGraphic.paletteFor(scene.subject || '')
      : { bg: '#0f1116', ink: '#f5f7fa', dim: '#9aa4b2', accent: '#f5b301', hot: '#ffe066' };
    const t = { bg: palette.bg, ink: '#f5f7fa', dim: '#5b6472', accent: palette.accent, hot: palette.hot };

    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);

    const role = (scene.actors && scene.actors.role) || 'presenter';
    const roleDef = (L && L.ROLES[role]) || { infoWeight: 0.7 };

    // ---- 3. Environment -------------------------------------------------
    // Drawn first and faintly. It says WHERE without competing with the
    // figures, which are the thing carrying the story.
    const envName = scene.environment || 'none';
    if (L && L.ENVIRONMENTS[envName]) {
      ctx.save();
      ctx.globalAlpha = 0.5;
      L.ENVIRONMENTS[envName](ctx, t);
      ctx.restore();
    }
    // Ground line, so figures stand on something.
    if (L) {
      ctx.strokeStyle = t.dim;
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(40, L.GROUND * H + 2);
      ctx.lineTo(W - 40, L.GROUND * H + 2);
      ctx.stroke();
    }

    // ---- 5. Information (only when the beat needs it) -------------------
    // Last in priority, and sized by the ROLE: a presenter beat gives it most
    // of the frame, a story beat gives it none at all.
    let infoRect = null;
    const info = scene.information;
    if (info && info.kind && info.kind !== 'none' && roleDef.infoWeight > 0.15) {
      const wide = roleDef.infoWeight > 0.5;
      const rect = wide
        ? { x: 0.28, y: 0.09, w: 0.68, h: 0.66 }
        : { x: 0.60, y: 0.08, w: 0.36, h: 0.34 };   // a reference, not the subject
      infoRect = await drawInformation(ctx, info, rect, palette);
    }

    // ---- 2. Actors ------------------------------------------------------
    const spots = L ? L.placeActors(role, (scene.actors && scene.actors.count) || null) : [{ x: 0.5, y: 0.84, scale: 0.42 }];
    const specs = (scene.actors && scene.actors.cast) || [];
    const hands = [];

    if (window.BlvckChar) {
      spots.forEach((spot, i) => {
        const cast = specs[i] || specs[0] || {};
        const action = cast.action || (infoRect && role === 'presenter' ? 'point' : 'explain');
        const a = new window.BlvckChar.Actor({
          state: window.BlvckChar.CLIPS[action] ? action : 'explain',
          emotion: cast.emotion || 'confident'
        });
        a.time = (window.BlvckChar.CLIPS[a.state] || { dur: 1 }).dur;
        a.followTimeline = false;

        ctx.save();
        // Depth in a crowd: further rows recede rather than repeat.
        if (spot.depth) ctx.globalAlpha = 1 - spot.depth * 0.28;
        const bones = window.BlvckChar.drawActor(ctx, a, {
          x: spot.x * W,
          y: spot.y * H,
          scale: spot.scale * H * 0.16,
          skin: opts.skin || 'stickman',
          colour: i === 0 ? t.accent : (i === 1 ? (t.hot || '#7ec8ff') : t.dim),
          flip: spot.flip
        });
        ctx.restore();
        if (bones && bones.forearmR) hands.push({ x: bones.forearmR.x1, y: bones.forearmR.y1, spot, cast });
      });
    }

    // ---- 4. Props, in the actors' hands ---------------------------------
    const propName = scene.prop || null;
    if (L && propName && L.PROPS[propName] && hands.length) {
      const h = hands[0];
      L.PROPS[propName](ctx, t, h.x, h.y, h.spot.scale * H * 0.14);
    }

    // ---- Annotation: connect a presenter to what it references ----------
    if (infoRect && hands.length && role === 'presenter') {
      drawPointer(ctx, hands[0], infoRect, t.hot || t.accent);
    }

    // ---- Labels: who is who, when it matters ----------------------------
    const labels = (scene.actors && scene.actors.labels) || [];
    if (labels.length) {
      ctx.fillStyle = t.dim;
      ctx.font = '600 26px "Segoe UI", Arial, sans-serif';
      spots.slice(0, labels.length).forEach((spot, i) => {
        const txt = String(labels[i] || '');
        if (!txt) return;
        const w = ctx.measureText(txt).width;
        ctx.fillText(txt, spot.x * W - w / 2, spot.y * H + 46);
      });
    }

    return opts.canvas ? canvas : new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));
  }

  /**
   * Decide the whole scene from the beat, in composition-priority order.
   *
   * 1 what is happening · 2 who · 3 where · 4 with what · 5 does it need support
   *
   * The old version asked "what card is this?" first and bolted a figure on.
   * That produced a chart with a small person beside it when the beat was
   * actually about a person.
   */
  function fromScene(scene, strategy) {
    const s = scene || {};
    const text = [s.sceneSummary, s.subtitle, s.detectedAction].filter(Boolean).join(' ');
    const L = window.BlvckStageLayers;
    const vt = String(s.visualType || '');
    const isInfo = ['chart', 'map', 'timeline', 'diagram', 'whiteboard'].indexOf(vt) > -1;

    // 1 + 2. What is happening, and who is in it.
    const role = s.actorRole || inferRole(text, isInfo);
    const niche = (strategy && strategy.niche) || 'general';
    const ROLE_NAME = {
      health: 'Doctor', finance: 'Analyst', history: 'Narrator',
      science: 'Researcher', howto: 'Instructor', story: 'Narrator'
    };

    return {
      index: s.index || 0,
      subject: text,
      // 3. Where.
      environment: s.environment || (L ? L.inferEnvironment(text) : 'none'),
      // 4. With what.
      prop: s.prop || (L ? L.inferProp(text) : null),
      actors: {
        role,
        count: s.actorCount || null,
        cast: s.cast || [{ emotion: s.emotion || 'confident', action: s.actorAction || null }],
        labels: s.actorLabels || (role === 'presenter' && ROLE_NAME[niche] ? [ROLE_NAME[niche]] : [])
      },
      // 5. Support, only if the beat has any.
      information: isInfo
        ? { kind: vt,
            title: (s.graphic && s.graphic.title) || s.sceneSummary || '',
            items: (s.graphic && s.graphic.items) || [],
            subtitle: (s.graphic && s.graphic.subtitle) || '' }
        : null
    };
  }

  /**
   * Which storytelling mode does this beat want?
   *
   * Read from the language of the beat itself. "One did X, another did Y" is a
   * comparison; "the doctor told the patient" is social; a population figure is
   * a crowd. Presenter is the fallback, not the default.
   */
  function inferRole(text, hasInfo) {
    const t = String(text || '');
    if (/\b(millions?|thousands?|population|everyone|people|crowd|society|spread|demand)\b/i.test(t)) return 'crowd';
    if (/\b(told|asked|sold|gave|met|argued|negotiat|interview|between them|each other)\b/i.test(t)) return 'social';
    if (/\b(one .*(another|other)|versus|compared|whereas|while .* others?|two (people|investors|patients|groups))\b/i.test(t)) return 'compare';
    if (/\b(walks?|runs?|eats?|sleeps?|works?|wakes?|begins?|struggl|tries|decides?|loses?|starts?)\b/i.test(t)) return 'demonstrate';
    if (/\b(he |she |they |his |her |john|maria|the man|the woman|the farmer|the patient)\b/i.test(t)) return 'story';
    return hasInfo ? 'presenter' : 'demonstrate';
  }

  window.BlvckStage = {
    compose,
    fromScene,
    inferRole,
    STAGINGS,
    ACTION_FOR,
    stagings: () => Object.keys(STAGINGS)
  };
})();
