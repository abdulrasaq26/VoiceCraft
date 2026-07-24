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
  // Includes open models a self-hosted instance is likely to have.
  const IMAGE_CANDIDATES = ['gpt-image-1', 'dall-e-3', 'gpt-image-1-mini', 'gpt-image-2', 'gpt-image-1.5', 'qwen/qwen-image-2.0'];
  // Preference order when auto-picking a chat model from what's available.
  const CHAT_PREF = [/claude.*sonnet/i, /claude.*opus/i, /claude/i, /gpt-5/i, /gpt-4/i, /gemini/i, /deepseek/i, /qwen/i, /llama/i, /mistral/i, /grok/i, /glm/i, /kimi/i, /phi/i];
  // Last-resort chat model IDs for when discovery is unavailable AND the
  // instance default is unset. Discovery (listModels) is always preferred —
  // these only matter on an instance too old to list models.
  const FALLBACK_CHAT_MODELS = ['claude-sonnet-5', 'gpt-5-nano', 'gpt-4o', 'gemini-2.5-flash', 'deepseek-chat'];
  // How many discovered models to attempt before giving up (bounds cost).
  const MAX_CHAT_ATTEMPTS = 8;
  // Model IDs earlier builds shipped that are NOT valid Puter models — cleared
  // from storage on load so a stale choice can't keep breaking chat.
  const STALE_MODELS = new Set(['claude-sonnet-4', 'claude-opus-4', 'gpt-4.1', 'google/gemini-2.5-flash']);

  // One-time migration: drop an invalid stored chat model from older builds.
  try {
    const cur = localStorage.getItem('blvck:chatmodel');
    if (cur && STALE_MODELS.has(cur)) localStorage.removeItem('blvck:chatmodel');
  } catch { /* storage unavailable */ }

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
  // Matches puter.com's shapes too, e.g. a 404 with
  //   {"error":{"type":"not_found_error","message":"model: claude-3-5-sonnet-20240620"}}
  function isModelError(e) {
    let raw = '';
    try { raw = typeof e === 'string' ? e : JSON.stringify(e); } catch { raw = String(e); }
    const s = `${errMsg(e)} ${raw}`.toLowerCase();
    const status = e && (e.status || e.statusCode || e.code);
    return (
      String(status) === '404' ||
      /\b404\b/.test(s) ||
      /not_found|not found|not available|unavailable|invalid model|unknown model|no such model|unsupported model|missing .?model|model not found/.test(s) ||
      /"?model"?:\s*["']?\S/.test(s) // a bare "model: <id>" not-found message
    );
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

  // Dated snapshots (e.g. claude-3-5-sonnet-20240620) are often retired even
  // though listModels still advertises them, so prefer undated model IDs.
  function isDatedModel(id) {
    return /\d{8}|\d{4}-\d{2}-\d{2}/.test(String(id));
  }

  function prefRank(m) {
    for (let i = 0; i < CHAT_PREF.length; i++) {
      if (CHAT_PREF[i].test(m.id) || CHAT_PREF[i].test(m.name)) return i;
    }
    return CHAT_PREF.length;
  }

  // Order discovered models best-first: undated snapshots before dated ones,
  // then by preferred family. Returns an array of model ids.
  function orderDiscovered(models) {
    return models
      .map((m) => ({ id: m.id, dated: isDatedModel(m.id) ? 1 : 0, rank: prefRank(m) }))
      .sort((a, b) => a.dated - b.dated || a.rank - b.rank)
      .map((x) => x.id);
  }

  function pickChatModel(models) {
    const ordered = orderDiscovered(models);
    return ordered[0] || null;
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
    // The attempt list is built from the models THIS instance actually reports
    // (via listModels), so it works identically on puter.com and a self-hosted
    // Puter with a totally different model roster. Only when discovery is
    // unavailable does it fall back to hardcoded known-good IDs. Stops at the
    // first success and remembers the winning model so later calls are direct.
    async _chatResilient(messages, preferredModel) {
      await ensurePuter();
      if (preferredModel && STALE_MODELS.has(preferredModel)) preferredModel = null;

      const models = await this.listModels();
      const attempts = [];
      const add = (m) => {
        if (m === undefined) { if (!attempts.includes(undefined)) attempts.push(undefined); }
        else if (m && !attempts.includes(m)) attempts.push(m);
      };

      add(preferredModel || (await this.resolveChatModel()));
      if (models.length) {
        // Cycle through the instance's real models, best-first, then the
        // instance default. No puter.com-specific IDs on a self-hosted box.
        orderDiscovered(models).slice(0, MAX_CHAT_ATTEMPTS).forEach(add);
        add(undefined);
      } else {
        // Instance can't list models: try its default, then known-good IDs.
        add(undefined);
        FALLBACK_CHAT_MODELS.forEach(add);
      }

      let lastErr;
      for (const model of attempts) {
        try {
          const text = await this._chatOnce(messages, model);
          if (model) this.setChatModel(model); // remember what works
          return text;
        } catch (e) {
          lastErr = e;
          if (!isModelError(e)) throw e; // real failure (quota/network/etc.)
        }
      }
      throw new Error(errMsg(lastErr) || 'No chat model is available on this Puter instance.');
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
