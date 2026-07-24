// AI settings modal — lets the user adapt Blvck-TTS to whatever their Puter
// instance offers (chat model, image model, TTS provider/model). Essential
// for self-hosted Puter where the puter.com defaults may not exist.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const openBtn = $('ai-settings-open');
  const modal = $('ai-settings-modal');
  if (!openBtn || !modal) return;

  const chatSel = $('set-chat-model');
  const imageInput = $('set-image-model');
  const ttsProviderInput = $('set-tts-provider');
  const ttsModelInput = $('set-tts-model');
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

  async function populate() {
    const AI = window.BlvckAI;
    imageInput.value = AI.imageModel();
    ttsProviderInput.value = AI.ttsProvider();
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

    if (!models.length) {
      ttsNote.textContent = 'Could not list models yet — sign into Puter, then use "Reload model list". You can still type a provider/model manually.';
    } else {
      ttsNote.textContent = `${models.length} chat models available on this instance. If speech fails with "provider not found", set the provider to one your instance supports (puter.com has "elevenlabs").`;
    }
  }

  function saveAll() {
    const AI = window.BlvckAI;
    if (chatSel.value) AI.setChatModel(chatSel.value);
    AI.setImageModel(imageInput.value.trim() || undefined);
    AI.setTtsProvider(ttsProviderInput.value.trim() || undefined);
    AI.setTtsModel(ttsModelInput.value.trim() || undefined);
  }

  function flash(msg) {
    if (ttsNote) ttsNote.textContent = msg;
  }

  // Apply each change immediately so a choice is locked in even without
  // clicking Save (the Save button may be below the fold on short screens).
  chatSel.addEventListener('change', () => {
    if (chatSel.value) { window.BlvckAI.setChatModel(chatSel.value); flash(`Chat model set to ${chatSel.value}.`); }
  });
  imageInput.addEventListener('change', () => {
    window.BlvckAI.setImageModel(imageInput.value.trim() || undefined);
  });
  ttsProviderInput.addEventListener('change', () => {
    window.BlvckAI.setTtsProvider(ttsProviderInput.value.trim() || undefined);
  });
  ttsModelInput.addEventListener('change', () => {
    window.BlvckAI.setTtsModel(ttsModelInput.value.trim() || undefined);
  });

  openBtn.addEventListener('click', () => { openModal(); populate(); });
  saveBtn.addEventListener('click', () => { saveAll(); closeModal(); });
  refreshBtn.addEventListener('click', async () => {
    try { await window.BlvckAI.listModels(true); } catch { /* ignore */ }
    populate();
  });
  modal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', () => { saveAll(); closeModal(); }));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) { saveAll(); closeModal(); } });
})();
