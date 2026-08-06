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
      { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B' },
      { id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1' },
      { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B' }
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
    const objective = options.objective || getObjective();
    const taskType = options.task || 'general';

    // Normalize messages argument to a guaranteed valid Array of message objects
    let messages;
    if (typeof promptOrMessages === 'string') {
      messages = [{ role: 'user', content: promptOrMessages }];
    } else if (Array.isArray(promptOrMessages)) {
      messages = promptOrMessages;
    } else if (promptOrMessages && typeof promptOrMessages === 'object'
               && !promptOrMessages.role
               && (promptOrMessages.system != null || promptOrMessages.user != null)) {
      // THE SHAPE BlvckPrompts.build() RETURNS. Without this branch a
      // {system, user} pair fell through to the generic object handler below,
      // which has no `role` or `content` to find and therefore sent
      // JSON.stringify({system, user}) as a single user message.
      //
      // Every generateJSON call in this app went out that way: the model
      // received a JSON blob and had to dig its instructions out of an
      // escaped string rather than being given a system prompt. Some models
      // coped, some returned `book` and `pencil` for a photosynthesis story
      // and put `thought` — a rel value — in the kind field.
      //
      // It is why removing the glyph list from the prompt changed nothing,
      // why raising the token budget changed nothing, and why the same story
      // gave different answers on different runs. The prompt was never the
      // problem; the prompt was never being sent as a prompt. Calling
      // chat(system + '\n\n' + user) by hand produced correct output all
      // along, which is what finally separated the two paths.
      messages = [];
      if (promptOrMessages.system) {
        messages.push({ role: 'system', content: String(promptOrMessages.system) });
      }
      messages.push({ role: 'user', content: String(promptOrMessages.user || '') });
    } else if (promptOrMessages && typeof promptOrMessages === 'object') {
      messages = [promptOrMessages];
    } else {
      messages = [{ role: 'user', content: String(promptOrMessages || '') }];
    }

    messages = messages.map(m => {
      if (typeof m === 'string') return { role: 'user', content: m };
      if (m && typeof m === 'object' && m.role && m.content) return m;
      if (m && typeof m === 'object') return { role: 'user', content: JSON.stringify(m) };
      return { role: 'user', content: String(m || '') };
    });

    // 1. Local-Only Mode
    if (objective === 'local_only' && window.LLMAdapters) {
      const localModel = options.model || 'qwen2.5';
      const text = await window.LLMAdapters.ollamaChat({ model: localModel, messages });
      recordModelUsed(taskType, localModel);
      return text;
    }

    const decision = await resolveChatModel(taskType);
    const userSel = getChatModel();
    let targetModel = options.model || decision.selectedModel;
    let fallbackModel = decision.fallbackModel;
    let lastNimError = null;

    const isOaActive = window.LLMAdapters && window.LLMAdapters.openaiOauthChat;
    const isOaTarget = options.provider === 'openai_oauth' ||
                       (userSel && (userSel.includes('chatgpt') || userSel.startsWith('gpt-') || userSel === 'openai_oauth')) ||
                       (targetModel && (targetModel.includes('chatgpt') || targetModel.startsWith('gpt-')));

    // 1.5 OpenAI OAuth Primary Execution (ChatGPT Account for ALL tasks across app)
    if (isOaActive && (isOaTarget || !window.ProviderManager?.getActiveKey('nim'))) {
      try {
        const oaModel = (targetModel && targetModel.startsWith('gpt-')) ? targetModel : 'gpt-5.4-mini';
        console.log(`[BlvckAI] Routing task [${taskType}] via OpenAI OAuth (ChatGPT Account) using [${oaModel}]`);
        const text = await window.LLMAdapters.openaiOauthChat({
          model: oaModel,
          messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.max_tokens || 1024,
          onChunk: options.onChunk
        });
        lastRawResponseStr = text;
        recordModelUsed(taskType, oaModel);
        return text;
      } catch (oaErr) {
        console.warn(`[BlvckAI] OpenAI OAuth task [${taskType}] failed, attempting fallback:`, oaErr.message);
      }
    }

    // 2. NVIDIA NIM Gateway Execution
    if (window.LLMAdapters && window.ProviderManager && window.ProviderManager.getActiveKey('nim')) {
      try {
        console.log(`[BlvckAI] Routing task [${taskType}] via NVIDIA NIM Free Gateway using model [${targetModel}]`);
        const text = await window.LLMAdapters.nvidiaNimChat({
          model: targetModel,
          messages,
          temperature: options.temperature || 0.7,
          max_tokens: options.max_tokens || 1024,
          onChunk: options.onChunk
        });
        lastRawResponseStr = text;
        recordModelUsed(taskType, targetModel);
        return text;
      } catch (e) {
        lastNimError = e.message;
        console.warn(`[BlvckAI] Model [${targetModel}] failed on NVIDIA NIM:`, e);

        // Fail over to OpenAI OAuth if available
        if (isOaActive) {
          try {
            console.warn('[BlvckAI] Failing over from NVIDIA NIM to OpenAI OAuth...');
            const text = await window.LLMAdapters.openaiOauthChat({
              model: 'gpt-5.4-mini',
              messages,
              temperature: options.temperature || 0.7,
              max_tokens: options.max_tokens || 1024,
              onChunk: options.onChunk
            });
            lastRawResponseStr = text;
            recordModelUsed(taskType, 'gpt-5.4-mini');
            return text;
          } catch (_) {}
        }
        // Automatic Failover to Free Fallback Model
        if (fallbackModel && fallbackModel !== targetModel) {
          try {
            console.warn(`[BlvckAI] ⚠ Automatically failing over to free model [${fallbackModel}] on NVIDIA NIM...`);
            window.dispatchEvent(new CustomEvent('blvck:model-failover', {
              detail: { failedModel: targetModel, activeModel: fallbackModel, reason: e.message }
            }));

            const text = await window.LLMAdapters.nvidiaNimChat({
              model: fallbackModel,
              messages,
              temperature: options.temperature || 0.7,
              max_tokens: options.max_tokens || 1024,
              onChunk: options.onChunk
            });
            lastRawResponseStr = text;
            recordModelUsed(taskType, fallbackModel);
            return text;
          } catch (err2) {
            lastNimError = err2.message;
            console.warn(`[BlvckAI] Fallback model [${fallbackModel}] also failed:`, err2);
          }
        }
      }
    }

    // 3. OpenRouter Fallback
    if (window.LLMAdapters && window.ProviderManager && window.ProviderManager.getActiveKey('openrouter')) {
      try {
        const text = await window.LLMAdapters.openRouterChat({ model: 'openai/gpt-4o-mini', messages });
        lastRawResponseStr = text;
        recordModelUsed(taskType, 'openai/gpt-4o-mini');
        return text;
      } catch (e) {}
    }

    // 4. Local Ollama Fallback
    if (window.LLMAdapters) {
      try {
        const text = await window.LLMAdapters.ollamaChat({ model: 'qwen2.5', messages });
        recordModelUsed(taskType, 'qwen2.5');
        return text;
      } catch (e) {}
    }

    // 5. Puter.js Free AI Fallback (Zero Config, No API Key Required)
    if (window.puter && window.puter.ai && typeof window.puter.ai.chat === 'function') {
      try {
        console.log('[BlvckAI] Routing chat request through Puter AI fallback...');
        const promptText = typeof promptOrMessages === 'string' ? promptOrMessages : (messages[messages.length - 1]?.content || '');
        const res = await window.puter.ai.chat(promptText);
        const replyText = typeof res === 'string' ? res : (res?.message?.content || res?.text || String(res));
        if (replyText) {
          lastRawResponseStr = replyText;
          recordModelUsed(taskType, 'puter-auto');
          return replyText;
        }
      } catch (puterErr) {
        console.warn('[BlvckAI] Puter AI fallback failed:', puterErr);
      }
    }

    throw new Error(lastNimError || 'AI Gateway request failed. Please check your API key in Settings or sign in to Puter.');
  }

  // Streaming Chat Wrapper
  async function chatStream(promptOrMessages, options = {}, onChunkCb = null) {
    const opts = typeof options === 'function' ? { onChunk: options } : (options || {});
    if (onChunkCb && typeof onChunkCb === 'function') {
      opts.onChunk = onChunkCb;
    }
    return await chat(promptOrMessages, opts);
  }

  // Generate JSON helper
  async function generateJSON(endpoint, payload, options = {}) {
    const prompt = typeof window.BlvckPrompts !== 'undefined' && window.BlvckPrompts.build
      ? window.BlvckPrompts.build(endpoint, payload)
      : `Return a valid JSON object for ${endpoint} given input: ${JSON.stringify(payload)}. Respond with pure JSON ONLY.`;

    const text = await chat(prompt, options);
    lastRawResponseStr = text;

    if (typeof window.BlvckPrompts !== 'undefined' && window.BlvckPrompts.parse) {
      try {
        // parse(endpoint, payload, rawText) — the PAYLOAD matters. Route
        // parsers need it to rejoin the model's answer to the input: a scene's
        // timestamp and subtitle come from payload.cues, not from anything the
        // model says.
        //
        // This was called as parse(endpoint, text), so payload received the raw
        // string and rawText was undefined. Every route parser then threw, the
        // empty catch swallowed it, and the generic JSON fallback below returned
        // unnormalised model output — silently, for every endpoint in the app.
        return window.BlvckPrompts.parse(endpoint, payload, text);
      } catch (err) {
        // Still fall back, but never in silence: losing normalisation is a
        // correctness failure, not a cosmetic one.
        console.warn(`[AI] Route parser for ${endpoint} failed; using raw JSON instead:`, err && err.message);
      }
    }

    const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
    let jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (_) {
        try {
          // Fix trailing commas and raw newlines
          let repaired = jsonMatch[0]
            .replace(/,\s*([\}\]])/g, '$1')
            .replace(/\r?\n/g, ' ');
          return JSON.parse(repaired);
        } catch (_) {}
      }
    }
    throw new Error('Failed parsing JSON from model output.');
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
    lastRawResponse: () => lastRawResponseStr
  };
})();
