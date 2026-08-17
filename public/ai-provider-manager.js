// AETHER AI Provider Manager
// Central unified AI abstraction. Routes all requests to Qwen (Primary) or NIM (Fallback).

(() => {
  'use strict';

  class AIProvider {
    async chat(messages, options = {}) { throw new Error('Not implemented'); }
    async chatStream(messages, options = {}, onChunk) { throw new Error('Not implemented'); }
    async generate(prompt, options = {}) { throw new Error('Not implemented'); }
    async generateJSON(endpoint, payload, options = {}) { throw new Error('Not implemented'); }
    async director(payload) { throw new Error('Not implemented'); }
  }

  class QwenProvider extends AIProvider {
    constructor() {
      super();
      this.baseUrl = '/api/proxy/qwen';
    }

    async checkHealth() {
      try {
        const res = await fetch(`${this.baseUrl}/health`, { method: 'GET' });
        if (res.ok) {
          const data = await res.json();
          return data.status === 'ok';
        }
      } catch (e) {
        console.warn('[QwenProvider] Health check failed:', e.message);
      }
      return false;
    }

    async _fetch(path, body) {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + (window.ProviderManager?.getActiveKey('qwen') || '')
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.text();
        throw new Error(`Qwen HTTP ${res.status}: ${err}`);
      }
      return res;
    }

    async chat(messages, options = {}) {
      const res = await this._fetch('/chat', {
        messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 1024,
        stream: false
      });
      const data = await res.json();
      return data.choices[0].message.content;
    }

    async chatStream(messages, options = {}, onChunk) {
      const res = await this._fetch('/chat', {
        messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 1024,
        stream: true
      });
      
      const reader = res.body.getReader();
      const decoder = new TextDecoder('utf-8');
      let fullText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.trim() === '') continue;
          if (line.trim() === 'data: [DONE]') continue;
          if (line.startsWith('data: ')) {
            try {
              const parsed = JSON.parse(line.substring(6));
              const delta = parsed.choices[0].delta.content || '';
              fullText += delta;
              if (onChunk) onChunk(delta);
            } catch (e) {}
          }
        }
      }
      return fullText;
    }

    async generate(prompt, options = {}) {
      const res = await this._fetch('/generate', {
        prompt,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 1024
      });
      const data = await res.json();
      return data.content;
    }

    async generateJSON(endpoint, payload, options = {}) {
      // Qwen /generate endpoint doesn't strictly enforce JSON schema unless requested,
      // but AETHER uses BlvckPrompts to prompt for JSON. We just call generate.
      const prompt = window.BlvckPrompts && window.BlvckPrompts.build
        ? window.BlvckPrompts.build(endpoint, payload)
        : `Return a valid JSON object for ${endpoint} given input: ${JSON.stringify(payload)}. Respond with pure JSON ONLY.`;
      
      const text = await this.generate(prompt, options);
      
      if (window.BlvckPrompts && window.BlvckPrompts.parse) {
        try { return window.BlvckPrompts.parse(endpoint, payload, text); }
        catch (e) { console.warn(`[QwenProvider] Route parser failed for ${endpoint}:`, e.message); }
      }
      
      const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); }
        catch (e) {
          let repaired = jsonMatch[0].replace(/,\s*([\}\]])/g, '$1').replace(/\r?\n/g, ' ');
          try { return JSON.parse(repaired); } catch (e2) {}
        }
      }
      throw new Error('Failed parsing JSON from Qwen output.');
    }

    async director(payload) {
      const res = await this._fetch('/director', payload);
      const data = await res.json();
      if (!data.success) throw new Error('Director failed: ' + JSON.stringify(data));
      return data.storyboard;
    }
  }

  class NvidiaNimProvider extends AIProvider {
    constructor() {
      super();
      this.model = 'meta/llama-3.3-70b-instruct';
    }

    async chat(messages, options = {}) {
      if (!window.LLMAdapters || !window.LLMAdapters.nvidiaNimChat) throw new Error('NIM adapter missing');
      return await window.LLMAdapters.nvidiaNimChat({
        model: this.model,
        messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 1024
      });
    }

    async chatStream(messages, options = {}, onChunk) {
      if (!window.LLMAdapters || !window.LLMAdapters.nvidiaNimChat) throw new Error('NIM adapter missing');
      return await window.LLMAdapters.nvidiaNimChat({
        model: this.model,
        messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 1024,
        onChunk
      });
    }

    async generate(prompt, options = {}) {
      return await this.chat([{ role: 'user', content: prompt }], options);
    }

    async generateJSON(endpoint, payload, options = {}) {
      const prompt = window.BlvckPrompts && window.BlvckPrompts.build
        ? window.BlvckPrompts.build(endpoint, payload)
        : `Return a valid JSON object for ${endpoint} given input: ${JSON.stringify(payload)}. Respond with pure JSON ONLY.`;
      
      const text = await this.generate(prompt, options);
      
      if (window.BlvckPrompts && window.BlvckPrompts.parse) {
        try { return window.BlvckPrompts.parse(endpoint, payload, text); }
        catch (e) { console.warn(`[NIMProvider] Route parser failed for ${endpoint}:`, e.message); }
      }
      
      const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/gi, '').trim();
      const jsonMatch = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
      if (jsonMatch) {
        try { return JSON.parse(jsonMatch[0]); }
        catch (e) {
          let repaired = jsonMatch[0].replace(/,\s*([\}\]])/g, '$1').replace(/\r?\n/g, ' ');
          try { return JSON.parse(repaired); } catch (e2) {}
        }
      }
      throw new Error('Failed parsing JSON from NIM output.');
    }

    async director(payload) {
      // NIM doesn't have a /director structured endpoint, so we fallback to generateJSON
      return await this.generateJSON('/api/video/plan', payload);
    }
  }

  class AIProviderManager {
    constructor() {
      this.qwen = new QwenProvider();
      this.nim = new NvidiaNimProvider();
      this.isQwenHealthy = null;
      this.lastHealthCheck = 0;
      this.HEALTH_TTL = 5000; // 5 seconds cache
      this.lastRawResponseStr = '';
    }

    async checkHealth() {
      const now = Date.now();
      if (this.isQwenHealthy !== null && (now - this.lastHealthCheck < this.HEALTH_TTL)) {
        return this.isQwenHealthy;
      }
      this.isQwenHealthy = await this.qwen.checkHealth();
      this.lastHealthCheck = now;
      this.updateUIStatus();
      return this.isQwenHealthy;
    }

    updateUIStatus() {
      // Update UI if elements exist
      const statusEls = document.querySelectorAll('.ai-provider-status, #mc-gateway-name, #gateway-status');
      statusEls.forEach(el => {
        if (this.isQwenHealthy) {
          el.innerHTML = '🟢 Qwen3.8-27B — Primary';
          el.title = 'Connected to Kaggle Qwen Director';
          el.style.color = '#10b981'; // Green
        } else {
          el.innerHTML = '🟡 NVIDIA NIM — Fallback';
          el.title = 'Qwen3.8-27B unavailable';
          el.style.color = '#fbbf24'; // Yellow
        }
      });
    }

    async getProvider() {
      const healthy = await this.checkHealth();
      if (healthy) return this.qwen;
      console.warn('[AIProviderManager] Qwen is offline or unreachable. Falling back to NVIDIA NIM.');
      return this.nim;
    }

    async chat(promptOrMessages, options = {}) {
      const provider = await this.getProvider();
      const messages = typeof promptOrMessages === 'string' ? [{ role: 'user', content: promptOrMessages }] : promptOrMessages;
      try {
        const res = await provider.chat(messages, options);
        this.lastRawResponseStr = res;
        return res;
      } catch (e) {
        if (provider === this.qwen) {
          console.warn('[AIProviderManager] Qwen request failed, falling back to NIM', e);
          this.isQwenHealthy = false;
          this.updateUIStatus();
          const res = await this.nim.chat(messages, options);
          this.lastRawResponseStr = res;
          return res;
        }
        throw e;
      }
    }

    async chatStream(promptOrMessages, options = {}, onChunk) {
      const provider = await this.getProvider();
      const messages = typeof promptOrMessages === 'string' ? [{ role: 'user', content: promptOrMessages }] : promptOrMessages;
      try {
        const res = await provider.chatStream(messages, options, onChunk);
        this.lastRawResponseStr = res;
        return res;
      } catch (e) {
        if (provider === this.qwen) {
          console.warn('[AIProviderManager] Qwen stream failed, falling back to NIM', e);
          this.isQwenHealthy = false;
          this.updateUIStatus();
          const res = await this.nim.chatStream(messages, options, onChunk);
          this.lastRawResponseStr = res;
          return res;
        }
        throw e;
      }
    }

    async generate(prompt, options = {}) {
      const provider = await this.getProvider();
      try {
        const res = await provider.generate(prompt, options);
        this.lastRawResponseStr = res;
        return res;
      } catch (e) {
        if (provider === this.qwen) {
          console.warn('[AIProviderManager] Qwen generate failed, falling back to NIM', e);
          this.isQwenHealthy = false;
          this.updateUIStatus();
          const res = await this.nim.generate(prompt, options);
          this.lastRawResponseStr = res;
          return res;
        }
        throw e;
      }
    }

    async generateJSON(endpoint, payload, options = {}) {
      const provider = await this.getProvider();
      // Optimization: if it's the director endpoint and Qwen is available, use /director natively
      if (endpoint === '/api/video/plan' && provider === this.qwen) {
        try {
          // Direct structured schema call
          const res = await provider.director(payload);
          return res;
        } catch (e) {
          console.warn('[AIProviderManager] Qwen /director failed, falling back to /generate', e);
          // fall through to normal generateJSON
        }
      }

      try {
        const res = await provider.generateJSON(endpoint, payload, options);
        return res;
      } catch (e) {
        if (provider === this.qwen) {
          console.warn('[AIProviderManager] Qwen generateJSON failed, falling back to NIM', e);
          this.isQwenHealthy = false;
          this.updateUIStatus();
          return await this.nim.generateJSON(endpoint, payload, options);
        }
        throw e;
      }
    }
    
    lastRawResponse() {
      return this.lastRawResponseStr;
    }
  }

  // Export singleton
  window.AIManager = new AIProviderManager();

  // On load, trigger a health check
  window.addEventListener('DOMContentLoaded', () => {
    window.AIManager.checkHealth();
  });

})();
