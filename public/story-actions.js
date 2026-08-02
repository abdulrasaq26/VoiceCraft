// Story Actions — the Director chooses what HAPPENS, not what pose to strike.
//
// The mistake this corrects: charts, maps, diagrams and timelines were being
// treated as scene TYPES. They are not. They are props.
//
//   wrong   Scene Type = Chart
//   right   Scene Type = Conversation  ·  Supporting Visual = Chart
//
// So the Director stops picking poses and starts picking story actions — buy,
// argue, study, fail, celebrate — and each one expands into everything a scene
// needs: how many actors, what they are doing, where, with what objects, and
// whether any supporting information is warranted at all.
//
//   "Two friends split the cost of a car"
//     → action: negotiate · actors: 2 · environment: street · props: [car, money]
//     → no chart required, and far more interesting than one.
//
// A scene is: WHO · WHERE · WHAT OBJECTS · WHAT IS HAPPENING · (support).
// The last is optional and usually absent.
(() => {
  'use strict';

  // Each action expands into a whole scene.
  //
  //   role         which staging mode (see stage-layers)
  //   cast         per-actor clip + emotion; length implies the actor count
  //   environment  where this normally happens, when the text does not say
  //   props        objects that make the action legible
  //   info         'never' · 'optional' · 'often' — how much support it wants
  //   beat         the retention device this action carries, if any
  const ACTIONS = {
    // --- explaining & teaching ---------------------------------------------
    explain: {
      role: 'presenter', info: 'often',
      cast: [{ clip: 'explain', emotion: 'confident' }],
      environment: null, props: []
    },
    teach: {
      role: 'social', info: 'often',
      cast: [{ clip: 'point', emotion: 'confident' }, { clip: 'idle', emotion: 'thinking' }],
      environment: 'classroom', props: []
    },
    demonstrate: {
      role: 'demonstrate', info: 'optional',
      cast: [{ clip: 'point', emotion: 'confident' }],
      environment: null, props: []
    },
    study: {
      role: 'demonstrate', info: 'never',
      cast: [{ clip: 'read', emotion: 'thinking' }],
      environment: 'office', props: ['book']
    },

    // --- exchange & money ---------------------------------------------------
    buy: {
      role: 'social', info: 'never',
      cast: [{ clip: 'point', emotion: 'happy' }, { clip: 'explain', emotion: 'confident' }],
      environment: 'store', props: ['money'], beat: 'handoff'
    },
    sell: {
      role: 'social', info: 'optional',
      cast: [{ clip: 'explain', emotion: 'confident' }, { clip: 'think', emotion: 'thinking' }],
      environment: 'store', props: ['money'], beat: 'handoff'
    },
    negotiate: {
      role: 'social', info: 'never',
      cast: [{ clip: 'explain', emotion: 'confident' }, { clip: 'explain', emotion: 'nervous' }],
      environment: 'meeting', props: ['document'], beat: 'handoff'
    },
    invest: {
      role: 'demonstrate', info: 'often',
      cast: [{ clip: 'point', emotion: 'confident' }],
      environment: 'office', props: ['money']
    },

    // --- conflict & outcome -------------------------------------------------
    argue: {
      role: 'social', info: 'never',
      cast: [{ clip: 'point', emotion: 'angry' }, { clip: 'shrug', emotion: 'angry' }],
      environment: 'office', props: []
    },
    fail: {
      role: 'demonstrate', info: 'optional',
      cast: [{ clip: 'facepalm', emotion: 'sad' }],
      environment: null, props: [], beat: 'transformation'
    },
    celebrate: {
      role: 'demonstrate', info: 'never',
      cast: [{ clip: 'celebrate', emotion: 'excited' }],
      environment: null, props: []
    },
    struggle: {
      role: 'demonstrate', info: 'never',
      cast: [{ clip: 'think', emotion: 'nervous' }],
      environment: null, props: []
    },
    decide: {
      role: 'compare', info: 'optional',
      cast: [{ clip: 'think', emotion: 'thinking' }, { clip: 'shrug', emotion: 'confused' }],
      environment: null, props: [], beat: 'compare'
    },

    // --- daily life ---------------------------------------------------------
    eat: {
      role: 'demonstrate', info: 'never',
      cast: [{ clip: 'idle', emotion: 'happy' }],
      environment: 'kitchen', props: ['cup']
    },
    rush: {
      role: 'demonstrate', info: 'never',
      cast: [{ clip: 'run', emotion: 'nervous' }],
      environment: null, props: [], beat: 'exit'
    },
    commute: {
      role: 'demonstrate', info: 'never',
      cast: [{ clip: 'walk', emotion: 'bored' }],
      environment: 'street', props: ['briefcase'], beat: 'exit'
    },
    drive: {
      role: 'demonstrate', info: 'never',
      cast: [{ clip: 'idle', emotion: 'confident' }],
      environment: 'car', props: []
    },
    work: {
      role: 'demonstrate', info: 'never',
      cast: [{ clip: 'type', emotion: 'bored' }],
      environment: 'office', props: ['laptop']
    },
    exercise: {
      role: 'demonstrate', info: 'optional',
      cast: [{ clip: 'run', emotion: 'confident' }],
      environment: 'gym', props: [], beat: 'transformation'
    },
    rest: {
      role: 'demonstrate', info: 'never',
      cast: [{ clip: 'sit', emotion: 'bored' }],
      environment: 'home', props: []
    },

    // --- health -------------------------------------------------------------
    diagnose: {
      role: 'social', info: 'often',
      cast: [{ clip: 'point', emotion: 'confident' }, { clip: 'idle', emotion: 'nervous' }],
      environment: 'clinic', props: []
    },
    treat: {
      role: 'social', info: 'optional',
      cast: [{ clip: 'explain', emotion: 'confident' }, { clip: 'idle', emotion: 'sad' }],
      environment: 'clinic', props: ['bottle'], beat: 'transformation'
    },
    recover: {
      role: 'demonstrate', info: 'optional',
      cast: [{ clip: 'celebrate', emotion: 'happy' }],
      environment: 'home', props: [], beat: 'transformation'
    },

    // --- scale --------------------------------------------------------------
    spread: {
      role: 'crowd', info: 'optional',
      cast: [{ clip: 'idle', emotion: 'nervous' }],
      environment: null, props: [], beat: 'growth'
    },
    grow: {
      role: 'crowd', info: 'often',
      cast: [{ clip: 'idle', emotion: 'happy' }],
      environment: null, props: [], beat: 'growth'
    },
    compare: {
      role: 'compare', info: 'optional',
      cast: [{ clip: 'point', emotion: 'confident' }, { clip: 'point', emotion: 'confused' }],
      environment: null, props: [], beat: 'compare'
    }
  };

  // Recognise the action from the beat's own words. Longest, most specific
  // patterns first so "sells" does not lose to "tells".
  const CUES = [
    [/\b(diagnos|examin|test result|symptom|checkup)\w*/i, 'diagnose'],
    [/\b(treat|medicat|prescrib|therapy|dose)\w*/i, 'treat'],
    [/\b(recover|heal|improv|got better|better now)\w*/i, 'recover'],
    [/\b(negotiat|deal|bargain|agree|split the cost|terms)\w*/i, 'negotiate'],
    [/\b(invest|portfolio|stake|shares|fund)\w*/i, 'invest'],
    [/\b(bought|buy|buys|purchas|customer|order)\w*/i, 'buy'],
    [/\b(sold|sell|sells|vendor|merchant)\w*/i, 'sell'],
    [/\b(argu|disagree|conflict|dispute|fought|blame)\w*/i, 'argue'],
    [/\b(fail|collaps|lost|bankrupt|ruin|went wrong)\w*/i, 'fail'],
    [/\b(celebrat|success|won|triumph|achiev|record)\w*/i, 'celebrate'],
    [/\b(struggl|difficult|hard time|couldn't|barely)\w*/i, 'struggle'],
    [/\b(decid|chose|choice|option|whether|dilemma)\w*/i, 'decide'],
    [/\b(exercis|workout|jog|train|gym|fitness)\w*/i, 'exercise'],
    [/\b(commut|travel|journey|walks? to|rush)\w*/i, 'commute'],
    [/\b(driv|car|vehicle|road trip)\w*/i, 'drive'],
    [/\b(eat|breakfast|lunch|dinner|meal|food)\w*/i, 'eat'],
    [/\b(stud|read|learn|revis|research)\w*/i, 'study'],
    [/\b(teach|taught|lesson|class|student)\w*/i, 'teach'],
    [/\b(work|job|office|desk|employee|typ)\w*/i, 'work'],
    [/\b(rest|sleep|relax|home|sofa)\w*/i, 'rest'],
    [/\b(spread|outbreak|epidemic|virus|contagio)\w*/i, 'spread'],
    [/\b(grew|grow|growth|population|expand|scal)\w*/i, 'grow'],
    [/\b(compar|versus|whereas|while others|two groups)\w*/i, 'compare'],
    [/\b(demonstrat|show|shows|illustrat)\w*/i, 'demonstrate'],
    [/\b(explain|means|because|reason|why)\w*/i, 'explain']
  ];

  function detect(text) {
    const t = String(text || '');
    for (const [re, action] of CUES) if (re.test(t)) return action;
    return null;
  }

  /**
   * Expand a beat into a full scene description.
   *
   * `info` is a REQUEST, not a command: 'never' means the beat is complete
   * without a chart, and forcing one in is what produced slideshows.
   */
  function expand(beat = {}) {
    const text = [beat.sceneSummary, beat.subtitle, beat.detectedAction].filter(Boolean).join(' ');
    const name = beat.action || detect(text) || 'explain';
    const a = ACTIONS[name] || ACTIONS.explain;
    const L = window.BlvckStageLayers;

    // The beat's own words beat the action's default: a script that says
    // "in the kitchen" wins over the action's usual setting.
    const inferredEnv = L ? L.inferEnvironment(text) : 'none';
    const environment = beat.environment
      || (inferredEnv !== 'none' ? inferredEnv : (a.environment || 'none'));

    const inferredProp = L ? L.inferProp(text) : null;
    const props = beat.props || (inferredProp ? [inferredProp] : a.props.slice());

    // Supporting information appears only when the action wants it AND the
    // beat actually supplies content for it.
    const hasContent = !!(beat.graphic && (beat.graphic.title || (beat.graphic.items || []).length));
    const wantsInfo = a.info === 'often' || (a.info === 'optional' && hasContent);
    const information = wantsInfo && beat.visualType &&
      ['chart', 'map', 'timeline', 'diagram', 'whiteboard'].indexOf(beat.visualType) > -1
      ? { kind: beat.visualType,
          title: (beat.graphic && beat.graphic.title) || beat.sceneSummary || '',
          items: (beat.graphic && beat.graphic.items) || [] }
      : null;

    return {
      index: beat.index || 0,
      subject: text,
      action: name,
      environment,
      prop: props[0] || null,
      props,
      beatDevice: a.beat || null,
      actors: {
        role: a.role,
        count: a.cast.length,
        cast: a.cast.map((c) => ({ action: c.clip, emotion: c.emotion })),
        labels: beat.actorLabels || []
      },
      information
    };
  }

  window.BlvckStoryActions = {
    ACTIONS,
    CUES,
    detect,
    expand,
    actions: () => Object.keys(ACTIONS)
  };
})();
