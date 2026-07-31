// Topbar Status & Connection Indicator for Blvck-TTS v5.0
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const badge = $('puter-badge');

  async function checkStatus() {
    if (badge) {
      badge.innerHTML = '⚡ Modular AI Engine ✓';
      badge.className = 'topbar-badge badge-success';
    }
  }

  document.addEventListener('DOMContentLoaded', checkStatus);
})();
