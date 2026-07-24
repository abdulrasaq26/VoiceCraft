'use strict';

const { extractJson } = require('./storyboard');

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
  return { system: SEO_SYSTEM, user: buildUserBlock(project, channel) };
}

function parseSeo(rawText, project) {
  return normalize(extractJson(rawText), project);
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

function arr(v) { return Array.isArray(v) ? v : []; }
function str(v, d = '') { return v == null ? d : String(v); }
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

module.exports = { seoPrompt, parseSeo };
