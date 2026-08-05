// Sequence Battery — does a run of beats read as a story or as a list?
//
// Every battery before this one measured single frames: is this beat legible,
// is that beat distinct from its neighbour. That was the right question while
// the systems under test described single moments.
//
// Time and Causality do not. They are the first two systems that make a claim
// ACROSS beats — this moment faces that one, this beat happened because that
// one did — and a single-frame battery cannot see them at all.
//
// So the question changes to: does the ORDER of the beats matter?
//
// That is the whole test, and it carries its own control. If a narration and
// a shuffled copy of the same narration produce the same pictures, then no
// cross-beat system is doing anything, whatever the traces say. A story whose
// frames survive shuffling is a list.
//
// Three numbers per story:
//
//   coverage      beats carrying a cross-beat annotation (horizon or cause).
//                 The dormancy check at corpus scale: a system that never
//                 fires on real prose is not implemented, it is decorative.
//   movement      mean pixel difference between consecutive frames. Low means
//                 the run collapsed into one picture, which is the failure the
//                 25-scene battery started with.
//   orderEffect   how much the frame set changes when the sentences are
//                 shuffled. This is the one that matters.
//
// Run from the console: BlvckSeqBattery.run().
//
// --- how to write down what this returns ---------------------------------
//
// Three summaries in this file have had to be narrowed after the fact, and
// they failed the same way:
//
//   written                              supported
//   no dormancy anywhere                 none among the TRACED channels on
//                                        THIS corpus
//   the intent -> metaphor link is dead  on THIS corpus, no live goal
//                                        produced a rendered metaphor
//   the Director extracts more           a producer that is 75% DIRECTOR,
//                                        on THIS corpus, with THIS model,
//                                        extracted more
//
// Every correction moved the same direction: from a property of the ENGINE
// to a property of the RUN. Not one of the numbers was wrong. The error was
// always one layer above them, in the sentence that generalised them — and
// that sentence is the part that gets quoted six months later, long after
// the run behind it is forgotten.
//
// So, the rule:
//
//   EVERY DECLARATIVE CONCLUSION CARRIES ITS CONDITIONING, unless the claim
//   has been demonstrated across multiple independent runs.
//
// A summary sentence should answer, without being asked: on which corpus?
// under which producer? with which model? over how many runs? at what
// purity? If it does not, it is claiming more than the run established.
//
// This applies to the perceptual results too, when they exist. "Director
// images are more legible" will be the tempting sentence and the wrong one;
// "on this corpus, with these participants and this renderer, images from
// the 75%-Director producer were recognised more accurately" is the one the
// study can actually support.
//
// FIRST RUN — the baseline this instrument exists to be measured against.
// Append later runs, do not edit these.
//
//   story        beats  coverage  links  movement  orderEffect
//   redundancy     5      0.20      0      1.32%      0.40
//   diagnosis      5      0.60      0      1.15%      0.20
//   startup        5      0.40      0      0.27%      0.00
//   plain          5      0.00      0      0.00%      0.00
//
// The control behaved: `plain` scored zero coverage, which is correct, and
// zero movement, which is not — five beats of descriptive prose rendered as
// five identical frames.
//
// Three results, worst first.
//
// LINKS ZERO EVERYWHERE, including two stories carrying explicit markers.
// The link is found — readCause returns "As a result", cause 3.6-7.54,
// effect 7.6-12.34, and the cause SCENE is located correctly. It fails at
// the last step, because residue carries the cause's OBJECTS and the cause
// beat has none. Causality renders only when the causing beat happens to
// contain props. The isolated test that proved it used "He signed the
// letter of resignation" — a sentence chosen, without my noticing, for
// having objects in it. A passing test selected for the case that passes.
//
// MOVEMENT UNDER 1.4% EVERYWHERE. Consecutive frames are ~99% identical.
// Whatever legibility single beats have, a run of them is close to static.
//
// 35% OF BEATS HAVE ANY DIFFERENTIATOR. Across 20 beats: 4 with objects,
// 6 with a horizon, 2 with support, 1 interaction, 1 anchor, 0 metaphors —
// 7 beats total carry anything at all, and 13 carry nothing. The cross-beat
// systems are no longer the bottleneck. Per-beat content is.
//
// SECOND RUN — information flow, same corpus, same code path.
//
//   story        payload  delivered  eff.  unused  persistence (base)
//   redundancy     0.60     0.60     1.00   0.00     0.00  (3)
//   diagnosis      1.40     1.40     1.00   0.00     0.50  (6)
//   startup        0.80     0.80     1.00   0.00     1.00  (2)
//   plain          0.00     0.00      —      —        —    (0)
//   -------------------------------------------------------------------
//   corpus         0.70     0.70     1.00   0.00     0.45  (11)
//
//   selfTest()     chair -> eff 1.00 / unused 0.00
//                  hammock -> eff 0.00 / unused 1.00      pass
//
// THIRD RUN — why the empty beats were empty. staging: keywords (20/20).
//
//   reason         beats     what it means
//   no-actor         7       no person referenced; description or place
//   intent-only      3       a goal is live and produced no metaphor
//   keyword-miss     3       a person is present and nothing matched
//   state-only       0       state moved with no channel to carry it
//   ----------------------------------------------------------------
//   empty           13       of 20
//
// The largest bucket is not the one the roadmap assumed. `keyword-miss` —
// the bucket the Director is expected to empty — is 3 beats. `no-actor` is
// 7, more than half the loss, and those are sentences like "Gulls circled
// above the awnings" and "Traders set out crates of fish along the wet
// stone". A better scene-plan does not obviously help a beat with no person
// in it; those need a place-and-object vocabulary, which is a different
// piece of work from replacing keyword discovery.
//
// Caveat that belongs next to every number above: staging is `keywords` for
// all 20 beats. This is keyword-only bandwidth. What the Director would add
// is exactly the unmeasured quantity, and the figure is named
// producerPayload rather than payload so it cannot be quoted without it.
//
// FOURTH RUN — compare(), the A/B. NOT A RESULT. valid: false.
//
//   producer      keywords: {keywords:20}   director: {keywords:20}
//   producerPayload   0.70 / 0.70
//   every bucket delta 0
//
// The B arm never reached a model. The AI gateway returns "AI Gateway
// request failed", attachState caught it and fell back to keyword staging,
// and the run completed successfully with every number identical.
//
// Read without the guard, that table says the Director contributes nothing
// to discovery — a strong, quotable, entirely false conclusion produced by
// an outage. `valid` is false because staging never reported `director` for
// a single beat, and the comparison refuses to be a finding.
//
// This is the same failure the session hit repeatedly in another form: an
// instrument agreeing with a hypothesis for a reason unrelated to the
// hypothesis. The A/B is built and its keyword arm is validated. The
// Director arm is blocked on credentials, not on code.
//
// FIFTH RUN — channel diversity, keyword staging.
//
//   entropy 1.95 bits · combinations 4 · dominance 0.29 · base 7
//
//   anchors+interaction        1
//   horizon                    2
//   horizon+objects            2
//   horizon+objects+support    2
//
// This did not say what it was expected to say. The worry entropy was added
// to catch — one combination firing over and over while payload rises — is
// not what is happening. Maximum entropy for four combinations is 2.00 bits
// and the corpus sits at 1.95 with a dominance of 0.29, which is close to
// uniform. Among the beats that express anything, the engine is already
// varied.
//
// The problem is the base: 7 of 20. Not monotony among firing beats, but
// how few fire. That is a different diagnosis from the one entropy was
// meant to test for, and it is the same conclusion producerPayload reached
// by another route — which is worth something, since the two numbers are
// computed from different properties of the same run.
//
// One observation the distribution hands over for free: `horizon` appears
// in 6 of the 7 expressive beats. Time — the newest system, and one of the
// two built in this session — is carrying nearly all of the expressiveness
// in this corpus. Read carefully. It may mean temporal language is common
// in narration, or only that these four stories are full of it.
//
// Base 7 is small and entropy estimates are biased low on small samples.
// The figure travels with its base for that reason.
//
// SIXTH RUN — channel prevalence, keyword staging, base 7.
//
//   channel        beats   share
//   horizon          6      0.86
//   objects          4      0.57
//   support          2      0.29
//   interaction      1      0.14
//   anchors          1      0.14
//   metaphor         0      0.00
//   residue          0      0.00
//
// Entropy could not have found this. It scores how evenly the SIGNATURES
// are spread, and {horizon}, {horizon,objects}, {horizon,objects,support}
// are three distinct combinations with near-maximal entropy and the same
// channel in all three. 1.95 bits and one channel in 86% of expressive
// beats are both true at once. The two numbers are not redundant.
//
// METAPHOR AT 0.00 IS THE FINDING. Not a low share — no beat in the corpus
// carries a metaphor at all, while the reason histogram independently
// reports `intent-only` three times. Stated exactly:
//
//   ON THIS CORPUS, UNDER KEYWORD STAGING, NO BEAT CARRYING A LIVE GOAL
//   PRODUCED A RENDERED METAPHOR.
//
// Not "the intent -> metaphor link is dead", which is what the first draft
// of this note said and is a claim about the engine rather than about the
// run. The measurements localise a SYMPTOM. At least five causes remain
// distinguishable and none is ruled out:
//
//   1 metaphor inference ran and found nothing
//   2 metaphor inference ran and legitimately selected none
//   3 inference produced one and the compositor suppressed it
//   4 the Director was unavailable, and metaphor depends on it
//   5 the corpus contains no situation that crosses the threshold
//
// Cause 5 in particular would make this not a defect at all. Four stories
// chosen to vary temporal and causal language are not a sample designed to
// contain goals.
//
// The cheapest next probe is already in the code and costs no new metric:
// the compositor writes `trace.metaphorSuppressed`, which separates 3 from
// 1 and 2 outright. Left unrun deliberately — chasing it is work on the
// keyword-only path, and that is the path the two remaining experiments
// exist to evaluate rather than optimise. Recorded here so the next person
// starts from a narrowed question instead of rediscovering the symptom.
//
// What makes this worth writing down at all is that neither instrument
// found it alone. 0.00 reads as a channel with nothing to say; three beats
// reads as a small bucket. The pair is what localises anything — which is
// the argument for carrying several cheap metrics over one good one.
//
// SEVENTH RUN — the Director A/B. valid: true. This one is a result.
//
// WHAT THE ARMS ACTUALLY ARE, before any number below is read. The B arm is
// not the Director. 5 of its 20 beats fell back to keyword staging, so the
// comparison is
//
//   keywords   vs   (75% Director + 25% keywords)
//
// not keywords vs Director. purity: keywords 1.00, director 0.75.
// Every delta here is the effect of a MIXTURE.
// The pure-Director effect is probably larger than what is reported —
// a quarter of the B arm is the A arm — but that is an inference, not a
// measurement, and nothing here measures it. `valid` only checks that the
// condition was present at all; it does not check that it was pure, and
// this run is the reason to know the difference.
//
// Model: meta/llama-3.3-70b-instruct via NVIDIA NIM. 384s, no failovers.
//
//                    keywords   director
//   producerPayload     0.70      1.60     +129%
//   expressive base     7/20     14/20
//   efficiency          1.00      1.00     unchanged
//   persistence         0.45      0.68
//   entropy             1.95      1.92     unchanged
//   combinations           4         5
//   dominance           0.29      0.50
//
//   reason           keywords  director  delta
//   no-actor              7        2      -5
//   intent-only           3        1      -2
//   keyword-miss          3        2      -1
//   state-only            0        1      +1
//
//   channel        keywords  director  delta
//   objects           0.57     0.93    +0.36
//   support           0.29     0.79    +0.50
//   horizon           0.86     0.43    -0.43
//   interaction       0.14     0.07    -0.07
//   anchors           0.14     0.07    -0.07
//   metaphor          0.00     0.00     0.00
//   residue           0.00     0.00     0.00
//
// PAYLOAD MORE THAN DOUBLED AND ENTROPY DID NOT MOVE. That was the
// prediction made before the run — payload up, coverage up, entropy flat —
// and it is what happened, to two decimal places.
//
// Stated to match the data: MOST OF THE GAIN CAME FROM FIRING EXISTING
// COMBINATIONS MORE OFTEN RATHER THAN FROM SUBSTANTIALLY EXPANDING THE
// COMBINATION SPACE. Not "without opening combinations keywords could not
// reach", which was the first phrasing here and is contradicted by the
// table one screen up: combinations went 4 -> 5. One did open. The
// supported claim is about proportion, not absence — the base doubled, one
// combination was added, and dominance rose 0.29 -> 0.50, which is what
// concentration looks like.
//
// THE BUCKET THAT SHRANK MOST WAS THE ONE PREDICTED NOT TO. `no-actor` fell
// 7 -> 2, `keyword-miss` only 3 -> 2. The expectation was the reverse: that
// a scene-plan would read existing actors better and leave actorless beats
// alone. It does the opposite here — it finds subjects in prose the pronoun
// test called subjectless, which is why `no-actor` was marked medium
// confidence rather than high. That caveat earned its place.
//
// EFFICIENCY HELD AT 1.00 ACROSS A DOUBLING OF PAYLOAD. Twice the extracted
// information, all of it still reaching pixels. The renderer absorbed the
// increase without a single dropped channel — the strongest evidence yet
// that delivery is not the constraint.
//
// WHAT THE DIRECTOR DOES NOT FIX: metaphor 0.00 and residue 0.00, both
// unchanged. That rules out the producer as the cause — metaphor does not
// fire under either staging, so keyword discovery was not suppressing it
// and the Director does not supply it. Four explanations survive and the
// run separates none of them:
//
//   the scene-plan never emits a metaphor
//   attachState never consumes the one it emits
//   the compositor suppresses it
//   the corpus contains no situation that produces one
//
// Narrower than before by one, and still a symptom rather than a cause.
// trace.metaphorSuppressed remains the cheapest next probe and would
// separate the third from the first two in a single run.
//
// Causality still carries nothing: residue 0.00 in both arms, which is
// consistent with the known cause — it carries objects the causing beats
// do not have — and is not further evidence about it.
//
// horizon FELL 0.86 -> 0.43. Not a regression in Time: the expressive base
// doubled from 7 to 14, and horizon holds 6 beats either way. It was 86% of
// a small set and is 43% of a larger one. A share whose denominator moved.
//
// Caveats beyond the mixture stated at the top: one model, one corpus,
// four stories, a single run with no repeats, and no variance estimate —
// nothing here distinguishes a real +129% from a large one plus noise.
// Llama 3.3 70B is not a frontier model and these numbers will not
// transfer to one.
//
// The supported conclusion, in full:
//
//   On this corpus, with this model, a producer that is three-quarters
//   Director extracts substantially more information than keyword
//   discovery, and the existing renderer delivers all of it.
//
// Everything past that sentence is inference.
//
// residue at 0.00 is the already-known consequence of Causality carrying
// objects the causing beats do not have.
//
// PAYLOAD 0.70 CHANNELS PER BEAT. Not "35% of beats have something" but the
// sharper form: the average beat yields two thirds of one channel. Seven
// channels exist in the engine and a typical sentence lights none of them.
//
// DELIVERED EQUALS PAYLOAD, AND UNUSED IS ZERO. Every channel the producer
// extracted reached pixels. That number is only worth stating because the
// detector was given a negative control: support 'chair' traces drawn:true,
// support 'hammock' — a name with no drawing behind it — traces drawn:false.
// The detector can see a dead channel, so its silence means there was none
// to see.
//
// Stated exactly: NO DORMANCY AMONG THE TRACED CHANNELS ON THIS CORPUS. Not
// "no dormancy", which is what the first draft of this note claimed and what
// the data do not support. Seven channels are traced; anything the engine
// gains later is invisible here until it is added to CHANNELS, and four
// stories are a corpus, not a population. The narrow claim survives a future
// integration change. The broad one would have been quietly falsified by it
// and gone on being quoted.
//
// This is the first battery where the renderer was NOT at fault. Everything
// handed to it was drawn. The loss is entirely upstream — and the two numbers
// separate cleanly: throughput is solved, bandwidth is not.
//
// PERSISTENCE 0.45 OVER A BASE OF 11. Under half of what one beat knows is
// still known by the next. Per-story persistence is not worth quoting:
// `startup` scored 1.00 off a single adjacent pair, which reads as perfect
// continuity and means two consecutive beats both had a horizon. Ratios are
// reported with their denominators now, and null rather than zero when there
// is nothing to divide, because that 1.00 was on its way into a summary.
(() => {
  'use strict';

  // Prose written the way narration actually arrives — not probe sentences.
  // Each story deliberately carries a different mix: some causal, some
  // temporal, some neither, so coverage is a measurement and not a foregone
  // conclusion.
  const STORIES = {
    redundancy: [
      'Marcus had worked at the plant for nineteen years.',
      'On a Tuesday in March the company announced the closure.',
      'As a result he lost the only job he had ever held.',
      'He remembered the morning he first walked through those gates.',
      'There were three months left before the savings ran out.'
    ],
    diagnosis: [
      'The results were due on Thursday.',
      'She waited for the call in an empty waiting room.',
      'The doctor explained the scan in a quiet voice.',
      'Consequently everything she had planned for the year stopped.',
      'She thought back to how easily she used to run.'
    ],
    startup: [
      'They built the first version in a rented garage.',
      'The demo went badly and the investors left early.',
      'So they rewrote the product from nothing.',
      'Eighteen months later the same investors called back.',
      'He would one day tell this story on a stage.'
    ],
    // Control story: no temporal words, no causal markers. Coverage here
    // SHOULD be zero. If it is not, the detectors are firing on prose that
    // contains nothing for them to find.
    plain: [
      'The market opened at six in the morning.',
      'Traders set out crates of fish along the wet stone.',
      'A woman weighed a basket of lemons on a brass scale.',
      'Gulls circled above the awnings.',
      'By noon the stalls were bare.'
    ]
  };

  const wordsFrom = (text) => text.split(/\s+/).map((w, i) => ({
    text: w, start: i * 0.4, end: i * 0.4 + 0.34
  }));

  async function frames(sentences, subject, useDirector) {
    const Sc = window.BlvckScenes, Sy = window.BlvckSync, St = window.BlvckStage;
    const subj = subject || 'Subject';
    const words = wordsFrom(sentences.join(' '));
    const tl = Sy.normalize({ words, duration: words[words.length - 1].end }, 'aligned');
    const scenes = Sc.fromTimeline(tl, { minSec: 0.1 });
    const res = await Sc.attachState(scenes, tl,
      { useDirector: !!useDirector, subject: subj });
    const out = [];
    for (const sc of scenes) {
      const trace = {};
      // visualType stickman is what the product queue routes to compose(),
      // so this is the path the app takes and not a harness-only path.
      const blob = await St.compose(Object.assign({}, sc, {
        subject: sc.sceneSummary, visualType: 'stickman'
      }), { trace });
      const payload = payloadOf(sc, trace);
      out.push({
        blob,
        text: sc.sceneSummary || '',
        horizon: trace.horizon || null,
        residue: (trace.residue || []).slice(),
        causedBy: sc.causedBy || null,
        payload,
        reason: reasonFor(sc, trace, payload, subj),
        confidence: confidenceOf(reasonFor(sc, trace, payload, subj))
      });
    }
    // `staging` labels what produced these scenes. It matters because every
    // number this battery reports is keyword-only discovery unless it says
    // otherwise, and quoting payload without that label overstates how much
    // the engine can find when the Director is reachable.
    return { shots: out, linked: (res && res.linked) || 0,
             staging: (res && res.staging) || 'keywords' };
  }

  // --- information flow ----------------------------------------------------
  //
  // Coverage answered "did this beat get anything". It could not answer why a
  // sequence works, because it counts a beat with one channel the same as a
  // beat with five, and it counts a channel that was inferred the same as one
  // that reached pixels.
  //
  // So every channel is recorded twice: what the producer EXTRACTED, and what
  // the trace shows the renderer DREW. The gap between them is the thing that
  // has gone wrong repeatedly in this codebase — a capability implemented,
  // inferred, carried on the scene, and silently ignored downstream. Coverage
  // cannot see that. This can.
  //
  // The channels are named once here so that adding a system to the engine and
  // forgetting to add it to the instrument is a visible omission rather than a
  // quiet one.
  const CHANNELS = [
    ['objects',     (s) => (s.objects || []).some((o) => o && !o.residue),
                    (t) => !!(t.objects && t.objects.length)],
    ['residue',     (s) => (s.objects || []).some((o) => o && o.residue),
                    (t) => !!(t.residue && t.residue.length)],
    ['interaction', (s) => !!s.interaction,          (t) => !!t.interaction],
    ['support',     (s) => !!(s.support && s.support !== 'ground'),
                    (t) => !!(t.support && t.support.drawn)],
    ['anchors',     (s) => !!(s.anchors && s.anchors.length),
                    (t) => !!(t.anchors && t.anchors.length)],
    ['metaphor',    (s) => !!s.metaphor,             (t) => !!t.metaphor],
    // Horizon is not carried on the scene — it is resolved at draw time from
    // the entity — so extraction and render are read from the same place and
    // this row can only ever report agreement. Kept because leaving it out
    // would understate the payload of a beat that genuinely has one.
    ['horizon',     (s, t) => !!t.horizon,           (t) => !!t.horizon]
  ];

  function payloadOf(scene, trace) {
    const extracted = [], drawn = [], dropped = [];
    CHANNELS.forEach(([name, has, shown]) => {
      if (!has(scene, trace)) return;
      extracted.push(name);
      if (shown(trace)) drawn.push(name); else dropped.push(name);
    });
    return { extracted, drawn, dropped };
  }

  // --- why a beat came back empty ------------------------------------------
  //
  // payload says how much was discovered. It does not say why the rest was
  // not, and every zero looks identical — which is the same asymmetry the
  // renderer had before `unused` and `efficiency` existed, one stage upstream.
  //
  // Four reasons, in priority order, all derived from detectors that already
  // run. None of them adds discovery vocabulary: a reason is metadata about a
  // failure and never reaches the renderer, so being approximate here costs
  // nothing on screen.
  //
  //   state-only    the state engine DID find something — a condition moved —
  //                 but no channel carries it. Discovered and unchannelled,
  //                 which is a missing channel rather than a missing reader.
  //   intent-only   a goal is live at this beat and produced no metaphor.
  //   keyword-miss  a person is present and nothing matched. This is the
  //                 bucket the Director is expected to empty.
  //   no-actor      no person referenced at all — a description or a place.
  //                 Arguably not a failure: some beats are bridges.
  //
  // The person test is pronouns plus the caller's subject name. It will call
  // "Traders set out crates of fish" actorless, which is wrong. Named because
  // the alternative is a list of person-nouns, and a list of person-nouns is
  // the keyword table this whole exercise concluded not to build.
  const PRONOUN = /\b(he|she|they|him|her|them|his|their|hers|theirs)\b/i;

  // Confidence in the DIAGNOSIS, not in the renderer. The rule is structural
  // rather than a table of judgements: a classification resting on positive
  // evidence — state demonstrably moved, a goal is demonstrably live, a
  // pronoun is demonstrably present — is high. One resting on the ABSENCE of
  // evidence is medium, because absence is also what a detector looks like
  // when it is simply not looking hard enough.
  //
  // `no-actor` is the case that matters. It is inferred from finding no
  // pronoun, and the pronoun test misses "Traders set out crates of fish".
  // It is also the bucket a Director might legitimately empty by choosing to
  // personify a scene rather than by finding an actor that was already there.
  // Both are reasons to hold it loosely, and it is currently the largest
  // bucket — so marking it medium keeps the biggest number in the histogram
  // from being read as the firmest.
  const CONFIDENCE = {
    'state-only': 'high',
    'intent-only': 'high',
    'keyword-miss': 'high',
    'no-actor': 'medium'
  };

  function reasonFor(scene, trace, payload, subject) {
    if (payload.extracted.length) return null;
    const S = window.BlvckStoryState;
    const ent = scene.entity;
    const t = scene.time || 0;
    // Probed across the beat's SPAN rather than at the instant it ends.
    // scene.time is the end of the beat, and changeAt tests a point with a
    // 0.4s window, so whether a change was found depended on where in the
    // sentence its keyword happened to fall: "She fell ill that winter" was
    // found and "He lost his job at the plant" was not, though both carry
    // three changes. Half the state-only beats were being reported as
    // keyword misses, which would have pointed the next stretch of work at
    // the wrong stage entirely.
    const dur = Number(scene.duration) || 0;
    if (S && ent) {
      if (S.changeAt && S.changeAt(ent, t - dur / 2, dur / 2 + 0.4)) return 'state-only';
      if (S.goalAt && S.goalAt(ent, t)) return 'intent-only';
    }
    const text = String(scene.sceneSummary || '');
    const named = subject && subject.length > 2
      && text.toLowerCase().indexOf(String(subject).toLowerCase()) > -1;
    return (PRONOUN.test(text) || named) ? 'keyword-miss' : 'no-actor';
  }

  const confidenceOf = (reason) => (reason ? CONFIDENCE[reason] || 'low' : null);

  /**
   * Four numbers over a rendered sequence.
   *
   *   producerPayload  mean channels EXTRACTED per beat, GIVEN the producer
   *              that ran. The semantic bandwidth of the narration as this
   *              engine reads it with that half of discovery switched on.
   *   delivered  mean channels DRAWN per beat. What the viewer could act on.
   *   unused     share of extracted channels that never reached pixels. A
   *              dormancy detector that runs on every channel at once instead
   *              of waiting for someone to notice one is dead.
   *   persistence  share of a beat's channels still present in the next beat.
   *              Low means each frame starts from nothing, which is what makes
   *              a run of beats read as unrelated pictures rather than a scene.
   */
  function flowOf(shots) {
    if (!shots.length) return null;
    let ext = 0, drew = 0, drop = 0;
    shots.forEach((s) => {
      ext += s.payload.extracted.length;
      drew += s.payload.drawn.length;
      drop += s.payload.dropped.length;
    });
    let carried = 0, carriable = 0;
    for (let i = 1; i < shots.length; i++) {
      const prev = shots[i - 1].payload.extracted;
      const here = new Set(shots[i].payload.extracted);
      carriable += prev.length;
      prev.forEach((c) => { if (here.has(c)) carried++; });
    }
    return {
      // NAMED FOR ITS CONDITION. What this measures is payload GIVEN a
      // producer, and the producer has been `keywords` for every run so far.
      // Called plain `payload` it reads as a property of the engine, and I
      // quoted 0.70 that way more than once before noticing the whole figure
      // was conditional on the half of discovery that was switched off.
      producerPayload: +(ext / shots.length).toFixed(2),
      delivered: +(drew / shots.length).toFixed(2),
      // THE INVARIANT, stated rather than carried in someone's head. It reads
      // as redundant today because it is 1.00 and payload already equals
      // delivered. That is the point: the day a new channel is added and
      // routed nowhere, this is the number that moves, and it moves before
      // anyone thinks to go looking. Computed from the counts rather than
      // from the two rounded means, so it cannot drift by rounding alone.
      efficiency: ext ? +(drew / ext).toFixed(2) : null,
      unused: ext ? +(drop / ext).toFixed(2) : null,
      // Reported WITH its denominator, and null rather than 0 when there is
      // nothing to divide. One story scored a persistence of 1.00 off a single
      // adjacent pair, which reads as perfect continuity and means two beats
      // in a row happened to have a horizon. A ratio without its base is not
      // a measurement.
      persistence: carriable ? +(carried / carriable).toFixed(2) : null,
      carriable,
      extracted: ext
    };
  }

  /**
   * Which COMBINATIONS of channels occur, not just how many fire.
   *
   * producerPayload can rise without the engine becoming more expressive. If
   * nine beats in ten come back `objects` and the tenth comes back
   * `objects+objects again`, the mean goes up and the pictures do not get
   * more various. Firing frequency and representational range are different
   * quantities and payload alone cannot tell them apart — which matters
   * precisely at the Director A/B, where the interesting question is whether
   * a better producer opens combinations that keywords never reach or simply
   * hits the same one more often.
   *
   * Computed over NON-EMPTY beats only, and reported with that base. Folding
   * the empty beats in would make entropy a measure of how much was
   * discovered, which producerPayload already reports, and would let a
   * corpus of silence read as low diversity rather than as no data.
   *
   *   entropy       bits over the distribution of channel signatures
   *   combinations  distinct signatures observed
   *   dominance     share held by the most common one
   */
  function diversityOf(shots) {
    const sigs = shots
      .map((s) => s.payload.extracted.slice().sort().join('+'))
      .filter(Boolean);
    if (!sigs.length) {
      return { entropy: null, combinations: 0, dominance: null, base: 0, dist: {} };
    }
    const counts = {};
    sigs.forEach((s) => { counts[s] = (counts[s] || 0) + 1; });
    const keys = Object.keys(counts);
    let h = 0;
    keys.forEach((k) => { const p = counts[k] / sigs.length; h -= p * Math.log2(p); });
    const top = keys.reduce((m, k) => Math.max(m, counts[k]), 0);
    return {
      entropy: +h.toFixed(2),
      combinations: keys.length,
      dominance: +(top / sigs.length).toFixed(2),
      base: sigs.length,
      dist: counts
    };
  }

  /**
   * How often each channel appears among the beats that express anything.
   *
   * Entropy is blind to this by construction. It scores a corpus on how
   * evenly the SIGNATURES are spread, and a set of signatures can be close to
   * uniform while one channel sits inside almost all of them: {horizon},
   * {horizon,objects}, {horizon,objects,support} are three distinct
   * combinations, near-maximal entropy, and the same channel in every one.
   * That is exactly the shape this corpus has, and entropy reported 1.95 bits
   * without noticing.
   *
   * Every channel is listed including the ones that never fire, because a
   * zero is a finding — `metaphor` at 0.00 says the Intent path reached no
   * beat in this corpus, and a table that omitted it would leave that to be
   * discovered by someone reading a distribution and noticing an absence.
   */
  function prevalenceOf(shots) {
    const expressive = shots.filter((s) => s.payload.extracted.length);
    const counts = {};
    CHANNELS.forEach(([name]) => { counts[name] = 0; });
    expressive.forEach((s) => {
      s.payload.extracted.forEach((c) => { counts[c] = (counts[c] || 0) + 1; });
    });
    const channels = {};
    Object.keys(counts).forEach((k) => {
      channels[k] = {
        beats: counts[k],
        share: expressive.length ? +(counts[k] / expressive.length).toFixed(2) : null
      };
    });
    return { base: expressive.length, channels };
  }

  /** Corpus totals, so no ratio is reported off a denominator of two. */
  function totals(report, allShots) {
    let ext = 0, drew = 0, drop = 0, carried = 0, carriable = 0, beats = 0;
    const why = {}, staging = {}, confidence = {};
    report.forEach((r) => {
      const f = r.flow; if (!f) return;
      staging[r.staging] = (staging[r.staging] || 0) + r.beats;
      Object.keys(r.why || {}).forEach((k) => {
        why[k] = (why[k] || 0) + r.why[k];
        const c = confidenceOf(k);
        confidence[c] = (confidence[c] || 0) + r.why[k];
      });
      beats += r.beats;
      ext += f.extracted;
      drew += Math.round(f.delivered * r.beats);
      drop += (f.unused || 0) * f.extracted;
      carriable += f.carriable;
      carried += (f.persistence || 0) * f.carriable;
    });
    return {
      beats,
      producerPayload: beats ? +(ext / beats).toFixed(2) : 0,
      delivered: beats ? +(drew / beats).toFixed(2) : 0,
      efficiency: ext ? +(drew / ext).toFixed(2) : null,
      unused: ext ? +(drop / ext).toFixed(2) : null,
      persistence: carriable ? +(carried / carriable).toFixed(2) : null,
      carriable,
      // Pooled across the corpus rather than averaged from per-story figures.
      // Entropy of an average is not the average of entropies, and four
      // five-beat stories give bases too small to mean anything alone.
      diversity: diversityOf(allShots || []),
      prevalence: prevalenceOf(allShots || []),
      why,
      confidence,
      staging
    };
  }

  async function pixels(blob) {
    const bmp = await createImageBitmap(blob);
    const c = document.createElement('canvas');
    c.width = bmp.width; c.height = bmp.height;
    c.getContext('2d').drawImage(bmp, 0, 0);
    return { d: c.getContext('2d').getImageData(0, 0, bmp.width, bmp.height).data,
             n: bmp.width * bmp.height };
  }

  const diff = (a, b) => {
    let n = 0;
    for (let i = 0; i < a.d.length; i += 4) {
      if (Math.abs(a.d[i] - b.d[i]) + Math.abs(a.d[i + 1] - b.d[i + 1])
        + Math.abs(a.d[i + 2] - b.d[i + 2]) > 24) n++;
    }
    return n / a.n;
  };

  // Deterministic shuffle, so a rerun of the battery compares against the same
  // rearrangement. A random one would make orderEffect drift between runs and
  // there would be no way to tell a code change from a reshuffle.
  function rotate(list) {
    const out = list.slice();
    const first = out.shift();
    out.splice(Math.floor(out.length / 2), 0, first);
    return out;
  }

  async function run(opts) {
    const o = opts || {};
    const names = o.only ? [o.only] : Object.keys(STORIES);
    const report = [];
    const sheets = [];
    const allShots = [];

    for (const name of names) {
      const sents = STORIES[name];
      const ordered = await frames(sents, o.subject, o.useDirector);
      const shuffled = await frames(rotate(sents), o.subject, o.useDirector);

      const ox = []; for (const s of ordered.shots) ox.push(await pixels(s.blob));
      const sx = []; for (const s of shuffled.shots) sx.push(await pixels(s.blob));

      let move = 0;
      for (let i = 1; i < ox.length; i++) move += diff(ox[i - 1], ox[i]);
      move = ox.length > 1 ? move / (ox.length - 1) : 0;

      // Compared BY SENTENCE, not by position. The same sentence rendered in
      // two different neighbourhoods is the only comparison that isolates
      // cross-beat information from the arc, which moves for everyone.
      let sensitive = 0, compared = 0;
      ordered.shots.forEach((shot, i) => {
        const j = shuffled.shots.findIndex((s) => s.text === shot.text);
        if (j < 0) return;
        compared++;
        if (diff(ox[i], sx[j]) > 0.002) sensitive++;
      });

      const annotated = ordered.shots.filter((s) => s.horizon || s.causedBy).length;
      report.push({
        story: name,
        beats: ordered.shots.length,
        coverage: +(annotated / ordered.shots.length).toFixed(2),
        links: ordered.linked,
        movement: +(move * 100).toFixed(2),
        orderEffect: compared ? +(sensitive / compared).toFixed(2) : 0,
        flow: flowOf(ordered.shots),
        diversity: diversityOf(ordered.shots),
        staging: ordered.staging,
        why: ordered.shots.reduce((acc, s) => {
          if (s.reason) acc[s.reason] = (acc[s.reason] || 0) + 1;
          return acc;
        }, {}),
        detail: ordered.shots.map((s) => ({
          t: s.text.slice(0, 30),
          h: s.horizon ? s.horizon.dir + '/' + s.horizon.push : null,
          c: s.causedBy || null,
          r: s.residue.join(',') || null,
          got: s.payload.extracted.join('+') || null,
          lost: s.payload.dropped.join('+') || null,
          why: s.reason
        }))
      });
      sheets.push({ name, shots: ordered.shots });
      allShots.push.apply(allShots, ordered.shots);
    }

    if (o.post !== false) await postSheet(sheets, o.post);
    report.totals = totals(report, allShots);
    return report;
  }

  /** One contact sheet, one row per story, so the run can be looked at. */
  async function postSheet(sheets, url) {
    const CW = 300, CH = 169;
    const cols = Math.max(...sheets.map((s) => s.shots.length));
    const cv = document.createElement('canvas');
    cv.width = CW * cols; cv.height = CH * sheets.length;
    const g = cv.getContext('2d');
    g.fillStyle = '#000'; g.fillRect(0, 0, cv.width, cv.height);
    for (let r = 0; r < sheets.length; r++) {
      const row = sheets[r];
      for (let c = 0; c < row.shots.length; c++) {
        const bmp = await createImageBitmap(row.shots[c].blob);
        g.drawImage(bmp, c * CW, r * CH, CW, CH);
        const s = row.shots[c];
        g.fillStyle = '#0f0'; g.font = 'bold 10px monospace';
        const tag = [s.horizon ? s.horizon.dir : null, s.causedBy ? 'cause' : null]
          .filter(Boolean).join('+');
        g.fillText((c === 0 ? row.name + ' | ' : '') + (tag || '-'), c * CW + 4, r * CH + 12);
      }
    }
    const b64 = cv.toDataURL('image/jpeg', 0.88).split(',')[1];
    return fetch(typeof url === 'string' ? url : 'http://localhost:4599',
      { method: 'POST', body: b64 }).then((r) => r.text());
  }

  /**
   * Prove the invariant can break.
   *
   * `efficiency` reads 1.00 on the corpus, and a ratio that has only ever
   * been 1.00 is indistinguishable from one that is hardcoded. So a channel
   * is deliberately broken — a support named 'hammock', which the producer
   * will happily carry and the renderer has no drawing for — and the ratio
   * must fall. If it does not, every future 1.00 means nothing.
   *
   * The same argument as the negative control on `unused`, applied to the
   * derived number rather than the raw one.
   */
  async function selfTest() {
    const St = window.BlvckStage;
    const base = { index: 0, sceneSummary: 'She sat by the window.',
                   subject: 'She sat by the window.', visualType: 'stickman', time: 1 };
    const shotFor = async (support) => {
      const trace = {};
      const blob = await St.compose(Object.assign({}, base, { support }), { trace });
      return { blob, text: base.sceneSummary,
               payload: payloadOf(Object.assign({}, base, { support }), trace) };
    };
    const good = flowOf([await shotFor('chair')]);
    const bad = flowOf([await shotFor('hammock')]);
    // The reason classifier needs controls for the same reason `unused` did.
    // A classifier that has only ever returned one label is indistinguishable
    // from a constant, and one that labels a beat which HAS payload is
    // reporting on the wrong beats entirely.
    const Sy = window.BlvckSync, Sc = window.BlvckScenes;
    const classify = async (sentence, subject) => {
      const words = wordsFrom(sentence);
      const tl = Sy.normalize({ words, duration: words[words.length - 1].end }, 'aligned');
      const scenes = Sc.fromTimeline(tl, { minSec: 0.1 });
      await Sc.attachState(scenes, tl, { useDirector: false, subject: subject || 'Subject' });
      const sc = scenes[0], trace = {};
      await St.compose(Object.assign({}, sc, {
        subject: sc.sceneSummary, visualType: 'stickman' }), { trace });
      const p = payloadOf(sc, trace);
      return { reason: reasonFor(sc, trace, p, subject || 'Subject'),
               payload: p.extracted.length };
    };
    const cases = {
      // Has a channel — must not be given a reason at all.
      hasPayload: await classify('She sat at the desk and typed the report.'),
      // Nothing physical, but the state engine moves — discovered, unchannelled.
      // Two sentences, because the first draft used "He was devastated by the
      // news", which moves NO state at all — the word is not in the cue
      // vocabulary — so the control was testing the classifier against a beat
      // that genuinely had nothing. A control has to be verified to contain
      // the thing it is controlling for.
      stateOnly: await classify('She fell ill that winter.'),
      stateOnlyLate: await classify('He lost his job at the plant.'),
      // A person is present and nothing matched.
      keywordMiss: await classify('He considered the matter at length.'),
      // No person referenced at all.
      noActor: await classify('Gulls circled above the awnings.')
    };
    // Entropy is the one number here with a closed-form answer, so it is
    // checked against arithmetic rather than against a rendered frame. All
    // one signature is 0 bits; four equally likely signatures is exactly 2.
    // A diversity metric that cannot distinguish those two cases would make
    // the Director A/B unreadable in exactly the situation it exists for.
    const fake = (sigs) => sigs.map((s) => ({ payload: { extracted: s } }));
    const flat = diversityOf(fake([['objects'], ['objects'], ['objects'], ['objects']]));
    const wide = diversityOf(fake([['objects'], ['support'], ['horizon'], ['metaphor']]));
    // Order must not matter — a signature is a set, not a sequence.
    const perm = diversityOf(fake([['objects', 'support'], ['support', 'objects']]));
    // Prevalence against the case entropy cannot see: three distinct
    // signatures, near-uniform, one channel present in all of them. Entropy
    // must read high and prevalence must read 1.00 for that channel, or the
    // pair is not telling us two different things.
    const shared = fake([['horizon'], ['horizon', 'objects'], ['horizon', 'support']]);
    const pv = prevalenceOf(shared);
    const prevalencePass = pv.base === 3
      && pv.channels.horizon.share === 1
      && pv.channels.objects.share === 0.33
      && pv.channels.metaphor.share === 0
      && diversityOf(shared).entropy > 1.5
      && prevalenceOf(fake([[], []])).base === 0;

    // Purity against the exact case that slipped through: a valid run that
    // is three-quarters its intended condition must not report 1.00.
    const purityPass = purityOf({ director: 15, keywords: 5 }, 'director') === 0.75
      && purityOf({ keywords: 20 }, 'keywords') === 1
      && purityOf({ keywords: 20 }, 'director') === 0
      && purityOf({}, 'director') === null;

    const entropyPass = flat.entropy === 0 && flat.combinations === 1 && flat.dominance === 1
      && wide.entropy === 2 && wide.combinations === 4 && wide.dominance === 0.25
      && perm.combinations === 1
      && diversityOf(fake([[], []])).entropy === null;

    const reasonsPass = cases.hasPayload.reason === null
      && cases.stateOnly.reason === 'state-only'
      && cases.stateOnlyLate.reason === 'state-only'
      && cases.keywordMiss.reason === 'keyword-miss'
      && cases.noActor.reason === 'no-actor';

    return {
      drawable: { efficiency: good.efficiency, unused: good.unused },
      undrawable: { efficiency: bad.efficiency, unused: bad.unused },
      reasons: cases,
      entropy: { flat, wide, permutationCollapses: perm.combinations === 1 },
      prevalence: { sharedChannel: pv, entropyOfSame: diversityOf(shared).entropy },
      // All must hold, or none of these numbers is load-bearing.
      pass: good.efficiency === 1 && bad.efficiency === 0
        && good.unused === 0 && bad.unused === 1
        && reasonsPass && entropyPass && prevalencePass && purityPass
    };
  }

  /**
   * A/B the two producers over the same corpus, same renderer, same metrics.
   *
   * The comparison that matters is NOT producerPayload_B > producerPayload_A.
   * A larger number says migration helped without saying what it helped, and
   * the buckets correspond to different hypotheses:
   *
   *   keyword-miss shrinks, no-actor holds   the Director reads existing
   *                                          actors better but does not
   *                                          invent subjects where none exist
   *   both shrink                            it also does environmental
   *                                          storytelling
   *   neither shrinks                        discovery is not the producer's
   *                                          fault and the channels are the
   *                                          limit
   *
   * Each outcome points at different work, which is why the histogram is the
   * result and payload is a summary of it.
   *
   * COSTS API CALLS — the Director is a model. Nothing here calls it unless
   * this function is invoked deliberately.
   */
  /**
   * How COMPLETELY a condition occurred, which is not whether it occurred.
   *
   * Two orthogonal checks, and the difference is a run that was reported
   * wrong rather than a run that was fabricated:
   *
   *   validity  did the condition occur at all — catches a FALSE experiment
   *   purity    what share of beats it actually staged — catches a
   *             MISDESCRIBED one
   *
   * The Director A/B was valid and 0.75 pure. Nothing failed, nothing was
   * caught, and the write-up called it "keywords vs Director" when it was
   * keywords vs three-quarters Director. `valid` had already gone green, so
   * there was no prompt to look closer. A number that has to be printed is.
   */
  function purityOf(staging, expected) {
    const total = Object.keys(staging || {})
      .reduce((n, k) => n + staging[k], 0);
    if (!total) return null;
    return +((staging[expected] || 0) / total).toFixed(2);
  }

  async function compare(opts) {
    const o = opts || {};
    const A = await run(Object.assign({}, o, { useDirector: false, post: false }));
    const B = await run(Object.assign({}, o, { useDirector: true, post: false }));
    const buckets = new Set([...Object.keys(A.totals.why), ...Object.keys(B.totals.why)]);
    const why = {};
    buckets.forEach((k) => {
      const a = A.totals.why[k] || 0, b = B.totals.why[k] || 0;
      why[k] = { keywords: a, director: b, delta: b - a, confidence: confidenceOf(k) };
    });
    return {
      producer: { keywords: A.totals.staging, director: B.totals.staging },
      producerPayload: { keywords: A.totals.producerPayload,
                         director: B.totals.producerPayload },
      efficiency: { keywords: A.totals.efficiency, director: B.totals.efficiency },
      persistence: { keywords: A.totals.persistence, director: B.totals.persistence },
      // Payload and entropy answer different questions and the pair is the
      // point. Payload up with entropy flat means the same combinations
      // firing more often; payload up with entropy up means combinations
      // keywords could not reach.
      diversity: { keywords: A.totals.diversity, director: B.totals.diversity },
      // Per channel, so the A/B can answer WHAT the Director adds rather than
      // whether it is better. A producer that lifts payload entirely through
      // one channel and one that spreads the gain across six are different
      // outcomes pointing at different next steps, and every other number
      // here reports them identically.
      prevalence: (() => {
        const out = {};
        const names = new Set([...Object.keys(A.totals.prevalence.channels),
                               ...Object.keys(B.totals.prevalence.channels)]);
        names.forEach((n) => {
          const a = (A.totals.prevalence.channels[n] || {}).share;
          const b = (B.totals.prevalence.channels[n] || {}).share;
          out[n] = { keywords: a, director: b,
                     delta: (a == null || b == null) ? null : +(b - a).toFixed(2) };
        });
        return { base: { keywords: A.totals.prevalence.base,
                         director: B.totals.prevalence.base }, channels: out };
      })(),
      why,
      // Guards against the result that looks like a win and is not one: if
      // staging never says `director`, the B arm silently fell back to
      // keywords and every difference below is noise.
      valid: !!(B.totals.staging && B.totals.staging.director),
      // Printed whether or not it is 1.00, so a summary cannot be written
      // without it having been on screen.
      purity: { keywords: purityOf(A.totals.staging, 'keywords'),
                director: purityOf(B.totals.staging, 'director') }
    };
  }

  window.BlvckSeqBattery = { run, compare, selfTest, STORIES };
})();
