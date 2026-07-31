// Channel Brain UI — shows what the brain has learned (preferred style / voice
// / tone across projects) and what performs (from logged video stats), lets you
// log a published video's results, and folds the current project into memory.
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const card = $('brain-card');
  if (!card || !window.BlvckBrain) return;

  const prefsEl = $('brain-prefs');
  const insightsEl = $('brain-insights');
  const perfListEl = $('brain-perf-list');
  const titleEl = $('brain-perf-title');
  const titleListEl = $('brain-perf-titles');
  const themeEl = $('brain-perf-theme');
  const viewsEl = $('brain-perf-views');
  const ctrEl = $('brain-perf-ctr');
  const retEl = $('brain-perf-ret');
  const logBtn = $('brain-perf-log');
  const learnBtn = $('brain-learn');
  const statusEl = $('brain-status');

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function flash(msg, type = 'info') { if (!statusEl) return; statusEl.textContent = msg; statusEl.className = `status ${type}`; statusEl.hidden = false; setTimeout(() => { statusEl.hidden = true; }, 2500); }

  function renderPrefs() {
    const p = window.BlvckBrain.preferences();
    if (!p.projectCount) {
      prefsEl.innerHTML = '<p class="field-note">No projects learned yet. Produce a video (or click “Learn from this project”) and the brain remembers your style, voice and tone.</p>';
      return;
    }
    const row = (label, m) => m.value
      ? `<div class="brain-pref"><span class="brain-pref-k">${esc(label)}</span><span class="brain-pref-v">${esc(m.value)}</span><span class="brain-pref-n">${m.count}×</span></div>` : '';
    prefsEl.innerHTML =
      `<div class="brain-pref-head">Learned from <strong>${p.projectCount}</strong> project(s)</div>` +
      row('Visual style', p.visualStyle) + row('Voice', p.voiceId) + row('Tone', p.tone) + row('Script type', p.scriptType);
  }

  function renderInsights() {
    const i = window.BlvckBrain.insights();
    if (!i.count) {
      insightsEl.innerHTML = '<p class="field-note">Log a published video’s stats below to learn which title themes actually perform. The Director then leans into what works.</p>';
      return;
    }
    const themeRows = i.themes.map((t) =>
      `<tr><td>${esc(t.theme)}</td><td class="tnum">${t.n}</td><td class="tnum">${t.avgCtr != null ? t.avgCtr + '%' : '—'}</td><td class="tnum">${t.avgRet != null ? t.avgRet + '%' : '—'}</td><td class="tnum">${t.avgViews != null ? t.avgViews.toLocaleString() : '—'}</td></tr>`
    ).join('');
    insightsEl.innerHTML =
      (i.headline ? `<div class="brain-headline">💡 ${esc(i.headline)}</div>` : '') +
      `<div class="brain-overall">${i.count} video(s) logged · avg CTR ${i.avgCtr != null ? i.avgCtr + '%' : '—'} · avg retention ${i.avgRet != null ? i.avgRet + '%' : '—'}</div>` +
      `<div class="brain-table-wrap"><table class="brain-table"><thead><tr><th>Theme</th><th>#</th><th>CTR</th><th>Ret.</th><th>Views</th></tr></thead><tbody>${themeRows}</tbody></table></div>`;
  }

  function renderPerfList() {
    const perf = window.BlvckBrain.get().performance;
    if (!perf.length) { perfListEl.hidden = true; perfListEl.innerHTML = ''; return; }
    perfListEl.hidden = false;
    perfListEl.innerHTML = perf.map((p, idx) =>
      `<div class="brain-perf-item"><span class="brain-perf-t">${esc(p.title || '(untitled)')}</span>${p.theme ? `<span class="brain-chip">${esc(p.theme)}</span>` : ''}<span class="brain-perf-stat">${p.ctr != null ? p.ctr + '% CTR' : ''}</span><button class="brain-perf-del" type="button" data-idx="${idx}" aria-label="Delete">×</button></div>`
    ).join('');
    perfListEl.querySelectorAll('.brain-perf-del').forEach((b) => b.addEventListener('click', () => {
      window.BlvckBrain.deletePerformance(Number(b.dataset.idx));
    }));
  }

  // Offer known project titles so a logged result's title matches the
  // project brain learned it from — that match is how modelBias() learns
  // which model generated a well-performing (or poorly-performing) video.
  function renderTitleList() {
    if (!titleListEl) return;
    const projects = window.BlvckBrain.get().projects;
    titleListEl.innerHTML = Object.values(projects)
      .map((p) => p.title ? `<option value="${esc(p.title)}"></option>` : '')
      .join('');
  }

  function render() { renderPrefs(); renderInsights(); renderPerfList(); renderTitleList(); }

  logBtn.addEventListener('click', () => {
    const rec = window.BlvckBrain.logPerformance({
      title: titleEl.value, theme: themeEl.value, views: viewsEl.value, ctr: ctrEl.value, retention: retEl.value
    });
    if (!rec) { flash('Add at least a title or a CTR to log.', 'error'); return; }
    titleEl.value = ''; themeEl.value = ''; viewsEl.value = ''; ctrEl.value = ''; retEl.value = '';
    flash('Logged — the brain updated what performs.');
  });

  learnBtn.addEventListener('click', () => {
    const d = window.BlvckBrain.learnCurrent();
    flash(d ? 'Folded this project into channel memory.' : 'Nothing to learn yet — make some choices first.', d ? 'info' : 'error');
  });

  // Auto-learn: quietly fold the current project into memory once it has real
  // content, debounced so edits don't thrash storage.
  let learnTimer = null;
  function scheduleAutoLearn() {
    clearTimeout(learnTimer);
    learnTimer = setTimeout(() => {
      if (window.BlvckAssets && window.BlvckAssets.status().script) window.BlvckBrain.learnCurrent();
    }, 2500);
  }

  window.BlvckBrain.on(render);
  if (window.BlvckAssets) window.BlvckAssets.on(scheduleAutoLearn);
  if (window.BlvckData) window.BlvckData.register('brain', render);

  card.hidden = false;
  render();
})();
