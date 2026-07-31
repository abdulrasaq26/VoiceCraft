// Categorized Multi-Provider AI Settings & Model Manager Modal for Blvck-TTS v5.1
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const openBtn = $('ai-settings-open');
  const modal = $('ai-settings-modal');
  if (!openBtn || !modal) return;

  const ttsProviderSel = $('set-tts-provider');
  const imageProviderSel = $('set-image-provider');
  const sdInput = $('set-sd-endpoint');
  const cfWorkerEndpointInput = $('set-cf-worker-endpoint');
  const cfWorkerKeyInput = $('set-cf-worker-key');
  const openaiOauthInput = $('set-openai-oauth-endpoint');
  const openaiEndpointInput = $('set-openai-endpoint');
  const openaiInput = $('set-openai-keys');
  const chatModelSel = $('set-chat-model');
  const btnRefreshModels = $('btn-refresh-models');
  const objectiveSel = $('set-objective');
  const nimInput = $('set-nim-keys');
  const elevenInput = $('set-elevenlabs-keys');
  const fishInput = $('set-fishaudio-endpoint');
  const kokoroInput = $('set-kokoro-endpoint');
  const falInput = $('set-fal-keys');
  const replicateInput = $('set-replicate-keys');
  const runwayInput = $('set-runway-keys');
  const lumaInput = $('set-luma-keys');
  const saveBtn = $('ai-settings-save');

  function populateModelDropdown() {
    if (!chatModelSel || !window.ModelRegistry) return;

    const currentSel = window.BlvckAI ? window.BlvckAI.chatModel() : 'auto';
    const models = window.ModelRegistry.getDiscoveredModels();

    let html = '<option value="auto">⚡ Auto (AI Director Recommendation)</option>';
    models.forEach(m => {
      html += `<option value="${m.id}" ${currentSel === m.id ? 'selected' : ''}>▼ ${m.name || m.id} (${m.type || 'general'})</option>`;
    });

    chatModelSel.innerHTML = html;
  }

  async function openModal() {
    modal.hidden = false;
    document.body.classList.add('modal-open');

    // Trigger dynamic discovery on open if NIM key exists
    if (window.ModelRegistry) {
      await window.ModelRegistry.syncAllGateways();
    }
    populate();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function populate() {
    const PM = window.ProviderManager;
    const AI = window.BlvckAI;
    if (!PM || !AI) return;

    if (ttsProviderSel) ttsProviderSel.value = AI.ttsProvider();
    if (imageProviderSel && AI.imageProvider) imageProviderSel.value = AI.imageProvider();
    if (objectiveSel) objectiveSel.value = AI.objective();

    populateModelDropdown();

    if (nimInput) nimInput.value = (PM.getPoolState('nim')?.keys || []).join('\n');
    if (elevenInput) elevenInput.value = (PM.getPoolState('elevenlabs')?.keys || []).join('\n');
    if (fishInput) fishInput.value = PM.getPoolState('fishaudio')?.endpoint || '';
    if (kokoroInput) kokoroInput.value = PM.getPoolState('kokoro')?.endpoint || 'http://localhost:8880';
    if (sdInput) sdInput.value = PM.getPoolState('sd')?.endpoint || 'http://localhost:1420';
    if (cfWorkerEndpointInput) cfWorkerEndpointInput.value = PM.getPoolState('cloudflare_worker')?.endpoint || localStorage.getItem('blvck:cf_worker_endpoint') || '';
    if (cfWorkerKeyInput) cfWorkerKeyInput.value = PM.getPoolState('cloudflare_worker')?.key || localStorage.getItem('blvck:cf_worker_key') || '';
    const epVal = PM.getPoolState('openai_oauth')?.endpoint || 'http://127.0.0.1:10531/v1';
    if (openaiOauthInput) openaiOauthInput.value = epVal;
    if (openaiEndpointInput) openaiEndpointInput.value = epVal;
    if (openaiInput) openaiInput.value = (PM.getPoolState('openai')?.keys || []).join('\n');
    if (falInput) falInput.value = (PM.getPoolState('fal')?.keys || []).join('\n');
    if (replicateInput) replicateInput.value = (PM.getPoolState('replicate')?.keys || []).join('\n');
    if (runwayInput) runwayInput.value = (PM.getPoolState('runway')?.keys || []).join('\n');
    if (lumaInput) lumaInput.value = (PM.getPoolState('luma')?.keys || []).join('\n');
  }

  async function save() {
    const PM = window.ProviderManager;
    const AI = window.BlvckAI;
    if (!PM || !AI) return;

    try {
      if (ttsProviderSel) AI.setTtsProvider(ttsProviderSel.value);
      if (imageProviderSel && AI.setImageProvider) AI.setImageProvider(imageProviderSel.value);
      if (chatModelSel) AI.setChatModel(chatModelSel.value);
      if (objectiveSel) AI.setObjective(objectiveSel.value);

      if (nimInput) PM.setKeys('nim', nimInput.value.split('\n'));
      if (elevenInput) PM.setKeys('elevenlabs', elevenInput.value.split('\n'));
      if (fishInput) PM.setEndpoint('fishaudio', fishInput.value);
      if (kokoroInput) PM.setEndpoint('kokoro', kokoroInput.value);
      if (sdInput) PM.setEndpoint('sd', sdInput.value);
      if (cfWorkerEndpointInput) {
        PM.setEndpoint('cloudflare_worker', cfWorkerEndpointInput.value);
        localStorage.setItem('blvck:cf_worker_endpoint', cfWorkerEndpointInput.value.trim());
      }
      if (cfWorkerKeyInput) {
        if (PM.pools && PM.pools.cloudflare_worker) PM.pools.cloudflare_worker.key = cfWorkerKeyInput.value.trim();
        localStorage.setItem('blvck:cf_worker_key', cfWorkerKeyInput.value.trim());
      }
      const saveEp = (openaiEndpointInput && openaiEndpointInput.value) || (openaiOauthInput && openaiOauthInput.value) || 'http://127.0.0.1:10531/v1';
      PM.setEndpoint('openai_oauth', saveEp);
      if (openaiInput) PM.setKeys('openai', openaiInput.value.split('\n'));
      if (falInput) PM.setKeys('fal', falInput.value.split('\n'));
      if (replicateInput) PM.setKeys('replicate', replicateInput.value.split('\n'));
      if (runwayInput) PM.setKeys('runway', runwayInput.value.split('\n'));
      if (lumaInput) PM.setKeys('luma', lumaInput.value.split('\n'));

      // Close modal & emit status update immediately (non-blocking)
      closeModal();
      window.dispatchEvent(new CustomEvent('blvck:provider-status-changed'));

      // Non-blocking background gateway sync
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
      btnRefreshModels.textContent = '⏳ Discovering...';
      if (window.ModelRegistry) {
        await window.ModelRegistry.syncAllGateways();
      }
      populateModelDropdown();
      btnRefreshModels.textContent = '↻ Refresh Models';
    });
  }

  openBtn.addEventListener('click', openModal);
  if (saveBtn) saveBtn.addEventListener('click', save);
  modal.querySelectorAll('.close-modal').forEach(b => b.addEventListener('click', closeModal));
  window.addEventListener('blvck:models-updated', populateModelDropdown);
})();
