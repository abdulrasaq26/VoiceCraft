// Puter-first AI router for Blvck-TTS.
//
// Every AI capability — speech (ElevenLabs), text (any chat model), images,
// video — routes through Puter's client-side SDK. Because different Puter
// instances (hosted puter.com vs. a self-hosted server) expose different
// models and providers, nothing here hardcodes a model ID: chat models are
// discovered at runtime via puter.ai.listModels(), a sensible default is
// picked from whatever the instance actually has, and calls self-heal by
// retrying with a discovered model if the configured one is missing.
(() => {
  'use strict';

  const CHAT_MODEL_KEY = 'blvck:chatmodel';
  const IMAGE_MODEL_KEY = 'blvck:imagemodel';
  const TTS_MODEL_KEY = 'blvck:ttsmodel';
  const TTS_PROVIDER_KEY = 'blvck:ttsprovider';

  const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';
  const DEFAULT_TTS_PROVIDER = 'elevenlabs';
  const DEFAULT_IMAGE_MODEL = 'gpt-image-1';
  // Tried in order if the configured image model is rejected by the instance.
  const IMAGE_CANDIDATES = ['gpt-image-1', 'dall-e-3', 'gpt-image-1-mini', 'gpt-image-2', 'gpt-image-1.5'];
  // Preference order when auto-picking a chat model from what's available.
  const CHAT_PREF = [/claude.*sonnet/i, /claude.*opus/i, /claude/i, /gpt-5/i, /gpt-4/i, /gemini/i, /deepseek/i, /llama/i, /mistral/i, /qwen/i];

  const DEFAULT_VOICE_SETTINGS = Object.freeze({
    stability: 0.5,
    similarity_boost: 0.85,
    style: 0.1,
    use_speaker_boost: true
  });

  // Extract a human-readable message from Puter's varied error shapes.
  function errMsg(e) {
    if (!e) return '';
    if (typeof e === 'string') return e;
    if (e.message) return e.message;
    if (e.error) return typeof e.error === 'string' ? e.error : (e.error.message || JSON.stringify(e.error));
    try { return JSON.stringify(e); } catch { return String(e); }
  }

  // True when an error means "that model/provider isn't available here", so a
  // retry with a discovered model is worth attempting (vs. quota/network).
  function isModelError(e) {
    return /model.*(not found|not available|unavailable|invalid|unknown|missing)|not found:|missing .?model|no such model|unsupported model/i.test(errMsg(e));
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

  // Normalise a listModels() entry (string or object) to { id, name, provider, aliases }.
  function normModel(m) {
    if (typeof m === 'string') return { id: m, name: m, provider: '', aliases: [] };
    if (!m) return null;
    const id = m.id || m.model || m.name;
    if (!id) return null;
    return { id, name: m.name || id, provider: m.provider || '', aliases: Array.isArray(m.aliases) ? m.aliases : [] };
  }

  function pickChatModel(models) {
    for (const rx of CHAT_PREF) {
      const hit = models.find((m) => rx.test(m.id) || rx.test(m.name));
      if (hit) return hit.id;
    }
    return models[0] ? models[0].id : null;
  }

  let modelsCache = null;

  const BlvckAI = {
    DEFAULT_VOICE_SETTINGS,

    // --- Model configuration ---
    chatModel() { return localStorage.getItem(CHAT_MODEL_KEY) || ''; },
    setChatModel(m) { if (m) localStorage.setItem(CHAT_MODEL_KEY, m); },
    imageModel() { return localStorage.getItem(IMAGE_MODEL_KEY) || DEFAULT_IMAGE_MODEL; },
    setImageModel(m) { if (m) localStorage.setItem(IMAGE_MODEL_KEY, m); },
    ttsModel() { return localStorage.getItem(TTS_MODEL_KEY) || DEFAULT_TTS_MODEL; },
    setTtsModel(m) { localStorage.setItem(TTS_MODEL_KEY, m || DEFAULT_TTS_MODEL); },
    ttsProvider() { return localStorage.getItem(TTS_PROVIDER_KEY) || DEFAULT_TTS_PROVIDER; },
    setTtsProvider(p) { localStorage.setItem(TTS_PROVIDER_KEY, p || DEFAULT_TTS_PROVIDER); },

    // Discover the chat models this Puter instance actually offers. Returns
    // [] if the instance is too old to support listModels — callers then let
    // Puter choose its own default.
    async listModels(force) {
      await ensurePuter();
      if (modelsCache && !force) return modelsCache;
      try {
        if (!window.puter.ai || typeof window.puter.ai.listModels !== 'function') {
          modelsCache = [];
          return modelsCache;
        }
        const raw = await window.puter.ai.listModels();
        const list = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.models) ? raw.models : []);
        modelsCache = list.map(normModel).filter(Boolean);
      } catch {
        modelsCache = [];
      }
      return modelsCache;
    },

    // The chat model to use: the stored choice if the instance still offers
    // it, otherwise a freshly-picked available default (which is persisted).
    // Returns undefined when no list is available (let Puter default).
    async resolveChatModel() {
      const stored = this.chatModel();
      const models = await this.listModels();
      if (!models.length) return stored || undefined;
      const known = (id) => models.some((m) => m.id === id || m.aliases.includes(id));
      if (stored && known(stored)) return stored;
      const pick = pickChatModel(models);
      if (pick) { this.setChatModel(pick); return pick; }
      return stored || undefined;
    },

    async _chatOnce(messages, model) {
      const opts = {};
      if (model) opts.model = model;
      return chatText(await window.puter.ai.chat(messages, opts));
    },

    // Run a chat completion, self-healing if the chosen model is unavailable.
    async _chatResilient(messages, preferredModel) {
      await ensurePuter();
      let model = preferredModel || (await this.resolveChatModel());
      try {
        return await this._chatOnce(messages, model);
      } catch (e) {
        if (!isModelError(e)) throw e;
        // Refresh the catalog and try a discovered default, then Puter's own.
        const models = await this.listModels(true);
        const pick = pickChatModel(models);
        if (pick && pick !== model) {
          this.setChatModel(pick);
          try { return await this._chatOnce(messages, pick); } catch (e2) { if (!isModelError(e2)) throw e2; }
        }
        return await this._chatOnce(messages, undefined); // let Puter pick its default
      }
    },

    // Synthesize speech (default: ElevenLabs) via Puter; returns an audio Blob.
    async speak(text, voice, opts = {}) {
      await ensurePuter();
      const provider = this.ttsProvider();
      let audio;
      try {
        audio = await window.puter.ai.txt2speech(text, {
          provider,
          voice,
          model: opts.model || this.ttsModel(),
          voice_settings: normalizeVoiceSettings(opts.voice_settings)
        });
      } catch (e) {
        const msg = errMsg(e);
        if (/provider not found|not found:|no such provider|unsupported provider/i.test(msg)) {
          const avail = msg.match(/available[:\s]*(.+)$/i);
          throw new Error(
            `This Puter instance doesn't have the "${provider}" text-to-speech provider.` +
            (avail ? ` Available: ${avail[1].trim()}.` : '') +
            ' On puter.com ElevenLabs is available out of the box; a self-hosted Puter must have it configured, or switch the provider under AI settings.'
          );
        }
        throw new Error(msg || 'Speech synthesis failed.');
      }
      const src = audio && (audio.src || (typeof audio === 'string' ? audio : null));
      if (!src) throw new Error('The TTS provider returned no audio.');
      const r = await fetch(src);
      return r.blob();
    },

    // Run a JSON-producing generation entirely in the browser: build the
    // prompt with BlvckPrompts, run the chat model via Puter, parse the
    // output with BlvckPrompts. No backend involved.
    async generateJSON(endpoint, payload) {
      if (!window.BlvckPrompts) throw new Error('Prompt module not loaded (prompts.js).');
      const prompt = window.BlvckPrompts.build(endpoint, payload);
      const messages = [];
      if (prompt.system) messages.push({ role: 'system', content: prompt.system });
      messages.push({ role: 'user', content: prompt.user });
      const rawText = await this._chatResilient(messages);
      if (!rawText) throw new Error('The chat model returned an empty response.');
      return window.BlvckPrompts.parse(endpoint, payload, rawText);
    },

    // Generic chat completion returning plain text (script generator, agent).
    async chat(messages, opts = {}) {
      return this._chatResilient(messages, opts.model);
    },

    // Generate an image, returning a Blob. Passes an explicit model (required
    // by current Puter) and falls back across known image models if needed.
    async generateImage(prompt, aspect) {
      await ensurePuter();
      const full = aspect ? `${prompt} (${aspect} aspect ratio)` : prompt;
      const configured = this.imageModel();
      const tries = [configured, ...IMAGE_CANDIDATES.filter((m) => m !== configured)];
      let lastErr;
      for (const model of tries) {
        try {
          const el = await window.puter.ai.txt2img(full, { model });
          const src = el && (el.src || (typeof el === 'string' ? el : null));
          if (!src) throw new Error('Puter returned no image.');
          if (model !== configured) this.setImageModel(model); // remember what works
          const r = await fetch(src);
          return r.blob();
        } catch (e) {
          lastErr = e;
          // Only walk the candidate list for model-availability errors; a real
          // failure (quota, network) should surface immediately.
          if (!isModelError(e)) throw new Error(errMsg(e) || 'Image generation failed.');
        }
      }
      throw new Error(errMsg(lastErr) || 'No available image model on this Puter instance.');
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
