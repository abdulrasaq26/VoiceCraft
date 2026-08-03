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
    const M = window.BlvckMetaphor;

    const palette = window.BlvckGraphic
      ? window.BlvckGraphic.paletteFor(scene.subject || '')
      : { bg: '#0f1116', ink: '#f5f7fa', dim: '#9aa4b2', accent: '#f5b301', hot: '#ffe066' };
    // COLOUR IS A PROPERTY OF THE SEQUENCE, NOT THE BEAT.
    //
    // paletteFor() keyed on each scene's own text, so a run of shots changed
    // colour every time the narration changed subject: one green frame and
    // three blue among ambers in the last battery. Nothing else in the frame
    // survives that — a viewer reads it as a broken video before they read
    // anything the staging is saying.
    //
    // A palette stamped by the producer wins, and opts.palette overrides both
    // so a caller can force one.
    const pal = opts.palette || scene.palette || palette;
    const t = { bg: pal.bg, ink: '#f5f7fa', dim: '#5b6472', accent: pal.accent, hot: pal.hot };

    // ONE state change, every layer responds. Framing, light and vignette come
    // from the same fact as the pose, so a worsening beat is a tighter, darker
    // frame AND a bent figure rather than only a different arm angle.
    //
    // Derived FIRST because the very next thing drawn depends on it.
    const stateEnt = scene.entity || (scene.entities && scene.entities[0]) || null;
    // opts.mood lets a caller drive the frame directly, without inventing an
    // entity to carry the state. That is the only way to exercise the stage at
    // a chosen point in an arc, and a stage you cannot put into a known state
    // is a stage you cannot check.
    const mood = opts.mood
      || ((stateEnt && window.BlvckStoryState)
        ? window.BlvckStoryState.moodFor(stateEnt, scene.time || 0)
        : { brightness: 1, framing: 1, vignette: 0, unsteady: 0, wellbeing: 0.6, intensity: 0 });

    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);
    if (mood.brightness < 0.99) {
      ctx.save();
      ctx.globalAlpha = 1 - mood.brightness;
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, W, H);
      ctx.restore();
    }

    const role = (scene.actors && scene.actors.role) || 'presenter';
    const roleDef = (L && L.ROLES[role]) || { infoWeight: 0.7 };

    const envName = scene.environment || 'none';

    // ---- 1b. Metaphor ---------------------------------------------------
    // The picture for a thing that has no picture. Scripts are mostly about
    // progress, setback, obstacles, choices and deadlines, none of which can
    // be photographed — so without this they arrive as words and leave as
    // words. Staged behind the actors, because the actor's position ON it is
    // what carries the meaning.
    let spots = L ? L.placeActors(role, (scene.actors && scene.actors.count) || null) : [{ x: 0.5, y: 0.84, scale: 0.42 }];

    // INTERACTION overrides symmetric placement.
    //
    // placeActors returns y = GROUND for every layout and pair positions
    // symmetric about centre, so it cannot produce an asymmetric two-shot.
    // Measured consequence: nine two-person situations in the 25-scene battery
    // rendered as the SAME image. A proposal and an argument differ by
    // relative height, distance and orientation — a pattern, not a number.
    const IX = window.BlvckInteract;
    const ixName = scene.interaction !== undefined
      ? scene.interaction
      : (IX ? IX.infer(scene.subject || '') : null);
    if (IX && ixName && spots.length >= 2) {
      const staged = IX.stage(ixName, spots[0] && spots[0].scale);
      if (staged) {
        spots = staged;
        if (opts.trace) opts.trace.interaction = { name: ixName, means: IX.means(ixName) };
      }
    }

    // Where an actor ends up, resolved ONCE.
    //
    // Position depends on mood, then on a metaphor anchor, then on a clamp
    // that keeps the body in frame. Anything that needs to know where the
    // figure is must ask after all three have been applied — a weight drawn
    // from the pre-clamp spot ended up framing his head like a sign instead of
    // pressing on his shoulders. Two bugs in this scene came from two
    // different places each computing their own answer.
    function placeFor(spot, isLead) {
      const advance = mood.advance == null ? 0.6 : mood.advance;
      let x = spot.x + (mood.drift || 0) * 0.06;
      let y = spot.y + (mood.sink || 0) * 0.10;
      let advScale = 0.82 + advance * 0.32;

      // A metaphor outranks mood drift for the lead actor: standing on the
      // fourth step of six is the whole statement, and a mood offset that slid
      // the figure off the staircase would destroy it.
      if (isLead && metaAnchor) {
        x = metaAnchor.x;
        y = metaAnchor.y;
        advScale *= metaAnchor.scale == null ? 1 : metaAnchor.scale;
      }

      // GROUND is where feet land on the floor PLANE, but an actor hangs below
      // its origin by about 3.4x the unit scale. Any beat placed at ground
      // level ran its legs off the bottom: measured botY 0.999 on two of five
      // beats, while beats a metaphor had lifted higher were fine.
      const unit = spot.scale * H * 0.16 * mood.framing * advScale;
      const maxY = 0.97 - (unit * 3.4) / H;
      if (y > maxY) y = maxY;
      return { x, y, unit };
    }

    const OBJ = window.BlvckObjects;
    const supportName = scene.support || 'ground';

    // SYMBOL ARBITRATION. A metaphor is a STATED abstraction; an object is a
    // thing PRESENT in the scene. When both express the same idea the frame
    // says it twice and means it less — a clock on the desk beside an
    // hourglass metaphor put two time symbols in one image. The present thing
    // wins, because it belongs to the world rather than commenting on it.
    const CLAIMS = { drain: ['clock'], weight: ['book'], barrier: [], fork: [] };
    let metaName = scene.metaphor
      || (scene.metaphor === null ? null : (M ? M.infer(scene.subject || '') : null));
    if (metaName && CLAIMS[metaName] && scene.objects) {
      const present = scene.objects.map((o) => o && o.kind);
      if (CLAIMS[metaName].some((k) => present.indexOf(k) > -1)) {
        if (opts.trace) opts.trace.metaphorSuppressed = metaName;
        metaName = null;
      }
    }

    // Resolved ONCE, before anything is drawn, so the seat and the figure
    // cannot disagree about where the figure is. Drawing the chair from a
    // placement computed before the metaphor anchor existed is why the chair
    // sat beside the body instead of under it.
    let metaAnchor = M && metaName ? M.anchorFor(metaName, mood.wellbeing) : null;
    const lead = placeFor(spots[0] || { x: 0.5, y: 0.84, scale: 0.42 }, true);

    // ---- 1d. Subject and camera -----------------------------------------
    //
    // A camera cannot frame until something says what the subject IS. Framing
    // the reference beat as a true medium shot transformed legibility and
    // still failed, because the crop centred on the ACTOR and the desk fell
    // outside it: "a stressed man on a chair" instead of "a student at a
    // desk". So the subject is named first, its bounds are computed
    // ANALYTICALLY, and the camera is set before a single thing is drawn.
    const SUBJ = window.BlvckSubject;
    // Objects are PLANNED here rather than drawn, because their positions are
    // part of the subject's bounds.
    const objPlan = (OBJ && scene.objects && scene.objects.length)
      ? OBJ.plan({ objects: scene.objects },
          { x: lead.x, y: lead.y, unit: lead.unit,
            surfaceY: (L ? L.GROUND : 0.84) - 0.10 })
      : [];

    let cam = null;
    if (SUBJ) {
      const kind = SUBJ.infer(scene);
      const bounds = SUBJ.boundsOf(kind, {
        actor: { x: lead.x, y: lead.y, unit: lead.unit },
        actors: spots.map((s, i) => {
          const pl = placeFor(s, i === 0);
          return { x: pl.x, y: pl.y, unit: pl.unit };
        }),
        objects: objPlan,
        metaphor: metaName || null,
        surface: envName === 'none' ? null : { x0: 0.50, x1: 0.94, y: 0.62 }
      });
      cam = SUBJ.cameraFor(bounds, scene.shot || (kind === 'place' ? 'wide' : 'medium'));
      if (opts.trace) opts.trace.subject = { kind, bounds, camera: cam };
    }

    // Everything from here to the matching restore is IN SHOT: room,
    // furniture, figure and litter scale and crop together.
    ctx.save();
    if (cam) SUBJ.apply(ctx, cam);

    // ---- 3. Environment -------------------------------------------------
    // A drawn PLACE, not a wireframe. The environment is part of the
    // storytelling language: it says where before a word is spoken, and a
    // figure standing in an empty box reads as unfinished.
    if (window.BlvckEnv && envName !== 'none') {
      // The room is handed the mood: the same kitchen is a different place
      // before and after the thing that happened in it.
      window.BlvckEnv.draw(ctx, envName, t, opts.skin || 'stickman', mood);
    }
    // Ground line only when there is no room to stand in.
    if (L && envName === 'none') {
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
      infoRect = await drawInformation(ctx, info, rect, pal);
    }

    // ---- 1c. Support ----------------------------------------------------
    // What the body rests on. Drawn before the actor so the seat is behind
    // them, and it MOVES the figure: sitting lowers the origin and folds the
    // legs, which is precisely what the pose space cannot express because
    // every axis there describes the body above its own feet.
    let support = null;
    if (OBJ && supportName !== 'ground') {
      support = OBJ.drawSupport(ctx, t, supportName, lead.x, lead.unit);
    }

    // ---- 1e. Arrangement anchors ----------------------------------------
    // Furniture placed FROM the actors, which is what separates arrangement
    // from scenery. The office already drew a desk and it never helped: fixed
    // in the room while the figures stood wherever staging put them, so the
    // two never formed a workstation. An interaction that declares it needs a
    // desk now gets one, between the people using it.
    const anchors = (scene.anchors
      || (ixName && IX && IX.INTERACTIONS[ixName] && IX.INTERACTIONS[ixName].requires)
      || []);
    if (OBJ && OBJ.drawAnchor && anchors.length) {
      const placed = spots.map((s, i) => placeFor(s, i === 0));
      anchors.forEach((a) => {
        const at = OBJ.drawAnchor(ctx, t, a, placed, lead.unit);
        if (opts.trace && at) (opts.trace.anchors = opts.trace.anchors || []).push({ name: a, at });
      });
    }

    if (M && metaName) {
      M.draw(ctx, metaName, t, mood.wellbeing, lead);
      if (opts.trace) opts.trace.metaphor = { name: metaName, means: M.means(metaName), anchor: metaAnchor };
    }

    // ---- 2. Actors ------------------------------------------------------
    const specs = (scene.actors && scene.actors.cast) || [];
    const hands = [];
    // Where the lead actually ended up, so objects attach to the figure
    // instead of to the stage's default spot.
    let leadFrame = null;
    // Why each actor is posed as it is, for tracing a wrong frame back to
    // the state that produced it.
    const stateReasons = [];

    // DEPTH ORDER. Who is drawn in front. It only matters once figures
    // overlap, which `embrace` is the first pattern to do — and when they do,
    // arbitrary draw order reads as a rendering accident rather than as one
    // person in front of another. Sorted low z first so high z lands on top,
    // while the ORIGINAL index is kept so lead-actor rules still apply to the
    // lead rather than to whoever happens to be drawn first.
    const drawOrder = spots.map((s, i) => ({ spot: s, i }))
      .sort((p, q) => (p.spot.z || 0) - (q.spot.z || 0));

    if (window.BlvckChar) {
      drawOrder.forEach(({ spot, i }) => {
        let cast = specs[i] || specs[0] || {};

        // STATE DRIVES THE VISUAL. When this scene carries an entity, ask the
        // Story State Engine what is true at this moment rather than using a
        // pose someone wrote down. This is the join that makes the pipeline
        // whole: narration → state timeline → compositor → what you see.
        const ent = (scene.entities && scene.entities[i]) || scene.entity || null;
        const CH_ = window.BlvckChar;
        let a = null;

        // CONTINUOUS POSTURE. Ask the pose space where this state stands,
        // rather than which of ten clips it classifies as. The room's
        // brightness and warmth have always responded to fractional changes;
        // the figure used to quantise them away at a threshold.
        const posture = ent && window.BlvckStoryState && window.BlvckStoryState.postureFor
          ? window.BlvckStoryState.postureFor(ent, scene.time || 0)
          : null;

        if (posture) {
          // The interaction nudges each body differently, so the two figures
          // are not the same person twice. Applied to the AXES rather than to
          // the drawn pose, so it stays inside the continuous space.
          let pose = spot.bias && window.BlvckPose
            ? window.BlvckPose.poseFrom(
                Object.keys(posture.axes).reduce((acc, k) => {
                  acc[k] = posture.axes[k] + (spot.bias[k] || 0);
                  return acc;
                }, {}))
            : posture.pose;
          // A gesture is something you DO at a moment, layered over how you
          // stand, at a weight set by how big the change is.
          // sample() takes a clip NAME, not a clip object — it does
          // `CLIPS[clipName] || CLIPS.idle`, so passing the object silently
          // resolved to idle and mixed in nothing. Both call sites below had
          // that bug: the seated figure never sat, and the gesture layer had
          // been a no-op since the pose space landed, with traces cheerfully
          // reporting `gesture: facepalm` while the renderer drew idle.
          if (posture.gesture && CH_.CLIPS[posture.gesture] && posture.gestureWeight > 0) {
            pose = CH_.mix(pose, CH_.sample(posture.gesture, 1), posture.gestureWeight);
          }
          // Sitting is a SUPPORT state, not a posture, so it is mixed in here
          // rather than expressed as axes. The authored `sit` clip is exactly
          // the shape the pose space provably could not reach.
          // Support is PER ACTOR. In a proposal one kneels and one does not,
          // and at a desk both sit — so an interaction's support declaration
          // has to reach the individual figure. Without this the kneel clip
          // existed and was unreachable: `propose` still rendered standing.
          const spotSupport = spot.support && OBJ && OBJ.SUPPORT[spot.support]
            ? OBJ.SUPPORT[spot.support] : null;
          const eff = spotSupport || support;
          if (eff && eff.sit && CH_.CLIPS[eff.clip || 'sit']) {
            pose = CH_.mix(pose, CH_.sample(eff.clip || 'sit', 1), 0.9);
          }
          // REACH — the near arm extends toward the other figure. An offered
          // hand is what separates kneeling from merely being lower down.
          // reachY decides WHERE the hand goes — level at the chest, or up and
          // around the shoulders. That is the channel separating an argument
          // from an embrace once both are leaning in at close range.
          if (spot.reach) {
            const up = spot.reachY || 0;
            pose.armR = -(30 + spot.reach * 55 + up * 72);
            pose.forearmR = -(spot.reach * 24 * (1 - Math.abs(up) * 0.6));
          }
          pose.emotion = posture.emotion;
          a = pose;
          stateReasons.push({ entity: ent.name, at: scene.time || 0, ...posture });
        } else {
          // No entity: fall back to the authored clip named by the scene.
          const action = cast.action || (infoRect && role === 'presenter' ? 'point' : 'explain');
          a = new CH_.Actor({
            state: CH_.CLIPS[action] ? action : 'explain',
            emotion: cast.emotion || 'confident'
          });
          a.time = (CH_.CLIPS[a.state] || { dur: 1 }).dur;
          a.followTimeline = false;
        }

        ctx.save();
        // Depth in a crowd: further rows recede rather than repeat.
        if (spot.depth) ctx.globalAlpha = 1 - spot.depth * 0.28;

        // Position carries state. A confident figure steps forward and toward
        // centre; a failing one drifts back, sideways and down. Standing in
        // the same spot every frame is what made the arc read as static.
        let { x: posX, y: posY, unit } = placeFor(spot, i === 0);
        // Sitting puts the body ON the seat — per actor, so one figure can
        // kneel while the other stands.
        const seat = spot.support && OBJ && OBJ.SUPPORT[spot.support]
          ? OBJ.SUPPORT[spot.support]
          : (i === 0 ? support : null);
        if (seat && seat.sit && seat.seatY != null) posY = seat.seatY;
        if (i === 0) leadFrame = { x: posX, y: posY, unit };

        // LEAN — the whole body rotates about its own feet, toward or away
        // from the other figure. Two upright figures at a distance read as a
        // conversation no matter what their faces do; commitment into the
        // space between them is what makes an argument an argument.
        if (spot.lean) {
          const dir = spot.flip ? -1 : 1;
          ctx.translate(posX * W, posY * H);
          ctx.rotate((spot.lean * dir * Math.PI) / 180);
          ctx.translate(-posX * W, -posY * H);
        }

        // GAZE. Resolved against where the OTHER figure actually ended up, so
        // "look at your partner" survives every offset that moved them. A
        // figure whose eyes ignore the person opposite reads as two separate
        // portraits sharing a frame.
        let look = null;
        if (spot.gaze) {
          const other = spots[i === 0 ? 1 : 0];
          if (spot.gaze === 'partner' && other) {
            const op = placeFor(other, i !== 0);
            const dx = Math.max(-1, Math.min(1, (op.x - posX) * 4));
            const dy = Math.max(-1, Math.min(1, (op.y - posY) * 4));
            look = [spot.flip ? -dx : dx, dy];
          } else if (spot.gaze === 'away') {
            look = [spot.flip ? 0.8 : -0.8, 0];
          } else if (spot.gaze === 'down') {
            look = [0, 0.85];
          } else if (spot.gaze === 'up') {
            look = [0.4, -0.8];
          }
        }

        // Matte only when this figure is actually in front of another AND
        // close enough to overlap it. A matte on a figure standing alone would
        // paint a background-coloured halo around it for no reason.
        let matte = null;
        if (spots.length > 1) {
          const other = spots[i === 0 ? 1 : 0];
          const inFront = (spot.z || 0) > (other.z || 0);
          if (inFront && Math.abs((other.x || 0.5) - (spot.x || 0.5)) < 0.20) matte = t.bg;
        }

        const bones = window.BlvckChar.drawActor(ctx, a, {
          x: posX * W,
          y: posY * H,
          scale: unit,
          look,
          matte,
          skin: opts.skin || 'stickman',
          colour: i === 0 ? t.accent : (i === 1 ? (t.hot || '#7ec8ff') : t.dim),
          flip: spot.flip
        });
        ctx.restore();
        if (bones && bones.forearmR) hands.push({ x: bones.forearmR.x1, y: bones.forearmR.y1, spot, cast });
      });
    }

    // ---- 4b. Objects, placed by RELATION ---------------------------------
    // Held, on a surface, on the floor, or in a thought. Drawn after the actor
    // so a held object reads as in front of the body, and after props so both
    // vocabularies can coexist while the old PROPS table is retired.
    if (OBJ && objPlan.length) {
      // Re-planned only when a solved hand is available, so a held object
      // touches it. Otherwise the plan the camera framed on is what gets
      // drawn — the bounds and the pixels must not disagree.
      const finalPlan = hands.length
        ? OBJ.plan({ objects: scene.objects },
            Object.assign({ surfaceY: (L ? L.GROUND : 0.84) - 0.10 },
              leadFrame || { x: lead.x, y: lead.y, unit: lead.unit },
              { hand: { x: hands[0].x, y: hands[0].y } }))
        : objPlan;
      OBJ.drawPlan(ctx, t, finalPlan, lead.unit);
      if (opts.trace) opts.trace.objects = finalPlan;
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

    // Out of shot. The vignette is a lens effect, not a thing in the room, so
    // it must not scale with the camera.
    ctx.restore();

    if (mood.vignette > 0.02) {
      const g2 = ctx.createRadialGradient(W/2, H*0.52, H*0.28, W/2, H*0.52, H*0.85);
      g2.addColorStop(0, 'rgba(0,0,0,0)');
      g2.addColorStop(1, 'rgba(0,0,0,' + Math.min(0.72, mood.vignette).toFixed(3) + ')');
      ctx.fillStyle = g2; ctx.fillRect(0, 0, W, H);
    }
    if (opts.trace) { opts.trace.stateReasons = stateReasons; opts.trace.mood = mood; }
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
    // Story Actions expands a beat into a whole scene — who, where, what
    // objects, what is happening — and treats information as an optional
    // prop rather than the scene type. Prefer it when present.
    if (window.BlvckStoryActions) {
      const st = window.BlvckStoryActions.expand(scene || {});
      const ROLE_NAME = { health:'Doctor', finance:'Analyst', history:'Narrator',
        science:'Researcher', howto:'Instructor', story:'Narrator' };
      const niche = (strategy && strategy.niche) || 'general';
      if (!st.actors.labels.length && st.actors.role === 'presenter' && ROLE_NAME[niche]) {
        st.actors.labels = [ROLE_NAME[niche]];
      }
      return st;
    }
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
      // 4b. And what it MEANS, when the line is about something abstract.
      metaphor: s.metaphor !== undefined
        ? s.metaphor
        : (window.BlvckMetaphor ? window.BlvckMetaphor.infer(text) : null),
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
