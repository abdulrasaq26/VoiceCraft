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

  // How hard Qwen should think, per kind of work. Reasoning is what this
  // model is for, but it generates at roughly ten tokens a second, so an
  // xhigh deliberation is minutes before the answer starts. Spend it where
  // being right matters and skip it where it does not.
  const REASONING_BY_TASK = {
    storyboard: 'xhigh',   // every beat of the video hangs on these choices
    research:   'xhigh',
    factcheck:  'xhigh',
    script:     'xhigh',
    director:   'xhigh',
    seo:        'medium',
    thumbnail:  'medium',
    titles:     'low',     // a headline is not worth two minutes of thought
    chat:       'medium',
    general:    'medium'
  };

  function effortFor(options) {
    if (options && options.reasoningEffort) return options.reasoningEffort;
    return REASONING_BY_TASK[String((options && options.task) || 'general')] || 'medium';
  }

  class QwenProvider extends AIProvider {
    constructor() {
      super();
      this.baseUrl = '/api/proxy/qwen';
    }

    // The endpoint and key configured in Settings, forwarded as headers the
    // node proxy understands. An Authorization header would not survive the
    // hop — the proxy rebuilds the outgoing headers and only carries these
    // two — and the tunnel address changes every Kaggle session, so it cannot
    // live in .env either.
    _headers(extra) {
      const pool = (window.ProviderManager && window.ProviderManager.getPoolState('qwen')) || {};
      const headers = Object.assign({}, extra);
      if (pool.endpoint) headers['x-qwen-endpoint'] = pool.endpoint;
      if (pool.key) headers['x-qwen-key'] = pool.key;
      return headers;
    }

    async checkHealth() {
      try {
        const res = await fetch(`${this.baseUrl}/health`, {
          method: 'GET',
          headers: this._headers()
        });
        if (res.ok) {
          const data = await res.json();
          return data.status === 'ok';
        }
      } catch (e) {
        console.warn('[QwenProvider] Health check failed:', e.message);
      }
      return false;
    }

    _directorFetch(body) {
      return this._fetch('/director', body);
    }

    async _fetch(path, body) {
      const res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: this._headers({ 'Content-Type': 'application/json' }),
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
        max_tokens: options.max_tokens || 4096,
        reasoning_effort: effortFor(options),
        stream: false
      });
      const data = await res.json();
      return data.choices[0].message.content;
    }

    async chatStream(messages, options = {}, onChunk) {
      const res = await this._fetch('/chat', {
        messages,
        temperature: options.temperature || 0.7,
        max_tokens: options.max_tokens || 4096,
        reasoning_effort: effortFor(options),
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
        max_tokens: options.max_tokens || 4096,
        reasoning_effort: effortFor(options)
      });
      const data = await res.json();
      return data.content;
    }

    async generateJSON(endpoint, payload, options = {}) {
      // Qwen /generate endpoint doesn't strictly enforce JSON schema unless requested,
      // but AETHER uses BlvckPrompts to prompt for JSON. We just call generate.
      const built = window.BlvckPrompts && window.BlvckPrompts.build
        ? window.BlvckPrompts.build(endpoint, payload)
        : `Return a valid JSON object for ${endpoint} given input: ${JSON.stringify(payload)}. Respond with pure JSON ONLY.`;

      // build() returns { system, user } for most routes and a bare string for
      // the rest. generate() takes a string, so the object arrived as one and
      // was rejected before the model was ever reached:
      //
      //   422 {"loc":["body","prompt"],"msg":"Input should be a valid string"}
      //
      // This is the path the app drops to when /director is unavailable, so it
      // failing meant there was no fallback at all — and it surfaced as the
      // NEXT provider being missing, which reads like a configuration problem
      // rather than a bug here.
      const prompt = typeof built === 'string'
        ? built
        : [built.system, built.user].filter(Boolean).join('\n\n');

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

    // The /director endpoint speaks a narrower language than the app does: a
    // script, a style, and the beats to plan against. Posting the raw
    // storyboard payload here used to fail schema validation before the model
    // was ever reached, so translate it first.
    /**
     * How many beats to ask for in one request.
     *
     * The tunnel cuts any single request at 300s, and the Director costs
     * roughly 50-70s fixed plus 80-100s per beat — measured live: one beat
     * returned in 150.0s, three beats exceeded the ceiling at both low and
     * xhigh effort. So this is not a tuning knob, it is the difference between
     * a plan arriving and a gateway error.
     *
     * One is the safe default. Two is usually fine and halves the fixed cost;
     * three does not fit. Raise it only against a tunnel without the limit.
     */
    planBatchSize() {
      try {
        const stored = Number(localStorage.getItem('blvck:director_batch') || 0);
        return stored > 0 ? Math.min(8, stored) : 1;
      } catch (e) {
        return 1;   // no storage (tests, workers) — the safe default is the default
      }
    }

    async director(payload, options = {}) {
      const all = Array.isArray(payload && payload.scenes) ? payload.scenes : [];
      const size = this.planBatchSize();
      if (all.length <= size) return this._directorBatch(payload, options, all);

      // Plan in batches, but show the model the WHOLE script every time. It
      // still decides each beat knowing what comes before and after; only the
      // number of beats it has to write per request comes down.
      const merged = { strategy: '', warnings: [], scenes: [] };
      for (let at = 0; at < all.length; at += size) {
        const chunk = all.slice(at, at + size);
        try {
          window.dispatchEvent(new CustomEvent('blvck:director-progress', {
            detail: { done: at, total: all.length, planning: chunk.map((s) => s.index) }
          }));
        } catch (e) { /* non-fatal */ }

        const part = await this._directorBatch(payload, options, chunk);
        if (!merged.strategy && part.strategy) merged.strategy = part.strategy;
        // strategy and warnings describe the whole video, and every batch sees
        // the whole script — so each one reports them again. Keep the first
        // strategy and one copy of each warning; three identical continuity
        // notes read as three problems.
        for (const w of part.warnings || []) {
          if (merged.warnings.indexOf(w) === -1) merged.warnings.push(w);
        }
        // A batch owns exactly the beats it was asked for. The model sees the
        // whole script, so it can and does return plans for beats outside the
        // chunk; merging those wholesale duplicates every beat once per batch.
        const asked = new Set(chunk.map((s, i) => (Number.isFinite(s && s.index) ? s.index : at + i)));
        const seen = new Set(merged.scenes.map((s) => s.index));
        for (const s of part.scenes || []) {
          if (asked.has(s.index) && !seen.has(s.index)) merged.scenes.push(s);
        }
      }
      try {
        window.dispatchEvent(new CustomEvent('blvck:director-progress', {
          detail: { done: all.length, total: all.length, planning: [] }
        }));
      } catch (e) { /* non-fatal */ }
      return merged;
    }

    async _directorBatch(payload, options = {}, only = null) {
      const scenes = only || (Array.isArray(payload && payload.scenes) ? payload.scenes : []);
      const bible  = (payload && payload.bible) || {};

      const cues = scenes.map((s, i) => ({
        index: Number.isFinite(s && s.index) ? s.index : i,
        start: s && s.timestamp,
        text:  String((s && (s.subtitle || s.sceneSummary)) || '')
      }));

      // The script is always the WHOLE piece, even when only some beats are
      // being planned. A beat decided in isolation loses the thing that makes
      // the decision good — "decades later" only means anything next to the
      // sentence before it.
      const everyScene = Array.isArray(payload && payload.scenes) ? payload.scenes : scenes;
      const script = everyScene
        .map((s) => String((s && (s.subtitle || s.sceneSummary)) || ''))
        .filter(Boolean)
        .join('\n');
      if (!script) throw new Error('Director: no narration to plan against.');

      // Visual Intelligence and the channel mode each decide part of the look.
      // They travel as a brief rather than as a style word because the model
      // needs the reasoning, not just the label.
      const brief = [payload && payload.strategyBrief, payload && payload.modeBrief]
        .map((b) => String(b || '').trim())
        .filter(Boolean)
        .join('\n\n');

      // Collect our own work rather than starting again elsewhere.
      //
      // The tunnel cuts any request at 300s and a beat can take longer, so the
      // first attempt is often killed by the gateway while the GPU carries on.
      // The server holds that generation and joins an identical request to it —
      // but only if one arrives, and previously none did: the client fell
      // through to /generate and then to NIM, discarding a plan that was still
      // being made. Measured: 604s spent, then "NIM API key is missing".
      //
      // So a gateway failure is retried with the same body. The retry joins,
      // waits, and returns the first attempt's result. No second generation.
      const gatewayCut = (e) => /HTTP 50[234]|gateway|timed out|socket hang up|fetch failed/i
        .test(String((e && e.message) || ''));

      let res = null;
      for (let attempt = 1; attempt <= 4 && !res; attempt++) {
        try {
          res = await this._directorFetch({
            script,
            title: String(bible.title || 'Untitled'),
            style: String(bible.visualStyle || bible.style || 'documentary'),
            cues,
            brief,
            max_tokens: Math.min(16384, 1200 + cues.length * 320),
            // The unconstrained thinking pass. The grammar forces the first
            // token to be a brace, so this is the only place the director gets
            // to reason about the video at all.
            reasoning_effort: effortFor(Object.assign({ task: 'storyboard' }, options))
          });
        } catch (e) {
          if (attempt >= 4 || !gatewayCut(e)) throw e;
          console.warn(`[QwenProvider] the gateway cut the plan request (${e.message}); `
            + `asking again to join the generation already running (attempt ${attempt + 1}/4)`);
          await new Promise((r) => setTimeout(r, 4000));
        }
      }

      const data = await res.json();
      if (!data || data.success === false) {
        throw new Error('Director failed: ' + JSON.stringify(data).slice(0, 300));
      }

      // Hand the answer to the same parser the fallback path uses. The grammar
      // already constrains the model to this shape, but routing both paths
      // through parseVideoPlan means one definition of a valid plan, not two.
      const plan = data.plan || data;
      if (window.BlvckPrompts && window.BlvckPrompts.parse) {
        return window.BlvckPrompts.parse('/api/video/plan', payload, JSON.stringify(plan));
      }
      return plan;
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
      const built = window.BlvckPrompts && window.BlvckPrompts.build
        ? window.BlvckPrompts.build(endpoint, payload)
        : `Return a valid JSON object for ${endpoint} given input: ${JSON.stringify(payload)}. Respond with pure JSON ONLY.`;

      // build() returns { system, user } for most routes and a bare string for
      // the rest. generate() takes a string, so the object arrived as one and
      // was rejected before the model was ever reached:
      //
      //   422 {"loc":["body","prompt"],"msg":"Input should be a valid string"}
      //
      // This is the path the app drops to when /director is unavailable, so it
      // failing meant there was no fallback at all — and it surfaced as the
      // NEXT provider being missing, which reads like a configuration problem
      // rather than a bug here.
      const prompt = typeof built === 'string'
        ? built
        : [built.system, built.user].filter(Boolean).join('\n\n');

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

    // The single writer of the provider badge. Everything that displays which
    // provider is live reads from here, so there is one answer rather than a
    // race between two components with different ideas.
    updateUIStatus() {
      const statusEls = document.querySelectorAll('.ai-provider-status, #mc-gateway-name, #gateway-status');
      statusEls.forEach(el => {
        if (this.isQwenHealthy === true) {
          el.innerHTML = '🟢 Qwen3.8-27B — Primary';
          el.title = 'Connected to the Kaggle Qwen Director';
          el.style.color = '#10b981';
        } else if (this.isQwenHealthy === false) {
          el.innerHTML = '🟡 NVIDIA NIM — Fallback';
          el.title = 'Qwen3.8-27B is unreachable';
          el.style.color = '#fbbf24';
        } else {
          // Null means nothing has asked yet. Reporting a fallback here would
          // claim Qwen had failed when it has not been tried.
          el.innerHTML = '○ Checking…';
          el.title = 'Checking which provider is available';
          el.style.color = '';
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
          // Options travel with it. They were dropped here, so every caller got
          // the task default no matter what it asked for — and reasoning effort
          // is the single biggest lever on how long a plan takes, which matters
          // because the tunnel cuts any request at 300s.
          const res = await provider.director(payload, options);
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
