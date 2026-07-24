(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const card = $('script-card');
  if (!card) return;

  const typeEl = $('script-type');
  const toneEl = $('script-tone');
  const lengthEl = $('script-length');
  const audienceEl = $('script-audience');
  const topicEl = $('script-topic');
  const retentionEl = $('script-retention');
  const templateSelect = $('script-template-select');
  const genBtn = $('script-generate');
  const stopBtn = $('script-stop');
  const saveTemplateBtn = $('script-save-template');
  const statusEl = $('script-status');
  const result = $('script-result');
  const output = $('script-output');
  const useBtn = $('script-use');
  const copyBtn = $('script-copy');
  const downloadBtn = $('script-download');
  const regenBtn = $('script-regenerate');
  const wordcountEl = $('script-wordcount');

  const spinner = genBtn.querySelector('.spinner');
  const label = genBtn.querySelector('.btn-label');
  const titleInput = $('title-input');

  const LS_TEMPLATES = 'blvck-tts:script-templates';
  const LS_LAST = 'blvck-tts:script-last';

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    },
    set(key, val) {
      try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ }
    }
  };

  let templates = store.get(LS_TEMPLATES, []);

  function showStatus(message, type = 'error') {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    statusEl.hidden = false;
  }
  function clearStatus() { statusEl.hidden = true; }

  let stopRequested = false;

  function setLoading(loading) {
    genBtn.disabled = loading;
    regenBtn.disabled = loading;
    spinner.hidden = !loading;
    label.textContent = loading ? 'Writing…' : 'Generate script';
    if (stopBtn) stopBtn.hidden = !loading;
    document.querySelectorAll('.script-refine-row [data-refine]').forEach((b) => (b.disabled = loading));
  }

  function collectOptions() {
    return {
      type: typeEl.value,
      tone: toneEl.value,
      length: lengthEl.value,
      audience: audienceEl.value.trim(),
      topic: topicEl.value.trim(),
      retention: retentionEl.checked
    };
  }

  function applyOptions(o) {
    if (!o) return;
    if (o.type) typeEl.value = o.type;
    if (o.tone) toneEl.value = o.tone;
    if (o.length) lengthEl.value = o.length;
    if (typeof o.audience === 'string') audienceEl.value = o.audience;
    if (typeof o.topic === 'string') topicEl.value = o.topic;
    if (typeof o.retention === 'boolean') retentionEl.checked = o.retention;
  }

  function updateWordcount() {
    const words = output.value.trim().split(/\s+/).filter(Boolean).length;
    wordcountEl.textContent = words ? `${words} words` : '';
  }

  function slug(text) {
    return (text || 'script')
      .replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'script';
  }

  async function generate() {
    const options = collectOptions();
    if (!options.topic) {
      showStatus('Enter a topic or brief first.');
      topicEl.focus();
      return;
    }
    clearStatus();
    setLoading(true);
    stopRequested = false;
    result.hidden = false;
    output.value = '';
    updateWordcount();
    try {
      // Stream the narration token-by-token into the output box.
      const prompt = window.BlvckPrompts.build('/api/script/generate', { options });
      const messages = [];
      if (prompt.system) messages.push({ role: 'system', content: prompt.system });
      messages.push({ role: 'user', content: prompt.user });
      const raw = await window.BlvckAI.chatStream(messages, {
        onToken: (_d, full) => { output.value = full; updateWordcount(); },
        shouldStop: () => stopRequested
      });
      // Tidy up any stray fences/labels once the stream is complete.
      const parsed = window.BlvckPrompts.parse('/api/script/generate', { options }, raw);
      output.value = (parsed && parsed.script) || raw;
      updateWordcount();
      store.set(LS_LAST, { options, script: output.value });
    } catch (err) {
      showStatus(err.message || 'Script generation failed.');
    } finally {
      setLoading(false);
    }
  }

  async function refine(mode) {
    const before = output.value.trim();
    if (!before) return;
    clearStatus();
    setLoading(true);
    stopRequested = false;
    try {
      output.value = '';
      const out = await window.BlvckAI.refineScript(before, mode, {
        onToken: (_d, full) => { output.value = full; updateWordcount(); },
        shouldStop: () => stopRequested
      });
      output.value = (out || '').trim() || before;
      updateWordcount();
      store.set(LS_LAST, { options: collectOptions(), script: output.value });
    } catch (err) {
      output.value = before;
      updateWordcount();
      showStatus(err.message || 'Refine failed.');
    } finally {
      setLoading(false);
    }
  }

  function renderTemplateSelect() {
    templateSelect.innerHTML = '<option value="">Prompt templates…</option>';
    templates.forEach((t) => {
      const o = document.createElement('option');
      o.value = `t:${t.id}`;
      o.textContent = t.label;
      templateSelect.appendChild(o);
    });
    if (templates.length) {
      const del = document.createElement('option');
      del.value = '__delete__';
      del.textContent = '🗑 Delete a template…';
      templateSelect.appendChild(del);
    }
  }

  function saveTemplate() {
    const name = (window.prompt('Name this prompt template:', topicEl.value.trim().slice(0, 40)) || '').trim();
    if (!name) return;
    templates.push({ id: `st-${Date.now()}`, label: name, options: collectOptions() });
    store.set(LS_TEMPLATES, templates);
    renderTemplateSelect();
    showStatus(`Template “${name}” saved.`, 'info');
  }

  function deleteTemplate() {
    if (!templates.length) return;
    const list = templates.map((t, i) => `${i + 1}. ${t.label}`).join('\n');
    const answer = (window.prompt(`Delete which template? Enter its number:\n\n${list}`, '') || '').trim();
    const idx = Number(answer) - 1;
    if (!Number.isInteger(idx) || idx < 0 || idx >= templates.length) return;
    templates.splice(idx, 1);
    store.set(LS_TEMPLATES, templates);
    renderTemplateSelect();
  }

  // --- Wiring ------------------------------------------------------------

  genBtn.addEventListener('click', generate);
  regenBtn.addEventListener('click', generate);
  saveTemplateBtn.addEventListener('click', saveTemplate);
  if (stopBtn) stopBtn.addEventListener('click', () => { stopRequested = true; });
  document.querySelectorAll('.script-refine-row [data-refine]').forEach((btn) =>
    btn.addEventListener('click', () => refine(btn.dataset.refine))
  );

  templateSelect.addEventListener('change', () => {
    const val = templateSelect.value;
    templateSelect.value = '';
    if (!val) return;
    if (val === '__delete__') return deleteTemplate();
    if (val.startsWith('t:')) {
      const t = templates.find((x) => x.id === val.slice(2));
      if (t) { applyOptions(t.options); showStatus(`Template “${t.label}” loaded.`, 'info'); }
    }
  });

  output.addEventListener('input', () => {
    updateWordcount();
    store.set(LS_LAST, { options: collectOptions(), script: output.value });
  });

  useBtn.addEventListener('click', () => {
    const script = output.value.trim();
    if (!script) return;
    const textInput = $('text-input');
    if (textInput) {
      textInput.value = script;
      textInput.dispatchEvent(new Event('input', { bubbles: true }));
      // Name the narration from the topic if the title is empty.
      if (titleInput && !titleInput.value.trim() && topicEl.value.trim()) {
        titleInput.value = topicEl.value.trim().slice(0, 60);
        titleInput.dispatchEvent(new Event('input', { bubbles: true }));
      }
      window.scrollTo({ top: 0, behavior: 'smooth' });
      showStatus('Loaded into the voice studio above. Pick a voice and generate speech.', 'info');
    }
  });

  copyBtn.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(output.value); showStatus('Copied.', 'info'); }
    catch { showStatus('Could not copy to clipboard.'); }
  });

  downloadBtn.addEventListener('click', () => {
    const blob = new Blob([output.value], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(titleInput && titleInput.value) || slug(topicEl.value)}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // --- Restore -----------------------------------------------------------

  renderTemplateSelect();
  const last = store.get(LS_LAST, null);
  if (last) {
    applyOptions(last.options);
    if (last.script) {
      output.value = last.script;
      result.hidden = false;
      updateWordcount();
    }
  }
  card.hidden = false;
})();
