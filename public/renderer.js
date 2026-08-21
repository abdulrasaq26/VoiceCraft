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
      'Ask ONE question: does this sentence carry information the picture',
      'cannot show?',
      '',
      'Not "is the picture related to the sentence" - it almost always is,',
      'because the footage was chosen for this sentence. The subject is not the',
      'information. A picture can show a place, a person, a thing, an action. It',
      'cannot show a quantity, a date, a proper name, an order of events, or a',
      'comparison between two things. If the sentence carries any of those, the',
      'picture is not carrying them, however well it matches the topic.',
      '',
      'Then choose the form that fits the information:',
      '  ONE figure standing alone            -> stat',
      '  TWO OR MORE values compared          -> chart, one item per value',
      '  events tied to dates or years        -> timeline, one item per event',
      '  named steps, parts or conditions     -> checklist, one item per entry',
      '  wording worth reading as text        -> quote, headline or label',
      '',
      'A stat holds a single number. Several numbers packed into one stat is a',
      'chart that was mislabelled: use chart, and give each value its own item.',
      '',
      'Say no when the sentence adds nothing to what is on screen - description,',
      'mood, weather, atmosphere, an action the viewer is already watching. A',
      'card that repeats what the viewer can see is clutter, and clutter costs',
      'attention.',
      '',
      'ANCHOR each element to the words it belongs to: a SHORT phrase of two to',
      'five words, copied verbatim from the narration above, marking the moment',
      'the element should appear. Not a whole sentence - an anchor is a point,',
      'not a passage. Do NOT give times: the anchor is matched against the',
      'measured recording, which knows when those words were actually spoken.',
      '',
      // Deliberately a shape, not a worked example. A filled-in example gets
      // copied: measured once, against a beat that happened to resemble it, the
      // model returned that example byte for byte and every contract assertion
      // passed on an answer it had not thought about. A template has nothing to
      // lift, and it does not bias the choice of kind toward whichever one the
      // example happened to use.
      'Reply with ONLY this JSON:',
      '{"needed":true,"reason":"<one sentence, about THIS shot>","elements":[',
      ' {"kind":"<one of the kinds below>","content":"<the single value, if any>",',
      '  "label":"<a short caption - ALWAYS give one>","items":["<format below>"],',
      '  "anchor":"<two to five words from the narration>","placement":"<one below>"}]}',
      '',
      'or, when nothing is warranted:',
      '{"needed":false,"reason":"<why the footage is already enough>","elements":[]}',
      '',
      'kind must be one of: ' + SUPPORTED.join(', ') + '.',
      'chart, timeline and checklist must also carry "items": a list of short',
      'strings holding the actual content to typeset. The colon matters, and',
      'what goes on each side of it differs by kind:',
      '  chart     "Label: number"        e.g. "Region A: 41"  - a bare number',
      '                                   cannot be plotted, nothing labels the bar',
      '  timeline  "When: what happened"  e.g. "1912: the yard opened"  - the',
      '                                   date goes FIRST, it marks the rail',
      '  checklist "One short line"   no colon needed',
      'Always give a chart, timeline or checklist a "label". It is the heading',
      'the card is read under, and without it the viewer sees bars with no',
      'subject. Name what is being measured, in two or three words.',
      'placement must be one of: ' + PLACEMENTS.join(', ') + '.',
      'lower_third is a wide strip, for a LINE OF TEXT. A chart, timeline,',
      'checklist or stat is a card and needs a card-shaped slot: one of the',
      'four corners, or center.',
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
      let placement = PLACEMENTS.indexOf(str(row.placement).toLowerCase()) >= 0
        ? str(row.placement).toLowerCase() : 'lower_right';
      // lower_third is a strip: 90% of the width and under a third of the
      // height. That is the right shape for a line of text and the wrong shape
      // for a card, because a 16:9 card fitted into it can only be as tall as
      // the strip. Measured on a real export: the Director asked for a chart
      // there and the bars came out a third the size they needed to be. Text
      // keeps the strip; data cards are moved to a slot shaped like a card.
      if (PANEL_KINDS.indexOf(kind) >= 0 && placement === 'lower_third') placement = 'lower_right';

      const el = {
        kind, content, label, items, placement,
        // The phrase this belongs to. Timing is decided downstream from the
        // measured recording; anything the model said about start or end is
        // deliberately absent from this object.
        anchor: str(row.anchor) || label || content,
        animation: str(row.animation) || 'none',
        enabled: true
      };

      // Ask the compositor whether it could actually draw this, rather than
      // assuming a supported kind with a non-empty items array is enough. It
      // is not: a chart of ["3g/km", "20", "500"] passes both those checks and
      // makes drawChart throw, which inside a render loop breaks the frame and
      // during an export breaks the recording. Measured against live NIM, not
      // imagined.
      if (PANEL_KINDS.indexOf(kind) >= 0 && window.BlvckGraphic
          && window.BlvckGraphic.canDrawPanel) {
        const verdict = window.BlvckGraphic.canDrawPanel(el);
        if (!verdict.ok) { rejected.push({ why: verdict.why, row }); continue; }
      }

      elements.push(el);
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
  /**
   * How long this element has to stay up to be read.
   *
   * Reading is not instantaneous and a card is not a subtitle: the viewer has
   * to find it, take in a heading, then read three labelled values. Broadcast
   * practice is roughly a beat to notice it plus a beat per thing to read, and
   * the numbers below are that rule made explicit rather than a preference.
   */
  function minDwellFor(el) {
    const words = [el.content, el.label].concat(el.items || [])
      .join(' ').trim().split(/\s+/).filter(Boolean).length;
    return Math.min(9, 1.4 + words * 0.42);
  }

  /**
   * Turn anchors into windows using the measured narration.
   *
   * TWO SEPARATE QUESTIONS, and only one of them belongs to the anchor.
   *
   * WHEN it appears is the anchor's, and Timing.anchorOverlay is the authority.
   * That is measured from the recording and nothing here second-guesses it.
   *
   * HOW LONG it stays is not. anchorOverlay returns a window the length of the
   * SPOKEN PHRASE, which is the right answer to "when were these words said"
   * and the wrong answer to "how long should this card be on screen":
   * measured live, the anchor "forty percent" gave 0.35s to 1.55s. A chart is
   * unreadable in 1.2s. So the card is held to the end of the shot it belongs
   * to - the footage cuts there anyway, and an element only draws while its own
   * clip is on screen - and if the phrase is spoken so late that the remaining
   * shot is too short to read in, it comes up EARLY rather than being flashed.
   *
   * Neither number is invented. The moment comes from the transcript and the
   * limit comes from where the shot already sits.
   */
  function applyTiming(elements, shot, transcript) {
    const T = window.Timing;
    const shotStart = Number(shot && shot.timelineStart);
    const shotEnd   = Number(shot && shot.timelineEnd);
    const placed = Number.isFinite(shotStart) && Number.isFinite(shotEnd) && shotEnd > shotStart;
    const round = (v) => Math.round(v * 100) / 100;

    const out = [];
    for (const el of (elements || [])) {
      let win = null;
      if (T && T.anchorOverlay && transcript) {
        try { win = T.anchorOverlay(transcript, el.anchor, { shot }); } catch (e) { win = null; }
      }
      if (!win) {
        if (!placed) continue;                       // nothing to hang it on
        win = { start: round(shotStart + 0.1), end: round(shotEnd - 0.1),
                anchoredTo: '', spokenAt: null };
      }

      let start = win.start;
      let end = win.end;
      if (placed) {
        // Hold it. The shot is the natural limit: past its end the picture has
        // changed and the card belongs to a different beat.
        end = Math.max(end, round(shotEnd - 0.1));
        const need = minDwellFor(el);
        if (end - start < need) start = Math.max(round(shotStart + 0.1), round(end - need));
      }

      if (!(end > start)) continue;
      out.push(Object.assign({}, el, {
        start: round(start), end: round(end),
        // What the words actually gave, kept beside the window that was used.
        // The two are different on purpose and the difference should be
        // visible rather than buried.
        anchoredTo: win.anchoredTo || '',
        spokenAt: win.spokenAt == null ? null : win.spokenAt,
        heldFor: round(end - start),
        dwellWanted: round(minDwellFor(el))
      }));
    }

    // Two cards in the same corner would now be drawn on top of one another,
    // because holding everything to the end of the shot means their windows
    // overlap by construction. A beat may legitimately want two - a stat and a
    // timeline, say - but not stacked. Within one placement the later card
    // takes over, and the earlier one ends where it begins.
    const byPlacement = new Map();
    for (const el of out) {
      const list = byPlacement.get(el.placement) || [];
      list.push(el);
      byPlacement.set(el.placement, list);
    }
    for (const list of byPlacement.values()) {
      if (list.length < 2) continue;
      list.sort((a, b) => a.start - b.start);
      for (let i = 0; i < list.length - 1; i++) {
        if (list[i].end > list[i + 1].start) {
          list[i].end = round(list[i + 1].start);
          list[i].heldFor = round(list[i].end - list[i].start);
        }
      }
    }
    // Anything squeezed to nothing by that handover never had a window.
    return out.filter((el) => el.end > el.start);
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

  // ── The stage ────────────────────────────────────────────────────────────

  const SB_LS = 'blvck-tts:storyboard';

  /**
   * The shot's own window, in seconds.
   *
   * A measured project carries timelineStart/End, placed against the aligned
   * recording. An estimated one carries only the timestamp string the scene was
   * built with. Either way the window comes from where the scene already sits -
   * this is not the Renderer deciding when anything happens, it is the Renderer
   * reading what was decided upstream, so that an element whose phrase was never
   * spoken still has the shot to fall back to.
   */
  function shotWindowOf(scene) {
    const s = Number(scene && scene.timelineStart);
    const e = Number(scene && scene.timelineEnd);
    if (Number.isFinite(s) && Number.isFinite(e) && e > s) return { timelineStart: s, timelineEnd: e };

    const m = String(scene && scene.timestamp || '')
      .match(/(\d+):(\d+):(\d+)\s*[-–]\s*(\d+):(\d+):(\d+)/);
    if (!m) return null;
    const a = (+m[1]) * 3600 + (+m[2]) * 60 + (+m[3]);
    const b = (+m[4]) * 3600 + (+m[5]) * 60 + (+m[6]);
    return b > a ? { timelineStart: a, timelineEnd: b } : null;
  }

  /**
   * Should this beat even be asked about?
   *
   * A beat the storyboard routed to the canvas is ALREADY a graphic - a chart
   * beat renders a full-frame chart card. Laying a panel over it would be a
   * card on a card. And a beat with no picture has nothing for an element to
   * sit on.
   */
  function eligible(scene) {
    if (!str(scene && scene.subtitle)) return { ok: false, why: 'no narration on this beat' };
    if (window.BlvckLTX && window.BlvckLTX.rendersOnCanvas
        && window.BlvckLTX.rendersOnCanvas(scene)) {
      return { ok: false, why: 'this beat is already a full-frame graphic' };
    }
    if (!scene.stockAsset && scene.status !== 'done') {
      return { ok: false, why: 'no picture has been chosen yet' };
    }
    if (!shotWindowOf(scene)) return { ok: false, why: 'this beat has no place on the timeline' };
    return { ok: true, why: '' };
  }

  /** What the acquisition step already learned about the chosen picture. */
  function pictureContext(scene) {
    const asset = scene.stockAsset || {};
    const ev = scene.visualEvaluation || {};
    return {
      // The vision model already looked at this asset when it was being chosen.
      // Asking again would cost another call to say the same thing.
      mediaDescription: (ev.best && ev.best.sees) || '',
      mediaSays: (asset.archive && asset.archive.title)
                 || (Array.isArray(asset.queriesUsed) ? asset.queriesUsed.join(', ') : '')
    };
  }

  /**
   * Decide for every beat in a project.
   *
   * Sequential on purpose. NIM answers 503 ResourceExhausted when its shared
   * worker pool is full - measured during the live smoke test - and firing a
   * whole storyboard at it in parallel is the reliable way to see that. The
   * cost is real and worth stating: roughly 12-30s a beat.
   *
   * Never throws. A beat that cannot be decided keeps whatever it had.
   */
  async function decideForScenes({ scenes, transcript, force = false,
                                   onProgress, signal, decider } = {}) {
    const list = Array.isArray(scenes) ? scenes : [];
    // The stage walks beats, applies eligibility and persists answers; it does
    // not care who produces them. Naming the decider makes that separation real
    // rather than implied, and lets the plumbing be exercised without spending
    // twenty seconds a beat on the provider to learn nothing about plumbing.
    const ask = typeof decider === 'function' ? decider : decide;
    const summary = { considered: 0, decided: 0, added: 0, nothing: 0,
                      skipped: 0, failed: 0, stopped: false, beats: [] };

    for (const scene of list) {
      if (signal && signal.aborted) { summary.stopped = true; break; }

      const fit = eligible(scene);
      if (!fit.ok) {
        summary.skipped++;
        summary.beats.push({ index: scene.index, skipped: fit.why });
        if (onProgress) onProgress({ scene, skipped: fit.why, summary });
        continue;
      }
      // Already decided, and not being asked again. A re-run should not spend
      // ten minutes reproducing answers that are already on the scenes.
      if (!force && scene.rendererDecision && scene.rendererDecision.ran) {
        summary.skipped++;
        summary.beats.push({ index: scene.index, skipped: 'already decided' });
        if (onProgress) onProgress({ scene, skipped: 'already decided', summary });
        continue;
      }

      summary.considered++;
      if (onProgress) onProgress({ scene, working: true, summary });

      const { mediaDescription, mediaSays } = pictureContext(scene);
      let decision;
      try {
        decision = await ask({
          narration: scene.subtitle,
          intent: scene.sceneSummary || scene.camera || '',
          mediaDescription, mediaSays,
          shot: shotWindowOf(scene),
          transcript
        });
      } catch (err) {
        // decide() is written not to throw, but this stage must survive it if
        // that ever stops being true.
        decision = { needed: false, reason: 'the Renderer stage failed: ' + err.message,
                     elements: [], rejected: [], ran: false };
      }

      if (decision.ran) summary.decided++; else summary.failed++;
      if (decision.needed && decision.elements.length) {
        scene.rendererElements = decision.elements;
        summary.added += decision.elements.length;
      } else {
        // An honest no clears any previous yes, or a re-run would leave a card
        // the Director has since decided against.
        scene.rendererElements = null;
        if (decision.ran) summary.nothing++;
      }
      // Why, kept on the scene. The workspace shows it, and a beat with no card
      // should be able to say whether that was a judgement or an outage.
      scene.rendererDecision = { ran: decision.ran, needed: decision.needed,
                                 reason: decision.reason, at: Date.now(),
                                 rejected: (decision.rejected || []).map((r) => r.why) };

      summary.beats.push({ index: scene.index, needed: decision.needed,
                           ran: decision.ran, reason: decision.reason,
                           kinds: (decision.elements || []).map((e) => e.kind) });
      if (onProgress) onProgress({ scene, decision, summary });
    }
    return summary;
  }

  /**
   * Run the stage over the project the app currently holds.
   *
   * Writes onto the storyboard's OWN scene objects where it can. The storyboard
   * rebuilds its stored scenes from that in-memory array on every save, so a
   * decision written only into localStorage would be erased the next time
   * anything else saved - which is exactly how the transcript used to vanish.
   */
  async function runStage(opts = {}) {
    const SBM = window.BlvckStoryboard;
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(SB_LS) || 'null'); } catch (e) { stored = null; }

    const live = SBM && SBM.scenes ? SBM.scenes() : null;
    const scenes = (live && live.length) ? live : ((stored && stored.scenes) || []);
    if (!scenes.length) {
      return { considered: 0, decided: 0, added: 0, nothing: 0, skipped: 0,
               failed: 0, stopped: false, beats: [], why: 'there are no scenes yet' };
    }

    const summary = await decideForScenes(Object.assign({}, opts, {
      scenes, transcript: (stored && stored.transcript) || null
    }));

    if (live && live.length && SBM.save) {
      SBM.save();
    } else if (stored) {
      try {
        stored.scenes = scenes;
        localStorage.setItem(SB_LS, JSON.stringify(stored));
        window.dispatchEvent(new CustomEvent('blvck-storyboard-updated'));
      } catch (e) { /* quota — the decisions stay in memory */ }
    }
    return summary;
  }

  window.BlvckRenderer = {
    decide,
    // The stage: every beat in the project, written onto the scenes the
    // storyboard is holding so the next save carries them rather than
    // overwriting them.
    runStage,
    decideForScenes,
    available,
    SUPPORTED_KINDS: SUPPORTED,
    PANEL_KINDS, TEXT_KINDS, PLACEMENTS, MAX_ELEMENTS,
    // Exported so the contract can be tested without a provider.
    _parseDecision: parseDecision,
    _applyTiming: applyTiming,
    _minDwellFor: minDwellFor,
    _decisionPrompt: decisionPrompt,
    _eligible: eligible,
    _shotWindowOf: shotWindowOf,
    _pictureContext: pictureContext
  };
})();
