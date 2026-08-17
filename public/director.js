// AI Production Director 3.0 & Decision Transparency Engine for Blvck-TTS v5.1
// Displays transparent decision logic, selected models, reasoning, and handles task-aware model routing over NVIDIA NIM Gateway
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // Director Elements
  const directorInput = $('director-input');
  const directorSendBtn = $('director-send');
  const directorChat = $('director-chat');
  const directorStatus = $('director-status');
  const directorAuditBtn = $('director-audit');

  // Agent Elements
  const agentInput = $('agent-input');
  const agentSendBtn = $('agent-send');
  const agentMessages = $('agent-messages');
  const agentStatus = $('agent-status');

  const DIRECTOR_AUTHORITY_KEY = 'blvck:director_authority_mode'; // AUTO | SEMI-AUTO | MANUAL

  function getAuthorityMode() {
    return localStorage.getItem(DIRECTOR_AUTHORITY_KEY) || 'AUTO';
  }

  function setAuthorityMode(mode) {
    localStorage.setItem(DIRECTOR_AUTHORITY_KEY, mode);
  }

  // Preflight Cost & Time Estimator
  function calculatePreflightCostTime(sceneCount = 10, wordCount = 800) {
    const tokens = Math.round(wordCount * 1.35);
    const audioMinutes = Math.round((wordCount / 150) * 10) / 10;
    const scriptCost = (tokens / 1000) * 0.002;
    const ttsCost = audioMinutes * 0.03;
    const imageCost = sceneCount * 0.04;
    const videoCost = sceneCount * 0.20;
    const totalCost = Math.round((scriptCost + ttsCost + imageCost + videoCost) * 100) / 100;
    const estimatedTimeSec = Math.round(30 + (sceneCount * 15));
    const estimatedTimeMin = Math.round((estimatedTimeSec / 60) * 10) / 10;

    return {
      wordCount,
      sceneCount,
      audioMinutes,
      scriptCost: scriptCost.toFixed(3),
      ttsCost: ttsCost.toFixed(2),
      imageCost: imageCost.toFixed(2),
      videoCost: videoCost.toFixed(2),
      totalCost: `$${totalCost.toFixed(2)}`,
      estimatedTime: `~${estimatedTimeMin} mins`
    };
  }

  // AI Director Chat Handler with Transparent Model Decision UI
  async function askDirector(prompt, task = 'director') {
    if (!prompt || !prompt.trim()) return;
    const userMsg = prompt.trim();
    if (directorInput) directorInput.value = '';

    // Inspect Director Model Selection Decision
    const decision = await window.BlvckAI.resolveChatModel(task);

    if (directorChat) {
      directorChat.hidden = false;
      const userBubble = document.createElement('div');
      userBubble.style.cssText = 'background: rgba(99,102,241,0.2); padding: 10px 14px; border-radius: 8px; margin-bottom: 10px; border-left: 3px solid #6366f1; color: #fff;';
      userBubble.innerHTML = `<strong>👤 You:</strong> ${escapeHTML(userMsg)}`;
      directorChat.appendChild(userBubble);

      // Render Transparent AI Director Decision Badge
      const decisionBadge = document.createElement('div');
      decisionBadge.style.cssText = 'background: rgba(16,185,129,0.1); border: 1px dashed #10b981; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; font-size: 12px; color: #a7f3d0; line-height: 1.5;';
      decisionBadge.innerHTML = `
        <strong>🎬 AI Director Model Decision</strong><br>
        <strong>Provider:</strong> NVIDIA NIM Gateway<br>
        <strong>Selected Model:</strong> <code>${decision.selectedModel}</code><br>
        <strong>Reason:</strong> ${decision.reason}<br>
        <strong>Fallback Model:</strong> <code>${decision.fallbackModel}</code>
      `;
      directorChat.appendChild(decisionBadge);
      directorChat.scrollTop = directorChat.scrollHeight;
    }

    if (directorStatus) {
      directorStatus.hidden = false;
      directorStatus.textContent = `🎬 Executing via NVIDIA NIM [${decision.selectedModel}]…`;
    }

    try {
      const systemPrompt = `You are the Executive AI Production Director for Blvck-TTS. Provide actionable, concise advice on scripting, narration, asset consistency, historical accuracy, and YouTube CTR optimization. Input: ${userMsg}`;
      const reply = await window.AIManager.chat(systemPrompt, { task });

      if (directorChat) {
        const aiBubble = document.createElement('div');
        aiBubble.style.cssText = 'background: rgba(255,255,255,0.05); padding: 12px 16px; border-radius: 8px; margin-bottom: 12px; border-left: 3px solid #10b981; color: #e2e8f0; line-height: 1.5;';
        aiBubble.innerHTML = `<strong>🎬 AI Director:</strong><br><br>${formatReply(reply)}`;
        directorChat.appendChild(aiBubble);
        directorChat.scrollTop = directorChat.scrollHeight;
      }
    } catch (err) {
      if (directorChat) {
        const errBubble = document.createElement('div');
        errBubble.style.cssText = 'background: rgba(239,68,68,0.15); padding: 10px; border-radius: 8px; color: #f87171;';
        errBubble.textContent = `❌ Director Error: ${err.message}`;
        directorChat.appendChild(errBubble);
      }
    } finally {
      if (directorStatus) directorStatus.hidden = true;
    }
  }

  // AI Coding Agent Handler
  async function askAgent(prompt) {
    if (!prompt || !prompt.trim()) return;
    const userMsg = prompt.trim();
    if (agentInput) agentInput.value = '';

    const decision = await window.BlvckAI.resolveChatModel('code');

    if (agentMessages) {
      const userBubble = document.createElement('div');
      userBubble.style.cssText = 'background: rgba(99,102,241,0.2); padding: 10px 14px; border-radius: 8px; margin-bottom: 10px; border-left: 3px solid #6366f1; color: #fff;';
      userBubble.innerHTML = `<strong>👨‍💻 You:</strong> ${escapeHTML(userMsg)}`;
      agentMessages.appendChild(userBubble);

      const decisionBadge = document.createElement('div');
      decisionBadge.style.cssText = 'background: rgba(59,130,246,0.1); border: 1px dashed #3b82f6; border-radius: 8px; padding: 8px 12px; margin-bottom: 10px; font-size: 12px; color: #93c5fd;';
      decisionBadge.innerHTML = `⚡ <strong>Coding Agent Model Decision:</strong> Selected <code>${decision.selectedModel}</code> via NVIDIA NIM Gateway (${decision.reason})`;
      agentMessages.appendChild(decisionBadge);
      agentMessages.scrollTop = agentMessages.scrollHeight;
    }

    if (agentStatus) {
      agentStatus.hidden = false;
      agentStatus.textContent = `⚡ Coding Agent running [${decision.selectedModel}]…`;
    }

    try {
      const systemPrompt = `You are an expert AI Coding Agent for Blvck-TTS. Write clean, bug-free HTML/CSS/JS code snippets to answer the request. Input: ${userMsg}`;
      const reply = await window.AIManager.chat(systemPrompt, { task: 'code' });

      if (agentMessages) {
        const aiBubble = document.createElement('div');
        aiBubble.style.cssText = 'background: rgba(255,255,255,0.05); padding: 12px 16px; border-radius: 8px; margin-bottom: 12px; border-left: 3px solid #3b82f6; color: #e2e8f0; line-height: 1.5;';
        aiBubble.innerHTML = `<strong>⚡ Coding Agent:</strong><br><br>${formatReply(reply)}`;
        agentMessages.appendChild(aiBubble);
        agentMessages.scrollTop = agentMessages.scrollHeight;
      }
    } catch (err) {
      if (agentMessages) {
        const errBubble = document.createElement('div');
        errBubble.style.cssText = 'background: rgba(239,68,68,0.15); padding: 10px; border-radius: 8px; color: #f87171;';
        errBubble.textContent = `❌ Agent Error: ${err.message}`;
        agentMessages.appendChild(errBubble);
      }
    } finally {
      if (agentStatus) agentStatus.hidden = true;
    }
  }

  // Model Failover Toast Event Listener
  window.addEventListener('blvck:model-failover', (e) => {
    const { failedModel, activeModel } = e.detail;
    const toast = document.createElement('div');
    toast.style.cssText = 'position:fixed; bottom:20px; right:20px; z-index:9999; background:#7f1d1d; color:#fca5a5; padding:12px 18px; border-radius:8px; border:1px solid #ef4444; font-size:13px; box-shadow:0 4px 12px rgba(0,0,0,0.5);';
    toast.innerHTML = `⚠️ <strong>${failedModel}</strong> unavailable<br>✓ Automatically switched to <strong>${activeModel}</strong> on NVIDIA NIM`;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 6000);
  });

  function escapeHTML(str) {
    return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function formatReply(text) {
    return escapeHTML(text)
      .replace(/```([\s\S]*?)```/g, '<pre style="background:#0f172a; padding:10px; border-radius:6px; overflow-x:auto;"><code>$1</code></pre>')
      .replace(/\n/g, '<br>');
  }

  // Event Binding
  if (directorSendBtn && directorInput) {
    directorSendBtn.addEventListener('click', () => askDirector(directorInput.value));
    directorInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey || e.key === 'Enter') && !e.shiftKey) {
        if (e.key === 'Enter') e.preventDefault();
        askDirector(directorInput.value);
      }
    });
  }

  document.querySelectorAll('[data-dcmd]').forEach(btn => {
    btn.addEventListener('click', () => askDirector(btn.dataset.dcmd));
  });

  if (directorAuditBtn) {
    directorAuditBtn.addEventListener('click', () => askDirector('Run a full production audit on my current project script, voices, and scene pacing.'));
  }

  if (agentSendBtn && agentInput) {
    agentSendBtn.addEventListener('click', () => askAgent(agentInput.value));
    agentInput.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey || e.key === 'Enter') && !e.shiftKey) {
        if (e.key === 'Enter') e.preventDefault();
        askAgent(agentInput.value);
      }
    });
  }

  window.Director = {
    getAuthorityMode,
    setAuthorityMode,
    askDirector,
    askAgent
  };
})();
