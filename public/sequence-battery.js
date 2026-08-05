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
//   story        payload  delivered  unused  persistence (base)
//   redundancy     0.60     0.60      0.00     0.00  (3)
//   diagnosis      1.40     1.40      0.00     0.50  (6)
//   startup        0.80     0.80      0.00     1.00  (2)
//   plain          0.00     0.00       —        —    (0)
//   ------------------------------------------------------------
//   corpus         0.70     0.70      0.00     0.45  (11)
//
// PAYLOAD 0.70 CHANNELS PER BEAT. Not "35% of beats have something" but the
// sharper form: the average beat yields two thirds of one channel. Seven
// channels exist in the engine and a typical sentence lights none of them.
//
// DELIVERED EQUALS PAYLOAD, AND UNUSED IS ZERO. Every channel the producer
// extracted reached pixels — no dormancy anywhere in the corpus. That number
// is only worth stating because the detector was given a negative control:
// support 'chair' traces drawn:true, support 'hammock' — a name with no
// drawing behind it — traces drawn:false. The detector can see a dead
// channel, so its silence means there was none to see.
//
// This is the first battery where the renderer was NOT at fault. Everything
// handed to it was drawn. The loss is entirely upstream.
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

  async function frames(sentences) {
    const Sc = window.BlvckScenes, Sy = window.BlvckSync, St = window.BlvckStage;
    const words = wordsFrom(sentences.join(' '));
    const tl = Sy.normalize({ words, duration: words[words.length - 1].end }, 'aligned');
    const scenes = Sc.fromTimeline(tl, { minSec: 0.1 });
    const res = await Sc.attachState(scenes, tl, { useDirector: false, subject: 'Subject' });
    const out = [];
    for (const sc of scenes) {
      const trace = {};
      // visualType stickman is what the product queue routes to compose(),
      // so this is the path the app takes and not a harness-only path.
      const blob = await St.compose(Object.assign({}, sc, {
        subject: sc.sceneSummary, visualType: 'stickman'
      }), { trace });
      out.push({
        blob,
        text: sc.sceneSummary || '',
        horizon: trace.horizon || null,
        residue: (trace.residue || []).slice(),
        causedBy: sc.causedBy || null,
        payload: payloadOf(sc, trace)
      });
    }
    return { shots: out, linked: (res && res.linked) || 0 };
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

  /**
   * Four numbers over a rendered sequence.
   *
   *   payload    mean channels EXTRACTED per beat. The semantic bandwidth of
   *              the narration as this engine reads it.
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
      payload: +(ext / shots.length).toFixed(2),
      delivered: +(drew / shots.length).toFixed(2),
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
    report.forEach((r) => {
      const f = r.flow; if (!f) return;
      beats += r.beats;
      ext += f.extracted;
      drew += f.delivered * r.beats;
      drop += (f.unused || 0) * f.extracted;
      carriable += f.carriable;
      carried += (f.persistence || 0) * f.carriable;
    });
    return {
      beats,
      payload: beats ? +(ext / beats).toFixed(2) : 0,
      delivered: beats ? +(drew / beats).toFixed(2) : 0,
      unused: ext ? +(drop / ext).toFixed(2) : null,
      persistence: carriable ? +(carried / carriable).toFixed(2) : null,
      carriable
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
      const ordered = await frames(sents);
      const shuffled = await frames(rotate(sents));

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
        detail: ordered.shots.map((s) => ({
          t: s.text.slice(0, 30),
          h: s.horizon ? s.horizon.dir + '/' + s.horizon.push : null,
          c: s.causedBy || null,
          r: s.residue.join(',') || null,
          got: s.payload.extracted.join('+') || null,
          lost: s.payload.dropped.join('+') || null
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

  window.BlvckSeqBattery = { run, STORIES };
})();
