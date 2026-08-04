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
  const NUMERIC = ['health', 'energy', 'wealth', 'confidence', 'stress', 'size',
                   'uncertainty', 'resolve', 'obligation'];

  // CONDITION vs STANCE — which attributes mean "things are going well", and
  // which only describe how a person is holding themselves.
  //
  // This split exists because "He had to choose between two paths" changed no
  // state at all, so the body did not move. The obvious fix is to make a
  // dilemma an attribute, and the obvious fix is a trap: if uncertainty fed
  // wellbeing, then facing a choice would dim the lights, cool the room and
  // sink the figure exactly as though something bad had happened. A dilemma is
  // not a misfortune. Being torn is not the same as being unwell.
  //
  // So condition drives wellbeing and therefore the whole environment; stance
  // drives posture only. A character can be resolute and destitute, or safe
  // and paralysed, and those look different.
  const CONDITION = ['health', 'energy', 'wealth', 'confidence', 'stress'];
  const STANCE = ['uncertainty', 'resolve', 'obligation'];

  // Attributes where MORE is worse. Without this, "stress rose sharply" was
  // rendered as a celebration — the delta was large and positive, and nothing
  // told the engine that rising stress is bad news. Polarity is a property of
  // the attribute, not of the change.
  const INVERTED = ['stress', 'uncertainty', 'obligation'];
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
      baseline: Object.assign({
        health: 0.8, energy: 0.7, wealth: 0.5, confidence: 0.6, stress: 0.2,
        uncertainty: 0.2, resolve: 0.5, obligation: 0.2
      }, s.baseline || {}),
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

  /**
   * State -> a POINT IN POSE SPACE, plus any gesture the moment calls for.
   *
   * This supersedes actorFor's clip lookup for standing posture. actorFor
   * answered "which of ten poses is this?", which threw away everything except
   * which side of a threshold the state landed on — stress 0.66 and stress
   * 0.98 returned the identical figure. Posture is now continuous, the way the
   * room's brightness and warmth already were.
   *
   * Clips are not gone. They are GESTURES: a facepalm is something you do at a
   * moment, not a way you stand, so it rides on top of the posture at a weight
   * set by how big the change is. That keeps "the reaction IS the beat" while
   * letting the standing body follow the state continuously.
   */
  function postureFor(ent, t) {
    const P = window.BlvckPose;
    if (!P || !ent) return null;
    const s = stateAt(ent, t);
    // Only a change that has ALREADY BEGUN earns a reaction. changeAt's window
    // reaches 0.4s forward so a beat can anticipate what is coming, which is
    // right for the standing state and wrong for a gesture: it put a facepalm
    // at weight 0.62 on "John improved step by step", borrowing the reaction
    // to a job loss that had not happened yet.
    const pending = changeAt(ent, t);
    const c = pending && t >= pending.startTime ? pending : null;
    const axes = P.axesFromState(s);

    let gesture = null;
    let gestureWeight = 0;
    let reason = 'standing state';
    if (c && NUMERIC.indexOf(c.attribute) > -1) {
      const raw = Number(c.to) - Number(c.from == null ? s[c.attribute] : c.from);
      const delta = raw * polarity(c.attribute);
      if (delta <= -0.28) {
        gesture = 'facepalm';
        gestureWeight = Math.min(0.8, Math.abs(delta) * 1.4);
        reason = `${c.attribute} ${raw < 0 ? 'fell' : 'rose'} sharply — worse`;
      } else if (delta >= 0.28) {
        gesture = 'celebrate';
        gestureWeight = Math.min(0.8, delta * 1.4);
        reason = `${c.attribute} ${raw < 0 ? 'fell' : 'rose'} sharply — better`;
      }
    }

    const stress = s.stress == null ? 0.2 : s.stress;
    const health = s.health == null ? 0.8 : s.health;
    const conf = s.confidence == null ? 0.6 : s.confidence;
    let emotion = 'neutral';
    if (gesture === 'celebrate') emotion = 'excited';
    else if (gesture === 'facepalm') emotion = health < 0.4 ? 'sad' : 'crying';
    else if (stress > 0.6) emotion = 'nervous';
    else if (health < 0.35) emotion = 'sad';
    else if (conf > 0.75) emotion = 'confident';
    else if (health > 0.8 && conf > 0.6) emotion = 'happy';

    return {
      axes,
      pose: P.poseFrom(axes),
      gesture,
      gestureWeight: Math.round(gestureWeight * 100) / 100,
      emotion,
      nearest: P.describe(axes).nearest,
      reason
    };
  }

  /**
   * Apply state changes the DIRECTOR named, rather than ones a regex inferred.
   *
   * This is the path the keyword parser below was always scaffolding for. Its
   * own comment said so; the measurement said when. Across a 48-beat corpus
   * spanning eight genres the regex recognised 31% of CONDITION beats and 25%
   * of STANCE beats — dimensions the engine fully supports. The renderer had
   * become more expressive than the parser could feed it.
   *
   * `changes` is already validated by the prompt route: unknown attributes and
   * out-of-range sentence indices are dropped there, so anything arriving here
   * is a known attribute pointing at a real sentence. Deltas are still applied
   * relative to the CURRENT value and clamped, because the model reports what
   * changed and only this engine knows what was true beforehand.
   */
  function applyDirectorChanges(ent, timeline, changes) {
    if (!ent || !timeline || !timeline.sentences || !Array.isArray(changes)) return ent;
    const lastWord = timeline.words && timeline.words.length
      ? timeline.words[timeline.words.length - 1].end : 0;
    const limit = Number(timeline.duration) || lastWord || 0;

    // Sentence order, so `from` samples see the changes that precede them.
    changes.slice().sort((a, b) => a.sentence - b.sentence).forEach((c) => {
      const s = timeline.sentences[c.sentence];
      if (!s) return;
      const at = s.start;
      const from = sample(ent, c.attribute, Math.max(0, at - 0.01));
      const to = clamp01(Number(from) + c.delta);
      if (Math.abs(to - from) < 0.01) return;
      addChange(ent, {
        attribute: c.attribute,
        from,
        to,
        startTime: at,
        // Same rule the keyword path learned: bigger changes take longer, but
        // never past the beat, or the largest events render half-landed.
        endTime: Math.max(at + 0.2,
          Math.min(at + 0.5 + Math.abs(c.delta) * 1.6, s.end || Infinity, limit || Infinity)),
        cause: c.cause || '',
        event: 'director',
        magnitude: Math.abs(c.delta) >= 0.7 ? 'life'
          : Math.abs(c.delta) >= 0.45 ? 'major'
          : Math.abs(c.delta) >= 0.22 ? 'moderate' : 'minor'
      });
    });
    return ent;
  }

  /**
   * Read state for a whole timeline, preferring the Director and falling back
   * to keywords.
   *
   * The fallback is not politeness: the app runs without an AI key, and a
   * pipeline that silently produces a motionless figure offline would be worse
   * than one that produces a rough one.
   */
  async function readState(ent, timeline, opts) {
    const o = opts || {};
    if (o.useDirector !== false && window.BlvckAI && window.BlvckAI.generateJSON) {
      try {
        const res = await window.BlvckAI.generateJSON('/api/story-state', {
          subject: ent.name,
          sentences: timeline.sentences.map((s) => s.text)
        }, o.aiOptions || {});
        if (res && Array.isArray(res.changes) && res.changes.length) {
          applyDirectorChanges(ent, timeline, res.changes);
          ent.stateSource = 'director';
          return ent;
        }
        // An empty result is not an error, but it is not usable either: fall
        // through rather than return a subject nothing ever happens to.
      } catch (err) {
        console.warn('[story-state] Director state failed, using keywords:', err && err.message);
      }
    }
    parse(ent, timeline);
    ent.stateSource = 'keywords';
    return ent;
  }

  // --- reading state out of narration -------------------------------------
  //
  // The keyword parser. Now the FALLBACK path, kept for offline runs and as a
  // reference implementation of what the Director is asked to produce. See
  // readState() above for the preferred route.
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
    // Narrowed: 'determined' and 'resolved' now belong to the determination
    // stance event below, and 'certain' to clarity. They matched here first,
    // which made both new events unreachable for their most common trigger
    // words — "He was determined to rebuild" came back tagged `resolve` and
    // moved confidence instead of resolve. One word, one owner.
    [/\b(confident|self-assured|assured|sure of (?:himself|herself|themselves))\b/i,
      { event: 'resolve', magnitude: 'moderate', impact: { confidence: 0.85, stress: -0.3 } }],
    [/\b(unsure|doubt\w*|hesitat\w*|confused)\b/i,
      { event: 'doubt', magnitude: 'moderate', impact: { confidence: -0.8, stress: 0.4 } }],
    [/\b(improv\w*|progress\w*|grew|growth|better)\b/i,
      { event: 'progress', lifts: true, magnitude: 'moderate', impact: { confidence: 0.6, wealth: 0.4, stress: -0.3 } }],

    // --- stance events ----------------------------------------------------
    //
    // These change how a person stands without claiming their circumstances
    // got better or worse. "He had to choose between two paths" used to match
    // nothing at all, so the state was identical to the beat before it and the
    // figure rendered unchanged while the narration moved on. A dilemma is one
    // of the most common things a script does; it deserves a body.
    // Bare 'choice' and 'decision' used to be in here and were far too broad:
    // "He was furious at the decision" came back tagged `dilemma` and rendered
    // anger as being torn. The decision was someone else's. A dilemma needs
    // the CHOOSING to belong to the subject, so the triggers are now verbal or
    // possessive. Anger is not represented at all, and going silent is the
    // correct failure — a state we cannot describe should produce no change,
    // not the wrong one.
    [/\b(had to choose|must choose|had to decide|must decide|decide between|choose between|dilemma|torn between|two paths|crossroads|(?:his|her|their) (?:choice|decision)|difficult choice|no easy choice)\b/i,
      { event: 'dilemma', magnitude: 'moderate',
        impact: { uncertainty: 0.85, resolve: -0.5, stress: 0.25 } }],
    [/\b(determined|resolved to|committed|made up (?:his|her|their) mind|set out to|vowed)\b/i,
      { event: 'determination', magnitude: 'moderate',
        impact: { resolve: 0.9, uncertainty: -0.7, confidence: 0.4 } }],
    [/\b(had to|obliged|responsib\w*|duty|expected (?:him|her|them)|no choice but|forced to)\b/i,
      { event: 'obligation', magnitude: 'moderate',
        impact: { obligation: 0.8, resolve: 0.2, stress: 0.3 } }],
    [/\b(regret\w*|wished (?:he|she|they)|looked back|should have|if only)\b/i,
      { event: 'regret', magnitude: 'moderate',
        impact: { uncertainty: 0.5, confidence: -0.4, resolve: -0.3 } }],
    [/\b(finally knew|no longer doubted|clear (?:to|about)|certain(?:ty)?|understood at last)\b/i,
      { event: 'clarity', lifts: true, magnitude: 'moderate',
        impact: { uncertainty: -0.9, resolve: 0.6, confidence: 0.5 } }],
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
  // --- intent --------------------------------------------------------------
  //
  // What the subject is PURSUING, which is different from how they feel.
  // Condition and stance describe a person; intent describes a person aimed at
  // something. Without it there is tension but no stakes: a story can only get
  // better or worse, never closer or further.
  //
  // Eight staged metaphors already existed — climb, barrier, fork, gap,
  // bridge, drain, weight, fall — and they were chosen by KEYWORD. "He climbed
  // for six hours" got a staircase because it contained the word climb, not
  // because anyone was making progress toward anything. So the metaphor
  // vocabulary illustrated the wording rather than the situation, and two
  // beats with the same words got the same picture however the story had
  // moved. This is the join that gives them something true to attach to.
  //
  // Deliberately small: one goal at a time, three facts about it. Multiple
  // competing goals are a later problem, and inventing them now would repeat
  // the mistake of building representation ahead of the render loop.
  const GOAL_EVENTS = [
    // `wanted to` alone missed "He wanted the promotion" — the commonest way
    // anyone states a goal — so the first stress test had a story whose goal
    // never began. The want went unrecorded and `want` reported "worked at".
    [/\b(wanted|set out to|decided to|hoped (?:to|for)|aimed (?:to|for)|dreamed of|needed|longed for|was determined to)\b/i,
      { act: 'want' }],
    [/\b(worked at|kept at|pushed on|carried on|tried again|step by step|inch(?:ed)? closer|got closer|made progress)\b/i,
      { act: 'advance', by: 0.25 }],
    [/\b(blocked|refused|denied|turned (?:him|her|them) down|stood in (?:his|her|their) way|could not afford|ran out of)\b/i,
      { act: 'block' }],
    [/\b(finally|at last|achieved|succeeded|got there|made it|reached it|won)\b/i,
      { act: 'achieve' }],
    // "lost interest" was absent, so a lapsed goal and an achieved one
    // rendered the SAME four frames — the exact failure intent exists to
    // prevent, reappearing through a thin vocabulary rather than a wrong
    // design. Coverage is the weakness of the mechanism, which is why this
    // belongs in the scene plan eventually.
    [/\b(gave up|abandoned|walked away from|stopped trying|let it go|lost interest|stopped caring|no longer wanted)\b/i,
      { act: 'abandon' }]
  ];

  /**
   * Read a goal out of narration, as a small timeline of its own.
   *
   * ONE THREAD, AND THE STRESS TEST SHOWED WHAT THAT COSTS. Given "he wanted
   * the promotion / he also wanted to see his daughter / he worked at it / he
   * gave up the evenings at home", every mark lands on a single goal, so
   * giving up the evenings marks the PROMOTION abandoned and the frame falls.
   * He was pursuing one thing by surrendering another; the model cannot hold
   * that.
   *
   * Not fixed here on purpose. Separating threads needs each mark bound to
   * WHICH goal it belongs to, and deciding that from a regex means matching a
   * verb to an object across a clause — the thing keyword matching is worst
   * at. It is the same argument that moved objects into the scene plan, and
   * intent should follow rather than grow a second table.
   */
  function readIntent(ent, timeline) {
    if (!ent || !timeline || !timeline.sentences) return ent;
    ent.goal = null;
    const marks = [];
    timeline.sentences.forEach((s) => {
      for (const [re, spec] of GOAL_EVENTS) {
        const m = re.exec(s.text);
        if (!m) continue;
        marks.push({ at: s.start, act: spec.act, by: spec.by || 0, cause: m[0] });
        break;
      }
    });
    if (!marks.length) return ent;
    ent.goal = { marks, want: marks[0].cause };
    return ent;
  }

  /**
   * Where the goal stands at time t: how far along, and whether it is blocked.
   */
  function goalAt(ent, t) {
    if (!ent || !ent.goal) return null;
    let progress = 0;
    let blocked = false;
    let done = null;
    ent.goal.marks.forEach((m) => {
      if (m.at > t) return;
      if (m.act === 'advance') { progress = Math.min(1, progress + m.by); blocked = false; }
      else if (m.act === 'block') blocked = true;
      else if (m.act === 'achieve') { progress = 1; done = 'achieved'; blocked = false; }
      else if (m.act === 'abandon') done = 'abandoned';
    });
    return { progress: Math.round(progress * 100) / 100, blocked, done, want: ent.goal.want };
  }

  /**
   * The metaphor a GOAL implies — the join intent exists for.
   *
   * Returns null when there is no goal, so keyword inference still runs for
   * beats that are not about pursuing anything. Intent supersedes wording; it
   * does not replace it everywhere.
   */
  function metaphorForGoal(ent, t) {
    const g = goalAt(ent, t);
    if (!g) return null;
    if (g.done === 'abandoned') return 'fall';
    if (g.blocked) return 'barrier';
    if (g.done === 'achieved') return 'climb';
    if (g.progress >= 0.2) return 'climb';
    return 'gap';          // wanted, not yet moving — the distance is the point
  }

  // --- time ----------------------------------------------------------------
  //
  // Which way a beat FACES. Everything else in the model describes now:
  // condition now, stance now, what is being pursued now. But a great deal of
  // narration is about a moment that is not this one — a memory, a dread, a
  // deadline — and those had no representation at all, so "he remembered the
  // day she left" and "he waited for the call" rendered as the same present
  // tense.
  //
  // Two facts, deliberately: WHICH WAY and HOW HARD. Direction is past or
  // future; pressure is how much that other moment is pushing on this one.
  // Nostalgia and regret share a direction and differ in condition, which the
  // existing model already carries — so this does not need its own valence.
  const TIME_EVENTS = [
    [/\b(remember\w*|recall\w*|looked back|years (?:ago|before)|had once|used to|as a (?:child|boy|girl)|thought back)\b/i,
      { dir: 'past', push: 0.5 }],
    [/\b(regret\w*|should have|if only|wished (?:he|she|they) had|never forgot)\b/i,
      { dir: 'past', push: 0.8 }],
    [/\b(tomorrow|next (?:week|month|year|morning)|would (?:one day|eventually)|some day|one day)\b/i,
      { dir: 'future', push: 0.4 }],
    [/\b(waited for|waiting for|any day now|due|deadline|by (?:friday|monday|morning)|before it was too late)\b/i,
      { dir: 'future', push: 0.7 }],
    [/\b(running out|no time left|hours left|days left|counting down|closing in)\b/i,
      { dir: 'future', push: 1 }]
  ];

  /** Read temporal orientation across the narration, like intent. */
  function readTime(ent, timeline) {
    if (!ent || !timeline || !timeline.sentences) return ent;
    ent.horizon = [];
    timeline.sentences.forEach((s) => {
      for (const [re, spec] of TIME_EVENTS) {
        const m = re.exec(s.text);
        if (!m) continue;
        ent.horizon.push({ at: s.start, until: s.end, dir: spec.dir,
                           push: spec.push, cause: m[0] });
        break;
      }
    });
    return ent;
  }

  /**
   * Which way this beat faces, if anywhere but now.
   *
   * Scoped to the SENTENCE that carried it rather than latching. A memory is
   * something a beat does, not a state a character enters — latching it would
   * tint the rest of the story with one remembered line, which is the mistake
   * the metaphor keywords made in the other direction.
   */
  function horizonAt(ent, t) {
    if (!ent || !ent.horizon || !ent.horizon.length) return null;
    const h = ent.horizon.find((x) => t >= x.at - 0.3 && t <= x.until + 0.3);
    return h ? { dir: h.dir, push: h.push, cause: h.cause } : null;
  }

  // --- causality -----------------------------------------------------------
  //
  // The last system, and the one with the least obvious picture. Every other
  // system describes a single beat: how someone is, how they hold themselves,
  // what they want, which moment they face. Causality is the only one that is
  // a statement about TWO beats — this happened because that did.
  //
  // Which is why it cannot have a pose. The pose space already consumes every
  // condition and stance attribute, so routing cause through the body would
  // be a second representation of something already represented, and the only
  // honest way to tell them apart on screen would be that they disagree.
  //
  // What is actually unclaimed is PERSISTENCE. A list of beats and a chain of
  // beats differ in one visible way: in a chain, the thing that caused it is
  // still there. "The factory closed. He could not pay the rent." reads as
  // cause and effect when the second frame still contains the factory, and as
  // two unrelated facts when it does not. So causality renders by carrying
  // the cause's world forward into the effect, dimmed — present, but past.
  //
  // Deliberately conservative about direction. `because` points backward and
  // `so` points forward, and getting that wrong inverts the chain, so each
  // marker declares which side of it the cause sits on.
  const CAUSAL_MARKERS = [
    // The effect sentence names its own cause, which lies BEFORE it.
    [/\b(because of (?:this|that|it)|as a result|consequently|therefore|which meant|which left|that is why|for this reason)\b/i, 'back'],
    // `so` only where it OPENS the sentence. As a connective it leads —
    // "So he sold the car" — and as an intensifier it sits inside the clause
    // — "he was so tired". In the general alternation it matched every
    // intensifier in the language: a false-positive probe scored 4 of 4,
    // linking a sunset to someone's youth. Position separates the two senses
    // where vocabulary cannot.
    [/^\s*so\b/i, 'back'],
    // The cause sentence names what follows, which lies AFTER it.
    [/\b(led to|caused|meant that|forced (?:him|her|them)|left (?:him|her|them) (?:with|to)|set off|triggered)\b/i, 'forward']
  ];

  /**
   * Link beats that are causally joined.
   *
   * Adjacency only — a marker links a sentence to its immediate neighbour on
   * the declared side. Longer chains are real but resolving them needs the
   * Director; guessing across three sentences would manufacture links that
   * are not in the text, and a wrong link renders as a wrong frame.
   */
  function readCause(ent, timeline) {
    if (!ent || !timeline || !timeline.sentences) return ent;
    const sents = timeline.sentences;
    ent.links = [];
    sents.forEach((s, i) => {
      for (const [re, side] of CAUSAL_MARKERS) {
        const m = re.exec(s.text);
        if (!m) continue;
        const causeIdx = side === 'back' ? i - 1 : i;
        const effectIdx = side === 'back' ? i : i + 1;
        if (causeIdx < 0 || effectIdx >= sents.length || causeIdx === effectIdx) break;
        ent.links.push({
          causeAt: sents[causeIdx].start, causeUntil: sents[causeIdx].end,
          effectAt: sents[effectIdx].start, effectUntil: sents[effectIdx].end,
          marker: m[0], side
        });
        break;
      }
    });
    return ent;
  }

  /** If the beat at t is an effect, when its cause happened. */
  function causeAt(ent, t) {
    if (!ent || !ent.links || !ent.links.length) return null;
    const l = ent.links.find((x) => t >= x.effectAt - 0.3 && t <= x.effectUntil + 0.3);
    return l ? { at: l.causeAt, until: l.causeUntil, marker: l.marker } : null;
  }

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
    // CONDITION only. Stance attributes describe how someone is standing, not
    // how they are doing, and feeding them in here would make every dilemma
    // look like a disaster — and would silently recalibrate the four tiers
    // that were just measured monotonic.
    CONDITION.forEach((a) => {
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
    postureFor,
    moodFor,
    polarity,
    INVERTED,
    parse,
    readIntent,
    readTime,
    horizonAt,
    readCause,
    causeAt,
    goalAt,
    metaphorForGoal,
    readState,
    applyDirectorChanges,
    NUMERIC,
    CONDITION,
    STANCE,
    CATEGORICAL,
    CUES,
    EVENTS,
    MAGNITUDE,
    amplifierFor
  };
})();
