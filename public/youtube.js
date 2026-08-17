(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  const CHANNEL_LS = 'blvck-tts:channel'; // global knowledge base
  const SEO_LS = 'blvck-tts:seo'; // per-project (in the project working set)
  const THUMB_DB = 'blvck-thumbnails';
  const THUMB_STORE = 'images';

  const CH_FIELDS = {
    name: 'yt-ch-name',
    type: 'yt-ch-type',
    audience: 'yt-ch-audience',
    tone: 'yt-ch-tone',
    visualStyle: 'yt-ch-visual',
    thumbnailStyle: 'yt-ch-thumb',
    colorPalette: 'yt-ch-palette',
    titleStructure: 'yt-ch-titles',
    seoFocus: 'yt-ch-seo',
    contentStrategy: 'yt-ch-strategy'
  };

  let seo = null;
  let thumbs = []; // { id, version, prompt }
  const thumbUrls = new Map();
  let thumbCounter = 0;

  // --- Storage helpers ---------------------------------------------------

  function readLS(k) {
    try {
      return JSON.parse(localStorage.getItem(k) || 'null');
    } catch {
      return null;
    }
  }

  function idbOpen() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(THUMB_DB, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(THUMB_STORE)) req.result.createObjectStore(THUMB_STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  async function idbPut(key, blob) {
    try {
      const db = await idbOpen();
      await new Promise((res, rej) => {
        const tx = db.transaction(THUMB_STORE, 'readwrite');
        tx.objectStore(THUMB_STORE).put(blob, key);
        tx.oncomplete = res;
        tx.onerror = () => rej(tx.error);
      });
      db.close();
    } catch {
      /* best effort */
    }
  }
  async function idbGet(key) {
    try {
      const db = await idbOpen();
      const v = await new Promise((res, rej) => {
        const rq = db.transaction(THUMB_STORE, 'readonly').objectStore(THUMB_STORE).get(key);
        rq.onsuccess = () => res(rq.result || null);
        rq.onerror = () => rej(rq.error);
      });
      db.close();
      return v;
    } catch {
      return null;
    }
  }

  // --- Channel profile ---------------------------------------------------

  function loadChannel() {
    const ch = readLS(CHANNEL_LS) || {};
    for (const [key, id] of Object.entries(CH_FIELDS)) {
      const el = $(id);
      if (el) el.value = ch[key] || '';
    }
  }
  function collectChannel() {
    const ch = {};
    for (const [key, id] of Object.entries(CH_FIELDS)) {
      const el = $(id);
      ch[key] = el ? el.value.trim() : '';
    }
    return ch;
  }
  function saveChannel() {
    localStorage.setItem(CHANNEL_LS, JSON.stringify(collectChannel()));
    showStatus('Channel profile saved. Every project inherits it automatically.', 'info');
  }

  // --- Status ------------------------------------------------------------

  function showStatus(msg, type = 'error') {
    const statusEl = document.getElementById('yt-status');
    if (!statusEl) return;
    statusEl.textContent = msg;
    statusEl.className = `status ${type}`;
    statusEl.hidden = false;
  }
  const clearStatus = () => {
    const statusEl = document.getElementById('yt-status');
    if (statusEl) statusEl.hidden = true;
  };

  function setGenerating(on) {
    const genBtn = document.getElementById('yt-generate');
    if (!genBtn) return;
    genBtn.disabled = on;
    const genSpinner = genBtn.querySelector('.spinner');
    const genLabel = genBtn.querySelector('.btn-label') || genBtn;
    if (genSpinner) genSpinner.hidden = !on;
    if (genLabel) genLabel.textContent = on ? 'Analyzing project…' : 'Generate optimization for this project';
  }

  // --- Project context ---------------------------------------------------

  function projectTitle() {
    if (window.BlvckAssets && window.BlvckAssets.title()) return window.BlvckAssets.title();
    const n = readLS('blvck-tts:narration');
    return (n && n.title) || 'Untitled';
  }

  function getProjectContext() {
    const snap = window.BlvckAssets ? window.BlvckAssets.snapshot() : {};

    const ctx = {
      title: snap.title || projectTitle(),
      script: snap.script || '',
      research: snap.research || (window.BlvckAssets ? window.BlvckAssets.research() : null),
      bible: snap.bible || (window.BlvckAssets ? window.BlvckAssets.bible() : null),
      storyboard: snap.storyboard || (window.BlvckAssets && typeof window.BlvckAssets.scenes === 'function' ? window.BlvckAssets.scenes() : null)
    };

    if (!ctx.script) {
      const batch = readLS('blvck-tts:batch');
      if (batch && batch.items && batch.items.length) {
        ctx.script = batch.items.map((i) => i.text).join(' ');
      }
    }

    if (!ctx.bible) {
      const sb = readLS('blvck-tts:storyboard');
      if (sb && sb.bible) ctx.bible = sb.bible;
    }

    const memory = window.BlvckBrain && typeof window.BlvckBrain.promptBlock === 'function' ? window.BlvckBrain.promptBlock() : null;
    if (memory) ctx.channelMemory = memory;

    return ctx;
  }

  // --- Generate ----------------------------------------------------------

  async function generate() {
    clearStatus();
    setGenerating(true);
    try {
      const ctx = getProjectContext();
      const title = ctx.title || 'Untitled Documentary';
      let body;
      
      const prompt = `You are an elite YouTube Growth Mastermind and SEO Expert.
Your task is to analyze the following documentary project and generate a complete, high-CTR YouTube packaging and SEO strategy.

PROJECT DETAILS:
Title: "${ctx.title}"
Script Summary: "${(ctx.script || '').slice(0, 2000)}"
Research: "${ctx.research || 'No specific research provided'}"

CHANNEL CONTEXT:
${JSON.stringify(collectChannel(), null, 2)}

Return ONLY a valid JSON object matching exactly this schema:
{
  "seo": {
    "recommendedTitle": "The absolute best high-CTR title",
    "titles": {
      "seo": [ { "title": "...", "seoScore": 90, "ctrScore": 85, "competitionScore": 40, "readabilityScore": 95 } ],
      "ctr": [ { "title": "...", "seoScore": 80, "ctrScore": 98, "competitionScore": 60, "readabilityScore": 90 } ],
      "balanced": [ { "title": "...", "seoScore": 92, "ctrScore": 92, "competitionScore": 45, "readabilityScore": 96 } ]
    },
    "description": {
      "long": "Full YouTube description with chapters and hook",
      "short": "2-3 sentence teaser for social sharing"
    },
    "keywords": {
      "primary": "main keyword",
      "secondary": ["kw1", "kw2"],
      "longTail": ["long phrase 1"],
      "intent": "Search intent"
    },
    "tags": {
      "broad": ["tag1"], "niche": ["tag2"], "longTail": ["tag3"], "trending": ["tag4"]
    },
    "hashtags": {
      "highVolume": ["#tag"], "niche": ["#tag"], "brand": ["#tag"]
    },
    "thumbnails": [
      {
        "version": "A",
        "text": "2-3 WORD HOOK",
        "visualFocus": "Description of subject",
        "emotionalTrigger": "Emotion",
        "curiosityTrigger": "Why they click",
        "reasoning": "Why this works",
        "prompt": "Image generation prompt",
        "scores": { "curiosity": 90, "ctr": 95, "readability": 90, "mobile": 95, "brand": 85 }
      }
    ],
    "recommendedThumbnail": "A"
  }
}

Respond ONLY with valid JSON. No markdown formatting, no explanations.`;

      try {
        const rawRes = await window.AIManager.chat(prompt, { temperature: 0.7, task: 'seo' });
        const jsonMatch = rawRes.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          body = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error("No JSON object found in response");
        }
      } catch (e) {
        throw new Error(`AI generation failed: ${e.message}`);
      }

      seo = body.seo || body;
      thumbs = [];
      thumbUrls.forEach((u) => URL.revokeObjectURL(u));
      thumbUrls.clear();
      persist();
      render();
      showStatus('Optimization package generated. Review, tweak, generate thumbnails, then export.', 'info');
    } catch (err) {
      showStatus(err.message);
    } finally {
      setGenerating(false);
    }
  }

  // --- Copy --------------------------------------------------------------

  async function copy(textVal, label) {
    try {
      await navigator.clipboard.writeText(textVal);
      showStatus(`${label} copied.`, 'info');
      return;
    } catch {
      /* fallback */
    }
    const ta = document.createElement('textarea');
    ta.value = textVal;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      showStatus(`${label} copied.`, 'info');
    } catch {
      showStatus('Could not copy automatically.');
    }
    ta.remove();
  }

  // --- Rendering ---------------------------------------------------------

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function scoreClass(n) {
    return n >= 75 ? 'good' : n >= 55 ? 'mid' : '';
  }
  function copyBtn(id) {
    return `<button class="yt-copy" data-copy="${id}">Copy</button>`;
  }

  function titleRow(t) {
    return (
      `<div class="yt-title-row"><span class="yt-title-text">${esc(t.title)}</span>` +
      `<span class="yt-scores">` +
      `<span class="yt-score ${scoreClass(t.seoScore)}" title="SEO">SEO ${t.seoScore}</span>` +
      `<span class="yt-score ${scoreClass(t.ctrScore)}" title="CTR">CTR ${t.ctrScore}</span>` +
      `<span class="yt-score" title="Competition">Comp ${t.competitionScore}</span>` +
      `<span class="yt-score ${scoreClass(t.readabilityScore)}" title="Readability">Read ${t.readabilityScore}</span>` +
      `<button class="yt-copy" data-copytext="${esc(t.title)}">Copy</button>` +
      `</span></div>`
    );
  }

  function render() {
    const results = document.getElementById('yt-results');
    if (!results) return;
    
    if (!seo) {
      results.hidden = true;
      return;
    }
    results.hidden = false;

    // Safely normalize titles structure
    let titlesMap = { seo: [], ctr: [], balanced: [] };
    if (Array.isArray(seo.titles)) {
      titlesMap.seo = seo.titles;
      titlesMap.ctr = seo.titles;
      titlesMap.balanced = seo.titles;
    } else if (seo.titles && typeof seo.titles === 'object') {
      titlesMap.seo = Array.isArray(seo.titles.seo) ? seo.titles.seo : [];
      titlesMap.ctr = Array.isArray(seo.titles.ctr) ? seo.titles.ctr : [];
      titlesMap.balanced = Array.isArray(seo.titles.balanced) ? seo.titles.balanced : [];
    }

    const recTitle = seo.recommendedTitle || (titlesMap.seo[0] && titlesMap.seo[0].title) || projectTitle() || '';
    $('yt-recommended').innerHTML =
      `<h3>Recommended title ${copyBtn('rec')}</h3><div class="yt-recommended-title" id="yt-rec-text">${esc(recTitle)}</div>`;

    const cat = window.__ytCat || 'seo';
    const activeList = titlesMap[cat] || titlesMap.seo || [];
    const tabs = ['seo', 'ctr', 'balanced'].map((c) => {
      const len = (titlesMap[c] || []).length;
      return `<button class="yt-copy ${c === cat ? '' : ''}" data-tab="${c}" ${c === cat ? 'style="color:var(--accent);border-color:var(--accent)"' : ''}>${c.toUpperCase()} (${len})</button>`;
    }).join('');

    $('yt-titles').innerHTML =
      `<h3>Title variations</h3><div class="yt-tabs">${tabs}</div>` + activeList.map(titleRow).join('');

    const descLong = typeof seo.description === 'object' ? (seo.description.long || seo.description.full || '') : (typeof seo.description === 'string' ? seo.description : '');
    const descShort = typeof seo.description === 'object' ? (seo.description.short || seo.description.summary || '') : (typeof seo.description === 'string' ? seo.description.slice(0, 150) : '');

    $('yt-desc').innerHTML =
      `<h3>Description ${copyBtn('desc-long')}</h3><div class="yt-pre" id="yt-desc-long">${esc(descLong)}</div>` +
      `<h3 style="margin-top:.6rem">Short description ${copyBtn('desc-short')}</h3><div class="yt-pre" id="yt-desc-short">${esc(descShort)}</div>`;

    const kwPrimary = seo.keywords && typeof seo.keywords === 'object' ? (seo.keywords.primary || '') : (Array.isArray(seo.keywords) ? seo.keywords.join(', ') : '');
    const kwSecondary = seo.keywords && typeof seo.keywords === 'object' && Array.isArray(seo.keywords.secondary) ? seo.keywords.secondary : [];
    const kwLongTail = seo.keywords && typeof seo.keywords === 'object' && Array.isArray(seo.keywords.longTail) ? seo.keywords.longTail : [];
    const kwIntent = seo.keywords && typeof seo.keywords === 'object' ? (seo.keywords.intent || '') : '';

    $('yt-keywords').innerHTML =
      `<h3>Keywords ${copyBtn('kw')}</h3>` +
      `<div><strong>Primary:</strong> ${esc(kwPrimary)}</div>` +
      `<div style="margin-top:.35rem"><strong>Secondary:</strong> <span class="yt-chips">${kwSecondary.map((x) => `<span class="yt-chip">${esc(x)}</span>`).join('')}</span></div>` +
      `<div style="margin-top:.35rem"><strong>Long-tail:</strong> <span class="yt-chips">${kwLongTail.map((x) => `<span class="yt-chip">${esc(x)}</span>`).join('')}</span></div>` +
      `<div style="margin-top:.35rem" class="field-note"><strong>Search intent:</strong> ${esc(kwIntent)}</div>`;

    const tgBroad = seo.tags && typeof seo.tags === 'object' && Array.isArray(seo.tags.broad) ? seo.tags.broad : (Array.isArray(seo.tags) ? seo.tags : []);
    const tgNiche = seo.tags && typeof seo.tags === 'object' && Array.isArray(seo.tags.niche) ? seo.tags.niche : [];
    const tgLongTail = seo.tags && typeof seo.tags === 'object' && Array.isArray(seo.tags.longTail) ? seo.tags.longTail : [];
    const tgTrending = seo.tags && typeof seo.tags === 'object' && Array.isArray(seo.tags.trending) ? seo.tags.trending : [];

    const tagGroup = (label, list) => `<div style="margin-top:.35rem"><strong>${label}:</strong> <span class="yt-chips">${list.map((x) => `<span class="yt-chip">${esc(x)}</span>`).join('')}</span></div>`;
    $('yt-tags').innerHTML =
      `<h3>Tags ${copyBtn('tags')}</h3>` + tagGroup('Broad', tgBroad) + tagGroup('Niche', tgNiche) + tagGroup('Long-tail', tgLongTail) + tagGroup('Trending', tgTrending);

    const hHigh = seo.hashtags && typeof seo.hashtags === 'object' && Array.isArray(seo.hashtags.highVolume) ? seo.hashtags.highVolume : (Array.isArray(seo.hashtags) ? seo.hashtags : []);
    const hNiche = seo.hashtags && typeof seo.hashtags === 'object' && Array.isArray(seo.hashtags.niche) ? seo.hashtags.niche : [];
    const hBrand = seo.hashtags && typeof seo.hashtags === 'object' && Array.isArray(seo.hashtags.brand) ? seo.hashtags.brand : [];

    $('yt-hashtags').innerHTML =
      `<h3>Hashtags ${copyBtn('hashtags')}</h3>` + tagGroup('High volume', hHigh) + tagGroup('Niche', hNiche) + tagGroup('Brand', hBrand);

    renderThumbs();
  }

  function renderThumbs() {
    const container = $('yt-thumbs');
    const conceptHtml = seo.thumbnails
      .map((t, i) => {
        const s = t.scores;
        const rec = seo.recommendedThumbnail === t.version ? ' ⭐ recommended' : '';
        return (
          `<div class="yt-thumb-concept">` +
          `<h3>Version ${esc(t.version)}${rec}</h3>` +
          `<div><strong>Text:</strong> “${esc(t.text)}”</div>` +
          `<div><strong>Visual focus:</strong> ${esc(t.visualFocus)}</div>` +
          `<div><strong>Emotional trigger:</strong> ${esc(t.emotionalTrigger)}</div>` +
          `<div><strong>Curiosity trigger:</strong> ${esc(t.curiosityTrigger)}</div>` +
          `<div class="field-note">${esc(t.reasoning)}</div>` +
          `<div class="yt-thumb-scores">` +
          `<span class="yt-score ${scoreClass(s.curiosity)}">Curiosity ${s.curiosity}</span>` +
          `<span class="yt-score ${scoreClass(s.ctr)}">CTR ${s.ctr}</span>` +
          `<span class="yt-score ${scoreClass(s.readability)}">Read ${s.readability}</span>` +
          `<span class="yt-score ${scoreClass(s.mobile)}">Mobile ${s.mobile}</span>` +
          `<span class="yt-score ${scoreClass(s.brand)}">Brand ${s.brand}</span>` +
          `</div>` +
          `<div class="yt-pre" style="max-height:120px">${esc(t.prompt)}</div>` +
          `<div class="actions" style="margin-top:.5rem">` +
          `<button class="btn primary small" data-gen-thumb="${i}">Generate thumbnail</button>` +
          `<select data-thumb-count="${i}" style="width:120px"><option value="1">×1</option><option value="5">×5</option><option value="10">×10</option></select>` +
          `</div></div>`
        );
      })
      .join('');

    const gallery = thumbs
      .map((t) => {
        const url = thumbUrls.get(t.id);
        return `<figure><img src="${url || ''}" alt="thumbnail ${t.id}" /><figcaption><span>Ver ${esc(t.version)}</span><a class="yt-copy" href="${url || '#'}" download="${esc(projectTitle())} thumbnail ${t.id}.png">Download</a></figcaption></figure>`;
      })
      .join('');

    container.innerHTML =
      `<h3>Thumbnail concepts</h3>${conceptHtml}` + (thumbs.length ? `<h3 style="margin-top:.5rem">Generated thumbnails (${thumbs.length})</h3><div class="yt-thumb-gallery">${gallery}</div>` : '');
  }

  // --- Thumbnail generation ----------------------------------------------

  function thumbPrompt(concept) {
    const ch = collectChannel();
    const style = ch.thumbnailStyle || 'dark cinematic background, warm lighting, bold readable composition, historical authenticity';
    return `${concept.prompt} Channel thumbnail style: ${style}. 16:9 YouTube thumbnail composition, ultra high contrast, clear focal subject, generous negative space reserved for large bold overlay text, do not render any letters or words in the image.`;
  }

  async function generateThumbnails(conceptIndex, count) {
    const concept = seo.thumbnails[conceptIndex];
    if (!concept) return;
    showStatus(`Generating ${count} thumbnail(s) for Version ${concept.version}…`, 'info');
    for (let n = 0; n < count; n++) {
      try {
        const blob = await window.BlvckAI.generateImage(thumbPrompt(concept), '16:9');
        const id = ++thumbCounter;
        thumbUrls.set(id, URL.createObjectURL(blob));
        await idbPut(String(id), blob);
        thumbs.push({ id, version: concept.version, prompt: thumbPrompt(concept) });
        persist();
        renderThumbs();
      } catch (err) {
        if (err.quota) {
          showStatus(`Image quota reached: ${err.message}. ${count > 1 ? `${n} generated.` : ''}`.trim());
          break;
        }
        showStatus(`Thumbnail failed: ${err.message}`);
        break;
      }
      await new Promise((r) => setTimeout(r, 500));
    }
  }

  // --- Persistence -------------------------------------------------------

  function persist() {
    try {
      localStorage.setItem(SEO_LS, JSON.stringify({ seo, thumbs, thumbCounter }));
    } catch {
      /* quota */
    }
  }

  async function restore() {
    const saved = readLS(SEO_LS);
    if (!saved || !saved.seo) return;
    seo = saved.seo;
    thumbs = saved.thumbs || [];
    thumbCounter = saved.thumbCounter || thumbs.reduce((m, t) => Math.max(m, t.id), 0);
    for (const t of thumbs) {
      const blob = await idbGet(String(t.id));
      if (blob) thumbUrls.set(t.id, URL.createObjectURL(blob));
    }
    render();
  }

  // --- Exports -----------------------------------------------------------

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 15000);
  }

  function seoMarkdown() {
    if (!seo) return '';
    const line = (label, arr) => `- **${label}:** ${arr.join(', ')}`;
    return [
      `# YouTube SEO Report — ${seo.project}`,
      ``,
      `## Recommended title`,
      `> ${seo.recommendedTitle}`,
      ``,
      `## Title options`,
      ...['seo', 'ctr', 'balanced'].flatMap((c) => [
        `### ${c.toUpperCase()}`,
        ...seo.titles[c].map((t) => `- ${t.title}  _(SEO ${t.seoScore} · CTR ${t.ctrScore} · Comp ${t.competitionScore} · Read ${t.readabilityScore})_`)
      ]),
      ``,
      `## Description`,
      seo.description.long,
      ``,
      `## Short description`,
      seo.description.short,
      ``,
      `## Keywords`,
      `- **Primary:** ${seo.keywords.primary}`,
      line('Secondary', seo.keywords.secondary),
      line('Long-tail', seo.keywords.longTail),
      `- **Search intent:** ${seo.keywords.intent}`,
      ``,
      `## Tags`,
      line('Broad', seo.tags.broad),
      line('Niche', seo.tags.niche),
      line('Long-tail', seo.tags.longTail),
      line('Trending', seo.tags.trending),
      ``,
      `## Hashtags`,
      line('High volume', seo.hashtags.highVolume),
      line('Niche', seo.hashtags.niche),
      line('Brand', seo.hashtags.brand),
      ``,
      `## Thumbnails`,
      ...seo.thumbnails.map(
        (t) =>
          `### Version ${t.version}${seo.recommendedThumbnail === t.version ? ' (recommended)' : ''}\n` +
          `- Text: ${t.text}\n- Visual focus: ${t.visualFocus}\n- Emotional trigger: ${t.emotionalTrigger}\n- Curiosity trigger: ${t.curiosityTrigger}\n- Scores: curiosity ${t.scores.curiosity}, CTR ${t.scores.ctr}, readability ${t.scores.readability}, mobile ${t.scores.mobile}, brand ${t.scores.brand}\n- Prompt: ${t.prompt}`
      ),
      ``
    ].join('\n');
  }

  async function exportThumbsZip(extraFiles) {
    const enc = new TextEncoder();
    const files = extraFiles ? [...extraFiles] : [];
    for (const t of thumbs) {
      const blob = await idbGet(String(t.id));
      if (blob) files.push({ name: `thumbnails/thumbnail-${String(t.id).padStart(2, '0')}-v${t.version}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
    }
    if (seo) {
      files.push({
        name: 'thumbnails/thumbnail-prompts.txt',
        data: enc.encode(seo.thumbnails.map((t) => `Version ${t.version}\n${t.prompt}\n`).join('\n'))
      });
      files.push({
        name: 'thumbnails/thumbnail-notes.txt',
        data: enc.encode(
          seo.thumbnails
            .map((t) => `Version ${t.version}: "${t.text}" — focus: ${t.visualFocus}; curiosity: ${t.curiosityTrigger}; ${t.reasoning}`)
            .join('\n')
        )
      });
    }
    return files;
  }

  async function exportSeoReport() {
    if (!seo) return;
    download(`${projectTitle()} SEO report.md`, new Blob([seoMarkdown()], { type: 'text/markdown' }));
  }
  async function exportThumbPackage() {
    if (!seo) return;
    const files = await exportThumbsZip();
    if (!files.length) {
      showStatus('Generate at least one thumbnail first.');
      return;
    }
    download(`${projectTitle()} thumbnail package.zip`, window.BlvckZip.create(files));
  }
  async function exportPublishing() {
    if (!seo) return;
    const enc = new TextEncoder();
    const files = await exportThumbsZip([{ name: 'SEO report.md', data: enc.encode(seoMarkdown()) }]);
    download(`${projectTitle()} publishing package.zip`, window.BlvckZip.create(files));
  }

  // --- Events & Init -----------------------------------------------------

  function initEvents() {
    const saveChannelBtn = document.getElementById('yt-save-channel');
    const genBtn = document.getElementById('yt-generate');
    const results = document.getElementById('yt-results');
    const exportSeo = document.getElementById('yt-export-seo');
    const exportThumbs = document.getElementById('yt-export-thumbs');
    const exportAll = document.getElementById('yt-export-all');

    if (saveChannelBtn) saveChannelBtn.onclick = saveChannel;
    if (genBtn) genBtn.onclick = generate;
    if (exportSeo) exportSeo.onclick = exportSeoReport;
    if (exportThumbs) exportThumbs.onclick = exportThumbPackage;
    if (exportAll) exportAll.onclick = exportPublishing;

    if (results) {
      results.onclick = (e) => {
        const tab = e.target.closest('[data-tab]');
        if (tab) {
          window.__ytCat = tab.dataset.tab;
          render();
          return;
        }
        const copyText = e.target.closest('[data-copytext]');
        if (copyText) {
          copy(copyText.dataset.copytext, 'Title');
          return;
        }
        const c = e.target.closest('[data-copy]');
        if (c) {
          handleCopy(c.dataset.copy);
          return;
        }
        const gen = e.target.closest('[data-gen-thumb]');
        if (gen) {
          const i = Number(gen.dataset.genThumb);
          const sel = results.querySelector(`[data-thumb-count="${i}"]`);
          generateThumbnails(i, Number(sel ? sel.value : 1));
        }
      };
    }
  }

  function handleCopy(kind) {
    if (!seo) return;
    if (kind === 'rec') return copy(seo.recommendedTitle, 'Recommended title');
    if (kind === 'desc-long') return copy(seo.description.long, 'Description');
    if (kind === 'desc-short') return copy(seo.description.short, 'Short description');
    if (kind === 'kw') return copy([seo.keywords.primary, ...seo.keywords.secondary, ...seo.keywords.longTail].join(', '), 'Keywords');
    if (kind === 'tags') return copy([...seo.tags.broad, ...seo.tags.niche, ...seo.tags.longTail, ...seo.tags.trending].join(', '), 'Tags');
    if (kind === 'hashtags') return copy([...seo.hashtags.highVolume, ...seo.hashtags.niche, ...seo.hashtags.brand].join(' '), 'Hashtags');
  }

  async function refresh() {
    seo = null;
    thumbs = [];
    thumbCounter = 0;
    thumbUrls.forEach((u) => URL.revokeObjectURL(u));
    thumbUrls.clear();
    render();
    await restore();
  }

  function updateProjectName() {
    const projectNameEl = document.getElementById('yt-project-name');
    if (projectNameEl) projectNameEl.textContent = `Project: ${projectTitle()}`;
  }

  // ── BOOT — script loads after DOM so elements exist immediately ──────────

  function boot() {
    try {
      const card = document.getElementById('youtube-card');
      if (card) card.hidden = false;

      // Bind generate button — direct & unconditional
      const genBtn = document.getElementById('yt-generate');
      if (genBtn) {
        genBtn.onclick = null; // clear any stale handler
        genBtn.addEventListener('click', generate);
        console.log('[YouTube] ✅ Generate button bound');
      } else {
        console.warn('[YouTube] ⚠️ #yt-generate not found');
      }

      // Bind save channel button
      const saveChannelBtn = document.getElementById('yt-save-channel');
      if (saveChannelBtn) saveChannelBtn.onclick = saveChannel;

      // Bind export buttons
      const exportSeo    = document.getElementById('yt-export-seo');
      const exportThumbs = document.getElementById('yt-export-thumbs');
      const exportAll    = document.getElementById('yt-export-all');
      if (exportSeo)    exportSeo.onclick    = exportSeoReport;
      if (exportThumbs) exportThumbs.onclick = exportThumbPackage;
      if (exportAll)    exportAll.onclick    = exportPublishing;

      // Results delegated click
      const results = document.getElementById('yt-results');
      if (results) {
        results.onclick = (e) => {
          const tab = e.target.closest('[data-tab]');
          if (tab) { window.__ytCat = tab.dataset.tab; render(); return; }
          const copyText = e.target.closest('[data-copytext]');
          if (copyText) { copy(copyText.dataset.copytext, 'Title'); return; }
          const c = e.target.closest('[data-copy]');
          if (c) { handleCopy(c.dataset.copy); return; }
          const gen = e.target.closest('[data-gen-thumb]');
          if (gen) {
            const i = Number(gen.dataset.genThumb);
            const sel = results.querySelector(`[data-thumb-count="${i}"]`);
            generateThumbnails(i, Number(sel ? sel.value : 1));
          }
        };
      }

      loadChannel();
      updateProjectName();
      restore();
    } catch (e) {
      console.error('[YouTube Init Error]', e);
    }
  }

  // Run boot immediately — DOM is ready since this script is at end of body
  boot();

  // Re-bind on route changes (SPA navigation)
  window.addEventListener('hashchange', () => { setTimeout(boot, 50); });
  window.addEventListener('blvck-assets-changed', updateProjectName);
  if (window.BlvckData) window.BlvckData.register('youtube', refresh);

})();

