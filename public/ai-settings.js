// Provider settings for VoiceCraft.
//
// Only the Fish Speech configuration for TTS.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const openBtn = $('ai-settings-open');
  const modal = $('ai-settings-modal');
  if (!openBtn || !modal) return;

  const fishInput = $('set-fishaudio-endpoint');
  const btnTestFish = $('btn-test-fish');
  const fishTestResult = $('fish-test-result');
  const saveBtn = $('ai-settings-save');

  function populate() {
    const PM = window.ProviderManager;
    if (!PM) return;
    if (fishInput) fishInput.value = PM.getPoolState('fishaudio')?.endpoint || '';
  }

  async function openModal() {
    modal.hidden = false;
    document.body.classList.add('modal-open');
    populate();
  }

  function closeModal() {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  }

  function save() {
    const PM = window.ProviderManager;
    const AI = window.BlvckAI;
    if (!PM) return;

    try {
      if (fishInput) PM.setEndpoint('fishaudio', fishInput.value);

      if (AI) {
        if (AI.setTtsProvider) AI.setTtsProvider('fishaudio');
      }

      closeModal();
      window.dispatchEvent(new CustomEvent('blvck:provider-status-changed'));
    } catch (err) {
      console.error('[AISettings] Error saving settings:', err);
      alert(`Error saving settings: ${err.message}`);
    }
  }

  // Is VoiceCraft up?
  async function testVoiceCraft() {
    if (!fishTestResult) return;
    const raw = (fishInput ? fishInput.value : '').trim();
    const endpoint = raw.replace(/\/+$/, '');
    if (!endpoint) {
      fishTestResult.innerHTML = '🔴 Not Connected<br><span style="font-size: 0.85em; opacity: 0.8;">Add an endpoint first.</span>';
      return;
    }
    if (!/^https?:\/\//i.test(endpoint)) {
      fishTestResult.innerHTML = '🔴 Not Connected<br><span style="font-size: 0.85em; opacity: 0.8;">That does not look like a URL — it should start with https://</span>';
      return;
    }

    if (btnTestFish) btnTestFish.disabled = true;
    fishTestResult.textContent = 'Checking…';

    try {
      const res = await fetch('/api/proxy/fish/aether/status', {
        headers: { 'x-fish-endpoint': endpoint },
        signal: AbortSignal.timeout(20000)
      });

      if (!res.ok) {
        const msg = res.status === 404
          ? 'Reached something, but it is not a VoiceCraft server.'
          : `Endpoint answered HTTP ${res.status}. Check the notebook is still running.`;
        fishTestResult.innerHTML = `🔴 Not Connected<br><span style="font-size: 0.85em; opacity: 0.8;">${msg}</span>`;
        return;
      }

      let body = null;
      try { body = JSON.parse(await res.text()); } catch (e) { body = null; }
      if (!body || typeof body !== 'object') {
        fishTestResult.innerHTML = '🔴 Not Connected<br><span style="font-size: 0.85em; opacity: 0.8;">Reached the endpoint, but its reply was not JSON — this is usually an ngrok warning page.</span>';
        return;
      }

      const bits = [];
      const voices = Array.isArray(body.voices) ? body.voices.length
                   : (Number.isFinite(body.voiceCount) ? body.voiceCount : null);
      if (voices != null) bits.push(`${voices} voice${voices === 1 ? '' : 's'}`);
      if (body.model) bits.push(String(body.model));
      const detail = bits.length ? ` (${bits.join(', ')})` : '';

      fishTestResult.innerHTML = `🟢 Connected<br><span style="font-size: 0.85em; opacity: 0.8;">Live${detail}</span>`;
    } catch (err) {
      const why = (err && err.name === 'TimeoutError')
        ? 'no answer within 20s — the notebook may be asleep or the URL stale'
        : (err && err.message) || 'unreachable';
      fishTestResult.innerHTML = `🔴 Not Connected<br><span style="font-size: 0.85em; opacity: 0.8;">Could not reach it: ${why}</span>`;
    } finally {
      if (btnTestFish) btnTestFish.disabled = false;
    }
  }

  openBtn.addEventListener('click', openModal);
  if (btnTestFish) btnTestFish.addEventListener('click', testVoiceCraft);
  if (saveBtn) saveBtn.addEventListener('click', save);
  modal.querySelectorAll('.close-modal, [data-close]').forEach((b) => b.addEventListener('click', closeModal));
})();
