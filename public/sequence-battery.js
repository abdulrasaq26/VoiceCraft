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
        causedBy: sc.causedBy || null
      });
    }
    return { shots: out, linked: (res && res.linked) || 0 };
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
        detail: ordered.shots.map((s) => ({
          t: s.text.slice(0, 30),
          h: s.horizon ? s.horizon.dir + '/' + s.horizon.push : null,
          c: s.causedBy || null,
          r: s.residue.join(',') || null
        }))
      });
      sheets.push({ name, shots: ordered.shots });
    }

    if (o.post !== false) await postSheet(sheets, o.post);
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
