// Visual Style Manager & Channel Presets for Blvck-TTS v4.0
// Maps outcome styles (Photoreal, Anime, Pixar, Historical Illustration) to optimal image & video models
(() => {
  'use strict';

  const PRESETS = {
    'Historical Documentary Animation': {
      imageModel: 'flux-1-dev',
      videoModel: 'runway-gen3',
      palette: 'Muted Earth Tones & Sepia',
      camera: 'Slow Cinematic Panning',
      narrationVoice: 'Historical Storyteller',
      aspectRatio: '16:9'
    },
    'Cinematic Realism': {
      imageModel: 'dall-e-3',
      videoModel: 'veo-2',
      palette: 'Rich Cinematic Contrast',
      camera: 'Dramatic Motion',
      narrationVoice: 'Documentary Narrator',
      aspectRatio: '16:9'
    },
    '2D Historical Illustration': {
      imageModel: 'recraft-v3',
      videoModel: 'kling-v1.5',
      palette: 'Vintage Parchment',
      camera: 'Subtle Parallax',
      narrationVoice: 'Calm Educator',
      aspectRatio: '16:9'
    },
    'Pixar 3D Storybook': {
      imageModel: 'ideogram-v3',
      videoModel: 'pixverse-v2',
      palette: 'Vibrant Warm Colors',
      camera: 'Dynamic Dolly',
      narrationVoice: 'Conversational',
      aspectRatio: '16:9'
    }
  };

  const ACTIVE_PRESET_KEY = 'blvck:active_channel_preset';

  // Defaulting to "Historical Documentary Animation" meant any project that had
  // not explicitly chosen a preset inherited its sepia, muted-earth palette —
  // which is why unrelated topics came out looking like archive footage. The
  // fallback is now a neutral modern look; historical remains a deliberate
  // choice rather than what you get by saying nothing.
  const DEFAULT_PRESET = 'Cinematic Realism';

  function getActivePreset() {
    const stored = localStorage.getItem(ACTIVE_PRESET_KEY);
    const key = (stored && PRESETS[stored]) ? stored : DEFAULT_PRESET;
    return { name: key, ...(PRESETS[key] || PRESETS[DEFAULT_PRESET]) };
  }

  function setActivePreset(presetName) {
    if (PRESETS[presetName]) {
      localStorage.setItem(ACTIVE_PRESET_KEY, presetName);
      if (window.AssetConsistency) {
        window.AssetConsistency.setStyle(presetName, PRESETS[presetName]);
      }
    }
  }

  window.StyleManager = {
    presets: PRESETS,
    getActivePreset,
    setActivePreset
  };
})();
