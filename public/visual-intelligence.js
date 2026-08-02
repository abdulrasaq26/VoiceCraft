// Visual Intelligence — what visual language does this SUBJECT demand?
//
// A different question from the Director's. The Director asks "what should
// THIS beat be?"; this asks "what visual family does this whole video belong
// to?" Strategy before tactics.
//
// It matters more now than it did. While a GPU rendered the visuals, quality
// was largely a property of the model. With a procedural renderer the output is
// deterministic, so what it is TOLD to draw is the entire product — the
// intelligence layer is where quality now lives.
//
// It also fixes a specific failure: the Director re-derived subject conventions
// from its own prompt on every beat, so a health video and a finance video
// could drift toward looking alike. This decides the palette of allowed moves
// ONCE, and the Director picks from inside it.
//
//   Topic ─▶ classify ─▶ visual language ─▶ constraints ─▶ Director
//
// Forbidding is as important as allowing. "No cinematic b-roll in a health
// explainer" prevents more bad videos than any amount of encouragement.
(() => {
  'use strict';

  // A niche is recognised by what it TALKS about, not by a label the user
  // picked — most people never touch the mode dropdown.
  const NICHES = [
    {
      id: 'health',
      label: 'Health & medical',
      match: /\b(health|medical|disease|symptom|patient|doctor|blood|heart|brain|liver|kidney|lung|insulin|hormone|cell|immune|cancer|diabetes|nutrition|diet|muscle|bone|treatment|diagnosis|therapy|vaccine|virus|infection)\b/i,
      primary: ['diagram', 'whiteboard', 'timeline'],
      secondary: ['chart', 'stickman'],
      forbidden: ['map'],
      pacing: { density: 'medium', transitionRate: 'high', beatSec: [6, 12] },
      narrationStyle: 'educational',
      // Health content is judged on trustworthiness before polish.
      rules: [
        'Explain mechanisms with a drawn diagram, never a photograph.',
        'A symptom or progression over time is a timeline, not prose.',
        'Never use alarming or dramatic imagery; calm and factual reads as credible.'
      ]
    },
    {
      id: 'finance',
      label: 'Finance & business',
      match: /\b(revenue|profit|loss|market|invest|stock|share|company|business|economy|econom|price|cost|salary|funding|valuation|growth|margin|gdp|inflation|debt|startup|customer|sales)\b/i,
      primary: ['chart', 'diagram', 'whiteboard'],
      secondary: ['timeline', 'stickman'],
      forbidden: ['map'],
      pacing: { density: 'high', transitionRate: 'high', beatSec: [5, 10] },
      narrationStyle: 'analytical',
      rules: [
        'Every number spoken aloud becomes a chart; a figure only heard is forgotten.',
        'Show the comparison, not the absolute — "down 61% on last year" beats "24".',
        'Business processes are flows: boxes and arrows, not paragraphs.'
      ]
    },
    {
      id: 'history',
      label: 'History & geopolitics',
      match: /\b(history|historical|ancient|empire|war|battle|century|dynasty|revolution|colonial|treaty|invasion|medieval|archae|civilisation|civilization|\b1[0-9]{3}\b)/i,
      primary: ['map', 'timeline', 'stickman'],
      secondary: ['diagram', 'chart'],
      forbidden: [],
      pacing: { density: 'medium', transitionRate: 'medium', beatSec: [8, 15] },
      narrationStyle: 'narrative',
      rules: [
        'Territory, movement and spread are maps; sequence is a timeline.',
        'Reenact people with stick figures rather than attempting portraiture.',
        'Anchor every claim to a date the map or timeline can show.'
      ]
    },
    {
      id: 'science',
      label: 'Science & technology',
      match: /\b(science|scientific|physics|chemistry|biology|research|experiment|theory|energy|particle|climate|space|technology|software|algorithm|engineer|quantum|data|ai\b|machine learning)\b/i,
      primary: ['diagram', 'whiteboard', 'chart'],
      secondary: ['timeline', 'stickman'],
      forbidden: ['map'],
      pacing: { density: 'medium', transitionRate: 'high', beatSec: [6, 12] },
      narrationStyle: 'educational',
      rules: [
        'A mechanism is a labelled diagram; a process is a whiteboard flow.',
        'Scale and magnitude need a chart, not an adjective.',
        'Build complex ideas one element at a time rather than revealing them whole.'
      ]
    },
    {
      id: 'howto',
      label: 'How-to & tutorial',
      match: /\b(how to|tutorial|guide|step|steps|beginner|learn|teach|lesson|instruction|setup|install|configure|recipe|method)\b/i,
      primary: ['whiteboard', 'stickman', 'diagram'],
      secondary: ['chart'],
      forbidden: ['map'],
      pacing: { density: 'high', transitionRate: 'high', beatSec: [4, 9] },
      narrationStyle: 'instructional',
      rules: [
        'Every step is its own beat; never stack two instructions on one frame.',
        'Show a person doing the thing — a stick figure acting beats a static icon.',
        'Number the steps visibly so a viewer can rejoin after looking away.'
      ]
    },
    {
      id: 'story',
      label: 'Story & documentary',
      match: /\b(story|documentary|journey|discovered|mystery|happened|survivor|witness|escape|scandal|investigation|unsolved)\b/i,
      primary: ['stickman', 'timeline', 'map'],
      secondary: ['diagram', 'chart'],
      forbidden: [],
      pacing: { density: 'low', transitionRate: 'medium', beatSec: [8, 16] },
      narrationStyle: 'narrative',
      rules: [
        'Let a beat breathe; a story paced like a tutorial loses its tension.',
        'People carry a story — show them acting, not objects representing them.',
        'Use the map only when place genuinely matters to what happened.'
      ]
    }
  ];

  const GENERAL = {
    id: 'general',
    label: 'General explainer',
    primary: ['stickman', 'whiteboard', 'diagram'],
    secondary: ['chart', 'timeline', 'map'],
    forbidden: [],
    pacing: { density: 'medium', transitionRate: 'medium', beatSec: [6, 12] },
    narrationStyle: 'conversational',
    rules: ['Prefer the simplest visual that carries the idea.']
  };

  /**
   * Classify from the project's own words.
   *
   * Scored by match COUNT rather than first hit: a finance video will mention
   * "growth" once in passing, but a genuine finance video mentions revenue,
   * margin and market repeatedly. One keyword should not decide a whole video.
   */
  function classify(text) {
    const hay = String(text || '');
    if (!hay.trim()) return { ...GENERAL, confidence: 0 };

    const scored = NICHES.map((n) => {
      const hits = (hay.match(new RegExp(n.match.source, 'gi')) || []).length;
      return { niche: n, hits };
    }).sort((a, b) => b.hits - a.hits);

    const best = scored[0];
    const runnerUp = scored[1];
    if (!best.hits) return { ...GENERAL, confidence: 0 };

    // Refuse to commit when two niches score alike — a mislabelled video gets
    // the wrong visual family for every beat, which is worse than staying
    // general and letting the Director judge each one.
    const margin = best.hits - (runnerUp ? runnerUp.hits : 0);
    if (best.hits < 2 || margin < 1) {
      return { ...GENERAL, confidence: 0.3, considered: scored.slice(0, 2).map((s) => s.niche.id) };
    }

    const confidence = Math.min(1, 0.5 + best.hits * 0.08 + margin * 0.06);
    return { ...best.niche, confidence: Math.round(confidence * 100) / 100 };
  }

  /**
   * The full strategy for a project. This is what the Director is handed.
   *
   * The channel MODE, when the user set one, overrides the detected niche —
   * an explicit choice always beats inference.
   */
  function strategise(input) {
    const text = typeof input === 'string'
      ? input
      : [input && input.topic, input && input.script, input && input.brief, input && input.title]
        .filter(Boolean).join(' ');

    const detected = classify(text);
    const mode = window.BlvckModes ? window.BlvckModes.current() : null;

    const allowed = [...detected.primary, ...detected.secondary]
      .filter((v) => detected.forbidden.indexOf(v) < 0);

    return {
      niche: detected.id,
      label: detected.label,
      confidence: detected.confidence,
      considered: detected.considered || [],
      primaryVisuals: detected.primary,
      secondaryVisuals: detected.secondary,
      forbiddenVisuals: detected.forbidden,
      allowedVisuals: allowed,
      pacing: detected.pacing,
      narrationStyle: detected.narrationStyle,
      rules: detected.rules,
      channelMode: mode ? mode.id : null,
      hostPolicy: mode ? mode.host : null
    };
  }

  /**
   * The Director's brief — constraints, not suggestions.
   *
   * Written as a hard boundary because a model given a preference will drift
   * back to its own priors within a few beats, and drift is exactly what this
   * engine exists to prevent.
   */
  function briefFor(strategy) {
    const s = strategy || strategise('');
    const lines = [
      `VISUAL STRATEGY — ${s.label}${s.confidence ? ` (confidence ${s.confidence})` : ' (undetermined; judge each beat on its merits)'}`,
      '',
      `PREFER: ${s.primaryVisuals.join(', ')} — these carry this subject best and should be the majority of the video.`,
      s.secondaryVisuals.length ? `SUPPORT: ${s.secondaryVisuals.join(', ')} — use where the beat genuinely calls for them.` : '',
      s.forbiddenVisuals.length
        ? `DO NOT USE: ${s.forbiddenVisuals.join(', ')} — wrong visual family for this subject, however tempting.`
        : '',
      '',
      `PACING: ${s.pacing.density} density, ${s.pacing.transitionRate} transition rate, beats of about ${s.pacing.beatSec[0]}-${s.pacing.beatSec[1]}s.`,
      `NARRATION REGISTER: ${s.narrationStyle}.`,
      '',
      'SUBJECT RULES:',
      ...s.rules.map((r) => `- ${r}`)
    ];
    return lines.filter((l) => l !== '').join('\n');
  }

  /**
   * Enforce the strategy on a planned beat.
   *
   * The Director will occasionally reach outside its palette. Rather than
   * reject the beat, swap it for the nearest allowed type — a beat with the
   * wrong card still communicates; a dropped beat does not.
   */
  function constrain(scene, strategy) {
    const s = strategy || strategise('');
    const vt = String((scene && scene.visualType) || '');
    if (!vt) return { visualType: vt, changed: false };

    // Generated types are always permitted; this engine governs visual
    // LANGUAGE, not whether a beat needs a camera.
    if (vt === 't2v' || vt === 'broll' || vt === 'presenter') return { visualType: vt, changed: false };

    if (s.forbiddenVisuals.indexOf(vt) > -1) {
      const to = s.primaryVisuals[0] || 'stickman';
      return { visualType: to, changed: true, reason: `${vt} is the wrong visual family for ${s.label}`, from: vt };
    }
    return { visualType: vt, changed: false };
  }

  window.BlvckVisualIQ = {
    NICHES,
    GENERAL,
    classify,
    strategise,
    briefFor,
    constrain,
    niches: () => NICHES.map((n) => n.id)
  };
})();
