(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const card = $('youtube-card');
  const genBtn = $('yt-generate');
  const genSpinner = genBtn.querySelector('.spinner');
  const genLabel = genBtn.querySelector('.btn-label');
  const statusEl = $('yt-status');
  const results = $('yt-results');
  const projectNameEl = $('yt-project-name');
  const saveChannelBtn = $('yt-save-channel');

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
    statusEl.textContent = msg;
    statusEl.className = `status ${type}`;
    statusEl.hidden = false;
  }
  const clearStatus = () => (statusEl.hidden = true);

  function setGenerating(on) {
    genBtn.disabled = on;
    genSpinner.hidden = !on;
    genLabel.textContent = on ? 'Analyzing project…' : 'Generate optimization for this project';
  }

  // --- Project context ---------------------------------------------------

  function projectTitle() {
    const n = readLS('blvck-tts:narration');
    return (n && n.title) || 'Untitled';
  }

  function getProjectContext() {
    const ctx = { title: projectTitle() };
    const sb = readLS('blvck-tts:storyboard');
    if (sb && sb.bible) ctx.bible = sb.bible;
    const batch = readLS('blvck-tts:batch');
    if (batch && batch.items && batch.items.length) {
      ctx.script = batch.items.map((i) => i.text).join(' ');
    } else if (sb && sb.scenes) {
      ctx.subtitles = sb.scenes.map((s) => s.subtitle).filter(Boolean).join(' ');
    }
    return ctx;
  }

  // --- Generate ----------------------------------------------------------

  async function generate() {
    const ctx = getProjectContext();
    if (!ctx.script && !ctx.subtitles && !ctx.bible) {
      showStatus('This project has no story yet. Generate audio or a storyboard first, then optimize.');
      return;
    }
    clearStatus();
    setGenerating(true);
    try {
      const res = await fetch('/api/seo/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project: ctx, channel: collectChannel() })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.hint ? `${body.error} — ${body.hint}` : body.error || `Request failed (${res.status})`);
      seo = body.seo;
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
    if (!seo) {
      results.hidden = true;
      return;
    }
    results.hidden = false;

    $('yt-recommended').innerHTML =
      `<h3>Recommended title ${copyBtn('rec')}</h3><div class="yt-recommended-title" id="yt-rec-text">${esc(seo.recommendedTitle)}</div>`;

    const cat = window.__ytCat || 'seo';
    const tabs = ['seo', 'ctr', 'balanced'].map((c) => `<button class="yt-copy ${c === cat ? '' : ''}" data-tab="${c}" ${c === cat ? 'style="color:var(--accent);border-color:var(--accent)"' : ''}>${c.toUpperCase()} (${seo.titles[c].length})</button>`).join('');
    $('yt-titles').innerHTML =
      `<h3>Title variations</h3><div class="yt-tabs">${tabs}</div>` + seo.titles[cat].map(titleRow).join('');

    $('yt-desc').innerHTML =
      `<h3>Description ${copyBtn('desc-long')}</h3><div class="yt-pre" id="yt-desc-long">${esc(seo.description.long)}</div>` +
      `<h3 style="margin-top:.6rem">Short description ${copyBtn('desc-short')}</h3><div class="yt-pre" id="yt-desc-short">${esc(seo.description.short)}</div>`;

    const k = seo.keywords;
    $('yt-keywords').innerHTML =
      `<h3>Keywords ${copyBtn('kw')}</h3>` +
      `<div><strong>Primary:</strong> ${esc(k.primary)}</div>` +
      `<div style="margin-top:.35rem"><strong>Secondary:</strong> <span class="yt-chips">${k.secondary.map((x) => `<span class="yt-chip">${esc(x)}</span>`).join('')}</span></div>` +
      `<div style="margin-top:.35rem"><strong>Long-tail:</strong> <span class="yt-chips">${k.longTail.map((x) => `<span class="yt-chip">${esc(x)}</span>`).join('')}</span></div>` +
      `<div style="margin-top:.35rem" class="field-note"><strong>Search intent:</strong> ${esc(k.intent)}</div>`;

    const tg = seo.tags;
    const tagGroup = (label, list) => `<div style="margin-top:.35rem"><strong>${label}:</strong> <span class="yt-chips">${list.map((x) => `<span class="yt-chip">${esc(x)}</span>`).join('')}</span></div>`;
    $('yt-tags').innerHTML =
      `<h3>Tags ${copyBtn('tags')}</h3>` + tagGroup('Broad', tg.broad) + tagGroup('Niche', tg.niche) + tagGroup('Long-tail', tg.longTail) + tagGroup('Trending', tg.trending);

    const h = seo.hashtags;
    $('yt-hashtags').innerHTML =
      `<h3>Hashtags ${copyBtn('hashtags')}</h3>` + tagGroup('High volume', h.highVolume) + tagGroup('Niche', h.niche) + tagGroup('Brand', h.brand);

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
        const res = await fetch('/api/image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ prompt: thumbPrompt(concept), aspect: '16:9' })
        });
        if (!res.ok) {
          const b = await res.json().catch(() => ({}));
          const quota = res.status === 429 || /quota|exceeded|billing/i.test(b.error || '');
          showStatus(`${quota ? 'Image quota reached' : 'Thumbnail failed'}: ${b.error || res.status}. ${count > 1 ? `${n} generated.` : ''}`.trim());
          if (quota) break;
          continue;
        }
        const blob = await res.blob();
        const id = ++thumbCounter;
        thumbUrls.set(id, URL.createObjectURL(blob));
        await idbPut(String(id), blob);
        thumbs.push({ id, version: concept.version, prompt: thumbPrompt(concept) });
        persist();
        renderThumbs();
      } catch (err) {
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

  // --- Events ------------------------------------------------------------

  saveChannelBtn.addEventListener('click', saveChannel);
  genBtn.addEventListener('click', generate);
  results.addEventListener('click', (e) => {
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
  });
  $('yt-export-seo').addEventListener('click', exportSeoReport);
  $('yt-export-thumbs').addEventListener('click', exportThumbPackage);
  $('yt-export-all').addEventListener('click', exportPublishing);

  function handleCopy(kind) {
    if (!seo) return;
    if (kind === 'rec') return copy(seo.recommendedTitle, 'Recommended title');
    if (kind === 'desc-long') return copy(seo.description.long, 'Description');
    if (kind === 'desc-short') return copy(seo.description.short, 'Short description');
    if (kind === 'kw') return copy([seo.keywords.primary, ...seo.keywords.secondary, ...seo.keywords.longTail].join(', '), 'Keywords');
    if (kind === 'tags') return copy([...seo.tags.broad, ...seo.tags.niche, ...seo.tags.longTail, ...seo.tags.trending].join(', '), 'Tags');
    if (kind === 'hashtags') return copy([...seo.hashtags.highVolume, ...seo.hashtags.niche, ...seo.hashtags.brand].join(' '), 'Hashtags');
  }

  // --- Init --------------------------------------------------------------

  (async () => {
    try {
      const res = await fetch('/api/health');
      const body = await res.json();
      if (!body.seoConfigured) return;
      card.hidden = false;
      loadChannel();
      projectNameEl.textContent = `Project: ${projectTitle()}`;
      await restore();
    } catch {
      /* leave hidden */
    }
  })();
})();
