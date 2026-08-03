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
      cause: String(s.cause || '')
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
  const CUES = [
    [/\b(died|dies|fatal|collapsed|bankrupt|ruined)\b/i, { attribute: 'health', to: 0.05 }],
    [/\b(sick|ill|disease|infected|diagnos|symptom)\w*/i, { attribute: 'health', to: 0.3 }],
    [/\b(recover|healed|cured|better now|improved)\w*/i, { attribute: 'health', to: 0.85 }],
    [/\b(treatment|medicat|therapy|prescrib)\w*/i, { attribute: 'health', to: 0.55 }],
    [/\b(exhaust|tired|fatigue|drained|worn out)\w*/i, { attribute: 'energy', to: 0.2 }],
    [/\b(energis|energiz|rested|refreshed|revital)\w*/i, { attribute: 'energy', to: 0.9 }],
    [/\b(lost (his|her|their) job|laid off|fired|unemploy|redundan)\w*/i, { attribute: 'wealth', to: 0.15 }],
    [/\b(bankrupt|debt|broke|poverty|cannot afford)\w*/i, { attribute: 'wealth', to: 0.1 }],
    [/\b(profit|revenue rose|earned|raised|funded|wealthy|rich)\w*/i, { attribute: 'wealth', to: 0.85 }],
    [/\b(fell|declin|dropped|collapse|slump|crash)\w*/i, { attribute: 'wealth', to: 0.25 }],
    [/\b(worried|anxious|afraid|panic|fear)\w*/i, { attribute: 'stress', to: 0.8 }],
    [/\b(calm|relieved|reassur|settled)\w*/i, { attribute: 'stress', to: 0.15 }],
    [/\b(confident|certain|decided|determined)\w*/i, { attribute: 'confidence', to: 0.85 }],
    [/\b(unsure|doubt|hesitat|confused)\w*/i, { attribute: 'confidence', to: 0.25 }]
  ];

  /**
   * Build a state timeline for one entity from an aligned narration timeline.
   *
   * Every change is anchored to the WORD that caused it, which is why this
   * belongs beside the timeline rather than inside a character: the moment
   * comes from the narration, not from the figure.
   */
  function parse(ent, timeline) {
    if (!ent || !timeline || !timeline.sentences) return ent;
    timeline.sentences.forEach((s) => {
      CUES.forEach(([re, spec]) => {
        const m = re.exec(s.text);
        if (!m) return;
        // Anchor to the matched phrase, not the sentence start, so the visual
        // change lands on the word a viewer hears.
        const words = timeline.words.filter((w) => w.start >= s.start && w.end <= s.end);
        const hit = words.find((w) => new RegExp(re.source, 'i').test(w.text)) || words[0];
        const at = hit ? hit.start : s.start;
        addChange(ent, {
          attribute: spec.attribute,
          from: sample(ent, spec.attribute, Math.max(0, at - 0.01)),
          to: spec.to,
          startTime: at,
          endTime: at + 0.8,          // brief ease, so it reads as a change
          cause: m[0]
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

    // Wellbeing: the average of everything, with inverted attributes flipped.
    let sum = 0;
    let n = 0;
    NUMERIC.forEach((a) => {
      if (s[a] == null) return;
      sum += polarity(a) > 0 ? s[a] : 1 - s[a];
      n++;
    });
    const wellbeing = n ? sum / n : 0.6;

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
    CUES
  };
})();
