// Provider Health Dashboard & Dynamic Model Catalog for Blvck-TTS v5.1
// Real-time monitoring UI rendering health statuses, key pools with state badges, Kokoro local server status, and dynamic models
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  async function renderDashboard() {
    const container = $('provider-dashboard-content');
    if (!container) return;

    const PM = window.ProviderManager;
    const MR = window.ModelRegistry;
    const pools = PM ? PM.getAllPools() : {};

    let kokoroStatus = { online: false, endpoint: 'http://localhost:8880' };
    if (window.KokoroAdapter) {
      kokoroStatus = await window.KokoroAdapter.probeKokoro();
    }

    // Sync models if needed
    if (MR && MR.getDiscoveredModels().length === 0) {
      await MR.syncAllGateways();
    }

    const discoveredModels = MR ? MR.getDiscoveredModels() : [];

    function renderKeyPoolBadgeList(provider) {
      const keyStates = PM.getPoolKeyStates(provider);
      if (!keyStates.length) return '<span style="color:#a1a1aa; font-size:12px;">No keys configured</span>';

      return keyStates.map(ks => `
        <span style="display:inline-block; padding:3px 8px; border-radius:12px; font-size:12px; margin-right:4px; margin-bottom:4px; background:${ks.state === 'active' ? 'rgba(16,185,129,0.15)' : ks.state === 'exhausted' ? 'rgba(239,68,68,0.15)' : 'rgba(255,255,255,0.05)'}; border:1px solid ${ks.state === 'active' ? '#10b981' : ks.state === 'exhausted' ? '#ef4444' : 'rgba(255,255,255,0.2)'}; color:${ks.state === 'active' ? '#10b981' : ks.state === 'exhausted' ? '#ef4444' : '#e2e8f0'};">
          ${ks.symbol} Key #${ks.index + 1} (${ks.label})
        </span>
      `).join('');
    }

    let html = `
      <!-- Section 1: Dynamic Discovered Model Catalog -->
      <div style="margin-bottom:20px; padding:12px; background:rgba(255,255,255,0.03); border-radius:8px; border:1px solid rgba(255,255,255,0.1);">
        <h4 style="margin:0 0 10px 0; color:var(--accent, #6366f1); font-size:14px;">🧠 Discovered Models Catalog (${discoveredModels.length} Discovered via GET /v1/models)</h4>
        <div style="display:flex; flex-wrap:wrap; gap:6px;">
          ${discoveredModels.map(m => `
            <span style="padding:4px 10px; background:rgba(99,102,241,0.15); border:1px solid #6366f1; border-radius:6px; font-size:12px; color:#fff;" title="Provider: ${m.provider}">
              ✓ ${m.id} ${m.supportsReasoning ? '🧠' : ''}
            </span>
          `).join('')}
        </div>
      </div>

      <!-- Section 2: Multi-Key Provider Pools -->
      <div class="provider-grid" style="display:grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap:12px;">
        <!-- NVIDIA NIM Gateway -->
        <div class="provider-card" style="padding:12px; background:#1e1e24; border-radius:8px; border:1px solid rgba(255,255,255,0.15);">
          <div class="provider-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong>🚀 NVIDIA NIM Gateway</strong>
            <span class="badge ${pools.nim.keys.length > 0 ? 'success' : 'warning'}" style="padding:2px 8px; border-radius:4px; font-size:11px; background:${pools.nim.keys.length > 0 ? '#10b981' : '#f59e0b'}; color:#000;">${pools.nim.keys.length} Keys Configured</span>
          </div>
          <div style="margin-top:6px;">${renderKeyPoolBadgeList('nim')}</div>
          ${pools.nim.logs.length ? `<pre style="font-size:10px; background:#000; padding:6px; margin-top:6px; border-radius:4px; color:#f87171; overflow-x:auto;">${pools.nim.logs[0]}</pre>` : ''}
        </div>

        <!-- OpenRouter -->
        <div class="provider-card" style="padding:12px; background:#1e1e24; border-radius:8px; border:1px solid rgba(255,255,255,0.15);">
          <div class="provider-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong>🌐 OpenRouter Gateway</strong>
            <span class="badge ${pools.openrouter.keys.length > 0 ? 'success' : 'warning'}" style="padding:2px 8px; border-radius:4px; font-size:11px; background:${pools.openrouter.keys.length > 0 ? '#10b981' : '#f59e0b'}; color:#000;">${pools.openrouter.keys.length} Keys</span>
          </div>
          <div style="margin-top:6px;">${renderKeyPoolBadgeList('openrouter')}</div>
        </div>

        <!-- Kokoro Local -->
        <div class="provider-card" style="padding:12px; background:#1e1e24; border-radius:8px; border:1px solid rgba(255,255,255,0.15);">
          <div class="provider-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong>🔊 Kokoro Local TTS</strong>
            <span style="padding:2px 8px; border-radius:4px; font-size:11px; background:${kokoroStatus.online ? '#10b981' : '#ef4444'}; color:#fff;">${kokoroStatus.online ? '🟢 Kokoro Online' : '🔴 Kokoro Offline'}</span>
          </div>
          <p class="field-note" style="margin:4px 0 0 0; font-size:12px; color:#a1a1aa;">Endpoint: ${kokoroStatus.endpoint}</p>
        </div>

        <!-- ElevenLabs -->
        <div class="provider-card" style="padding:12px; background:#1e1e24; border-radius:8px; border:1px solid rgba(255,255,255,0.15);">
          <div class="provider-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong>🎙️ ElevenLabs Pool</strong>
            <span class="badge ${pools.elevenlabs.keys.length > 0 ? 'success' : 'warning'}" style="padding:2px 8px; border-radius:4px; font-size:11px; background:${pools.elevenlabs.keys.length > 0 ? '#10b981' : '#f59e0b'}; color:#000;">${pools.elevenlabs.keys.length} Keys</span>
          </div>
          <div style="margin-top:6px;">${renderKeyPoolBadgeList('elevenlabs')}</div>
        </div>

        <!-- Fal.ai -->
        <div class="provider-card" style="padding:12px; background:#1e1e24; border-radius:8px; border:1px solid rgba(255,255,255,0.15);">
          <div class="provider-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong>🎨 Fal.ai Image Pool</strong>
            <span class="badge ${pools.fal.keys.length > 0 ? 'success' : 'warning'}" style="padding:2px 8px; border-radius:4px; font-size:11px; background:${pools.fal.keys.length > 0 ? '#10b981' : '#f59e0b'}; color:#000;">${pools.fal.keys.length} Keys</span>
          </div>
          <div style="margin-top:6px;">${renderKeyPoolBadgeList('fal')}</div>
        </div>

        <!-- Replicate -->
        <div class="provider-card" style="padding:12px; background:#1e1e24; border-radius:8px; border:1px solid rgba(255,255,255,0.15);">
          <div class="provider-header" style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px;">
            <strong>🖼️ Replicate Pool</strong>
            <span class="badge ${pools.replicate.keys.length > 0 ? 'success' : 'warning'}" style="padding:2px 8px; border-radius:4px; font-size:11px; background:${pools.replicate.keys.length > 0 ? '#10b981' : '#f59e0b'}; color:#000;">${pools.replicate.keys.length} Keys</span>
          </div>
          <div style="margin-top:6px;">${renderKeyPoolBadgeList('replicate')}</div>
        </div>
      </div>
    `;

    container.innerHTML = html;
  }

  window.addEventListener('blvck:provider-status-changed', renderDashboard);
  window.addEventListener('blvck:models-updated', renderDashboard);

  window.ProviderDashboard = {
    renderDashboard
  };
})();
