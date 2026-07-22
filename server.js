require('dotenv').config();

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const API_KEY = process.env.GOOGLE_TTS_API_KEY || '';
const GOOGLE_TTS_BASE = 'https://texttospeech.googleapis.com/v1';

// The official client library is only used when no API key is configured,
// falling back to Application Default Credentials / a service account file.
let ttsClient = null;
function getTtsClient() {
  if (!ttsClient) {
    const textToSpeech = require('@google-cloud/text-to-speech');
    ttsClient = new textToSpeech.TextToSpeechClient();
  }
  return ttsClient;
}

const MAX_INPUT_BYTES = 5000; // Google Cloud TTS per-request limit

const AUDIO_FORMATS = {
  MP3: { encoding: 'MP3', mime: 'audio/mpeg', ext: 'mp3' },
  OGG_OPUS: { encoding: 'OGG_OPUS', mime: 'audio/ogg', ext: 'ogg' },
  LINEAR16: { encoding: 'LINEAR16', mime: 'audio/wav', ext: 'wav' }
};

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function credentialsConfigured() {
  return Boolean(
    API_KEY ||
      process.env.GOOGLE_APPLICATION_CREDENTIALS ||
      process.env.GOOGLE_CLOUD_PROJECT ||
      process.env.GCLOUD_PROJECT
  );
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    authMode: API_KEY ? 'api-key' : 'application-default-credentials',
    credentialsConfigured: credentialsConfigured()
  });
});

// List available voices, optionally filtered by language code.
app.get('/api/voices', async (req, res) => {
  const languageCode = (req.query.languageCode || '').trim();
  try {
    let voices;
    if (API_KEY) {
      const url = new URL(`${GOOGLE_TTS_BASE}/voices`);
      if (languageCode) url.searchParams.set('languageCode', languageCode);
      url.searchParams.set('key', API_KEY);
      const response = await fetch(url);
      const body = await response.json();
      if (!response.ok) {
        throw httpError(response.status, body?.error?.message || 'Failed to list voices');
      }
      voices = body.voices || [];
    } else {
      const [result] = await getTtsClient().listVoices(
        languageCode ? { languageCode } : {}
      );
      voices = result.voices || [];
    }

    voices.sort((a, b) => a.name.localeCompare(b.name));
    res.json({ voices });
  } catch (err) {
    sendApiError(res, err, 'Unable to fetch voices from Google Cloud TTS');
  }
});

// Short sample phrases for voice previews, keyed by language prefix.
const PREVIEW_PHRASES = {
  en: 'Hello! This is a preview of my voice.',
  es: '¡Hola! Esta es una muestra de mi voz.',
  fr: 'Bonjour ! Voici un aperçu de ma voix.',
  de: 'Hallo! Dies ist eine Vorschau meiner Stimme.',
  it: 'Ciao! Questa è un’anteprima della mia voce.',
  pt: 'Olá! Esta é uma amostra da minha voz.',
  nl: 'Hallo! Dit is een voorbeeld van mijn stem.',
  pl: 'Cześć! To jest próbka mojego głosu.',
  ru: 'Привет! Это образец моего голоса.',
  ja: 'こんにちは。これは私の声のプレビューです。',
  ko: '안녕하세요! 제 목소리 미리듣기입니다.',
  zh: '你好！这是我的声音预览。',
  cmn: '你好！这是我的声音预览。',
  yue: '你好！呢個係我把聲嘅預覽。',
  hi: 'नमस्ते! यह मेरी आवाज़ का एक नमूना है।',
  ar: 'مرحباً! هذه معاينة لصوتي.',
  tr: 'Merhaba! Bu, sesimin bir önizlemesidir.',
  vi: 'Xin chào! Đây là bản xem trước giọng nói của tôi.',
  th: 'สวัสดี! นี่คือตัวอย่างเสียงของฉัน',
  id: 'Halo! Ini adalah pratinjau suara saya.',
  sv: 'Hej! Det här är en förhandsvisning av min röst.',
  da: 'Hej! Dette er en prøve på min stemme.',
  nb: 'Hei! Dette er en forhåndsvisning av stemmen min.',
  fi: 'Hei! Tämä on esikatselu äänestäni.',
  uk: 'Привіт! Це зразок мого голосу.',
  el: 'Γεια σας! Αυτή είναι μια προεπισκόπηση της φωνής μου.',
  cs: 'Ahoj! Toto je ukázka mého hlasu.',
  he: 'שלום! זוהי תצוגה מקדימה של הקול שלי.',
  bn: 'নমস্কার! এটি আমার কণ্ঠস্বরের একটি নমুনা।',
  ta: 'வணக்கம்! இது என் குரலின் மாதிரி.'
};

function previewPhrase(languageCode) {
  const prefix = (languageCode || 'en').split('-')[0].toLowerCase();
  return PREVIEW_PHRASES[prefix] || PREVIEW_PHRASES.en;
}

// Cached voice previews so repeated listens don't re-bill the API.
const previewCache = new Map();
const PREVIEW_CACHE_MAX = 200;

// Play a short sample of a voice without consuming the user's text.
app.get('/api/preview', async (req, res) => {
  const voiceName = (req.query.voiceName || '').trim();
  const languageCode = (req.query.languageCode || '').trim() || 'en-US';
  if (!voiceName) {
    return res.status(400).json({ error: 'voiceName is required.' });
  }

  const cached = previewCache.get(voiceName);
  if (cached) {
    // Refresh recency so hot voices stay cached.
    previewCache.delete(voiceName);
    previewCache.set(voiceName, cached);
    return sendPreview(res, cached);
  }

  const request = {
    input: { text: previewPhrase(languageCode) },
    voice: { name: voiceName, languageCode },
    audioConfig: { audioEncoding: 'MP3' }
  };

  try {
    let audioBuffer;
    if (API_KEY) {
      const response = await fetch(`${GOOGLE_TTS_BASE}/text:synthesize?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });
      const body = await response.json();
      if (!response.ok) {
        throw httpError(response.status, body?.error?.message || 'Preview synthesis failed');
      }
      audioBuffer = Buffer.from(body.audioContent, 'base64');
    } else {
      const [response] = await getTtsClient().synthesizeSpeech(request);
      audioBuffer = Buffer.from(response.audioContent);
    }

    previewCache.set(voiceName, audioBuffer);
    if (previewCache.size > PREVIEW_CACHE_MAX) {
      previewCache.delete(previewCache.keys().next().value);
    }
    sendPreview(res, audioBuffer);
  } catch (err) {
    sendApiError(res, err, 'Voice preview failed');
  }
});

function sendPreview(res, audioBuffer) {
  res.set({
    'Content-Type': 'audio/mpeg',
    'Content-Length': audioBuffer.length,
    'Cache-Control': 'private, max-age=86400'
  });
  res.send(audioBuffer);
}

// Synthesize speech from text or SSML.
app.post('/api/synthesize', async (req, res) => {
  const {
    text = '',
    ssml = false,
    voiceName = '',
    languageCode = 'en-US',
    audioFormat = 'MP3',
    speakingRate = 1.0,
    pitch = 0.0,
    volumeGainDb = 0.0
  } = req.body || {};

  const input = String(text).trim();
  if (!input) {
    return res.status(400).json({ error: 'Text is required.' });
  }
  if (Buffer.byteLength(input, 'utf8') > MAX_INPUT_BYTES) {
    return res.status(400).json({
      error: `Input exceeds the ${MAX_INPUT_BYTES}-byte limit imposed by Google Cloud TTS. Split the text into smaller chunks.`
    });
  }

  const format = AUDIO_FORMATS[audioFormat] || AUDIO_FORMATS.MP3;
  const rate = clamp(Number(speakingRate) || 1.0, 0.25, 4.0);
  const pitchValue = clamp(Number(pitch) || 0.0, -20.0, 20.0);
  const gain = clamp(Number(volumeGainDb) || 0.0, -96.0, 16.0);

  const request = {
    input: ssml ? { ssml: input } : { text: input },
    voice: voiceName
      ? { name: voiceName, languageCode: languageCode || voiceName.split('-').slice(0, 2).join('-') }
      : { languageCode: languageCode || 'en-US' },
    audioConfig: {
      audioEncoding: format.encoding,
      speakingRate: rate,
      pitch: pitchValue,
      volumeGainDb: gain
    }
  };

  try {
    let audioBuffer;
    if (API_KEY) {
      const response = await fetch(`${GOOGLE_TTS_BASE}/text:synthesize?key=${API_KEY}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request)
      });
      const body = await response.json();
      if (!response.ok) {
        throw httpError(response.status, body?.error?.message || 'Synthesis failed');
      }
      audioBuffer = Buffer.from(body.audioContent, 'base64');
    } else {
      const [response] = await getTtsClient().synthesizeSpeech(request);
      audioBuffer = Buffer.from(response.audioContent);
    }

    res.set({
      'Content-Type': format.mime,
      'Content-Length': audioBuffer.length,
      'Content-Disposition': `inline; filename="speech.${format.ext}"`,
      'Cache-Control': 'no-store'
    });
    res.send(audioBuffer);
  } catch (err) {
    sendApiError(res, err, 'Speech synthesis failed');
  }
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function sendApiError(res, err, fallbackMessage) {
  console.error(`${fallbackMessage}:`, err.message);
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 502;
  let hint;
  if (!credentialsConfigured()) {
    hint =
      'No Google Cloud credentials detected. Set GOOGLE_TTS_API_KEY or GOOGLE_APPLICATION_CREDENTIALS — see README.md for setup steps.';
  }
  res.status(status).json({ error: err.message || fallbackMessage, hint });
}

app.listen(PORT, () => {
  console.log(`Blvck TTS running at http://localhost:${PORT}`);
  console.log(
    API_KEY
      ? 'Auth mode: API key (GOOGLE_TTS_API_KEY)'
      : 'Auth mode: Application Default Credentials / service account'
  );
  if (!credentialsConfigured()) {
    console.warn(
      'Warning: no Google Cloud credentials configured. Requests to /api/voices and /api/synthesize will fail until you set them up (see README.md).'
    );
  }
});
