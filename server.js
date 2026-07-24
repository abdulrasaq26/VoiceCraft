'use strict';

// Blvck-TTS server — Puter-first, serverless-in-spirit.
//
// The browser talks directly to Puter for speech (ElevenLabs), text (Claude,
// GPT, Qwen, Llama, DeepSeek, …), images, and video. No third-party API keys
// live on the server anymore.
//
// This tiny Express app exists only to:
//   1. Serve the static frontend
//   2. Own the source-of-truth prompts for storyboard + SEO, so the browser
//      can ask for a prompt (`promptOnly:true`) and post the model's raw
//      output back for parsing (`rawText`). Prompt engineering stays in one
//      place; the LLM call itself runs in the browser via puter.ai.chat.

const express = require('express');
const path = require('path');

const storyboard = require('./lib/storyboard');
const seo = require('./lib/youtube-seo');
const scriptWriter = require('./lib/script-writer');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, provider: 'puter' });
});

// Story bible prompt + parse. Body flags:
//   { context, promptOnly: true }  → { prompt: { system, user } }
//   { rawText }                    → { bible }
app.post('/api/storyboard/bible', (req, res) => {
  const { context = {}, promptOnly, rawText } = req.body || {};
  if (promptOnly) {
    if (!context.script && !context.subtitles) {
      return res.status(400).json({ error: 'Provide subtitles or a script first.' });
    }
    return res.json({ prompt: storyboard.biblePrompt(context) });
  }
  if (typeof rawText === 'string') {
    try {
      return res.json({ bible: storyboard.parseBible(rawText) });
    } catch (err) {
      return sendGenError(res, err, 'Could not parse the model output');
    }
  }
  res.status(400).json({ error: 'Send { promptOnly: true } to fetch the prompt, or { rawText } to parse a response.' });
});

app.post('/api/storyboard/scenes', (req, res) => {
  const { bible, cues, style, instructions, priorSummaries, promptOnly, rawText } = req.body || {};
  if (!bible || !Array.isArray(cues) || !cues.length) {
    return res.status(400).json({ error: 'A story bible and cues are required.' });
  }
  if (cues.length > 40) {
    return res.status(400).json({ error: 'Send at most 40 cues per batch.' });
  }
  if (promptOnly) {
    return res.json({ prompt: storyboard.scenesPrompt({ bible, cues, style, instructions, priorSummaries }) });
  }
  if (typeof rawText === 'string') {
    try {
      return res.json(storyboard.parseScenes(rawText, cues));
    } catch (err) {
      return sendGenError(res, err, 'Could not parse the model output');
    }
  }
  res.status(400).json({ error: 'Send { promptOnly: true } to fetch the prompt, or { rawText } to parse a response.' });
});

app.post('/api/seo/generate', (req, res) => {
  const project = req.body?.project || {};
  const channel = req.body?.channel || {};
  const { promptOnly, rawText } = req.body || {};
  if (!project.title && !project.script && !project.subtitles && !project.bible) {
    return res.status(400).json({ error: 'The selected project has no story content to analyze yet.' });
  }
  if (promptOnly) {
    return res.json({ prompt: seo.seoPrompt(project, channel) });
  }
  if (typeof rawText === 'string') {
    try {
      return res.json({ seo: seo.parseSeo(rawText, project) });
    } catch (err) {
      return sendGenError(res, err, 'Could not parse the model output');
    }
  }
  res.status(400).json({ error: 'Send { promptOnly: true } to fetch the prompt, or { rawText } to parse a response.' });
});

// Script generation. Body flags:
//   { options, promptOnly: true } → { prompt: { system, user } }
//   { rawText }                   → { script }
app.post('/api/script/generate', (req, res) => {
  const { options = {}, promptOnly, rawText } = req.body || {};
  if (promptOnly) {
    return res.json({ prompt: scriptWriter.scriptPrompt(options) });
  }
  if (typeof rawText === 'string') {
    return res.json({ script: scriptWriter.cleanScript(rawText) });
  }
  res.status(400).json({ error: 'Send { promptOnly: true } to fetch the prompt, or { rawText } to clean a response.' });
});

function sendGenError(res, err, fallback) {
  console.error(`${fallback}:`, err.message);
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
  res.status(status).json({ error: err.message || fallback });
}

app.listen(PORT, () => {
  console.log(`Blvck TTS running at http://localhost:${PORT}`);
  console.log('Backend mode: Puter-first (no API keys required).');
});
