// The Editorial Visual Planner: which medium should this beat be made of?
//
// This sits ABOVE footage selection, and the order matters. Until now the only
// question the pipeline could ask was "what footage shows this?", which quietly
// assumes every sentence has something a camera could have pointed at. Most
// documentary sentences do not. "Authority stops being about what you can do
// yourself" is not a shot; it is a relationship, and no amount of searching
// finds it.
//
// So the Planner answers one strategic question and nothing else:
//
//   FOOTAGE     something real can be shown, and showing it is enough
//   HYPERFRAME  the meaning is structure, quantity, sequence or abstraction,
//               and belongs in built graphics. NO footage is required
//   HYBRID      there is a real thing to show AND information the shot cannot
//               carry, and the two should be composed together
//
// WHAT IT MAY NOT DO. It does not choose footage, write animation, name
// coordinates, or set times. Those belong to the Media Director, the Composer,
// the layout and Timing.anchorOverlay respectively. A planner that starts
// specifying pixels has stopped being a planner, so the parser keeps only the
// three fields below and discards everything else the model volunteers.
//
// AND IT CAN NEVER BLOCK PRODUCTION. No key, a timeout, a 503, malformed JSON,
// a mode nobody has heard of - every one of them resolves to FOOTAGE, which is
// what the pipeline did before this file existed. The Planner is an upgrade to
// the decision, not a new dependency of it.
(() => {
  'use strict';

  const MODES = ['FOOTAGE', 'HYPERFRAME', 'HYBRID'];
  const DEFAULT_MODE = 'FOOTAGE';
  // NIM answers a request this size in 20-45s when it is healthy — the adapter
  // records 42s and 20s across three identical calls. A 45s ceiling therefore
  // sits ON the edge of normal, and a planner that times out does not report an
  // error: it falls back to FOOTAGE, which is a decision-shaped answer produced
  // by an outage. Measured here on a cold endpoint, the first beat of a run
  // exceeded 45s while the next two answered in seconds. The budget has to be
  // wider than the provider's slow-but-healthy case; it exists to end a call
  // that is never coming back, not to race one that is merely slow.
  const DECISION_TIMEOUT_MS = 90000;

  const str = (v) => String(v == null ? '' : v).trim();

  /**
   * What medium is this scene made of?
   *
   * The single reader. A scene saved before this existed has no strategy and
   * is FOOTAGE, which is exactly what it was - so old projects need no
   * migration and nothing has to be rewritten on load.
   */
  function strategyOf(scene) {
    const s = scene && scene.visualStrategy;
    const mode = str(s && s.mode).toUpperCase();
    return MODES.indexOf(mode) >= 0 ? mode : DEFAULT_MODE;
  }

  /** Has anything actually decided this, or is it just the default? */
  function planned(scene) {
    return !!(scene && scene.visualStrategy && scene.visualStrategy.ran);
  }

  // ── The brief ────────────────────────────────────────────────────────────

  function planPrompt({ narration, intent, before, after, recent, position } = {}) {
    const NL = String.fromCharCode(10);
    const lines = [
      'You are deciding how a single beat of a documentary should be MADE.',
      'Not what it should say - that is written. Not what it should look like in',
      'detail - somebody else does that. Only which medium carries it.',
      '',
      'THE NARRATOR SAYS: "' + str(narration) + '"'
    ];
    if (str(intent)) lines.push('THE BEAT IS ABOUT: ' + str(intent));
    if (str(before)) lines.push('THE LINE BEFORE: "' + str(before) + '"');
    if (str(after)) lines.push('THE LINE AFTER: "' + str(after) + '"');
    if (str(position)) lines.push('WHERE IT SITS: ' + str(position));
    if (str(recent)) lines.push('THE LAST FEW BEATS WERE MADE AS: ' + str(recent));

    return lines.concat([
      '',
      'Ask one question: could a camera have recorded this sentence?',
      '',
      'Some sentences describe something that exists — a place, a person, a',
      'process, an object, weather, work being done. Those are FOOTAGE, and',
      'real footage is almost always better than a drawing of the same thing.',
      '',
      'Other sentences have NOTHING TO POINT A CAMERA AT. The subject itself is',
      'an abstraction — a hierarchy, a chain of causes, a comparison between',
      'ideas, how something is organised — and any footage would be a stand-in',
      'chosen for being vaguely related, a person at a desk doing duty for a',
      'sentence about authority. Those are HYPERFRAME, and they need no footage',
      'at all.',
      '',
      'And some carry both. Ask the sentence two questions, and IGNORE THE ORDER',
      'OF ITS CLAUSES — which half comes first decides nothing:',
      '',
      '  1. Is there something here a camera could be pointed at? A place, an',
      '     object, people, work being done, weather.',
      '  2. Does the sentence also say something about that thing which no',
      '     camera records? How many, what share, how it compares, how it has',
      '     changed, what it costs.',
      '',
      'When both answers are yes the mode is HYBRID: the shot carries the',
      'subject and the graphic carries what the shot cannot say. A quantity',
      'is not by itself a reason to answer HYPERFRAME — the question is whether',
      'the thing being counted is a thing that exists and could be filmed.',
      'Answering FOOTAGE loses the half the shot cannot carry; answering',
      'HYPERFRAME throws away a real place that could have been filmed.',
      '',
      'Two things to weigh beyond the sentence itself. A film made entirely of',
      'one medium is monotonous, so if the last several beats were all the same',
      'thing, that is a reason to look harder at this one — not a reason to',
      'switch for its own sake. And an opening or a closing beat carries more',
      'weight than a middle one.',
      '',
      'Reply with ONLY this JSON:',
      '{"mode":"<' + MODES.join('|') + '>",',
      ' "reason":"<one sentence, about THIS beat>",',
      ' "confidence":<0 to 1>}'
    ]).join(NL);
  }

  // ── The parser, where the contract is kept ───────────────────────────────

  /**
   * Read a plan, keeping only what a planner is allowed to decide.
   *
   * Never throws: every caller is in a pipeline that has to survive a bad
   * answer, and the answer to a bad answer is the default.
   */
  function parsePlan(text) {
    const raw = str(text);
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) return fallback('the planner did not answer in JSON');

    let obj = null;
    try { obj = JSON.parse(m[0]); } catch (e) {
      return fallback('the planner\'s JSON did not parse');
    }
    if (!obj || typeof obj !== 'object') return fallback('the planner answered with no decision');

    const mode = str(obj.mode).toUpperCase();
    if (MODES.indexOf(mode) < 0) {
      // Named, not swallowed. A mode we do not have is a contract problem
      // worth seeing rather than a silent demotion to footage.
      return fallback('the planner asked for an unknown medium "' + (mode || '(none)') + '"');
    }

    let confidence = Number(obj.confidence);
    if (!Number.isFinite(confidence)) confidence = 0.5;
    confidence = Math.max(0, Math.min(1, confidence));

    // Only these three survive. Anything else the model volunteered - a
    // duration, a layout, a list of assets, an animation - is discarded here,
    // because a planner that specifies those has stopped being a planner and
    // started overruling the people whose job they are.
    return {
      mode,
      reason: str(obj.reason) || 'no reason given',
      confidence,
      ran: true
    };
  }

  const fallback = (why) => ({ mode: DEFAULT_MODE, reason: why, confidence: 0, ran: false });

  // ── The call ─────────────────────────────────────────────────────────────

  function available() {
    return !!(window.LLMAdapters && window.LLMAdapters.nvidiaNimChat
              && window.ProviderManager && window.ProviderManager.getActiveKey('nim'));
  }

  /**
   * Decide one beat's medium, and never stop the pipeline deciding it.
   */
  async function decide({ narration, intent, before, after, recent, position } = {}) {
    if (!str(narration)) return fallback('there is no narration for this beat');
    if (!available()) return fallback('the planner is not reachable');

    let answer = null;
    try {
      const call = window.LLMAdapters.nvidiaNimChat({
        model: (window.AIManager && window.AIManager.nim && window.AIManager.nim.model)
               || 'meta/llama-3.3-70b-instruct',
        messages: [{ role: 'user',
                     content: planPrompt({ narration, intent, before, after, recent, position }) }],
        temperature: 0.2, max_tokens: 300
      });
      let timer;
      const bell = new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('the planner did not answer in '
          + DECISION_TIMEOUT_MS + 'ms')), DECISION_TIMEOUT_MS);
      });
      answer = await Promise.race([call, bell]).finally(() => clearTimeout(timer));
    } catch (err) {
      console.warn('[Planner] no plan for this beat: ' + err.message);
      return fallback('the planner failed: ' + err.message);
    }
    return parsePlan(answer);
  }

  // ── The stage ────────────────────────────────────────────────────────────

  const SB_LS = 'blvck-tts:storyboard';

  /**
   * Plan every beat in a project.
   *
   * Sequential, and each beat is told what the last few were made of, so the
   * film can be looked at as a film rather than as a bag of independent
   * decisions. That does make the result order-dependent, which is honest: an
   * editor deciding beat nine knows what beats six to eight were.
   */
  async function planScenes({ scenes, force = false, onProgress, signal, planner } = {}) {
    const list = Array.isArray(scenes) ? scenes : [];
    const ask = typeof planner === 'function' ? planner : decide;
    const summary = { considered: 0, planned: 0, failed: 0, skipped: 0,
                      stopped: false, modes: {}, beats: [] };

    const decided = [];
    for (let i = 0; i < list.length; i++) {
      if (signal && signal.aborted) { summary.stopped = true; break; }
      const scene = list[i];

      if (!str(scene.subtitle)) {
        summary.skipped++;
        summary.beats.push({ index: scene.index, skipped: 'no narration on this beat' });
        continue;
      }
      if (!force && planned(scene)) {
        summary.skipped++;
        decided.push(strategyOf(scene));
        summary.beats.push({ index: scene.index, skipped: 'already planned',
                             mode: strategyOf(scene) });
        continue;
      }

      summary.considered++;
      if (onProgress) onProgress({ scene, working: true, summary });

      const where = i === 0 ? 'the opening beat'
                  : i === list.length - 1 ? 'the closing beat'
                  : `beat ${i + 1} of ${list.length}`;

      let plan;
      try {
        plan = await ask({
          narration: scene.subtitle,
          intent: scene.sceneSummary || scene.camera || '',
          before: i > 0 ? list[i - 1].subtitle : '',
          after: i < list.length - 1 ? list[i + 1].subtitle : '',
          recent: decided.slice(-3).join(', '),
          position: where
        });
      } catch (err) {
        plan = fallback('the planner stage failed: ' + err.message);
      }

      scene.visualStrategy = {
        mode: plan.mode, reason: plan.reason,
        confidence: plan.confidence, ran: plan.ran, at: Date.now()
      };
      decided.push(plan.mode);
      summary.modes[plan.mode] = (summary.modes[plan.mode] || 0) + 1;
      if (plan.ran) summary.planned++; else summary.failed++;
      summary.beats.push({ index: scene.index, mode: plan.mode, ran: plan.ran,
                           confidence: plan.confidence, reason: plan.reason });
      if (onProgress) onProgress({ scene, plan, summary });
    }
    return summary;
  }

  /** Plan the project the app currently holds, and persist the answers. */
  async function runStage(opts = {}) {
    const SBM = window.BlvckStoryboard;
    let stored = null;
    try { stored = JSON.parse(localStorage.getItem(SB_LS) || 'null'); } catch (e) { stored = null; }

    const live = SBM && SBM.scenes ? SBM.scenes() : null;
    const scenes = (live && live.length) ? live : ((stored && stored.scenes) || []);
    if (!scenes.length) {
      return { considered: 0, planned: 0, failed: 0, skipped: 0, stopped: false,
               modes: {}, beats: [], why: 'there are no scenes yet' };
    }

    const summary = await planScenes(Object.assign({}, opts, { scenes }));

    // Written onto the storyboard's own scenes where possible, for the same
    // reason the Renderer's decisions are: saveProject rebuilds the stored
    // scenes from that array, so anything written only to storage is erased by
    // the next save from anywhere.
    if (live && live.length && SBM.save) SBM.save();
    else if (stored) {
      try {
        stored.scenes = scenes;
        localStorage.setItem(SB_LS, JSON.stringify(stored));
        window.dispatchEvent(new CustomEvent('blvck-storyboard-updated'));
      } catch (e) { /* quota — the plan stays in memory */ }
    }
    return summary;
  }

  window.BlvckVisualPlanner = {
    strategyOf, planned, decide, planScenes, runStage, available,
    MODES, DEFAULT_MODE,
    _parsePlan: parsePlan,
    _planPrompt: planPrompt
  };
})();
