// AI settings modal — lets the user adapt Blvck-TTS to whatever their Puter
// instance offers: chat model, image model, and the text-to-speech provider
// (ElevenLabs / Amazon Polly / OpenAI / Gemini / xAI) plus its model/engine.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const openBtn = $('ai-settings-open');
  const modal = $('ai-settings-modal');
  if (!openBtn || !modal) return;

  const chatSel = $('set-chat-model');
  const imageInput = $('set-image-model');
  const ttsProviderSel = $('set-tts-provider');
  const ttsProviderNote = $('set-tts-provider-note');
  const ttsModelInput = $('set-tts-model');
  const ttsModelLabel = $('set-tts-model-label');
  const ttsModelHint = $('set-tts-model-hint');
  const ttsNote = $('set-tts-note');
  const saveBtn = $('ai-settings-save');
  const refreshBtn = $('ai-settings-refresh');

  function openModal() {
    modal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeModal() {
    modal.hidden = true;
    if (![...document.querySelectorAll('.modal')].some((m) => !m.hidden)) {
      document.body.classList.remove('modal-open');
    }
  }

  // Fill the provider dropdown from the TTS catalog and reflect the model
  // label/hint/placeholder for the selected provider.
  function populateProviders() {
    const order = window.TTS_PROVIDER_ORDER || ['elevenlabs'];
    ttsProviderSel.innerHTML = '';
    order.forEach((id) => {
      const def = window.getTtsProvider ? window.getTtsProvider(id) : { label: id };
      const o = document.createElement('option');
      o.value = id;
      o.textContent = def.label || id;
      ttsProviderSel.appendChild(o);
    });
    ttsProviderSel.value = window.BlvckAI.ttsProvider();
    syncProviderFields();
  }

  function syncProviderFields() {
    const def = window.getTtsProvider ? window.getTtsProvider(ttsProviderSel.value) : null;
    if (!def) return;
    ttsProviderNote.textContent = def.note || '';
    ttsModelLabel.textContent = def.modelLabel || 'Voice model';
    ttsModelHint.textContent = def.modelHint || '';
    ttsModelInput.placeholder = def.defaultModel || '';
  }

  async function populate() {
    const AI = window.BlvckAI;
    imageInput.value = AI.imageModel();
    populateProviders();
    ttsModelInput.value = AI.ttsModel();

    chatSel.innerHTML = '<option value="">Auto (instance default)</option>';
    ttsNote.textContent = 'Loading models from your Puter instance…';
    let models = [];
    try {
      models = await AI.listModels();
    } catch {
      /* offline / not signed in */
    }
    const resolved = models.length ? await AI.resolveChatModel() : '';
    chatSel.options[0].textContent = models.length ? `Auto (${resolved || 'default'})` : 'Auto (instance default)';
    models.forEach((m) => {
      const o = document.createElement('option');
      o.value = m.id;
      o.textContent = m.name + (m.provider ? ` · ${m.provider}` : '');
      chatSel.appendChild(o);
    });
    const stored = AI.chatModel();
    chatSel.value = stored && models.some((m) => m.id === stored) ? stored : '';

    ttsNote.textContent = models.length
      ? `${models.length} chat models available on this instance.`
      : 'Could not list models yet — sign into Puter, then use "Reload model list".';
  }

  function saveAll() {
    const AI = window.BlvckAI;
    if (chatSel.value) AI.setChatModel(chatSel.value);
    AI.setImageModel(imageInput.value.trim() || undefined);
    AI.setTtsProvider(ttsProviderSel.value || undefined);
    AI.setTtsModel(ttsModelInput.value.trim() || undefined);
  }

  chatSel.addEventListener('change', () => {
    if (chatSel.value) { window.BlvckAI.setChatModel(chatSel.value); ttsNote.textContent = `Chat model set to ${chatSel.value}.`; }
  });
  imageInput.addEventListener('change', () => {
    window.BlvckAI.setImageModel(imageInput.value.trim() || undefined);
  });
  // Switching provider: persist it, clear the model so the new provider uses
  // its own default, refresh the field hints, and tell the voice studio to
  // reload its catalog for the new provider.
  ttsProviderSel.addEventListener('change', () => {
    window.BlvckAI.setTtsProvider(ttsProviderSel.value || undefined);
    window.BlvckAI.setTtsModel(undefined);
    ttsModelInput.value = '';
    syncProviderFields();
    window.dispatchEvent(new CustomEvent('blvck:tts-provider-changed'));
  });
  ttsModelInput.addEventListener('change', () => {
    window.BlvckAI.setTtsModel(ttsModelInput.value.trim() || undefined);
  });

  openBtn.addEventListener('click', () => { openModal(); populate(); });
  // When Puter connects (e.g. after signing in from the banner), refresh the
  // model list so the dropdowns fill in without needing to reopen the modal.
  window.addEventListener('blvck:puter-ready', () => { if (!modal.hidden) populate(); });
  saveBtn.addEventListener('click', () => { saveAll(); closeModal(); });
  refreshBtn.addEventListener('click', async () => {
    try { await window.BlvckAI.listModels(true); } catch { /* ignore */ }
    populate();
  });
  modal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => { saveAll(); closeModal(); }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) { saveAll(); closeModal(); } });
})();
