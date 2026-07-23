'use strict';

require('dotenv').config();

// Low-level Gemini text-generation call used by the storyboard story-analysis
// layer. Same API key as the image provider.

const API_KEY = process.env.GEMINI_API_KEY || '';
const MODEL = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const REQUEST_TIMEOUT_MS = Number(process.env.TEXT_TIMEOUT_MS) || 60000;

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function configured() {
  return Boolean(API_KEY);
}

// Returns the model's text output. When `json` is true, asks the model for
// strict JSON and returns the parsed object.
async function generate(system, user, { json = false, temperature = 0.8 } = {}) {
  const url = `${BASE}/models/${MODEL}:generateContent?key=${API_KEY}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: user }] }],
    generationConfig: { temperature }
  };
  if (system) body.systemInstruction = { parts: [{ text: system }] };
  if (json) body.generationConfig.responseMimeType = 'application/json';

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });

  let data = null;
  try {
    data = await response.json();
  } catch {
    /* handled below */
  }
  if (!response.ok) {
    throw httpError(response.status, data?.error?.message || `Text generation failed (${response.status})`);
  }

  const text = (data?.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text)
    .filter(Boolean)
    .join('');
  if (!text) throw httpError(502, 'The model returned an empty response.');

  if (!json) return text;
  try {
    return JSON.parse(text);
  } catch {
    // Models occasionally wrap JSON in prose/fences — extract the first object.
    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {
        /* fall through */
      }
    }
    throw httpError(502, 'The model did not return valid JSON.');
  }
}

module.exports = { generate, configured, MODEL };
