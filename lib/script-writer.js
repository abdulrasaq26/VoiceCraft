'use strict';

// Script-generation prompt scaffolding. The browser fetches the prompt
// (promptOnly:true), runs it through Puter's chat model, and gets back plain
// narration text — no JSON parsing needed, so there's no rawText round-trip.

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

function scriptPrompt(opts = {}) {
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

// Strip anything a model might add despite instructions (markdown fences,
// a leading "Title:" line, stage directions in brackets).
function cleanScript(raw) {
  let text = String(raw || '').trim();
  text = text.replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '');
  text = text.replace(/^\s*(title|script)\s*:.*$/im, '').trim();
  return text;
}

module.exports = { scriptPrompt, cleanScript, TYPE_BRIEFS, LENGTH_GUIDE };
