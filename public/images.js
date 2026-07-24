(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const card = $('image-card');
  const promptEl = $('image-prompt');
  const aspectEl = $('image-aspect');
  const genBtn = $('image-generate');
  const spinner = genBtn.querySelector('.spinner');
  const label = genBtn.querySelector('.btn-label');
  const statusEl = $('image-status');
  const result = $('image-result');
  const output = $('image-output');
  const downloadLink = $('image-download');

  const titleInput = $('title-input'); // reuse the project name for filenames
  let currentUrl = null;

  function showStatus(message, type = 'error') {
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    statusEl.hidden = false;
  }
  function clearStatus() {
    statusEl.hidden = true;
  }

  function setLoading(loading) {
    genBtn.disabled = loading;
    spinner.hidden = !loading;
    label.textContent = loading ? 'Generating…' : 'Generate image';
  }

  function slug(text) {
    return (
      (text || 'blvck-image')
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 60) || 'blvck-image'
    );
  }

  function reveal() {
    card.hidden = false;
  }

  async function generate() {
    const prompt = promptEl.value.trim();
    if (!prompt) {
      showStatus('Describe the image you want first.');
      promptEl.focus();
      return;
    }
    clearStatus();
    setLoading(true);
    try {
      const blob = await window.BlvckAI.generateImage(prompt, aspectEl.value);
      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentUrl = URL.createObjectURL(blob);
      output.src = currentUrl;
      const ext = (blob.type && blob.type.split('/')[1]) || 'png';
      downloadLink.href = currentUrl;
      downloadLink.download = `${slug(titleInput && titleInput.value)}-${Date.now()}.${ext}`;
      result.hidden = false;
    } catch (err) {
      showStatus(err.hint ? `${err.message} — ${err.hint}` : err.message);
    } finally {
      setLoading(false);
    }
  }

  async function enhance() {
    const idea = promptEl.value.trim();
    if (!idea) {
      showStatus('Jot a rough idea first, then Enhance.');
      promptEl.focus();
      return;
    }
    const btn = $('image-enhance');
    clearStatus();
    if (btn) { btn.disabled = true; btn.textContent = '✨ Enhancing…'; }
    try {
      // Feed the storyboard's chosen visual style as a hint, if one is set.
      const styleSel = $('sb-style');
      const styleHint = styleSel && window.VISUAL_STYLES && window.VISUAL_STYLES[styleSel.value]
        ? window.VISUAL_STYLES[styleSel.value].render
        : '';
      const enhanced = await window.BlvckAI.enhanceImagePrompt(idea, styleHint);
      if (enhanced) {
        promptEl.value = enhanced;
        showStatus('Prompt enhanced — tweak it or generate.', 'info');
      }
    } catch (err) {
      showStatus(err.message || 'Could not enhance the prompt.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✨ Enhance prompt'; }
    }
  }

  genBtn.addEventListener('click', generate);
  const enhanceBtn = $('image-enhance');
  if (enhanceBtn) enhanceBtn.addEventListener('click', enhance);
  promptEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate();
  });

  reveal();
})();
