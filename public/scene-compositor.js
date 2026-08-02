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

    const info = scene.information || null;
    const kind = (info && info.kind) || 'none';
    const staging = pick(scene.staging, scene.index || 0);
    const palette = window.BlvckGraphic
      ? window.BlvckGraphic.paletteFor(scene.subject || (info && info.title) || '')
      : null;

    // Ground.
    ctx.fillStyle = (palette && palette.bg) || '#0f1116';
    ctx.fillRect(0, 0, W, H);

    // 1. Information first — the actor is staged AGAINST it, so it has to
    //    exist before we know where the actor should look.
    let infoRect = null;
    if (staging.info && kind !== 'none') {
      infoRect = await drawInformation(ctx, info, staging.info, palette);
    }

    // 2. Actor. Always present — that is the entire point of the reframe.
    const actorSpec = scene.actor || {};
    const action = actorSpec.action || ACTION_FOR[kind] || 'explain';
    let hand = null;

    if (window.BlvckChar) {
      const a = new window.BlvckChar.Actor({
        state: window.BlvckChar.CLIPS[action] ? action : 'explain',
        emotion: actorSpec.emotion || 'confident'
      });
      // Hold the clip at its end so a still frame shows the completed gesture.
      a.time = (window.BlvckChar.CLIPS[a.state] || { dur: 1 }).dur;
      a.followTimeline = false;

      const unit = staging.actor.scale * H * 0.16;
      const bones = window.BlvckChar.drawActor(ctx, a, {
        x: staging.actor.x * W,
        y: staging.actor.y * H,
        scale: unit,
        skin: opts.skin || 'stickman',
        colour: (palette && palette.accent) || '#f5b301',
        // Face the information, whichever side it is on.
        flip: infoRect ? (staging.actor.x * W > infoRect.x + infoRect.w / 2) : false
      });
      if (bones && bones.forearmR) hand = { x: bones.forearmR.x1, y: bones.forearmR.y1 };
    }

    // 3. Annotation — connect the actor to what it is talking about.
    if (infoRect && hand && (action === 'point' || action === 'explain')) {
      drawPointer(ctx, hand, infoRect, (palette && palette.hot) || '#ffe066');
    }

    // 4. A role label, when the actor is playing someone specific.
    if (actorSpec.role) {
      ctx.fillStyle = (palette && palette.dim) || '#9aa4b2';
      ctx.font = '600 24px "Segoe UI", Arial, sans-serif';
      const t = String(actorSpec.role);
      const w = ctx.measureText(t).width;
      ctx.fillText(t, staging.actor.x * W - w / 2, staging.actor.y * H + 44);
    }

    return opts.canvas ? canvas : new Promise((res) => canvas.toBlob((b) => res(b), 'image/png'));
  }

  /**
   * Turn a planned scene into compositor input.
   *
   * The Director's visualType stops meaning "instead of an actor" and starts
   * meaning "the information the actor is presenting" — which is the whole
   * reframe expressed in one mapping.
   */
  function fromScene(scene, strategy) {
    const s = scene || {};
    const vt = String(s.visualType || '');
    const isInfo = ['chart', 'map', 'timeline', 'diagram', 'whiteboard'].indexOf(vt) > -1;

    // Role comes from the subject: a health video has a doctor, finance an
    // analyst. The actor is constant; who they are playing is not.
    const ROLE = {
      health: 'Doctor', finance: 'Analyst', history: 'Narrator',
      science: 'Researcher', howto: 'Instructor', story: 'Narrator'
    };
    const niche = (strategy && strategy.niche) || 'general';

    return {
      index: s.index || 0,
      subject: s.sceneSummary || s.subtitle || '',
      staging: isInfo ? (s.staging || null) : 'solo',
      information: isInfo
        ? { kind: vt, title: (s.graphic && s.graphic.title) || s.sceneSummary || '',
            items: (s.graphic && s.graphic.items) || [],
            subtitle: (s.graphic && s.graphic.subtitle) || '' }
        : null,
      actor: {
        role: ROLE[niche] || '',
        action: s.actorAction || ACTION_FOR[isInfo ? vt : 'none'],
        emotion: s.emotion && window.BlvckChar && window.BlvckChar.EMOTIONS[s.emotion]
          ? s.emotion
          : 'confident'
      }
    };
  }

  window.BlvckStage = {
    compose,
    fromScene,
    STAGINGS,
    ACTION_FOR,
    stagings: () => Object.keys(STAGINGS)
  };
})();
