'use strict';

// Story-bible + scene-prompt scaffolding. The server builds the prompts and
// parses the model's JSON; the actual LLM call runs in the browser via
// puter.ai.chat. Keeping prompts server-side keeps a single source of truth.

// The permanent channel visual identity, injected into every image prompt.
const CHANNEL_STYLE = [
  'Premium 2D historical illustration, semi-realistic painterly artwork.',
  'Cinematic storytelling composition with historical authenticity.',
  'Warm atmospheric lighting, rich environmental detail, storybook-quality visuals.',
  'Consistent color grading, "you-are-there" immersion, educational documentary feel.',
  'No text, no captions, no watermarks, no modern objects.'
].join(' ');

const CHANNEL_NAME = 'Born Back Then';

const CAMERAS = [
  'Wide Shot',
  'Medium Shot',
  'Close-Up',
  'Overhead View',
  'Environment Shot',
  'Object-Focused Shot',
  'Crowd Scene',
  'Character Scene'
];

// --- Story bible -------------------------------------------------------

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

function biblePrompt(context) {
  return { system: BIBLE_SYSTEM, user: buildContextBlock(context) };
}

function parseBible(rawText) {
  return normalizeBible(extractJson(rawText));
}

// --- Scene prompts -----------------------------------------------------

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

function scenesPrompt({ bible, cues, style, instructions, priorSummaries }) {
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

function parseScenes(rawText, cues) {
  const result = extractJson(rawText);
  const scenes = Array.isArray(result?.scenes) ? result.scenes : [];
  return { scenes: scenes.map((s, i) => normalizeScene(s, cues[i], cues)) };
}

// --- Helpers -----------------------------------------------------------

function buildContextBlock(context) {
  const parts = [];
  if (context.script) parts.push(`FULL SCRIPT:\n${context.script}`);
  if (context.subtitles) parts.push(`SUBTITLES:\n${context.subtitles}`);
  if (context.style) parts.push(`VISUAL STYLE GUIDE:\n${context.style}`);
  if (context.characters) parts.push(`CHARACTER REFERENCE:\n${context.characters}`);
  if (context.instructions) parts.push(`CUSTOM INSTRUCTIONS:\n${context.instructions}`);
  return parts.join('\n\n');
}

function normalizeBible(b) {
  return {
    title: String(b?.title || 'Untitled Story'),
    period: String(b?.period || ''),
    tone: String(b?.tone || ''),
    colorGrading: String(b?.colorGrading || ''),
    characters: Array.isArray(b?.characters) ? b.characters.slice(0, 30) : [],
    locations: Array.isArray(b?.locations) ? b.locations.slice(0, 30) : [],
    recurringElements: Array.isArray(b?.recurringElements) ? b.recurringElements.slice(0, 30) : []
  };
}

function normalizeScene(s, cue, cues) {
  const idx = Number.isFinite(s?.index) ? s.index : cue ? cue.index : 0;
  const source = cue || (cues || []).find((c) => c.index === idx) || {};
  const prompt = String(s?.prompt || '').trim() || `${source.text || ''}. ${CHANNEL_STYLE}`;
  const withStyle = prompt.includes('Premium 2D historical') ? prompt : `${prompt} ${CHANNEL_STYLE}`;
  return {
    index: idx,
    timestamp: source.timestamp || '',
    subtitle: source.text || '',
    sceneType: String(s?.sceneType || 'Scene'),
    camera: String(s?.camera || 'Medium Shot'),
    visualFocus: String(s?.visualFocus || ''),
    sceneSummary: String(s?.sceneSummary || source.text || ''),
    prompt: withStyle
  };
}

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
    const err = new Error('The model did not return valid JSON.');
    err.status = 502;
    throw err;
  }
}

module.exports = {
  biblePrompt,
  parseBible,
  scenesPrompt,
  parseScenes,
  extractJson,
  CHANNEL_STYLE,
  CHANNEL_NAME,
  CAMERAS
};
