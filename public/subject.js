// Subject — what this beat is ABOUT, and therefore what the camera frames.
//
// This exists because of a measurement, not a theory. Rendering the reference
// beat at a real medium shot transformed legibility -- the face read, the
// chair read, the drafts became countable -- and still failed, because the
// crop was centred on the ACTOR and the desk fell outside it. The scene said
// "a stressed man on a chair" instead of "a student at a desk".
//
// That is the whole finding: a camera cannot frame until something says what
// the subject IS. Framing on the person gives the wrong crop whenever the
// person is not the point.
//
// The subject is a GROUP, not an object:
//
//   actor    one figure. A reaction shot.
//   context  figure + what they are with: a desk, a bed, a microphone, a roof.
//   pair     two figures and the space between them, which is the point.
//   group    three or more. A team, a family, a crowd.
//   object   a thing, with the figure incidental or absent.
//   place    the room. Establishing.
//
// THAT SET IS MEASURED, NOT INVENTED. 48 beats spanning eight genres were put
// to the Director with an open vocabulary -- name what the camera should
// frame, in your own words, not from a list. It returned 48 DISTINCT labels,
// no reuse at all: doctor_and_patient, phone_on_table, rising_floodwater,
// girl_at_microphone. Asked separately to cluster its own answers into the
// smallest set a camera would frame differently, it produced six:
//
//   single_person              12    actor
//   single_person_with_context 10    context
//   two_people                 10    pair
//   single_object               6    object
//   group_of_people             6    group
//   empty_scene                 4    place
//
// Two things follow. First, subject IDENTITY is open-ended (48/48 unique) but
// subject TYPE is closed and small — so framing rules key off the type while
// staging and object choice key off the identity. Second, `workstation` was
// the wrong name: it was one instance mistaken for the category. A patient on
// a bed, a girl at a microphone and a person on a roof are the same structure
// as a student at a desk. Renamed to `context`, and `group` was simply
// missing — 12.5% of beats, every one of them unrenderable today.
//
// Note what this is NOT. It does not describe furniture geometry or make a
// chair interlock with a desk -- a hand-authored workstation arrangement was
// tested and changed the read almost not at all. Its only job is to name a
// bounding group so the camera has something to compose on.
(() => {
  'use strict';

  const W = 1280;
  const H = 720;
  const GROUND = 0.84;

  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // How much of the frame the subject should occupy. Measured off the
  // reference images, where the character fills roughly two thirds.
  const SHOTS = {
    wide: 0.34,
    medium: 0.66,
    close: 0.88
  };

  /**
   * The bounding box of the subject, in frame units, computed ANALYTICALLY.
   *
   * Deliberately not measured off the rendered pixels. The first attempt did
   * that by detecting the subject's accent colour and silently included the
   * window, which is drawn in the same gold — an auto-framing system driven by
   * that would have mis-framed every shot and looked like it was working.
   */
  function boundsOf(kind, parts) {
    const p = parts || {};
    const a = p.actor;
    const boxes = [];

    const actorBox = a ? {
      x0: a.x - (a.unit * 2.2) / W,
      x1: a.x + (a.unit * 2.2) / W,
      // The figure hangs ~3.4 units below its origin and reaches ~3.6 above.
      y0: a.y - (a.unit * 3.6) / H,
      y1: a.y + (a.unit * 3.4) / H
    } : null;

    switch (kind) {
      case 'place':
        return { x0: 0, y0: 0, x1: 1, y1: 1 };

      case 'group':
        // Everyone, plus the gaps between them. A crowd framed on one member
        // is a portrait, not a group.
        (p.actors || []).forEach((act) => boxes.push({
          x0: act.x - (act.unit * 2.4) / W, x1: act.x + (act.unit * 2.4) / W,
          y0: act.y - (act.unit * 3.8) / H, y1: act.y + (act.unit * 3.4) / H
        }));
        if (!boxes.length && actorBox) boxes.push(actorBox);
        break;

      case 'context':
      case 'workstation':   // former name, kept so existing scenes keep working
        if (actorBox) boxes.push(actorBox);
        // The surface being worked at is half the subject. Without it the
        // crop says "a man on a chair".
        if (p.surface) {
          boxes.push({ x0: p.surface.x0, x1: p.surface.x1,
                       y0: p.surface.y - 0.03, y1: GROUND + 0.06 });
        }
        // Litter belongs to the workstation: it is the evidence of effort.
        (p.objects || []).forEach((o) => {
          if (o.rel === 'floor' || o.rel === 'surface' || o.rel === 'held') {
            const r = (o.size || 40) / W;
            boxes.push({ x0: o.x - r, x1: o.x + r,
                         y0: o.y - (o.size || 40) / H, y1: o.y + (o.size || 40) / H });
          }
        });
        break;

      case 'pair':
        (p.actors || []).forEach((act) => boxes.push({
          x0: act.x - (act.unit * 2.2) / W, x1: act.x + (act.unit * 2.2) / W,
          y0: act.y - (act.unit * 3.6) / H, y1: act.y + (act.unit * 3.4) / H
        }));
        break;

      case 'object':
        (p.objects || []).forEach((o) => {
          const r = (o.size || 40) / W;
          boxes.push({ x0: o.x - r, x1: o.x + r,
                       y0: o.y - (o.size || 40) / H, y1: o.y + (o.size || 40) / H });
        });
        break;

      case 'actor':
      default:
        if (actorBox) boxes.push(actorBox);
        // A thought belongs to the person thinking it.
        (p.objects || []).forEach((o) => {
          if (o.rel !== 'thought') return;
          const r = (o.size || 40) * 1.6 / W;
          boxes.push({ x0: o.x - r, x1: o.x + r,
                       y0: o.y - (o.size || 40) * 1.6 / H, y1: o.y + (o.size || 40) * 1.6 / H });
        });
        break;
    }

    // A metaphor is staged across the frame and IS the point of the beat, so
    // it belongs to the subject. Framing on the actor alone cropped the
    // descending staircase, the weight and the fork — the camera was cutting
    // away the thing the beat was about, which is a worse failure than a wide
    // shot. Measured on the five-beat arc before this was added.
    if (p.metaphor) {
      boxes.push({ x0: 0.08, x1: 0.94, y0: GROUND - 0.40, y1: GROUND + 0.13 });
    }

    if (!boxes.length) return { x0: 0, y0: 0, x1: 1, y1: 1 };
    return boxes.reduce((m, b) => ({
      x0: Math.min(m.x0, b.x0), y0: Math.min(m.y0, b.y0),
      x1: Math.max(m.x1, b.x1), y1: Math.max(m.y1, b.y1)
    }));
  }

  /**
   * A camera that fits the subject at the requested shot distance.
   *
   * Returns a zoom and a centre. The compositor applies it before drawing
   * anything, so the room, the furniture, the figure and the litter all scale
   * and crop together — a shot distance, not a bigger actor.
   */
  function cameraFor(bounds, shot, opts) {
    const o = opts || {};
    const target = SHOTS[shot] == null ? SHOTS.wide : SHOTS[shot];
    const bw = Math.max(0.02, bounds.x1 - bounds.x0);
    const bh = Math.max(0.02, bounds.y1 - bounds.y0);

    // Fit the LARGER dimension to the target fill, so nothing is cropped by
    // the zoom itself. Framing that cuts the subject in half is worse than a
    // wide shot, because the viewer cannot tell what they are looking at.
    const zoom = clamp(Math.min(target / bh, target / bw), 1, o.maxZoom || 2.6);

    let cx = (bounds.x0 + bounds.x1) / 2;
    let cy = (bounds.y0 + bounds.y1) / 2;

    // Keep the visible window inside the drawn world, or the crop reveals the
    // edge of the environment art.
    const halfW = 0.5 / zoom;
    const halfH = 0.5 / zoom;
    cx = clamp(cx, halfW, 1 - halfW);
    cy = clamp(cy, halfH, 1 - halfH);

    return { zoom: +zoom.toFixed(3), x: +cx.toFixed(4), y: +cy.toFixed(4),
             shot, fill: +Math.min(1, Math.max(bw, bh) * zoom).toFixed(2) };
  }

  /** Apply a camera to a context. Everything drawn after this is in shot. */
  function apply(ctx, cam) {
    if (!cam || cam.zoom === 1) return;
    ctx.translate(W / 2 - cam.x * W * cam.zoom, H / 2 - cam.y * H * cam.zoom);
    ctx.scale(cam.zoom, cam.zoom);
  }

  // Which subject a beat is about, when nobody has said. Conservative: a
  // wrongly-chosen close shot is far more damaging than a wide one, because
  // it crops away the thing that mattered.
  function infer(scene) {
    const s = scene || {};
    // The Director's structure, when it staged this beat. Validated at the
    // prompt boundary, so anything arriving here is one of the six.
    if (s.subjectKind && SHOTS_KINDS.indexOf(s.subjectKind) > -1) return s.subjectKind;
    if (s.subject && SHOTS_KINDS.indexOf(s.subject) > -1) return s.subject;
    const actors = (s.actors && s.actors.count) || 1;
    if (actors >= 3) return 'group';
    if (actors === 2) return 'pair';
    if (s.support && s.support !== 'ground') return 'context';
    if (s.objects && s.objects.some((o) => o.rel === 'held' || o.rel === 'surface')) {
      return 'context';
    }
    if (!s.entity && !s.entities) return 'place';
    return 'actor';
  }

  const SHOTS_KINDS = ['actor', 'context', 'pair', 'group', 'object', 'place', 'workstation'];

  window.BlvckSubject = {
    SHOTS, KINDS: SHOTS_KINDS, boundsOf, cameraFor, apply, infer
  };
})();
