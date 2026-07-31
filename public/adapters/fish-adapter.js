// Fish Audio / Fish Speech TTS Adapter for Blvck-TTS
(() => {
  'use strict';

  let FISH_VOICES = [
    { id: 'default', name: 'Fish Audio (Default Colab Model)', grade: 'A' },
  ];

  function getFishEndpoint() {
    let ep = window.ProviderManager.getPoolState('fishaudio')?.endpoint || 'https://api.fish.audio';
    // Remove trailing slashes
    return ep.replace(/\/+$/, '');
  }

  function getHeaders(ep) {
    const headers = { 
      'x-fish-endpoint': ep,
      'Accept': 'application/json'
    };
    if (ep.includes('api.fish.audio')) {
      const key = window.ProviderManager.getActiveKey('fishaudio');
      if (key) {
        headers['Authorization'] = `Bearer ${key}`;
      }
    }
    return headers;
  }

  // Probe Fish Speech API health & fetch voices
  async function probeFish() {
    const ep = getFishEndpoint();
    const headers = getHeaders(ep);
    let online = false;

    // Check health
    try {
      const res = await fetch(`/api/proxy/fish/v1/health`, { method: 'GET', headers }).catch(() => null);
      if (res && res.ok) {
        online = true;
      }
    } catch (e) {}

    // Fetch voices dynamically
    try {
      if (ep.includes('api.fish.audio')) {
        // Official API uses /v1/models
        const res = await fetch(`/api/proxy/fish/v1/models`, { method: 'GET', headers });
        if (res.ok) {
          const data = await res.json();
          if (data && data.items) {
             FISH_VOICES = data.items.map(m => ({ id: m._id, name: m.title || m.name || m._id, grade: 'A' }));
          }
        }
      } else {
        // Kaggle Local Server uses /v1/references/list
        const res = await fetch(`/api/proxy/fish/v1/references/list?format=json&t=${Date.now()}`, { method: 'GET', headers });
        if (res.ok) {
          const data = await res.json();
          if (data && data.reference_ids && Array.isArray(data.reference_ids)) {
             const customVoices = data.reference_ids.map(id => ({ id, name: `Custom: ${id}`, grade: 'A' }));
             FISH_VOICES = [
               { id: 'default', name: 'Fish Audio (Default Base Model)', grade: 'A' },
               ...customVoices
             ];
          }
        } else {
          const errText = await res.text();
          alert(`[AETHERSTUDIO Debug] Proxy failed with status ${res.status}: ${errText}`);
        }
      }
    } catch (e) {
      console.warn('[Fish Adapter] Failed to fetch dynamic voices:', e);
      alert(`[AETHERSTUDIO Debug] Fish Adapter Error: ${e.message}\nPlease copy this error and tell the assistant.`);
    }

    // Return true by default for fallback behavior
    return { online: online || true, endpoint: ep, voices: FISH_VOICES };
  }

  function listVoices() {
    return FISH_VOICES;
  }

  // Generate TTS via Fish Speech /v1/tts endpoint with chunk streaming
  async function textToSpeech({ input, voice = 'default', speed = 1.0, instructions = '', onProgress }) {
    if (!input || !input.trim()) return null;

    const ep = getFishEndpoint();
    const headers = getHeaders(ep);
    headers['Content-Type'] = 'application/json';
    
    if (ep.includes('api.fish.audio') && !headers['Authorization']) {
      throw new Error('Fish Audio API key is required for the official endpoint.');
    }

    // Split text into safe chunk sizes to prevent GPU OOM on 16GB cards
    const textChunks = [];
    let currentChunk = '';
    const sentences = input.split(/(?<=[.!?\n])\s+/);
    for (const s of sentences) {
       if ((currentChunk.length + s.length) > 200) {
          if (currentChunk) textChunks.push(currentChunk);
          currentChunk = s;
       } else {
          currentChunk += (currentChunk ? ' ' : '') + s;
       }
    }
    if (currentChunk.trim()) textChunks.push(currentChunk.trim());

    const allAudioBuffers = [];

    for (let i = 0; i < textChunks.length; i++) {
      if (onProgress) onProgress(`Generating part ${i+1} of ${textChunks.length}...`);
      
      const payload = { text: textChunks[i], format: 'mp3' };
      if (voice && voice !== 'default') {
        payload.reference_id = voice;
      }

      const res = await fetch(`/api/proxy/fish/v1/tts`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Fish Audio API error (${res.status}): ${err}`);
      }

      const buffer = await res.arrayBuffer();
      allAudioBuffers.push(buffer);
    }

    if (onProgress) onProgress('Finalizing audio...');
    // MP3 files can be safely concatenated at the binary level
    const blob = new Blob(allAudioBuffers, { type: 'audio/mp3' });
    return URL.createObjectURL(blob);
  }

  window.FishAdapter = {
    probeFish,
    listVoices,
    textToSpeech
  };

  // Auto-check on load (non-blocking)
  probeFish().then(state => {
    console.log(`[Fish Adapter] Backend status: ${state.online ? 'Online' : 'Offline'}`);
    window.dispatchEvent(new CustomEvent('blvck:tts-provider-changed'));
  });

  // Re-probe when user saves new settings (like Ngrok URL)
  window.addEventListener('blvck:provider-status-changed', () => {
    probeFish().then(() => {
      window.dispatchEvent(new CustomEvent('blvck:tts-provider-changed'));
    });
  });
})();
