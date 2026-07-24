// Client-side prompt scaffolding — the single source of truth for every
// LLM prompt in Blvck-TTS. Lives in the browser so the app is a pure static
// site (runs on Puter hosting, GitHub Pages, Netlify, any file server).
//
// window.BlvckPrompts exposes two methods keyed by a logical endpoint name
// (kept identical to the old /api/* paths so callers don't change):
//   build(endpoint, payload)          -> { system, user }
//   parse(endpoint, payload, rawText) -> the normalised result object
// window.VISUAL_STYLES — the selectable visual-style catalog for storyboards.
(() => {
  'use strict';

  // --- Robust JSON extraction / repair ----------------------------------
  // Models sometimes wrap JSON in prose, code fences, comments, smart quotes
  // or trailing commas. Repair the common cases before parsing.
  function repairJson(text) {
    let s = String(text == null ? '' : text).trim();
    // Strip Markdown code fences (```json … ``` or ``` … ```).
    s = s.replace(/^```[a-zA-Z]*\s*/,'').replace(/```\s*$/,'');
    // Extract the largest {...} span (first { to last }).
    const first = s.indexOf('{');
    const last = s.lastIndexOf('}');
    if (first !== -1 && last !== -1 && last > first) s = s.slice(first, last + 1);
    // Normalise smart quotes to straight quotes.
    s = s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'");
    // Remove // line comments and /* */ block comments.
    s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:"'])\/\/[^\n\r]*/g, '$1');
    // Remove trailing commas before } or ].
    s = s.replace(/,(\s*[}\]])/g, '$1');
    return s.trim();
  }

  function extractJson(text) {
    try {
      return JSON.parse(text);
    } catch { /* try repair */ }
    const repaired = repairJson(text);
    try {
      return JSON.parse(repaired);
    } catch {
      const err = new Error('The model did not return valid JSON.');
      err.raw = String(text || '');
      throw err;
    }
  }

  const arr = (v) => (Array.isArray(v) ? v : []);
  const str = (v, d = '') => (v == null ? d : String(v));

  // --- Visual style catalog ---------------------------------------------
  // Each style maps to a concrete render brief that gets embedded verbatim in
  // every image prompt, plus a negative brief. "auto" lets the AI infer the
  // right look from the content — no style is hardcoded into the pipeline.
  const VISUAL_STYLES = {
    auto: { label: 'Auto — infer from content', render: '', negative: '' },
    '2d-animation': { label: '2D Animation', render: 'Flat 2D animation, clean bold linework, cel shading, vibrant saturated colors, expressive character design', negative: 'photorealistic, 3d render, live action' },
    '3d-animation': { label: '3D Animation (Pixar-style)', render: 'Polished 3D animated feature-film style, soft global illumination, rounded appealing character design, subsurface skin, Pixar / DreamWorks quality', negative: 'flat 2d, sketch, photoreal' },
    anime: { label: 'Anime', render: 'Modern anime style, crisp cel shading, dramatic lighting, detailed backgrounds, expressive eyes, Studio-quality key art', negative: 'western cartoon, 3d, photoreal' },
    realistic: { label: 'Realistic', render: 'Realistic digital painting, accurate anatomy and materials, natural lighting, high detail', negative: 'cartoon, anime, low detail' },
    cinematic: { label: 'Cinematic', render: 'Cinematic film still, dramatic lighting, shallow depth of field, filmic color grade, anamorphic composition, high production value', negative: 'flat lighting, snapshot, cartoon' },
    photorealistic: { label: 'Photorealistic', render: 'Photorealistic photograph, 50mm lens, natural lighting, true-to-life detail, realistic textures and depth', negative: 'illustration, painting, cartoon, cgi look' },
    documentary: { label: 'Documentary', render: 'Documentary photography style, natural available light, candid framing, authentic real-world detail', negative: 'staged, cartoon, over-stylized' },
    'oil-painting': { label: 'Oil Painting', render: 'Traditional oil painting, visible brushwork, rich impasto texture, classical composition and lighting', negative: 'digital, flat, photographic' },
    watercolor: { label: 'Watercolor', render: 'Soft watercolor illustration, delicate washes, bleeding pigments, paper texture, gentle palette', negative: 'harsh lines, 3d, photoreal' },
    'comic-book': { label: 'Comic Book', render: 'Comic book art, bold ink outlines, halftone shading, dynamic action framing, punchy colors', negative: 'photoreal, soft painterly' },
    storybook: { label: 'Storybook Illustration', render: 'Warm storybook illustration, soft painterly shapes, cozy inviting palette, gentle whimsical detail', negative: 'photoreal, gritty, harsh' },
    'historical-illustration': { label: 'Historical Illustration', render: 'Premium semi-realistic 2D historical illustration, painterly artwork, era-accurate architecture, costume and props, warm atmospheric lighting, museum-quality detail', negative: 'modern objects, anachronisms, cartoon, text' },
    'low-poly': { label: 'Low Poly 3D', render: 'Low-poly 3D render, faceted geometric forms, flat shading, clean minimal palette', negative: 'photoreal, high detail, painterly' },
    isometric: { label: 'Isometric', render: 'Clean isometric illustration, 2:1 axonometric projection, tidy geometry, bright flat colors', negative: 'perspective distortion, photoreal' },
    'concept-art': { label: 'Concept Art', render: 'Professional concept art, painterly rendering, strong value composition, atmospheric depth, cinematic scale', negative: 'flat, amateur, snapshot' },
    'childrens-book': { label: "Children's Book", render: 'Friendly children’s book illustration, rounded shapes, bright cheerful colors, simple clear composition, gentle characters', negative: 'scary, gritty, photoreal, complex' },
    'graphic-novel': { label: 'Graphic Novel', render: 'Graphic novel art, moody inking, textured shading, cinematic panels, restrained noir palette', negative: 'cheerful cartoon, photoreal' },
    vintage: { label: 'Vintage Artwork', render: 'Vintage mid-century illustration, aged paper texture, muted retro palette, screen-print feel', negative: 'modern digital, photoreal, neon' },
    'modern-digital': { label: 'Modern Digital Art', render: 'Modern digital illustration, clean vector-influenced shapes, confident color, contemporary editorial style', negative: 'photoreal, dated, painterly' },
    'modern-explainer': { label: 'Modern Explainer Graphics', render: 'Clean modern explainer illustration, flat vector shapes, bold friendly colors, simple iconography, generous negative space, editorial infographic feel', negative: 'photoreal, historical, gritty, cluttered' },
    infographic: { label: 'Infographic / Data Visual', render: 'Infographic visual storytelling, clean charts and icons, bold flat colors, clear hierarchy, modern data-viz aesthetic', negative: 'photoreal, painterly, cluttered' },
    'motion-graphics': { label: 'Motion Graphics', render: 'Motion-graphics keyframe style, bold flat shapes, gradients, dynamic layout, sleek modern brand look', negative: 'photoreal, sketchy, historical' },
    whiteboard: { label: 'Whiteboard Explainer', render: 'Whiteboard-style line illustration, hand-drawn marker look, simple black strokes on white, clear diagrammatic figures', negative: 'color-heavy, photoreal, painterly' },
    'tech-ui': { label: 'Tech / UI Style', render: 'Modern tech illustration, sleek UI-inspired shapes, cool gradients, glassy surfaces, clean product-design aesthetic', negative: 'historical, painterly, photoreal grit' },
    lifestyle: { label: 'Contemporary Lifestyle', render: 'Clean contemporary lifestyle photography, bright natural light, relatable modern settings, aspirational but authentic', negative: 'historical, cartoon, dark, staged studio' }
  };

  function styleBrief(id) {
    const s = VISUAL_STYLES[id];
    return s && s.render ? s : null;
  }

  // --- Storyboard: story + visual-profile analyzer ("bible") -------------

  const BIBLE_SYSTEM = `You are a senior story analyst and visual director for AI-generated video. You will read ALL of the provided material and produce a project profile that drives consistent, on-topic image/video generation.

CRITICAL: Determine the visual identity FROM THE CONTENT. Do NOT assume the project is historical, medieval, 2D, or fiction. A finance explainer must look like modern finance visuals; a cooking video like food photography; a sci-fi story like cinematic sci-fi; a children's lesson like a children's book. Infer genre, era, setting, tone, audience and format (documentary vs narrative, educational vs entertainment) from what is actually written.

Identify recurring characters with FIXED, reusable visual descriptions (face, hair, age, build, clothing, accessories) and locations with fixed architectural/lighting/weather descriptions, so they stay consistent across scenes.

Respond ONLY with JSON of this exact shape:
{
  "title": string,
  "subject": string,
  "genre": string,
  "period": string,           // era / time; "Contemporary" if modern
  "setting": string,
  "tone": string,
  "audience": string,
  "format": string,           // e.g. "documentary", "narrative", "educational explainer"
  "visualStyle": {
    "name": string,           // short label, e.g. "Modern explainer graphics"
    "description": string,    // concrete render instructions to paste into every image prompt
    "lighting": string,
    "colorGrading": string,
    "negative": string        // things to avoid (anachronisms, wrong medium, etc.)
  },
  "characters": [{ "name": string, "description": string }],
  "locations": [{ "name": string, "description": string }],
  "recurringElements": [string],
  "continuity": string        // notes to keep the look consistent across scenes
}
Descriptions must be concrete and visual so they can be pasted verbatim into image prompts.`;

  function buildContextBlock(context) {
    const parts = [];
    if (context.script) parts.push(`FULL SCRIPT:\n${context.script}`);
    if (context.subtitles) parts.push(`SUBTITLES / TIMED LINES:\n${context.subtitles}`);
    if (context.style) parts.push(`VISUAL STYLE GUIDE (from uploaded file):\n${context.style}`);
    if (context.characters) parts.push(`CHARACTER REFERENCE (from uploaded file):\n${context.characters}`);
    if (context.instructions) parts.push(`CUSTOM INSTRUCTIONS (from uploaded file):\n${context.instructions}`);
    // Style direction from the UI.
    const chosen = styleBrief(context.styleChoice);
    if (chosen) {
      parts.push(`REQUIRED VISUAL STYLE (user-selected — build visualStyle around this and do not override it):\n${chosen.label}: ${chosen.render}${chosen.negative ? `\nAvoid: ${chosen.negative}` : ''}`);
    } else {
      parts.push('VISUAL STYLE: The user chose "Auto" — infer the single most fitting visual style for THIS content. Do not default to historical/medieval/2D unless the content is genuinely historical.');
    }
    if (context.styleNotes) parts.push(`EXTRA STYLE NOTES (preset):\n${context.styleNotes}`);
    return parts.join('\n\n');
  }

  function biblePrompt(context) {
    return { system: BIBLE_SYSTEM, user: buildContextBlock(context || {}) };
  }

  function normalizeBible(b) {
    b = b || {};
    const vs = b.visualStyle || {};
    return {
      title: str(b.title, 'Untitled Project'),
      subject: str(b.subject),
      genre: str(b.genre),
      period: str(b.period),
      setting: str(b.setting),
      tone: str(b.tone),
      audience: str(b.audience),
      format: str(b.format),
      visualStyle: {
        name: str(vs.name, 'Cinematic'),
        description: str(vs.description, 'Cohesive, high-quality visuals with consistent lighting and color.'),
        lighting: str(vs.lighting),
        colorGrading: str(vs.colorGrading),
        negative: str(vs.negative)
      },
      characters: arr(b.characters).slice(0, 40),
      locations: arr(b.locations).slice(0, 40),
      recurringElements: arr(b.recurringElements).slice(0, 40).map(String),
      continuity: str(b.continuity)
    };
  }

  // --- Storyboard: scene prompts (style comes from the bible) -------------

  const SCENES_SYSTEM = `You are an expert storyboard artist and visual director. You are given a project profile (with a defined visual style, characters and locations) and a batch of story beats. For EACH beat, write a complete, self-contained image/video prompt.

Rules:
- Depict what actually happens in the beat. Resolve who "he/she/they" refer to using the profile; place each beat in the correct location and era.
- Embed the project's visual style VERBATIM in every prompt (its description, lighting and color grading). Never substitute a different style. Never add historical/medieval styling unless the profile says so.
- Maintain character consistency: when a character appears, paste their exact description from the profile.
- Maintain location continuity: reuse the same architecture, lighting and weather for the same place.
- Vary the camera across the batch (wide, medium, close-up, over-the-shoulder, overhead, detail, establishing) to keep visual interest.
- Honor the profile's negative guidance (things to avoid).
Respond ONLY with JSON:
{
  "scenes": [
    {
      "index": number,          // echo the beat index
      "sceneType": string,      // e.g. "Establishing", "Reaction", "Detail"
      "camera": string,
      "detectedAction": string, // what is happening in this beat, one line
      "visualGoal": string,     // the emotional/narrative goal of the shot
      "visualFocus": string,    // the subject of the frame
      "characters": [string],   // names (from the profile) of characters visible in this beat
      "sceneSummary": string,
      "prompt": string          // full prompt with the project's visual style embedded
    }
  ]
}`;

  function scenesPrompt(payload) {
    const { bible, cues, style, instructions, priorSummaries } = payload;
    const vs = (bible && bible.visualStyle) || {};
    const styleLine = `PROJECT VISUAL STYLE (embed this in every prompt):\n${vs.name || ''} — ${vs.description || ''}${vs.lighting ? `\nLighting: ${vs.lighting}` : ''}${vs.colorGrading ? `\nColor grading: ${vs.colorGrading}` : ''}${vs.negative ? `\nAvoid: ${vs.negative}` : ''}`;
    const parts = [
      `PROJECT PROFILE:\n${JSON.stringify(bible, null, 2)}`,
      styleLine,
      style ? `EXTRA VISUAL RULES:\n${style}` : '',
      instructions ? `EXTRA INSTRUCTIONS:\n${instructions}` : '',
      priorSummaries && priorSummaries.length
        ? `PREVIOUS BEATS (for continuity):\n${priorSummaries.join('\n')}`
        : '',
      `STORY BEATS TO STORYBOARD (one scene per beat, echo each index):\n${cues
        .map((c) => `#${c.index} [${c.timestamp || ''}] ${c.text}`)
        .join('\n')}`
    ].filter(Boolean);
    return { system: SCENES_SYSTEM, user: parts.join('\n\n') };
  }

  function normalizeScene(s, cue, cues, bible) {
    const idx = Number.isFinite(s && s.index) ? s.index : cue ? cue.index : 0;
    const source = cue || (cues || []).find((c) => c.index === idx) || {};
    let prompt = str(s && s.prompt).trim() || str(source.text);
    // Safety net: ensure the project's visual style is embedded even if the
    // model forgot it. No hardcoded style — this comes from the bible.
    const vs = (bible && bible.visualStyle) || {};
    if (vs.description && prompt && !prompt.toLowerCase().includes((vs.description.split(/[,.]/)[0] || '').toLowerCase().slice(0, 18))) {
      prompt = `${prompt} — ${vs.description}${vs.lighting ? `, ${vs.lighting}` : ''}`;
    }
    return {
      index: idx,
      timestamp: source.timestamp || '',
      subtitle: source.text || '',
      sceneType: str(s && s.sceneType, 'Scene'),
      camera: str(s && s.camera, 'Medium Shot'),
      detectedAction: str(s && s.detectedAction),
      visualGoal: str(s && s.visualGoal),
      visualFocus: str(s && s.visualFocus),
      characters: arr(s && s.characters).map(String).slice(0, 8),
      sceneSummary: str(s && s.sceneSummary, source.text || ''),
      prompt
    };
  }

  function parseScenes(rawText, cues, bible) {
    const result = extractJson(rawText);
    const scenes = Array.isArray(result && result.scenes) ? result.scenes : [];
    if (!scenes.length) {
      const err = new Error('Missing "scenes" array in the model response.');
      err.raw = String(rawText || '');
      throw err;
    }
    return { scenes: scenes.map((s, i) => normalizeScene(s, cues[i], cues, bible)) };
  }

  // --- YouTube SEO ------------------------------------------------------

  const SEO_SYSTEM = `You are an elite YouTube growth strategist and SEO specialist who thinks like the recommendation algorithm and like a viewer deciding whether to click.
Given a video's story and the channel's brand knowledge base, produce a COMPLETE optimization package that maximises search ranking AND click-through while staying perfectly on-brand.
Titles should use proven curiosity and value patterns without clickbait that underdelivers. Descriptions should front-load the hook and keywords. Thumbnails should be simple, high-contrast and readable at small sizes.
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
    if (project.bible) parts.push(`PROJECT PROFILE:\n${JSON.stringify(project.bible, null, 2)}`);
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

  const SCRIPT_SYSTEM = `You are an elite scriptwriter for faceless storytelling and educational video channels, known for retention-obsessed openings and natural spoken rhythm.
You write scripts meant to be spoken aloud by a text-to-speech narrator, so:
- Output ONLY the spoken narration text. No headings, no stage directions, no "[MUSIC]" or "[PAUSE]" markers, no camera notes, no markdown, no speaker labels.
- Open with a genuine hook — a question, a striking image, or a bold claim — never a throat-clearing intro.
- Write in flowing paragraphs of natural spoken English. Vary sentence length hard: mix short punchy lines with longer flowing ones for rhythm.
- Use concrete detail over vague generality. Keep momentum; every line should earn the next.
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
      parse: (p, rawText) => parseScenes(rawText, p.cues || [], p.bible)
    },
    '/api/seo/generate': {
      build: (p) => seoPrompt(p.project || {}, p.channel || {}),
      parse: (p, rawText) => ({ seo: normalizeSeo(extractJson(rawText), p.project || {}) })
    },
    '/api/script/generate': {
      build: (p) => scriptPrompt(p.options || {}),
      parse: (p, rawText) => ({ script: cleanScript(rawText) })
    }
  };

  window.VISUAL_STYLES = VISUAL_STYLES;
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
    repairJson,
    VISUAL_STYLES
  };
})();
