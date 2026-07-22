'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const tts = require('./lib/google-tts');
const { enrichVoices, capabilitiesFor, promptCapable } = require('./lib/voice-catalog');

const app = express();
const PORT = process.env.PORT || 3000;

const MAX_INPUT_BYTES = 5000; // Google Cloud TTS per-request limit
const MAX_INSTRUCTION_CHARS = 2500;
const VOICES_CACHE_TTL_MS = 10 * 60 * 1000;
const VOICE_NAME_PATTERN = /^[A-Za-z0-9._-]{1,80}$/;

const AUDIO_FORMATS = {
  MP3: { encoding: 'MP3', mime: 'audio/mpeg', ext: 'mp3' },
  OGG_OPUS: { encoding: 'OGG_OPUS', mime: 'audio/ogg', ext: 'ogg' },
  LINEAR16: { encoding: 'LINEAR16', mime: 'audio/wav', ext: 'wav' }
};

app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// --- Voice health -------------------------------------------------------
// Voices listed in voice-blocklist.json (written by `npm run verify-voices`)
// or that fail a live preview are hidden from the catalog so users only
// ever see voices that can actually speak.

const BLOCKLIST_PATH = path.join(__dirname, 'voice-blocklist.json');
let staticBlocklist = new Set();
try {
  if (fs.existsSync(BLOCKLIST_PATH)) {
    const entries = JSON.parse(fs.readFileSync(BLOCKLIST_PATH, 'utf8'));
    staticBlocklist = new Set(Array.isArray(entries) ? entries : []);
    if (staticBlocklist.size) {
      console.log(`Loaded voice blocklist: ${staticBlocklist.size} voice(s) hidden`);
    }
  }
} catch (err) {
  console.warn('Could not read voice-blocklist.json:', err.message);
}
const runtimeBlocked = new Set();

function isBlocked(voiceName) {
  return staticBlocklist.has(voiceName) || runtimeBlocked.has(voiceName);
}

function markVoiceFailed(voiceName, reason) {
  if (!runtimeBlocked.has(voiceName)) {
    runtimeBlocked.add(voiceName);
    voicesCache.at = 0; // force catalog refresh so the voice disappears
    console.warn(`Voice "${voiceName}" hidden after failure: ${reason}`);
  }
}

// --- Voice catalog ------------------------------------------------------

const voicesCache = { at: 0, voices: null };

async function getCatalog() {
  if (voicesCache.voices && Date.now() - voicesCache.at < VOICES_CACHE_TTL_MS) {
    return voicesCache.voices;
  }
  const raw = await tts.listVoices();
  const enriched = enrichVoices(raw).filter((v) => !isBlocked(v.id));
  voicesCache.voices = enriched;
  voicesCache.at = Date.now();
  return enriched;
}

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    authMode: tts.authMode(),
    credentialsConfigured: tts.credentialsConfigured(),
    hiddenVoices: staticBlocklist.size + runtimeBlocked.size
  });
});

app.get('/api/voices', async (req, res) => {
  try {
    const voices = await getCatalog();
    res.json({ voices });
  } catch (err) {
    sendApiError(res, err, 'Unable to fetch voices from Google Cloud TTS');
  }
});

// --- Voice preview ------------------------------------------------------

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

// Generated previews are cached (LRU) so repeat listens are free, and
// concurrent requests for the same voice share one API call.
const previewCache = new Map();
const PREVIEW_CACHE_MAX = 300;
const previewInFlight = new Map();

app.get('/api/preview', async (req, res) => {
  const voiceName = (req.query.voiceName || '').trim();
  const languageCode = (req.query.languageCode || '').trim() || 'en-US';
  if (!voiceName || !VOICE_NAME_PATTERN.test(voiceName)) {
    return res.status(400).json({ error: 'A valid voiceName is required.' });
  }
  if (isBlocked(voiceName)) {
    return res.status(410).json({ error: 'This voice is currently unavailable.' });
  }

  const cached = previewCache.get(voiceName);
  if (cached) {
    previewCache.delete(voiceName); // refresh recency
    previewCache.set(voiceName, cached);
    return sendPreview(res, cached);
  }

  try {
    let pending = previewInFlight.get(voiceName);
    if (!pending) {
      // Previews send only the audio encoding — every voice family
      // accepts that, regardless of its other capability limits.
      pending = tts
        .synthesize({
          input: { text: previewPhrase(languageCode) },
          voice: { name: voiceName, languageCode },
          audioConfig: { audioEncoding: 'MP3' }
        })
        .finally(() => previewInFlight.delete(voiceName));
      previewInFlight.set(voiceName, pending);
    }
    const audioBuffer = await pending;

    previewCache.set(voiceName, audioBuffer);
    if (previewCache.size > PREVIEW_CACHE_MAX) {
      previewCache.delete(previewCache.keys().next().value);
    }
    sendPreview(res, audioBuffer);
  } catch (err) {
    // The preview request is fully server-controlled, so a 400/404 means
    // the voice itself is bad — hide it from the catalog.
    if (tts.credentialsConfigured() && (err.status === 400 || err.status === 404)) {
      markVoiceFailed(voiceName, err.message);
    }
    sendApiError(res, err, 'Voice preview failed');
  }
});

function sendPreview(res, audioBuffer) {
  res.set({
    'Content-Type': tts.MOCK ? 'audio/wav' : 'audio/mpeg',
    'Content-Length': audioBuffer.length,
    'Cache-Control': 'private, max-age=86400'
  });
  res.send(audioBuffer);
}

// --- Synthesis ----------------------------------------------------------

app.post('/api/synthesize', async (req, res) => {
  const {
    text = '',
    ssml = false,
    voiceName = '',
    languageCode = 'en-US',
    audioFormat = 'MP3',
    speakingRate = 1.0,
    pitch = 0.0,
    volumeGainDb = 0.0,
    instructions = ''
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
  if (voiceName && !VOICE_NAME_PATTERN.test(voiceName)) {
    return res.status(400).json({ error: 'Invalid voice name.' });
  }

  const caps = voiceName ? capabilitiesFor(voiceName) : { rate: true, pitch: true, ssml: true };
  if (ssml && !caps.ssml) {
    return res.status(400).json({
      error: 'This voice does not support SSML input. Turn off SSML or choose a Premium or Standard voice.'
    });
  }

  const format = AUDIO_FORMATS[audioFormat] || AUDIO_FORMATS.MP3;
  const inputPayload = ssml ? { ssml: input } : { text: input };

  // Free-text delivery instructions are only understood by prompt-capable
  // voices; for everything else the client applies them via rate/pitch.
  const styleInstructions = String(instructions || '').trim().slice(0, MAX_INSTRUCTION_CHARS);
  const applyPrompt = Boolean(styleInstructions) && voiceName && promptCapable(voiceName);
  if (applyPrompt) inputPayload.prompt = styleInstructions;

  // Only send the parameters this voice family accepts — unsupported
  // parameters make Google reject the entire request.
  const audioConfig = {
    audioEncoding: format.encoding,
    volumeGainDb: clamp(Number(volumeGainDb) || 0.0, -96.0, 16.0)
  };
  if (caps.rate) {
    audioConfig.speakingRate = clamp(Number(speakingRate) || 1.0, 0.25, caps.rateMax || 4.0);
  }
  if (caps.pitch) audioConfig.pitch = clamp(Number(pitch) || 0.0, -20.0, 20.0);

  const request = {
    input: inputPayload,
    voice: voiceName
      ? { name: voiceName, languageCode: languageCode || voiceName.split('-').slice(0, 2).join('-') }
      : { languageCode: languageCode || 'en-US' },
    audioConfig
  };

  try {
    let audioBuffer;
    try {
      audioBuffer = await tts.synthesize(request, { beta: applyPrompt });
    } catch (err) {
      // Safety net: if Google still rejects a delivery parameter for this
      // voice, strip rate/pitch and retry once rather than failing the user.
      const parameterRejected =
        err.status === 400 &&
        /does not support|not supported|invalid.*(rate|pitch)/i.test(err.message || '') &&
        ('speakingRate' in audioConfig || 'pitch' in audioConfig);
      if (!parameterRejected) throw err;
      delete request.audioConfig.speakingRate;
      delete request.audioConfig.pitch;
      console.warn(`Retrying "${voiceName}" without rate/pitch: ${err.message}`);
      audioBuffer = await tts.synthesize(request, { beta: applyPrompt });
    }
    res.set({
      'Content-Type': tts.MOCK ? 'audio/wav' : format.mime,
      'Content-Length': audioBuffer.length,
      'Content-Disposition': `inline; filename="speech.${format.ext}"`,
      'Cache-Control': 'no-store',
      'X-Instructions-Applied': applyPrompt ? '1' : '0'
    });
    res.send(audioBuffer);
  } catch (err) {
    sendApiError(res, err, 'Speech synthesis failed');
  }
});

// --- Helpers ------------------------------------------------------------

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function sendApiError(res, err, fallbackMessage) {
  console.error(`${fallbackMessage}:`, err.message);
  const isTimeout = err.name === 'TimeoutError' || err.code === 'ABORT_ERR';
  const status = isTimeout
    ? 504
    : err.status && err.status >= 400 && err.status < 600
      ? err.status
      : 502;
  let hint;
  if (!tts.credentialsConfigured()) {
    hint =
      'No Google Cloud credentials detected. Set GOOGLE_TTS_API_KEY or GOOGLE_APPLICATION_CREDENTIALS — see README.md for setup steps.';
  } else if (isTimeout) {
    hint = 'The Google TTS API did not respond in time. Please try again.';
  }
  res.status(status).json({ error: err.message || fallbackMessage, hint });
}

app.listen(PORT, () => {
  console.log(`Blvck TTS running at http://localhost:${PORT}`);
  console.log(`Auth mode: ${tts.authMode()}`);
  if (!tts.credentialsConfigured()) {
    console.warn(
      'Warning: no Google Cloud credentials configured. Requests will fail until you set them up (see README.md), or start with MOCK_TTS=1 for UI development.'
    );
  }
});
