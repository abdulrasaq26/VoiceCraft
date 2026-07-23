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

  genBtn.addEventListener('click', generate);
  promptEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate();
  });

  reveal();
})();
