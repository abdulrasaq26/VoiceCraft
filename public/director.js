// AI Production Director — the global intelligence layer. It sits above every
// tool, sees the whole project (via BlvckAssets), advises across the pipeline,
// runs a scored quality audit, and (in Director Mode) proactively points to
// the next step. Everything runs through Puter chat; project context is the
// BlvckAssets snapshot.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const card = $('director-card');
  if (!card || !window.BlvckAssets) return;

  const modeEl = $('director-mode');
  const nextEl = $('director-next');
  const auditBtn = $('director-audit');
  const auditResult = $('director-audit-result');
  const chatEl = $('director-chat');
  const inputEl = $('director-input');
  const sendBtn = $('director-send');
  const stopBtn = $('director-stop');
  const statusEl = $('director-status');
  const spinner = sendBtn.querySelector('.spinner');
  const sendLabel = sendBtn.querySelector('.btn-label');

  const LS_MODE = 'blvck-tts:director-mode';
  const LS_AUDIT = 'blvck-tts:director-audit';

  const messages = []; // { role, content }
  let stopRequested = false;
  let busy = false;

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }
  function showStatus(msg, type = 'error') { statusEl.textContent = msg; statusEl.className = `status ${type}`; statusEl.hidden = false; }
  function clearStatus() { statusEl.hidden = true; }

  function setBusy(b) {
    busy = b;
    sendBtn.disabled = b;
    auditBtn.disabled = b;
    spinner.hidden = !b;
    sendLabel.textContent = b ? 'Thinking…' : 'Ask';
    stopBtn.hidden = !b;
    card.querySelectorAll('[data-dcmd]').forEach((x) => (x.disabled = b));
  }

  // --- Next-step guidance (Director Mode) --------------------------------

  const STAGE_INFO = {
    script: { label: 'Generate a script', target: 'script-card', tip: 'Start with a script — a strong hook decides everything downstream.' },
    voice: { label: 'Generate the voiceover', target: null, tip: 'Turn your script into narration in the voice studio.' },
    storyboard: { label: 'Build the storyboard', target: 'storyboard-card', tip: 'Analyze the story into scenes with a fitting visual style.' },
    images: { label: 'Generate scene images', target: 'storyboard-card', tip: 'Generate the visuals for your scenes.' },
    video: { label: 'Assemble the video', target: 'editor-card', tip: 'Auto-assemble scenes into a timeline with motion + subtitles.' },
    youtube: { label: 'Optimize for YouTube', target: 'youtube-card', tip: 'Generate titles, thumbnail, description and SEO.' }
  };
  const STAGE_ORDER = ['script', 'voice', 'storyboard', 'images', 'video', 'youtube'];

  function nextStage() {
    const st = window.BlvckAssets.status();
    for (const k of STAGE_ORDER) if (!st[k]) return k;
    return null;
  }

  function renderNext() {
    if (!modeEl.checked) { nextEl.hidden = true; return; }
    const k = nextStage();
    nextEl.hidden = false;
    if (!k) {
      nextEl.innerHTML = '<strong>✓ All core stages done.</strong> Run a production audit before you export.';
      return;
    }
    const info = STAGE_INFO[k];
    nextEl.innerHTML = `<strong>Next step:</strong> ${esc(info.label)} — <span class="director-next-tip">${esc(info.tip)}</span> `;
    const go = document.createElement('button');
    go.className = 'btn ghost small';
    go.type = 'button';
    go.textContent = 'Go →';
    go.addEventListener('click', () => {
      const node = info.target ? document.getElementById(info.target) : document.querySelector('main.card');
      if (node) node.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    nextEl.appendChild(go);
  }

  // --- Advisory chat -----------------------------------------------------

  function renderChat() {
    if (!messages.length) { chatEl.hidden = true; return; }
    chatEl.hidden = false;
    chatEl.innerHTML = '';
    messages.forEach((m) => {
      const row = document.createElement('div');
      row.className = `director-msg director-msg-${m.role}`;
      const who = document.createElement('div');
      who.className = 'director-msg-role';
      who.textContent = m.role === 'user' ? 'You' : 'Director';
      const body = document.createElement('div');
      body.className = 'director-msg-body';
      body.textContent = m.content;
      row.append(who, body);
      chatEl.appendChild(row);
    });
    chatEl.scrollTop = chatEl.scrollHeight;
  }

  function contextMessages() {
    const snap = window.BlvckAssets.snapshot();
    return [
      { role: 'system', content: window.BlvckPrompts.directorChatSystem() },
      { role: 'system', content: `CURRENT PROJECT SNAPSHOT (JSON):\n${JSON.stringify(snap, null, 2)}` }
    ];
  }

  async function ask(text) {
    if (busy || !text.trim()) return;
    clearStatus();
    messages.push({ role: 'user', content: text.trim() });
    renderChat();
    setBusy(true);
    stopRequested = false;
    const reply = { role: 'assistant', content: '' };
    messages.push(reply);
    renderChat();
    try {
      const req = contextMessages().concat(messages.slice(0, -1).map((m) => ({ role: m.role, content: m.content })));
      await window.BlvckAI.chatStream(req, {
        onToken: (_d, full) => { reply.content = full; renderChat(); },
        shouldStop: () => stopRequested
      });
      if (!reply.content) reply.content = '(no response)';
      renderChat();
    } catch (err) {
      if (!reply.content) messages.pop();
      showStatus(err.message || 'The Director could not respond.');
      renderChat();
    } finally {
      setBusy(false);
    }
  }

  // --- Quality audit -----------------------------------------------------

  const SCORE_FIELDS = [
    ['overall', 'Overall'], ['script', 'Script'], ['retention', 'Retention'],
    ['storytelling', 'Storytelling'], ['visualConsistency', 'Visual consistency'],
    ['thumbnail', 'Thumbnail'], ['seo', 'SEO'], ['monetization', 'Monetization']
  ];
  function scoreClass(v) { return v >= 75 ? 'good' : v >= 50 ? 'ok' : 'bad'; }

  function renderAudit(audit) {
    auditResult.hidden = false;
    const s = audit.scores || {};
    const bars = SCORE_FIELDS.map(([k, label]) => {
      const v = s[k] || 0;
      return `<div class="director-score ${k === 'overall' ? 'overall' : ''}">
        <div class="director-score-head"><span>${label}</span><span class="director-score-val ${scoreClass(v)}">${v}</span></div>
        <div class="director-score-track"><div class="director-score-fill ${scoreClass(v)}" style="width:${v}%"></div></div>
      </div>`;
    }).join('');
    const list = (title, items) => items && items.length
      ? `<div class="director-audit-block"><strong>${title}</strong><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>` : '';
    const recs = (audit.recommendations || []).length
      ? `<div class="director-audit-block"><strong>Recommendations</strong>${audit.recommendations.map((r) => `<div class="director-rec pri-${r.priority}"><span class="director-rec-pri">${esc(r.priority)}</span> <strong>${esc(r.area)}:</strong> ${esc(r.action)}</div>`).join('')}</div>` : '';
    auditResult.innerHTML =
      `<div class="director-scores">${bars}</div>` +
      (audit.summary ? `<p class="director-summary">${esc(audit.summary)}</p>` : '') +
      list('Strengths', audit.strengths) +
      list('Weaknesses', audit.weaknesses) +
      recs +
      (audit.nextStep ? `<div class="director-audit-block"><strong>Do this next:</strong> ${esc(audit.nextStep)}</div>` : '');
  }

  async function runAudit() {
    if (busy) return;
    const snap = window.BlvckAssets.snapshot();
    if (!snap.script && !snap.sceneCount && !snap.seo) {
      showStatus('Nothing to audit yet — generate a script, storyboard or SEO first.');
      return;
    }
    clearStatus();
    setBusy(true);
    auditBtn.textContent = 'Auditing…';
    try {
      const body = await window.BlvckAI.generateJSON('/api/director/audit', { project: snap });
      renderAudit(body.audit);
      try { localStorage.setItem(LS_AUDIT, JSON.stringify(body.audit)); } catch { /* quota */ }
    } catch (err) {
      showStatus(err.message || 'Audit failed.');
    } finally {
      setBusy(false);
      auditBtn.textContent = 'Run production audit';
    }
  }

  // --- Wiring ------------------------------------------------------------

  auditBtn.addEventListener('click', runAudit);
  sendBtn.addEventListener('click', () => { const t = inputEl.value; inputEl.value = ''; ask(t); });
  stopBtn.addEventListener('click', () => { stopRequested = true; });
  inputEl.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { const t = inputEl.value; inputEl.value = ''; ask(t); } });
  card.querySelectorAll('[data-dcmd]').forEach((b) => b.addEventListener('click', () => ask(b.dataset.dcmd)));
  modeEl.addEventListener('change', () => {
    try { localStorage.setItem(LS_MODE, modeEl.checked ? '1' : '0'); } catch { /* quota */ }
    renderNext();
  });

  window.BlvckAssets.on(renderNext);
  setInterval(renderNext, 1500);

  // Restore
  try { modeEl.checked = localStorage.getItem(LS_MODE) === '1'; } catch { /* ignore */ }
  try { const a = JSON.parse(localStorage.getItem(LS_AUDIT) || 'null'); if (a) renderAudit(a); } catch { /* ignore */ }
  renderNext();
})();
