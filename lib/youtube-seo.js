'use strict';

const text = require('./gemini-text');

const MOCK = process.env.MOCK_IMAGE === '1' || process.env.MOCK_TTS === '1';

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

async function buildSeo(project, channel) {
  if (MOCK) return normalize(mockSeo(project, channel), project);
  const user = buildUserBlock(project, channel);
  const json = await text.generate(SEO_SYSTEM, user, { json: true, temperature: 0.85 });
  return normalize(json, project);
}

function buildUserBlock(project, channel) {
  const parts = [];
  parts.push(`VIDEO TITLE / WORKING NAME: ${project.title || 'Untitled'}`);
  if (project.bible) parts.push(`STORY BIBLE:\n${JSON.stringify(project.bible, null, 2)}`);
  if (project.script) parts.push(`SCRIPT / NARRATION:\n${String(project.script).slice(0, 8000)}`);
  else if (project.subtitles) parts.push(`SUBTITLES:\n${String(project.subtitles).slice(0, 8000)}`);
  parts.push(`CHANNEL KNOWLEDGE BASE:\n${JSON.stringify(channel || {}, null, 2)}`);
  return parts.join('\n\n');
}

// --- Normalisation -----------------------------------------------------

function arr(v) {
  return Array.isArray(v) ? v : [];
}
function str(v, d = '') {
  return v == null ? d : String(v);
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

function normalize(j, project) {
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

// --- Mock --------------------------------------------------------------

function mockSeo(project, channel) {
  const topic = project.title || 'A Day in the Life of a Medieval Peasant';
  const brand = (channel && channel.name) || 'Born Back Then';
  const mkTitles = (kind) =>
    Array.from({ length: 10 }, (_, i) => ({
      title: `${topic} — ${kind} variation ${i + 1}`,
      seoScore: 70 + ((i * 3) % 25),
      ctrScore: 65 + ((i * 5) % 30),
      competitionScore: 40 + ((i * 7) % 40),
      readabilityScore: 80 - ((i * 2) % 15),
      usage: kind === 'seo' ? 'Search discovery' : kind === 'ctr' ? 'Homepage/suggested CTR' : 'Balanced everyday use'
    }));
  const thumb = (v, focus) => ({
    version: v,
    text: v === 'A' ? 'THEIR SECRET LIFE' : 'WHAT THEY HID',
    visualFocus: focus,
    emotionalTrigger: 'Empathy and hardship',
    curiosityTrigger: 'What were they hiding?',
    reasoning: 'High-contrast face + bold text drives CTR while staying on-brand.',
    prompt: `Cinematic ${brand} thumbnail: ${focus}, dark cinematic background, warm rim lighting, historical authenticity, strong visual hierarchy, generous empty space on the right reserved for bold overlay text, premium 2D historical illustration.`,
    scores: { curiosity: 82, ctr: v === 'A' ? 88 : 79, readability: 90, mobile: 85, brand: 92 }
  });
  return {
    titles: { seo: mkTitles('seo'), ctr: mkTitles('ctr'), balanced: mkTitles('balanced') },
    recommendedTitle: `${topic} (You Won't Believe How They Lived)`,
    description: {
      long: `Step back in time and experience ${topic.toLowerCase()}.\n\nIn this immersive documentary from ${brand}, we uncover the daily struggles, hidden rituals and quiet resilience of ordinary people history forgot.\n\nKeywords: medieval life, history documentary, ${topic.toLowerCase()}.\n\n▶ Subscribe for a new story every week.\n\n— Channel links —\nYouTube: [your channel]\n\n— Credits —\nNarration & visuals: ${brand}.`,
      short: `${topic} — an immersive ${brand} history documentary. Subscribe for weekly stories.`
    },
    keywords: {
      primary: 'medieval peasant life',
      secondary: ['medieval history', 'daily life middle ages', 'history documentary'],
      longTail: ['what was daily life like for a medieval peasant', 'a day in the life of a medieval farmer'],
      intent: 'Viewers searching to understand ordinary medieval life; educational + immersive intent.'
    },
    tags: {
      broad: ['history', 'documentary', 'education'],
      niche: ['medieval peasant', 'middle ages daily life', 'feudal england'],
      longTail: ['a day in the life medieval peasant', 'medieval village life documentary'],
      trending: ['history explained', 'immersive history']
    },
    hashtags: {
      highVolume: ['#History', '#Documentary', '#MiddleAges'],
      niche: ['#MedievalLife', '#MedievalEngland', '#HistoryDocumentary'],
      brand: [`#${brand.replace(/\s+/g, '')}`]
    },
    thumbnails: [thumb('A', 'weathered medieval peasant looking toward a misty village at dawn'), thumb('B', 'close-up of calloused hands holding bread by candlelight')],
    recommendedThumbnail: 'A'
  };
}

function configured() {
  return MOCK || text.configured();
}

module.exports = { buildSeo, configured };
