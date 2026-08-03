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
    lifestyle: { label: 'Contemporary Lifestyle', render: 'Clean contemporary lifestyle photography, bright natural light, relatable modern settings, aspirational but authentic', negative: 'historical, cartoon, dark, staged studio' },
    // The negatives carry this one. Left to itself a model "improves" a stick
    // figure into a rendered character, so the absent detail has to be stated.
    stickman: { label: 'Stickman', render: 'Minimalist stick figure drawing on plain white, simple black stick figures with circle heads and straight limb lines, hand-drawn marker linework, dot-and-line expressions, generous white space, educational sketch', negative: 'detailed character, muscles, clothing detail, facial features, shading, gradients, colour background, realistic proportions, 3d, photoreal, anatomy' }
  };

  function styleBrief(id) {
    const s = VISUAL_STYLES[id];
    return s && s.render ? s : null;
  }

  // --- Storyboard: story + visual-profile analyzer ("bible") -------------

  const BIBLE_SYSTEM = `You are a senior story analyst and visual director for AI-generated video. You will read ALL of the provided material and produce a project profile that drives consistent, on-topic image/video generation.

CRITICAL: Determine the visual identity FROM THE CONTENT. Do NOT assume the project is historical, medieval, 2D, or fiction. A finance explainer must look like modern finance visuals; a cooking video like food photography; a sci-fi story like cinematic sci-fi; a children's lesson like a children's book. Infer genre, era, setting, tone, audience and format (documentary vs narrative, educational vs entertainment) from what is actually written.

DEFAULT TO PHOTOGRAPHY. If the subject is anything that exists in the real world — homes, health, safety, money, food, travel, how-to, history, news — the visual style MUST be photographic: real people, real rooms, real objects, natural light, believable lenses and depth of field. Flat vector art, "modern explainer graphics", corporate illustration and infographic styles read as cheap AI filler on a professional channel and must not be chosen for real-world subjects. Reserve illustrated or animated styles for content that genuinely cannot be photographed: abstract fiction, fantasy, children's stories, or explicitly stylised branding.

The chosen style must be SPECIFIC enough that every scene lands the same. "Documentary photography" is too loose — one scene will come back photoreal and the next flat. Name the camera character, the light and the grade, e.g. "Photographic, 35mm documentary style, soft natural window light, muted warm grade, shallow depth of field, candid unposed framing".

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
- NEVER depict readable text, documents, checklists, forms, charts, signage, screens, labels or user interfaces. Image models cannot render text — it always comes out as scrambled pseudo-letters, and it is the clearest possible sign of an AI-generated image. When a beat mentions a checklist, guide, list, printable, app or a number, film the HUMAN ACTION around it instead: hands working, someone testing a device, a finger pointing at the thing being discussed. Never the artefact itself.
- If a beat genuinely needs words on screen — a list the viewer should read, a headline, a single striking number — do NOT write an image prompt for it. Set "sceneType" to "Graphic" and fill in the "graphic" object instead. Those frames are typeset with real fonts rather than generated, so the text comes out correct. Use this sparingly: a handful per video, for moments that are genuinely about information. Everything else is footage.
- Every prompt must show a real person or a real physical object in a real space performing ONE concrete physical action. Never illustrate an abstract idea, a statistic or a concept. "Fifty safety checks" is not a picture; a person crouching to press the test button on a smoke alarm is.
- Write like a cinematographer, not a graphic designer. Name the shot, the light source, and a specific surface or material detail — "close-up, weathered hands smoothing a rug corner against hardwood, low afternoon sun raking across the floor, shallow depth of field". Vague prompts are what produce generic stock-looking output.
- Depict what actually happens in the beat. Resolve who "he/she/they" refer to using the profile; place each beat in the correct location and era.
- Embed the project's visual style VERBATIM in every prompt (its description, lighting and color grading). Never substitute a different style. Never add historical/medieval styling unless the profile says so.
- Maintain character consistency: when a character appears, paste their exact description from the profile.
- Maintain location continuity: reuse the same architecture, lighting and weather for the same place.
- Vary the camera across the batch (wide, medium, close-up, over-the-shoulder, overhead, detail, establishing) to keep visual interest.
- Honor the profile's negative guidance (things to avoid).
- CONTINUITY IS A HARD CONSTRAINT. "environment", "timeOfDay", "weather" and "lighting" carry forward from the previous beat and may only change when the narration actually says they change. A character who was in a wheat field at dawn is still in that wheat field at dawn in the next beat unless the script moved them. Reuse the EXACT same environment string when it is the same place — "north wheat field" every time, never "the field" then "farmland". Same for props: a tool a character was holding is still in their hand.
- "motion" is what makes a beat filmable rather than a photograph. Name one or two things that physically move, and keep them small and plausible for a few seconds of footage: breath, wind, a slow head turn, hands working, dust in a light shaft. Never describe a cut, a scene change or several actions in sequence — one continuous moment only.
- Choose "cameraMovement" for meaning, not variety: Static and Slow Push In for reflection, Handheld for tension, Drone and Crane for scale. Most beats should be Static or Slow Push In; a video where every shot swoops looks amateur.
Respond ONLY with JSON:
{
  "scenes": [
    {
      "index": number,          // echo the beat index
      "sceneType": string,      // "Establishing" | "Reaction" | "Detail" | "Graphic"
      "graphic": {              // ONLY when sceneType is "Graphic"; omit otherwise
        "kind": string,         // "checklist" | "stat" | "title"
        "title": string,        // headline, or the list's heading
        "subtitle": string,     // optional supporting line (title cards)
        "items": [string],      // checklist only — max 7, each under ~8 words
        "value": string,        // stat only — the number itself, e.g. "50"
        "label": string         // stat only — what the number means
      },
      "camera": string,
      "shotType": string,       // "Extreme Wide" | "Wide" | "Medium" | "Close Up" | "Extreme Close Up" | "Over Shoulder" | "POV"
      "cameraMovement": string, // "Static" | "Slow Push In" | "Dolly In" | "Dolly Out" | "Pan Left" | "Pan Right" | "Crane Up" | "Crane Down" | "Handheld" | "Drone"
      "detectedAction": string, // what is happening in this beat, one line
      "motion": string,         // what physically MOVES in the shot — required for video: "wind crosses the wheat, he turns his head slowly"
      "emotion": string,        // dominant feeling of the beat, one or two words
      "environment": string,    // the place, named IDENTICALLY every time it recurs ("north wheat field")
      "timeOfDay": string,      // "dawn" | "morning" | "midday" | "afternoon" | "dusk" | "night"
      "weather": string,        // "clear" | "overcast" | "rain" | "snow" | "fog" | "wind"; "" when indoors
      "lighting": string,       // light source and quality
      "props": [string],        // objects that must persist across scenes
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

  // Controlled vocabularies. Everything downstream (LTX prompt building, the
  // scene editor dropdowns, the Director's plan) assumes these exact strings.
  const SHOT_TYPES = [
    'Extreme Wide', 'Wide', 'Medium', 'Close Up', 'Extreme Close Up', 'Over Shoulder', 'POV'
  ];
  const CAMERA_MOVES = [
    'Static', 'Slow Push In', 'Dolly In', 'Dolly Out', 'Pan Left', 'Pan Right',
    'Crane Up', 'Crane Down', 'Handheld', 'Drone'
  ];
  const TIMES_OF_DAY = ['dawn', 'morning', 'midday', 'afternoon', 'dusk', 'night'];
  const WEATHERS = ['clear', 'overcast', 'rain', 'snow', 'fog', 'wind'];
  // How a beat gets put on screen. This is a ROUTING vocabulary, not a
  // stylistic one: each value sends the beat to a different renderer —
  // 't2v'/'broll' to the video model, 'presenter' to the host compositor, and
  // the rest to the canvas typesetter, which draws real text correctly instead
  // of asking a diffusion model to hallucinate letters.
  const VISUAL_TYPES = ['stickman', 'whiteboard', 'chart', 'map', 'timeline', 'diagram', 't2v', 'presenter', 'broll'];
  const HOST_OVERLAYS = ['none', 'circle', 'rect', 'corner', 'full'];

  // Snap a model's answer onto the vocabulary. Case-insensitive, and tolerates
  // near misses ("closeup", "push in") so a good answer is not thrown away on
  // punctuation, but anything genuinely unrecognised falls back rather than
  // being passed through — an invented term breaks the prompt translation.
  function oneOf(value, allowed, fallback) {
    const v = String(value == null ? '' : value).trim();
    if (!v) return fallback;
    const norm = (x) => x.toLowerCase().replace(/[^a-z]/g, '');
    const target = norm(v);
    const hit = allowed.find((a) => norm(a) === target);
    if (hit) return hit;
    const loose = allowed.find((a) => norm(a).includes(target) || target.includes(norm(a)));
    return loose || fallback;
  }

  // Continuity carry-forward.
  //
  // Scenes are generated in batches, so the model literally cannot see the
  // earlier beats when it writes a later one — asking it for continuity is
  // necessary but not sufficient. This closes the gap deterministically: any
  // continuity field a scene left blank inherits the previous scene's value.
  //
  // Only blanks are filled. When the model DID state a value it is respected,
  // because that is how a legitimate change of place or time gets through.
  function applyContinuity(scenes) {
    const carry = { environment: '', timeOfDay: '', weather: '', lighting: '' };
    let props = [];
    return (Array.isArray(scenes) ? scenes : []).map((s) => {
      const out = Object.assign({}, s);
      for (const k of Object.keys(carry)) {
        if (!String(out[k] || '').trim()) out[k] = carry[k];
        else carry[k] = out[k];
      }
      // Props persist until a scene names its own set.
      if (Array.isArray(out.props) && out.props.length) props = out.props.slice(0, 8);
      else out.props = props.slice();
      return out;
    });
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
      // Cinematic controls. Snapped to the known vocabulary because these are
      // translated into LTX prompt language downstream, and a model inventing
      // "swooping vertigo pullback" would produce an untranslatable scene.
      shotType: oneOf(s && s.shotType, SHOT_TYPES, ''),
      cameraMovement: oneOf(s && s.cameraMovement, CAMERA_MOVES, 'Static'),
      detectedAction: str(s && s.detectedAction),
      motion: str(s && s.motion),
      emotion: str(s && s.emotion),
      // Continuity state. Left blank rather than guessed — applyContinuity()
      // fills gaps from the previous scene, which is the only source that can
      // actually keep a place consistent across a batch boundary.
      environment: str(s && s.environment),
      timeOfDay: oneOf(s && s.timeOfDay, TIMES_OF_DAY, ''),
      weather: oneOf(s && s.weather, WEATHERS, ''),
      lighting: str(s && s.lighting),
      props: arr(s && s.props).map(String).filter(Boolean).slice(0, 8),
      visualGoal: str(s && s.visualGoal),
      visualFocus: str(s && s.visualFocus),
      characters: arr(s && s.characters).map(String).slice(0, 8),
      sceneSummary: str(s && s.sceneSummary, source.text || ''),
      // Typeset frames carry a spec instead of relying on the prompt. Kept only
      // when it has something to actually draw, so a stray empty object cannot
      // route a beat away from the camera and leave a blank card.
      graphic: (() => {
        const g = s && s.graphic;
        if (!g || typeof g !== 'object') return null;
        const items = arr(g.items).map(String).filter(Boolean).slice(0, 7);
        const spec = {
          kind: str(g.kind, 'title').toLowerCase(),
          title: str(g.title),
          subtitle: str(g.subtitle),
          items,
          value: str(g.value),
          label: str(g.label)
        };
        return (spec.title || spec.value || items.length) ? spec : null;
      })(),
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
    // Continuity is applied after normalisation so it operates on the snapped
    // vocabulary, and within the batch the model actually produced.
    return {
      scenes: applyContinuity(scenes.map((s, i) => normalizeScene(s, cues[i], cues, bible)))
    };
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
    parts.push(`PROJECT TITLE: "${project.title || 'Untitled'}"`);
    if (project.research) parts.push(`RESEARCH BRIEF & SEARCH ANGLE:\n${JSON.stringify(project.research, null, 2)}`);
    if (project.bible) parts.push(`STORY BIBLE & VISUAL PROFILE:\n${JSON.stringify(project.bible, null, 2)}`);
    if (project.script) parts.push(`FULL SCRIPT & NARRATION:\n${String(project.script).slice(0, 10000)}`);
    else if (project.subtitles) parts.push(`SUBTITLES / TIMED LINES:\n${String(project.subtitles).slice(0, 10000)}`);
    if (project.storyboard && project.storyboard.scenes) {
      parts.push(`STORYBOARD SCENES:\n${JSON.stringify(project.storyboard.scenes.map(s => ({ subtitle: s.subtitle, visual: s.visualConcept })), null, 2)}`);
    }
    if (project.research && project.research.keywords) {
      const kw = project.research.keywords;
      parts.push(`RESEARCH KEYWORDS (weave these in): primary "${kw.primary || ''}", secondary ${JSON.stringify(kw.secondary || [])}, long-tail ${JSON.stringify(kw.longTail || [])}.`);
    }
    parts.push(`CHANNEL KNOWLEDGE BASE:\n${JSON.stringify(channel || {}, null, 2)}`);
    if (project.channelMemory) parts.push(project.channelMemory);
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
    const grounding = researchGrounding(opts.research);
    if (grounding) {
      lines.push(`\nGROUND THE SCRIPT IN THIS RESEARCH BRIEF (use these facts and angles; do not contradict them or invent conflicting specifics):\n${grounding}`);
    }

    if (opts.vaultChunks && opts.vaultChunks.length > 0) {
      const userContext = "\nRELEVANT KNOWLEDGE VAULT CHUNKS:\n" + 
        opts.vaultChunks.map(c => `--- [Source: ${c.filename}] ---\n${c.text}`).join('\n\n') + 
        "\n(Integrate details and context from these retrieved Vault documents into the script where relevant. IMPORTANT: Whenever you use a fact from the Vault, you MUST append a citation like [Source: filename.ext] at the end of the sentence.)\n";
      lines.push(userContext);
    }

    if (opts.channelMemory) lines.push(`\n${opts.channelMemory}`);
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

  // --- AI Production Director --------------------------------------------

  const DIRECTOR_SYSTEM = `You are the AI Production Director for a YouTube video studio — a seasoned Video Production Director, Creative Director, Content Strategist, YouTube Growth Consultant, Storytelling Expert and Quality-Control Manager rolled into one.
You have visibility into the whole project (script, narration/voice, story bible, storyboard scenes, images, SEO). Give sharp, specific, production-grade guidance: strengthen hooks and retention, fix pacing and weak scenes, keep visual and character consistency, and grow the channel. Be candid and concrete; reference the actual project. Keep answers focused and actionable — no filler.`;

  function directorChatSystem() { return DIRECTOR_SYSTEM; }

  const AUDIT_SYSTEM = `${DIRECTOR_SYSTEM}
Now perform a complete pre-export QUALITY AUDIT of the project. Score each dimension 0-100 (be honest — do not inflate) and give specific, prioritized recommendations.
Respond ONLY with JSON:
{
  "scores": {
    "script": int, "retention": int, "storytelling": int, "visualConsistency": int,
    "thumbnail": int, "seo": int, "monetization": int, "overall": int
  },
  "summary": string,
  "strengths": [string],
  "weaknesses": [string],
  "recommendations": [{ "area": string, "priority": "high" | "medium" | "low", "action": string }],
  "nextStep": string
}`;

  function auditPrompt(project) {
    return { system: AUDIT_SYSTEM, user: `PROJECT (JSON snapshot):\n${JSON.stringify(project || {}, null, 2)}` };
  }

  function normalizeAudit(j) {
    j = j || {};
    const sc = j.scores || {};
    const score = (v) => clampScore(v);
    const scores = {
      script: score(sc.script), retention: score(sc.retention), storytelling: score(sc.storytelling),
      visualConsistency: score(sc.visualConsistency), thumbnail: score(sc.thumbnail), seo: score(sc.seo),
      monetization: score(sc.monetization),
      overall: sc.overall != null ? score(sc.overall) : 0
    };
    if (!scores.overall) {
      const vals = [scores.script, scores.retention, scores.storytelling, scores.visualConsistency, scores.thumbnail, scores.seo, scores.monetization];
      scores.overall = Math.round(vals.reduce((a, b) => a + b, 0) / vals.length);
    }
    return {
      generatedAt: Date.now(),
      scores,
      summary: str(j.summary),
      strengths: arr(j.strengths).map(String).slice(0, 12),
      weaknesses: arr(j.weaknesses).map(String).slice(0, 12),
      recommendations: arr(j.recommendations).slice(0, 20).map((r) => ({
        area: str(r && r.area),
        priority: /high|medium|low/i.test(str(r && r.priority)) ? str(r.priority).toLowerCase() : 'medium',
        action: str(r && r.action)
      })).filter((r) => r.action),
      nextStep: str(j.nextStep)
    };
  }

  // --- Endpoint registry (keys match the old /api/* paths) --------------

  // --- Research System ---------------------------------------------------
  // Produces a structured, honesty-flagged research brief that grounds the
  // script and SEO in facts, angles and keywords instead of pure model memory.

  const RESEARCH_SYSTEM = `You are a meticulous research analyst and content strategist for a faceless YouTube channel. Given a topic, produce a structured research brief the writer and SEO strategist will build on.
Be rigorous and honest about certainty. Mark each fact's confidence and set "verify": true for anything a careful editor should double-check before publishing. Do NOT invent precise statistics, quotes, dates or names you are not confident about — prefer a careful, verifiable statement over a fabricated specific. If the topic is niche or recent, say so in "caveats".
Respond ONLY with JSON of this exact shape:
{
  "summary": string,
  "angles": [string],
  "hooks": [string],
  "keyFacts": [{ "fact": string, "detail": string, "confidence": "high" | "medium" | "low", "verify": boolean }],
  "questions": [string],
  "entities": { "people": [string], "places": [string], "dates": [string], "terms": [string] },
  "timeline": [{ "when": string, "event": string }],
  "keywords": { "primary": string, "secondary": [string], "longTail": [string] },
  "titleDirections": [string],
  "caveats": string
}
Give 4-8 distinct angles, 4-6 cold-open hooks, 6-12 key facts, 4-8 curiosity questions, a timeline where the topic is historical/chronological (else []), and search-oriented keywords. Keep every string tight and specific.`;

  function researchPrompt(topic, opts) {
    opts = opts || {};
    const lines = [
      `TOPIC / BRIEF: ${String(topic || '').trim() || '(none given — infer a compelling, specific angle)'}`
    ];
    if (opts.audience) lines.push(`TARGET AUDIENCE: ${String(opts.audience).trim()}.`);
    if (opts.channel && opts.channel.type) lines.push(`CHANNEL: ${opts.channel.name || ''} — ${opts.channel.type}.`);
    if (opts.depth) lines.push(`DEPTH: ${opts.depth}.`);
    lines.push('Return the research brief as JSON only.');
    return { system: RESEARCH_SYSTEM, user: lines.join('\n') };
  }

  function normalizeResearch(raw) {
    const r = raw || {};
    const conf = (c) => (['high', 'medium', 'low'].includes(String(c).toLowerCase()) ? String(c).toLowerCase() : 'medium');
    const ent = r.entities || {};
    return {
      summary: str(r.summary),
      angles: arr(r.angles).map(str).filter(Boolean),
      hooks: arr(r.hooks).map(str).filter(Boolean),
      keyFacts: arr(r.keyFacts).map((f) => ({
        fact: str(f && f.fact),
        detail: str(f && f.detail),
        confidence: conf(f && f.confidence),
        verify: !!(f && (f.verify || conf(f && f.confidence) !== 'high'))
      })).filter((f) => f.fact),
      questions: arr(r.questions).map(str).filter(Boolean),
      entities: {
        people: arr(ent.people).map(str).filter(Boolean),
        places: arr(ent.places).map(str).filter(Boolean),
        dates: arr(ent.dates).map(str).filter(Boolean),
        terms: arr(ent.terms).map(str).filter(Boolean)
      },
      timeline: arr(r.timeline).map((t) => ({ when: str(t && t.when), event: str(t && t.event) })).filter((t) => t.when || t.event),
      keywords: {
        primary: str(r.keywords && r.keywords.primary),
        secondary: arr(r.keywords && r.keywords.secondary).map(str).filter(Boolean),
        longTail: arr(r.keywords && r.keywords.longTail).map(str).filter(Boolean)
      },
      titleDirections: arr(r.titleDirections).map(str).filter(Boolean),
      caveats: str(r.caveats)
    };
  }

  // Condense a research brief into a grounding block for the script/SEO prompts.
  function researchGrounding(research) {
    if (!research) return '';
    const parts = [];
    if (research.summary) parts.push(research.summary);
    const facts = (research.keyFacts || []).slice(0, 12).map((f) => `- ${f.fact}${f.detail ? ` — ${f.detail}` : ''}${f.verify ? ' [verify]' : ''}`);
    if (facts.length) parts.push('KEY FACTS:\n' + facts.join('\n'));
    if ((research.angles || []).length) parts.push('ANGLES: ' + research.angles.slice(0, 6).join(' · '));
    if ((research.hooks || []).length) parts.push('HOOK IDEAS: ' + research.hooks.slice(0, 4).join(' · '));
    const tl = (research.timeline || []).slice(0, 12).map((t) => `${t.when}: ${t.event}`);
    if (tl.length) parts.push('TIMELINE:\n' + tl.join('\n'));
    return parts.join('\n\n');
  }

  // --- story state ---------------------------------------------------------
  //
  // Replaces keyword inference with the Director naming state changes directly.
  //
  // The regex parser was always scaffolding — its own comment said the Director
  // would eventually supply these. Measured across a 48-beat corpus spanning
  // eight genres, it recognised 31% of CONDITION beats and 25% of STANCE beats:
  // dimensions the engine fully supports. "The company went under", "The city
  // fell", "She failed the exam" are all representable and all invisible,
  // because the parser matches phrases rather than meaning. Adding more regex
  // families had also begun to collide — 'determined' was captured by an
  // earlier rule, and bare 'decision' turned anger into a dilemma.
  const STATE_ATTRIBUTES = {
    // condition — these move wellbeing, and therefore the whole environment
    health: 'physical wellbeing, safety, survival',
    energy: 'stamina, rest, exhaustion',
    wealth: 'money, resources, job, material security',
    confidence: 'self-belief, standing, credibility',
    stress: 'INVERTED: pressure, fear, anxiety. Higher is worse.',
    // stance — these move posture only, never the environment
    uncertainty: 'INVERTED: not knowing what to do. Higher is more torn.',
    resolve: 'determination, commitment to act',
    obligation: 'INVERTED: duty, being bound. Higher is more burdened.'
  };

  function storyStatePrompt(payload) {
    const sentences = (payload.sentences || []).map((s, i) => `${i}: ${s}`).join('\n');
    const attrs = Object.keys(STATE_ATTRIBUTES)
      .map((k) => `  ${k} — ${STATE_ATTRIBUTES[k]}`).join('\n');
    return {
      system: [
        'You read narration and report how a subject CHANGES, as data.',
        'You never describe visuals, poses, camera or lighting: another system derives those.',
        '',
        'Attributes, each 0..1:',
        attrs,
        '',
        'Rules:',
        '- delta is the SIGNED change, -1..1. Report the change, not the new value.',
        '- Attributes marked INVERTED go UP when things get worse.',
        '- One event may change several attributes. Losing a job costs wealth AND',
        '  confidence AND calm. Report every consequence you are confident of.',
        '- Size the change honestly: losing a phone is about 0.1, losing a job',
        '  about 0.5, a terminal diagnosis about 0.8.',
        '- A dilemma or an obligation is NOT a deterioration. Move uncertainty,',
        '  resolve or obligation and leave health/wealth/confidence/stress alone.',
        '- If a sentence changes nothing about the subject, omit it entirely.',
        '  Silence is correct and expected for scene-setting lines.',
        '',
        'Return ONLY: {"changes":[{"sentence":<int>,"attribute":"<name>","delta":<number>,"cause":"<short quote>"}]}'
      ].join('\n'),
      user: `Subject: ${payload.subject || 'the main subject'}\n\nNarration:\n${sentences}`
    };
  }

  // Every state change the schema refused, kept for inspection.
  //
  // Dropping to silence is right for the RUNTIME and wasteful as evidence. A
  // rejected attribute is the Director telling us it perceived something the
  // schema has no place for, which is exactly how a missing dimension
  // announces itself before anyone has formally discovered it. If `hope`,
  // `reputation` or `belonging` keep getting emitted and refused, that is data
  // about the model of story, not noise.
  const stateRejections = [];
  const REJECTION_CAP = 500;

  function reject(reason, entry) {
    stateRejections.push({ reason, at: Date.now(), entry });
    if (stateRejections.length > REJECTION_CAP) stateRejections.shift();
  }

  // --- scene plan ----------------------------------------------------------
  //
  // IDENTITY IS OPEN. STRUCTURE IS CLOSED. That split is the architecture, and
  // it is enforced here rather than left as a convention, because a convention
  // would erode the first time someone wanted `courtroom` to be a new subject
  // type.
  //
  // It comes from a measurement. 48 beats across eight genres were put to the
  // Director with a free vocabulary and produced 48 DISTINCT subject labels --
  // doctor_and_patient, ration_tins, girl_at_microphone, rising_floodwater --
  // with no reuse whatsoever. Asked to cluster its own answers by what a
  // camera would frame differently, it produced six structures. So:
  //
  //   identity   free text, never validated against any list, never coerced.
  //              Drives object choice, staging and interpretation.
  //   structure  one of six. Drives bounds, framing and camera. Anything else
  //              is dropped.
  //
  // The danger this guards against is a second keyword-parser problem one
  // level up: crowd_at_table, meeting, classroom, courtroom and restaurant all
  // becoming structural types. They are not. They are identity + context +
  // objects, and the structure underneath every one of them is already in the
  // six.
  const SUBJECT_STRUCTURES = ['actor', 'context', 'pair', 'group', 'object', 'place'];
  const SUPPORTS = ['ground', 'chair', 'stool', 'bed', 'floor'];
  const OBJECT_KINDS = ['paper', 'crumpled', 'pencil', 'laptop', 'cup', 'book', 'phone', 'clock'];
  const OBJECT_RELS = ['held', 'surface', 'floor', 'thought'];

  function scenePlanPrompt(payload) {
    const sentences = (payload.sentences || []).map((s, i) => `${i}: ${s}`).join('\n');
    return {
      system: [
        'You stage beats of narration for an illustrated explainer. For each beat you',
        'report WHAT IS IN FRAME. You never describe emotion, camera moves or lighting:',
        'other systems derive those from state.',
        '',
        'For each beat give:',
        '',
        '  identity   what the shot IS, in your own words, snake_case, 1-3 words.',
        '             e.g. student_at_desk, doctor_and_patient, ration_tins.',
        '             There is no list. Name it however fits.',
        '',
        '  structure  EXACTLY ONE of: ' + SUBJECT_STRUCTURES.join(' | '),
        '             actor = one figure alone. context = one figure with the thing',
        '             they are at (desk, bed, microphone, roof). pair = two figures.',
        '             group = three or more. object = a thing, no figure needed.',
        '             place = the location itself.',
        '',
        '  support    what the figure rests on: ' + SUPPORTS.join(' | '),
        '',
        '  objects    things in frame. Each: kind (' + OBJECT_KINDS.join('|') + '),',
        '             rel (' + OBJECT_RELS.join('|') + '), count.',
        '             `floor` accumulates: raise the count across beats to show',
        '             effort piling up. Use `thought` for what is on their mind.',
        '',
        'Only include a beat if something is actually in frame for it. Omit the rest.',
        '',
        'Return ONLY: {"beats":[{"beat":<int>,"identity":"<snake_case>",' +
          '"structure":"<one>","support":"<one>","objects":[{"kind":"","rel":"","count":1}]}]}'
      ].join('\n'),
      user: `Subject: ${payload.subject || 'the main subject'}\n\nNarration:\n${sentences}`
    };
  }

  function normalizeScenePlan(payload, raw) {
    const data = extractJson(raw) || {};
    const list = Array.isArray(data.beats) ? data.beats : [];
    const n = (payload.sentences || []).length;
    const out = [];
    list.forEach((b) => {
      if (!b) { reject('malformed-beat', b); return; }
      const beat = Number(b.beat);
      if (!Number.isInteger(beat) || beat < 0 || beat >= n) {
        reject('bad-beat-index', b); return;
      }
      const structure = String(b.structure || '').trim().toLowerCase();
      if (SUBJECT_STRUCTURES.indexOf(structure) === -1) {
        // A structure we do not have is dropped, never mapped to the nearest.
        reject('unknown-structure', b); return;
      }
      const support = SUPPORTS.indexOf(String(b.support || '').trim().toLowerCase()) > -1
        ? String(b.support).trim().toLowerCase() : 'ground';

      const objects = [];
      (Array.isArray(b.objects) ? b.objects : []).forEach((o) => {
        if (!o) return;
        const kind = String(o.kind || '').trim().toLowerCase();
        const rel = String(o.rel || '').trim().toLowerCase();
        if (OBJECT_KINDS.indexOf(kind) === -1) { reject('unknown-object-kind', o); return; }
        if (OBJECT_RELS.indexOf(rel) === -1) { reject('unknown-object-rel', o); return; }
        objects.push({ kind, rel, count: Math.max(1, Math.min(24, Number(o.count) || 1)) });
      });

      out.push({
        beat,
        // NEVER validated against a list. Sanitised for length and shape only,
        // because the whole point is that identity is unbounded.
        identity: String(b.identity || '').trim().toLowerCase()
          .replace(/[^a-z0-9_]/g, '_').slice(0, 40) || null,
        structure,
        support,
        objects
      });
    });
    return { beats: out };
  }

  function normalizeStateChanges(payload, raw) {
    const data = extractJson(raw) || {};
    const list = Array.isArray(data.changes) ? data.changes : [];
    const n = (payload.sentences || []).length;
    const out = [];
    list.forEach((c) => {
      if (!c) { reject('malformed', c); return; }
      const attribute = String(c.attribute || '').trim().toLowerCase();
      // An unknown attribute is DROPPED, never coerced onto the nearest thing
      // we do have. A model inventing "hope" must produce nothing: silence is
      // recoverable and observable, wrong state is neither.
      if (!STATE_ATTRIBUTES[attribute]) { reject('unknown-attribute', c); return; }
      const sentence = Number(c.sentence);
      if (!Number.isInteger(sentence) || sentence < 0 || sentence >= n) {
        reject('bad-sentence-index', c); return;
      }
      let delta = Number(c.delta);
      if (!Number.isFinite(delta)) { reject('non-numeric-delta', c); return; }
      if (delta === 0) { reject('zero-delta', c); return; }
      if (Math.abs(delta) > 1) reject('delta-clamped', c);   // kept, but recorded
      delta = Math.max(-1, Math.min(1, delta));
      out.push({ sentence, attribute, delta, cause: String(c.cause || '').slice(0, 80) });
    });
    return { changes: out };
  }

  /** What the schema has been refusing, newest last. */
  function stateRejectionReport() {
    const byAttr = {};
    const byReason = {};
    stateRejections.forEach((r) => {
      byReason[r.reason] = (byReason[r.reason] || 0) + 1;
      const a = r.entry && r.entry.attribute
        ? String(r.entry.attribute).toLowerCase() : '(none)';
      if (r.reason === 'unknown-attribute') byAttr[a] = (byAttr[a] || 0) + 1;
    });
    return { total: stateRejections.length, byReason, unknownAttributes: byAttr,
             recent: stateRejections.slice(-25) };
  }

  const ROUTES = {
    '/api/story-state': {
      build: (p) => storyStatePrompt(p || {}),
      parse: (p, rawText) => normalizeStateChanges(p || {}, rawText)
    },
    '/api/scene-plan': {
      build: (p) => scenePlanPrompt(p || {}),
      parse: (p, rawText) => normalizeScenePlan(p || {}, rawText)
    },
    '/api/research': {
      build: (p) => researchPrompt(p.topic || '', p.options || {}),
      parse: (p, rawText) => ({ research: normalizeResearch(extractJson(rawText)) })
    },
    '/api/director/audit': {
      build: (p) => auditPrompt(p.project || {}),
      parse: (p, rawText) => ({ audit: normalizeAudit(extractJson(rawText)) })
    },
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
    },
    '/api/video/plan': {
      build: (p) => videoPlanPrompt(p),
      parse: (p, rawText) => parseVideoPlan(rawText)
    }
  };

  // --- Director video planning ---------------------------------------------

  const VIDEO_PLAN_SYSTEM = `You are a documentary director planning how a finished storyboard will be SHOT as video. The still frames already exist; your job is to decide how each one moves.

You are planning for LTX-2.3, an image-conditioned video model that renders a few seconds per shot from reference images. That imposes real constraints — respect them or the footage will be unusable:
- One continuous moment per shot. No cuts, no "then he walks away", no sequences of actions.
- Small, physically plausible motion. Breath, wind, a slow head turn, hands working, dust in light, fabric shifting. A shot is 2-30 seconds of one continuous take.
- The camera move must suit the beat, not add variety for its own sake. Most documentary shots are Static or Slow Push In. Reserve Drone and Crane for genuine scale, Handheld for tension or urgency.
- Motion must not contradict the shot type. A Close Up cannot contain a Drone move.

ALWAYS PREFER THE SIMPLEST VISUAL THAT EXPLAINS THE IDEA. This is an explainer studio, not a footage generator. A drawn visual renders in about a millisecond, looks identical on every run, and stays editable afterwards. A generated shot costs minutes of GPU, comes back different every time, and cannot be corrected without re-rendering. Reach for the camera only when nothing drawn can carry the idea.

Choose in this order, and only move down when the option above genuinely cannot communicate the point:
  1. stickman   - people doing or feeling something: explaining, deciding, working, reacting, comparing, struggling
  2. whiteboard - a process, a mechanism, a cause-and-effect chain, steps
  3. chart      - anything carrying two or more numbers
  4. map        - anything where place, territory, movement or spread matters
  5. timeline   - two or more dated events
  6. diagram    - a labelled structure: an anatomy, a system, parts of a whole
  7. t2v/broll  - a real filmed moment: atmosphere, landscape, texture, archival feel
  8. presenter  - the host addressing the viewer directly

A beat about a farmer losing his harvest can be a stickman farmer looking at a wilting plant. That reads instantly, costs nothing, and can be re-cut later. Choose t2v only when the beat genuinely needs photographic reality: a place the viewer must believe in, a texture, an atmosphere no drawing can carry.

You also decide WHAT KIND OF VISUAL each beat should be. Pick the format that actually communicates the point — a video that is 40 identical generated clips is the thing we are trying to avoid:
- "stickman": simple stick figures acting the idea out. The default for any beat about PEOPLE doing or feeling something. Put the figures in graphic.items as "action:expression" pairs, e.g. ["explain:confident", "think:confused"].
- "diagram": a labelled structure drawn as boxes and connections.
- "t2v": a filmed moment. The default for anything concrete and physical — people, places, actions, atmosphere.
- "presenter": the channel host on camera. Use for the hook, section openings, direct address to the viewer, and the closing. Never more than a few per video.
- "whiteboard": a step-by-step explanation, a process, a comparison, or a causal chain that benefits from being drawn out.
- "chart": a number that only means something in context — growth, decline, share, before/after.
- "map": anywhere geography, routes, borders or spread carry the meaning.
- "timeline": a sequence of dated events.
- "broll": supporting texture under narration where no specific action is described.
Choose "chart", "map", "timeline" and "whiteboard" when the beat is ABOUT information. Choose "t2v" when it is about a moment. Vary the mix — long runs of one type are what makes a video feel machine-made.

When you choose one of those four, you MUST also fill in "graphic" with the actual content to typeset — they are drawn with real fonts, not generated, so the words and numbers have to come from you. A chart needs "label: number" pairs taken from the narration; a timeline needs "date: event"; a map needs place names in the order they are mentioned; a whiteboard needs the steps of the explanation. If the narration does not contain concrete enough material to fill it, that beat is not really about information — choose "t2v" instead.

"hostOverlay" says whether the host is visible during the beat:
- "full" only with visualType "presenter".
- "corner", "circle" or "rect" when the host should be present while other visuals carry the screen — the standard explainer look, host small, content dominant.
- "none" for pure footage moments, and for anything cinematic or emotional where a facecam would break the spell.
Keep the host visible for a meaningful share of an explainer, and sparing in a documentary.

PLAN FOR RETENTION, not just for correctness. A sequence can be perfectly continuous and still lose the viewer:
- The first 15 seconds decide the retention curve. Open on the strongest available image or the host making the promise of the video — never on a slow establishing shot, and never on a single long held beat.
- Never let more than four consecutive beats share a visualType. A run of identical beats is where viewers leave; break it with a chart, a whiteboard, or the host.
- Vary shot scale. Consecutive shots at the same size make an edit feel assembled rather than cut.
- Vary beat length. Evenly paced beats feel metronomic; alternate longer moments with short ones.
- Put a pattern interrupt roughly every 30-40 seconds: a change of visual kind, a return to the host, or a hard change of scale.
- Give every filmed beat real "motion". A beat with none comes back as a near-still frame, which is the slideshow look we are trying to escape.

Also enforce continuity across the sequence. Consecutive shots in the same place, at the same time of day, must not change weather or light. Flag any beat where the storyboard has drifted.

Respond ONLY with JSON:
{
  "strategy": string,          // 2-3 sentences: the overall visual approach and how continuity is being held
  "warnings": [string],        // continuity problems you spotted, e.g. "scenes 4-6 change from dusk to midday with no narrative reason"
  "scenes": [
    {
      "index": number,           // echo the scene index
      "visualType": string,      // "t2v" | "presenter" | "whiteboard" | "chart" | "map" | "timeline" | "broll"
      "graphic": {               // REQUIRED when visualType is whiteboard/chart/map/timeline; omit otherwise
        "title": string,         // the headline for the card
        "subtitle": string,      // optional supporting line
        "items": [string]        // chart: "2019: 42" pairs · timeline: "1914: War begins" · map: place names · whiteboard: steps. Max 6.
      },
      "hostOverlay": string,     // "none" | "circle" | "rect" | "corner" | "full" — when the host is on screen
      "shotType": string,        // "Extreme Wide" | "Wide" | "Medium" | "Close Up" | "Extreme Close Up" | "Over Shoulder" | "POV"
      "cameraMovement": string,  // "Static" | "Slow Push In" | "Dolly In" | "Dolly Out" | "Pan Left" | "Pan Right" | "Crane Up" | "Crane Down" | "Handheld" | "Drone"
      "motion": string,          // what physically moves, one continuous moment
      "emotion": string,         // one or two words
      "transition": string,      // "cut" | "dissolve" — how this shot joins the NEXT one; default "cut"
      "note": string             // optional one-line reason, for the user's benefit
    }
  ]
}`;

  function videoPlanPrompt(payload) {
    const { scenes, bible, characters, modeBrief, strategyBrief, host } = payload || {};
    const cast = (Array.isArray(characters) ? characters : [])
      .map((c) => `- ${c.name}: ${c.descriptor || c.description || ''}`)
      .filter(Boolean)
      .join('\n');
    const beats = (Array.isArray(scenes) ? scenes : [])
      .map((s) =>
        `#${s.index} [${s.timestamp || ''}] (${(s.durationSec || 0).toFixed
          ? s.durationSec.toFixed(1)
          : s.durationSec}s)\n` +
        `  narration: ${s.subtitle || ''}\n` +
        `  action: ${s.detectedAction || s.sceneSummary || ''}\n` +
        `  where: ${[s.environment, s.timeOfDay, s.weather, s.lighting].filter(Boolean).join(', ')}\n` +
        `  who: ${(s.characters || []).join(', ') || '(nobody)'}`
      )
      .join('\n');

    const parts = [
      // Strategy first, then mode. Visual Intelligence sets the family the
      // subject demands; the mode sets the channel's house style within it.
      strategyBrief || '',
      modeBrief || '',
      host ? `CHANNEL HOST: ${host}` : 'CHANNEL HOST: none configured — do not plan presenter beats.',
      bible ? `PROJECT PROFILE:\n${JSON.stringify(bible, null, 2)}` : '',
      cast ? `CAST (keep these people consistent):\n${cast}` : '',
      `STORYBOARD BEATS TO PLAN (echo every index):\n${beats}`
    ].filter(Boolean);

    return { system: VIDEO_PLAN_SYSTEM, user: parts.join('\n\n') };
  }

  function parseVideoPlan(rawText) {
    const result = extractJson(rawText);
    const scenes = Array.isArray(result && result.scenes) ? result.scenes : [];
    if (!scenes.length) {
      const err = new Error('Missing "scenes" array in the video plan response.');
      err.raw = String(rawText || '');
      throw err;
    }
    return {
      strategy: str(result && result.strategy),
      warnings: arr(result && result.warnings).map(String).filter(Boolean),
      scenes: scenes.map((s) => ({
        index: Number(s && s.index),
        // Snapped, for the same reason normalizeScene snaps: these strings are
        // translated into LTX prompt language and an invented term is untranslatable.
        // visualType in particular is a routing decision — an unrecognised value
        // would send a beat nowhere, so it falls back to plain footage.
        visualType: oneOf(s && s.visualType, VISUAL_TYPES, 't2v'),
        // Content for a typeset beat. Kept only when there is something real to
        // draw — an empty spec would route a beat to the canvas renderer and
        // produce a blank card, which is worse than sending it to the camera.
        graphic: (() => {
          const g = s && s.graphic;
          if (!g || typeof g !== 'object') return null;
          const items = arr(g.items).map(String).filter(Boolean).slice(0, 6);
          const spec = { title: str(g.title), subtitle: str(g.subtitle), items };
          return (spec.title || items.length) ? spec : null;
        })(),
        hostOverlay: oneOf(s && s.hostOverlay, HOST_OVERLAYS, 'none'),
        shotType: oneOf(s && s.shotType, SHOT_TYPES, ''),
        cameraMovement: oneOf(s && s.cameraMovement, CAMERA_MOVES, 'Static'),
        motion: str(s && s.motion),
        emotion: str(s && s.emotion),
        transition: oneOf(s && s.transition, ['cut', 'dissolve'], 'cut'),
        note: str(s && s.note)
      })).filter((s) => Number.isFinite(s.index))
    };
  }

  window.VISUAL_STYLES = VISUAL_STYLES;
  window.BlvckPrompts = {
    stateRejections,
    stateRejectionReport,
    STATE_ATTRIBUTES,
    SUBJECT_STRUCTURES,
    OBJECT_KINDS,
    OBJECT_RELS,
    SUPPORTS,
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
    directorChatSystem,
    researchGrounding,
    VISUAL_STYLES,
    // Scene continuity + cinematic vocabulary (shared with ltx-video.js and the
    // Director, which must snap to exactly these strings).
    applyContinuity,
    oneOf,
    videoPlanPrompt,
    parseVideoPlan,
    SHOT_TYPES,
    CAMERA_MOVES,
    TIMES_OF_DAY,
    WEATHERS,
    VISUAL_TYPES,
    HOST_OVERLAYS
  };
})();
