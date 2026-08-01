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

  const FONT = '"Segoe UI", "Helvetica Neue", Arial, sans-serif';

  function theme(name) {
    return THEMES[name] || THEMES.dark;
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
    const t = theme(spec.theme);

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

  window.BlvckGraphic = { render, looksLikeGraphic, THEMES };
})();
