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

  /** Corpus totals, so no ratio is reported off a denominator of two. */
  function totals(report) {
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
    }

    if (o.post !== false) await postSheet(sheets, o.post);
    report.totals = totals(report);
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
    const reasonsPass = cases.hasPayload.reason === null
      && cases.stateOnly.reason === 'state-only'
      && cases.stateOnlyLate.reason === 'state-only'
      && cases.keywordMiss.reason === 'keyword-miss'
      && cases.noActor.reason === 'no-actor';

    return {
      drawable: { efficiency: good.efficiency, unused: good.unused },
      undrawable: { efficiency: bad.efficiency, unused: bad.unused },
      reasons: cases,
      // All must hold, or none of these numbers is load-bearing.
      pass: good.efficiency === 1 && bad.efficiency === 0
        && good.unused === 0 && bad.unused === 1 && reasonsPass
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
      why,
      // Guards against the result that looks like a win and is not one: if
      // staging never says `director`, the B arm silently fell back to
      // keywords and every difference below is noise.
      valid: !!(B.totals.staging && B.totals.staging.director)
    };
  }

  window.BlvckSeqBattery = { run, compare, selfTest, STORIES };
})();
