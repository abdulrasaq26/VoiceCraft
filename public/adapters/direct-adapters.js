// Direct Provider Fallback Adapters for Blvck-TTS v4.0
// Serves as fallback if OmniRoute lacks specific endpoints (e.g. ElevenLabs Direct, WebSpeech)
(() => {
  'use strict';

  const ELEVEN_KEY = 'blvck:elevenlabs_direct_key';

  function getElevenLabsKey() {
    if (window.ProviderManager && window.ProviderManager.getActiveKey) {
      const key = window.ProviderManager.getActiveKey('elevenlabs');
      if (key) return key;
    }
    try {
      const stored = localStorage.getItem('blvck:keys_elevenlabs');
      if (stored) {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed) && parsed[0]) return parsed[0];
        if (typeof parsed === 'string') return parsed;
      }
    } catch (_) {}
    return localStorage.getItem('blvck:elevenlabs_direct_key') || '';
  }

  // ElevenLabs Direct API Synthesis
  async function elevenLabsTTS({ voice_id, text, stability = 0.5, similarity_boost = 0.85 }) {
    const maxRetries = (window.ProviderManager && window.ProviderManager.getPoolState) 
      ? Math.max(1, window.ProviderManager.getPoolState('elevenlabs')?.keys.length || 1)
      : 1;

    let attempt = 0;
    while (attempt < maxRetries) {
      const apiKey = getElevenLabsKey();
      if (!apiKey) {
        throw new Error('ElevenLabs Direct API key not configured.');
      }

      const masked = apiKey.length > 8 ? `${apiKey.slice(0, 4)}...${apiKey.slice(-4)}` : apiKey;
      console.log(`[ElevenLabs] Attempt ${attempt + 1}/${maxRetries} using key: ${masked}`);

      const vid = voice_id || '21m00Tcm4TlvDq8ikWAM'; // default Rachel
      const url = `https://api.elevenlabs.io/v1/text-to-speech/${vid}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Accept': 'audio/mpeg',
          'xi-api-key': apiKey,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          text,
          model_id: 'eleven_multilingual_v2',
          voice_settings: {
            stability,
            similarity_boost
          }
        })
      });

      if (!res.ok) {
        const errText = await res.text();
        
        // Handle Quota/Payment/RateLimit Errors by falling back
        if ([401, 402, 429].includes(res.status)) {
          if (window.ProviderManager && window.ProviderManager.handleKeyError) {
            window.ProviderManager.handleKeyError('elevenlabs', `Status ${res.status}: ${errText}`, apiKey);
            attempt++;
            if (attempt < maxRetries) {
              console.log(`[ElevenLabs] Retrying with next key (attempt ${attempt + 1})...`);
              continue;
            }
          }
        }
        throw new Error(`ElevenLabs Direct Error (${res.status}): ${errText}`);
      }

      const blob = await res.blob();
      return URL.createObjectURL(blob);
    }
    
    throw new Error('ElevenLabs Direct Error: All available API keys have been exhausted or rate-limited.');
  }

  // Web Speech API Native Browser Speech Synthesis
  function webSpeechTTS({ text, lang = 'en-US' }) {
    return new Promise((resolve, reject) => {
      if (!('speechSynthesis' in window)) {
        return reject(new Error('Web Speech API not supported in this browser.'));
      }
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = lang;
      utterance.onend = () => resolve(true);
      utterance.onerror = (e) => reject(new Error(`WebSpeech error: ${e.error}`));
      window.speechSynthesis.speak(utterance);
    });
  }

  window.DirectAdapters = {
    getElevenLabsKey,
    elevenLabsTTS,
    webSpeechTTS
  };
})();
