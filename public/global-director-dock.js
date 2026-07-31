// Global AI Director Dock & Floating Assistant Module for AETHER AI Studio
// Provides an omnipresent AI Assistant widget, header status pill, and context-aware action triggers across all Studio workspaces
(() => {
  'use strict';

  function createDirectorDock() {
    if (document.getElementById('aether-director-dock')) return;

    const dock = document.createElement('div');
    dock.id = 'aether-director-dock';
    dock.className = 'director-floating-dock';
    dock.innerHTML = `
      <button id="director-dock-toggle" class="director-dock-trigger" type="button" title="Open AI Production Director (Ctrl+Space)">
        <span class="dock-avatar">🎬</span>
        <span class="dock-label">AI Director</span>
        <span id="director-dock-badge" class="dock-badge" hidden>1</span>
      </button>

      <div id="director-dock-panel" class="director-dock-panel" hidden>
        <div class="dock-header">
          <div class="dock-title">
            <span>🎬 AI Production Director</span>
            <span id="director-dock-status-pill" class="badge">Active</span>
          </div>
          <button id="director-dock-close" class="btn ghost small" type="button" aria-label="Close">✕</button>
        </div>

        <div id="director-dock-messages" class="dock-messages">
          <div class="dock-msg system">
            👋 <strong>Welcome to AETHER AI Studio!</strong> I am your Production Director. I monitor your project state and can assist with scripting, voice selection, storyboarding, and video optimization.
          </div>
        </div>

        <div class="dock-context-bar">
          <button id="dock-quick-audit" class="btn ghost small" type="button">Audit Current Workspace</button>
          <button id="dock-quick-next" class="btn ghost small" type="button">Recommend Next Step</button>
        </div>

        <div class="dock-input-area">
          <textarea id="dock-input" rows="2" placeholder="Ask AI Director anything about this project..."></textarea>
          <button id="dock-send" class="btn primary small" type="button">Ask</button>
        </div>
      </div>
    `;

    document.body.appendChild(dock);

    const toggleBtn = document.getElementById('director-dock-toggle');
    const panel = document.getElementById('director-dock-panel');
    const closeBtn = document.getElementById('director-dock-close');
    const sendBtn = document.getElementById('dock-send');
    const input = document.getElementById('dock-input');
    const quickAudit = document.getElementById('dock-quick-audit');
    const quickNext = document.getElementById('dock-quick-next');
    const messages = document.getElementById('director-dock-messages');

    function togglePanel(show) {
      const isVisible = show !== undefined ? show : panel.hidden;
      panel.hidden = !isVisible;
      if (isVisible) input.focus();
    }

    toggleBtn.addEventListener('click', () => togglePanel());
    closeBtn.addEventListener('click', () => togglePanel(false));

    // Keyboard shortcut Ctrl+Space to toggle Director
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.code === 'Space') {
        e.preventDefault();
        togglePanel();
      }
    });

    async function sendPrompt(text) {
      if (!text || !text.trim()) return;
      const userMsg = text.trim();
      input.value = '';

      // Append user msg
      const userEl = document.createElement('div');
      userEl.className = 'dock-msg user';
      userEl.textContent = userMsg;
      messages.appendChild(userEl);
      messages.scrollTop = messages.scrollHeight;

      // Append bot placeholder
      const botEl = document.createElement('div');
      botEl.className = 'dock-msg assistant';
      botEl.innerHTML = 'Thinking... <span class="spinner small"></span>';
      messages.appendChild(botEl);
      messages.scrollTop = messages.scrollHeight;

      try {
        const workspace = window.AetherRouter ? window.AetherRouter.currentWorkspace : 'dashboard';
        const fullPrompt = `[Workspace Context: ${workspace.toUpperCase()}] ${userMsg}`;
        const response = await window.BlvckAI.chat(fullPrompt);
        botEl.innerHTML = (window.marked ? window.marked.parse(response) : response);
      } catch (err) {
        botEl.className = 'dock-msg error';
        botEl.textContent = `Director Error: ${err.message}`;
      }
      messages.scrollTop = messages.scrollHeight;
    }

    sendBtn.addEventListener('click', () => sendPrompt(input.value));
    input.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        sendPrompt(input.value);
      }
    });

    quickAudit.addEventListener('click', () => {
      const ws = window.AetherRouter ? window.AetherRouter.currentWorkspace : 'current workspace';
      sendPrompt(`Run a full quality audit on my project's ${ws} stage.`);
    });

    quickNext.addEventListener('click', () => {
      sendPrompt(`What is the single most important thing I should do next on this project?`);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', createDirectorDock);
  } else {
    createDirectorDock();
  }
})();
