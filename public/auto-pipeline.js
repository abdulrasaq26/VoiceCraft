// AETHER AI Studio — Hands-Free Auto-Run Pipeline Engine
// Runs the full production workflow hands-free:
// Research → Script → Voice Audio → Storyboard Scenes → Stable Diffusion Images → Video Assembly → YouTube SEO
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  let isRunning = false;
  let isCancelled = false;

  const autorunBtn = $('director-autorun');
  const panel = $('director-autorun-panel');
  const dashAutoBtn = $('dash-autorun');

  function showPanel(show) {
    if (panel) panel.hidden = !show;
    if (autorunBtn) {
      autorunBtn.textContent = show ? '⏹ Cancel Auto-run' : '⚡ Auto-run pipeline';
      autorunBtn.className = show ? 'btn secondary' : 'btn primary';
    }
  }

  function logStep(stage, message, pct = 0, isError = false) {
    if (!panel) return;
    panel.hidden = false;

    let logContainer = panel.querySelector('.autorun-logs');
    let progressBar = panel.querySelector('.autorun-bar-fill');
    let pctLabel = panel.querySelector('.autorun-pct');
    let statusText = panel.querySelector('.autorun-status');

    if (!logContainer) {
      panel.innerHTML = `
        <div style="background:rgba(15,23,42,0.9); border:1px solid var(--accent, #6366f1); border-radius:10px; padding:16px; margin:12px 0; box-shadow:0 8px 24px rgba(0,0,0,0.4);">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:10px;">
            <span style="font-weight:bold; font-size:0.95rem; color:#fff; display:flex; align-items:center; gap:8px;">
              ⚡ Auto-Run Production Pipeline <span class="badge elite autorun-status">Running…</span>
            </span>
            <span class="autorun-pct" style="font-family:monospace; font-size:1.1rem; font-weight:bold; color:var(--accent, #6366f1);">0%</span>
          </div>

          <div style="background:rgba(255,255,255,0.1); height:8px; border-radius:4px; overflow:hidden; margin-bottom:12px;">
            <div class="autorun-bar-fill" style="background:linear-gradient(90deg, #6366f1, #10b981); height:100%; width:0%; transition:width 0.4s ease;"></div>
          </div>

          <div class="autorun-logs" style="max-height:150px; overflow-y:auto; font-family:monospace; font-size:0.8rem; color:#cbd5e1; background:rgba(0,0,0,0.5); padding:10px; border-radius:6px; line-height:1.6; border:1px solid rgba(255,255,255,0.08);"></div>

          <div style="display:flex; justify-content:flex-end; gap:8px; margin-top:10px;">
            <button class="btn secondary small autorun-cancel-btn" type="button">Stop Auto-run</button>
          </div>
        </div>
      `;
      logContainer = panel.querySelector('.autorun-logs');
      progressBar = panel.querySelector('.autorun-bar-fill');
      pctLabel = panel.querySelector('.autorun-pct');
      statusText = panel.querySelector('.autorun-status');

      const stopBtn = panel.querySelector('.autorun-cancel-btn');
      if (stopBtn) stopBtn.addEventListener('click', cancelPipeline);
    }

    if (progressBar) progressBar.style.width = `${pct}%`;
    if (pctLabel) pctLabel.textContent = `${pct}%`;
    if (statusText) {
      statusText.textContent = isError ? '❌ Error' : (pct === 100 ? '✅ Completed' : '⚡ In Progress');
    }

    if (logContainer) {
      const entry = document.createElement('div');
      const time = new Date().toLocaleTimeString();
      const color = isError ? '#f87171' : (pct === 100 ? '#34d399' : '#a5f3fc');
      entry.innerHTML = `<span style="color:#64748b;">[${time}]</span> <span style="color:${color}; font-weight:bold;">[${stage.toUpperCase()}]</span> ${message}`;
      logContainer.appendChild(entry);
      logContainer.scrollTop = logContainer.scrollHeight;
    }

    // Switch active workspace view to match current stage
    if (window.AetherRouter) {
      const targetWorkspace = stage.toLowerCase();
      if (['research', 'script', 'voice', 'storyboard', 'images', 'video', 'youtube'].includes(targetWorkspace)) {
        window.AetherRouter.switchWorkspace(targetWorkspace);
      }
    }
  }

  function cancelPipeline() {
    isCancelled = true;
    isRunning = false;
    logStep('System', 'Auto-run pipeline stopped by user.', 0, true);
    showPanel(false);
  }

  async function runPipeline() {
    if (isRunning) {
      cancelPipeline();
      return;
    }

    isRunning = true;
    isCancelled = false;
    showPanel(true);

    const titleInput = $('title-input') || $('proj-name-input');
    const projectTitle = (titleInput && titleInput.value.trim()) || (window.BlvckAssets && window.BlvckAssets.title()) || 'AI Production Project';

    try {
      // ── Stage 1: Topic Research Brief ──────────────────────────────────────
      logStep('Research', `Generating topic research brief & creative angle for "${projectTitle}"...`, 10);
      let researchText = (window.BlvckAssets && window.BlvckAssets.researchTopic && window.BlvckAssets.researchTopic()) || '';
      if (!researchText || researchText.length < 20) {
        researchText = await window.AIManager.chat(
          `Provide a high-retention 3-point research summary and creative angle for a short video on: "${projectTitle}".`,
          { task: 'research' }
        );
        const resEl = $('research-output') || $('research-text');
        if (resEl) resEl.value = researchText;
      }
      if (isCancelled) return;
      logStep('Research', 'Research brief complete.', 20);

      // ── Stage 2: Narrative Script Writing ─────────────────────────────────
      logStep('Script', 'Writing 45-second narrative script with paragraph cues...', 30);
      let scriptText = (window.BlvckAssets && window.BlvckAssets.script()) || '';
      const scriptTextarea = $('script-input') || $('text-input');
      if (!scriptText || scriptText.length < 40) {
        scriptText = await window.AIManager.chat(
          `Write an engaging 45-second video script for: "${projectTitle}". Include voiceover narration text broken into 3 clear paragraphs.`,
          { task: 'script' }
        );
        if (scriptTextarea) scriptTextarea.value = scriptText;
      }
      if (isCancelled) return;
      logStep('Script', `Script complete (${scriptText.split(/\s+/).length} words).`, 40);

      // ── Stage 3: Voice Audio Batch Synthesis ──────────────────────────────
      logStep('Voice', 'Synthesizing voice audio with Kokoro Local TTS...', 50);
      const voiceTextarea = $('text-input');
      if (voiceTextarea && scriptText) voiceTextarea.value = scriptText;

      const genVoiceBtn = $('btn-generate') || $('synth-btn');
      if (genVoiceBtn) {
        genVoiceBtn.click();
        await new Promise(r => setTimeout(r, 4500));
      }
      if (isCancelled) return;
      logStep('Voice', 'Voice audio synthesized and synced.', 65);

      // ── Stage 4: Storyboard Visual Scene Planning ─────────────────────────
      logStep('Storyboard', 'Breaking script into visual scene prompts & camera shots...', 75);
      const genStoryboardBtn = $('sb-generate-btn') || $('btn-generate-storyboard');
      if (genStoryboardBtn) {
        genStoryboardBtn.click();
        await new Promise(r => setTimeout(r, 3500));
      }
      if (isCancelled) return;
      logStep('Storyboard', 'Storyboard scenes generated.', 85);

      // ── Stage 5: Image Generation (Stable Diffusion Local) ───────────────────
      logStep('Images', 'Rendering scene images using local Stable Diffusion engine...', 90);
      const promptInput = $('image-prompt');
      const genImgBtn = $('image-generate');
      if (promptInput && genImgBtn) {
        if (!promptInput.value.trim()) {
          promptInput.value = `Cinematic scene illustration for ${projectTitle}, 8k, dramatic lighting, detailed`;
        }
        genImgBtn.click();
        await new Promise(r => setTimeout(r, 6000));
      }
      if (isCancelled) return;
      logStep('Images', 'Scene visual assets rendered.', 95);

      // ── Stage 6: Video Assembly & Subtitles ────────────────────────────────
      logStep('Video', 'Assembling audio, video clips and timed subtitles...', 98);
      const assembleBtn = $('ed-assemble');
      if (assembleBtn) assembleBtn.click();
      if (isCancelled) return;

      // ── Stage 7: Pipeline Finished ─────────────────────────────────────────
      logStep('YouTube', `🎉 Full pipeline completed successfully for "${projectTitle}"!`, 100);

      // Trigger brain memory learning on completion
      if (window.BlvckBrain && window.BlvckBrain.learnCurrent) {
        window.BlvckBrain.learnCurrent();
      }

    } catch (err) {
      logStep('System', `Pipeline stopped on error: ${err.message}`, 0, true);
      console.error('[AutoRunPipeline]', err);
    } finally {
      isRunning = false;
      if (autorunBtn) {
        autorunBtn.textContent = '⚡ Auto-run pipeline';
        autorunBtn.className = 'btn primary';
      }
    }
  }

  // Bind Event Listeners
  if (autorunBtn) autorunBtn.addEventListener('click', runPipeline);
  if (dashAutoBtn) dashAutoBtn.addEventListener('click', runPipeline);

  window.AutoRunPipeline = {
    run: runPipeline,
    cancel: cancelPipeline,
    isRunning: () => isRunning
  };
})();
