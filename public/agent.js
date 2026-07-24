// AI Coding Agent — a chat-first coding assistant powered by Puter's chat
// models. Conversation history, project/file context, code blocks with copy,
// and a "task" mode that asks the model to reason step by step.
//
// Everything runs in the browser through window.BlvckAI.chat (Puter). No
// server round-trip and no API keys.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const card = $('agent-card');
  if (!card) return;

  const modelEl = $('agent-model');
  const modeEl = $('agent-mode');
  const messagesEl = $('agent-messages');
  const statusEl = $('agent-status');
  const inputEl = $('agent-input');
  const sendBtn = $('agent-send');
  const newBtn = $('agent-new');
  const exportBtn = $('agent-export');
  const addContextBtn = $('agent-add-context');
  const clearContextBtn = $('agent-clear-context');
  const contextListEl = $('agent-context-list');
  const contextCountEl = $('agent-context-count');
  const contextModal = $('agent-context-modal');
  const ctxNameEl = $('agent-ctx-name');
  const ctxBodyEl = $('agent-ctx-body');
  const ctxSaveEl = $('agent-ctx-save');

  const spinner = sendBtn.querySelector('.spinner');
  const sendLabel = sendBtn.querySelector('.btn-label');

  const LS_STATE = 'blvck-tts:agent';

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
      catch { return fallback; }
    },
    set(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* quota */ } }
  };

  const SYSTEM_CHAT =
    'You are an expert AI coding agent embedded in a web app, similar to Claude Code, Cursor, or Windsurf. ' +
    'You generate, edit, analyze, and debug code across languages. Be precise and concise. ' +
    'When you write code, use fenced code blocks with a language tag. When editing a provided file, show only the changed region unless a full rewrite is clearer. ' +
    'Explain your reasoning briefly before or after code, not line by line.';
  const SYSTEM_TASK =
    SYSTEM_CHAT +
    ' TASK MODE: break the request into a short numbered plan first, then execute each step, ' +
    'producing the concrete code or commands for each. End with a brief summary of what changed and any follow-ups.';

  let state = store.get(LS_STATE, null) || { model: 'claude-sonnet-4', mode: 'chat', context: [], messages: [] };
  let busy = false;

  function persist() { store.set(LS_STATE, state); }

  // --- Rendering ---------------------------------------------------------

  function showStatus(msg, type = 'error') {
    statusEl.textContent = msg;
    statusEl.className = `status ${type}`;
    statusEl.hidden = false;
  }
  function clearStatus() { statusEl.hidden = true; }

  // Minimal, safe renderer: escape everything, then turn ```lang fences into
  // <pre><code> blocks with a copy button, and `inline` code into <code>.
  function esc(s) {
    return String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function renderContent(container, text) {
    const parts = String(text).split(/```/);
    parts.forEach((part, i) => {
      if (i % 2 === 1) {
        // Code block: first line may be a language tag.
        const nl = part.indexOf('\n');
        let lang = '';
        let code = part;
        if (nl !== -1) {
          const first = part.slice(0, nl).trim();
          if (/^[a-z0-9+#.-]{1,20}$/i.test(first)) { lang = first; code = part.slice(nl + 1); }
        }
        const wrap = document.createElement('div');
        wrap.className = 'agent-code';
        const head = document.createElement('div');
        head.className = 'agent-code-head';
        head.innerHTML = `<span>${esc(lang || 'code')}</span>`;
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'btn ghost small';
        copy.textContent = 'Copy';
        copy.addEventListener('click', async () => {
          try { await navigator.clipboard.writeText(code.replace(/\n$/, '')); copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy'), 1200); }
          catch { /* ignore */ }
        });
        head.appendChild(copy);
        const pre = document.createElement('pre');
        const codeEl = document.createElement('code');
        codeEl.textContent = code.replace(/\n$/, '');
        pre.appendChild(codeEl);
        wrap.append(head, pre);
        container.appendChild(wrap);
      } else if (part) {
        const p = document.createElement('div');
        p.className = 'agent-text';
        // inline `code`
        p.innerHTML = esc(part).replace(/`([^`\n]+)`/g, '<code>$1</code>').replace(/\n/g, '<br>');
        container.appendChild(p);
      }
    });
  }

  function renderMessages() {
    messagesEl.innerHTML = '';
    if (!state.messages.length) {
      const empty = document.createElement('div');
      empty.className = 'agent-empty';
      empty.textContent = 'Ask the agent anything about code — write a function, explain a file, find a bug.';
      messagesEl.appendChild(empty);
      return;
    }
    state.messages.forEach((m) => {
      const row = document.createElement('div');
      row.className = `agent-msg agent-msg-${m.role}`;
      const who = document.createElement('div');
      who.className = 'agent-msg-role';
      who.textContent = m.role === 'user' ? 'You' : 'Agent';
      const body = document.createElement('div');
      body.className = 'agent-msg-body';
      renderContent(body, m.content);
      row.append(who, body);
      messagesEl.appendChild(row);
    });
    messagesEl.scrollTop = messagesEl.scrollHeight;
  }

  function renderContext() {
    contextListEl.innerHTML = '';
    contextCountEl.textContent = state.context.length ? `(${state.context.length})` : '';
    state.context.forEach((f, i) => {
      const chip = document.createElement('span');
      chip.className = 'agent-context-chip';
      chip.textContent = f.name;
      const x = document.createElement('button');
      x.type = 'button';
      x.textContent = '×';
      x.title = 'Remove';
      x.addEventListener('click', () => { state.context.splice(i, 1); persist(); renderContext(); });
      chip.appendChild(x);
      contextListEl.appendChild(chip);
    });
  }

  // --- Chat --------------------------------------------------------------

  function buildMessages() {
    const system = state.mode === 'task' ? SYSTEM_TASK : SYSTEM_CHAT;
    const msgs = [{ role: 'system', content: system }];
    if (state.context.length) {
      const ctx = state.context
        .map((f) => `FILE: ${f.name}\n\`\`\`\n${f.body}\n\`\`\``)
        .join('\n\n');
      msgs.push({ role: 'system', content: `PROJECT CONTEXT — the user has shared these files:\n\n${ctx}` });
    }
    // Cap history sent to the model to keep requests bounded.
    state.messages.slice(-20).forEach((m) => msgs.push({ role: m.role, content: m.content }));
    return msgs;
  }

  function setBusy(b) {
    busy = b;
    sendBtn.disabled = b;
    spinner.hidden = !b;
    sendLabel.textContent = b ? 'Thinking…' : 'Send';
  }

  async function send() {
    if (busy) return;
    const text = inputEl.value.trim();
    if (!text) return;
    clearStatus();
    state.messages.push({ role: 'user', content: text });
    inputEl.value = '';
    persist();
    renderMessages();
    setBusy(true);
    try {
      const reply = await window.BlvckAI.chat(buildMessages(), { model: state.model });
      state.messages.push({ role: 'assistant', content: reply || '(empty response)' });
      persist();
      renderMessages();
    } catch (err) {
      showStatus(err.message || 'The agent request failed.');
      // Roll back the unanswered user turn's "pending" feel by leaving it —
      // the user can retry; keep their message in the transcript.
    } finally {
      setBusy(false);
    }
  }

  // --- Context modal -----------------------------------------------------

  function openModal(m) { m.hidden = false; document.body.classList.add('modal-open'); }
  function closeModal(m) { m.hidden = true; if (contextModal.hidden) document.body.classList.remove('modal-open'); }

  addContextBtn.addEventListener('click', () => {
    ctxNameEl.value = '';
    ctxBodyEl.value = '';
    openModal(contextModal);
    ctxNameEl.focus();
  });
  ctxSaveEl.addEventListener('click', () => {
    const name = ctxNameEl.value.trim() || `file-${state.context.length + 1}.txt`;
    const body = ctxBodyEl.value;
    if (!body.trim()) { closeModal(contextModal); return; }
    state.context.push({ name, body });
    persist();
    renderContext();
    closeModal(contextModal);
  });
  contextModal.querySelectorAll('[data-close]').forEach((el) =>
    el.addEventListener('click', () => closeModal(contextModal))
  );
  clearContextBtn.addEventListener('click', () => { state.context = []; persist(); renderContext(); });

  // --- Wiring ------------------------------------------------------------

  sendBtn.addEventListener('click', send);
  inputEl.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') send();
  });
  modelEl.addEventListener('change', () => { state.model = modelEl.value; persist(); });
  modeEl.addEventListener('change', () => { state.mode = modeEl.value; persist(); });
  newBtn.addEventListener('click', () => {
    if (state.messages.length && !window.confirm('Start a new conversation? The current one will be cleared.')) return;
    state.messages = [];
    persist();
    renderMessages();
    clearStatus();
  });
  exportBtn.addEventListener('click', () => {
    if (!state.messages.length) return;
    const md = state.messages.map((m) => `## ${m.role === 'user' ? 'You' : 'Agent'}\n\n${m.content}`).join('\n\n');
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'coding-agent-conversation.md';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  // --- Init --------------------------------------------------------------

  modelEl.value = state.model;
  modeEl.value = state.mode;
  renderContext();
  renderMessages();
  card.hidden = false;
})();
