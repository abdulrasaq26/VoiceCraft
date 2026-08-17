// Decoupled Multi-Provider Router for Blvck-TTS v5.1
// NVIDIA NIM Gateway Infrastructure Client with Free Endpoint Support, Error Transparency, & Streaming
(() => {
  'use strict';

  const CHAT_MODEL_KEY = 'blvck:chatmodel';
  const IMAGE_MODEL_KEY = 'blvck:imagemodel';
  const IMAGE_PROVIDER_KEY = 'blvck:imageprovider';
  const TTS_MODEL_KEY = 'blvck:ttsmodel';
  const TTS_PROVIDER_KEY = 'blvck:ttsprovider';
  const OBJECTIVE_KEY = 'blvck:objective'; // quality | balanced | cost | local_only

  let lastRawResponseStr = '';

  // --- OpenAI OAuth circuit breaker ---------------------------------------
  //
  // Persisted, because a production run is many page loads and an in-memory
  // flag would re-learn the same lesson on each one. Fifteen minutes is long
  // enough to save a whole render queue and short enough that a topped-up
  // account is picked up without anyone restarting anything.
  const OA_COOLDOWN_MS = 15 * 60 * 1000;
  const OA_BREAKER_KEY = 'blvck:oa-breaker-until';

  function oaBreakerOpen() {
    try {
      const until = Number(localStorage.getItem(OA_BREAKER_KEY) || 0);
      return Number.isFinite(until) && Date.now() < until;
    } catch { return false; }
  }
  function oaBreakerTrip() {
    try { localStorage.setItem(OA_BREAKER_KEY, String(Date.now() + OA_COOLDOWN_MS)); }
    catch { /* private mode — degrade to per-session behaviour */ }
  }
  function oaBreakerReset() {
    try { localStorage.removeItem(OA_BREAKER_KEY); } catch { /* no-op */ }
  }

  // Persist which model actually generated a task for the current project —
  // Channel Brain joins this against logged performance to learn which
  // models correlate with results (see brain.js modelBias()).
  function recordModelUsed(task, model) {
    if (!task || !model) return;
    try { if (window.BlvckAssets && window.BlvckAssets.recordModelUsed) window.BlvckAssets.recordModelUsed(task, model); } catch (_) {}
  }

  function getObjective() {
    return localStorage.getItem(OBJECTIVE_KEY) || 'balanced';
  }
  function setObjective(val) {
    localStorage.setItem(OBJECTIVE_KEY, val);
  }

  function getImageProvider() {
    return localStorage.getItem(IMAGE_PROVIDER_KEY) || 'pollinations';
  }
  function setImageProvider(val) {
    localStorage.setItem(IMAGE_PROVIDER_KEY, val);
  }

  function getTtsProvider() {
    return localStorage.getItem(TTS_PROVIDER_KEY) || 'kokoro';
  }
  function setTtsProvider(val) {
    localStorage.setItem(TTS_PROVIDER_KEY, val);
  }

  function getTtsModel() {
    return localStorage.getItem(TTS_MODEL_KEY) || 'kokoro';
  }
  function setTtsModel(val) {
    localStorage.setItem(TTS_MODEL_KEY, val);
  }

  function getChatModel() {
    return localStorage.getItem(CHAT_MODEL_KEY) || 'auto';
  }
  function setChatModel(val) {
    localStorage.setItem(CHAT_MODEL_KEY, val);
  }

  function getImageModel() {
    return localStorage.getItem(IMAGE_MODEL_KEY) || 'flux-1-dev';
  }
  function setImageModel(val) {
    localStorage.setItem(IMAGE_MODEL_KEY, val);
  }

  async function listModels() {
    if (window.ModelRegistry) {
      return window.ModelRegistry.getDiscoveredModels();
    }
    return [
      { provider: 'nim', id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
      { id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1' },
      { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' }
    ];
  }

  async function resolveChatModel(taskType = 'general') {
    const userSelected = getChatModel();
    if (userSelected && userSelected !== 'auto') {
      return { selectedModel: userSelected, fallbackModel: 'meta/llama-3.3-70b-instruct', reason: 'User Manual Selection' };
    }
    if (window.ModelRegistry) {
      return window.ModelRegistry.selectModelForTask(taskType);
    }
    return { selectedModel: 'meta/llama-3.3-70b-instruct', fallbackModel: 'deepseek-ai/deepseek-r1', reason: 'Default Free Endpoint Recommendation' };
  }

  // Primary Chat Router




  async function chat(promptOrMessages, options = {}) {
    return await window.AIManager.chat(promptOrMessages, options);
  }

  async function chatStream(promptOrMessages, options = {}, onChunkCb = null) {
    const opts = typeof options === 'function' ? { onChunk: options } : (options || {});
    if (onChunkCb && typeof onChunkCb === 'function') opts.onChunk = onChunkCb;
    return await window.AIManager.chatStream(promptOrMessages, opts, opts.onChunk);
  }

  async function generateJSON(endpoint, payload, options = {}) {
    return await window.AIManager.generateJSON(endpoint, payload, options);
  }


  // Multi-Provider TTS Router
  async function speak(text, voiceOrOptions = {}, extraOpts = {}) {
    // extraOpts must survive both call shapes. It used to be merged only when
    // the second argument was a string, so speak(text, undefined, {params})
    // — which happens whenever the caller's voice id is missing — silently
    // dropped every option including the generation parameters.
    let options = {};
    if (typeof voiceOrOptions === 'string') {
      options = { voice: voiceOrOptions, ...extraOpts };
    } else {
      options = { ...(voiceOrOptions || {}), ...extraOpts };
    }

    const provider = options.provider || getTtsProvider();
    // Fall back to the active provider's own first catalog voice. This was
    // hardcoded to 'af_heart', a Kokoro id, which is not a valid reference on
    // any other engine.
    let voice = options.voice;
    if (!voice) {
      const def = window.getTtsProvider && window.getTtsProvider(provider);
      const list = (def && typeof def.voices === 'function' && def.voices()) || [];
      voice = (list[0] && list[0].id) || 'default';
    }

    async function urlToBlob(url) {
      if (url instanceof Blob) return url;
      const res = await fetch(url);
      return await res.blob();
    }

    // Check if requested voice is an ElevenLabs voice
    const isElevenVoice = (provider === 'elevenlabs') || (window.ELEVEN_VOICES && window.ELEVEN_VOICES.some(v => v.id === voice));

    // 1. ElevenLabs Direct Key Provider
    if (isElevenVoice && window.DirectAdapters && window.DirectAdapters.getElevenLabsKey()) {
      try {
        console.log(`[BlvckAI] Synthesizing ElevenLabs speech with voice [${voice}]...`);
        const res = await window.DirectAdapters.elevenLabsTTS({
          text,
          voice_id: voice,
          stability: options.stability || 0.5,
          similarity_boost: options.similarity_boost || 0.85
        });
        if (res) return await urlToBlob(res);
      } catch (e) {
        console.warn('[BlvckAI] ElevenLabs failed:', e.message);
        if (provider === 'elevenlabs') throw e;
      }
    }

      // 1.5. Fish Audio Colab / API Provider
      if (provider === 'fishaudio' && window.FishAdapter) {
        try {
          console.log(`[BlvckAI] Synthesizing Fish Speech with voice [${voice}]...`);
          // No speed/instructions: Fish Speech has neither parameter. Passing
          // them was silently doing nothing. `params` carries the real
          // ServeTTSRequest fields (temperature, top_p, seed, ...).
          // Resolve [style] markers into per-passage reference ids here, so the
          // engine only ever receives plain text plus a reference. It has no
          // tag parser and would otherwise read the marker aloud.
          let segments = options.segments || null;
          if (!segments && window.BlvckVoiceStyles && window.getTtsProvider) {
            try {
              const catalog = window.getTtsProvider('fishaudio').voices() || [];
              if (window.BlvckVoiceStyles.hasVariants(voice, catalog)) {
                segments = window.BlvckVoiceStyles.segmentScript(text, voice, catalog);
              }
            } catch { /* fall through to a single-reference run */ }
          }
          const audioUrl = await window.FishAdapter.textToSpeech({
            input: text,
            voice,
            params: options.params || {},
            segments,
            onProgress: options.onProgress
          });
          if (audioUrl) return await urlToBlob(audioUrl);
        } catch (e) {
          console.warn('[BlvckAI] Fish Audio failed:', e);
          if (provider === 'fishaudio') throw e; // throw explicitly if they specifically requested it
        }
      }

    // 2. Kokoro Local Provider
    if (!isElevenVoice && window.KokoroAdapter) {
      try {
        const audioUrl = await window.KokoroAdapter.textToSpeech({
          input: text,
          voice,
          speed: options.speed || 1.0,
          instructions: options.instructions || ''
        });
        if (audioUrl) return await urlToBlob(audioUrl);
      } catch (e) {
        console.warn('[BlvckAI] Kokoro Local failed:', e);
      }
    }

    // WebSpeech Native Fallback
    if (window.DirectAdapters) {
      await window.DirectAdapters.webSpeechTTS({ text });
      return new Blob([], { type: 'audio/wav' });
    }

    throw new Error('No working TTS provider available.');
  }

  // Quality guardrails every Stable Diffusion request should carry. A caller's
  // style negatives are ADDED to these, not swapped for them: passing
  // `options.negative_prompt || ''` used to hand the adapter an empty string
  // whenever no style negative existed, silently discarding its own defaults.
  // Two groups here, both learned from real output on this pipeline.
  //
  // Text: SDXL cannot spell. Any document, label or sign it renders comes back
  // as scrambled pseudo-letters and instantly reads as AI-generated, so the
  // whole family is suppressed — the scene prompts are separately instructed
  // to film the human action rather than the artefact.
  //
  // Illustration: for real-world subjects the flat-vector "explainer graphic"
  // look is the other giveaway. Naming it here keeps scenes photographic even
  // when a prompt drifts toward stock-illustration phrasing.
  const SD_BASE_NEGATIVE = [
    'watermark, signature, logo',
    'text, letters, words, caption, subtitle, label, signage, handwriting, gibberish text, distorted text, misspelled',
    'flat vector, corporate illustration, infographic, clipart, cartoon, 3d render, cgi',
    'blurry, deformed, extra fingers, malformed hands, worst quality, low quality, jpeg artifacts'
  ].join(', ');

  function mergeNegative(extra) {
    const parts = [SD_BASE_NEGATIVE];
    const e = String(extra || '').trim();
    if (e) parts.push(e);
    return parts.join(', ');
  }

  // Image Generation Router — Local Stable Diffusion (Uncensored Local Studio)
  async function generateImage(promptOrOptions = {}, aspect_ratio = '16:9', extraOpts = {}) {
    let options = {};
    if (typeof promptOrOptions === 'string') {
      options = { prompt: promptOrOptions, aspect_ratio, ...extraOpts };
    } else {
      options = promptOrOptions || {};
      if (aspect_ratio && aspect_ratio !== '16:9') options.aspect_ratio = aspect_ratio;
      Object.assign(options, extraOpts);
    }

    const prompt = options.prompt || '';
    let enrichedPrompt = prompt;

    // Apply Asset Consistency rules to prompt if available
    if (window.AssetConsistency) {
      const block = window.AssetConsistency.buildConsistencyPromptBlock(
        options.characters || [], options.props || [], options.location || ''
      );
      if (block) enrichedPrompt = `${prompt}\n\n[CONSISTENCY RULES]\n${block}`;
    }

    const sdEp = (window.ProviderManager && window.ProviderManager.getPoolState('sd')?.endpoint) || 'http://localhost:1420';
    const activeImgProvider = getImageProvider();

    // 0. Pollinations.ai FLUX / SD Engine (Free, High-Res, No API Key Required)
    if (activeImgProvider === 'pollinations' || options.model === 'pollinations' || options.model === 'flux') {
      if (window.ImageAdapters && window.ImageAdapters.pollinationsGenerateImage) {
        try {
          console.log('[BlvckAI] Routing image generation via Pollinations.ai FLUX Engine...');
          return await window.ImageAdapters.pollinationsGenerateImage({
            prompt: enrichedPrompt,
            aspect_ratio: options.aspect_ratio || aspect_ratio || '16:9',
            model: options.model || 'flux',
            seed: options.seed != null ? options.seed : null
          });
        } catch (polErr) {
          console.warn('[BlvckAI] Pollinations.ai failed:', polErr.message);
          if (activeImgProvider === 'pollinations') throw polErr;
        }
      }
    }

    // 1. Cloudflare Worker AI (SDXL Base 1.0)
    if (activeImgProvider === 'cloudflare_worker' || options.model === 'cloudflare_worker' || options.model === '@cf/stabilityai/stable-diffusion-xl-base-1.0') {
      if (window.ImageAdapters && window.ImageAdapters.cloudflareWorkerGenerateImage) {
        try {
          console.log('[BlvckAI] Routing image generation via Cloudflare Worker AI...');
          const blob = await window.ImageAdapters.cloudflareWorkerGenerateImage({ prompt: enrichedPrompt });
          if (blob) return blob;
        } catch (cfErr) {
          console.warn('[BlvckAI] Cloudflare Worker AI failed:', cfErr.message);
          if (activeImgProvider === 'cloudflare_worker') throw cfErr;
        }
      }
    }

    // 1. OpenAI Image Generator (DALL-E 3 & ChatGPT gpt-image-2 via local proxy or API key)
    if (activeImgProvider === 'openai' || activeImgProvider === 'openai_oauth' || (options.model && (options.model.startsWith('dall-e') || options.model.includes('gpt-image')))) {
      if (window.ImageAdapters && window.ImageAdapters.openaiGenerateImage) {
        try {
          const urls = await window.ImageAdapters.openaiGenerateImage({
            prompt: enrichedPrompt,
            model: options.model || 'dall-e-3',
            aspect_ratio: options.aspect_ratio || aspect_ratio || '16:9'
          });
          if (urls && urls[0]) {
            if (urls[0].startsWith('data:image')) {
              const res = await fetch(urls[0]);
              return await res.blob();
            }
            return await urlToBlob(urls[0]);
          }
        } catch (oaImgErr) {
          console.warn('[BlvckAI] OpenAI image generation unavailable or forbidden, falling back:', oaImgErr.message);
        }
      }
    }

    // 1.9 Explicitly-chosen local Stable Diffusion.
    // This has to run BEFORE the unconditional Cloudflare fallback below.
    // Choosing local_sd previously still sent every prompt to Cloudflare SDXL
    // first, reaching the local machine only if Cloudflare happened to fail —
    // so the chosen engine, and its models, samplers and seeds, was bypassed.
    if ((activeImgProvider === 'local_sd' || options.model === 'local_sd') && window.StableDiffusionAdapter) {
      const sdArgs = {
        prompt: enrichedPrompt,
        negative_prompt: mergeNegative(options.negative_prompt),
        aspect_ratio: options.aspect_ratio || aspect_ratio || '16:9',
        steps: options.steps,
        cfg_scale: options.cfg_scale,
        sampler: options.sampler,
        seed: options.seed,
        // The backend swaps a style LoRA on this. Without it a 2D beat renders
        // photoreal however the prompt is written -- the checkpoint decides.
        style: options.style || '',
        width: options.width,
        height: options.height
      };

      // With a character reference to hand, drive generation from it — but only
      // if this server actually implements img2img. generateImageFromImage
      // returns null instead of throwing when it does not, so an unsupported
      // server quietly stays on seed-locked txt2img rather than failing a run.
      if (options.imageUrl && window.StableDiffusionAdapter.generateImageFromImage) {
        try {
          const fromRef = await window.StableDiffusionAdapter.generateImageFromImage({
            ...sdArgs,
            init_image: options.imageUrl,
            denoising_strength: options.denoising_strength != null ? options.denoising_strength : 0.65
          });
          if (fromRef) return fromRef;
        } catch (e) {
          console.warn('[BlvckAI] img2img attempt failed, falling back to txt2img:', e.message);
        }
      }

      return await window.StableDiffusionAdapter.generateImage({ ...sdArgs, model: null });
    }

    // 2. Secondary: Cloudflare Worker AI (SDXL Base 1.0)
    if (window.ImageAdapters && window.ImageAdapters.cloudflareWorkerGenerateImage) {
      try {
        console.log('[BlvckAI] Trying Cloudflare Worker AI image fallback...');
        const blob = await window.ImageAdapters.cloudflareWorkerGenerateImage({ prompt: enrichedPrompt });
        if (blob) return blob;
      } catch (cfErr) {
        console.warn('[BlvckAI] Cloudflare Worker AI fallback failed:', cfErr.message);
      }
    }

    // 3. Tertiary: Local Stable Diffusion via Uncensored Local Studio
    if (window.StableDiffusionAdapter) {
      try {
        return await window.StableDiffusionAdapter.generateImage({
          prompt: enrichedPrompt,
          negative_prompt: mergeNegative(options.negative_prompt),
          aspect_ratio: options.aspect_ratio || aspect_ratio || '16:9',
          steps: options.steps,
          cfg_scale: options.cfg_scale,
          sampler: options.sampler,
          seed: options.seed,
          model: (options.model === 'local_sd') ? null : options.model,
          style: options.style || '',
          width: options.width,
          height: options.height,
        });
      } catch (e) {
        console.warn('[BlvckAI] Stable Diffusion Local fallback failed:', e.message);
        if (options.model === 'local_sd' || activeImgProvider === 'local_sd') throw e;
      }
    }

    // 4. Universal Fallback: Free Pollinations.ai Image Engine
    try {
      console.log('[BlvckAI] Routing via Pollinations AI high-res image engine...');
      const cleanPrompt = encodeURIComponent(enrichedPrompt.slice(0, 300));
      const polUrl = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=1280&height=720&nologo=true&seed=${Math.floor(Math.random() * 100000)}`;
      const res = await fetch(polUrl);
      if (res.ok) {
        return await res.blob();
      }
    } catch (polErr) {
      console.warn('[BlvckAI] Pollinations fallback failed:', polErr.message);
    }

    throw new Error('All image generation backends unavailable. Check your AI Settings or network connection.');
  }

  // Video Generation Router
  async function generateVideo(options = {}) {
    if (window.VideoAdapters && window.ProviderManager && window.ProviderManager.getActiveKey('runway')) {
      try {
        return await window.VideoAdapters.runwayGenerateVideo(options);
      } catch (e) {
        console.warn('[BlvckAI] Runway failed, trying Luma:', e);
      }
    }

    if (window.VideoAdapters && window.ProviderManager && window.ProviderManager.getActiveKey('luma')) {
      return await window.VideoAdapters.lumaGenerateVideo(options);
    }

    throw new Error('Video generation provider unavailable.');
  }

  window.BlvckAI = {
    chat,
    chatStream,
    generateJSON,
    // Exposed so a topped-up account can be picked up immediately rather than
    // waiting out the cooldown: BlvckAI.clearQuotaBlock().
    clearQuotaBlock: oaBreakerReset,
    quotaBlocked: oaBreakerOpen,
    speak,
    generateImage,
    generateVideo,
    listModels,
    resolveChatModel,
    ttsProvider: getTtsProvider,
    setTtsProvider,
    imageProvider: getImageProvider,
    setImageProvider,
    ttsModel: getTtsModel,
    setTtsModel,
    chatModel: getChatModel,
    setChatModel,
    imageModel: getImageModel,
    setImageModel,
    objective: getObjective,
    setObjective,
    // Routing moved to AIManager, and so did the raw text it last saw. Reading
    // the local copy here would always answer '' — nothing assigns it any more.
    lastRawResponse: () => (
      (window.AIManager && window.AIManager.lastRawResponse && window.AIManager.lastRawResponse())
      || lastRawResponseStr
    )
  };
})();
