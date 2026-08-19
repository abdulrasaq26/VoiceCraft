// Dynamic Free-Endpoint Model Registry & Intelligence Router for Blvck-TTS v5.1
// Filters and prioritizes 100% Free Developer Tier Endpoints on NVIDIA Build (https://integrate.api.nvidia.com/v1)
(() => {
  'use strict';

  const registry = new Map(); // modelId -> modelObj
  let lastSyncTimestamp = null;

  // Curated 100% Free Developer Tier Models on NVIDIA Build Gateway
  const FREE_NVIDIA_MODELS = [
    { id: 'meta/llama-3.3-70b-instruct', name: 'Llama 3.3 70B (Free Tier)', type: 'creative' },
    { id: 'deepseek-ai/deepseek-r1', name: 'DeepSeek R1 (Free Tier)', type: 'reasoning' },
    { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B (Free Tier)', type: 'agent' },
    { id: 'mistralai/mistral-large-2-instruct', name: 'Mistral Large 2 (Free Tier)', type: 'analysis' },
    { id: 'qwen/qwen2.5-coder-32b-instruct', name: 'Qwen 2.5 Coder (Free Tier)', type: 'coding' },
    { id: 'google/gemma-2-27b-it', name: 'Gemma 2 27B (Free Tier)', type: 'general' }
  ];

  const TASK_RULES = {
    research:     { primaryPattern: /deepseek.*r1|r1/i, fallbackPattern: /llama-3\.3-70b|mistral/i, type: 'reasoning', reason: 'Highest reasoning score on NVIDIA Free Tier for research.' },
    fact_check:   { primaryPattern: /deepseek.*r1|r1/i, fallbackPattern: /llama-3\.3-70b/i, type: 'reasoning', reason: 'DeepSeek-R1 free reasoning verification.' },
    script:       { primaryPattern: /llama-3\.3-70b/i, fallbackPattern: /deepseek.*v3|nemotron/i, type: 'creative', reason: 'Llama 3.3 70B free endpoint for long-form narrative.' },
    code:         { primaryPattern: /deepseek.*r1|coder|qwen/i, fallbackPattern: /llama-3\.3-70b/i, type: 'coding', reason: 'Free DeepSeek-R1 / Qwen Coder endpoint for code.' },
    agent:        { primaryPattern: /nemotron/i, fallbackPattern: /llama-3\.3-70b/i, type: 'agent', reason: 'Nemotron 70B free endpoint for agent workflows.' },
    brainstorm:   { primaryPattern: /qwen|gemma/i, fallbackPattern: /llama-3\.3-70b/i, type: 'creative', reason: 'Free Qwen / Gemma endpoint for rapid brainstorming.' },
    general:      { primaryPattern: /llama-3\.3-70b/i, fallbackPattern: /nemotron|deepseek/i, type: 'general', reason: 'Balanced free general intelligence endpoint.' }
  };

  function classifyModel(id) {
    if (/r1|reason/i.test(id)) return 'reasoning';
    if (/nemotron/i.test(id)) return 'agent';
    if (/qwen/i.test(id)) return 'coding';
    if (/llama-3\.3-70b/i.test(id)) return 'scripting';
    if (/mistral/i.test(id)) return 'analysis';
    return 'general';
  }

  function registerModel(raw, provider = 'nvidia') {
    const id = typeof raw === 'string' ? raw : raw.id;
    if (!id) return;

    const def = {
      id,
      name: raw.name || id,
      provider: provider || 'nvidia',
      type: classifyModel(id),
      isFree: true,
      contextWindow: raw.contextWindow || 128000,
      supportsReasoning: /r1|reason/i.test(id)
    };

    registry.set(id, def);
    return def;
  }

  // Populate curated free models by default
  function initFreeCatalog() {
    FREE_NVIDIA_MODELS.forEach(m => registerModel(m, 'nvidia'));
  }
  initFreeCatalog();

  // Dynamic Discovery via GET /v1/models (NVIDIA NIM Gateway)
  async function fetchNimModels(apiKey) {
    const key = apiKey || (window.ProviderManager ? window.ProviderManager.getActiveKey('nim') : '');
    if (!key) return Array.from(registry.values());

    try {
      // Same reason as everywhere else: a browser cannot reach
      // integrate.api.nvidia.com directly, so this call has never succeeded
      // from the page — it failed as a NetworkError and left the model list
      // empty, which is why the NIM dropdown never populated and Refresh
      // appeared to do nothing.
      const res = await fetch('/api/proxy/nvidia/v1/models', {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${key}`,
          'Accept': 'application/json'
        }
      });

      if (res.ok) {
        const json = await res.json();
        const list = json.data || json.models || [];

        for (const item of list) {
          if (item && item.id) {
            registerModel(item, 'nvidia');
          }
        }
        lastSyncTimestamp = new Date().toLocaleTimeString();
      }
    } catch (e) {
      console.warn('[ModelRegistry] Network warning fetching NIM models, using Free catalog:', e);
    }

    window.dispatchEvent(new CustomEvent('blvck:models-updated'));
    return Array.from(registry.values());
  }

  // Dynamic Discovery via GET /v1/models (OpenAI OAuth local proxy)
  async function fetchOpenAiOauthModels() {
    const PM = window.ProviderManager;
    const ep = (PM && PM.getPoolState('openai_oauth')?.endpoint) || 'http://127.0.0.1:10531/v1';
    try {
      const res = await fetch('/api/proxy/openai-oauth/models', {
        method: 'GET',
        headers: { 'x-openai-oauth-endpoint': ep },
        signal: AbortSignal.timeout(3000)
      });
      if (res.ok) {
        const json = await res.json();
        const list = json.data || json.models || [];
        for (const item of list) {
          if (item && item.id) {
            registerModel({ id: item.id, name: `${item.id} (ChatGPT Account)` }, 'openai_oauth');
          }
        }
      }
    } catch (_) {}
  }

  async function syncAllGateways() {
    const PM = window.ProviderManager;
    const nimKey = PM ? PM.getActiveKey('nim') : null;
    await Promise.allSettled([fetchNimModels(nimKey), fetchOpenAiOauthModels()]);
    return Array.from(registry.values());
  }

  function selectModelForTask(taskType = 'general') {
    const allModels = Array.from(registry.values());
    const rule = TASK_RULES[taskType] || TASK_RULES.general;

    let primary = allModels.find(m => rule.primaryPattern.test(m.id));
    let fallback = allModels.find(m => rule.fallbackPattern.test(m.id));

    if (!primary) primary = FREE_NVIDIA_MODELS[0];
    if (!fallback) fallback = FREE_NVIDIA_MODELS[1];

    let reason = rule.reason;

    // Channel Brain: once this channel has logged enough real performance
    // data for this task (see brain.js modelBias — requires >=2 comparably
    // sampled models before it returns anything), prefer a model that has
    // actually correlated with better results over the static pattern pick.
    // Bounded: only promotes a model this Puter/NIM instance currently
    // offers, and only when it's rated better than average — never
    // discards the pattern pick, just demotes it to fallback.
    if (window.BlvckBrain && typeof window.BlvckBrain.modelBias === 'function') {
      try {
        const bias = window.BlvckBrain.modelBias(taskType) || {};
        const learnedBest = Object.keys(bias).sort((a, b) => bias[b] - bias[a])[0];
        if (learnedBest && bias[learnedBest] > 0 && learnedBest !== primary.id) {
          const learnedModel = allModels.find(m => m.id === learnedBest);
          if (learnedModel) {
            fallback = primary;
            primary = learnedModel;
            reason = `Channel history shows this model performs better for ${taskType} (learned from logged results).`;
          }
        }
      } catch (_) { /* no learned signal yet */ }
    }

    return {
      selectedModel: primary.id,
      fallbackModel: fallback.id,
      reason,
      taskType
    };
  }

  window.ModelRegistry = {
    registerModel,
    fetchNimModels,
    syncAllGateways,
    getDiscoveredModels: () => Array.from(registry.values()),
    selectModelForTask,
    lastSyncTime: () => lastSyncTimestamp || 'Free Tier Catalog Active'
  };
})();
