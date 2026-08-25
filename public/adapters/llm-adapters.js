// Modular LLM Provider Adapters for Blvck-TTS v5.1
// Proxies NVIDIA NIM Gateway requests through server.js to bypass browser CORS / NetworkError
(() => {

  // Every request in this file is a chat completion over the network, and one
  // that is never answered hangs its caller forever — the failure mode that
  // left the Storyboard sitting at 0%. NIM sets its own budget from measured
  // latency; this is the floor for the rest.
  const DEFAULT_REQUEST_TIMEOUT_MS = 240000;
  const requestSignal = () => AbortSignal.timeout(DEFAULT_REQUEST_TIMEOUT_MS);

  'use strict';

  // NVIDIA NIM Gateway Infrastructure Client
  async function nvidiaNimChat({ model, messages, temperature = 0.7, max_tokens = 1024, onChunk }) {
    const key = window.ProviderManager.getActiveKey('nim');
    // Try local proxy first (prevents CORS NetworkError), fallback to direct API
    const proxyEndpoint = '/api/proxy/nvidia/v1/chat/completions';
    const directEndpoint = 'https://integrate.api.nvidia.com/v1/chat/completions';

    // NIM's own budget, deliberately unrelated to Qwen's.
    //
    // The two providers fail in opposite ways and must not share a number.
    // Qwen reasons for minutes and a plan legitimately takes 150-300s, so a
    // short timeout there would abandon healthy work — it has its own handling,
    // including a retry that joins the generation already running. NIM answers
    // a request like this in 20-45s when it is healthy; measured across three
    // identical calls it returned in 42s and 20s and, once, never answered at
    // all. Without a bound that third case hangs the run: nothing fails, so
    // nothing falls back, and the Storyboard waits forever.
    //
    // Streaming gets longer, because the budget covers the whole response.
    // Measured through this proxy: 20-44s for a trivial request, and the app's
    // real prompts are several times larger. 90s was inside that range and
    // would have aborted legitimate work; 240s only ends a request that is
    // genuinely not coming back.
    const NIM_TIMEOUT_MS = (typeof onChunk === 'function') ? 300000 : 240000;
    const withBudget = (init) => Object.assign({}, init, {
      signal: AbortSignal.timeout(NIM_TIMEOUT_MS)
    });
    const timedOut = (e) => e && (e.name === 'TimeoutError' || e.name === 'AbortError');

    if (!key) {
      throw new Error('NVIDIA NIM API Key is missing. Please enter your nvapi-... key in Settings.');
    }

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`
    };

    const targetModel = model || (window.ModelRegistry ? window.ModelRegistry.selectModelForTask('general').selectedModel : 'meta/llama-3.3-70b-instruct');

    const body = {
      model: targetModel,
      messages,
      temperature,
      max_tokens,
      stream: typeof onChunk === 'function'
    };

    let res;
    try {
      res = await fetch(proxyEndpoint, withBudget({
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      }));
    } catch (e) {
      // A timeout is not a reason to try the direct endpoint: a browser cannot
      // reach integrate.api.nvidia.com at all — no CORS headers for a page
      // origin — so that attempt fails as a NetworkError and replaces a clear
      // "took too long" with a misleading one.
      if (timedOut(e)) {
        const err = new Error(
          `NVIDIA NIM did not respond within ${Math.round(NIM_TIMEOUT_MS / 1000)}s. `
          + 'The service is slow or unavailable right now.'
        );
        // Marked, so a caller can tell "too slow this time" from "wrong
        // answer". Measured against the live service, the same batch came back
        // in 60s and 83s while a two-token request took 26s - almost all of it
        // queueing. A bound that trips on a spike like that is worth one more
        // ask; a malformed reply is not.
        err.category = 'timeout';
        err.transient = true;
        throw err;
      }
      console.warn('[NVIDIA NIM] Local proxy failed, attempting direct fetch:', e);
      res = await fetch(directEndpoint, withBudget({
        method: 'POST',
        headers,
        body: JSON.stringify(body)
      }));
    }

    // A response body can only be read once, and this path read it twice.
    //
    // On a 429 with no second key to rotate to, the body was consumed here for
    // the key-error message and then consumed AGAIN below to build the thrown
    // error — so what the caller received was "Failed to execute 'text' on
    // 'Response': body stream already read" instead of the rate limit that
    // actually happened. Rate limits are the most common failure this endpoint
    // has, and every one of them arrived wearing that disguise. Measured: a
    // Composer call died with exactly that message mid-run.
    let alreadyRead = null;
    if (res.status === 429 || res.status === 401 || res.status === 403) {
      alreadyRead = await res.text();
      window.ProviderManager.handleKeyError('nim', `HTTP ${res.status}: ${alreadyRead}`);
      const nextKey = window.ProviderManager.getActiveKey('nim');
      if (nextKey && nextKey !== key) {
        headers['Authorization'] = `Bearer ${nextKey}`;
        res = await fetch(proxyEndpoint, withBudget({ method: 'POST', headers, body: JSON.stringify(body) }));
        alreadyRead = null;   // a fresh response, with a body of its own
      }
    }

    if (!res.ok) {
      const err = alreadyRead !== null ? alreadyRead : await res.text();
      throw new Error(`NVIDIA NIM Error (${res.status}): ${err}`);
    }

    if (typeof onChunk === 'function' && res.body) {
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
          const trimmed = line.trim();
          if (!trimmed || trimmed === 'data: [DONE]') continue;
          if (trimmed.startsWith('data: ')) {
            try {
              const json = JSON.parse(trimmed.slice(6));
              const delta = json.choices?.[0]?.delta?.content || '';
              if (delta) {
                fullText += delta;
                onChunk(delta, fullText);
              }
            } catch (e) {}
          }
        }
      }
      return fullText;
    } else {
      const json = await res.json();
      // Why the model stopped, kept where the caller can ask.
      //
      // It was discarded, and it is the difference between "the model wrote
      // something unparseable" and "the model was cut off mid-sentence because
      // the token budget ran out". Those need opposite fixes, and without this
      // both arrive as "Failed parsing JSON from NIM output."
      const choice = (json.choices && json.choices[0]) || {};
      window.LLMAdapters._lastNimFinish = choice.finish_reason || '';
      window.LLMAdapters._lastNimUsage = json.usage || null;
      return (choice.message && choice.message.content) || '';
    }
  }

  // OpenRouter Gateway Adapter
  async function openRouterChat({ model, messages, temperature = 0.7, max_tokens, onChunk }) {
    const key = window.ProviderManager.getActiveKey('openrouter');
    const endpoint = 'https://openrouter.ai/api/v1';

    if (!key) throw new Error('OpenRouter API Key is missing.');

    const headers = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${key}`,
      'HTTP-Referer': window.location.origin,
      'X-Title': 'Blvck-TTS'
    };

    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers,
      signal: requestSignal(),
      body: JSON.stringify({
        model: model || 'openai/gpt-4o-mini',
        messages,
        temperature,
        max_tokens
      })
    });

    if (!res.ok) {
      const err = await res.text();
      window.ProviderManager.handleKeyError('openrouter', `HTTP ${res.status}: ${err}`);
      throw new Error(`OpenRouter Error (${res.status}): ${err}`);
    }

    const json = await res.json();
    return json.choices?.[0]?.message?.content || '';
  }

  // Ollama Local Adapter
  async function ollamaChat({ model = 'qwen2.5', messages, temperature = 0.7 }) {
    const endpoint = 'http://localhost:11434/v1';
    const res = await fetch(`${endpoint}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: requestSignal(),
      body: JSON.stringify({
        model: model || 'qwen2.5',
        messages,
        temperature
      })
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Ollama Local Error (${res.status}): ${err}`);
    }

    const json = await res.json();
    return json.choices?.[0]?.message?.content || '';
  }

  // OpenAI OAuth Proxy Adapter (ChatGPT Free/Plus Account via npx openai-oauth)
  async function openaiOauthChat({ model = 'gpt-4o', messages, temperature = 0.7, max_tokens = 1024, onChunk }) {
    const PM = window.ProviderManager;
    const ep = (PM && PM.getPoolState('openai_oauth')?.endpoint) || 'http://127.0.0.1:10531/v1';
    const origin = (typeof window !== 'undefined' && window.location && window.location.origin) ? window.location.origin : 'http://localhost:3000';
    const proxyEndpoint = `${origin}/api/proxy/openai-oauth/chat/completions`;
    const headers = {
      'Content-Type': 'application/json',
      'x-openai-oauth-endpoint': ep
    };

    const targetModel = (model && !model.includes('/')) ? model : 'gpt-4o';
    const body = {
      model: targetModel,
      messages,
      temperature,
      max_tokens,
      stream: typeof onChunk === 'function'
    };

    let res;
    try {
      res = await fetch(proxyEndpoint, {
        method: 'POST',
        signal: requestSignal(),
        headers,
        body: JSON.stringify(body)
      });
    } catch (e) {
      console.warn('[OpenAI OAuth] Proxy failed, attempting direct fetch:', e);
      try {
        res = await fetch(`${ep}/chat/completions`, {
          method: 'POST',
          signal: requestSignal(),
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
      } catch (err2) {
        throw new Error(`OpenAI OAuth server unreachable at ${ep}. Make sure "npx openai-oauth" is running.`);
      }
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OpenAI OAuth Error (${res.status}): ${err}\n\nMake sure "npx openai-oauth" is running in your terminal.`);
    }

    const json = await res.json();
    return json.choices?.[0]?.message?.content || json.choices?.[0]?.delta?.content || '';
  }

  window.LLMAdapters = {
    nvidiaNimChat,
    openRouterChat,
    ollamaChat,
    openaiOauthChat,
    /** Why the last NIM completion stopped: 'stop', 'length', or ''. */
    lastNimFinish: () => window.LLMAdapters._lastNimFinish || '',
    /** Token counts for that completion, when the service reported them. */
    lastNimUsage: () => window.LLMAdapters._lastNimUsage || null
  };
})();
