// Multi-provider text-to-speech catalog for Blvck-TTS v5.1
// Includes Kokoro Local 82M catalog, ElevenLabs, Fish Audio, OpenAI, Google Gemini, Amazon Polly, xAI
(() => {
  'use strict';

  const TIER_BADGE = { elite: '⭐ Elite', premium: 'Premium', standard: 'Standard' };
  const TIER_LABEL = { elite: 'Elite', premium: 'Premium', standard: 'Standard' };

  function mk(family, rows) {
    return rows.map(([id, name, gender, tier, accent, descriptor, styles]) => ({
      id,
      name,
      descriptor: descriptor || '',
      tier,
      tierLabel: TIER_LABEL[tier],
      badge: TIER_BADGE[tier],
      family,
      gender,
      accent: accent || '',
      age: '',
      styles: styles || [],
      language: 'en-US',
      languageCodes: ['en-US']
    }));
  }

  // --- Kokoro Local (Zero Cost Offline TTS) ------------------------------
  const KOKORO = mk('Kokoro Local', [
    ['af_heart', 'Kokoro Heart (US Female)', 'FEMALE', 'elite', 'American', 'Grade A US Female (Kokoro 82M Local)', ['narration', 'storytelling', 'documentary']],
    ['af_bella', 'Kokoro Bella (US Female)', 'FEMALE', 'elite', 'American', 'Grade A- US Female (Kokoro 82M Local)', ['narration', 'educational']],
    ['af_nicole', 'Kokoro Nicole (US Female)', 'FEMALE', 'premium', 'American', 'US female (Kokoro 82M Local)', ['conversational']],
    ['af_sky', 'Kokoro Sky (US Female)', 'FEMALE', 'premium', 'American', 'US female (Kokoro 82M Local)', ['conversational']],
    ['af_sarah', 'Kokoro Sarah (US Female)', 'FEMALE', 'premium', 'American', 'US female (Kokoro 82M Local)', ['narration']],
    ['am_adam', 'Kokoro Adam (US Male)', 'MALE', 'premium', 'American', 'US male (Kokoro 82M Local)', ['documentary', 'narration']],
    ['am_echo', 'Kokoro Echo (US Male)', 'MALE', 'premium', 'American', 'US male (Kokoro 82M Local)', ['narration']],
    ['am_eric', 'Kokoro Eric (US Male)', 'MALE', 'premium', 'American', 'US male (Kokoro 82M Local)', ['conversational']],
    ['am_michael', 'Kokoro Michael (US Male)', 'MALE', 'premium', 'American', 'US male (Kokoro 82M Local)', ['educational', 'narration']],
    ['bf_emma', 'Kokoro Emma (UK Female)', 'FEMALE', 'elite', 'British', 'British female (Kokoro 82M Local)', ['narration', 'storytelling']],
    ['bf_isabella', 'Kokoro Isabella (UK Female)', 'FEMALE', 'elite', 'British', 'British female (Kokoro 82M Local)', ['narration']],
    ['bm_george', 'Kokoro George (UK Male)', 'MALE', 'premium', 'British', 'British male (Kokoro 82M Local)', ['documentary']],
    ['bm_fable', 'Kokoro Fable (UK Male)', 'MALE', 'premium', 'British', 'British male (Kokoro 82M Local)', ['storytelling', 'dramatic']]
  ]);

  // --- Fish Audio (Colab/API) ---------------------------------------------
  const FISHAUDIO = mk('Fish Audio', [
    ['default', 'Fish Audio (Default)', 'NEUTRAL', 'elite', 'Neutral', 'Default base model', ['narration', 'conversational']],
  ]);

  // --- OpenAI TTS ---------------------------------------------------------
  const OPENAI = mk('OpenAI', [
    ['alloy', 'Alloy', 'NEUTRAL', 'premium', 'American', 'Balanced, neutral voice', ['narration', 'conversational']],
    ['ash', 'Ash', 'MALE', 'premium', 'American', 'Warm, grounded male', ['narration']],
    ['coral', 'Coral', 'FEMALE', 'premium', 'American', 'Bright, engaging female', ['conversational']],
    ['echo', 'Echo', 'MALE', 'premium', 'American', 'Calm, even male', ['narration', 'documentary']],
    ['onyx', 'Onyx', 'MALE', 'elite', 'American', 'Deep, cinematic male', ['documentary', 'cinematic']],
    ['nova', 'Nova', 'FEMALE', 'elite', 'American', 'Friendly, upbeat female', ['conversational', 'narration']]
  ]);

  const TTS_PROVIDERS = {
    kokoro: {
      id: 'kokoro',
      label: 'Kokoro Local (Zero Cost)',
      note: 'Offline zero-cost local TTS server running at http://localhost:8880.',
      // speed: engine honours a playback-rate parameter.
      // genParams: engine exposes sampling controls (temperature/top_p/seed…).
      caps: { voiceSettings: false, instructions: false, engine: false, speed: true, genParams: false },
      defaultModel: 'kokoro',
      modelLabel: 'Model',
      modelHint: 'kokoro',
      voices: () => KOKORO,
      buildOptions: (voice, ctx) => ({
        provider: 'kokoro',
        voice,
        speed: ctx.speed || 1.0
      })
    },
    fishaudio: {
      id: 'fishaudio',
      label: 'Fish Speech (Colab/API)',
      note: 'High-quality TTS engine running via Colab ngrok endpoint or official API.',
      // No speed parameter exists in ServeTTSRequest, so the speed slider is
      // hidden rather than left visible doing nothing. Sampling controls are
      // real: temperature, top_p, repetition_penalty, seed.
      // cloning: engine exposes reference add/delete endpoints.
      caps: { voiceSettings: false, instructions: false, engine: false, speed: false, genParams: true, cloning: true },
      defaultModel: 'fishaudio',
      modelLabel: 'Model',
      modelHint: 'fishaudio',
      voices: () => {
        if (window.FishAdapter && window.FishAdapter.listVoices) {
           const adapterVoices = window.FishAdapter.listVoices();
           if (adapterVoices && adapterVoices.length > 0) {
              const VS = window.BlvckVoiceStyles;
              return adapterVoices.map(v => {
                 // `Speaker__style` references are emotional variants of one
                 // speaker, so surface the speaker as the family and the style
                 // as a real style rather than labelling everything 'narration'.
                 const p = VS ? VS.parseId(v.id) : { speaker: v.id, style: null };
                 const isDefault = v.name === 'Fish Audio (Default Base Model)';
                 // Fish tells us nothing but the id, so gender/style are read
                 // from the name where it actually encodes them. Without this
                 // every voice was NEUTRAL/narration and the picker's gender
                 // and style filters could never match anything.
                 const t = VS ? VS.inferTraits(v.id) : { gender: 'NEUTRAL', styles: ['narration'] };
                 return {
                   id: v.id,
                   name: p.style && VS ? `${VS.titleCase(p.speaker)} — ${VS.titleCase(p.style)}` : v.name,
                   descriptor: isDefault ? 'Default base model'
                     : p.style && VS ? `${VS.titleCase(p.style)} delivery` : 'Custom Cloned Voice',
                   tier: v.grade === 'A' ? 'elite' : 'premium',
                   tierLabel: v.grade === 'A' ? 'Elite' : 'Premium',
                   badge: v.grade === 'A' ? '⭐ Elite' : 'Premium',
                   family: isDefault ? 'Fish Audio' : (VS ? VS.titleCase(p.speaker) : 'Fish Audio'),
                   speaker: p.speaker,
                   style: p.style,
                   gender: t.gender,
                   accent: 'Neutral',
                   age: '',
                   styles: t.styles,
                   language: 'en-US',
                   languageCodes: ['en-US']
                 };
              });
           }
        }
        return FISHAUDIO;
      },
      buildOptions: (voice, ctx) => ({
        provider: 'fishaudio',
        voice,
        speed: ctx.speed || 1.0
      })
    },
    elevenlabs: {
      id: 'elevenlabs',
      label: 'ElevenLabs',
      note: 'Rich voice cloning quality with stability / similarity / style controls.',
      caps: { voiceSettings: true, instructions: false, engine: false },
      defaultModel: 'eleven_multilingual_v2',
      modelLabel: 'Voice model',
      modelHint: 'e.g. eleven_multilingual_v2',
      voices: () => (window.ELEVEN_VOICES && window.ELEVEN_VOICES.length ? window.ELEVEN_VOICES : KOKORO),
      buildOptions: (voice, ctx) => ({
        provider: 'elevenlabs',
        voice,
        model: ctx.model || 'eleven_multilingual_v2',
        voice_settings: ctx.voiceSettings
      })
    },
    openai: {
      id: 'openai',
      label: 'OpenAI',
      note: 'Natural OpenAI voices (alloy, onyx, nova, …).',
      caps: { voiceSettings: false, instructions: true, engine: false },
      defaultModel: 'tts-1',
      modelLabel: 'Model',
      modelHint: 'tts-1 or tts-1-hd',
      voices: () => OPENAI,
      buildOptions: (voice, ctx) => ({
        provider: 'openai',
        voice,
        model: ctx.model || 'tts-1'
      })
    }
  };

  const TTS_PROVIDER_ORDER = ['kokoro', 'fishaudio', 'elevenlabs', 'openai'];

  window.TTS_PROVIDERS = TTS_PROVIDERS;
  window.TTS_PROVIDER_ORDER = TTS_PROVIDER_ORDER;
  window.getTtsProvider = (id) => TTS_PROVIDERS[id] || TTS_PROVIDERS.kokoro;
  window.getTtsVoices = (id) => {
    const def = TTS_PROVIDERS[id] || TTS_PROVIDERS.kokoro;
    const v = def.voices() || [];
    return v.length ? v.slice() : KOKORO.slice();
  };
  window.buildTtsOptions = (id, voice, ctx) => {
    const def = TTS_PROVIDERS[id] || TTS_PROVIDERS.kokoro;
    return def.buildOptions(voice, ctx || {});
  };
})();
