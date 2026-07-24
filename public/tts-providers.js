// Multi-provider text-to-speech catalog for Blvck-TTS.
//
// Puter's puter.ai.txt2speech() supports several TTS backends — Amazon Polly,
// OpenAI, ElevenLabs, Google Gemini, and xAI (Grok) — each with its own voices
// and its own options shape. This module defines every provider, its voice
// list (with the metadata the voice browser needs), and a buildOptions()
// function that produces the exact params Puter expects for that provider.
//
// window.TTS_PROVIDERS      — { id: providerDef }
// window.TTS_PROVIDER_ORDER — display order for the settings dropdown
// window.getTtsVoices(id)   — enriched voice array for a provider
// window.buildTtsOptions(id, voice, ctx) — options for puter.ai.txt2speech
(() => {
  'use strict';

  const TIER_BADGE = { elite: '⭐ Elite', premium: 'Premium', standard: 'Standard' };
  const TIER_LABEL = { elite: 'Elite', premium: 'Premium', standard: 'Standard' };

  // Turn a compact tuple into the full voice object the UI expects.
  // [id, name, gender, tier, accent, descriptor, styles?]
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

  // --- Amazon Polly (Puter default engine; no `provider` needed) ----------
  // engine: standard | neural | generative. We default to neural.
  const POLLY = mk('Polly', [
    ['Joanna', 'Joanna', 'FEMALE', 'premium', 'American', 'Warm US female, natural narrator', ['narration', 'conversational']],
    ['Ruth', 'Ruth', 'FEMALE', 'elite', 'American', 'US female, generative-quality', ['narration', 'documentary']],
    ['Danielle', 'Danielle', 'FEMALE', 'elite', 'American', 'US female, expressive generative', ['storytelling']],
    ['Kendra', 'Kendra', 'FEMALE', 'premium', 'American', 'Clear US female', ['narration']],
    ['Kimberly', 'Kimberly', 'FEMALE', 'premium', 'American', 'Bright US female', ['conversational']],
    ['Salli', 'Salli', 'FEMALE', 'standard', 'American', 'Everyday US female', ['conversational']],
    ['Ivy', 'Ivy', 'FEMALE', 'standard', 'American', 'US child voice', ['character']],
    ['Amy', 'Amy', 'FEMALE', 'premium', 'British', 'British female narrator', ['narration', 'documentary']],
    ['Emma', 'Emma', 'FEMALE', 'premium', 'British', 'Friendly British female', ['conversational']],
    ['Olivia', 'Olivia', 'FEMALE', 'elite', 'Australian', 'Australian female, generative', ['narration']],
    ['Matthew', 'Matthew', 'MALE', 'premium', 'American', 'Deep US male narrator', ['narration', 'documentary']],
    ['Stephen', 'Stephen', 'MALE', 'elite', 'American', 'US male, generative-quality', ['documentary', 'cinematic']],
    ['Gregory', 'Gregory', 'MALE', 'elite', 'American', 'US male, generative', ['narration']],
    ['Joey', 'Joey', 'MALE', 'premium', 'American', 'Casual US male', ['conversational']],
    ['Justin', 'Justin', 'MALE', 'standard', 'American', 'Younger US male', ['conversational']],
    ['Kevin', 'Kevin', 'MALE', 'standard', 'American', 'US male', ['conversational']],
    ['Brian', 'Brian', 'MALE', 'premium', 'British', 'British male narrator', ['narration', 'documentary']],
    ['Arthur', 'Arthur', 'MALE', 'elite', 'British', 'British male, generative', ['documentary', 'audiobook']],
    ['Russell', 'Russell', 'MALE', 'standard', 'Australian', 'Australian male', ['narration']]
  ]);

  // --- OpenAI TTS ---------------------------------------------------------
  const OPENAI = mk('OpenAI', [
    ['alloy', 'Alloy', 'NEUTRAL', 'premium', 'American', 'Balanced, neutral voice', ['narration', 'conversational']],
    ['ash', 'Ash', 'MALE', 'premium', 'American', 'Warm, grounded male', ['narration']],
    ['ballad', 'Ballad', 'MALE', 'premium', 'British', 'Expressive storytelling voice', ['storytelling', 'dramatic']],
    ['coral', 'Coral', 'FEMALE', 'premium', 'American', 'Bright, engaging female', ['conversational']],
    ['echo', 'Echo', 'MALE', 'premium', 'American', 'Calm, even male', ['narration', 'documentary']],
    ['fable', 'Fable', 'NEUTRAL', 'premium', 'British', 'Characterful narrator', ['storytelling', 'audiobook']],
    ['onyx', 'Onyx', 'MALE', 'elite', 'American', 'Deep, cinematic male', ['documentary', 'cinematic']],
    ['nova', 'Nova', 'FEMALE', 'elite', 'American', 'Friendly, upbeat female', ['conversational', 'narration']],
    ['sage', 'Sage', 'FEMALE', 'premium', 'American', 'Calm, measured female', ['educational']],
    ['shimmer', 'Shimmer', 'FEMALE', 'premium', 'American', 'Soft, gentle female', ['asmr', 'storytelling']],
    ['verse', 'Verse', 'MALE', 'premium', 'American', 'Versatile expressive male', ['storytelling']]
  ]);

  // --- Google Gemini TTS --------------------------------------------------
  // Supports natural-language `instructions` for delivery control.
  const GEMINI = mk('Gemini', [
    ['Puck', 'Puck', 'MALE', 'elite', 'American', 'Upbeat, characterful', ['storytelling', 'conversational']],
    ['Charon', 'Charon', 'MALE', 'elite', 'American', 'Deep, informative', ['documentary', 'narration']],
    ['Kore', 'Kore', 'FEMALE', 'elite', 'American', 'Firm, confident female', ['narration', 'documentary']],
    ['Fenrir', 'Fenrir', 'MALE', 'elite', 'American', 'Excitable, energetic', ['storytelling']],
    ['Aoede', 'Aoede', 'FEMALE', 'elite', 'American', 'Breezy, light female', ['conversational']],
    ['Leda', 'Leda', 'FEMALE', 'premium', 'American', 'Youthful female', ['conversational']],
    ['Orus', 'Orus', 'MALE', 'premium', 'American', 'Firm male', ['narration']],
    ['Zephyr', 'Zephyr', 'FEMALE', 'premium', 'American', 'Bright female', ['conversational']],
    ['Charon2', 'Autonoe', 'FEMALE', 'premium', 'American', 'Warm female', ['storytelling']],
    ['Enceladus', 'Enceladus', 'MALE', 'premium', 'American', 'Breathy male', ['asmr']],
    ['Iapetus', 'Iapetus', 'MALE', 'premium', 'American', 'Clear male', ['educational']],
    ['Umbriel', 'Umbriel', 'MALE', 'premium', 'American', 'Easy-going male', ['conversational']],
    ['Algieba', 'Algieba', 'MALE', 'premium', 'American', 'Smooth male', ['narration']],
    ['Despina', 'Despina', 'FEMALE', 'premium', 'American', 'Smooth female', ['narration']],
    ['Erinome', 'Erinome', 'FEMALE', 'premium', 'American', 'Clear female', ['educational']],
    ['Sulafat', 'Sulafat', 'FEMALE', 'premium', 'American', 'Warm female', ['storytelling', 'audiobook']]
  ]);

  // --- xAI (Grok) TTS -----------------------------------------------------
  // Supports inline speech tags like [pause], [laugh], <whisper>…</whisper>.
  const XAI = mk('xAI', [
    ['eve', 'Eve', 'FEMALE', 'premium', 'American', 'Energetic female', ['conversational', 'storytelling']],
    ['ara', 'Ara', 'FEMALE', 'premium', 'American', 'Warm female', ['narration', 'audiobook']],
    ['rex', 'Rex', 'MALE', 'premium', 'American', 'Confident male', ['documentary', 'narration']],
    ['sal', 'Sal', 'MALE', 'premium', 'American', 'Smooth male', ['narration', 'conversational']],
    ['leo', 'Leo', 'MALE', 'elite', 'American', 'Authoritative male', ['documentary', 'cinematic']]
  ]);

  const TTS_PROVIDERS = {
    elevenlabs: {
      id: 'elevenlabs',
      label: 'ElevenLabs',
      note: 'Rich voice cloning quality with stability / similarity / style controls.',
      caps: { voiceSettings: true, instructions: false, engine: false },
      defaultModel: 'eleven_multilingual_v2',
      modelLabel: 'Voice model',
      modelHint: 'e.g. eleven_multilingual_v2, eleven_flash_v2_5, eleven_turbo_v2_5, eleven_v3',
      voices: () => (window.ELEVEN_VOICES || []),
      buildOptions: (voice, ctx) => ({
        provider: 'elevenlabs',
        voice,
        model: ctx.model || 'eleven_multilingual_v2',
        voice_settings: ctx.voiceSettings
      })
    },
    polly: {
      id: 'polly',
      label: 'Amazon Polly',
      note: 'Puter\'s default engine. Standard / Neural / Generative quality.',
      caps: { voiceSettings: false, instructions: false, engine: true },
      defaultModel: 'neural',
      modelLabel: 'Engine',
      modelHint: 'standard, neural, or generative',
      voices: () => POLLY,
      buildOptions: (voice, ctx) => ({
        voice,
        engine: ctx.model || 'neural',
        language: ctx.language || 'en-US'
      })
    },
    openai: {
      id: 'openai',
      label: 'OpenAI',
      note: 'Natural OpenAI voices (alloy, onyx, nova, …).',
      caps: { voiceSettings: false, instructions: true, engine: false },
      defaultModel: '',
      modelLabel: 'Model (optional)',
      modelHint: 'leave blank for the default, or e.g. gpt-4o-mini-tts',
      voices: () => OPENAI,
      buildOptions: (voice, ctx) => {
        const o = { provider: 'openai', voice };
        if (ctx.model) o.model = ctx.model;
        if (ctx.instructions) o.instructions = ctx.instructions;
        return o;
      }
    },
    gemini: {
      id: 'gemini',
      label: 'Google Gemini',
      note: '30 voices with natural-language delivery instructions.',
      caps: { voiceSettings: false, instructions: true, engine: false },
      defaultModel: 'gemini-2.5-flash-preview-tts',
      modelLabel: 'Model',
      modelHint: 'gemini-2.5-flash-preview-tts, gemini-2.5-pro-preview-tts, gemini-3.1-flash-tts-preview',
      voices: () => GEMINI,
      buildOptions: (voice, ctx) => {
        const o = { provider: 'gemini', model: ctx.model || 'gemini-2.5-flash-preview-tts', voice };
        if (ctx.instructions) o.instructions = ctx.instructions;
        return o;
      }
    },
    xai: {
      id: 'xai',
      label: 'xAI (Grok)',
      note: 'Expressive voices with inline tags: [pause], [laugh], <whisper>…</whisper>.',
      caps: { voiceSettings: false, instructions: false, engine: false },
      defaultModel: '',
      modelLabel: 'Output format',
      modelHint: 'mp3 (default)',
      voices: () => XAI,
      buildOptions: (voice, ctx) => ({
        provider: 'xai',
        voice,
        output_format: ctx.model || 'mp3'
      })
    }
  };

  const TTS_PROVIDER_ORDER = ['elevenlabs', 'polly', 'openai', 'gemini', 'xai'];

  window.TTS_PROVIDERS = TTS_PROVIDERS;
  window.TTS_PROVIDER_ORDER = TTS_PROVIDER_ORDER;
  window.getTtsProvider = (id) => TTS_PROVIDERS[id] || TTS_PROVIDERS.elevenlabs;
  window.getTtsVoices = (id) => {
    const def = TTS_PROVIDERS[id] || TTS_PROVIDERS.elevenlabs;
    return (def.voices() || []).slice();
  };
  window.buildTtsOptions = (id, voice, ctx) => {
    const def = TTS_PROVIDERS[id] || TTS_PROVIDERS.elevenlabs;
    return def.buildOptions(voice, ctx || {});
  };
})();
