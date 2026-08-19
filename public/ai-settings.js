// Provider settings for AETHER.
//
// Only the five things this build actually uses: the Qwen brain, NVIDIA NIM as
// its fallback, Fish Speech for voice, and Pixabay/Pexels for footage. The
// other providers still exist in the adapters and keep working on their
// defaults — they are just no longer worth a row in a dialog nobody reads.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const openBtn = $('ai-settings-open');
  const modal = $('ai-settings-modal');
  if (!openBtn || !modal) return;

  const qwenEndpointInput = $('set-qwen-endpoint');
  const qwenKeyInput = $('set-qwen-key');
  const btnTestQwen = $('btn-test-qwen');
  const qwenTestResult = $('qwen-test-result');
  const nimInput = $('set-nim-keys');
  const btnTestNim = $('btn-test-nim');
  const nimTestResult = $('nim-test-result');
  const chatModelSel = $('set-chat-model');
  const btnRefreshModels = $('btn-refresh-models');
  const fishInput = $('set-fishaudio-endpoint');
  const pixabayInput = $('set-pixabay-keys');
  const pexelsInput = $('set-pexels-keys');
  const objectiveSel = $('set-objective');
  const saveBtn = $('ai-settings-save');

  function populateModelDropdown() {
    if (!chatModelSel || !window.ModelRegistry) return;
    const current = window.BlvckAI ? window.BlvckAI.chatModel() : 'auto';
    const models = window.ModelRegistry.getDiscoveredModels() || [];

    let html = '<option value="auto">⚡ Auto</option>';
    models.forEach((m) => {
      const sel = current === m.id ? ' selected' : '';
      html += `<option value="${m.id}"${sel}>${m.name || m.id} (${m.type || 'general'})</option>`;
    });
    chatModelSel.innerHTML = html;
  }

  function populate() {
    const PM = window.ProviderManager;
    const AI = window.BlvckAI;
    if (!PM) return;

    const qwen = PM.getPoolState('qwen') || {};
    if (qwenEndpointInput) qwenEndpointInput.value = qwen.endpoint || '';
    if (qwenKeyInput) qwenKeyInput.value = qwen.key || '';
    if (qwenTestResult) qwenTestResult.textContent = '';

    if (nimInput) nimInput.value = (PM.getPoolState('nim')?.keys || []).join('\n');
    if (fishInput) fishInput.value = PM.getPoolState('fishaudio')?.endpoint || '';
    if (pixabayInput) pixabayInput.value = (PM.getPoolState('pixabay')?.keys || []).join('\n');
    if (pexelsInput) pexelsInput.value = (PM.getPoolState('pexels')?.keys || []).join('\n');
    if (objectiveSel && AI && AI.objective) objectiveSel.value = AI.objective();

    populateModelDropdown();
  }

  async function openModal() {
    modal.hidden = false;
    document.body.classList.add('modal-open');
    if (window.ModelRegistry && window.ModelRegistry.syncAllGateways) {
      await window.ModelRegistry.syncAllGateways().catch(() => {});
    }
    populate();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  // Write the Qwen credentials before testing, so the proxy sees what is in the
  // box rather than what was saved last time.
  function stageQwen() {
    const PM = window.ProviderManager;
    if (!PM || !qwenEndpointInput) return;
    PM.setCredentials('qwen', qwenEndpointInput.value, qwenKeyInput ? qwenKeyInput.value : '');
  }

  // Prove the fallback works BEFORE it is needed.
  //
  // NIM is only reached when Qwen is unreachable, so an expired or mistyped key
  // surfaces at the worst moment — mid-generation, with the primary already
  // down, as an error naming the wrong subsystem. There was no way to check it
  // short of taking Qwen offline and trying to make a video.
  //
  // This asks NVIDIA for its model list: the cheapest call that proves the key
  // is accepted, costs no tokens, and also tells us what this key may run.
  async function testNim() {
    if (!nimTestResult) return;
    const keys = (nimInput ? nimInput.value : '')
      .split('\n').map((k) => k.trim()).filter(Boolean);
    if (!keys.length) {
      nimTestResult.textContent = 'Add a key first.';
      return;
    }

    btnTestNim.disabled = true;
    nimTestResult.textContent = `Checking ${keys.length} key${keys.length > 1 ? 's' : ''}…`;

    const results = [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i];
      try {
        // Through the app's own proxy, and against an endpoint that actually
        // checks the key.
        //
        // Two things made an earlier version of this useless. Calling
        // integrate.api.nvidia.com straight from the page fails as
        // "NetworkError when attempting to fetch resource" — no CORS headers
        // for a browser origin, so the request never leaves and no key is ever
        // tested. And /v1/models does not authenticate: measured, it answers
        // 200 with a deliberately invalid key, so it reports success for
        // anything.
        //
        // One token of chat does authenticate: 403 for a bad key, 200 for a
        // good one, and it costs essentially nothing.
        const res = await fetch('/api/proxy/nvidia/v1/chat/completions', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${key}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            model: 'meta/llama-3.1-8b-instruct',
            messages: [{ role: 'user', content: 'hi' }],
            max_tokens: 1
          }),
          signal: AbortSignal.timeout(30000)
        });
        const raw = await res.text();
        let body = null;
        try { body = JSON.parse(raw); } catch (_) { /* handled below */ }

        if (res.status === 401 || res.status === 403) {
          results.push({ ok: false, why: 'rejected — the key is invalid or expired' });
        } else if (res.status === 429) {
          // The key is real; it is just out of quota. Worth distinguishing,
          // because "get a new key" is the wrong fix for it.
          results.push({ ok: false, why: 'rate limited — the key works but has no quota right now' });
        } else if (!res.ok) {
          const detail = body && (body.detail || (body.error && body.error.message));
          results.push({ ok: false, why: `HTTP ${res.status}${detail ? ` — ${detail}` : ''}` });
        } else {
          results.push({ ok: true, why: 'key accepted' });
        }
      } catch (err) {
        const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
        results.push({ ok: false, why: timedOut ? 'no reply within 20s' : err.message });
      }
    }

    const good = results.filter((r) => r.ok).length;
    if (keys.length === 1) {
      nimTestResult.textContent = results[0].ok
        ? `🟢 ${results[0].why}`
        : `🔴 ${results[0].why}`;
    } else {
      // Name the failing ones by position, since the keys themselves must not
      // be echoed back into the page.
      const bad = results.map((r, i) => (r.ok ? null : `#${i + 1} ${r.why}`)).filter(Boolean);
      nimTestResult.textContent = good === keys.length
        ? `🟢 all ${good} keys work`
        : `${good ? '🟡' : '🔴'} ${good}/${keys.length} working — ${bad.join('; ')}`;
    }
    btnTestNim.disabled = false;
  }

  async function testQwen() {
    if (!qwenTestResult) return;
    stageQwen();

    const endpoint = (qwenEndpointInput.value || '').trim();
    if (!endpoint) {
      qwenTestResult.textContent = 'Enter the endpoint first.';
      return;
    }

    btnTestQwen.disabled = true;
    qwenTestResult.textContent = 'Checking…';
    try {
      const res = await fetch('/api/proxy/qwen/health', {
        method: 'GET',
        headers: {
          'x-qwen-endpoint': endpoint,
          'x-qwen-key': (qwenKeyInput && qwenKeyInput.value.trim()) || ''
        }
      });

      // Read as text first. A dead tunnel answers with ngrok's own HTML error
      // page, and calling res.json() on that throws "unexpected character at
      // line 1 column 1" — which says nothing about the tunnel being down.
      const raw = await res.text();
      let body = null;
      try { body = JSON.parse(raw); } catch (_) { /* handled below */ }

      if (body === null) {
        const looksLikeHtml = /^\s*<(!doctype|html)/i.test(raw);
        throw new Error(
          looksLikeHtml
            ? `HTTP ${res.status} — that address served a web page, not the Qwen API. `
              + 'The Kaggle session has probably ended and the tunnel is gone.'
            : `HTTP ${res.status} — unreadable reply: ${raw.slice(0, 80)}`
        );
      }
      if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
      if (body.status !== 'ok') {
        throw new Error(`Reachable, but not the director API: ${JSON.stringify(body).slice(0, 100)}`);
      }

      // `loaded` is the difference between "the tunnel answers" and "the model
      // is in VRAM" — a first request against an unloaded server takes minutes,
      // and that is worth knowing here rather than discovering mid-generation.
      const loaded = body.loaded === false ? ' — model not loaded yet' : '';
      qwenTestResult.textContent = `🟢 ${body.model || 'connected'}${loaded}`;
    } catch (err) {
      qwenTestResult.textContent = `🔴 ${err.message}`;
    } finally {
      btnTestQwen.disabled = false;
    }
  }

  function save() {
    const PM = window.ProviderManager;
    const AI = window.BlvckAI;
    if (!PM) return;

    try {
      stageQwen();
      if (nimInput) PM.setKeys('nim', nimInput.value.split('\n'));
      if (fishInput) PM.setEndpoint('fishaudio', fishInput.value);
      if (pixabayInput) PM.setKeys('pixabay', pixabayInput.value.split('\n'));
      if (pexelsInput) PM.setKeys('pexels', pexelsInput.value.split('\n'));

      if (AI) {
        // Fish Speech is the only voice engine this build ships with, so the
        // provider is set here rather than offered as a choice of one.
        if (AI.setTtsProvider) AI.setTtsProvider('fishaudio');
        if (chatModelSel && AI.setChatModel) AI.setChatModel(chatModelSel.value);
        if (objectiveSel && AI.setObjective) AI.setObjective(objectiveSel.value);
      }

      closeModal();
      window.dispatchEvent(new CustomEvent('blvck:provider-status-changed'));

      if (window.AIManager && window.AIManager.checkHealth) {
        // Re-probe now: a new endpoint should flip the status light without
        // waiting for the next generation to fail.
        window.AIManager.isQwenHealthy = null;
        window.AIManager.checkHealth().catch(() => {});
      }
      if (window.ModelRegistry && window.ModelRegistry.syncAllGateways) {
        window.ModelRegistry.syncAllGateways().catch(() => {});
      }
    } catch (err) {
      console.error('[AISettings] Error saving settings:', err);
      alert(`Error saving settings: ${err.message}`);
    }
  }

  if (btnRefreshModels) {
    btnRefreshModels.addEventListener('click', async () => {
      btnRefreshModels.textContent = '⏳ …';
      if (window.ModelRegistry) await window.ModelRegistry.syncAllGateways().catch(() => {});
      populateModelDropdown();
      btnRefreshModels.textContent = '↻ Refresh';
    });
  }

  if (btnTestQwen) btnTestQwen.addEventListener('click', testQwen);
  openBtn.addEventListener('click', openModal);
  if (btnTestNim) btnTestNim.addEventListener('click', testNim);
  if (saveBtn) saveBtn.addEventListener('click', save);
  modal.querySelectorAll('.close-modal, [data-close]').forEach((b) => b.addEventListener('click', closeModal));
  window.addEventListener('blvck:models-updated', populateModelDropdown);
})();
