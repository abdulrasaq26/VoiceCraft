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
  // stylistic one — each value sends the beat to a different renderer.
  //
  // Stock types (primary production path):
  //   stock_video   — find a stock video clip that shows this moment
  //   stock_photo   — find a stock still image (for slower or abstract beats)
  //   stock_text    — stock footage + editorial text overlay combined
  //   editorial_text — text/graphic card only, no footage background
  //
  // Canvas types, drawn by the typesetter with real fonts rather than asked of
  // a diffusion model, which hallucinates letters:
  //   stickman | whiteboard | chart | map | timeline | diagram
  //
  // Legacy types (kept for backward compatibility; routed to stock when
  // StockMedia is configured, otherwise to the legacy AI gen path):
  //   't2v'/'broll' to the video model, 'presenter' to the host compositor
  const VISUAL_TYPES = [
    'stock_video', 'stock_photo', 'stock_text', 'editorial_text',
    't2v', 'broll', 'presenter',
    'stickman', 'whiteboard', 'chart', 'map', 'timeline', 'diagram'
  ];
  const HOST_OVERLAYS = ['none', 'circle', 'rect', 'corner', 'full'];

  // Where a beat's footage should come from. Modern stock libraries hold what
  // the world looks like now; a film archive holds what it looked like then.
  // Asking the wrong one is not a quality problem, it is a wrong answer.
  const SOURCE_STRATEGIES = ['auto', 'modern_stock', 'archival', 'mixed'];

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
      'a documentary narration script with an authoritative, measured voice. Open on a specific verifiable detail — a number, a name, a moment — not a question, then unfold the subject in a logical, evidence-led arc. Authoritative means precise, not solemn.',
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

  // Written against real output. The failure modes named below are the ones a
  // model actually produces for this task — an "Imagine a single morning..."
  // opener, four "not X, but Y" constructions in four hundred words, abstract
  // scale in place of specifics, and a closing line that restates the title.
  // Naming them costs prompt tokens and is worth it: general advice like "write
  // a strong hook" produced every one of those.
  const SCRIPT_SYSTEM = `You write narration for faceless storytelling and documentary channels. The narration is spoken aloud by a text-to-speech voice, so it must read like someone talking, not like an essay.

OUTPUT
Output ONLY the spoken words. No headings, stage directions, "[MUSIC]" or "[PAUSE]" markers, camera notes, markdown, speaker labels, word counts, or commentary about the script. Never narrate your own process. The first word you write is the first word the viewer hears.

THE FIRST TEN SECONDS
Open on something concrete and specific: a person, an object, a number, a moment. Give the viewer a fact they did not have.
  Weak:   "Imagine a single morning that turns a continent into a battlefield."
  Strong: "At four forty-five in the morning, a German battleship opened fire on a Polish garrison of two hundred men. They held for seven days."
Never open with "Imagine", "Picture this", "What if I told you", "In a world where", "Have you ever wondered", or any sentence asking the viewer to do imaginative work before you have given them anything. Never open by announcing the subject ("This is the story of...").

HOLD SOMETHING BACK
Plant a question early that the script answers later, and let the viewer feel it is unanswered. One or two of these across the piece, paid off before the end. A story that explains everything in order has nothing pulling the viewer forward.

SPECIFICS BEAT SCALE
Named people, exact numbers, place names, dates, objects. "Millions of lives" and "changed the course of history" are what writing sounds like when it has run out of facts — they feel large and land as nothing. If the brief gives you a number, use it. If it does not, reach for the smallest true detail rather than the biggest vague one.

RHYTHM
Vary sentence length hard. Short line for impact. Then a longer one that carries the thought through its turns and gives the ear somewhere to travel before the next full stop lands. Read it aloud in your head — if you run out of breath, cut it.

AVOID
  - "Not X, but Y" more than once in a script. It is a rhetorical tic and it shows.
  - Rhetorical questions the script immediately answers itself.
  - Summarising at the end. "That is how X happened" throws away the last five seconds. End on the sharpest image, the unresolved consequence, or the line that reframes what came before.
  - Words that sound momentous and mean nothing: "profound", "unprecedented", "forever changed", "little did they know".
  - Hedging: "arguably", "some might say", "in many ways".

TRUTH
Every claim must survive checking. Use what the brief and research give you. Where they are silent, stay silent or stay general — never invent a quote, a statistic, a name, or a specific that was not supplied. Drama comes from selection and arrangement, not invention.`;

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

    // Retention shaping used to be opt-in, so the default script was written
    // without any. It is the whole job for this format, so it is always on; the
    // flag now asks for the harder version rather than switching it on.
    lines.push(
      '\nSTRUCTURE: land a concrete fact in the first two sentences. Raise a '
      + 'question early and answer it late. Change register at least once — a '
      + 'short line after a long passage, a shift from wide to close. Finish on '
      + 'an image or a consequence, never on a summary of what was just said.'
    );
    if (opts.retention) {
      lines.push(
        'This one is for a channel fighting for watch time: make the first line '
        + 'work without any context at all, keep every paragraph opening a small '
        + 'question, and cut any sentence that only restates the previous one.'
      );
    }
    lines.push('Output only the spoken narration. Nothing before it, nothing after it.');
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
  // Specific glyphs the renderer has an exact drawing for. All thirteen are
  // offered now; five of them — suitcase, box, trophy, mic, fire — were
  // drawable and simply never mentioned, so the Director could not ask for
  // them.
  const OBJECT_KINDS = ['paper', 'crumpled', 'pencil', 'laptop', 'cup', 'book',
                        'phone', 'suitcase', 'box', 'trophy', 'mic', 'fire', 'clock'];
  // General forms, for everything else. This is the closed half of "identity
  // open, structure closed" applied to objects — the same rule the `identity`
  // field below already follows, and the reason a kitchen could not be drawn
  // until now: a beat about flour in a bowl had to answer from a list of desk
  // objects, and answered `book`.
  const OBJECT_FORMS = ['vessel', 'mass', 'slab', 'tool', 'apparatus', 'plant'];
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
        '  objects    things in frame. Each: kind, form, rel, count.',
        '             kind is the ORDINARY NAME of the thing — flour, bowl, oven,',
        '             loaf, leaf, spanner. Name what is actually there. Do not',
        '             substitute something else because it seems easier to draw.',
        '             form is how it is drawn, one of: ' + OBJECT_FORMS.join(' | ') + '.',
        '               vessel    open container — bowl, basket, pot, pan, cup',
        '               mass      a quantity with no edges — flour, dough, soil',
        '               slab      flat surface — counter, table, board, tray',
        '               tool      handle and a working end — spoon, hammer, brush',
        '               apparatus a box that does something — oven, machine, engine',
        '               plant     growing thing — leaf, tree, crop, flower',
        // The glyph inventory is deliberately NOT listed here. It was, and it
        // acted as an attractor: given thirteen concrete nouns in the prompt,
        // the model sometimes returned `book` and `laptop` for a baking story
        // instead of the flour and oven it named on other samples. The
        // renderer already resolves specific-before-general on its own, so
        // naming the thing truthfully is always the right move and `book`
        // upgrades itself when a beat is genuinely about a book.
        //
        // THE GENERAL RULE, which is worth more than this instance:
        //
        //   IMPLEMENTATION INVENTORIES DO NOT BELONG IN PLANNER PROMPTS
        //   UNLESS SELECTION FROM THAT INVENTORY IS ITSELF THE TASK.
        //
        // A list of what the system can do reads to a model as a list of what
        // it should answer. The planner's job is to describe the beat; which
        // glyph exists is a rendering concern and leaks bias when it crosses
        // the boundary. Applies to SUPPORTS and OBJECT_RELS too — both are
        // still listed below, and both are genuinely selection tasks, which is
        // the test to apply before adding anything else here.
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
        // KIND IS NOT VALIDATED AGAINST A LIST, for the same reason identity
        // below is not: the set of things a story can mention is unbounded,
        // and a closed list does not make the frame correct, it makes the
        // model pick the nearest legal wrong answer. Sanitised for shape.
        const kind = String(o.kind || '').trim().toLowerCase()
          .replace(/[^a-z0-9 _-]/g, '').slice(0, 32);
        const form = String(o.form || '').trim().toLowerCase();
        const rel = String(o.rel || '').trim().toLowerCase();
        const known = OBJECT_KINDS.indexOf(kind) > -1;
        // FORM is the closed half and carries the guarantee: a specific glyph
        // if one exists, otherwise something drawable. Reject only when the
        // beat has named a thing with no way to render it at all — which is a
        // real rejection rather than the vocabulary rejection it replaces.
        if (!known && OBJECT_FORMS.indexOf(form) === -1) {
          reject('unrenderable-object', o); return;
        }
        if (OBJECT_RELS.indexOf(rel) === -1) { reject('unknown-object-rel', o); return; }
        objects.push({ kind, form: form || null, rel,
                       count: Math.max(1, Math.min(24, Number(o.count) || 1)) });
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

  const VIDEO_PLAN_SYSTEM = `You are the Visual Director for a long-form YouTube video production. Your job is to decide — for every scene in the storyboard — what the audience should SEE at that exact moment, and why that visual choice serves the story.

You work with a STOCK FOOTAGE + EDITORIAL TEXT system. The renderer will search real stock libraries (Pixabay, Pexels) for footage that matches your intent, and render real text/graphics for information-dense beats. Do NOT think in terms of AI image generation. Think like a documentary editor: what real footage, real statistics, real diagrams, or real typeset text would make this beat land?

PREFER REAL FOOTAGE. This is a documentary channel: the viewer is watching to see the world, and a drawing where footage would do makes a serious subject look like a lesson. Stock libraries return a usable clip in about a second, so there is no longer any cost argument for drawing something filmable.

Choose in this order, and only move down when the option above genuinely cannot carry the beat:
  1. stock_video / stock_photo — anything that exists in the world: people, places, objects, work, weather, crowds, hands, machines
  2. stock_text             — a claim that wants real footage underneath it
  3. chart / map / timeline — the beat carries actual numbers, places or dates worth reading
  4. editorial_text         — an abstraction or a quote that no honest footage could show
  5. whiteboard / diagram   — a process or mechanism that only a labelled drawing explains
  6. presenter              — the host addressing the viewer directly
  7. stickman               — a last resort for a beat about human behaviour with no filmable subject at all
  8. t2v                    — when nothing above fits and no stock clip could exist

A beat about a farmer losing his harvest is a shot of a failing field, not a drawn figure beside a wilting plant. Reach for a drawing only when the idea has no physical subject: a decision, a trend, an intention. If you can picture it happening somewhere, it is footage.

────────────────────────────────────────────────────
VISUAL INTENT — the single most important field
────────────────────────────────────────────────────

The concept field is THE SHOT, not the subject of the sentence. Write what a camera
would be pointed at.

  narration: "A database of hundreds of downloadable scripts, screenplays and
              transcripts."
  weak:      "A person browses a collection of scripts."   <- a topic; fits any
                                                              beat in the section
  strong:    "A screen filling with rows of screenplay listings as a search
              runs."

  narration: "unproduced and radio shows."
  weak:      "A person holds a script, looking through its pages."  <- the
                                                              previous shot again
  strong:    "A reel-to-reel tape and a typed radio script lying together on a
              shelf."

Two beats in one section must not share a shot. If a beat adds no new subject —
a fragment, a list continuing — find the concrete thing it does add and shoot
that. Never reach back for the previous beat's picture because this one is
harder.

────────────────────────────────────────────────────
VISUAL TYPE VOCABULARY — choose one per scene:
────────────────────────────────────────────────────

"stock_video"
  A real video clip from a stock library. Use for:
  • Concrete physical moments: people doing things, places, objects, nature, crowds
  • Atmospheric b-roll where footage adds texture under narration
  • Anything where MOTION communicates the beat better than a still
  When you choose this, provide stockRequirements.queries — 3 to 5 short search phrases
  that describe what you want to SEE, not what the narration SAYS.
  Good queries: "scientist looking into microscope", "factory floor at night", "child running in field"
  Bad queries: "the consequences of climate change" (too abstract for a stock search)

"stock_photo"
  A real still photo from a stock library. Use for:
  • Slower-paced beats where a held image works better than motion
  • Portraits, objects, or locations where a single frame is sufficient
  Same stockRequirements format as stock_video.

"stock_text"
  Stock footage COMBINED with an editorial text overlay.
  Use when narration makes a specific claim (a statistic, a key term, a quote)
  while the footage provides atmospheric context.
  Provide both stockRequirements AND textOverlay.

"editorial_text"
  A typeset text card with no footage background — pure editorial graphic.
  Use for:
  • Pull quotes or memorable single-sentence takeaways
  • Section titles or transitions between major topics
  • Abstract concepts that no stock footage can honestly illustrate
  • Any moment where footage would feel forced or misleading
  Provide textOverlay. No stockRequirements needed.

"whiteboard"
  A drawn-out step-by-step explanation, process, comparison, or causal chain.
  Use when the beat is about HOW something works or a sequence of steps.
  MUST fill in graphic.items with the actual steps.

"chart"
  A data visualisation — growth, decline, share, comparison, before/after.
  Use ONLY when the narration contains real numbers worth visualising.
  MUST fill in graphic.items with "Label: Number" pairs from the narration.

"map"
  Geographic context — locations, routes, borders, spread, origin points.
  Use ONLY when real place names appear in this beat.
  MUST fill in graphic.items with place names in the order mentioned.

"timeline"
  A chronological sequence of dated events.
  Use ONLY when at least two distinct dates or time periods appear in this beat.
  MUST fill in graphic.items with "Date: Event" pairs.

"presenter"
  The channel host on camera. Use sparingly:
  • The hook/cold open promise
  • A section transition where the host addresses the viewer directly
  • The closing call-to-action
  Never more than 3-4 in a full video.

"stickman"
  Simple stick figures acting the idea out, drawn by the skeletal engine.
  The first choice for any beat about PEOPLE doing or feeling something —
  explaining, deciding, working, reacting, comparing, struggling.
  MUST fill in graphic.items with "action:expression" pairs,
  e.g. ["explain:confident", "think:confused"].

"diagram"
  A labelled structure drawn as boxes and connections — an anatomy, a system,
  the parts of a whole. Use when the beat names components and their relations.
  MUST fill in graphic.items with the labelled parts.

"broll"
  Legacy value — treated as stock_video. Prefer stock_video explicitly.

"t2v"
  Legacy value — a generated clip. Last resort only, when the beat needs a
  filmed moment and no stock library query could plausibly find one.

────────────────────────────────────────────────────
STOCK REQUIREMENTS — required for stock_video, stock_photo, stock_text
────────────────────────────────────────────────────
stockRequirements: {
  "concept": string,        // THE SHOT: what the camera sees — subject, action, setting.
                            // Not the topic, not the narration rewritten. Two beats in
                            // the same section must not share a shot: if the second adds
                            // no new subject, find the concrete detail it does add.
  "queries": [string],      // 3-5 short search phrases; each is a standalone stock search query
  "fallbackQueries": [string], // 2-3 broader queries to use if primary queries find nothing
  "subjectCategory": string,   // optional: "HUMAN" | "NATURE" | "URBAN" | "ABSTRACT" | "OBJECT"
  "minimumDuration": number,   // seconds the clip must be at minimum (default: half the scene duration)

  // ── SOURCE INTELLIGENCE ────────────────────────────────────────────
  // Which library to ask is a directing decision. A 1969 launch wants the
  // film archive; a modern coffee shop does not. Omitting these sends
  // every beat to the same two stock libraries.
  "sourceStrategy": string,      // "archival" | "modern_stock" | "auto"
  "preferredSources": [string],  // best first, from "archive_org" | "pexels" | "pixabay"
  "archiveQueries": [string],    // ONLY when archive_org is preferred (see below)
  "sourceReason": string,        // one line for the producer on why this source suits the beat
  "timePeriod": {                // ONLY when the script establishes a date. Never guessed.
    "from": number,              // year, or null
    "to": number,                // year, or null
    "label": string              // e.g. "Second World War"
  },
  "excerpt": {                   // ONLY for archive_org — an archive item is a whole film
    "required": true,
    "targetDuration": number,    // seconds of it to use
    "selectionIntent": string    // what should be VISIBLE: "workers operating wartime machinery"
  },
  "editorialPurpose": string     // why this footage serves the story editorially
}

Write queries as a stock photographer would search: subject + action + setting.
Never write queries that depend on knowing what the narration says — write what the camera sees.

An archive is catalogued by what a film IS, not by what it shows. So archiveQueries
are phrased differently from stock queries: "1940s wartime factory newsreel" finds
something in a film archive, "happy worker in factory" does not. Use archive_org for
historical, documentary, newsreel, government and period material — anywhere authentic
period film says more than a modern restaging.

editorialPurpose is a production note, not a legal claim. Never assert that a use is
fair, permitted or safe. Whether uncleared material may be published is decided by a
person, and AETHER's rights policy decides whether it may be placed at all.

────────────────────────────────────────────────────
TEXT OVERLAY — required for stock_text and editorial_text
────────────────────────────────────────────────────
textOverlay: {
  "text": string,     // the full text to display (keep under 12 words)
  "emphasis": string, // the 1-3 words to make visually prominent
  "style": string     // "stat" | "quote" | "title" | "emphasis" | "callout"
}

────────────────────────────────────────────────────
HOST OVERLAY — when the channel host appears alongside the visual
────────────────────────────────────────────────────
"hostOverlay": "none" | "circle" | "rect" | "corner" | "full"
"full" only with visualType "presenter". "corner" or "circle" for explainer segments.
"none" for footage moments and anything emotional where a facecam breaks the mood.

────────────────────────────────────────────────────
CINEMATIC DIRECTION (for stock_video and stock_text)
────────────────────────────────────────────────────
"shotType":       "Extreme Wide" | "Wide" | "Medium" | "Close Up" | "Extreme Close Up" | "Over Shoulder" | "POV"
"cameraMovement": "Static" | "Slow Push In" | "Dolly In" | "Dolly Out" | "Pan Left" | "Pan Right" | "Crane Up" | "Crane Down" | "Handheld" | "Drone"
"motion":         what physically moves in the scene (one continuous moment)
"emotion":        one or two words describing the intended mood
"transition":     "cut" | "dissolve" — how this shot joins the NEXT one

────────────────────────────────────────────────────
RETENTION RULES
────────────────────────────────────────────────────
• Never let more than four consecutive scenes share the same visualType.
• Vary shot scale — back-to-back identical shot sizes kill momentum.
• Put a pattern interrupt every 30-40 seconds: change visual kind, bring in the host, or cut to a chart.
• The first 15 seconds determine the retention curve — open with the strongest image or the host's hook promise.
• A stock_video with no described motion is just an expensive still frame. Give every footage beat something that moves.
• Do NOT force abstract concepts into stock footage. A beat about "the feeling of existential dread" is editorial_text, not stock_video.

────────────────────────────────────────────────────
CONTINUITY
────────────────────────────────────────────────────
Flag any beat where the storyboard's environment, time of day, or weather contradicts the previous scene with no narrative reason.

Respond ONLY with JSON:
{
  "strategy": string,          // 2-3 sentences: overall visual approach for this video
  "warnings": [string],        // continuity problems spotted
  "scenes": [
    {
      "index": number,
      "visualType": string,          // from the vocabulary above
      "stockRequirements": {          // REQUIRED for stock_video, stock_photo, stock_text
        "concept": string,   // the shot, not the topic — see VISUAL INTENT below
        "queries": [string],
        "fallbackQueries": [string],
        "subjectCategory": string,
        "minimumDuration": number,
        "sourceStrategy": string,      // "archival" | "modern_stock" | "auto"
        "preferredSources": [string],  // "archive_org" | "pexels" | "pixabay"
        "archiveQueries": [string],    // only when archive_org is preferred
        "sourceReason": string,
        "timePeriod": { "from": number, "to": number, "label": string },
        "excerpt": { "required": true, "targetDuration": number, "selectionIntent": string },
        "editorialPurpose": string
      },
      "textOverlay": {                // REQUIRED for stock_text and editorial_text
        "text": string,
        "emphasis": string,
        "style": string
      },
      "graphic": {                    // REQUIRED for whiteboard, chart, map, timeline
        "title": string,
        "subtitle": string,
        "items": [string]             // max 6 items
      },
      "hostOverlay": string,
      "shotType": string,
      "cameraMovement": string,
      "motion": string,
      "emotion": string,
      "transition": string,
      "note": string
    }
  ]
}`;

  function videoPlanPrompt(payload) {
    const { scenes, bible, characters, modeBrief, strategyBrief, host, timing } = payload || {};
    const cast = (Array.isArray(characters) ? characters : [])
      .map((c) => `- ${c.name}: ${c.descriptor || c.description || ''}`)
      .filter(Boolean)
      .join('\n');
    const beats = (Array.isArray(scenes) ? scenes : [])
      .map((s) =>
        // Coerce once. The previous guard tested `(s.durationSec || 0).toFixed`
        // — always truthy, since 0 has the method — and then called it on the
        // raw value, so a scene without a duration threw while building the
        // prompt. The failure surfaced as "Cannot read properties of undefined"
        // from inside a provider fallback, which reads like a provider outage.
        `#${s.index} [${s.timestamp || ''}] (${Number(s.durationSec || 0).toFixed(1)}s)\n` +
        `  narration: ${s.subtitle || ''}\n` +
        `  action: ${s.detectedAction || s.sceneSummary || ''}\n` +
        `  where: ${[s.environment, s.timeOfDay, s.weather, s.lighting].filter(Boolean).join(', ')}\n` +
        `  who: ${(s.characters || []).join(', ') || '(nobody)'}`
      )
      .join('\n');

    // Measured narration timing, when the project has it. Presented as what it
    // is — positions read off the recorded voice — so the model places shots
    // against the audio rather than against sentence length. Absent, the model
    // is told plainly that nothing was measured, because a shot placed to the
    // tenth of a second on a guess is a false precision the renderer will then
    // treat as authoritative.
    const timingBlock = timing && Array.isArray(timing.segments) && timing.segments.length
      ? `MEASURED NARRATION TIMING (from forced alignment of the actual recording; `
        + `audio runs ${Number(timing.audioDuration || 0).toFixed(2)}s):\n`
        + `${JSON.stringify(timing.segments, null, 1)}\n\n`
        + `Place every beat against these numbers. timelineStart and timelineEnd are seconds on `
        + `the finished video's clock, they must not overlap between beats, and the last beat must `
        + `not end after the audio does. Never estimate a position when a measured one exists.`
      : `NARRATION TIMING: not measured. Do not invent timelineStart or timelineEnd — omit them, `
        + `and AETHER will lay the beats out from the cue list instead.`;

    const parts = [
      // Strategy first, then mode. Visual Intelligence sets the family the
      // subject demands; the mode sets the channel's house style within it.
      strategyBrief || '',
      modeBrief || '',
      host ? `CHANNEL HOST: ${host}` : 'CHANNEL HOST: none configured — do not plan presenter beats.',
      bible ? `PROJECT PROFILE:\n${JSON.stringify(bible, null, 2)}` : '',
      cast ? `CAST (keep these people consistent):\n${cast}` : '',
      timingBlock,
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
      scenes: scenes.map((s) => {
        const vt = oneOf(s && s.visualType, VISUAL_TYPES, 'stock_video');

        // ── Canvas/graphic spec (whiteboard, chart, map, timeline) ──────────
        // Kept only when there is real content to typeset; an empty spec
        // would render a blank card, which is worse than stock footage.
        const graphic = (() => {
          const g = s && s.graphic;
          if (!g || typeof g !== 'object') return null;
          const items = arr(g.items).map(String).filter(Boolean).slice(0, 6);
          const spec  = { title: str(g.title), subtitle: str(g.subtitle), items };
          return (spec.title || items.length) ? spec : null;
        })();

        // ── Stock requirements (stock_video, stock_photo, stock_text) ────────
        // Validated: must contain at least one non-empty query string.
        const stockRequirements = (() => {
          const r = s && s.stockRequirements;
          if (!r || typeof r !== 'object') return null;
          const queries         = arr(r.queries).map(String).filter(Boolean).slice(0, 6);
          const fallbackQueries = arr(r.fallbackQueries).map(String).filter(Boolean).slice(0, 4);
          if (!queries.length) return null;

          // ── Source intelligence ────────────────────────────────────────
          // Which library to ask is a directing decision, not a lookup: a
          // 1969 launch wants the archive, a modern coffee shop does not.
          // Dropping these fields here would silently discard that decision
          // and send every beat to the same two stock libraries.
          // Deduplicated: asked for a list, the live 27B answered
          // ["archive_org","archive_org","archive_org"], and a repeated
          // preference would search the same library three times and read on
          // screen as three separate decisions.
          const SOURCES = ['pexels', 'pixabay', 'archive_org'];
          const preferredSources = arr(r.preferredSources)
            .map((s) => String(s || '').toLowerCase().trim())
            .filter((s, i, all) => SOURCES.indexOf(s) > -1 && all.indexOf(s) === i)
            .slice(0, 3);

          const timePeriod = (() => {
            const t = r.timePeriod;
            if (!t || typeof t !== 'object') return null;
            const from = Number(t.from_year != null ? t.from_year : t.from);
            const to   = Number(t.to_year   != null ? t.to_year   : t.to);
            const label = str(t.label);
            // A period with neither a year nor a label narrows nothing.
            if (!Number.isFinite(from) && !Number.isFinite(to) && !label) return null;
            return {
              from:  Number.isFinite(from) ? from : null,
              to:    Number.isFinite(to)   ? to   : null,
              label
            };
          })();

          // An archive item is a whole film, so a beat needs a window into it.
          // The Director says how long and what should be visible; it never
          // names timecodes, because choosing the moment means examining the
          // footage and that happens in ArchiveExcerpt.
          // Required by the grammar on an archival beat since 2.2, and absent
          // from a modern one by construction — so its presence is a signal,
          // not just a bonus field. Still tolerated as missing: this parser
          // also handles plans from the /generate fallback, which has no
          // grammar behind it.
          const excerpt = (() => {
            const e = r.excerpt;
            if (!e || typeof e !== 'object') return null;
            const target = Number(e.targetDuration);
            const intent = str(e.selectionIntent);
            if (!Number.isFinite(target) && !intent) return null;
            return {
              required: e.required !== false,
              targetDuration: Number.isFinite(target) ? Math.min(60, Math.max(1, target)) : 6,
              selectionIntent: intent
            };
          })();

          return {
            concept:          str(r.concept),
            queries,
            fallbackQueries,
            subjectCategory:  str(r.subjectCategory),
            minimumDuration:  Number(r.minimumDuration) || 0,
            sourceStrategy:   oneOf(r.sourceStrategy, SOURCE_STRATEGIES, 'auto'),
            preferredSources,
            archiveQueries:   arr(r.archiveQueries).map(String).filter((q, i, all) => q && all.indexOf(q) === i).slice(0, 3),
            sourceReason:     str(r.sourceReason),
            timePeriod,
            excerpt,
            // A production note on why this footage serves the story. Never a
            // legal claim: whether uncleared material may be published is
            // decided by a person, and the rights policy decides placement.
            editorialPurpose: str(r.editorialPurpose)
          };
        })();

        // ── Text overlay (stock_text, editorial_text) ────────────────────────
        const textOverlay = (() => {
          const t = s && s.textOverlay;
          if (!t || typeof t !== 'object') return null;
          const text = str(t.text);
          if (!text) return null;
          return {
            text,
            emphasis: str(t.emphasis),
            style:    oneOf(t.style, ['stat', 'quote', 'title', 'emphasis', 'callout'], 'emphasis')
          };
        })();

        // Seconds on the finished video's clock, and only when the model gave
        // both and they run forwards. A half-specified or inverted window is
        // dropped rather than repaired: editor.js treats these as authoritative
        // once timingSource is 'whisper', so a guess here becomes a wrong cut.
        const placement = (() => {
          const a = Number(s && s.timelineStart);
          const b = Number(s && s.timelineEnd);
          if (!Number.isFinite(a) || !Number.isFinite(b)) return { };
          if (a < 0 || b <= a) return { };
          return { timelineStart: Math.round(a * 1000) / 1000, timelineEnd: Math.round(b * 1000) / 1000 };
        })();

        return Object.assign({
          index:            Number(s && s.index),
          visualType:       vt,
          stockRequirements,
          textOverlay,
          graphic,
          hostOverlay:      oneOf(s && s.hostOverlay, HOST_OVERLAYS, 'none'),
          shotType:         oneOf(s && s.shotType, SHOT_TYPES, ''),
          cameraMovement:   oneOf(s && s.cameraMovement, CAMERA_MOVES, 'Static'),
          motion:           str(s && s.motion),
          emotion:          str(s && s.emotion),
          transition:       oneOf(s && s.transition, ['cut', 'dissolve'], 'cut'),
          note:             str(s && s.note)
        }, placement);
      }).filter((s) => Number.isFinite(s.index))
    };
  }

  window.VISUAL_STYLES = VISUAL_STYLES;
  window.BlvckPrompts = {
    stateRejections,
    stateRejectionReport,
    STATE_ATTRIBUTES,
    SUBJECT_STRUCTURES,
    OBJECT_KINDS,
    OBJECT_FORMS,
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
