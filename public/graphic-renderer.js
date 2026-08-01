// Graphic Renderer — draws the frames a diffusion model cannot.
//
// Image models have no character-level understanding of language, so any text
// they draw comes out as pseudo-lettering. That is why a beat about a
// "50-point checklist" produced "Conrulttbt Saey Clecklist". The failure is
// architectural, not a quality setting, and it is not fixed by a better
// checkpoint or a bigger GPU — no diffusion model reliably renders a
// structured document with dozens of legible lines.
//
// So those beats are not sent to the GPU at all. They are drawn here with real
// fonts on a canvas: correct spelling every time, brand colours, and effectively
// instant. Photographic beats still go to Stable Diffusion, where it is strong.
//
// window.BlvckGraphic
//   render(spec)      -> Blob (PNG)  — spec described below
//   looksLikeGraphic(scene) -> bool  — should this beat be drawn, not generated?
(() => {
  'use strict';

  const W = 1280, H = 720;

  // Deliberately restrained: a channel graphic should read instantly at
  // thumbnail size and never fight the footage around it.
  const THEMES = {
    dark:  { bg: '#0f1116', panel: '#171a21', ink: '#f5f7fa', dim: '#9aa4b2', accent: '#f5b301', rule: '#2a2f3a' },
    light: { bg: '#f7f8fa', panel: '#ffffff', ink: '#12151a', dim: '#5b6472', accent: '#d98c00', rule: '#e2e6ec' }
  };

  // Content-aware palettes. A card for a home-safety video should not look
  // like one for a finance explainer — the accent carries the subject's
  // emotional register, and a single generic amber for everything is what
  // makes a channel's graphics feel templated.
  //
  // Each entry: accent (the hero colour), bg/panel (its own dark ground), and
  // a hot second colour used for emphasis in thumbnails.
  const SUBJECT_PALETTES = [
    { when: /safety|hazard|danger|warn|emergency|risk|fire|accident/i,
      name: 'alert',   accent: '#ff3b30', hot: '#ffcc00', bg: '#140b0b', panel: '#1f1010', rule: '#3a1c1c' },
    { when: /health|medical|body|fitness|doctor|care|wellbeing/i,
      name: 'clinical', accent: '#22c1a4', hot: '#7ef0d8', bg: '#08151a', panel: '#0e1f26', rule: '#173038' },
    { when: /money|finance|invest|cost|price|profit|business|salary/i,
      name: 'money',   accent: '#26d07c', hot: '#c8f560', bg: '#08170f', panel: '#0e2317', rule: '#173a26' },
    { when: /tech|software|ai|computer|digital|engineer|science/i,
      name: 'tech',    accent: '#3da5ff', hot: '#66e0ff', bg: '#0a1018', panel: '#111b28', rule: '#1c2b3d' },
    { when: /history|ancient|war|medieval|empire|archae/i,
      name: 'archive', accent: '#e0952f', hot: '#ffd479', bg: '#15100a', panel: '#211a10', rule: '#352a1a' },
    { when: /crime|mystery|murder|secret|conspiracy|disappear|unsolved/i,
      name: 'noir',    accent: '#e03131', hot: '#ff8787', bg: '#0b0b0f', panel: '#141419', rule: '#26262e' },
    { when: /food|cook|recipe|kitchen|eat|meal|chef/i,
      name: 'kitchen', accent: '#ff8c42', hot: '#ffd166', bg: '#170f09', panel: '#241810', rule: '#3a281a' },
    { when: /home|house|diy|repair|garden|clean|room/i,
      name: 'home',    accent: '#4dabf7', hot: '#ffd43b', bg: '#0b1116', panel: '#131c24', rule: '#1f2c37' }
  ];

  const NEUTRAL = { name: 'neutral', accent: '#f5b301', hot: '#ffe066', bg: '#0f1116', panel: '#171a21', rule: '#2a2f3a' };

  // Derive a palette from whatever the project already knows about itself.
  // Accepts a bible, a plain string, or nothing.
  function paletteFor(source) {
    const hay = typeof source === 'string'
      ? source
      : [source && source.subject, source && source.genre, source && source.title,
         source && source.tone, source && source.audience]
          .filter(Boolean).join(' ');
    if (!hay) return NEUTRAL;
    const hit = SUBJECT_PALETTES.find((p) => p.when.test(hay));
    return hit || NEUTRAL;
  }

  const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

  // --- brand font ---------------------------------------------------------
  //
  // Arial Black is the heaviest face guaranteed to exist everywhere, but the
  // thumbnail look people are after uses a tighter geometric sans. Drop a file
  // at public/fonts/thumbnail.woff2 (or .otf/.ttf) and it is picked up
  // automatically — no config, no rebuild. Everything falls back cleanly if
  // no file is present, so this never breaks a machine that has none.
  const BRAND_FAMILY = 'BlvckDisplay';
  const FONT_CANDIDATES = [
    '/fonts/thumbnail.woff2', '/fonts/thumbnail.woff',
    '/fonts/thumbnail.otf', '/fonts/thumbnail.ttf'
  ];
  let brandFontReady = null;   // Promise<boolean>
  let brandFontLoaded = false;

  function loadBrandFont() {
    if (brandFontReady) return brandFontReady;
    brandFontReady = (async () => {
      if (typeof FontFace === 'undefined' || !document.fonts) return false;
      for (const url of FONT_CANDIDATES) {
        try {
          // HEAD first so a missing file does not surface as a console error.
          const head = await fetch(url, { method: 'HEAD' });
          if (!head.ok) continue;
          const face = new FontFace(BRAND_FAMILY, `url(${url})`, { weight: '400 900' });
          await face.load();
          document.fonts.add(face);
          brandFontLoaded = true;
          console.log(`[Graphic] Brand font loaded from ${url}`);
          return true;
        } catch (e) { /* try the next candidate */ }
      }
      return false;
    })();
    return brandFontReady;
  }

  // The display stack used for headlines and thumbnails.
  function displayFont(px, weight = 900) {
    const stack = brandFontLoaded
      ? `"${BRAND_FAMILY}", "Arial Black", Impact, sans-serif`
      : `"Arial Black", Impact, sans-serif`;
    return `${weight} ${px}px ${stack}`;
  }

  loadBrandFont();

  // A card's look = base theme (light/dark ground) + the subject's own accent.
  function theme(name, palette) {
    const base = THEMES[name] || THEMES.dark;
    if (!palette) return base;
    // On a light card keep the light ground but take the subject's accent, so
    // a bright airy project stays bright without losing its identity colour.
    if ((THEMES[name] || THEMES.dark) === THEMES.light) {
      return { ...base, accent: palette.accent, hot: palette.hot };
    }
    return { ...base, bg: palette.bg, panel: palette.panel, rule: palette.rule,
             accent: palette.accent, hot: palette.hot };
  }

  // Wrap text to a pixel width. Canvas has no layout engine, so lines have to
  // be measured one word at a time.
  function wrap(ctx, text, maxWidth) {
    const words = String(text || '').split(/\s+/).filter(Boolean);
    const lines = [];
    let line = '';
    for (const word of words) {
      const attempt = line ? `${line} ${word}` : word;
      if (ctx.measureText(attempt).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else {
        line = attempt;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function canvasToBlob(canvas) {
    return new Promise((resolve) => canvas.toBlob((b) => resolve(b), 'image/png'));
  }

  // --- layouts -----------------------------------------------------------

  function drawTitle(ctx, t, spec) {
    ctx.fillStyle = t.ink;
    ctx.font = `700 76px ${FONT}`;
    const lines = wrap(ctx, spec.title || '', W - 220).slice(0, 3);
    const blockH = lines.length * 92;
    let y = (H - blockH) / 2 + 60;
    lines.forEach((l) => { ctx.fillText(l, 110, y); y += 92; });

    if (spec.subtitle) {
      ctx.fillStyle = t.dim;
      ctx.font = `400 34px ${FONT}`;
      wrap(ctx, spec.subtitle, W - 220).slice(0, 2)
        .forEach((l, i) => ctx.fillText(l, 110, y + 18 + i * 46));
    }
    ctx.fillStyle = t.accent;
    ctx.fillRect(110, (H - blockH) / 2 - 34, 96, 8);
  }

  function drawChecklist(ctx, t, spec) {
    const items = (spec.items || []).slice(0, 7);

    ctx.fillStyle = t.ink;
    ctx.font = `700 46px ${FONT}`;
    ctx.fillText(spec.title || 'Checklist', 96, 104);
    ctx.fillStyle = t.accent;
    ctx.fillRect(96, 126, 72, 6);

    const top = 176;
    const rowH = Math.min(78, (H - top - 60) / Math.max(1, items.length));
    ctx.font = `400 30px ${FONT}`;

    items.forEach((item, i) => {
      const y = top + i * rowH;
      ctx.fillStyle = t.panel;
      roundRect(ctx, 96, y, W - 192, rowH - 14, 10);
      ctx.fill();

      // tick mark, drawn rather than typed so it never depends on a glyph
      ctx.strokeStyle = t.accent;
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      const cx = 130, cy = y + (rowH - 14) / 2;
      ctx.beginPath();
      ctx.moveTo(cx - 9, cy);
      ctx.lineTo(cx - 2, cy + 8);
      ctx.lineTo(cx + 11, cy - 9);
      ctx.stroke();

      ctx.fillStyle = t.ink;
      const line = wrap(ctx, item, W - 320)[0] || '';
      ctx.fillText(line, 164, cy + 10);
    });
  }

  function drawStat(ctx, t, spec) {
    ctx.fillStyle = t.accent;
    ctx.font = `800 210px ${FONT}`;
    const value = String(spec.value || spec.title || '');
    const vw = ctx.measureText(value).width;
    ctx.fillText(value, (W - vw) / 2, H / 2 + 40);

    if (spec.label) {
      ctx.fillStyle = t.ink;
      ctx.font = `500 40px ${FONT}`;
      const lines = wrap(ctx, spec.label, W - 260).slice(0, 2);
      lines.forEach((l, i) => {
        const lw = ctx.measureText(l).width;
        ctx.fillText(l, (W - lw) / 2, H / 2 + 130 + i * 52);
      });
    }
  }

  // --- public ------------------------------------------------------------

  // spec: { kind: 'title'|'checklist'|'stat', title, subtitle, items[], value,
  //         label, theme: 'dark'|'light' }
  async function render(spec = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const t = theme(spec.theme, spec.palette);

    ctx.fillStyle = t.bg;
    ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';

    const kind = String(spec.kind || 'title').toLowerCase();
    if (kind === 'checklist' || kind === 'list') drawChecklist(ctx, t, spec);
    else if (kind === 'stat' || kind === 'number') drawStat(ctx, t, spec);
    else drawTitle(ctx, t, spec);

    // A hairline keeps the card from floating when cut against footage.
    ctx.strokeStyle = t.rule;
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, W - 2, H - 2);

    return canvasToBlob(canvas);
  }

  // Should this beat be drawn rather than generated? Only says yes when the
  // storyboard has given us something concrete to typeset — a scene merely
  // mentioning a number still belongs in front of a camera.
  function looksLikeGraphic(scene) {
    if (!scene) return false;
    if (scene.graphic && typeof scene.graphic === 'object') return true;
    return String(scene.sceneType || '').toLowerCase() === 'graphic';
  }

  // --- presenter cut-out --------------------------------------------------
  //
  // Generated faces are the weakest part of an SDXL thumbnail: at feed size the
  // eyes and teeth are where the artefacts land, and viewers read "AI" from a
  // face faster than from anything else in the frame. A real photograph of the
  // channel's own presenter beats anything the model can produce, and it also
  // builds the face recognition that actually drives clicks on a channel.
  //
  // Accepts a PNG that already has alpha, or strips a plain background itself.

  const FACE_KEY = 'blvck-tts:presenter-face';

  function saveFace(dataUrl) {
    try { localStorage.setItem(FACE_KEY, dataUrl || ''); } catch { /* quota */ }
  }
  function getFace() {
    try { return localStorage.getItem(FACE_KEY) || null; } catch { return null; }
  }
  function clearFace() {
    try { localStorage.removeItem(FACE_KEY); } catch { /* ignore */ }
  }

  function hasAlpha(data) {
    for (let i = 3; i < data.length; i += 4 * 97) if (data[i] < 250) return true;
    return false;
  }

  // Flood from the edges, clearing pixels close in colour to the border. Handles
  // the common case — a portrait shot against a wall or a plain backdrop. A
  // photo with a busy background should be cut out properly first; this is a
  // convenience, not a matting algorithm, and it says so in the UI.
  function stripBackground(canvas, tolerance = 42) {
    const ctx = canvas.getContext('2d');
    const { width: w, height: h } = canvas;
    const img = ctx.getImageData(0, 0, w, h);
    const d = img.data;
    if (hasAlpha(d)) return canvas; // already cut out — leave it alone

    const at = (x, y) => (y * w + x) * 4;
    const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)];
    const key = corners.map((i) => [d[i], d[i + 1], d[i + 2]]);
    const near = (i) => key.some(([r, g, b]) =>
      Math.abs(d[i] - r) + Math.abs(d[i + 1] - g) + Math.abs(d[i + 2] - b) < tolerance * 3);

    const stack = [];
    const seen = new Uint8Array(w * h);
    for (let x = 0; x < w; x++) { stack.push([x, 0]); stack.push([x, h - 1]); }
    for (let y = 0; y < h; y++) { stack.push([0, y]); stack.push([w - 1, y]); }

    while (stack.length) {
      const [x, y] = stack.pop();
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const p = y * w + x;
      if (seen[p]) continue;
      const i = p * 4;
      if (!near(i)) continue;
      seen[p] = 1;
      d[i + 3] = 0;
      stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }

    // Soften the cut so the edge does not look scissored against the artwork.
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        const p = y * w + x;
        if (seen[p]) continue;
        const i = p * 4;
        let clearNeighbours = 0;
        if (seen[p - 1]) clearNeighbours++;
        if (seen[p + 1]) clearNeighbours++;
        if (seen[p - w]) clearNeighbours++;
        if (seen[p + w]) clearNeighbours++;
        if (clearNeighbours) d[i + 3] = Math.round(255 * (1 - clearNeighbours / 5));
      }
    }

    ctx.putImageData(img, 0, 0);
    return canvas;
  }

  // Prepare an uploaded photo for compositing. Returns a data URL with alpha.
  async function prepareFace(fileOrBlob, { autoCut = true } = {}) {
    const url = URL.createObjectURL(fileOrBlob);
    try {
      const img = new Image();
      await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
      // Cap the long edge: a 12MP phone photo is pointless here and makes the
      // flood fill crawl.
      const scale = Math.min(1, 900 / Math.max(img.naturalWidth, img.naturalHeight));
      const c = document.createElement('canvas');
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      if (autoCut) stripBackground(c);
      return c.toDataURL('image/png');
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  // Draw the presenter into a thumbnail: right-hand side by default, which is
  // where the concept prompts already reserve space, with a dark rim so the
  // subject separates from whatever is behind them.
  function drawFace(ctx, faceImg, { side = 'right', heightPct = 0.92 } = {}) {
    if (!faceImg) return;
    const targetH = H * heightPct;
    const scale = targetH / faceImg.naturalHeight;
    const fw = faceImg.naturalWidth * scale;
    const x = side === 'left' ? W * 0.02 : W - fw - W * 0.02;
    const y = H - targetH;

    ctx.save();
    ctx.shadowColor = 'rgba(0,0,0,0.75)';
    ctx.shadowBlur = 46;
    ctx.shadowOffsetX = side === 'left' ? 18 : -18;
    ctx.shadowOffsetY = 10;
    ctx.drawImage(faceImg, x, y, fw, targetH);
    ctx.restore();
  }

  // --- thumbnails --------------------------------------------------------
  //
  // The look people mean by "MrBeast thumbnail" is mostly four things, none of
  // which the previous renderer did: text large enough to read at 168px wide,
  // a colour grade with real punch, one word emphasised in a hot accent, and
  // separation between subject and background. Text capped at 130px in a
  // 540px column is simply too small — at YouTube's grid size that is
  // unreadable, which is the single biggest CTR mistake.
  //
  // spec: { image, text, palette, emphasis, align: 'left'|'center'|'right',
  //         badge, punch: bool }
  async function renderThumbnail(spec = {}) {
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    const pal = spec.palette || NEUTRAL;

    // 1. Base frame, graded. Saturation and contrast are what make a thumbnail
    //    pop out of a grey feed; an ungraded still always looks flat beside
    //    professionally made neighbours.
    if (spec.image) {
      if (spec.punch !== false) ctx.filter = 'saturate(1.35) contrast(1.18) brightness(1.04)';
      ctx.drawImage(spec.image, 0, 0, W, H);
      ctx.filter = 'none';
    } else {
      ctx.fillStyle = pal.bg;
      ctx.fillRect(0, 0, W, H);
    }

    // 2. Vignette — pulls the eye to the middle and stops the frame dissolving
    //    into whatever thumbnail sits next to it.
    const vig = ctx.createRadialGradient(W / 2, H / 2, H * 0.32, W / 2, H / 2, H * 0.95);
    vig.addColorStop(0, 'rgba(0,0,0,0)');
    vig.addColorStop(1, 'rgba(0,0,0,0.62)');
    ctx.fillStyle = vig;
    ctx.fillRect(0, 0, W, H);

    const align = spec.align || 'left';
    const words = String(spec.text || '').toUpperCase().split(/\s+/).filter(Boolean).slice(0, 5);
    if (!words.length) return canvasToBlob(canvas);

    // 3. Two lines maximum. Three or more words per line shrinks the type
    //    below the point where it survives the grid view.
    const lines = words.length <= 2 ? [words.join(' ')]
      : [words.slice(0, Math.ceil(words.length / 2)).join(' '),
         words.slice(Math.ceil(words.length / 2)).join(' ')];

    // 4. Grow the type to fill the frame rather than capping it small.
    const maxW = W * 0.86;
    const maxLineH = (H * 0.78) / lines.length;
    let size = 250;
    const fontAt = (px) => `900 ${px}px "Arial Black", Impact, ${FONT}`;
    for (;;) {
      ctx.font = fontAt(size);
      const widest = Math.max(...lines.map((l) => ctx.measureText(l).width));
      if ((widest <= maxW && size * 1.06 <= maxLineH) || size <= 64) break;
      size -= 4;
    }

    const lineH = size * 1.02;
    const blockH = lines.length * lineH;
    const baseY = H - blockH - H * 0.10;
    const pad = W * 0.055;

    ctx.textBaseline = 'top';
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;

    lines.forEach((line, i) => {
      ctx.font = fontAt(size);
      const lw = ctx.measureText(line).width;
      const x = align === 'center' ? (W - lw) / 2 : align === 'right' ? W - lw - pad : pad;
      const y = baseY + i * lineH;

      // Emphasis: one word in the hot colour. A single highlighted word is
      // what gives these thumbnails a focal point instead of a wall of caps.
      const emph = String(spec.emphasis || '').toUpperCase();
      const parts = emph && line.includes(emph)
        ? [{ t: line.slice(0, line.indexOf(emph)), hot: false },
           { t: emph, hot: true },
           { t: line.slice(line.indexOf(emph) + emph.length), hot: false }]
        : [{ t: line, hot: false }];

      let cx = x;
      for (const part of parts) {
        if (!part.t) continue;
        const pw = ctx.measureText(part.t).width;

        ctx.shadowColor = 'rgba(0,0,0,0.9)';
        ctx.shadowBlur = size * 0.14;
        ctx.shadowOffsetY = size * 0.055;
        ctx.strokeStyle = '#000';
        ctx.lineWidth = size * 0.155;
        ctx.strokeText(part.t, cx, y);
        ctx.shadowColor = 'transparent';
        ctx.shadowBlur = 0;
        ctx.shadowOffsetY = 0;

        ctx.fillStyle = part.hot ? pal.hot : '#ffffff';
        ctx.fillText(part.t, cx, y);
        cx += pw;
      }
    });

    // 5. Optional corner badge — an episode number or a hook like "50 CHECKS".
    if (spec.badge) {
      const label = String(spec.badge).toUpperCase();
      ctx.font = `900 46px ${FONT}`;
      const bw = ctx.measureText(label).width + 52;
      ctx.fillStyle = pal.accent;
      roundRect(ctx, pad, H * 0.075, bw, 74, 12);
      ctx.fill();
      ctx.fillStyle = '#0b0b0b';
      ctx.fillText(label, pad + 26, H * 0.075 + 14);
    }

    return canvasToBlob(canvas);
  }

  window.BlvckGraphic = {
    render, renderThumbnail, looksLikeGraphic, paletteFor, THEMES, SUBJECT_PALETTES,
    // presenter cut-out
    prepareFace, saveFace, getFace, clearFace, drawFace, stripBackground,
    // typography
    loadBrandFont, displayFont,
    brandFontLoaded: () => brandFontLoaded
  };
})();
