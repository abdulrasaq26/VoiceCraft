// Puter-first AI router for Blvck-TTS.
//
// Every AI capability — TTS (ElevenLabs), text (Claude/GPT/Qwen/…), images,
// video — routes through Puter's client-side SDK. Prompt-building and result
// parsing still happen on the server for storyboard + SEO (single source of
// truth); the model call itself runs in the browser.
(() => {
  'use strict';

  const CHAT_MODEL_KEY = 'blvck:chatmodel';
  const TTS_MODEL_KEY = 'blvck:ttsmodel';
  const DEFAULT_CHAT_MODEL = 'claude-sonnet-4';
  const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';
  const DEFAULT_VOICE_SETTINGS = Object.freeze({
    stability: 0.5,
    similarity_boost: 0.85,
    style: 0.1,
    use_speaker_boost: true
  });

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

  // Lazy-load Puter's SDK. Only fetched on first use.
  let puterLoading = null;
  function ensurePuter() {
    if (typeof window.puter !== 'undefined') return Promise.resolve();
    if (puterLoading) return puterLoading;
    puterLoading = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = 'https://js.puter.com/v2/';
      s.onload = () => (typeof window.puter !== 'undefined' ? resolve() : reject(new Error('Puter SDK loaded but unavailable.')));
      s.onerror = () => reject(new Error('Could not load the Puter SDK (js.puter.com). Check your connection.'));
      document.head.appendChild(s);
    });
    return puterLoading;
  }

  function clampNumber(n, lo, hi, fallback) {
    const v = Number(n);
    if (!Number.isFinite(v)) return fallback;
    return Math.min(hi, Math.max(lo, v));
  }

  function normalizeVoiceSettings(vs) {
    const base = { ...DEFAULT_VOICE_SETTINGS, ...(vs || {}) };
    return {
      stability: clampNumber(base.stability, 0, 1, DEFAULT_VOICE_SETTINGS.stability),
      similarity_boost: clampNumber(base.similarity_boost, 0, 1, DEFAULT_VOICE_SETTINGS.similarity_boost),
      style: clampNumber(base.style, 0, 1, DEFAULT_VOICE_SETTINGS.style),
      use_speaker_boost: Boolean(base.use_speaker_boost)
    };
  }

  const BlvckAI = {
    DEFAULT_VOICE_SETTINGS,

    chatModel() { return localStorage.getItem(CHAT_MODEL_KEY) || DEFAULT_CHAT_MODEL; },
    setChatModel(m) { localStorage.setItem(CHAT_MODEL_KEY, m || DEFAULT_CHAT_MODEL); },
    ttsModel() { return localStorage.getItem(TTS_MODEL_KEY) || DEFAULT_TTS_MODEL; },
    setTtsModel(m) { localStorage.setItem(TTS_MODEL_KEY, m || DEFAULT_TTS_MODEL); },

    // Synthesize speech with ElevenLabs via Puter; returns an audio Blob.
    // opts: { voice_settings?, model? }
    async speak(text, voice, opts = {}) {
      await ensurePuter();
      const audio = await window.puter.ai.txt2speech(text, {
        provider: 'elevenlabs',
        voice,
        model: opts.model || this.ttsModel(),
        voice_settings: normalizeVoiceSettings(opts.voice_settings)
      });
      const src = audio && (audio.src || (typeof audio === 'string' ? audio : null));
      if (!src) throw new Error('ElevenLabs (Puter) returned no audio.');
      const r = await fetch(src);
      return r.blob();
    },

    // Run a JSON-producing generation. Fetch the prompt from the server, run
    // the chat model in the browser, post the raw output back for parsing.
    async generateJSON(endpoint, payload) {
      await ensurePuter();
      const { prompt } = await postJson(endpoint, { ...payload, promptOnly: true });
      const messages = [];
      if (prompt.system) messages.push({ role: 'system', content: prompt.system });
      messages.push({ role: 'user', content: prompt.user });
      const resp = await window.puter.ai.chat(messages, { model: this.chatModel() });
      const rawText = chatText(resp);
      if (!rawText) throw new Error('The chat model returned an empty response.');
      return postJson(endpoint, { ...payload, rawText });
    },

    // Generic chat completion returning plain text. For UI-facing use (script
    // generator, coding agent, etc.).
    async chat(messages, opts = {}) {
      await ensurePuter();
      const resp = await window.puter.ai.chat(messages, {
        model: opts.model || this.chatModel(),
        ...opts
      });
      return chatText(resp);
    },

    // Generate an image, returning a Blob.
    async generateImage(prompt, aspect) {
      await ensurePuter();
      const fullPrompt = aspect ? `${prompt} (${aspect} aspect ratio)` : prompt;
      const el = await window.puter.ai.txt2img(fullPrompt);
      const src = el && (el.src || (typeof el === 'string' ? el : null));
      if (!src) throw new Error('Puter returned no image.');
      const r = await fetch(src);
      return r.blob();
    },

    // Generate a short video clip, returning a Blob.
    async generateVideo(prompt, opts = {}) {
      await ensurePuter();
      const el = await window.puter.ai.txt2vid(prompt, {
        model: opts.model || 'sora-2',
        seconds: opts.seconds,
        size: opts.size
      });
      const src = el && (el.src || (typeof el === 'string' ? el : null));
      if (!src) throw new Error('Puter returned no video.');
      const r = await fetch(src);
      return r.blob();
    }
  };

  window.BlvckAI = BlvckAI;
})();
