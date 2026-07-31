// OmniRoute Gateway API Adapter for Blvck-TTS v4.0
// Supports OpenAI-compatible /v1/chat/completions, /v1/models, /v1/audio/speech,
// /v1/images/generations, and /v1/videos/generations.
(() => {
  'use strict';

  const ENDPOINT_KEY = 'blvck:omniroute_endpoint';
  const API_KEY = 'blvck:omniroute_key';

  const DEFAULT_ENDPOINT = 'http://localhost:20128';

  function getEndpoint() {
    let ep = localStorage.getItem(ENDPOINT_KEY) || DEFAULT_ENDPOINT;
    return ep.replace(/\/+$/, '');
  }

  function getApiKey() {
    return localStorage.getItem(API_KEY) || '';
  }

  function getHeaders(customHeaders = {}) {
    const headers = {
      'Content-Type': 'application/json',
      ...customHeaders
    };
    const key = getApiKey();
    if (key) {
      headers['Authorization'] = `Bearer ${key}`;
    }
    return headers;
  }

  // Probe OmniRoute capabilities on app boot
  async function probeCapabilities() {
    const ep = getEndpoint();
    const results = {
      endpoint: ep,
      online: false,
      models: false,
      chat: false,
      speech: false,
      images: false,
      videos: false,
      availableModels: []
    };

    try {
      const res = await fetch(`${ep}/v1/models`, {
        method: 'GET',
        headers: getHeaders()
      });
      if (res.ok) {
        results.online = true;
        results.models = true;
        const data = await res.json();
        results.availableModels = (data.data || data || []).map(m => typeof m === 'string' ? m : m.id);
      }
    } catch (e) {
      console.warn('[OmniRoute Probe] /v1/models unreachable:', e);
    }

    if (results.online) {
      // Test chat endpoint
      try {
        const chatRes = await fetch(`${ep}/v1/chat/completions`, {
          method: 'POST',
          headers: getHeaders(),
          body: JSON.stringify({
            model: results.availableModels[0] || 'gpt-4o-mini',
            messages: [{ role: 'user', content: 'ping' }],
            max_tokens: 5
          })
        });
        results.chat = chatRes.ok || chatRes.status === 400 || chatRes.status === 422;
      } catch {
        results.chat = false;
      }

      // Check audio/speech
      try {
        const speechRes = await fetch(`${ep}/v1/audio/speech`, {
          method: 'OPTIONS'
        });
        results.speech = speechRes.ok || speechRes.status === 405 || speechRes.status === 204;
      } catch {
        results.speech = false;
      }

      // Check images/generations
      try {
        const imgRes = await fetch(`${ep}/v1/images/generations`, {
          method: 'OPTIONS'
        });
        results.images = imgRes.ok || imgRes.status === 405 || imgRes.status === 204;
      } catch {
        results.images = false;
      }
    }

    return results;
  }

  // Fetch list of models from OmniRoute
  async function listModels() {
    const ep = getEndpoint();
    const res = await fetch(`${ep}/v1/models`, {
      method: 'GET',
      headers: getHeaders()
    });
    if (!res.ok) {
      throw new Error(`OmniRoute listModels failed: ${res.status} ${res.statusText}`);
    }
    const data = await res.json();
    const list = data.data || data || [];
    return list.map(m => (typeof m === 'string' ? { id: m, name: m } : { id: m.id || m.name, name: m.name || m.id }));
  }

  // Chat completions (Supports streaming SSE & JSON)
  async function chatCompletion({ model, messages, temperature = 0.7, max_tokens, onChunk }) {
    const ep = getEndpoint();
    const body = {
      model: model || 'gpt-4o-mini',
      messages,
      temperature,
      stream: typeof onChunk === 'function'
    };
    if (max_tokens) body.max_tokens = max_tokens;

    const res = await fetch(`${ep}/v1/chat/completions`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify(body)
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OmniRoute Chat Error (${res.status}): ${errText}`);
    }

    if (typeof onChunk === 'function' && res.body) {
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop(); // keep last incomplete line

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              const delta = json.choices?.[0]?.delta?.content || '';
              if (delta) {
                fullText += delta;
                onChunk(delta, fullText);
              }
            } catch (e) {
              // Ignore malformed chunk
            }
          }
        }
      }
      return fullText;
    } else {
      const json = await res.json();
      return json.choices?.[0]?.message?.content || '';
    }
  }

  // Audio Speech (TTS)
  async function textToSpeech({ model, input, voice = 'alloy', speed = 1.0, format = 'mp3' }) {
    const ep = getEndpoint();
    const res = await fetch(`${ep}/v1/audio/speech`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        model: model || 'openai/tts-1',
        input,
        voice,
        speed,
        response_format: format
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OmniRoute TTS Error (${res.status}): ${errText}`);
    }

    const blob = await res.blob();
    return URL.createObjectURL(blob);
  }

  // Image Generation
  async function generateImage({ model, prompt, n = 1, size = '1024x1024', aspect_ratio = '16:9' }) {
    const ep = getEndpoint();
    const res = await fetch(`${ep}/v1/images/generations`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        model: model || 'flux-1-dev',
        prompt,
        n,
        size,
        aspect_ratio,
        response_format: 'b64_json'
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OmniRoute Image Error (${res.status}): ${errText}`);
    }

    const json = await res.json();
    const items = json.data || [];
    return items.map(item => {
      if (item.b64_json) return `data:image/png;base64,${item.b64_json}`;
      if (item.url) return item.url;
      return item;
    });
  }

  // Video Generation
  async function generateVideo({ model, prompt, image_url, duration = 5 }) {
    const ep = getEndpoint();
    const res = await fetch(`${ep}/v1/videos/generations`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({
        model: model || 'runway-gen3',
        prompt,
        image_url,
        duration
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`OmniRoute Video Error (${res.status}): ${errText}`);
    }

    const json = await res.json();
    return json.video_url || json.url || json.data?.[0]?.url;
  }

  window.OmniRouteAdapter = {
    getEndpoint,
    getApiKey,
    probeCapabilities,
    listModels,
    chatCompletion,
    textToSpeech,
    generateImage,
    generateVideo
  };
})();
