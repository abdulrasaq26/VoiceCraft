'use strict';

require('dotenv').config();

// Thin REST client for the Google Cloud Text-to-Speech API supporting both
// auth modes (API key / Application Default Credentials) plus a MOCK_TTS=1
// mode that serves canned data so the UI can be developed and tested
// without credentials or billing.

const API_KEY = process.env.GOOGLE_TTS_API_KEY || '';
const MOCK = process.env.MOCK_TTS === '1';
const V1 = 'https://texttospeech.googleapis.com/v1';
const V1BETA1 = 'https://texttospeech.googleapis.com/v1beta1';
const REQUEST_TIMEOUT_MS = 30000;

let auth = null;
async function authHeader() {
  if (!auth) {
    const { GoogleAuth } = require('google-auth-library');
    auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/cloud-platform'] });
  }
  const token = await auth.getAccessToken();
  return { Authorization: `Bearer ${token}` };
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

async function googleFetch(base, pathname, { method = 'GET', body } = {}) {
  const url = new URL(base + pathname);
  const headers = { 'Content-Type': 'application/json' };
  if (API_KEY) {
    url.searchParams.set('key', API_KEY);
  } else {
    Object.assign(headers, await authHeader());
  }
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  });
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // Non-JSON body; fall through to status handling.
  }
  if (!response.ok) {
    throw httpError(response.status, payload?.error?.message || `Google TTS API error (${response.status})`);
  }
  return payload;
}

async function listVoices() {
  if (MOCK) return mockVoices();
  const body = await googleFetch(V1, '/voices');
  return body.voices || [];
}

// request: a SynthesizeSpeechRequest body. Returns the audio as a Buffer.
// beta: use v1beta1 (needed for prompt-capable voices).
async function synthesize(request, { beta = false } = {}) {
  if (MOCK) return mockWav();
  const body = await googleFetch(beta ? V1BETA1 : V1, '/text:synthesize', {
    method: 'POST',
    body: request
  });
  return Buffer.from(body.audioContent, 'base64');
}

function credentialsConfigured() {
  return Boolean(
    MOCK ||
      API_KEY ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT
  );
}

function authMode() {
  if (MOCK) return 'mock';
  return API_KEY ? 'api-key' : 'application-default-credentials';
}

// --- Mock mode -----------------------------------------------------------

function mockVoices() {
  const voice = (name, gender, lang = 'en-US') => ({
    name,
    ssmlGender: gender,
    languageCodes: [lang],
    naturalSampleRateHertz: 24000
  });
  return [
    voice('en-US-Studio-O', 'FEMALE'),
    voice('en-US-Studio-Q', 'MALE'),
    voice('en-US-Chirp3-HD-Aoede', 'FEMALE'),
    voice('en-US-Chirp3-HD-Puck', 'MALE'),
    voice('en-US-Neural2-A', 'MALE'),
    voice('en-US-Neural2-C', 'FEMALE'),
    voice('en-US-Neural2-D', 'MALE'),
    voice('en-US-Neural2-E', 'FEMALE'),
    voice('en-US-Neural2-I', 'MALE'),
    voice('en-US-Neural2-J', 'MALE'),
    voice('en-US-Wavenet-A', 'MALE'),
    voice('en-US-Wavenet-C', 'FEMALE'),
    voice('en-US-Standard-B', 'MALE'),
    voice('en-US-Standard-E', 'FEMALE'),
    voice('en-US-News-K', 'FEMALE'),
    voice('en-US-Polyglot-1', 'MALE'),
    voice('fr-FR-Neural2-A', 'FEMALE', 'fr-FR'),
    voice('fr-FR-Neural2-B', 'MALE', 'fr-FR'),
    // Intentional duplicate: exercises the dedupe path.
    voice('en-US-Neural2-C', 'FEMALE')
  ];
}

// 0.6s 440Hz sine, 16-bit mono 24kHz WAV — playable in every browser.
function mockWav() {
  const sampleRate = 24000;
  const seconds = 0.6;
  const samples = Math.floor(sampleRate * seconds);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const fade = Math.min(1, (samples - i) / (sampleRate * 0.05), i / (sampleRate * 0.02));
    const value = Math.round(Math.sin((2 * Math.PI * 440 * i) / sampleRate) * 8000 * fade);
    data.writeInt16LE(value, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

module.exports = { listVoices, synthesize, credentialsConfigured, authMode, MOCK, httpError };
