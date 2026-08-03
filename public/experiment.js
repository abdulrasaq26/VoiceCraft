// Experiments — baselines the author cannot contaminate.
//
// The prediction store failed on its first use in a way worth encoding. It
// asked the caller for a baseline number, and I supplied one measured AFTER
// loading the change. `before` and `after` were therefore the same value, the
// prediction was held for 93ms, and the scorecard reported 100% correct.
//
// The first fix was a minimum hold time, which is a proxy: it catches the
// mistake I happened to make and a patient version of the same error walks
// straight past it. This is the structural version.
//
// TWO THINGS THE CALLER NO LONGER SUPPLIES.
//
//   the baseline   begin() calls the measure function ITSELF and freezes the
//                  result. There is no number to pass in and therefore none to
//                  pass in wrongly.
//   the delta      end() calls the same function again and computes the
//                  difference. The caller never reports its own result.
//
// AND ONE STRUCTURAL CHECK. begin() fingerprints the code under test; end()
// fingerprints it again. If the fingerprint is unchanged, the change was
// either never made or was already loaded when the baseline was taken — which
// is exactly the failure above. The experiment voids itself, and no discipline
// on the author's part was required to catch it.
//
// Records are append-only. Baseline, hypothesis and timestamps are frozen at
// begin(); everything afterwards is added, never edited.
(() => {
  'use strict';

  const LOG = [];
  let seq = 0;

  const MIN_HELD_MS = 30 * 1000;

  /** Cheap stable hash of a string. */
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return (h >>> 0).toString(16);
  }

  /**
   * Fingerprint the code under test.
   *
   * Function source is the only thing available to a page that reloads modules
   * by appending script tags — but it is enough: a changed clip table, a
   * changed threshold or a changed vocabulary all alter the text.
   */
  function fingerprintOf(targets) {
    const parts = (targets || []).map((t) => {
      try {
        const v = typeof t === 'function' ? t() : t;
        return typeof v === 'function' ? v.toString() : JSON.stringify(v);
      } catch (err) {
        return 'ERR';
      }
    });
    return hash(parts.join('|'));
  }

  /**
   * Open an experiment. Nothing about it can be edited afterwards.
   *
   * `measure` runs now and again at end(); `watch` is the code whose change is
   * the point of the experiment.
   */
  function begin(spec) {
    const s = spec || {};
    if (typeof s.measure !== 'function') {
      throw new Error('experiment needs a measure() — a number it can take itself');
    }
    const id = 'exp-' + String(++seq).padStart(4, '0');
    const frozen = Object.freeze({
      id,
      change: String(s.change || ''),
      hypothesis: String(s.hypothesis || ''),
      direction: s.direction === 'down' ? 'down' : 'up',
      baseline: s.measure(),
      fingerprint: fingerprintOf(s.watch),
      openedAt: Date.now()
    });
    const rec = { spec: frozen, measure: s.measure, watch: s.watch || [], appended: [], closed: null };
    LOG.push(rec);
    return id;
  }

  /** Append a note to a running experiment. Never edits what is frozen. */
  function append(id, entry) {
    const rec = LOG.find((r) => r.spec.id === id);
    if (!rec) return { error: 'no such experiment' };
    if (rec.closed) return { error: 'closed' };
    rec.appended.push(Object.freeze({ at: Date.now(), entry }));
    return { ok: true, appended: rec.appended.length };
  }

  /**
   * Close it. The experiment measures and judges — the caller does neither.
   */
  function end(id) {
    const rec = LOG.find((r) => r.spec.id === id);
    if (!rec) return { error: 'no such experiment' };
    if (rec.closed) return rec.closed;

    const held = Date.now() - rec.spec.openedAt;
    const after = rec.measure();
    const nowPrint = fingerprintOf(rec.watch);

    let voided = null;
    if (nowPrint === rec.spec.fingerprint) {
      // The decisive check. Identical code means either nothing was changed,
      // or the change was already present when the baseline was taken.
      voided = 'code under test is unchanged — baseline may have been taken after the change';
    } else if (held < MIN_HELD_MS) {
      voided = 'held only ' + held + 'ms';
    }

    const delta = (typeof after === 'number' && typeof rec.spec.baseline === 'number')
      ? Math.round((after - rec.spec.baseline) * 1000) / 1000 : null;
    const improved = delta == null ? null
      : (rec.spec.direction === 'up' ? delta > 0 : delta < 0);

    rec.closed = Object.freeze({
      id, baseline: rec.spec.baseline, after, delta,
      supported: voided ? null : improved,
      void: voided, heldFor: held,
      fingerprintBefore: rec.spec.fingerprint, fingerprintAfter: nowPrint,
      notes: rec.appended.length, closedAt: Date.now()
    });
    return rec.closed;
  }

  function scorecard() {
    const closed = LOG.filter((r) => r.closed).map((r) => r.closed);
    const valid = closed.filter((c) => !c.void);
    const supported = valid.filter((c) => c.supported === true).length;
    return {
      run: LOG.length,
      valid: valid.length,
      voided: closed.length - valid.length,
      hypothesesSupported: supported,
      rate: valid.length ? Math.round((supported / valid.length) * 100) + '%' : 'n/a',
      open: LOG.filter((r) => !r.closed).map((r) => r.spec.id + ': ' + r.spec.change)
    };
  }

  window.BlvckExperiment = {
    begin, end, append, scorecard,
    log: () => LOG.map((r) => ({ spec: r.spec, closed: r.closed, notes: r.appended.length }))
  };
})();
