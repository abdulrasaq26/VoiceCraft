// Client-side prompt scaffolding — the single source of truth for every
// LLM prompt in Blvck-TTS. This lives in the browser (not on a server) so
// the whole app is a pure static site: it runs on Puter hosting, GitHub
// Pages, Netlify, or any file server, with no backend at all.
//
// window.BlvckPrompts exposes two methods keyed by a logical endpoint name
// (kept identical to the old /api/* paths so callers don't change):
//   build(endpoint, payload)          -> { system, user }
//   parse(endpoint, payload, rawText) -> the normalised result object
(() => {
  'use strict';

  // --- Shared -----------------------------------------------------------

  function extractJson(txt) {
    try {
      return JSON.parse(txt);
    } catch {
      const match = String(txt).match(/\{[\s\S]*\}/);
      if (match) {
        try {
          return JSON.parse(match[0]);
        } catch {
          /* fall through */
        }
      }
      throw new Error('The model did not return valid JSON.');
    }
  }

  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, d = '') => (v == null ? d : String(v));

  // --- Storyboard: channel identity -------------------------------------

  const CHANNEL_STYLE = [
    'Premium 2D historical illustration, semi-realistic painterly artwork.',
    'Cinematic storytelling composition with historical authenticity.',
    'Warm atmospheric lighting, rich environmental detail, storybook-quality visuals.',
    'Consistent color grading, "you-are-there" immersion, educational documentary feel.',
    'No text, no captions, no watermarks, no modern objects.'
  ].join(' ');

  const CHANNEL_NAME = 'Born Back Then';

  const CAMERAS = [
    'Wide Shot', 'Medium Shot', 'Close-Up', 'Overhead View',
    'Environment Shot', 'Object-Focused Shot', 'Crowd Scene', 'Character Scene'
  ];

  // --- Storyboard: story bible ------------------------------------------

  const BIBLE_SYSTEM = `You are an AI storyboard artist and story analyst for the faceless history YouTube channel "${CHANNEL_NAME}".
Read the ENTIRE story provided and build a "story bible" that will keep every generated image consistent.
Identify the main characters (with fixed, reusable visual descriptions covering face, hair, clothing, age, body type, and accessories), locations (with fixed architectural/lighting/weather descriptions), the historical period, the emotional tone, and recurring visual elements.
Respond ONLY with JSON of this exact shape:
{
  "title": string,
  "period": string,
  "tone": string,
  "colorGrading": string,
  "characters": [{ "name": string, "description": string }],
  "locations": [{ "name": string, "description": string }],
  "recurringElements": [string]
}
Descriptions must be concrete and visual so they can be pasted verbatim into image prompts.`;

  function buildContextBlock(context) {
    const parts = [];
    if (context.script) parts.push(`FULL SCRIPT:\n${context.script}`);
    if (context.subtitles) parts.push(`SUBTITLES:\n${context.subtitles}`);
    if (context.style) parts.push(`VISUAL STYLE GUIDE:\n${context.style}`);
    if (context.characters) parts.push(`CHARACTER REFERENCE:\n${context.characters}`);
    if (context.instructions) parts.push(`CUSTOM INSTRUCTIONS:\n${context.instructions}`);
    return parts.join('\n\n');
  }

  function biblePrompt(context) {
    return { system: BIBLE_SYSTEM, user: buildContextBlock(context) };
  }

  function normalizeBible(b) {
    return {
      title: String((b && b.title) || 'Untitled Story'),
      period: String((b && b.period) || ''),
      tone: String((b && b.tone) || ''),
      colorGrading: String((b && b.colorGrading) || ''),
      characters: Array.isArray(b && b.characters) ? b.characters.slice(0, 30) : [],
      locations: Array.isArray(b && b.locations) ? b.locations.slice(0, 30) : [],
      recurringElements: Array.isArray(b && b.recurringElements) ? b.recurringElements.slice(0, 30) : []
    };
  }

  // --- Storyboard: scene prompts ----------------------------------------

  const SCENES_SYSTEM = `You are an AI storyboard artist for the faceless history channel "${CHANNEL_NAME}".
You are given a story bible and a batch of subtitle cues (one scene each). For EACH cue, decide the best cinematic shot and write a complete, self-contained image prompt.
Rules:
- Understand context across the whole story: resolve who "he"/"she"/"they" refer to using the bible, and place each scene in the correct location and era.
- Maintain character consistency: when a character appears, paste their exact visual description from the bible into the prompt.
- Maintain location continuity: reuse the same architecture, lighting, and weather for scenes in the same place.
- Vary the camera across the batch (wide, medium, close-up, overhead, environment, object, crowd, character) to maximise visual interest. Avoid repeating the same shot back-to-back.
- Every prompt MUST embed the channel style verbatim: "${CHANNEL_STYLE}"
- Faceless channel: prefer atmospheric, environmental and over-the-shoulder framing; avoid clear modern faces staring at camera.
Respond ONLY with JSON:
{
  "scenes": [
    {
      "index": number,
      "sceneType": string,
      "camera": string,
      "visualFocus": string,
      "sceneSummary": string,
      "prompt": string
    }
  ]
}`;

  function scenesPrompt(payload) {
    const { bible, cues, style, instructions, priorSummaries } = payload;
    const parts = [
      `STORY BIBLE:\n${JSON.stringify(bible, null, 2)}`,
      style ? `EXTRA VISUAL STYLE / RULES:\n${style}` : '',
      instructions ? `EXTRA GENERATION INSTRUCTIONS:\n${instructions}` : '',
      priorSummaries && priorSummaries.length
        ? `PREVIOUS SCENES (for continuity):\n${priorSummaries.join('\n')}`
        : '',
      `CUES TO STORYBOARD (generate one scene per cue, echo each index):\n${cues
        .map((c) => `#${c.index} [${c.timestamp || ''}] ${c.text}`)
        .join('\n')}`
    ].filter(Boolean);
    return { system: SCENES_SYSTEM, user: parts.join('\n\n') };
  }

  function normalizeScene(s, cue, cues) {
    const idx = Number.isFinite(s && s.index) ? s.index : cue ? cue.index : 0;
    const source = cue || (cues || []).find((c) => c.index === idx) || {};
    const prompt = String((s && s.prompt) || '').trim() || `${source.text || ''}. ${CHANNEL_STYLE}`;
    const withStyle = prompt.includes('Premium 2D historical') ? prompt : `${prompt} ${CHANNEL_STYLE}`;
    return {
      index: idx,
      timestamp: source.timestamp || '',
      subtitle: source.text || '',
      sceneType: String((s && s.sceneType) || 'Scene'),
      camera: String((s && s.camera) || 'Medium Shot'),
      visualFocus: String((s && s.visualFocus) || ''),
      sceneSummary: String((s && s.sceneSummary) || source.text || ''),
      prompt: withStyle
    };
  }

  function parseScenes(rawText, cues) {
    const result = extractJson(rawText);
    const scenes = Array.isArray(result && result.scenes) ? result.scenes : [];
    return { scenes: scenes.map((s, i) => normalizeScene(s, cues[i], cues)) };
  }

  // --- YouTube SEO ------------------------------------------------------

  const SEO_SYSTEM = `You are an elite YouTube strategist and SEO specialist for faceless storytelling channels.
Given a video's story and the channel's brand knowledge base, produce a COMPLETE optimization package that maximises search ranking and click-through while staying perfectly on-brand.
Respect the channel's brand voice, title patterns, thumbnail style and SEO strategy so every video looks and reads like the same channel.
Respond ONLY with JSON of this exact shape (scores are integers 0-100):
{
  "titles": {
    "seo": [{ "title": string, "seoScore": int, "ctrScore": int, "competitionScore": int, "readabilityScore": int, "usage": string }],
    "ctr": [ ...same shape ],
    "balanced": [ ...same shape ]
  },
  "recommendedTitle": string,
  "description": { "long": string, "short": string },
  "keywords": { "primary": string, "secondary": [string], "longTail": [string], "intent": string },
  "tags": { "broad": [string], "niche": [string], "longTail": [string], "trending": [string] },
  "hashtags": { "highVolume": [string], "niche": [string], "brand": [string] },
  "thumbnails": [
    { "version": "A", "text": string, "visualFocus": string, "emotionalTrigger": string, "curiosityTrigger": string, "reasoning": string, "prompt": string,
      "scores": { "curiosity": int, "ctr": int, "readability": int, "mobile": int, "brand": int } },
    { "version": "B", ...same shape }
  ],
  "recommendedThumbnail": "A"
}
Give 10 titles in each of the three categories. The "long" description must include a hook paragraph, a summary, keywords woven in, a call-to-action, a channel-links placeholder, and a credits section. Thumbnail "prompt" must be a complete image-generation prompt with composition, subject, lighting, colour grading, visual hierarchy and clear negative space reserved for overlay text. Hashtags include the leading #.`;

  function seoPrompt(project, channel) {
    const parts = [];
    parts.push(`VIDEO TITLE / WORKING NAME: ${project.title || 'Untitled'}`);
    if (project.bible) parts.push(`STORY BIBLE:\n${JSON.stringify(project.bible, null, 2)}`);
    if (project.script) parts.push(`SCRIPT / NARRATION:\n${String(project.script).slice(0, 8000)}`);
    else if (project.subtitles) parts.push(`SUBTITLES:\n${String(project.subtitles).slice(0, 8000)}`);
    parts.push(`CHANNEL KNOWLEDGE BASE:\n${JSON.stringify(channel || {}, null, 2)}`);
    return { system: SEO_SYSTEM, user: parts.join('\n\n') };
  }

  function clampScore(v) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0;
  }
  function normTitle(t) {
    return {
      title: str(t && t.title),
      seoScore: clampScore(t && t.seoScore),
      ctrScore: clampScore(t && t.ctrScore),
      competitionScore: clampScore(t && t.competitionScore),
      readabilityScore: clampScore(t && t.readabilityScore),
      usage: str(t && t.usage)
    };
  }
  function normThumb(t, version) {
    const s = (t && t.scores) || {};
    return {
      version: str(t && t.version, version),
      text: str(t && t.text),
      visualFocus: str(t && t.visualFocus),
      emotionalTrigger: str(t && t.emotionalTrigger),
      curiosityTrigger: str(t && t.curiosityTrigger),
      reasoning: str(t && t.reasoning),
      prompt: str(t && t.prompt),
      scores: {
        curiosity: clampScore(s.curiosity),
        ctr: clampScore(s.ctr),
        readability: clampScore(s.readability),
        mobile: clampScore(s.mobile),
        brand: clampScore(s.brand)
      }
    };
  }
  function normalizeSeo(j, project) {
    j = j || {};
    const t = j.titles || {};
    const titles = {
      seo: arr(t.seo).map(normTitle).filter((x) => x.title),
      ctr: arr(t.ctr).map(normTitle).filter((x) => x.title),
      balanced: arr(t.balanced).map(normTitle).filter((x) => x.title)
    };
    const allTitles = [...titles.seo, ...titles.ctr, ...titles.balanced];
    return {
      generatedAt: Date.now(),
      project: project.title || 'Untitled',
      titles,
      recommendedTitle: str(j.recommendedTitle) || (allTitles[0] && allTitles[0].title) || project.title || '',
      description: {
        long: str(j.description && j.description.long),
        short: str(j.description && j.description.short)
      },
      keywords: {
        primary: str(j.keywords && j.keywords.primary),
        secondary: arr(j.keywords && j.keywords.secondary).map(String),
        longTail: arr(j.keywords && j.keywords.longTail).map(String),
        intent: str(j.keywords && j.keywords.intent)
      },
      tags: {
        broad: arr(j.tags && j.tags.broad).map(String),
        niche: arr(j.tags && j.tags.niche).map(String),
        longTail: arr(j.tags && j.tags.longTail).map(String),
        trending: arr(j.tags && j.tags.trending).map(String)
      },
      hashtags: {
        highVolume: arr(j.hashtags && j.hashtags.highVolume).map(String),
        niche: arr(j.hashtags && j.hashtags.niche).map(String),
        brand: arr(j.hashtags && j.hashtags.brand).map(String)
      },
      thumbnails: arr(j.thumbnails).map((x, i) => normThumb(x, i === 0 ? 'A' : 'B')).slice(0, 4),
      recommendedThumbnail: str(j.recommendedThumbnail, 'A')
    };
  }

  // --- Script generator -------------------------------------------------

  const TYPE_BRIEFS = {
    youtube:
      'a YouTube video narration script for a faceless storytelling channel. Write a scroll-stopping cold-open hook in the first two sentences, then deliver the story in clear spoken-word paragraphs.',
    historical:
      'a historical storytelling narration — vivid, cinematic, and immersive, placing the listener inside the period. Open in the middle of a compelling moment, then widen out.',
    documentary:
      'a documentary narration script with an authoritative, measured voice. Lead with an intriguing question or striking fact, then unfold the subject in a logical, evidence-led arc.',
    educational:
      'an educational narration script that teaches the topic clearly. Open with why it matters, explain step by step in plain language, and end with a memorable takeaway.',
    shorts:
      'a short-form vertical-video script (YouTube Shorts / Reels / TikTok), 30–60 seconds of spoken narration. Hook in the first 3 words, one tight idea, punchy payoff, no wasted words.',
    podcast:
      'a podcast episode script in a natural spoken register — a warm cold-open, conversational segments with smooth transitions, and a sign-off.',
    audiobook:
      'an audiobook-style narration passage — flowing, literary prose meant to be read aloud at length, with rich description and an even, immersive rhythm.'
  };

  const LENGTH_GUIDE = {
    short: 'about 150 words',
    medium: 'about 400 words',
    long: 'about 800 words',
    xlong: 'about 1500 words'
  };

  const SCRIPT_SYSTEM = `You are an elite scriptwriter for faceless storytelling and educational video channels.
You write scripts meant to be spoken aloud by a text-to-speech narrator, so:
- Output ONLY the spoken narration text. No headings, no stage directions, no "[MUSIC]" or "[PAUSE]" markers, no camera notes, no markdown, no speaker labels.
- Write in flowing paragraphs of natural spoken English. Vary sentence length for rhythm.
- Do not include a word count or any commentary about the script — just the script itself.`;

  function scriptPrompt(opts) {
    opts = opts || {};
    const type = String(opts.type || 'youtube');
    const brief = TYPE_BRIEFS[type] || TYPE_BRIEFS.youtube;
    const length = LENGTH_GUIDE[opts.length] || LENGTH_GUIDE.medium;
    const tone = String(opts.tone || 'cinematic and dramatic').trim();
    const audience = String(opts.audience || '').trim();
    const topic = String(opts.topic || '').trim();

    const lines = [
      `Write ${brief}`,
      `TOPIC / BRIEF: ${topic || '(none given — pick a compelling topic that fits the type)'}`,
      `TARGET LENGTH: ${length}.`,
      `TONE: ${tone}.`
    ];
    if (audience) lines.push(`TARGET AUDIENCE: ${audience}.`);
    if (opts.retention) {
      lines.push(
        'RETENTION: open with a strong hook, use open loops and pattern interrupts to sustain attention, and re-engage the listener at natural drop-off points. Keep momentum from the first word to the last.'
      );
    }
    lines.push('Remember: output only the spoken narration, nothing else.');
    return { system: SCRIPT_SYSTEM, user: lines.join('\n') };
  }

  function cleanScript(raw) {
    let text = String(raw || '').trim();
    text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '');
    text = text.replace(/^\s*(title|script)\s*:.*$/im, '').trim();
    return text;
  }

  // --- Endpoint registry (keys match the old /api/* paths) --------------

  const ROUTES = {
    '/api/storyboard/bible': {
      build: (p) => biblePrompt(p.context || {}),
      parse: (p, rawText) => ({ bible: normalizeBible(extractJson(rawText)) })
    },
    '/api/storyboard/scenes': {
      build: (p) => scenesPrompt(p),
      parse: (p, rawText) => parseScenes(rawText, p.cues || [])
    },
    '/api/seo/generate': {
      build: (p) => seoPrompt(p.project || {}, p.channel || {}),
      parse: (p, rawText) => ({ seo: normalizeSeo(extractJson(rawText), p.project || {}) })
    },
    '/api/script/generate': {
      build: (p) => scriptPrompt(p.options || {}),
      // Script output is plain narration text, not JSON — just clean it.
      parse: (p, rawText) => ({ script: cleanScript(rawText) })
    }
  };

  window.BlvckPrompts = {
    build(endpoint, payload) {
      const route = ROUTES[endpoint];
      if (!route) throw new Error(`Unknown prompt endpoint: ${endpoint}`);
      return route.build(payload || {});
    },
    parse(endpoint, payload, rawText) {
      const route = ROUTES[endpoint];
      if (!route) throw new Error(`Unknown prompt endpoint: ${endpoint}`);
      return route.parse(payload || {}, rawText);
    },
    extractJson,
    CHANNEL_STYLE,
    CHANNEL_NAME,
    CAMERAS
  };
})();
