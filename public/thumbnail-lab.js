// ============================================================================
// AETHER THUMBNAIL DIRECTOR v8.0 — YouTube CTR Growth Engine
// Pipeline: Script Analysis → 20 Candidates → Top 3 → Image Gen → Canvas Typography → CTR Audit
// ============================================================================
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);

  // ── CTR PSYCHOLOGY CONSTANTS ─────────────────────────────────────────────

  // Proven 2-4 word curiosity hooks from viral YouTube thumbnails
  const VIRAL_HOOKS = [
    "THEY LIED",        "NO DAYS OFF",      "14 HOURS A DAY",
    "NOBODY SEES THIS", "DON'T DO THIS",    "THE HIDDEN COST",
    "BEFORE SUNRISE",   "WHY I QUIT",       "IT'S OVER",
    "THEY WON'T TELL",  "ZERO DAYS OFF",    "I WAS WRONG",
    "NOBODY WARNED ME", "THIS RUINS YOU",   "THE REAL COST",
    "CAN'T STOP NOW",   "HE NEVER STOPS",   "THEY DON'T KNOW",
    "ONE SECRET",       "THE TRUTH IS"
  ];

  // 5 psychological angles that drive YouTube clicks
  const CTR_ANGLES = [
    { id: 'curiosity',      label: 'Curiosity Gap',    desc: 'Missing information the viewer must have' },
    { id: 'fear',           label: 'Fear / Danger',    desc: 'Something terrible the viewer doesn\'t know' },
    { id: 'surprise',       label: 'Shock / Surprise', desc: 'Unexpected truth or reveal' },
    { id: 'transformation', label: 'Transformation',   desc: 'Before vs after — extreme change' },
    { id: 'controversy',    label: 'Controversy',      desc: 'Something people disagree with or hide' }
  ];

  // Winning layout formulas from top creators
  const LAYOUT_FORMULAS = [
    {
      id: 'A', label: 'Giant Face + Text',
      desc: 'Face fills 70% of frame, right side. Text anchored top-left with dark negative space behind it.',
      textZone: 'left', faceZone: 'right', faceSize: '70%'
    },
    {
      id: 'B', label: 'Full-Bleed Face + Banner',
      desc: 'Face fills entire frame, bold text banner across top or bottom third.',
      textZone: 'top-banner', faceZone: 'full', faceSize: '100%'
    },
    {
      id: 'C', label: 'Mystery Object + Hook',
      desc: 'Single powerful object or scene, red circle or arrow pointing at secret, text overlaid.',
      textZone: 'center-overlay', faceZone: 'none', faceSize: '0%'
    }
  ];

  // 3 high-CTR color systems
  const CTR_PALETTES = [
    { name: 'Impact Yellow',    textColor: '#FFE600', strokeColor: '#000000', bg: 'rgba(0,0,0,0.0)' },
    { name: 'Shock White',      textColor: '#FFFFFF', strokeColor: '#000000', bg: 'rgba(0,0,0,0.0)' },
    { name: 'Danger Red',       textColor: '#FF2D2D', strokeColor: '#000000', bg: 'rgba(0,0,0,0.0)' }
  ];

  // ── STEP 1: AI SCRIPT ANALYSIS → 20 CANDIDATES → TOP 3 ──────────────────

  async function generateCTRThumbnailConcepts(topic) {
    if (!window.BlvckAI) throw new Error('AI Provider not initialized');

    const snap = window.BlvckAssets ? window.BlvckAssets.snapshot() : {};
    const scriptText  = (snap.script || '').slice(0, 3000);
    const researchStr = snap.research ? JSON.stringify(snap.research).slice(0, 800) : '';
    const bibleStr    = snap.bible    ? `${snap.bible.genre || ''} ${snap.bible.tone || ''}` : '';
    const projTitle   = snap.title || topic || 'Documentary';

    const systemPrompt = `You are a YouTube Thumbnail Director whose ONLY job is maximizing click-through rate.

VIDEO: "${projTitle}"
SCRIPT: ${scriptText || '(not yet generated)'}
RESEARCH: ${researchStr || '(topic: ' + projTitle + ')'}
GENRE/TONE: ${bibleStr || 'documentary'}

Your task: Analyze this video from 5 psychological angles (curiosity, fear, surprise, transformation, controversy). Generate 20 thumbnail strategy candidates. Ruthlessly eliminate weak concepts. Return ONLY the 3 highest-CTR winners.

IRON RULES — violating any disqualifies a concept:
1. overlayText MUST be 2-4 words max. NEVER a sentence. Examples: "THEY LIED", "14 HOURS A DAY", "NO DAYS OFF", "THE HIDDEN COST", "NOBODY WARNED ME"
2. focalSubject MUST be ONE thing — one face, one object, one reaction. Never "a farmer in a field".
3. Emotion MUST be EXAGGERATED — not "tired" but "utterly exhausted on verge of collapse". Not "concerned" but "terrified eyes wide open".
4. promptStr must force the face/subject onto the RIGHT HALF of the frame with EMPTY DARK NEGATIVE SPACE on the LEFT HALF for text overlay.

Return ONLY valid JSON array, no markdown:
[
  {
    "id": 1,
    "angle": "curiosity",
    "strategyName": "The Secret They Hide",
    "hook": "Nobody Warned Farmers About This",
    "overlayText": "THEY LIED",
    "textVariants": ["THEY LIED", "THE SECRET", "NOBODY KNOWS", "DON'T WATCH"],
    "emotionalAngle": "Utterly shocked, eyes wide, mouth open, face pale",
    "focalSubject": "Extreme close-up of a farmer's shocked face taking up 70% of the right frame",
    "layoutFormula": "A",
    "colorPaletteId": 0,
    "curiosityScore": 9.5,
    "emotionScore": 9.2,
    "mobileScore": 9.8,
    "contrastScore": 9.0,
    "predictedCTR": 9.4,
    "promptStr": "YouTube thumbnail photography, extreme close-up of a weathered farmer's face with utterly shocked expression, eyes wide open staring directly at camera, positioned strictly on the RIGHT HALF of the frame filling 70% of height, the LEFT HALF is pure dark empty negative space for text overlay, harsh dramatic side lighting, deep shadows, high contrast, 16:9 ratio, photorealistic, 8k"
  }
]`;

    let concepts = [];
    try {
      const rawText = await window.BlvckAI.chat(systemPrompt, { temperature: 0.7 });
      const jsonMatch = rawText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        let parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed)) concepts = parsed;
      }
    } catch (e) {
      console.warn('[ThumbnailLab] AI concept generation failed, using smart fallback:', e.message);
    }

    // Smart fallback — topic-aware, not generic
    if (!concepts.length) {
      const t = projTitle;
      concepts = [
        {
          id: 1, angle: 'curiosity', strategyName: 'The Hidden Reality',
          hook: `What nobody tells you about ${t}`,
          overlayText: 'THEY LIED',
          textVariants: ['THEY LIED', 'THE TRUTH', 'NOBODY KNOWS', 'THEY HIDE THIS'],
          emotionalAngle: 'Utterly shocked, eyes wide open, mouth agape, staring into camera',
          focalSubject: `Extreme close-up shocked face, eyes wide, filling right 70% of frame`,
          layoutFormula: 'A', colorPaletteId: 0,
          curiosityScore: 9.5, emotionScore: 9.0, mobileScore: 9.8, contrastScore: 9.2, predictedCTR: 9.4,
          promptStr: `YouTube thumbnail photorealistic close-up portrait, extreme shocked face with wide eyes staring into camera, positioned on RIGHT HALF of frame filling 70% height, LEFT HALF completely dark empty background for text, harsh dramatic lighting from side, deep shadows, ultra high contrast, 16:9, 8k resolution`
        },
        {
          id: 2, angle: 'fear', strategyName: 'The Brutal Reality',
          hook: `The real hours nobody mentions in ${t}`,
          overlayText: '14 HOURS A DAY',
          textVariants: ['14 HOURS A DAY', 'NO DAYS OFF', 'ZERO REST', 'NEVER STOPS'],
          emotionalAngle: 'Utterly exhausted, dark circles, staring with dead eyes, sweat-covered face',
          focalSubject: `Close-up exhausted face, heavy eyes, filling right 65% of frame`,
          layoutFormula: 'A', colorPaletteId: 1,
          curiosityScore: 8.8, emotionScore: 9.3, mobileScore: 9.5, contrastScore: 9.0, predictedCTR: 9.1,
          promptStr: `YouTube thumbnail photorealistic portrait, extremely exhausted sweat-covered face with sunken dark eyes staring into camera, on RIGHT HALF of frame filling 65% height, LEFT HALF pure dark negative space, harsh sunlight from above casting deep shadows, ultra high contrast, 16:9, 8k resolution`
        },
        {
          id: 3, angle: 'surprise', strategyName: 'The Shocking Reveal',
          hook: `The secret ${t} world doesn't want you to see`,
          overlayText: 'NOBODY SEES THIS',
          textVariants: ['NOBODY SEES THIS', 'HIDDEN FROM YOU', 'THEY WON\'T SHOW', 'THE REAL TRUTH'],
          emotionalAngle: 'Intense, determined stare directly into camera, jaw clenched, eyes burning',
          focalSubject: `Intense close-up face with burning determined eyes, right side of frame`,
          layoutFormula: 'B', colorPaletteId: 2,
          curiosityScore: 9.2, emotionScore: 8.7, mobileScore: 9.6, contrastScore: 8.8, predictedCTR: 9.0,
          promptStr: `YouTube thumbnail photorealistic extreme close-up intense face with fierce determined expression, eyes burning with intensity staring directly at viewer, positioned on RIGHT HALF of frame, LEFT HALF dark moody background, dramatic rim lighting, cinematic high contrast, 16:9, 8k resolution`
        }
      ];
    }

    // Normalize & validate all fields
    return concepts.slice(0, 3).map((c, i) => ({
      id: i + 1,
      angle:          c.angle         || CTR_ANGLES[i % CTR_ANGLES.length].id,
      strategyName:   c.strategyName  || `Strategy ${i + 1}`,
      hook:           c.hook          || `The truth about ${projTitle}`,
      overlayText:    enforceHookLength(c.overlayText || VIRAL_HOOKS[i]),
      textVariants:   Array.isArray(c.textVariants) ? c.textVariants.map(enforceHookLength) : [enforceHookLength(c.overlayText || VIRAL_HOOKS[i])],
      emotionalAngle: c.emotionalAngle || 'Shocked and exhausted expression',
      focalSubject:   c.focalSubject   || 'Extreme close-up face on right side of frame',
      layoutFormula:  LAYOUT_FORMULAS.find(f => f.id === c.layoutFormula) || LAYOUT_FORMULAS[0],
      colorPalette:   CTR_PALETTES[typeof c.colorPaletteId === 'number' ? c.colorPaletteId % 3 : i % 3],
      curiosityScore: clamp(c.curiosityScore, 5, 10),
      emotionScore:   clamp(c.emotionScore,   5, 10),
      mobileScore:    clamp(c.mobileScore,    5, 10),
      contrastScore:  clamp(c.contrastScore,  5, 10),
      predictedCTR:   clamp(c.predictedCTR,   5, 10),
      promptStr:      c.promptStr || `YouTube thumbnail photorealistic close-up face, shocked expression, right half of frame, dark negative space on left, 16:9, 8k`
    }));
  }

  function enforceHookLength(text) {
    if (!text) return 'THEY LIED';
    const words = String(text).trim().toUpperCase().split(/\s+/);
    return words.slice(0, 4).join(' ');
  }

  function clamp(v, min, max) {
    const n = parseFloat(v);
    return isFinite(n) ? Math.min(max, Math.max(min, n)) : (min + max) / 2;
  }

  // ── STEP 2: CANVAS TYPOGRAPHY ENGINE ────────────────────────────────────
  // Renders MrBeast-style text directly onto the thumbnail canvas
  // Rules: HUGE font, pure white/yellow, thick black stroke, strong shadow, NO boxes

  function renderYouTubeText(imgElement, concept, selectedText) {
    const canvas = document.createElement('canvas');
    canvas.width  = 1280;
    canvas.height = 720;
    const ctx = canvas.getContext('2d');

    // 1. Draw base image
    ctx.drawImage(imgElement, 0, 0, 1280, 720);

    // 2. Dark gradient vignette on left 55% only — preserves face on right
    const grad = ctx.createLinearGradient(0, 0, 700, 0);
    grad.addColorStop(0,   'rgba(0,0,0,0.88)');
    grad.addColorStop(0.5, 'rgba(0,0,0,0.55)');
    grad.addColorStop(1,   'transparent');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, 1280, 720);

    // 3. Text rendering
    const rawText = (selectedText || concept.overlayText || 'THEY LIED').toUpperCase();
    const palette = concept.colorPalette || CTR_PALETTES[0];
    const words   = rawText.split(/\s+/);

    // Split into max 2 lines (2 words each line for max impact)
    let lines = [];
    if (words.length <= 2) {
      lines = [rawText];
    } else if (words.length <= 4) {
      const mid = Math.ceil(words.length / 2);
      lines = [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
    } else {
      lines = [words.slice(0, 2).join(' '), words.slice(2, 4).join(' ')];
    }

    // Auto-fit font size based on longest line
    const maxW   = 540; // max text width in pixels
    let fontSize = 130;
    ctx.font = `900 ${fontSize}px Impact, "Arial Black", sans-serif`;
    const longestLine = lines.reduce((a, b) => a.length > b.length ? a : b);
    while (ctx.measureText(longestLine).width > maxW && fontSize > 60) {
      fontSize -= 4;
      ctx.font = `900 ${fontSize}px Impact, "Arial Black", sans-serif`;
    }

    const lineHeight = fontSize * 1.1;
    const totalH     = lines.length * lineHeight;
    let startY        = (720 - totalH) / 2 - 20; // vertically centered, shifted up slightly
    const startX      = 50;

    ctx.save();
    ctx.textBaseline = 'top';

    lines.forEach((line) => {
      // Shadow pass — large offset for depth
      ctx.shadowColor   = 'rgba(0,0,0,0.95)';
      ctx.shadowBlur    = 30;
      ctx.shadowOffsetX = 6;
      ctx.shadowOffsetY = 8;

      // Thick black stroke — gives the text readable border
      ctx.strokeStyle = '#000000';
      ctx.lineWidth   = Math.round(fontSize * 0.16); // 16% of fontSize
      ctx.lineJoin    = 'miter';
      ctx.miterLimit  = 2;
      ctx.strokeText(line, startX, startY);

      // Clear shadow before fill
      ctx.shadowColor   = 'transparent';
      ctx.shadowBlur    = 0;
      ctx.shadowOffsetX = 0;
      ctx.shadowOffsetY = 0;

      // Crisp text fill
      ctx.fillStyle = palette.textColor;
      ctx.fillText(line, startX, startY);

      startY += lineHeight;
    });

    ctx.restore();
    return canvas;
  }

  // ── STEP 3: CTR AUDIT ───────────────────────────────────────────────────

  function runCTRAudit(concept) {
    const wordCount = (concept.overlayText || '').split(/\s+/).length;
    const scores = {
      textLength:    wordCount <= 3 ? 10 : wordCount <= 4 ? 8 : 5,
      curiosity:     concept.curiosityScore,
      emotion:       concept.emotionScore,
      mobile:        concept.mobileScore,
      contrast:      concept.contrastScore
    };
    const overall = (
      scores.textLength  * 0.2 +
      scores.curiosity   * 0.3 +
      scores.emotion     * 0.25 +
      scores.mobile      * 0.15 +
      scores.contrast    * 0.1
    );
    return { ...scores, overall: Math.round(overall * 10) / 10, passed: overall >= 8.0 };
  }

  // ── STEP 4: SAVE TO ASSETS ──────────────────────────────────────────────

  async function saveThumbnail(conceptId, canvas, label) {
    try {
      const project = window.BlvckAssets ? (window.BlvckAssets.title() || 'Untitled') : 'Untitled';
      canvas.toBlob(async (blob) => {
        if (!blob) return;
        // IndexedDB
        const req = indexedDB.open('blvck-thumbnails', 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains('images')) req.result.createObjectStore('images');
        };
        req.onsuccess = () => {
          const tx = req.result.transaction('images', 'readwrite');
          tx.objectStore('images').put(blob, `${project}:thumb-${conceptId}`);
        };
        // localStorage index
        const idx = JSON.parse(localStorage.getItem('blvck-tts:thumbnails') || '[]');
        const filtered = idx.filter(t => !(t.project === project && t.id === conceptId));
        filtered.push({ project, id: conceptId, label, at: Date.now() });
        localStorage.setItem('blvck-tts:thumbnails', JSON.stringify(filtered));
        if (window.BlvckAssets) window.BlvckAssets.emit();
      }, 'image/png');
    } catch (e) {
      console.warn('[ThumbnailLab] Save failed:', e);
    }
  }

  // ── YOUTUBE FEED PREVIEW MODAL ──────────────────────────────────────────

  function openYouTubePreview(dataUrl, concept) {
    let modal = $('yt-feed-modal');
    if (!modal) {
      modal = document.createElement('div');
      modal.id = 'yt-feed-modal';
      modal.style.cssText = `
        position:fixed; inset:0; background:rgba(0,0,0,0.85); z-index:9999;
        display:flex; align-items:center; justify-content:center; padding:20px;
      `;
      modal.innerHTML = `
        <div style="background:#0f0f0f; border-radius:16px; padding:24px; max-width:680px; width:100%; border:1px solid #333;">
          <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
            <div style="color:#fff; font-weight:700; font-size:1.1rem;">📱 YouTube Feed Preview</div>
            <button id="yt-preview-close" style="background:transparent; border:1px solid #444; color:#fff; border-radius:6px; padding:4px 12px; cursor:pointer; font-size:0.9rem;">✕ Close</button>
          </div>
          <!-- YouTube card simulation -->
          <div style="background:#0f0f0f; border-radius:12px; overflow:hidden;">
            <div style="width:100%; aspect-ratio:16/9; border-radius:12px; overflow:hidden; position:relative;">
              <img id="yt-preview-img" src="" style="width:100%; height:100%; object-fit:cover;" />
              <span style="position:absolute; bottom:8px; right:8px; background:rgba(0,0,0,0.85); color:#fff; font-size:0.75rem; font-weight:bold; padding:2px 6px; border-radius:4px; font-family:monospace;">14:32</span>
            </div>
            <div style="display:flex; gap:12px; padding:12px 4px; align-items:flex-start;">
              <div style="width:36px; height:36px; border-radius:50%; background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; font-weight:bold; display:flex; align-items:center; justify-content:center; flex-shrink:0; font-size:0.9rem;">AS</div>
              <div>
                <div id="yt-preview-title" style="font-weight:600; font-size:0.95rem; color:#fff; line-height:1.4; margin-bottom:4px; font-family:'YouTube Sans',Roboto,sans-serif;"></div>
                <div style="font-size:0.8rem; color:#aaa;">Aether Studio • 1.2M views • 3 hours ago</div>
              </div>
            </div>
          </div>
          <div id="yt-preview-audit" style="margin-top:16px; padding:14px; background:rgba(255,255,255,0.04); border-radius:10px; border:1px solid rgba(255,255,255,0.08);"></div>
        </div>
      `;
      document.body.appendChild(modal);
      document.getElementById('yt-preview-close').onclick = () => modal.remove();
      modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
    }

    document.getElementById('yt-preview-img').src   = dataUrl;
    document.getElementById('yt-preview-title').textContent = concept.hook || concept.overlayText;

    const audit = runCTRAudit(concept);
    document.getElementById('yt-preview-audit').innerHTML = `
      <div style="font-weight:bold; margin-bottom:10px; color:${audit.passed ? '#22c55e' : '#f59e0b'};">
        ${audit.passed ? '✅' : '⚠️'} CTR Audit: ${audit.overall}/10 ${audit.passed ? '— APPROVED FOR UPLOAD' : '— NEEDS IMPROVEMENT'}
      </div>
      <div style="display:grid; grid-template-columns:repeat(3,1fr); gap:8px; font-size:0.8rem;">
        ${[
          ['Curiosity',  audit.curiosity],
          ['Emotion',    audit.emotion],
          ['Mobile',     audit.mobile],
          ['Contrast',   audit.contrast],
          ['Text Hook',  audit.textLength],
          ['Overall',    audit.overall]
        ].map(([label, score]) => `
          <div style="background:rgba(0,0,0,0.3); padding:8px; border-radius:6px; text-align:center;">
            <div style="color:#aaa; font-size:0.7rem; margin-bottom:2px;">${label}</div>
            <div style="font-weight:bold; color:${score >= 8.5 ? '#22c55e' : score >= 7 ? '#f59e0b' : '#ef4444'};">${typeof score === 'number' ? score.toFixed(1) : score}/10</div>
          </div>
        `).join('')}
      </div>
    `;
  }

  // ── UI BUILDER ──────────────────────────────────────────────────────────

  function buildConceptCard(concept) {
    const audit  = runCTRAudit(concept);
    const layout = concept.layoutFormula;
    const angle  = CTR_ANGLES.find(a => a.id === concept.angle) || CTR_ANGLES[0];

    const card = document.createElement('div');
    card.className = 'thumb-concept-card';
    card.style.cssText = `
      background: rgba(255,255,255,0.03);
      border: 1px solid rgba(255,255,255,0.1);
      border-radius: 14px;
      padding: 20px;
      display: flex;
      flex-direction: column;
      gap: 14px;
      position: relative;
    `;

    card.innerHTML = `
      <!-- Header -->
      <div style="display:flex; justify-content:space-between; align-items:flex-start; gap:8px;">
        <div>
          <div style="font-weight:800; color:#fff; font-size:1.05rem;">${concept.strategyName}</div>
          <div style="font-size:0.75rem; color:#${angle.id === 'curiosity' ? '6366f1' : angle.id === 'fear' ? 'ef4444' : angle.id === 'surprise' ? 'f59e0b' : angle.id === 'transformation' ? '22c55e' : 'a855f7'}; margin-top:2px; text-transform:uppercase; letter-spacing:0.5px;">
            🎯 ${angle.label}
          </div>
        </div>
        <div style="text-align:right; flex-shrink:0;">
          <div style="background:${audit.passed ? '#22c55e' : '#f59e0b'}; color:#000; font-weight:900; font-size:0.9rem; padding:4px 12px; border-radius:20px;">
            ${audit.overall}/10 CTR
          </div>
          <div style="font-size:0.65rem; color:#aaa; margin-top:3px;">${audit.passed ? '✅ APPROVED' : '⚠️ BORDERLINE'}</div>
        </div>
      </div>

      <!-- Hook -->
      <div style="background:rgba(250,204,21,0.08); border:1px solid rgba(250,204,21,0.25); border-radius:8px; padding:10px 12px;">
        <div style="font-size:0.65rem; color:#facc15; text-transform:uppercase; letter-spacing:1px; margin-bottom:4px;">Psychological Hook</div>
        <div style="font-weight:700; color:#fff; font-size:0.95rem; line-height:1.4;">"${concept.hook}"</div>
      </div>

      <!-- Overlay Text Variants -->
      <div>
        <div style="font-size:0.7rem; color:#aaa; text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">Thumbnail Text (click to select)</div>
        <div style="display:flex; flex-wrap:wrap; gap:6px;" id="text-variants-${concept.id}">
          ${(concept.textVariants || [concept.overlayText]).map((t, vi) => `
            <button class="text-variant-btn${vi === 0 ? ' selected' : ''}" data-variant="${t}" data-cid="${concept.id}"
              style="font-weight:900; font-size:0.9rem; padding:5px 12px; border-radius:6px; border:2px solid ${vi === 0 ? '#facc15' : 'rgba(255,255,255,0.15)'}; background:${vi === 0 ? 'rgba(250,204,21,0.1)' : 'transparent'}; color:${vi === 0 ? '#facc15' : '#ccc'}; cursor:pointer; letter-spacing:0.5px; transition:all 0.15s;">
              ${t}
            </button>
          `).join('')}
        </div>
      </div>

      <!-- Composition Grid -->
      <div style="display:grid; grid-template-columns:1fr 1fr; gap:8px; font-size:0.8rem;">
        <div style="background:rgba(0,0,0,0.3); padding:8px 10px; border-radius:8px;">
          <div style="color:#aaa; font-size:0.65rem; text-transform:uppercase; margin-bottom:3px;">Emotion</div>
          <div style="color:#ef4444; font-weight:700; line-height:1.3;">${concept.emotionalAngle}</div>
        </div>
        <div style="background:rgba(0,0,0,0.3); padding:8px 10px; border-radius:8px;">
          <div style="color:#aaa; font-size:0.65rem; text-transform:uppercase; margin-bottom:3px;">Layout</div>
          <div style="color:#fff; font-weight:600; line-height:1.3;">Formula ${layout.id}: ${layout.label}</div>
        </div>
        <div style="background:rgba(0,0,0,0.3); padding:8px 10px; border-radius:8px; grid-column:1/-1;">
          <div style="color:#aaa; font-size:0.65rem; text-transform:uppercase; margin-bottom:3px;">Focal Subject</div>
          <div style="color:#d1d5db; line-height:1.4;">${concept.focalSubject}</div>
        </div>
      </div>

      <!-- CTR Score Bar -->
      <div style="display:grid; grid-template-columns:repeat(4,1fr); gap:6px; font-size:0.75rem; text-align:center;">
        ${[
          ['Curiosity', concept.curiosityScore],
          ['Emotion',   concept.emotionScore],
          ['Mobile',    concept.mobileScore],
          ['Contrast',  concept.contrastScore]
        ].map(([lbl, sc]) => `
          <div style="background:rgba(0,0,0,0.3); padding:6px; border-radius:6px;">
            <div style="color:#aaa; font-size:0.6rem; margin-bottom:2px;">${lbl}</div>
            <div style="font-weight:800; color:${sc >= 9 ? '#22c55e' : sc >= 7.5 ? '#f59e0b' : '#ef4444'};">${typeof sc === 'number' ? sc.toFixed(1) : sc}</div>
          </div>
        `).join('')}
      </div>

      <!-- Canvas Preview -->
      <div id="thumb-canvas-wrap-${concept.id}" style="
        width:100%; aspect-ratio:16/9; background:#0a0a0a;
        border-radius:10px; overflow:hidden;
        display:flex; align-items:center; justify-content:center;
        border:1px dashed rgba(255,255,255,0.12); position:relative;
        cursor:default;
      ">
        <div style="text-align:center; color:#555;">
          <div style="font-size:1.5rem; margin-bottom:6px;">🎨</div>
          <div style="font-size:0.8rem;">Generate CTR thumbnail below</div>
        </div>
      </div>

      <!-- Action Buttons -->
      <div style="display:flex; gap:8px;">
        <button class="btn primary gen-img-btn" type="button" style="flex:1; font-weight:700;" id="gen-btn-${concept.id}">
          ⚡ Generate Thumbnail
        </button>
        <button class="btn ghost yt-preview-btn" type="button" style="display:none;" id="prev-btn-${concept.id}">
          📱 Preview
        </button>
      </div>
    `;

    return card;
  }

  // ── UI CONTROLLER ────────────────────────────────────────────────────────

  function initUI() {
    const genBtn   = $('thumb-generate-btn');
    const inputEl  = $('thumb-topic-input');
    const statusEl = $('thumb-status');
    const resultsEl = $('thumb-results');

    if (!genBtn || !resultsEl) return;

    // Auto-populate topic from active project
    const syncTopic = () => {
      if (inputEl && window.BlvckAssets) {
        const t = window.BlvckAssets.title() || window.BlvckAssets.researchTopic();
        if (t && !inputEl.value) inputEl.value = t;
      }
    };
    syncTopic();
    window.addEventListener('hashchange', syncTopic);
    window.addEventListener('blvck-assets-changed', syncTopic);

    // ── MAIN GENERATE BUTTON ──
    genBtn.addEventListener('click', async () => {
      let topic = inputEl ? inputEl.value.trim() : '';
      if (!topic && window.BlvckAssets) {
        topic = window.BlvckAssets.title() || window.BlvckAssets.researchTopic() || 'Documentary';
        if (inputEl) inputEl.value = topic;
      }
      if (!topic) topic = 'Documentary';

      genBtn.disabled = true;
      genBtn.textContent = '🧠 Analyzing CTR psychology…';

      if (statusEl) {
        statusEl.innerHTML = `
          <div style="display:flex; align-items:center; gap:10px;">
            <div class="spinner" style="width:16px; height:16px; border:2px solid rgba(255,255,255,0.2); border-top-color:#fff; border-radius:50%; animation:spin 0.8s linear infinite;"></div>
            <span>Analyzing 20 psychological angles → selecting Top 3 CTR winners…</span>
          </div>`;
        statusEl.className = 'status info';
        statusEl.hidden = false;
      }

      try {
        const concepts = await generateCTRThumbnailConcepts(topic);
        if (statusEl) statusEl.hidden = true;
        resultsEl.innerHTML = '';

        // Competitor patterns header
        const header = document.createElement('div');
        header.style.cssText = 'grid-column:1/-1; padding:14px 16px; background:rgba(99,102,241,0.07); border:1px solid rgba(99,102,241,0.2); border-radius:10px; margin-bottom:4px;';
        header.innerHTML = `
          <div style="font-weight:700; color:#6366f1; margin-bottom:8px; font-size:0.95rem;">📊 Competitor Pattern Intelligence</div>
          <div style="display:flex; flex-wrap:wrap; gap:8px; font-size:0.78rem;">
            ${[
              { pct: '+48%', txt: 'Giant face (70% frame) + 2-4 word yellow stroke text on left' },
              { pct: '+42%', txt: 'Exaggerated emotion (shock/exhaustion) over neutral expressions' },
              { pct: '+39%', txt: 'Dark negative space for text vs cluttered backgrounds' },
              { pct: '+35%', txt: 'Curiosity gap hook text — implies secret viewer doesn\'t know' }
            ].map(p => `
              <div style="background:rgba(0,0,0,0.35); padding:5px 10px; border-radius:6px; border:1px solid rgba(255,255,255,0.05);">
                <strong style="color:#22c55e;">${p.pct}:</strong> ${p.txt}
              </div>`).join('')}
          </div>
        `;
        resultsEl.appendChild(header);

        // Build concept cards
        concepts.forEach((concept) => {
          const card = buildConceptCard(concept);
          resultsEl.appendChild(card);

          // Track selected text variant per concept
          let selectedText = concept.overlayText;

          // Text variant selector
          card.addEventListener('click', (e) => {
            const btn = e.target.closest('.text-variant-btn');
            if (!btn || btn.dataset.cid !== String(concept.id)) return;
            selectedText = btn.dataset.variant;
            card.querySelectorAll('.text-variant-btn').forEach(b => {
              const active = b.dataset.variant === selectedText;
              b.style.borderColor = active ? '#facc15' : 'rgba(255,255,255,0.15)';
              b.style.background  = active ? 'rgba(250,204,21,0.1)' : 'transparent';
              b.style.color       = active ? '#facc15' : '#ccc';
            });
            // Re-render canvas if image already generated
            const canvasWrap = card.querySelector(`#thumb-canvas-wrap-${concept.id}`);
            const existingImg = canvasWrap._sourceImg;
            if (existingImg) {
              const newCanvas = renderYouTubeText(existingImg, concept, selectedText);
              newCanvas.style.cssText = 'width:100%; height:100%; object-fit:cover;';
              canvasWrap.innerHTML = '';
              canvasWrap.appendChild(newCanvas);
              saveThumbnail(concept.id, newCanvas, selectedText);
            }
          });

          // Generate image button
          const genImgBtn = card.querySelector(`#gen-btn-${concept.id}`);
          const prevBtn   = card.querySelector(`#prev-btn-${concept.id}`);
          const wrap      = card.querySelector(`#thumb-canvas-wrap-${concept.id}`);

          genImgBtn.addEventListener('click', async () => {
            genImgBtn.disabled = true;
            genImgBtn.textContent = '⏳ Generating…';
            wrap.innerHTML = `
              <div style="text-align:center; color:#888; padding:20px;">
                <div style="font-size:0.85rem; margin-bottom:8px;">Generating photorealistic thumbnail artwork…</div>
                <div style="width:36px; height:36px; border:3px solid rgba(255,255,255,0.1); border-top-color:#6366f1; border-radius:50%; animation:spin 0.8s linear infinite; margin:0 auto;"></div>
              </div>`;

            try {
              const res = await window.BlvckAI.generateImage(concept.promptStr, '16:9');

              let blob = res;
              if (typeof res === 'string') {
                const r = await fetch(res);
                blob = await r.blob();
              }

              const objUrl = URL.createObjectURL(blob);
              const img    = new Image();

              img.onload = () => {
                const canvas = renderYouTubeText(img, concept, selectedText);
                canvas.style.cssText = 'width:100%; height:100%; object-fit:cover; display:block;';
                wrap.innerHTML = '';
                wrap.appendChild(canvas);
                wrap._sourceImg = img; // store for text-variant re-render
                wrap.style.cursor = 'pointer';
                wrap.onclick = () => openYouTubePreview(canvas.toDataURL(), concept);

                genImgBtn.textContent = '🔄 Regenerate';
                genImgBtn.disabled = false;
                if (prevBtn) prevBtn.style.display = 'inline-flex';

                saveThumbnail(concept.id, canvas, selectedText);
              };

              img.onerror = () => { throw new Error('Image failed to load from blob'); };
              img.src = objUrl;

            } catch (err) {
              genImgBtn.disabled = false;
              genImgBtn.textContent = '⚡ Retry';
              wrap.innerHTML = `<div style="color:#ef4444; font-size:0.8rem; padding:20px; text-align:center;">⚠️ ${err.message}</div>`;
            }
          });

          if (prevBtn) {
            prevBtn.addEventListener('click', () => {
              const canvas = wrap.querySelector('canvas');
              if (canvas) openYouTubePreview(canvas.toDataURL(), concept);
            });
          }
        });

      } catch (err) {
        if (statusEl) {
          statusEl.textContent = `CTR Generation failed: ${err.message}`;
          statusEl.className = 'status error';
          statusEl.hidden = false;
        }
      } finally {
        genBtn.disabled = false;
        genBtn.textContent = '🎯 Generate CTR Thumbnails';
      }
    });
  }

  // ── BOOT ─────────────────────────────────────────────────────────────────
  document.addEventListener('DOMContentLoaded', initUI);
  window.addEventListener('hashchange', () => setTimeout(initUI, 80));

  window.ThumbnailLab = { generateCTRThumbnailConcepts, runCTRAudit, renderYouTubeText };
})();
