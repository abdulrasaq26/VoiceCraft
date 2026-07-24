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
  const OBJECTIVE_KEY = 'blvck:objective'; // quality | balanced | cost

  // Map a generateJSON endpoint to a routing task so the Director picks the
  // model suited to that job (storytelling for scripts, structure for SEO…).
  function endpointTask(endpoint) {
    const e = String(endpoint || '');
    if (/bible/.test(e)) return 'bible';
    if (/scenes|storyboard/.test(e)) return 'storyboard';
    if (/seo/.test(e)) return 'seo';
    if (/script/.test(e)) return 'script';
    if (/audit|director/.test(e)) return 'audit';
    if (/research/.test(e)) return 'research';
    return 'chat';
  }

  const DEFAULT_TTS_MODEL = 'eleven_multilingual_v2';
  const DEFAULT_TTS_PROVIDER = 'elevenlabs';
  const DEFAULT_IMAGE_MODEL = 'gpt-image-1';
  // Tried in order if the configured image model is rejected by the instance.
  // Includes open models a self-hosted instance is likely to have.
  const IMAGE_CANDIDATES = ['gpt-image-1', 'dall-e-3', 'gpt-image-1-mini', 'gpt-image-2', 'gpt-image-1.5', 'qwen/qwen-image-2.0'];
  // Models that accept an input/reference image (image_url) for image-to-image
  // and character consistency. Tried first when a reference is supplied; if the
  // instance has none of them, generateImage falls back to text-only.
  const REFERENCE_IMAGE_MODELS = ['google/gemini-3-pro-image-preview', 'google/flash-image-2.5', 'openai/gpt-image-2', 'gpt-image-2', 'gpt-image-1', 'ideogram-v3'];
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

  // Categorise a failure so the diagnostics panel can name the real cause.
  function classifyError(e) {
    let raw = '';
    try { raw = typeof e === 'string' ? e : JSON.stringify(e); } catch { raw = String(e); }
    // Fold in the underlying error (attached as .cause) so wrapping doesn't
    // hide the provider's original message.
    let causeStr = '';
    if (e && e.cause) {
      try { causeStr = `${errMsg(e.cause)} ${typeof e.cause === 'string' ? e.cause : JSON.stringify(e.cause)}`; } catch { causeStr = String(e.cause); }
    }
    const s = `${errMsg(e)} ${raw} ${causeStr}`.toLowerCase();
    const status = String((e && (e.status || e.statusCode || e.code)) || (e && e.cause && (e.cause.status || e.cause.statusCode)) || '');
    if (status === '401' || /unauthorized|not signed in|not authenticated|auth token|login required|sign in/.test(s)) return 'authentication';
    if (status === '403' || /forbidden|permission denied|not allowed/.test(s)) return 'forbidden / permissions';
    if (status === '429' || /rate.?limit|too many requests|quota|exceeded|insufficient (funds|credit|balance)|payment/.test(s)) return 'rate limit / quota / billing';
    if (/failed to fetch|networkerror|network error|cors|cross-origin|load failed|err_failed|connection refused|typeerror: (failed|network)/.test(s)) return 'network / CORS';
    if (/provider not found|no such provider|unsupported provider|voice.*not found|not found.*voice|voice provider|isn.?t available/.test(s)) return 'missing provider / voice';
    if (isModelError(e)) return 'unsupported / missing model';
    return 'other';
  }

  // Let the connection banner re-surface when a live call fails because the
  // Puter session lapsed (auth expired / signed out in another tab).
  function maybeFlagAuth(e) {
    try {
      if (classifyError(e) === 'authentication') {
        window.dispatchEvent(new CustomEvent('blvck:ai-auth-error'));
      }
    } catch { /* ignore */ }
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

  // Lazy-load Puter's SDK. Only fetched on first use. Has a hard timeout so a
  // blocked/slow js.puter.com can never leave the app hanging on "Loading…" —
  // it rejects with a clear message instead, and a later retry can re-attempt.
  let puterLoading = null;
  const SDK_TIMEOUT_MS = 20000;
  function ensurePuter() {
    if (typeof window.puter !== 'undefined') return Promise.resolve();
    if (puterLoading) return puterLoading;
    puterLoading = new Promise((resolve, reject) => {
      let settled = false;
      const finish = (fn, arg) => { if (!settled) { settled = true; fn(arg); } };
      const s = document.createElement('script');
      s.src = 'https://js.puter.com/v2/';
      s.onload = () => (typeof window.puter !== 'undefined'
        ? finish(resolve)
        : finish(reject, new Error('Puter SDK loaded but unavailable.')));
      s.onerror = () => finish(reject, new Error('Could not load the Puter SDK (js.puter.com). Check your connection or network policy.'));
      document.head.appendChild(s);
      setTimeout(() => finish(reject, new Error('Timed out loading the Puter SDK (js.puter.com).')), SDK_TIMEOUT_MS);
    });
    // On failure, forget the cached promise so a later Sign-in / retry can try again.
    puterLoading.catch(() => { puterLoading = null; });
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

    // Per-task model that worked this session (perf hint; never clobbers the
    // user's explicit choice in storage).
    _taskWinner: {},

    // --- Model configuration ---
    // The stored chat model is the user's EXPLICIT override. Auto-routing never
    // writes it — so switching models per task can't hijack a user's choice.
    chatModel() { return localStorage.getItem(CHAT_MODEL_KEY) || ''; },
    setChatModel(m) { if (m) localStorage.setItem(CHAT_MODEL_KEY, m); },

    // Cost/quality objective that reweights every model pick.
    objective() { const o = localStorage.getItem(OBJECTIVE_KEY); return o === 'quality' || o === 'cost' ? o : 'balanced'; },
    setObjective(o) { if (o) localStorage.setItem(OBJECTIVE_KEY, o); },

    // Order / pick the best available model for a task via the capability
    // registry, honouring the objective. Falls back to the family-preference
    // ordering if the registry isn't loaded.
    orderForTask(models, task) {
      if (window.BlvckModels) return window.BlvckModels.orderForTask(models, task, { objective: this.objective() });
      return orderDiscovered(models);
    },
    pickModel(models, task) {
      if (window.BlvckModels) return window.BlvckModels.pickForTask(models, task, { objective: this.objective() });
      return pickChatModel(models);
    },
    // Which model the Director would use for a task right now (transparency).
    async modelForTask(task) { return this.resolveChatModel(task); },
    imageModel() { return localStorage.getItem(IMAGE_MODEL_KEY) || DEFAULT_IMAGE_MODEL; },
    setImageModel(m) { if (m) localStorage.setItem(IMAGE_MODEL_KEY, m); },
    // Empty by default so each provider's buildOptions() supplies its own
    // model/engine default (an ElevenLabs model must not leak to Polly, etc.).
    ttsModel() { return localStorage.getItem(TTS_MODEL_KEY) || ''; },
    setTtsModel(m) { if (m) localStorage.setItem(TTS_MODEL_KEY, m); else localStorage.removeItem(TTS_MODEL_KEY); },
    ttsProvider() { return localStorage.getItem(TTS_PROVIDER_KEY) || DEFAULT_TTS_PROVIDER; },
    setTtsProvider(p) { localStorage.setItem(TTS_PROVIDER_KEY, p || DEFAULT_TTS_PROVIDER); },

    // --- Puter connection & auth ---
    // Almost every "AI doesn't work" report on a deployed app is really "the
    // Puter session isn't established" (not signed in, popup blocked, or the
    // SDK can't load). These helpers let the UI detect that and offer a fix.

    // Best-effort synchronous check — safe to call often (no network, no popup).
    signedIn() {
      try {
        const a = window.puter && window.puter.auth;
        return !!(a && typeof a.isSignedIn === 'function' && a.isSignedIn());
      } catch { return false; }
    },

    // Full connection status: is the SDK loaded, is a user signed in, and who.
    // Never throws — returns a structured report for the connection banner.
    async status() {
      const out = { sdk: false, signedIn: null, user: null, error: '' };
      try { await ensurePuter(); out.sdk = true; }
      catch (e) { out.error = errMsg(e); return out; }
      try {
        const a = window.puter.auth || {};
        if (typeof a.isSignedIn === 'function') out.signedIn = await Promise.resolve(a.isSignedIn());
        if (out.signedIn !== false && typeof a.getUser === 'function') {
          try { out.user = await a.getUser(); } catch { /* getUser can fail while token refreshes */ }
        }
      } catch (e) { out.error = errMsg(e); }
      return out;
    },

    // Open Puter's sign-in popup (must be called from a user gesture). On
    // success the model cache is cleared so discovery re-runs under the new
    // session. Returns the signed-in user (or null if unavailable).
    async signIn(opts) {
      await ensurePuter();
      const a = window.puter.auth;
      if (!a || typeof a.signIn !== 'function') {
        throw new Error('This Puter instance does not expose an auth API to sign in with.');
      }
      await a.signIn(opts || {});
      modelsCache = null;
      let user = null;
      try { user = await a.getUser(); } catch { /* ignore */ }
      return user;
    },

    async signOut() {
      try { await ensurePuter(); } catch { return; }
      const a = window.puter.auth;
      if (a && typeof a.signOut === 'function') { try { await a.signOut(); } catch { /* ignore */ } }
      modelsCache = null;
    },

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

    // The chat model to use for a task: the user's explicit choice if the
    // instance still offers it, otherwise the best available model for that
    // task under the current objective. Task-aware and non-persisting, so
    // different stages can use different models. Returns undefined when no
    // list is available (let Puter default).
    async resolveChatModel(task) {
      const stored = this.chatModel();
      const models = await this.listModels();
      const known = (id) => models.some((m) => m.id === id || m.aliases.includes(id));
      if (stored && known(stored)) return stored; // explicit user override wins
      if (!models.length) return stored || undefined;
      return this.pickModel(models, task || 'chat') || stored || undefined;
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
    async _chatResilient(messages, preferredModel, task) {
      await ensurePuter();
      task = task || 'chat';
      if (preferredModel && STALE_MODELS.has(preferredModel)) preferredModel = null;

      const models = await this.listModels();
      const stored = this.chatModel();
      const known = (id) => models.some((m) => m.id === id || m.aliases.includes(id));
      const attempts = [];
      const add = (m) => {
        if (m === undefined) { if (!attempts.includes(undefined)) attempts.push(undefined); }
        else if (m && !attempts.includes(m)) attempts.push(m);
      };

      // Order of attempts: an explicit request → the user's saved override →
      // this session's proven pick for the task → the registry's best models
      // for the task → the instance default → hardcoded fallbacks.
      if (preferredModel) add(preferredModel);
      else if (stored && known(stored)) add(stored);
      else if (this._taskWinner[task] && known(this._taskWinner[task])) add(this._taskWinner[task]);

      if (models.length) {
        this.orderForTask(models, task).slice(0, MAX_CHAT_ATTEMPTS).forEach(add);
        add(undefined);
      } else {
        add(undefined);
        FALLBACK_CHAT_MODELS.forEach(add);
      }

      let lastErr;
      for (const model of attempts) {
        try {
          const text = await this._chatOnce(messages, model);
          // Remember the winning model for this task (session only) so repeat
          // calls go direct — but never overwrite the user's explicit choice.
          if (model && !stored) this._taskWinner[task] = model;
          return text;
        } catch (e) {
          lastErr = e;
          if (!isModelError(e)) { maybeFlagAuth(e); throw e; } // real failure (quota/network/auth)
        }
      }
      maybeFlagAuth(lastErr);
      const err = new Error(errMsg(lastErr) || 'No chat model is available on this Puter instance.');
      err.cause = lastErr;
      throw err;
    },

    // Synthesize speech via Puter's txt2speech, using whichever provider is
    // selected (ElevenLabs, Amazon Polly, OpenAI, Gemini, or xAI). Each
    // provider needs a different options shape — buildTtsOptions (from
    // tts-providers.js) produces the right one. Returns an audio Blob.
    // opts: { voice_settings?, instructions?, model?, language? }
    async speak(text, voice, opts = {}) {
      await ensurePuter();
      const provider = this.ttsProvider();
      const ctx = {
        voiceSettings: normalizeVoiceSettings(opts.voice_settings),
        instructions: opts.instructions || '',
        model: opts.model || this.ttsModel() || '',
        language: opts.language || 'en-US'
      };
      const params = window.buildTtsOptions
        ? window.buildTtsOptions(provider, voice, ctx)
        : { provider, voice, model: ctx.model, voice_settings: ctx.voiceSettings };

      let audio;
      try {
        audio = await window.puter.ai.txt2speech(text, params);
      } catch (e) {
        const msg = errMsg(e);
        let err;
        if (/provider not found|not found:|no such provider|unsupported provider|voice.*not found|not found.*voice/i.test(msg)) {
          const avail = msg.match(/available[:\s]*(.+)$/i);
          err = new Error(
            `The "${provider}" voice provider (or this voice) isn't available on your Puter instance.` +
            (avail ? ` Available providers: ${avail[1].trim()}.` : '') +
            ' Switch the voice provider under ⚙ AI settings to one your instance supports.'
          );
        } else {
          err = new Error(msg || 'Speech synthesis failed.');
        }
        err.cause = e; // keep the original for diagnostics/classification
        maybeFlagAuth(e);
        throw err;
      }
      const src = audio && (audio.src || (typeof audio === 'string' ? audio : null));
      if (!src) throw new Error('The TTS provider returned no audio.');
      const r = await fetch(src);
      return r.blob();
    },

    // Run a JSON-producing generation entirely in the browser: build the
    // prompt with BlvckPrompts, run the chat model via Puter, parse (with
    // repair) via BlvckPrompts. If the model returns prose/markdown/invalid
    // JSON, retry up to 3 times explicitly asking for JSON only. The raw
    // response and attempt count are surfaced on failure (for "View raw").
    // opts: { attempts?, onAttempt? }
    async generateJSON(endpoint, payload, opts = {}) {
      if (!window.BlvckPrompts) throw new Error('Prompt module not loaded (prompts.js).');
      const prompt = window.BlvckPrompts.build(endpoint, payload);
      const base = [];
      if (prompt.system) base.push({ role: 'system', content: prompt.system });
      base.push({ role: 'user', content: prompt.user });

      const maxAttempts = Math.max(1, opts.attempts || 3);
      const task = opts.task || endpointTask(endpoint);
      let messages = base;
      let lastRaw = '';
      let lastErr = null;

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        if (opts.onAttempt) { try { opts.onAttempt(attempt, maxAttempts); } catch { /* ignore */ } }
        let rawText = '';
        try {
          rawText = await this._chatResilient(messages, undefined, task);
        } catch (e) {
          lastErr = e; // model/transport error — not a JSON problem, stop.
          break;
        }
        lastRaw = rawText || '';
        this._lastRaw = lastRaw;
        if (!rawText) {
          lastErr = new Error('Empty response from the model.');
        } else {
          try {
            return window.BlvckPrompts.parse(endpoint, payload, rawText);
          } catch (e) {
            lastErr = e;
          }
        }
        // Retry: show the model its output and demand strict JSON.
        messages = base.concat([
          { role: 'assistant', content: rawText || '(empty)' },
          { role: 'user', content: 'Your previous reply was not valid JSON. Reply with ONLY the JSON object — no explanations, no markdown code fences, no comments, no trailing commas. It must start with { and end with }.' }
        ]);
      }

      const err = new Error(`${(lastErr && lastErr.message) || 'Invalid response'} (after ${maxAttempts} attempt${maxAttempts > 1 ? 's' : ''}).`);
      err.raw = (lastErr && lastErr.raw) || lastRaw;
      err.category = classifyError(lastErr);
      throw err;
    },

    lastRawResponse() { return this._lastRaw || ''; },

    // Generic chat completion returning plain text (script generator, agent).
    // opts.task routes to the best-suited model for that job.
    async chat(messages, opts = {}) {
      return this._chatResilient(messages, opts.model, opts.task);
    },

    // Streaming chat: calls onToken(delta, full) as tokens arrive, returns the
    // full text. Stops early if shouldStop() becomes true. Falls back to a
    // non-streaming resilient call if the instance doesn't support streaming.
    // opts: { model?, onToken?, shouldStop? }
    async chatStream(messages, opts = {}) {
      await ensurePuter();
      const task = opts.task || 'chat';
      const onToken = opts.onToken || (() => {});
      const shouldStop = opts.shouldStop || (() => false);
      const model = opts.model || (await this.resolveChatModel(task));
      let full = '';
      const consume = async (resp) => {
        if (!resp || typeof resp[Symbol.asyncIterator] !== 'function') {
          const t = chatText(resp);
          if (t) { full += t; onToken(t, full); }
          return;
        }
        for await (const part of resp) {
          if (shouldStop()) break;
          const t = (part && (part.text || (part.delta && part.delta.content) || (part.message && part.message.content))) || '';
          if (t) { full += t; onToken(t, full); }
        }
      };
      try {
        const resp = await window.puter.ai.chat(messages, Object.assign({ stream: true }, model ? { model } : {}));
        await consume(resp);
        if (model && !this.chatModel()) this._taskWinner[task] = model; // session hint only
        return full;
      } catch (e) {
        if (full) throw e; // partial stream already delivered
        // Streaming unsupported or model unavailable — fall back cleanly.
        full = await this._chatResilient(messages, model, task);
        onToken(full, full);
        return full;
      }
    },

    // Turn a rough idea into one rich, model-ready image prompt.
    async enhanceImagePrompt(idea, styleHint) {
      const sys = 'You turn a short idea into ONE rich, vivid image-generation prompt. Output ONLY the prompt text — no preamble, no quotes, no numbered options. Describe subject, setting, composition, camera/framing, lighting, color palette, mood and medium/art-style. Keep it under 80 words.';
      const user = `Idea: ${String(idea || '').trim()}${styleHint ? `\nPreferred visual style: ${styleHint}` : ''}\nWrite the enhanced image prompt.`;
      const out = await this.chat([{ role: 'system', content: sys }, { role: 'user', content: user }], { task: 'image-prompt' });
      return String(out).trim().replace(/^["'`]+|["'`]+$/g, '').trim();
    },

    // Rewrite a narration script in place: polish | punch | shorten | expand.
    async refineScript(script, mode, opts = {}) {
      const briefs = {
        polish: 'Polish this narration: tighten wording, fix awkward phrasing, and improve flow and rhythm. Keep the meaning, length and voice.',
        punch: 'Punch up this narration: a stronger hook, more vivid verbs, sharper rhythm and higher energy. Keep it roughly the same length and on the same topic.',
        shorten: 'Shorten this narration by about 30%, keeping the strongest lines and the core message.',
        expand: 'Expand this narration by about 40% with vivid, concrete detail and smoother transitions, keeping the same voice and topic.'
      };
      const sys = 'You are an elite script editor for spoken narration. Rewrite as instructed. Output ONLY the rewritten narration — no commentary, no markdown, no labels, no quotes.';
      const user = `${briefs[mode] || briefs.polish}\n\nNARRATION:\n${String(script || '')}`;
      const messages = [{ role: 'system', content: sys }, { role: 'user', content: user }];
      if (opts.onToken || opts.shouldStop) return this.chatStream(messages, Object.assign({}, opts, { task: 'refine' }));
      return this.chat(messages, { task: 'refine' });
    },

    // Generate an image, returning a Blob. Passes an explicit model (required
    // by current Puter) and falls back across known image models if needed.
    // opts.imageUrl — a reference/input image (URL or data URL) for
    // image-to-image / character consistency, used only on models that accept
    // it; if none work, generation falls back to text-only so it never fails
    // just because references aren't supported.
    async generateImage(prompt, aspect, opts = {}) {
      await ensurePuter();
      const full = aspect ? `${prompt} (${aspect} aspect ratio)` : prompt;
      const ref = opts.imageUrl || opts.reference || null;
      const configured = this.imageModel();

      const tries = ref
        ? [...REFERENCE_IMAGE_MODELS, configured].filter((v, i, a) => v && a.indexOf(v) === i)
        : [configured, ...IMAGE_CANDIDATES.filter((m) => m !== configured)];

      let lastErr;
      for (const model of tries) {
        try {
          const params = { model };
          if (ref) params.image_url = ref;
          const el = await window.puter.ai.txt2img(full, params);
          const src = el && (el.src || (typeof el === 'string' ? el : null));
          if (!src) throw new Error('Puter returned no image.');
          if (!ref && model !== configured) this.setImageModel(model); // remember what works
          const r = await fetch(src);
          return r.blob();
        } catch (e) {
          lastErr = e;
          const cat = classifyError(e);
          // A genuine failure (quota/network) should surface immediately.
          if (cat === 'rate limit / quota / billing' || cat === 'network / CORS') {
            throw new Error(errMsg(e) || 'Image generation failed.');
          }
          // For text-only mode, only walk the list on model-availability errors.
          if (!ref && !isModelError(e)) throw new Error(errMsg(e) || 'Image generation failed.');
          // For reference mode, keep trying other reference-capable models.
        }
      }
      // Reference requested but unsupported everywhere → text-only fallback so
      // the scene still generates (from its text description).
      if (ref) return this.generateImage(prompt, aspect, {});
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
    },

    classifyError,

    // --- Diagnostics ------------------------------------------------------
    // Runs a battery of live checks and returns a structured report the UI
    // renders. This is what turns "generation failed" into a precise cause
    // (auth / CORS / missing provider / unsupported model / quota).
    // opts: { image?: boolean } — image test is opt-in (it costs credits).
    async diagnose(opts = {}) {
      const steps = [];
      const push = (name, status, detail, extra) => steps.push({ name, status, detail, ...(extra || {}) });

      // 1. SDK
      try {
        await ensurePuter();
        push('Puter SDK', 'ok', 'Loaded (js.puter.com).');
      } catch (e) {
        push('Puter SDK', 'fail', errMsg(e), { category: classifyError(e) });
        return { steps, page: location.href };
      }

      // 2. Endpoint (best-effort — Puter keeps this internal)
      let endpoint = 'unknown (SDK internal)';
      try {
        const pu = window.puter;
        endpoint = pu.APIOrigin || pu.apiOrigin || pu.defaultAPIOrigin ||
          (pu.env && (pu.env.api_origin || pu.env.origin)) || endpoint;
      } catch { /* ignore */ }
      push('API endpoint', 'info', String(endpoint));
      push('App origin', 'info', `${location.origin} (${location.protocol.replace(':', '')})`);

      // 3. Auth
      try {
        const auth = window.puter.auth || {};
        let signedIn = null;
        if (typeof auth.isSignedIn === 'function') signedIn = await Promise.resolve(auth.isSignedIn());
        let user = null;
        if (typeof auth.getUser === 'function') { try { user = await auth.getUser(); } catch { /* ignore */ } }
        if (signedIn === false) {
          push('Authentication', 'warn', 'Not signed in to Puter. AI calls will fail with an auth error until you sign in.');
        } else {
          push('Authentication', 'ok', user ? `Signed in as ${user.username || user.uuid || 'user'}.` : (signedIn === null ? 'Auth state unknown (older SDK).' : 'Signed in.'));
        }
      } catch (e) {
        push('Authentication', 'warn', errMsg(e), { category: classifyError(e) });
      }

      // 4. Config snapshot
      push('Chat model', 'info', this.chatModel() || '(auto / instance default)');
      push('Image model', 'info', this.imageModel());
      push('Voice provider', 'info', `${this.ttsProvider()}${this.ttsModel() ? ' · ' + this.ttsModel() : ''}`);

      // 5. listModels
      let models = [];
      try {
        models = await this.listModels(true);
        push('listModels()', models.length ? 'ok' : 'warn',
          models.length ? `${models.length} models. First: ${models.slice(0, 10).map((m) => m.id).join(', ')}` : 'Returned 0 models (instance may not expose a model list).');
      } catch (e) {
        push('listModels()', 'fail', errMsg(e), { category: classifyError(e) });
      }

      // 6. Live test chat
      try {
        const reply = await this.chat([{ role: 'user', content: 'Reply with exactly: OK' }]);
        push('Test chat', 'ok', `model=${this.chatModel() || '(default)'} → "${String(reply).trim().slice(0, 80)}"`);
      } catch (e) {
        push('Test chat', 'fail', errMsg(e), { category: classifyError(e), raw: safeRaw(e) });
      }

      // 7. Live test voice (uses the current provider's first voice)
      try {
        const voices = (window.getTtsVoices ? window.getTtsVoices(this.ttsProvider()) : []) || [];
        const voice = voices[0] && voices[0].id;
        if (!voice) {
          push('Test voice', 'warn', `No voices defined for provider "${this.ttsProvider()}".`);
        } else {
          const blob = await this.speak('Diagnostics test.', voice, {});
          push('Test voice', 'ok', `${this.ttsProvider()} / ${voice} → ${blob.size} bytes of audio.`);
        }
      } catch (e) {
        push('Test voice', 'fail', errMsg(e), { category: classifyError(e), raw: safeRaw(e) });
      }

      // 8. Optional live test image
      if (opts.image) {
        try {
          const blob = await this.generateImage('a simple red circle on white', '1:1');
          push('Test image', 'ok', `${this.imageModel()} → ${blob.size} bytes.`);
        } catch (e) {
          push('Test image', 'fail', errMsg(e), { category: classifyError(e), raw: safeRaw(e) });
        }
      }

      return { steps, page: location.href, at: new Date().toISOString() };
    }
  };

  function safeRaw(e) {
    // Prefer the underlying cause (the provider's original error) if present.
    const target = (e && e.cause) || e;
    if (target instanceof Error) return target.stack || target.message;
    try {
      const s = typeof target === 'string' ? target : JSON.stringify(target);
      return s === '{}' && e instanceof Error ? (e.stack || e.message) : s;
    } catch { return String(target); }
  }

  window.BlvckAI = BlvckAI;
})();
