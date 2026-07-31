// AETHER AI Studio — Images Workspace Controller
// Image generation via Uncensored Local Studio (Stable Diffusion local backend)
// Backend: stable-diffusion.cpp server at http://127.0.0.1:8080
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const card            = $('image-card');
  const promptEl        = $('image-prompt');
  const negPromptEl     = $('image-negative-prompt');
  const aspectEl        = $('image-aspect');
  const samplerEl       = $('image-sampler');
  const modelSelectEl   = $('image-model-select');
  const stepsEl         = $('image-steps');
  const stepsValEl      = $('image-steps-val');
  const cfgEl           = $('image-cfg');
  const cfgValEl        = $('image-cfg-val');
  const seedEl          = $('image-seed');
  const genBtn          = $('image-generate');
  const reloadModelsBtn = $('image-reload-models');
  const statusEl        = $('image-status');
  const result          = $('image-result');
  const output          = $('image-output');
  const downloadLink    = $('image-download');
  const useAsRefBtn     = $('image-use-as-ref');
  const seedUsedEl      = $('image-seed-used');
  const sdBadge         = $('sd-status-badge');
  const titleInput      = $('title-input'); // project name for filenames

  const spinner         = genBtn ? genBtn.querySelector('.spinner') : null;
  const label           = genBtn ? genBtn.querySelector('.btn-label') : null;

  let currentUrl  = null;
  let currentBlob = null;

  // ─── Status helpers ────────────────────────────────────────────────────────

  function showStatus(message, type = 'error') {
    if (!statusEl) return;
    statusEl.textContent = message;
    statusEl.className = `status ${type}`;
    statusEl.hidden = false;
  }
  function clearStatus() {
    if (statusEl) statusEl.hidden = true;
  }

  // ─── Loading state ─────────────────────────────────────────────────────────

  function setLoading(loading) {
    if (genBtn) genBtn.disabled = loading;
    if (spinner) spinner.hidden = !loading;
    if (label) label.textContent = loading ? 'Generating…' : '🎨 Generate';
  }

  // ─── Slider live display ───────────────────────────────────────────────────

  if (stepsEl && stepsValEl) {
    stepsEl.addEventListener('input', () => { stepsValEl.textContent = stepsEl.value; });
  }
  if (cfgEl && cfgValEl) {
    cfgEl.addEventListener('input', () => { cfgValEl.textContent = parseFloat(cfgEl.value).toFixed(1); });
  }

  // ─── Filename slug ─────────────────────────────────────────────────────────

  function slug(text) {
    return (
      (text || 'aether-image')
        .replace(/[\\/:*?"<>|]+/g, ' ')
        .replace(/\s+/g, '-')
        .trim()
        .slice(0, 60) || 'aether-image'
    );
  }

  // ─── SD backend status badge ───────────────────────────────────────────────

  async function updateSdBadge() {
    if (!sdBadge || !window.StableDiffusionAdapter) return;
    const online = await window.StableDiffusionAdapter.checkOnline();
    if (online) {
      sdBadge.textContent = '✅ SD Backend Online';
      sdBadge.className = 'badge elite';
      if (genBtn) genBtn.disabled = false;
    } else {
      sdBadge.textContent = '❌ SD Backend Offline';
      sdBadge.className = 'badge standard';
    }
  }

  // ─── Load model list from SD backend ──────────────────────────────────────

  async function loadModelList() {
    if (!modelSelectEl || !window.StableDiffusionAdapter) return;
    const models = await window.StableDiffusionAdapter.listModels();
    // Preserve "Auto" option
    const currentVal = modelSelectEl.value;
    modelSelectEl.innerHTML = `
      <option value="">Auto (server default)</option>
      <option value="local_sd">🪐 Stable Diffusion (Local / Colab)</option>
      <option value="cloudflare_worker">☁️ Cloudflare Worker AI (SDXL Base 1.0)</option>
      <option value="gpt-image-2">🤖 gpt-image-2 (ChatGPT Account)</option>
      <option value="dall-e-3">🎨 dall-e-3 (OpenAI DALL-E 3)</option>
    `;
    models.forEach(m => {
      const opt = document.createElement('option');
      const name = typeof m === 'string' ? m : (m.filename || m.name || String(m));
      opt.value = name;
      opt.textContent = `🎨 ${name}`;
      modelSelectEl.appendChild(opt);
    });
    if (currentVal) modelSelectEl.value = currentVal;
  }

  // ─── Generate ──────────────────────────────────────────────────────────────

  async function generate() {
    const prompt = promptEl ? promptEl.value.trim() : '';
    if (!prompt) {
      showStatus('Describe the image you want first.');
      if (promptEl) promptEl.focus();
      return;
    }

    if (!window.StableDiffusionAdapter) {
      showStatus('Please refresh your browser tab (press F5 or Ctrl+R) to load the updated Stable Diffusion adapter.');
      return;
    }

    clearStatus();
    setLoading(true);

    try {
      const blob = await window.BlvckAI.generateImage({
        prompt,
        negative_prompt: negPromptEl ? negPromptEl.value.trim() : '',
        aspect_ratio:    aspectEl   ? aspectEl.value   : '16:9',
        sampler:         samplerEl  ? samplerEl.value  : 'euler_a',
        steps:           stepsEl    ? parseInt(stepsEl.value, 10) : 20,
        cfg_scale:       cfgEl      ? parseFloat(cfgEl.value) : 7.0,
        seed:            seedEl     ? parseInt(seedEl.value, 10) : -1,
        model:           modelSelectEl && modelSelectEl.value ? modelSelectEl.value : undefined,
      });

      if (currentUrl) URL.revokeObjectURL(currentUrl);
      currentBlob = blob;
      currentUrl  = URL.createObjectURL(blob);

      if (output) output.src = currentUrl;
      const ext = (blob.type && blob.type.split('/')[1]) || 'png';
      if (downloadLink) {
        downloadLink.href     = currentUrl;
        downloadLink.download = `${slug(titleInput && titleInput.value)}-${Date.now()}.${ext}`;
      }
      if (result) result.hidden = false;
      if (seedUsedEl) seedUsedEl.textContent = seedEl && seedEl.value !== '-1'
        ? `Seed: ${seedEl.value}`
        : 'Seed: random';

    } catch (err) {
      const msg = err.message || 'Image generation failed.';
      showStatus(msg, 'error');
      console.error('[Images]', err);
    } finally {
      setLoading(false);
    }
  }

  // ─── Prompt Enhance ────────────────────────────────────────────────────────

  async function enhance() {
    const idea = promptEl ? promptEl.value.trim() : '';
    if (!idea) {
      showStatus('Enter a rough idea first, then hit Enhance.');
      if (promptEl) promptEl.focus();
      return;
    }
    const btn = $('image-enhance');
    clearStatus();
    if (btn) { btn.disabled = true; btn.textContent = '✨ Enhancing…'; }
    try {
      const styleSel = $('sb-style');
      const styleHint = styleSel && window.VISUAL_STYLES && window.VISUAL_STYLES[styleSel.value]
        ? window.VISUAL_STYLES[styleSel.value].render : '';
      const enhanced = await window.BlvckAI.enhanceImagePrompt(idea, styleHint);
      if (enhanced && promptEl) {
        promptEl.value = enhanced;
        showStatus('Prompt enhanced — tweak it or generate.', 'info');
      }
    } catch (err) {
      showStatus(err.message || 'Could not enhance the prompt.');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '✨ AI Enhance'; }
    }
  }

  // ─── Event Bindings ────────────────────────────────────────────────────────

  if (genBtn)          genBtn.addEventListener('click', generate);
  if (promptEl)        promptEl.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate(); });
  if (reloadModelsBtn) reloadModelsBtn.addEventListener('click', () => { loadModelList(); updateSdBadge(); });

  const enhanceBtn = $('image-enhance');
  if (enhanceBtn) enhanceBtn.addEventListener('click', enhance);

  // "Use as Reference" — saves blob as a named character reference for storyboard consistency
  if (useAsRefBtn) {
    useAsRefBtn.addEventListener('click', () => {
      if (!currentBlob) { showStatus('Generate an image first.'); return; }
      const name = prompt('Reference name (e.g. "Protagonist" or "Background scene"):');
      if (!name) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        const dataUrl = ev.target.result;
        if (window.AssetConsistency) {
          window.AssetConsistency.setCharacterReference(name.trim(), dataUrl);
          showStatus(`📌 Saved as reference: "${name.trim()}"`, 'info');
        } else {
          // Fallback: store in sessionStorage
          try { sessionStorage.setItem(`ref:${name.trim()}`, dataUrl); } catch (_) {}
          showStatus(`📌 Saved "${name.trim()}" as reference.`, 'info');
        }
      };
      reader.readAsDataURL(currentBlob);
    });
  }

  // ─── SD backend status event ───────────────────────────────────────────────

  function handleSdStatusChange(online) {
    if (!sdBadge) return;
    if (online) {
      sdBadge.textContent = '✅ SD Backend Online';
      sdBadge.className = 'badge elite';
      loadModelList();  // auto-populate models once online
    } else {
      sdBadge.textContent = '❌ SD Backend Offline';
      sdBadge.className = 'badge standard';
    }
  }

  window.addEventListener('sd:status-changed', (e) => {
    handleSdStatusChange(e.detail?.online);
  });

  window.addEventListener('blvck:provider-status-changed', () => {
    updateSdBadge();
    loadModelList();
  });

  // ─── Reset / Clear ─────────────────────────────────────────────────────────

  function resetPreview() {
    if (currentUrl) { URL.revokeObjectURL(currentUrl); currentUrl = null; }
    currentBlob = null;
    if (output) output.removeAttribute('src');
    if (result) result.hidden = true;
    if (seedUsedEl) seedUsedEl.textContent = '';
    clearStatus();
  }
  if (window.BlvckData) window.BlvckData.register('images', resetPreview);

  // ─── Init ──────────────────────────────────────────────────────────────────

  if (card) card.hidden = false;
  updateSdBadge();
  loadModelList();
})();
