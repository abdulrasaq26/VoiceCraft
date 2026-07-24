// AI Research — the factual spine of the pipeline. Turns a topic into a
// structured, honesty-flagged research brief (summary, angles, hooks, key
// facts with confidence, entities, timeline, keywords) that grounds the script
// and SEO instead of relying on the model's memory alone. Runs through Puter
// chat routed to the strongest reasoning model (task 'research').
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const card = $('research-card');
  if (!card || !window.BlvckAI) return;

  const topicEl = $('research-topic');
  const genBtn = $('research-generate');
  const spinner = genBtn.querySelector('.spinner');
  const genLabel = genBtn.querySelector('.btn-label');
  const statusEl = $('research-status');
  const resultEl = $('research-result');

  const LS_KEY = 'blvck-tts:research';
  let lastRaw = '';

  const store = {
    get() { try { const v = localStorage.getItem(LS_KEY); return v ? JSON.parse(v) : null; } catch { return null; } },
    set(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* quota */ } }
  };

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c])); }
  function showStatus(msg, type = 'error') { statusEl.textContent = msg; statusEl.className = `status ${type}`; statusEl.hidden = false; }
  function clearStatus() { statusEl.hidden = true; }
  function setLoading(b, note) {
    genBtn.disabled = b;
    spinner.hidden = !b;
    genLabel.textContent = b ? (note || 'Researching…') : 'Research topic';
  }

  function channelCtx() {
    try {
      const c = JSON.parse(localStorage.getItem('blvck-tts:channel') || 'null');
      return c ? { name: c.name, type: c.type } : null;
    } catch { return null; }
  }

  function list(title, items, cls) {
    if (!items || !items.length) return '';
    return `<div class="rs-block"><h4>${esc(title)}</h4><ul class="${cls || ''}">${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`;
  }

  function render(brief) {
    if (!brief) { resultEl.hidden = true; resultEl.innerHTML = ''; return; }
    resultEl.hidden = false;
    const facts = (brief.keyFacts || []).map((f) =>
      `<li class="rs-fact"><span class="rs-conf ${f.confidence}">${esc(f.confidence)}</span>
        <span class="rs-fact-body"><strong>${esc(f.fact)}</strong>${f.detail ? ` — ${esc(f.detail)}` : ''}${f.verify ? ' <span class="rs-verify" title="Double-check before publishing">⚑ verify</span>' : ''}</span></li>`
    ).join('');
    const timeline = (brief.timeline || []).map((t) => `<li><span class="rs-when">${esc(t.when)}</span> ${esc(t.event)}</li>`).join('');
    const ent = brief.entities || {};
    const entChips = (label, xs) => (xs && xs.length) ? `<div class="rs-ent-row"><span class="rs-ent-label">${esc(label)}</span>${xs.map((x) => `<span class="rs-chip">${esc(x)}</span>`).join('')}</div>` : '';
    const kw = brief.keywords || {};
    const kwLine = (kw.primary || (kw.secondary || []).length || (kw.longTail || []).length)
      ? `<div class="rs-block"><h4>Keywords</h4><div class="rs-kw">${kw.primary ? `<span class="rs-chip primary">${esc(kw.primary)}</span>` : ''}${(kw.secondary || []).map((k) => `<span class="rs-chip">${esc(k)}</span>`).join('')}${(kw.longTail || []).map((k) => `<span class="rs-chip dim">${esc(k)}</span>`).join('')}</div></div>` : '';

    resultEl.innerHTML =
      (brief.summary ? `<p class="rs-summary">${esc(brief.summary)}</p>` : '') +
      `<div class="rs-disclaimer">⚑ Generated from the model's knowledge — verify anything flagged before publishing.</div>` +
      list('Angles', brief.angles) +
      list('Hook ideas', brief.hooks) +
      (facts ? `<div class="rs-block"><h4>Key facts</h4><ul class="rs-facts">${facts}</ul></div>` : '') +
      list('Questions to answer', brief.questions) +
      (timeline ? `<div class="rs-block"><h4>Timeline</h4><ul class="rs-timeline">${timeline}</ul></div>` : '') +
      ((ent.people || ent.places || ent.dates || ent.terms) ? `<div class="rs-block"><h4>Entities</h4>${entChips('People', ent.people)}${entChips('Places', ent.places)}${entChips('Dates', ent.dates)}${entChips('Terms', ent.terms)}</div>` : '') +
      kwLine +
      list('Title directions', brief.titleDirections) +
      (brief.caveats ? `<div class="rs-block"><h4>Caveats</h4><p class="rs-caveats">${esc(brief.caveats)}</p></div>` : '') +
      `<div class="rs-actions">
        <button id="research-use" class="btn primary small" type="button" title="Load this topic into the Script studio — the script auto-grounds in this brief">Use in script studio ↓</button>
        <button id="research-regenerate" class="btn ghost small" type="button">Regenerate</button>
        ${lastRaw ? '<button id="research-raw" class="btn ghost small" type="button">View raw response</button>' : ''}
      </div>`;

    const use = $('research-use');
    if (use) use.addEventListener('click', sendToScript);
    const regen = $('research-regenerate');
    if (regen) regen.addEventListener('click', generate);
    const raw = $('research-raw');
    if (raw) raw.addEventListener('click', () => {
      const pre = document.createElement('pre');
      pre.className = 'rs-raw';
      pre.textContent = lastRaw;
      raw.replaceWith(pre);
    });
  }

  function sendToScript() {
    const topic = (store.get() || {}).topic || topicEl.value.trim();
    const scriptTopic = $('script-topic');
    if (scriptTopic && topic && !scriptTopic.value.trim()) scriptTopic.value = topic;
    const scriptCard = $('script-card');
    if (scriptCard) scriptCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    showStatus('Sent to the Script studio — generate there and the script will be grounded in this brief.', 'info');
  }

  async function generate() {
    const topic = topicEl.value.trim();
    if (!topic) { showStatus('Enter a topic to research first.'); topicEl.focus(); return; }
    clearStatus();
    setLoading(true);
    try {
      const body = await window.BlvckAI.generateJSON('/api/research',
        { topic, options: { audience: '', channel: channelCtx() } },
        { onAttempt: (n, max) => setLoading(true, max > 1 && n > 1 ? `Researching… (retry ${n}/${max})` : 'Researching…') }
      );
      lastRaw = window.BlvckAI.lastRawResponse ? window.BlvckAI.lastRawResponse() : '';
      store.set({ topic, brief: body.research, at: Date.now() });
      render(body.research);
      clearStatus();
      if (window.BlvckAssets) window.BlvckAssets.emit();
    } catch (err) {
      lastRaw = (err && err.raw) || '';
      showStatus((err && err.message) || 'Research failed.', 'error');
      render((store.get() || {}).brief || null);
    } finally {
      setLoading(false);
    }
  }

  // Re-hydrate from storage (used at init and by the data manager on clear/undo).
  function refresh() {
    const saved = store.get();
    if (saved && saved.topic && topicEl && !topicEl.value.trim()) topicEl.value = saved.topic;
    render(saved && saved.brief);
  }

  genBtn.addEventListener('click', generate);
  topicEl.addEventListener('keydown', (e) => { if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') generate(); });

  if (window.BlvckData) window.BlvckData.register('research', refresh);

  card.hidden = false;
  refresh();
})();
