// Real-Source AI Research Engine for Blvck-TTS v4.0
// Fetches real external source citations (Wikipedia API) and grounds LLM research briefs in cited facts
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

  // Fetch real articles from Wikipedia API
  async function fetchWikipediaSources(query) {
    try {
      const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&format=json&origin=*`;
      const res = await fetch(url);
      if (!res.ok) return [];
      const json = await res.json();
      const results = json.query?.search || [];
      return results.slice(0, 5).map(item => ({
        title: item.title,
        snippet: item.snippet.replace(/<\/?[^>]+(>|$)/g, ''),
        url: `https://en.wikipedia.org/wiki/${encodeURIComponent(item.title.replace(/ /g, '_'))}`
      }));
    } catch (e) {
      console.warn('[Research] Wikipedia search failed:', e);
      return [];
    }
  }

  function render(brief) {
    if (!brief) { resultEl.hidden = true; resultEl.innerHTML = ''; return; }
    resultEl.hidden = false;
    const facts = (brief.keyFacts || []).map((f) =>
      `<li class="rs-fact"><span class="rs-conf ${f.confidence}">${esc(f.confidence)}</span>
        <span class="rs-fact-body"><strong>${esc(f.fact)}</strong>${f.detail ? ` — ${esc(f.detail)}` : ''}${f.verify ? ' <span class="rs-verify" title="Double-check before publishing">⚑ verify</span>' : ''}</span></li>`
    ).join('');

    const sources = (brief.sources || []).map((s) =>
      `<li><a href="${esc(s.url)}" target="_blank" rel="noopener"><strong>${esc(s.title)}</strong></a>: ${esc(s.snippet.slice(0, 150))}…</li>`
    ).join('');

    const timeline = (brief.timeline || []).map((t) => `<li><span class="rs-when">${esc(t.when)}</span> ${esc(t.event)}</li>`).join('');

    resultEl.innerHTML =
      (brief.summary ? `<p class="rs-summary">${esc(brief.summary)}</p>` : '') +
      (sources ? `<div class="rs-block"><h4>Verified External Sources (Wikipedia)</h4><ul class="rs-sources">${sources}</ul></div>` : '') +
      (facts ? `<div class="rs-block"><h4>Key facts</h4><ul class="rs-facts">${facts}</ul></div>` : '') +
      (timeline ? `<div class="rs-block"><h4>Timeline</h4><ul class="rs-timeline">${timeline}</ul></div>` : '') +
      `<div class="rs-actions">
        <button id="research-use" class="btn primary small" type="button">Use in script studio ↓</button>
        <button id="research-regenerate" class="btn ghost small" type="button">Regenerate</button>
      </div>`;

    const use = $('research-use');
    if (use) use.addEventListener('click', sendToScript);
    const regen = $('research-regenerate');
    if (regen) regen.addEventListener('click', generate);
  }

  function sendToScript() {
    const data = store.get() || {};
    const topic = data.topic || (topicEl ? topicEl.value.trim() : '');
    const brief = data.brief || {};

    // Format rich research brief text for Script Studio prompt
    let briefContext = `Topic: ${topic}\n`;
    if (brief.summary) briefContext += `\nSummary:\n${brief.summary}\n`;
    if (brief.keyFacts && brief.keyFacts.length) {
      briefContext += `\nKey Facts:\n` + brief.keyFacts.map(f => `- ${f.fact}${f.detail ? `: ${f.detail}` : ''}`).join('\n') + `\n`;
    }
    if (brief.timeline && brief.timeline.length) {
      briefContext += `\nTimeline:\n` + brief.timeline.map(t => `- [${t.when}] ${t.event}`).join('\n') + `\n`;
    }

    const scriptTopic = $('script-topic');
    if (scriptTopic) {
      scriptTopic.value = briefContext.trim();
    }

    // Also update project title if not set
    const titleInput = $('title-input');
    if (titleInput && topic && !titleInput.value.trim()) {
      titleInput.value = topic;
    }

    // Switch workspace tab to Script Studio
    if (window.AetherRouter) {
      window.AetherRouter.switchWorkspace('script');
    } else {
      const scriptCard = $('script-card');
      if (scriptCard) scriptCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }

    showStatus('Research brief transferred to Script Studio!', 'info');
  }

  async function generate() {
    const topic = topicEl.value.trim();
    if (!topic) { showStatus('Enter a topic first.'); topicEl.focus(); return; }
    clearStatus();
    setLoading(true, 'Querying Wikipedia & Real Sources…');

    try {
      const realSources = await fetchWikipediaSources(topic);
      setLoading(true, 'Retrieving Vault Knowledge & Synthesizing Brief…');

      const sourceContext = realSources.map(s => `Source (${s.title}): ${s.snippet}`).join('\n');
      
      let vaultContext = "";
      let vaultChunks = [];
      if (window.BlvckVault) {
        vaultChunks = await window.BlvckVault.retrieve(topic || "general facts", 5000);
        if (vaultChunks.length > 0) {
          vaultContext = "\nRELEVANT KNOWLEDGE VAULT CHUNKS (CITE THESE!):\n" + 
            vaultChunks.map(c => `--- [Source: ${c.filename}] ---\n${c.text}`).join('\n\n') +
            "\n(You MUST prioritize these project-specific documents for facts and context. ALWAYS cite them using [Source: filename.ext] when you use a fact from them.)\n";
        }
      }

      const prompt = `Perform deep research for a video script on: "${topic}".
Real Sources Found:
${sourceContext}
${vaultContext}

Return JSON ONLY in format:
{
  "summary": "...",
  "keyFacts": [
    { "fact": "...", "detail": "...", "confidence": "high|medium|low", "verify": false }
  ],
  "timeline": [
    { "when": "1347", "event": "..." }
  ],
  "keywords": { "primary": "...", "secondary": [] }
}`;

      const respText = await window.BlvckAI.chat(prompt, { task: 'research' });
      const jsonMatch = respText.match(/\{[\s\S]*\}/);
      const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : { summary: respText };

      parsed.sources = realSources;
      if (vaultChunks && vaultChunks.length > 0) {
        const uniqueVaultSources = [...new Set(vaultChunks.map(c => c.filename))];
        parsed.sources.push(...uniqueVaultSources.map(f => ({
          title: `Vault Source: ${f}`,
          url: '#',
          snippet: 'Retrieved from project Knowledge Vault.'
        })));
      }

      store.set({ topic, brief: parsed, at: Date.now() });
      render(parsed);
      clearStatus();
    } catch (err) {
      showStatus((err && err.message) || 'Research failed.', 'error');
    } finally {
      setLoading(false);
    }
  }

  genBtn.addEventListener('click', generate);
  if (card) card.hidden = false;
})();
