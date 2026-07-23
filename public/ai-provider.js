// AI provider router. Chooses between Gemini (server-side, via /api/*) and
// Puter/Qwen (client-side, via the puter.js SDK — "user-pays", no server key).
// When Puter is selected, prompt-building and result-parsing still happen on
// the server (single source of truth); only the model call runs in the browser.
(() => {
  'use strict';

  const PROVIDER_KEY = 'blvck-tts:aiprovider';
  const MODEL_KEY = 'blvck-tts:qwenmodel';
  const DEFAULT_MODEL = 'qwen3.6-flash';
  const TTS_KEY = 'blvck-tts:ttsprovider';
  const TTS_MODEL_KEY = 'blvck-tts:elevenmodel';
  const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';

  async function postJson(url, body) {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.hint ? `${data.error} — ${data.hint}` : data.error || `Request failed (${res.status})`);
    return data;
  }

  // Normalise the various shapes puter.ai.chat can return into plain text.
  function chatText(resp) {
    if (resp == null) return '';
    if (typeof resp === 'string') return resp;
    if (resp.message) {
      const c = resp.message.content;
      if (typeof c === 'string') return c;
      if (Array.isArray(c)) return c.map((p) => p.text || '').join('');
    }
    if (typeof resp.text === 'string') return resp.text;
    if (resp.toString && resp.toString() !== '[object Object]') return resp.toString();
    return '';
  }

  // Load the Puter SDK on demand (only when the Qwen provider is actually
  // used), so Gemini users never fetch an external script.
  let puterLoading = null;
  function ensurePuter() {
    if (typeof window.puter !== 'undefined') return Promise.resolve();
    if (puterLoading) return puterLoading;
    puterLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://js.puter.com/v2/';
      s.onload = () => (typeof window.puter !== 'undefined' ? resolve() : reject(new Error('Puter SDK loaded but unavailable.')));
      s.onerror = () => reject(new Error('Could not load the Puter SDK (js.puter.com). Check your connection, or switch the AI provider back to Gemini.'));
      document.head.appendChild(s);
    });
    return puterLoading;
  }

  const BlvckAI = {
    provider() {
      return localStorage.getItem(PROVIDER_KEY) || 'gemini';
    },
    isPuter() {
      return this.provider() === 'puter';
    },
    setProvider(p) {
      localStorage.setItem(PROVIDER_KEY, p);
    },
    model() {
      return localStorage.getItem(MODEL_KEY) || DEFAULT_MODEL;
    },
    setModel(m) {
      localStorage.setItem(MODEL_KEY, m || DEFAULT_MODEL);
    },

    // --- Text-to-speech provider (Google server-side | ElevenLabs via Puter) ---
    ttsProvider() {
      return localStorage.getItem(TTS_KEY) || 'google';
    },
    isElevenLabs() {
      return this.ttsProvider() === 'elevenlabs';
    },
    setTtsProvider(p) {
      localStorage.setItem(TTS_KEY, p);
    },
    ttsModel() {
      return localStorage.getItem(TTS_MODEL_KEY) || DEFAULT_TTS_MODEL;
    },
    setTtsModel(m) {
      localStorage.setItem(TTS_MODEL_KEY, m || DEFAULT_TTS_MODEL);
    },

    // Synthesize speech with ElevenLabs via Puter; returns an audio Blob.
    async speak(text, voice) {
      await ensurePuter();
      const audio = await window.puter.ai.txt2speech(text, {
        provider: 'elevenlabs',
        voice,
        model: this.ttsModel()
      });
      const src = audio && (audio.src || (typeof audio === 'string' ? audio : null));
      if (!src) throw new Error('ElevenLabs (Puter) returned no audio.');
      const r = await fetch(src);
      return r.blob();
    },

    // Run a JSON-producing generation. For Gemini, the server does it all.
    // For Puter: fetch the prompt from the server, run Qwen in the browser,
    // then post the raw output back for the server to parse + normalise.
    async generateJSON(endpoint, payload) {
      if (!this.isPuter()) {
        return postJson(endpoint, payload);
      }
      await ensurePuter();
      const { prompt } = await postJson(endpoint, { ...payload, promptOnly: true });
      const messages = [];
      if (prompt.system) messages.push({ role: 'system', content: prompt.system });
      messages.push({ role: 'user', content: prompt.user });
      const resp = await window.puter.ai.chat(messages, { model: this.model() });
      const rawText = chatText(resp);
      if (!rawText) throw new Error('Qwen (Puter) returned an empty response.');
      return postJson(endpoint, { ...payload, rawText });
    },

    // Generate an image, returning a Blob. Gemini → /api/image; Puter → txt2img.
    async generateImage(prompt, aspect) {
      if (this.isPuter()) {
        await ensurePuter();
        const fullPrompt = aspect ? `${prompt} (${aspect} aspect ratio)` : prompt;
        const el = await window.puter.ai.txt2img(fullPrompt);
        const src = el && (el.src || (typeof el === 'string' ? el : null));
        if (!src) throw new Error('Qwen (Puter) returned no image.');
        const r = await fetch(src);
        return r.blob();
      }
      const res = await fetch('/api/image', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, aspect })
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        const err = new Error(b.error || `Request failed (${res.status})`);
        err.status = res.status;
        err.quota = res.status === 429 || /quota|exceeded|billing/i.test(b.error || '');
        err.hint = b.hint;
        throw err;
      }
      return res.blob();
    }
  };

  window.BlvckAI = BlvckAI;

  // Wire the top-bar provider selector (elements exist — this script runs at
  // the end of <body>). Changing provider reloads so every module re-inits.
  const sel = document.getElementById('ai-provider');
  const modelInput = document.getElementById('qwen-model');
  if (sel) {
    sel.value = BlvckAI.provider();
    const syncModel = () => {
      if (modelInput) {
        modelInput.hidden = BlvckAI.provider() !== 'puter';
        modelInput.value = BlvckAI.model();
      }
    };
    syncModel();
    sel.addEventListener('change', () => {
      BlvckAI.setProvider(sel.value);
      location.reload();
    });
    if (modelInput) {
      modelInput.addEventListener('change', () => BlvckAI.setModel(modelInput.value.trim()));
    }
  }

  const ttsSel = document.getElementById('tts-provider');
  if (ttsSel) {
    ttsSel.value = BlvckAI.ttsProvider();
    ttsSel.addEventListener('change', () => {
      BlvckAI.setTtsProvider(ttsSel.value);
      location.reload();
    });
  }
})();
