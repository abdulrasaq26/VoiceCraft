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
  if (saveBtn) saveBtn.addEventListener('click', save);
  modal.querySelectorAll('.close-modal, [data-close]').forEach((b) => b.addEventListener('click', closeModal));
  window.addEventListener('blvck:models-updated', populateModelDropdown);
})();
