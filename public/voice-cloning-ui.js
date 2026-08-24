// Voice Cloning Studio UI — file/mic capture, the quality report, upload and
// reference management. Logic lives in voice-cloning.js.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const card = $('voice-cloning-card');
  if (!card || !window.BlvckVoiceCloning) return;

  const VC = window.BlvckVoiceCloning;
  const fileEl = $('clone-file');
  const recordBtn = $('clone-record');
  const stopBtn = $('clone-stop');
  const analysisEl = $('clone-analysis');
  const nameEl = $('clone-name');
  const transcriptEl = $('clone-transcript');
  const uploadBtn = $('clone-upload');
  const previewBtn = $('clone-preview');
  const statusEl = $('clone-status');
  const listEl = $('clone-list');
  const refreshBtn = $('clone-refresh');

  let prepared = null;      // result of VC.prepare()
  let previewUrl = null;
  let recorder = null;
  let recChunks = [];

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function say(msg, type = 'info') {
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.style.color = type === 'error' ? 'var(--danger, #f87171)'
      : type === 'good' ? 'var(--ok, #34d399)' : '';
  }

  // Show the studio only for engines that actually expose reference endpoints.
  function updateVisibility() {
    const def = window.getTtsProvider && window.BlvckAI
      ? window.getTtsProvider(window.BlvckAI.ttsProvider()) : null;
    const can = !!(def && def.caps && def.caps.cloning);
    card.hidden = !can;
    if (can) renderList();
  }

  function metricRow(label, value, state) {
    const colour = state === 'bad' ? '#f87171' : state === 'warn' ? '#fbbf24' : '#34d399';
    return `<div><span style="opacity:0.75;">${esc(label)}</span>
      <strong style="color:${colour}; margin-left:6px;">${esc(value)}</strong></div>`;
  }

  function renderAnalysis(p) {
    const m = p.metrics, v = p.verdict;
    const rollState = m.rolloff < VC.QUALITY.rolloffFloor ? 'bad'
      : m.rolloff < VC.QUALITY.rolloffWarn ? 'warn' : 'good';
    const snrState = m.snrDb < VC.QUALITY.snrFloor ? 'bad'
      : m.snrDb < VC.QUALITY.snrWarn ? 'warn' : 'good';

    analysisEl.hidden = false;
    analysisEl.style.background = v.ok ? 'rgba(16,185,129,0.08)' : 'rgba(248,113,113,0.08)';
    analysisEl.style.border = `1px solid ${v.ok ? 'rgba(16,185,129,0.4)' : 'rgba(248,113,113,0.5)'}`;

    const grid = `<div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(140px,1fr)); gap:8px; margin-bottom:6px;">
      ${metricRow('Length', `${p.seconds.toFixed(1)}s`, p.seconds >= 4 ? 'good' : 'bad')}
      ${metricRow('Clarity (rolloff)', `${m.rolloff} Hz`, rollState)}
      ${metricRow('Treble energy', `${m.hfPct}%`, m.hfPct >= 2 ? 'good' : 'warn')}
      ${metricRow('Noise floor (SNR)', `${m.snrDb} dB`, snrState)}
    </div>`;

    const trimNote = p.trimmed
      ? `<div style="opacity:0.75; margin-bottom:4px;">Trimmed from ${p.originalSec.toFixed(1)}s to the cleanest ${p.seconds.toFixed(1)}s of speech.</div>`
      : '';
    const problems = v.problems.map((x) => `<div style="color:#f87171;">✕ ${esc(x)}</div>`).join('');
    const warnings = v.warnings.map((x) => `<div style="color:#fbbf24;">▲ ${esc(x)}</div>`).join('');
    const okLine = v.ok && !v.warnings.length
      ? '<div style="color:#34d399;">✓ Good source — this should clone cleanly.</div>' : '';

    analysisEl.innerHTML = grid + trimNote + problems + warnings + okLine;
  }

  async function handleAudio(blob, suggestedName) {
    prepared = null;
    uploadBtn.disabled = true;
    previewBtn.hidden = true;
    say('Analysing…');
    try {
      const p = await VC.prepare(blob);
      prepared = p;
      renderAnalysis(p);
      if (suggestedName && !nameEl.value.trim()) {
        nameEl.value = suggestedName.replace(/\.[^.]+$/, '').replace(/[^a-zA-Z0-9\-_ ]/g, '_').slice(0, 60);
      }
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(p.wav);
      previewBtn.hidden = false;
      // A failing source is never uploadable — a bad reference produces a bad
      // voice permanently, so this is a block rather than a warning.
      uploadBtn.disabled = !p.verdict.ok;
      say(p.verdict.ok ? 'Ready — add a name and the transcript.' : 'Recording quality is too low to clone well.',
        p.verdict.ok ? 'good' : 'error');
    } catch (e) {
      analysisEl.hidden = true;
      say(`Could not read that audio: ${e.message}`, 'error');
    }
  }

  if (fileEl) {
    fileEl.addEventListener('change', () => {
      const f = fileEl.files && fileEl.files[0];
      if (f) handleAudio(f, f.name);
    });
  }

  if (previewBtn) {
    previewBtn.addEventListener('click', () => {
      if (previewUrl) new Audio(previewUrl).play().catch(() => {});
    });
  }

  // --- microphone --------------------------------------------------------
  if (recordBtn) {
    recordBtn.addEventListener('click', async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        recChunks = [];
        recorder = new MediaRecorder(stream);
        recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
        recorder.onstop = () => {
          stream.getTracks().forEach((t) => t.stop());
          recordBtn.hidden = false;
          stopBtn.hidden = true;
          handleAudio(new Blob(recChunks, { type: recorder.mimeType || 'audio/webm' }), '');
        };
        recorder.start();
        recordBtn.hidden = true;
        stopBtn.hidden = false;
        say('Recording — read a few sentences in a normal voice, then stop.');
      } catch (e) {
        say(`Microphone unavailable: ${e.message}`, 'error');
      }
    });
  }
  if (stopBtn) {
    stopBtn.addEventListener('click', () => { if (recorder && recorder.state !== 'inactive') recorder.stop(); });
  }

  // --- upload ------------------------------------------------------------
  if (uploadBtn) {
    uploadBtn.addEventListener('click', async () => {
      if (!prepared) { say('Choose or record a clip first.', 'error'); return; }
      const idErr = VC.validateId(nameEl.value);
      if (idErr) { say(idErr, 'error'); return; }
      if (!transcriptEl.value.trim()) {
        say('Type the transcript — it must match what the recording says.', 'error');
        return;
      }
      uploadBtn.disabled = true;
      say('Uploading…');
      try {
        await VC.addReference(nameEl.value, prepared.wav, transcriptEl.value);
        say(`✓ "${nameEl.value.trim()}" created.`, 'good');
        nameEl.value = '';
        transcriptEl.value = '';
        prepared = null;
        analysisEl.hidden = true;
        previewBtn.hidden = true;
        if (fileEl) fileEl.value = '';
        // Re-probe so the new voice appears in the picker straight away.
        if (window.FishAdapter) await window.FishAdapter.probeFish();
        window.dispatchEvent(new CustomEvent('blvck:tts-provider-changed'));
        renderList();
      } catch (e) {
        say(e.message, 'error');
      } finally {
        // Re-enabled either way. It was only re-enabled in the catch, so a
        // SUCCESSFUL upload left the button dead and a second voice could not
        // be added without reloading the page.
        uploadBtn.disabled = false;
      }
    });
  }

  // --- reference list ----------------------------------------------------
  async function renderList() {
    if (!listEl || !window.FishAdapter) return;
    listEl.innerHTML = '<span class="field-note">Loading…</span>';
    let voices = [];
    try {
      const state = await window.FishAdapter.probeFish();
      voices = (state.voices || []).filter((v) => v.id && v.id !== 'default');
      if (!state.online) {
        listEl.innerHTML = `<span class="field-note" style="color:#f87171;">Fish endpoint unreachable — ${esc(state.error || 'offline')}</span>`;
        return;
      }
    } catch (e) {
      listEl.innerHTML = `<span class="field-note" style="color:#f87171;">${esc(e.message)}</span>`;
      return;
    }
    if (!voices.length) {
      listEl.innerHTML = '<span class="field-note">No reference voices yet.</span>';
      return;
    }
    listEl.innerHTML = '';
    voices.forEach((v) => {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; align-items:center; gap:8px; background:rgba(0,0,0,0.2); padding:6px 10px; border-radius:6px; font-size:12px;';
      const name = document.createElement('span');
      name.style.cssText = 'flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;';
      name.textContent = v.id;
      const del = document.createElement('button');
      del.className = 'btn ghost small';
      del.type = 'button';
      del.textContent = '🗑';
      del.title = `Delete ${v.id}`;
      del.addEventListener('click', async () => {
        if (!window.confirm(`Delete the reference voice "${v.id}"? This cannot be undone.`)) return;
        del.disabled = true;
        try {
          await VC.deleteReference(v.id);
          say(`Deleted "${v.id}".`, 'good');
          if (window.FishAdapter) await window.FishAdapter.probeFish();
          window.dispatchEvent(new CustomEvent('blvck:tts-provider-changed'));
          renderList();
        } catch (e) {
          say(e.message, 'error');
          del.disabled = false;
        }
      });
      row.append(name, del);
      listEl.appendChild(row);
    });
  }

  if (refreshBtn) refreshBtn.addEventListener('click', renderList);
  // Settings save and TTS-provider switch are separate events; both can change
  // whether this studio applies and which references exist.
  window.addEventListener('blvck:provider-status-changed', updateVisibility);
  window.addEventListener('blvck:tts-provider-changed', updateVisibility);

  updateVisibility();
})();
