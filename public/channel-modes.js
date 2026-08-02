// Channel modes — what KIND of video this is.
//
// A mode is not a colour scheme. It changes three concrete things:
//
//   1. the visual mix the Director aims for (a history video is mostly maps and
//      timelines; a business video is mostly charts and presenter),
//   2. how present the host is, and at what size,
//   3. the language the Director is briefed in.
//
// Encoded as data rather than prose so the mix can actually be checked against
// the plan afterwards. "Make it feel like a documentary" is not something you
// can verify; "no more than 15% presenter beats" is.
(() => {
  'use strict';

  const LS_KEY = 'blvck-tts:channel-mode';

  // `mix` values are target SHARES of the beats in a video and should sum to
  // roughly 1. They are guidance for the Director and a yardstick for the
  // plan report, not a hard quota — a script that genuinely has no numbers in
  // it should not be forced to grow a chart.
  const MODES = [
    {
      id: 'documentary',
      label: 'Documentary',
      inspiration: 'Johnny Harris, MagnatesMedia, RealLifeLore',
      host: { layout: 'corner', size: 'medium', share: 0.15 },
      mix: { t2v: 0.45, broll: 0.15, map: 0.15, timeline: 0.1, chart: 0.05, presenter: 0.1 },
      style: 'cinematic documentary, natural light, handheld realism, muted contemporary grade',
      guidance:
        'Investigative documentary. Lead with filmed moments and let maps and timelines carry the ' +
        'factual spine. The host appears at section boundaries and for direct address, not throughout. ' +
        'Favour Static and Slow Push In; save Drone for genuine geographic scale.'
    },
    {
      id: 'educational',
      label: 'Educational explainer',
      inspiration: 'Veritasium, Kurzgesagt, Crash Course',
      host: { layout: 'circle', size: 'medium', share: 0.3 },
      mix: { whiteboard: 0.3, t2v: 0.25, chart: 0.15, presenter: 0.15, timeline: 0.1, broll: 0.05 },
      style: 'clean bright explainer, uncluttered compositions, high key lighting',
      guidance:
        'Teaching, not reporting. Whenever a beat explains a mechanism, a process or a cause-and-effect ' +
        'chain, make it a whiteboard rather than footage — a drawn explanation beats a stock shot of ' +
        'someone thinking. Keep the host present so the viewer has someone to learn from.'
    },
    {
      id: 'business',
      label: 'Business breakdown',
      inspiration: 'Alex Hormozi, Codie Sanchez, Ali Abdaal',
      host: { layout: 'rect', size: 'large', share: 0.4 },
      mix: { presenter: 0.3, chart: 0.25, t2v: 0.2, whiteboard: 0.15, broll: 0.1 },
      style: 'modern studio look, crisp contrast, confident clean framing',
      guidance:
        'Creator-to-camera business content. The host carries the argument, so they are on screen far ' +
        'more than in a documentary. Every claim about money, growth or share becomes a chart — numbers ' +
        'spoken aloud are forgotten, numbers shown are remembered.'
    },
    {
      id: 'history',
      label: 'History',
      inspiration: 'HistoryMarche, Kings and Generals, Oversimplified',
      host: { layout: 'none', size: 'medium', share: 0.05 },
      mix: { t2v: 0.4, map: 0.25, timeline: 0.15, broll: 0.1, presenter: 0.05, chart: 0.05 },
      style: 'cinematic period reconstruction, dramatic natural light, painterly depth',
      guidance:
        'Narrated history. Maps carry movement and territory; timelines carry sequence. Reconstruction ' +
        'shots should be atmospheric rather than literal — texture, light, hands, landscape — because ' +
        'specific historical figures rendered by a model look wrong and break the spell. Host is rare.'
    },
    {
      id: 'health',
      label: 'Health & wellness',
      inspiration: 'presenter-led medical explainers',
      // The brief: main content 80-90% of the frame, host window 10-20%. That
      // is exactly a small corner overlay, kept up for most of the video.
      host: { layout: 'circle', size: 'small', share: 0.6 },
      mix: { whiteboard: 0.25, t2v: 0.25, chart: 0.15, broll: 0.15, presenter: 0.1, timeline: 0.1 },
      style: 'clean clinical documentary, soft natural light, calm uncluttered framing',
      guidance:
        'Presenter-led health explainer. The host stays in a SMALL corner window for most of the video ' +
        'while diagrams, anatomy visuals and charts hold the main frame — the viewer wants the ' +
        'information foregrounded and a trusted person alongside it, not a talking head. Reserve full ' +
        'presenter shots for the opening and closing. Avoid alarming imagery; keep it calm and factual.'
    },
    {
      id: 'faceless',
      label: 'Faceless documentary',
      inspiration: 'narration-only cinematic channels',
      host: { layout: 'none', size: 'medium', share: 0 },
      mix: { t2v: 0.5, broll: 0.2, map: 0.12, timeline: 0.1, chart: 0.08 },
      style: 'cinematic, atmospheric, strong silhouettes and negative space',
      guidance:
        'No presenter at any point. The narration and the footage carry everything, so visual variety ' +
        'has to do the work a host would otherwise do — vary shot type and scale aggressively and let ' +
        'graphics break up long runs of footage.'
    }
  ];

  function byId(id) {
    return MODES.find((m) => m.id === String(id || '').toLowerCase()) || null;
  }

  function current() {
    let id = '';
    try {
      id = String(localStorage.getItem(LS_KEY) || '');
    } catch {
      id = '';
    }
    return byId(id) || MODES[0];
  }

  function setCurrent(id) {
    try {
      localStorage.setItem(LS_KEY, String(id || ''));
    } catch {
      /* non-fatal */
    }
    try {
      window.dispatchEvent(new CustomEvent('blvck:mode-changed'));
    } catch {
      /* no-op */
    }
    return current();
  }

  // Brief text handed to the Director. Includes the numeric targets, because a
  // model given "mostly maps" will drift and a model given "about 25% map"
  // usually will not.
  function briefFor(mode) {
    const m = mode || current();
    const mix = Object.entries(m.mix)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k} ~${Math.round(v * 100)}%`)
      .join(', ');
    const hostLine = m.host.share <= 0
      ? 'The host NEVER appears. Every hostOverlay must be "none".'
      : `The host should be visible in roughly ${Math.round(m.host.share * 100)}% of beats, ` +
        `normally as "${m.host.layout}". Use "full" only for the opening and closing.`;
    return [
      `CHANNEL MODE: ${m.label}${m.inspiration ? ` (in the tradition of ${m.inspiration})` : ''}`,
      m.guidance,
      `TARGET VISUAL MIX: ${mix}. Treat these as targets, not quotas — never invent a chart for a beat with no numbers in it.`,
      hostLine,
      `VISUAL STYLE: ${m.style}`
    ].join('\n');
  }

  // How far a produced plan drifted from the mode's intent. Returns the biggest
  // offenders so the user can see "this came out 80% t2v" before paying for it.
  function compareMix(mode, counts) {
    const m = mode || current();
    const total = Object.values(counts || {}).reduce((a, b) => a + b, 0);
    if (!total) return [];
    const notes = [];
    for (const [type, target] of Object.entries(m.mix)) {
      const actual = (counts[type] || 0) / total;
      const drift = actual - target;
      if (Math.abs(drift) >= 0.2) {
        notes.push(
          `${type}: ${Math.round(actual * 100)}% vs ~${Math.round(target * 100)}% intended`
        );
      }
    }
    return notes;
  }

  window.BlvckModes = { MODES, byId, current, setCurrent, briefFor, compareMix };
})();
