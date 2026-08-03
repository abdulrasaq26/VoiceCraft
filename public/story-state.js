// Story State Engine v1 — entities that change over time.
//
// The minimum thing that proves the architecture: can a state change DRIVE a
// visual change, without anyone describing the visual?
//
// If yes, the renderer stops being told "draw a slouching figure" and starts
// being told "health went from 0.9 to 0.3" — and works the rest out. That is
// the difference between a scene list and a story.
//
//   StoryEntity   who or what is changing (a person, a company, an empire)
//   StateChange   an attribute moving from one value to another, over a span
//   sample()      what was true at time t
//   actorFor()    the derivation — state in, pose and expression out
//
// Deliberately small. No relationships, no camera, no attention: all three
// depend on this, and building them first would make them guesses instead of
// derivations.
(() => {
  'use strict';

  // Attributes the renderer knows how to express. Numeric ones interpolate;
  // categorical ones step at the change.
  const NUMERIC = ['health', 'energy', 'wealth', 'confidence', 'stress', 'size'];

  // Attributes where MORE is worse. Without this, "stress rose sharply" was
  // rendered as a celebration — the delta was large and positive, and nothing
  // told the engine that rising stress is bad news. Polarity is a property of
  // the attribute, not of the change.
  const INVERTED = ['stress'];
  const polarity = (attribute) => (INVERTED.indexOf(attribute) > -1 ? -1 : 1);
  const CATEGORICAL = ['emotion', 'status', 'location'];

  const clamp01 = (n) => Math.max(0, Math.min(1, Number(n) || 0));

  /** An entity is anything that changes. Not necessarily a person. */
  function entity(spec) {
    const s = spec || {};
    return {
      id: String(s.id || s.name || 'entity').toLowerCase().replace(/\s+/g, '-'),
      name: String(s.name || s.id || 'Entity'),
      // 'person' renders as an actor; anything else renders through its
      // information card. The state model is identical either way.
      type: String(s.type || 'person'),
      baseline: Object.assign({ health: 0.8, energy: 0.7, wealth: 0.5, confidence: 0.6, stress: 0.2 }, s.baseline || {}),
      changes: []   // StateChange[]
    };
  }

  /** One attribute moving, over a span of the narration. */
  function change(spec) {
    const s = spec || {};
    return {
      attribute: String(s.attribute || 'health'),
      from: s.from,
      to: s.to,
      startTime: Number(s.startTime) || 0,
      // A change with no end is instantaneous; most are, since narration says
      // "he lost his job" at a moment rather than across a span.
      endTime: Number(s.endTime != null ? s.endTime : s.startTime) || 0,
      cause: String(s.cause || ''),
      // What happened and how big it was, kept on the change so a frame can be
      // traced back to the event that caused it.
      event: s.event || null,
      magnitude: s.magnitude || null
    };
  }

  function addChange(ent, spec) {
    ent.changes.push(change(spec));
    ent.changes.sort((a, b) => a.startTime - b.startTime);
    return ent;
  }

  /**
   * What was true at time t.
   *
   * Numeric attributes ease across the change so a decline reads as a decline
   * rather than a jump; categorical ones switch at the midpoint, because there
   * is no meaningful halfway between "worried" and "relieved".
   */
  function sample(ent, attribute, t) {
    if (!ent) return null;
    const isNum = NUMERIC.indexOf(attribute) > -1;
    let value = ent.baseline[attribute];
    if (value == null) value = isNum ? 0.5 : 'neutral';

    for (const c of ent.changes) {
      if (c.attribute !== attribute) continue;
      if (t < c.startTime) break;                    // sorted, so nothing later applies
      const from = c.from == null ? value : c.from;

      if (t >= c.endTime || c.endTime <= c.startTime) {
        value = c.to;
        continue;
      }
      // Mid-change.
      const k = (t - c.startTime) / (c.endTime - c.startTime);
      if (isNum) {
        const e = k * k * (3 - 2 * k);                // smoothstep, as elsewhere
        value = Number(from) + (Number(c.to) - Number(from)) * e;
      } else {
        value = k < 0.5 ? from : c.to;
      }
      break;
    }
    return isNum ? clamp01(value) : value;
  }

  /** Every attribute at time t. */
  function stateAt(ent, t) {
    const out = {};
    const attrs = new Set([...Object.keys(ent.baseline), ...ent.changes.map((c) => c.attribute)]);
    attrs.forEach((a) => { out[a] = sample(ent, a, t); });
    return out;
  }

  /** The change happening at t, if any — what the beat is ABOUT. */
  function changeAt(ent, t, window) {
    const w = window == null ? 0.4 : window;
    return ent.changes.find((c) => t >= c.startTime - w && t <= Math.max(c.endTime, c.startTime) + w) || null;
  }

  // --- the derivation ------------------------------------------------------
  //
  // This is the whole point: state in, visual out. Nobody writes "slouch".

  /**
   * Turn an entity's state into what the character engine needs.
   *
   * Reads as a set of rules a director would recognise: low energy slouches,
   * high stress fidgets, a big loss makes someone hold their head. The renderer
   * never learns WHY — it just draws what the state implies.
   */
  function actorFor(ent, t) {
    const s = stateAt(ent, t);
    const c = changeAt(ent, t);

    // A change in progress dominates: the reaction IS the beat.
    if (c && NUMERIC.indexOf(c.attribute) > -1) {
      const raw = Number(c.to) - Number(c.from == null ? s[c.attribute] : c.from);
      // Signed by polarity, so the engine reasons about BETTER and WORSE
      // rather than up and down. Rising stress is a worsening.
      const delta = raw * polarity(c.attribute);
      const word = raw < 0 ? 'fell' : 'rose';
      if (delta <= -0.35) {
        return { clip: 'facepalm', emotion: c.attribute === 'health' ? 'sad' : 'crying',
                 reason: `${c.attribute} ${word} sharply — worse` };
      }
      if (delta >= 0.35) {
        return { clip: 'celebrate', emotion: 'excited', reason: `${c.attribute} ${word} sharply — better` };
      }
      if (delta <= -0.12) {
        return { clip: 'think', emotion: 'nervous', reason: `${c.attribute} worsening` };
      }
      if (delta >= 0.12) {
        return { clip: 'explain', emotion: 'happy', reason: `${c.attribute} improving` };
      }
    }

    // Otherwise the standing condition.
    const health = s.health == null ? 0.8 : s.health;
    const energy = s.energy == null ? 0.7 : s.energy;
    const stress = s.stress == null ? 0.2 : s.stress;
    const confidence = s.confidence == null ? 0.6 : s.confidence;

    if (health < 0.35) return { clip: 'sit', emotion: 'sad', reason: 'poor health' };
    if (energy < 0.3) return { clip: 'defeated', emotion: 'bored', reason: 'low energy' };
    if (stress > 0.65) return { clip: 'defeated', emotion: 'nervous', reason: 'high stress' };
    if (confidence > 0.75) return { clip: 'open', emotion: 'confident', reason: 'high confidence' };
    if (health > 0.8 && energy > 0.7) return { clip: 'open', emotion: 'happy', reason: 'healthy and rested' };
    return { clip: 'idle', emotion: 'neutral', reason: 'baseline' };
  }

  // --- reading state out of narration -------------------------------------
  //
  // v1 is keyword-driven. The Director will eventually supply these
  // explicitly, but nothing can be proven until state exists at all, and a
  // parser lets the engine be exercised against a real script today.
  // --- events ---------------------------------------------------------------
  //
  // How hard the world hits. Losing a phone and being diagnosed with cancer
  // are not the same size, and the first version of this table treated them
  // the same way: every cue drove one attribute to one fixed number.
  //
  // Two things were wrong with that, and the second was worse.
  //
  //   no tiers      every event was the same magnitude, so the stage had no
  //                 reason to ever behave dramatically
  //   one attribute an event touched exactly one attribute, and wellbeing is
  //                 the average of five. So a catastrophe moved the average by
  //                 a fifth of itself. Measured: losing a job dropped wealth
  //                 0.50 -> 0.15 and moved wellbeing 0.68 -> 0.61. Every
  //                 downstream system -- silhouette, position, environment,
  //                 metaphor -- can express a full 0..1 range, and was being
  //                 handed six hundredths of it.
  //
  // Real events are not single-attribute. Losing a job costs money AND
  // confidence AND calm, and it is the combination that a viewer reads as
  // "this is bad". So an event now declares a magnitude and a spread of
  // consequences, and the impact is a signed share of that magnitude.
  const MAGNITUDE = {
    minor: 0.15,        // an annoyance. Registers, does not reshape the frame.
    moderate: 0.32,     // a real setback or a real win.
    major: 0.52,        // the event the video is about.
    life: 0.78          // there is a before and an after.
  };

  // Words that resize the event they attach to. "Slightly worried" and
  // "completely devastated" are the same cue at different volumes.
  const AMPLIFIERS = [
    [/\b(slightly|a bit|somewhat|mildly|a little|minor)\b/i, 0.55],
    [/\b(very|really|deeply|badly|seriously|heavily)\b/i, 1.35],
    [/\b(completely|totally|utterly|devastat|catastroph|destroyed|shattered|overnight)\w*/i, 1.7]
  ];

  const EVENTS = [
    // Order matters: specific before general, so "lost his job" never falls
    // through to a bare "lost".
    [/\b(died|dies|death|fatal|terminal)\b/i,
      { event: 'death', magnitude: 'life', impact: { health: -1, energy: -1, stress: 0.4 } }],
    [/\b(cancer|tumou?r|diagnos\w*|stroke|heart attack)\b/i,
      { event: 'diagnosis', magnitude: 'life', impact: { health: -0.95, stress: 0.9, confidence: -0.5 } }],
    // 'bankrupt' used to sit in the death cue, so going bankrupt set health to
    // 0.05 and the engine rendered a solvency problem as a dying man.
    [/\b(bankrupt|ruined|foreclos|repossess|lost everything)\w*/i,
      { event: 'ruin', magnitude: 'life', impact: { wealth: -1, confidence: -0.85, stress: 0.9 } }],
    [/\b(divorce|separat\w*|broke up|left (him|her|them))\b/i,
      { event: 'separation', magnitude: 'major', impact: { stress: 0.9, confidence: -0.8, health: -0.3 } }],
    [/\b(lost (his|her|their) job|laid off|fired|unemploy|redundan)\w*/i,
      { event: 'job-loss', magnitude: 'major', impact: { wealth: -0.85, confidence: -0.7, stress: 0.8 } }],
    [/\b(promot\w*|won|awarded|succeeded|breakthrough|landed the)\b/i,
      { event: 'win', lifts: true, magnitude: 'major', impact: { confidence: 0.9, wealth: 0.5, stress: -0.5 } }],
    [/\b(recover\w*|healed|cured|better now|remission)\b/i,
      { event: 'recovery', lifts: true, magnitude: 'major', impact: { health: 0.95, stress: -0.8, confidence: 0.6, energy: 0.5 } }],
    [/\b(debt|poverty|cannot afford|couldn'?t afford|broke)\b/i,
      { event: 'hardship', magnitude: 'major', impact: { wealth: -0.8, stress: 0.7, confidence: -0.4 } }],
    [/\b(sick|ill|disease|infect\w*|symptom)\w*/i,
      { event: 'illness', magnitude: 'moderate', impact: { health: -0.8, energy: -0.6, stress: 0.5 } }],
    [/\b(profit|revenue rose|earned|raised|funded|wealthy|rich)\w*/i,
      { event: 'gain', lifts: true, magnitude: 'moderate', impact: { wealth: 0.85, confidence: 0.5, stress: -0.3 } }],
    [/\b(fell|declin\w*|dropped|collapse|slump|crash)\w*/i,
      { event: 'decline', magnitude: 'moderate', impact: { wealth: -0.8, confidence: -0.5, stress: 0.5 } }],
    [/\b(treatment|medicat\w*|therapy|prescrib\w*)\b/i,
      { event: 'care', lifts: true, magnitude: 'moderate', impact: { health: 0.5, stress: -0.4 } }],
    [/\b(exhaust\w*|tired|fatigue|drained|worn out|burn(?:t|ed) out)\b/i,
      { event: 'depletion', magnitude: 'moderate', impact: { energy: -0.9, stress: 0.4, health: -0.2 } }],
    [/\b(energis\w*|energiz\w*|rested|refreshed|revital\w*)\b/i,
      { event: 'restored', lifts: true, magnitude: 'moderate', impact: { energy: 0.9, stress: -0.3 } }],
    [/\b(worried|anxious|afraid|panic|fear\w*|overwhelm\w*|pressure|stress\w*)\b/i,
      { event: 'strain', magnitude: 'moderate', impact: { stress: 0.85, confidence: -0.4, energy: -0.3 } }],
    [/\b(calm|relieved|reassur\w*|settled|at peace)\b/i,
      { event: 'relief', lifts: true, magnitude: 'moderate', impact: { stress: -0.85, confidence: 0.4 } }],
    [/\b(confident|certain|determined|resolved)\b/i,
      { event: 'resolve', magnitude: 'moderate', impact: { confidence: 0.85, stress: -0.3 } }],
    [/\b(unsure|doubt\w*|hesitat\w*|confused)\b/i,
      { event: 'doubt', magnitude: 'moderate', impact: { confidence: -0.8, stress: 0.4 } }],
    [/\b(improv\w*|progress\w*|grew|growth|better)\b/i,
      { event: 'progress', lifts: true, magnitude: 'moderate', impact: { confidence: 0.6, wealth: 0.4, stress: -0.3 } }],
    // Deliberately last and deliberately small: the control case. If a minor
    // annoyance moved the stage as much as a diagnosis, the tiers would mean
    // nothing.
    [/\b(lost (his|her|their) (phone|keys|wallet|umbrella)|missed the (bus|train)|late for)\b/i,
      { event: 'annoyance', magnitude: 'minor', impact: { stress: 0.6, confidence: -0.2 } }]
  ];

  /** The multiplier a sentence's wording applies to an event's size. */
  function amplifierFor(text) {
    let k = 1;
    AMPLIFIERS.forEach(([re, mult]) => { if (re.test(text)) k *= mult; });
    return k;
  }

  // Kept under the old name so existing callers and the diagnostics panel do
  // not break; the shape is richer than it was.
  const CUES = EVENTS;

  /**
   * Build a state timeline for one entity from an aligned narration timeline.
   *
   * Every change is anchored to the WORD that caused it, which is why this
   * belongs beside the timeline rather than inside a character: the moment
   * comes from the narration, not from the figure.
   */
  function parse(ent, timeline) {
    if (!ent || !timeline || !timeline.sentences) return ent;
    // Nothing may still be arriving when the narration stops. Scaling a
    // change's duration by its magnitude is right in the middle of a video and
    // wrong at the end of one: it put the endTime of "Finally John recovered"
    // at 12.9s in an 11.9s timeline, so the recovery was 23% complete on the
    // last frame and the story closed on its most defeated pose.
    const lastWord = timeline.words && timeline.words.length
      ? timeline.words[timeline.words.length - 1].end : 0;
    const limit = Number(timeline.duration) || lastWord || 0;
    timeline.sentences.forEach((s) => {
      // One event per sentence: the first and biggest match wins. Letting
      // every cue in a sentence fire was how a script accidentally hit four
      // attributes and looked dramatic, while a script naming one real
      // catastrophe looked flat.
      let matched = null;
      for (const [re, spec] of EVENTS) {
        const m = re.exec(s.text);
        if (m) { matched = { re, spec, m }; break; }
      }
      if (!matched) return;
      const { re, spec, m } = matched;

      // Anchor to the matched phrase, not the sentence start, so the visual
      // change lands on the word a viewer hears.
      const words = timeline.words.filter((w) => w.start >= s.start && w.end <= s.end);
      const hit = words.find((w) => new RegExp(re.source, 'i').test(w.text)) || words[0];
      const at = hit ? hit.start : s.start;

      const scale = (MAGNITUDE[spec.magnitude] || MAGNITUDE.moderate) * amplifierFor(s.text);

      // Restorative events lift the floor.
      //
      // Because wellbeing is now half-driven by the worst attribute, an
      // attribute nobody ever repairs pins the whole arc down for the rest of
      // the video. Measured: "Finally John recovered" rendered as `defeated`
      // at the lowest wellbeing of the story, because recovery touches health
      // and not the wealth his job loss had destroyed.
      //
      // Rather than special-case it, positive events also lift whatever is
      // currently worst. That is what recovery means to a viewer — the thing
      // that was worst is the thing that got better.
      const impact = Object.assign({}, spec.impact);
      if (spec.lifts) {
        let worstAttr = null;
        let worstVal = 1;
        NUMERIC.forEach((a) => {
          const raw = sample(ent, a, Math.max(0, at - 0.01));
          if (raw == null) return;
          const v = polarity(a) > 0 ? raw : 1 - raw;
          if (v < worstVal) { worstVal = v; worstAttr = a; }
        });
        if (worstAttr && impact[worstAttr] == null) {
          impact[worstAttr] = 0.7 * polarity(worstAttr);
        }
      }

      // Every consequence of the event, not just its headline attribute.
      Object.keys(impact).forEach((attr) => {
        const from = sample(ent, attr, Math.max(0, at - 0.01));
        const to = clamp01(Number(from) + impact[attr] * scale);
        if (Math.abs(to - from) < 0.01) return;   // nothing to animate
        addChange(ent, {
          attribute: attr,
          from,
          to,
          startTime: at,
          // Bigger events take longer to land. A life-changing moment that
          // resolved in the same 0.8s as a minor one would read as trivial.
          //
          // But it must finish inside its own BEAT. A scene samples one frame
          // per sentence, so a change still in flight when the sentence ends
          // renders at partial intensity — and because the duration scales
          // with magnitude, this hit the largest events hardest. Measured: a
          // diagnosis settled at 5.3s in a sentence ending at 4.8s and
          // rendered 0.36 instead of its true 0.14, i.e. the top of the scale
          // was quietly capped by the very rule meant to make it feel big.
          endTime: Math.max(
            at + 0.2,
            Math.min(at + 0.5 + scale * 1.6, s.end || Infinity, limit || Infinity)
          ),
          cause: m[0],
          event: spec.event,
          magnitude: spec.magnitude
        });
      });
    });
    return ent;
  }

  /**
   * The whole scene's response to state — not just the pose.
   *
   * A state change should produce a visual EXPERIENCE, not a gesture. Rising
   * stress is a tighter frame, a darker room and a heavier vignette as well as
   * a bent figure; recovery is the room opening back up. Driving only the pose
   * is why five frames of a real arc looked like the same picture with
   * different arm angles.
   *
   * Returns multipliers the compositor applies, so every layer answers to the
   * same fact instead of being directed separately.
   */
  function moodFor(ent, t) {
    const s = stateAt(ent, t);
    const c = changeAt(ent, t);

    // Wellbeing, with inverted attributes flipped.
    //
    // This was a flat average, and the average was the amplitude bug. Five
    // attributes meant any single event was divided by five before it reached
    // the stage, so a man who had just lost his job still scored 0.61 because
    // his health was fine. Every expressive system downstream was being handed
    // a sliver of its range.
    //
    // It is also wrong about people. How someone is doing is dominated by the
    // worst thing happening to them, not by the mean of their circumstances.
    // So the floor gets equal billing with the average: one attribute in
    // crisis is enough to make the whole frame read as crisis, which is what a
    // viewer already believes.
    // A HARMONIC mean, which is the fix for a saturation the flat-min blend
    // had. Measured through the whole chain:
    //
    //   lost job (major)   state swing 0.34
    //   cancer   (life)    state swing 0.25   <- smaller than a lesser event
    //
    // Baseline's worst attribute is wealth at 0.5, so ANY event that drives
    // some attribute below 0.5 moved the floor to roughly the same place.
    // Beyond that point bigger events stopped reading as bigger, and the top
    // two tiers were indistinguishable.
    //
    // A harmonic mean keeps the property that matters -- it is dominated by
    // the smallest value, so one attribute in crisis still drags the whole
    // frame down -- but it never stops responding. A second attribute going
    // bad lowers it again, which is exactly what separates a diagnosis (health
    // gone, stress high, confidence gone) from a job loss (money gone).
    let recip = 0;
    let n = 0;
    NUMERIC.forEach((a) => {
      if (s[a] == null) return;
      const v = polarity(a) > 0 ? s[a] : 1 - s[a];
      recip += 1 / Math.max(0.02, v);   // floored so a zeroed attribute cannot divide by zero
      n++;
    });
    const wellbeing = n ? n / recip : 0.6;

    // Intensity: how much is happening right now. A big change earns a big
    // visual response; a steady state does not.
    let intensity = 0;
    if (c && NUMERIC.indexOf(c.attribute) > -1) {
      intensity = Math.min(1, Math.abs(Number(c.to) - Number(c.from == null ? s[c.attribute] : c.from)) * 1.6);
    }

    return {
      wellbeing: Math.round(wellbeing * 100) / 100,
      intensity: Math.round(intensity * 100) / 100,
      // Low wellbeing darkens the room; the world reflects the condition.
      brightness: Math.round((0.55 + wellbeing * 0.45) * 100) / 100,
      // High intensity closes in — the frame tightens on a moment that matters.
      framing: Math.round((1 + intensity * 0.55) * 100) / 100,
      // A vignette presses in as things worsen.
      vignette: Math.round(Math.max(0, (0.62 - wellbeing) + intensity * 0.35) * 100) / 100,
      // Stress adds unsteadiness; calm removes it.
      unsteady: Math.round(Math.max(0, (s.stress == null ? 0.2 : s.stress) - 0.4) * 100) / 100,

      // WHERE the figure stands is information. Confidence walks it forward
      // and toward centre; stress and poor health push it back and to the
      // edge. A figure rooted to one spot in every frame is the single
      // clearest sign that nothing is happening.
      //
      // advance: 0 = far and small, 1 = near and large
      // drift:   -1 = pushed left/away, +1 = stepped right/toward
      advance: Math.round(Math.max(0, Math.min(1, wellbeing * 0.9 + intensity * 0.2)) * 100) / 100,
      drift: Math.round(((wellbeing - 0.55) * 1.4) * 100) / 100,
      // Low wellbeing also lowers the figure: sinking is legible at any size.
      sink: Math.round(Math.max(0, (0.55 - wellbeing) * 0.5) * 100) / 100
    };
  }

  window.BlvckStoryState = {
    entity,
    change,
    addChange,
    sample,
    stateAt,
    changeAt,
    actorFor,
    moodFor,
    polarity,
    INVERTED,
    parse,
    NUMERIC,
    CATEGORICAL,
    CUES,
    EVENTS,
    MAGNITUDE,
    amplifierFor
  };
})();
