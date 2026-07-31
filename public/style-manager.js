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

  function getActivePreset() {
    const key = localStorage.getItem(ACTIVE_PRESET_KEY) || 'Historical Documentary Animation';
    return { name: key, ...PRESETS[key] || PRESETS['Historical Documentary Animation'] };
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
