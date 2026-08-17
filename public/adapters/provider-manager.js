// Provider Manager & Multi-Key Pool System for Blvck-TTS v5.1
// Manages key pools, auto-failover on rate limits/quotas, exhaustion tracking, and health status
(() => {
  'use strict';

  const STORAGE_KEYS_PREFIX = 'blvck:keys_';

  const pools = {
    nim: { keys: [], activeIndex: 0, exhausted: new Set(), status: 'healthy', logs: [] },
    openrouter: { keys: [], activeIndex: 0, exhausted: new Set(), status: 'healthy', logs: [] },
    ollama: { endpoint: 'http://localhost:11434', status: 'unknown' },
    openai_oauth: { endpoint: 'http://127.0.0.1:10531/v1', status: 'unknown' },
    openai: { keys: [], activeIndex: 0, exhausted: new Set(), status: 'healthy', logs: [] },
    deepseek: { keys: [], activeIndex: 0, exhausted: new Set(), status: 'healthy', logs: [] },
    elevenlabs: { keys: [], activeIndex: 0, exhausted: new Set(), status: 'healthy', logs: [] },
    fishaudio: { endpoint: '', status: 'unknown' },
    kokoro: { endpoint: 'http://localhost:8880', status: 'unknown' },
    sd: { endpoint: 'http://localhost:1420', status: 'unknown' },
    fal: { keys: [], activeIndex: 0, exhausted: new Set(), status: 'healthy', logs: [] },
    cloudflare_worker: { endpoint: '', key: '', status: 'unknown' },
    replicate: { keys: [], activeIndex: 0, exhausted: new Set(), status: 'healthy', logs: [] },
    runway: { keys: [], activeIndex: 0, exhausted: new Set(), status: 'healthy', logs: [] },
    luma: { keys: [], activeIndex: 0, exhausted: new Set(), status: 'healthy', logs: [] },
    pixabay: { keys: [], activeIndex: 0, exhausted: new Set(), status: 'healthy', logs: [] },
    pexels: { keys: [], activeIndex: 0, exhausted: new Set(), status: 'healthy', logs: [] }
  };

  function loadKeys() {
    Object.keys(pools).forEach(provider => {
      try {
        const raw = localStorage.getItem(`${STORAGE_KEYS_PREFIX}${provider}`);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) {
            pools[provider].keys = parsed;
          } else if (typeof parsed === 'string') {
            pools[provider].endpoint = parsed;
          }
        }
      } catch (e) {
        console.warn(`[ProviderManager] Error loading keys for ${provider}:`, e);
      }
    });
  }

  function saveKeys(provider) {
    try {
      let data = pools[provider].keys || pools[provider].endpoint;
      // If it's a provider that primarily relies on endpoints without keys arrays, force endpoint
      if (['fishaudio', 'kokoro', 'sd'].includes(provider)) {
         data = pools[provider].endpoint || '';
      }
      localStorage.setItem(`${STORAGE_KEYS_PREFIX}${provider}`, JSON.stringify(data));
    } catch (e) {
      console.warn(`[ProviderManager] Error saving keys for ${provider}:`, e);
    }
  }

  loadKeys();

  function getActiveKey(provider) {
    const p = pools[provider];
    if (!p || !p.keys || p.keys.length === 0) return '';

    // Find first non-exhausted key starting from activeIndex
    for (let i = 0; i < p.keys.length; i++) {
      const idx = (p.activeIndex + i) % p.keys.length;
      if (!p.exhausted.has(idx)) {
        p.activeIndex = idx;
        return p.keys[idx];
      }
    }
    // If all are exhausted, reset exhaustion and return primary
    p.exhausted.clear();
    p.activeIndex = 0;
    return p.keys[0] || '';
  }

  function getPoolKeyStates(provider) {
    const p = pools[provider];
    if (!p || !p.keys) return [];

    return p.keys.map((k, idx) => {
      let state = 'available';
      let symbol = '🟢';
      let label = 'Available';

      if (idx === p.activeIndex && !p.exhausted.has(idx)) {
        state = 'active';
        symbol = '🟢';
        label = 'Active';
      } else if (p.exhausted.has(idx)) {
        state = 'exhausted';
        symbol = '🔴';
        label = 'Exhausted';
      }

      return {
        key: k,
        masked: k.length > 8 ? `${k.slice(0, 6)}...${k.slice(-4)}` : k,
        index: idx,
        state,
        symbol,
        label
      };
    });
  }

  function setKeys(provider, keysArray) {
    if (pools[provider]) {
      let parsed = [];
      for (const k of keysArray) {
        if (typeof k === 'string') parsed.push(...k.split(/[\n,]+/));
        else parsed.push(k);
      }
      pools[provider].keys = parsed.map(k => k.trim()).filter(Boolean);
      pools[provider].activeIndex = 0;
      pools[provider].exhausted.clear();
      pools[provider].status = pools[provider].keys.length > 0 ? 'healthy' : 'unconfigured';
      saveKeys(provider);

      // Trigger dynamic model discovery if NIM or OpenRouter keys updated
      if (window.ModelRegistry) {
        window.ModelRegistry.syncAllGateways();
      }
    }
  }

  function setEndpoint(provider, endpointUrl) {
    if (pools[provider]) {
      pools[provider].endpoint = endpointUrl.trim();
      saveKeys(provider);
    }
  }

  function handleKeyError(provider, errorMsg, failedKey = null) {
    const p = pools[provider];
    if (!p || !p.keys || p.keys.length === 0) return;

    let failedIndex = p.activeIndex;
    if (failedKey) {
      const idx = p.keys.indexOf(failedKey);
      if (idx !== -1) failedIndex = idx;
    }

    // If this key is already marked exhausted by a concurrent request, just return
    if (p.exhausted.has(failedIndex)) return;

    p.exhausted.add(failedIndex);

    const timestamp = new Date().toLocaleTimeString();
    p.logs.unshift(`[${timestamp}] Key #${failedIndex + 1} marked exhausted: ${errorMsg}`);
    if (p.logs.length > 20) p.logs.pop();

    // Only advance activeIndex if it's currently pointing to the newly exhausted key
    if (p.activeIndex === failedIndex) {
      let nextIndex = p.activeIndex;
      let found = false;
      for (let i = 0; i < p.keys.length; i++) {
        nextIndex = (nextIndex + 1) % p.keys.length;
        if (!p.exhausted.has(nextIndex)) {
          p.activeIndex = nextIndex;
          found = true;
          break;
        }
      }
      if (found) {
        console.warn(`[ProviderManager] Failover triggered for ${provider}. Switched to Key #${p.activeIndex + 1}`);
      } else {
        console.error(`[ProviderManager] ALL keys for ${provider} are now exhausted!`);
      }
    }

    window.dispatchEvent(new CustomEvent('blvck:provider-status-changed', { detail: { provider, pool: p } }));
  }

  function getPoolState(provider) {
    return pools[provider] || null;
  }

  function getAllPools() {
    return pools;
  }

  window.ProviderManager = {
    getActiveKey,
    getPoolKeyStates,
    setKeys,
    setEndpoint,
    handleKeyError,
    getPoolState,
    getAllPools
  };
})();
