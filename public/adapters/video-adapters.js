// Video Provider Adapters for Blvck-TTS v5.0
// Supports Runway Gen-3, Luma Dream Machine, Kling AI, and Higgsfield
(() => {
  'use strict';

  // Runway Gen-3 Adapter
  async function runwayGenerateVideo({ prompt, image_url, duration = 5 }) {
    const key = window.ProviderManager.getActiveKey('runway');
    if (!key) throw new Error('Runway key not configured.');

    const res = await fetch('https://api.runwayml.com/v1/tasks', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json',
        'X-Runway-Version': '2024-11-06'
      },
      body: JSON.stringify({
        taskType: 'gen3a_turbo',
        promptText: prompt,
        promptImage: image_url,
        duration
      })
    });

    if (!res.ok) {
      const err = await res.text();
      window.ProviderManager.handleKeyError('runway', `HTTP ${res.status}: ${err}`);
      throw new Error(`Runway Error (${res.status}): ${err}`);
    }

    const json = await res.json();
    return json.output?.[0] || json.id;
  }

  // Luma Dream Machine Adapter
  async function lumaGenerateVideo({ prompt, image_url }) {
    const key = window.ProviderManager.getActiveKey('luma');
    if (!key) throw new Error('Luma key not configured.');

    const res = await fetch('https://api.lumalabs.ai/v1/generations', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        prompt,
        keyframes: image_url ? { frame0: { type: 'image', url: image_url } } : undefined
      })
    });

    if (!res.ok) {
      const err = await res.text();
      window.ProviderManager.handleKeyError('luma', `HTTP ${res.status}: ${err}`);
      throw new Error(`Luma Error (${res.status}): ${err}`);
    }

    const json = await res.json();
    return json.assets?.video || json.id;
  }

  window.VideoAdapters = {
    runwayGenerateVideo,
    lumaGenerateVideo
  };
})();
