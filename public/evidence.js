// Evidence — findings recorded by experiments, queried by audits.
//
// Built because the audit's provenance was fiction. It reported
//
//   evidence: ['renderer', 'audit', 'support-ontology']   3 signals
//
// and nothing in the code had verified any of that. I typed those three
// strings because I remembered the three findings happening. A signal count
// the author recalls is a weaker thing than one the system counted, and the
// format made it look like provenance was being tracked when it was really
// recording my memory of a conversation.
//
// So findings become records. An experiment emits one when it observes
// something; the audit queries the store instead of listing what it was told.
// "Three independent signals" becomes checkable.
//
// WHAT THIS DOES NOT FIX. The records seeded below describe experiments that
// genuinely ran in this project, but they were entered by hand afterwards, so
// they carry `entered: 'retrospective'`. Only records emitted by an experiment
// at the moment it observes something carry `entered: 'live'`. The audit
// reports the split, because a retrospective record is still my recollection
// wearing a better format.
(() => {
  'use strict';

  const RECORDS = [];
  let nextId = 1;

  /**
   * Record a finding.
   *
   * `source` is the instrument or process that observed it — and independence
   * is counted by distinct sources, so calling this twice from the same
   * instrument does not manufacture a second signal.
   */
  function record(spec) {
    const s = spec || {};
    const rec = {
      id: 'ev-' + String(nextId++).padStart(4, '0'),
      source: String(s.source || 'unknown'),
      finding: String(s.finding || ''),
      subject: String(s.subject || ''),      // pattern, channel, or system
      topic: String(s.topic || ''),          // what is missing or wrong
      at: s.at || Date.now(),
      entered: s.entered === 'live' ? 'live' : 'retrospective',
      detail: s.detail || null
    };
    RECORDS.push(rec);
    return rec;
  }

  /** Every record touching a subject, optionally narrowed to one topic. */
  function find(subject, topic) {
    return RECORDS.filter((r) =>
      (!subject || r.subject === subject) && (!topic || r.topic === topic));
  }

  /**
   * How many INDEPENDENT signals support a claim.
   *
   * Independence is by distinct source. Three records from the channel metric
   * are one signal, not three — that distinction is the whole reason for
   * counting rather than listing.
   */
  function signals(subject, topic) {
    const rs = find(subject, topic);
    const sources = [...new Set(rs.map((r) => r.source))];
    const live = rs.filter((r) => r.entered === 'live').length;
    return {
      count: sources.length,
      sources,
      records: rs.length,
      live,
      retrospective: rs.length - live
    };
  }

  // --- seeded from experiments that actually ran -------------------------
  //
  // Entered by hand, and marked as such. The mechanism is what is new here;
  // these particular rows are still recollection.

  record({ source: 'render-battery', subject: 'propose', topic: 'kneel',
    finding: '25-scene battery: proposal did not read; figure lower but not kneeling',
    entered: 'retrospective' });
  record({ source: 'pose-space', subject: 'propose', topic: 'kneel',
    finding: 'pose space cannot express ground relationship; same class as sit',
    entered: 'retrospective' });
  record({ source: 'channel-metric', subject: 'propose', topic: 'kneel',
    finding: 'declared support kneel is outside the support vocabulary',
    entered: 'retrospective' });

  record({ source: 'render-battery', subject: 'across_desk', topic: 'desk',
    finding: 'interview beat rendered with no surface between the figures',
    entered: 'retrospective' });
  record({ source: 'channel-metric', subject: 'across_desk', topic: 'desk',
    finding: 'weakest pattern: 2 channels from three separate neighbours',
    entered: 'retrospective' });

  record({ source: 'render-battery', subject: 'address', topic: 'podium',
    finding: 'on-stage and trophy beats rendered as an undifferentiated row',
    entered: 'retrospective' });

  record({ source: 'channel-metric', subject: 'confront', topic: 'reachY',
    finding: 'confront and embrace separated by only two channels',
    entered: 'retrospective' });

  // --- predictions ---------------------------------------------------------
  //
  // Evidence records what happened. Predictions record what was EXPECTED to
  // happen, before the change is made — which is the only way to find out
  // whether the recommendations are any good.
  //
  // The distinction that makes this worth having: a prediction filed after the
  // result is known is not a prediction. So `settle()` refuses to score
  // anything that was not written down first, and the record keeps both
  // timestamps so the gap is visible.
  const PREDICTIONS = [];

  function predict(spec) {
    const s = spec || {};
    const p = {
      id: 'pred-' + String(PREDICTIONS.length + 1).padStart(3, '0'),
      change: String(s.change || ''),
      subject: String(s.subject || ''),
      expected: String(s.expected || ''),
      metric: String(s.metric || ''),
      baseline: s.baseline == null ? null : s.baseline,
      target: s.target == null ? null : s.target,
      author: String(s.author || 'audit'),
      madeAt: Date.now(),
      settled: null
    };
    PREDICTIONS.push(p);
    return p;
  }

  // A prediction has to be at risk to be worth anything, and the first one
  // filed here was not. The baseline had been measured AFTER the change was
  // loaded, so "before" and "after" were the same number, the prediction was
  // held for 93 milliseconds, and the scorecard reported 100%.
  //
  // Writing it down first is necessary and not sufficient. So settle() now
  // also refuses anything held for less than this — long enough that the
  // change had to be made in between rather than alongside.
  const MIN_HELD_MS = 30 * 1000;

  /** Score a prediction against what actually happened. */
  function settle(id, actual, note) {
    const p = PREDICTIONS.find((x) => x.id === id);
    if (!p) return { error: 'no such prediction: ' + id };
    if (p.settled) return { error: 'already settled' };
    const held = Date.now() - p.madeAt;
    if (held < MIN_HELD_MS) {
      p.settled = { actual, correct: null, void: true,
        note: 'VOID — held ' + held + 'ms; baseline was probably measured after the change',
        at: Date.now(), heldFor: held };
      return p;
    }
    const hit = p.target != null && actual != null
      ? (p.target >= p.baseline ? actual >= p.target : actual <= p.target)
      : null;
    p.settled = {
      actual, correct: hit, note: note || '',
      at: Date.now(), heldFor: Date.now() - p.madeAt
    };
    return p;
  }

  /** How good the recommendations have been, over time. */
  function scorecard() {
    const settledAll = PREDICTIONS.filter((p) => p.settled);
    const voided = settledAll.filter((p) => p.settled.void);
    const scored = settledAll.filter((p) => !p.settled.void);
    const right = scored.filter((p) => p.settled.correct === true).length;
    return {
      made: PREDICTIONS.length,
      scored: scored.length,
      voided: voided.length,          // reported, never silently dropped
      correct: right,
      rate: scored.length ? Math.round((right / scored.length) * 100) + '%' : 'n/a',
      open: PREDICTIONS.filter((p) => !p.settled).map((p) => p.id + ': ' + p.change)
    };
  }

  window.BlvckEvidence = {
    record, find, signals, predict, settle, scorecard,
    all: () => RECORDS.slice(),
    predictions: () => PREDICTIONS.slice(),
    sources: () => [...new Set(RECORDS.map((r) => r.source))],
    count: () => RECORDS.length
  };
})();
