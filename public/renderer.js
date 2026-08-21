// The Renderer's decision layer: what should go ON the footage, and why.
//
// Storyboard has already decided what the viewer sees and acquired it. This
// looks at the clip that was actually chosen - including what a vision model
// says is visible in it - and decides whether anything should be added on top.
//
// The honest answer is often nothing. A scene whose footage already carries the
// narration needs no card, and a card added anyway is clutter that costs the
// viewer attention for no information.
//
// THREE BOUNDARIES, ENFORCED RATHER THAN DESCRIBED
//
// 1. It decides WHAT, never WHEN. An element names the spoken phrase it belongs
//    to; Timing.anchorOverlay turns that into start and end from the measured
//    narration. Any start/end the model volunteers is stripped by the parser,
//    because a second place that invents timing is exactly how a pipeline ends
//    up with two clocks that disagree.
//
// 2. It may only ask for what the compositor can actually draw. The per-frame
//    panel kinds are the synchronous drawers; a map is not among them, because
//    renderMap awaits geography data and a render loop cannot await. So the
//    prompt does not offer maps and the parser rejects them. A capability the
//    Director can name but the renderer cannot execute produces an element that
//    silently never appears, which is worse than not offering it.
//
// 3. It can never block production. Provider down, timeout, malformed JSON,
//    unparseable shape - every one of them resolves to "no elements needed",
//    logged, and the storyboard proceeds. The Renderer is additive; a beat with
//    no card is a normal beat, and an outage must not turn it into a failure.
(() => {
  'use strict';

  // What the per-frame compositor can actually execute. Kept in step with
  // BlvckGraphic.PANEL_KINDS and the editor's OVERLAY_KIND map by the test
  // beside this file, so the three cannot drift apart quietly.
  const PANEL_KINDS = ['stat', 'chart', 'timeline', 'checklist'];
  const TEXT_KINDS  = ['stat_overlay', 'quote', 'headline', 'label', 'emphasis'];
  const SUPPORTED = PANEL_KINDS.concat(TEXT_KINDS);

  // A data card with no data is refused downstream by BlvckGraphic; refusing it
  // here too means the reason arrives while there is still someone to tell.
  const NEEDS_ITEMS = ['chart', 'timeline', 'checklist'];

  const PLACEMENTS = ['lower_third', 'lower_right', 'lower_left',
                      'upper_right', 'upper_left', 'center'];

  const DECISION_TIMEOUT_MS = 60000;
  const MAX_ELEMENTS = 3;

  const str = (v) => String(v == null ? '' : v).trim();

  // ── The brief ─────────────────────────────────────────────────────────────

  function decisionPrompt({ narration, intent, mediaDescription, mediaSays } = {}) {
    const NL = String.fromCharCode(10);
    return [
      'You are the editor of a documentary, deciding what to put ON a shot that',
      'has already been chosen and cut. You are not choosing the footage.',
      '',
      'THE NARRATOR SAYS: "' + str(narration) + '"',
      '',
      'THE SHOT THAT WAS CHOSEN: ' + (str(intent) || '(no intent recorded)'),
      'WHAT IS VISIBLE IN IT: ' + (str(mediaDescription) || '(not inspected)'),
      'WHAT THE LIBRARY CALLS IT: ' + (str(mediaSays) || '(nothing)'),
      '',
      'Decide whether adding a graphic would materially help the viewer',
      'understand this sentence. Most shots need nothing. Add something only',
      'when the narration carries information the picture does not:',
      '  a figure the footage cannot show     -> stat',
      '  a trend or comparison between values -> chart',
      '  dated events in sequence             -> timeline',
      '  a set of named steps or parts        -> checklist',
      '  a line worth reading as text         -> quote, headline or label',
      '',
      'Say no when the footage already carries the meaning. A card that repeats',
      'what the viewer can already see is clutter, and clutter costs attention.',
      '',
      'ANCHOR each element to the words it belongs to - the exact phrase from',
      'the narration above, copied verbatim. Do NOT give times: the anchor is',
      'matched against the measured recording, which knows when those words were',
      'actually spoken.',
      '',
      'Reply with ONLY this JSON:',
      '{"needed":true,"reason":"<one sentence>","elements":[',
      ' {"kind":"stat","content":"40%","label":"switch brands because of price",',
      '  "anchor":"forty percent","placement":"lower_right"}]}',
      '',
      'or, when nothing is warranted:',
      '{"needed":false,"reason":"<why the footage is already enough>","elements":[]}',
      '',
      'kind must be one of: ' + SUPPORTED.join(', ') + '.',
      'chart, timeline and checklist must also carry "items": a list of short',
      'strings holding the actual content to typeset.',
      'placement must be one of: ' + PLACEMENTS.join(', ') + '.',
      'At most ' + MAX_ELEMENTS + ' elements, in the order they should be layered.'
    ].join(NL);
  }

  // ── The parser, which is where the contract is actually kept ─────────────

  /**
   * Read a decision, refusing anything the renderer could not execute.
   *
   * Returns a safe no-op rather than throwing: every caller is in a pipeline
   * that must survive a bad answer.
   */
  function parseDecision(text) {
    const raw = str(text);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return { needed: false, reason: 'the Director did not answer in JSON', elements: [], rejected: [] };

    let obj = null;
    try { obj = JSON.parse(m[0]); } catch (e) {
      return { needed: false, reason: 'the Director\'s JSON did not parse', elements: [], rejected: [] };
    }
    if (!obj || typeof obj !== 'object') {
      return { needed: false, reason: 'the Director answered with no decision', elements: [], rejected: [] };
    }

    const reason = str(obj.reason);
    if (obj.needed !== true) {
      return { needed: false, reason: reason || 'no graphic was judged necessary', elements: [], rejected: [] };
    }

    const rejected = [];
    const elements = [];
    for (const row of (Array.isArray(obj.elements) ? obj.elements : [])) {
      if (elements.length >= MAX_ELEMENTS) {
        rejected.push({ why: 'beyond the element limit', row });
        continue;
      }
      const kind = str(row && row.kind).toLowerCase();
      if (SUPPORTED.indexOf(kind) < 0) {
        // Named loudly. A map is the one people will reach for, and it has no
        // synchronous drawer, so it must be visibly refused rather than dropped.
        rejected.push({ why: 'unsupported kind "' + (kind || '(none)') + '"', row });
        continue;
      }
      const items = Array.isArray(row.items)
        ? row.items.map(str).filter(Boolean).slice(0, 7) : [];
      if (NEEDS_ITEMS.indexOf(kind) >= 0 && !items.length) {
        rejected.push({ why: 'a ' + kind + ' with no items cannot be drawn', row });
        continue;
      }
      const content = str(row.content);
      const label = str(row.label);
      if (!content && !label && !items.length) {
        rejected.push({ why: 'nothing to show', row });
        continue;
      }
      const placement = PLACEMENTS.indexOf(str(row.placement).toLowerCase()) >= 0
        ? str(row.placement).toLowerCase() : 'lower_right';

      elements.push({
        kind, content, label, items, placement,
        // The phrase this belongs to. Timing is decided downstream from the
        // measured recording; anything the model said about start or end is
        // deliberately absent from this object.
        anchor: str(row.anchor) || label || content,
        animation: str(row.animation) || 'none',
        enabled: true
      });
    }

    if (!elements.length) {
      return { needed: false,
               reason: reason || 'nothing the Director asked for could be drawn',
               elements: [], rejected };
    }
    return { needed: true, reason: reason || 'the footage does not carry this on its own',
             elements, rejected };
  }

  // ── Timing, which is somebody else's job ─────────────────────────────────

  /**
   * Turn anchors into windows using the measured narration.
   *
   * Timing.anchorOverlay is the authority and the only thing consulted. An
   * element whose phrase was never spoken falls back to the shot's own window,
   * which is the same rule overlayForShot already follows.
   */
  function applyTiming(elements, shot, transcript) {
    const T = window.Timing;
    const out = [];
    for (const el of (elements || [])) {
      let win = null;
      if (T && T.anchorOverlay && transcript) {
        try { win = T.anchorOverlay(transcript, el.anchor, { shot }); } catch (e) { win = null; }
      }
      if (!win) {
        const s = Number(shot && shot.timelineStart);
        const e = Number(shot && shot.timelineEnd);
        if (!Number.isFinite(s) || !Number.isFinite(e) || e <= s) continue;  // nothing to hang it on
        win = { start: Math.round((s + 0.1) * 100) / 100,
                end: Math.round((e - 0.1) * 100) / 100, anchoredTo: '', spokenAt: null };
      }
      if (!(win.end > win.start)) continue;
      out.push(Object.assign({}, el, {
        start: win.start, end: win.end,
        anchoredTo: win.anchoredTo || '', spokenAt: win.spokenAt == null ? null : win.spokenAt
      }));
    }
    return out;
  }

  // ── The call ─────────────────────────────────────────────────────────────

  function available() {
    return !!(window.LLMAdapters && window.LLMAdapters.nvidiaNimChat
              && window.ProviderManager && window.ProviderManager.getActiveKey('nim'));
  }

  const NOTHING = (why) => ({ needed: false, reason: why, elements: [], rejected: [], ran: false });

  /**
   * Decide what this scene needs, and never stop the pipeline deciding it.
   */
  async function decide({ narration, intent, mediaDescription, mediaSays, shot, transcript } = {}) {
    if (!str(narration)) return NOTHING('there is no narration for this beat');
    if (!available()) return NOTHING('the Director is not reachable');

    let answer = null;
    try {
      const call = window.LLMAdapters.nvidiaNimChat({
        model: (window.AIManager && window.AIManager.nim && window.AIManager.nim.model)
               || 'meta/llama-3.3-70b-instruct',
        messages: [{ role: 'user', content:
          decisionPrompt({ narration, intent, mediaDescription, mediaSays }) }],
        temperature: 0.2, max_tokens: 600
      });
      let timer;
      const bell = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('the Director did not answer in '
          + DECISION_TIMEOUT_MS + 'ms')), DECISION_TIMEOUT_MS);
      });
      answer = await Promise.race([call, bell]).finally(() => clearTimeout(timer));
    } catch (err) {
      console.warn('[Renderer] no decision for this beat: ' + err.message);
      return NOTHING('the Director failed: ' + err.message);
    }

    const decision = parseDecision(answer);
    decision.ran = true;
    if (decision.rejected && decision.rejected.length) {
      for (const r of decision.rejected) console.warn('[Renderer] refused an element: ' + r.why);
    }
    decision.elements = applyTiming(decision.elements, shot, transcript);
    if (!decision.elements.length && decision.needed) {
      decision.needed = false;
      decision.reason = decision.reason + ' (nothing could be anchored to the narration)';
    }
    return decision;
  }

  window.BlvckRenderer = {
    decide,
    available,
    SUPPORTED_KINDS: SUPPORTED,
    PANEL_KINDS, TEXT_KINDS, PLACEMENTS, MAX_ELEMENTS,
    // Exported so the contract can be tested without a provider.
    _parseDecision: parseDecision,
    _applyTiming: applyTiming,
    _decisionPrompt: decisionPrompt
  };
})();
