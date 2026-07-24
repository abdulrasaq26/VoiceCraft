// AI diagnostics panel. Runs BlvckAI.diagnose() and renders a clear report so
// a failure shows its real cause (auth / CORS / missing provider / unsupported
// model / quota) instead of a generic "generation failed" message.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const openBtn = $('ai-diagnostics-open');
  const modal = $('ai-diagnostics-modal');
  if (!openBtn || !modal) return;

  const runBtn = $('diag-run');
  const copyBtn = $('diag-copy');
  const imageChk = $('diag-image');
  const results = $('diag-results');

  let lastReport = null;

  function openModal() {
    modal.hidden = false;
    document.body.classList.add('modal-open');
  }
  function closeModal() {
    modal.hidden = true;
    if (![...document.querySelectorAll('.modal')].some((m) => !m.hidden)) {
      document.body.classList.remove('modal-open');
    }
  }

  const ICON = { ok: '✅', warn: '⚠️', fail: '❌', info: 'ℹ️' };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  }

  function render(report) {
    results.innerHTML = '';
    report.steps.forEach((step) => {
      const row = document.createElement('div');
      row.className = `diag-row diag-${step.status}`;
      const head = document.createElement('div');
      head.className = 'diag-head';
      head.innerHTML = `<span class="diag-icon">${ICON[step.status] || 'ℹ️'}</span><span class="diag-name">${esc(step.name)}</span>`;
      if (step.category) head.innerHTML += `<span class="diag-cat">${esc(step.category)}</span>`;
      const detail = document.createElement('div');
      detail.className = 'diag-detail';
      detail.textContent = step.detail || '';
      row.append(head, detail);
      if (step.raw && step.status === 'fail') {
        const raw = document.createElement('pre');
        raw.className = 'diag-raw';
        raw.textContent = step.raw;
        row.appendChild(raw);
      }
      results.appendChild(row);
    });

    // A short overall verdict.
    const fails = report.steps.filter((s) => s.status === 'fail');
    const verdict = document.createElement('div');
    verdict.className = `diag-verdict ${fails.length ? 'bad' : 'good'}`;
    if (!fails.length) {
      verdict.textContent = '✅ All live checks passed on this instance.';
    } else {
      const cats = [...new Set(fails.map((s) => s.category).filter(Boolean))];
      verdict.textContent = `❌ ${fails.length} check(s) failed — likely cause: ${cats.join(', ') || 'see details above'}.`;
    }
    results.appendChild(verdict);
  }

  function toText(report) {
    const lines = [`Blvck-TTS AI diagnostics — ${report.at || ''}`, `Page: ${report.page || ''}`, ''];
    report.steps.forEach((s) => {
      lines.push(`[${(s.status || '').toUpperCase()}] ${s.name}: ${s.detail || ''}${s.category ? ` (cause: ${s.category})` : ''}`);
      if (s.raw) lines.push(`    raw: ${s.raw}`);
    });
    return lines.join('\n');
  }

  async function run() {
    runBtn.disabled = true;
    runBtn.textContent = 'Running…';
    copyBtn.hidden = true;
    results.innerHTML = '<div class="diag-detail">Running live checks against Puter…</div>';
    try {
      lastReport = await window.BlvckAI.diagnose({ image: imageChk.checked });
      render(lastReport);
      copyBtn.hidden = false;
    } catch (e) {
      results.innerHTML = `<div class="diag-row diag-fail"><div class="diag-detail">Diagnostics crashed: ${esc(e && e.message || e)}</div></div>`;
    } finally {
      runBtn.disabled = false;
      runBtn.textContent = 'Run again';
    }
  }

  openBtn.addEventListener('click', () => { openModal(); run(); });
  runBtn.addEventListener('click', run);
  copyBtn.addEventListener('click', async () => {
    if (!lastReport) return;
    const text = toText(lastReport);
    try {
      await navigator.clipboard.writeText(text);
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy report'), 1500);
    } catch {
      // Fallback: select into a textarea.
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch { /* ignore */ }
      ta.remove();
      copyBtn.textContent = 'Copied!';
      setTimeout(() => (copyBtn.textContent = 'Copy report'), 1500);
    }
  });
  modal.querySelectorAll('[data-close]').forEach((el) => el.addEventListener('click', closeModal));
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !modal.hidden) closeModal(); });
})();
