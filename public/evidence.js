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

  window.BlvckEvidence = {
    record, find, signals,
    all: () => RECORDS.slice(),
    sources: () => [...new Set(RECORDS.map((r) => r.source))],
    count: () => RECORDS.length
  };
})();
