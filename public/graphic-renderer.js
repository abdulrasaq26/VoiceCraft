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

  // --- data beats ----------------------------------------------------------

  // Accepts either ["2019: 40", "2020: 65"] or [{label, value}]. The string form
  // is what a language model reliably produces, so it has to be first-class.
  function parseSeries(items) {
    return (Array.isArray(items) ? items : [])
      .map((it) => {
        if (it && typeof it === 'object') {
          return { label: String(it.label || ''), value: Number(it.value) };
        }
        const s = String(it || '');
        const m = s.match(/^(.*?)[:–-]\s*([-+]?[\d.,]+)\s*(.*)$/);
        if (!m) return { label: s, value: NaN };
        return {
          label: m[1].trim(),
          value: Number(String(m[2]).replace(/,/g, '')),
          suffix: (m[3] || '').trim()
        };
      })
      .filter((d) => d.label || Number.isFinite(d.value));
  }

  // Shared header for the data cards. A kicker, a tight headline and a rule —
  // the same furniture every time, which is what makes a set of cards read as
  // one channel's graphics rather than four unrelated slides.
  function cardChrome(ctx, t, { kicker, title, subtitle }) {
    let y = 96;

    if (kicker) {
      ctx.fillStyle = t.accent;
      ctx.font = `800 22px ${FONT}`;
      const label = String(kicker).toUpperCase();
      // Letter-spaced by hand; canvas has no tracking control.
      let x = 100;
      for (const ch of label) {
        ctx.fillText(ch, x, y);
        x += ctx.measureText(ch).width + 3.5;
      }
      y += 44;
    }

    if (title) {
      ctx.fillStyle = t.ink;
      ctx.font = `800 54px ${FONT}`;
      const lines = wrap(ctx, title, W - 200).slice(0, 2);
      lines.forEach((l, i) => ctx.fillText(l, 100, y + i * 60));
      y += lines.length * 60;
    }

    if (subtitle) {
      ctx.fillStyle = t.dim;
      ctx.font = `500 28px ${FONT}`;
      ctx.fillText(wrap(ctx, subtitle, W - 200)[0] || '', 100, y + 20);
      y += 44;
    }

    // Accent rule under the header, short and left-aligned.
    ctx.fillStyle = t.accent;
    ctx.fillRect(100, y + 14, 88, 5);

    return y + 52;
  }

  function headline(ctx, t, text, y) {
    if (!text) return y;
    ctx.fillStyle = t.ink;
    ctx.font = `800 56px ${FONT}`;
    const lines = wrap(ctx, text, W - 200).slice(0, 2);
    lines.forEach((l, i) => ctx.fillText(l, 100, y + i * 64));
    return y + lines.length * 64;
  }

  // Bar chart. Deliberately plain: a documentary chart's job is to make one
  // comparison obvious in two seconds, not to be a dashboard.
  function drawChart(ctx, t, spec) {
    const data = parseSeries(spec.items).filter((d) => Number.isFinite(d.value));
    const top0 = cardChrome(ctx, t, { kicker: 'By the numbers', title: spec.title, subtitle: spec.subtitle });
    let y = top0;
    if (!data.length) {
      // Never draw an apology. A card explaining its own emptiness is worse
      // than no card: it ships to the viewer as content. Refusing here forces
      // the caller to route the beat somewhere that can actually show it.
      throw new Error('chart needs numeric items like "2021: 61"');
    }

    const top = y + 20;
    const bottom = H - 130;
    const plotH = bottom - top;
    const max = Math.max(...data.map((d) => d.value));
    const min = Math.min(0, ...data.map((d) => d.value));
    const span = (max - min) || 1;
    const n = data.length;
    const gap = 28;
    const barW = Math.min(150, (W - 200 - gap * (n - 1)) / n);
    const totalW = barW * n + gap * (n - 1);
    const x0 = (W - totalW) / 2;

    // Baseline
    ctx.strokeStyle = t.rule;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(100, bottom);
    ctx.lineTo(W - 100, bottom);
    ctx.stroke();

    data.forEach((d, i) => {
      const h = Math.max(4, ((d.value - min) / span) * (plotH - 40));
      const x = x0 + i * (barW + gap);
      const yTop = bottom - h;
      // The last bar is the payoff in most comparisons; give it the accent and
      // mute the rest so the eye lands in the right place.
      ctx.fillStyle = i === n - 1 ? t.accent : t.rule;
      roundRect(ctx, x, yTop, barW, h, 8);
      ctx.fill();

      ctx.fillStyle = t.ink;
      ctx.font = `800 34px ${FONT}`;
      const v = String(d.value) + (d.suffix ? d.suffix : '');
      const vw = ctx.measureText(v).width;
      ctx.fillText(v, x + (barW - vw) / 2, yTop - 16);

      ctx.fillStyle = t.dim;
      ctx.font = `500 28px ${FONT}`;
      const lw = ctx.measureText(d.label).width;
      ctx.fillText(d.label, x + (barW - lw) / 2, bottom + 44);
    });
  }

  // Timeline. Items are "1914: War begins" style; the date is the left column.
  function drawTimeline(ctx, t, spec) {
    const rows = parseSeries(spec.items).length
      ? (Array.isArray(spec.items) ? spec.items : [])
      : [];
    const items = rows
      .map((it) => {
        const s = String(it || '');
        const m = s.match(/^(.*?)[:–-]\s*(.*)$/);
        return m ? { when: m[1].trim(), what: m[2].trim() } : { when: '', what: s };
      })
      .slice(0, 6);

    const top = cardChrome(ctx, t, { kicker: 'Timeline', title: spec.title, subtitle: spec.subtitle });
    if (!items.length) return;
    const step = Math.min(110, (H - top - 90) / items.length);
    const railX = 300;

    ctx.strokeStyle = t.rule;
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(railX, top - 20);
    ctx.lineTo(railX, top + step * (items.length - 1) + 30);
    ctx.stroke();

    items.forEach((d, i) => {
      const y = top + i * step;
      ctx.fillStyle = t.accent;
      ctx.beginPath();
      ctx.arc(railX, y, 13, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = t.accent;
      ctx.font = `800 38px ${FONT}`;
      const ww = ctx.measureText(d.when).width;
      ctx.fillText(d.when, railX - 46 - ww, y + 13);

      ctx.fillStyle = t.ink;
      ctx.font = `500 36px ${FONT}`;
      ctx.fillText(wrap(ctx, d.what, W - railX - 160)[0] || '', railX + 46, y + 13);
    });
  }

  // Whiteboard: light ground, marker-weight strokes, numbered steps with
  // connectors. Reads as "someone is explaining this", which is the point.
  function drawWhiteboard(ctx, t, spec) {
    ctx.fillStyle = '#f4f2ec';
    ctx.fillRect(0, 0, W, H);

    const ink = '#1d2026';
    const marker = t.accent;

    ctx.fillStyle = ink;
    ctx.font = `800 58px ${FONT}`;
    const title = wrap(ctx, String(spec.title || ''), W - 200).slice(0, 1);
    title.forEach((l) => ctx.fillText(l, 100, 130));

    // Hand-drawn underline: a slight wobble reads as a marker rather than a
    // vector rule.
    if (title.length) {
      ctx.strokeStyle = marker;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      const uw = ctx.measureText(title[0]).width;
      for (let x = 0; x <= uw; x += 12) {
        const y = 152 + Math.sin(x / 26) * 2.5;
        if (x === 0) ctx.moveTo(100 + x, y);
        else ctx.lineTo(100 + x, y);
      }
      ctx.stroke();
    }

    const steps = (Array.isArray(spec.items) ? spec.items : []).map(String).filter(Boolean).slice(0, 5);
    const top = 240;
    const step = Math.min(105, (H - top - 90) / Math.max(steps.length, 1));

    steps.forEach((s, i) => {
      const y = top + i * step;
      ctx.strokeStyle = marker;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.arc(150, y, 30, 0, Math.PI * 2);
      ctx.stroke();

      ctx.fillStyle = marker;
      ctx.font = `800 34px ${FONT}`;
      const num = String(i + 1);
      ctx.fillText(num, 150 - ctx.measureText(num).width / 2, y + 12);

      ctx.fillStyle = ink;
      ctx.font = `600 38px ${FONT}`;
      ctx.fillText(wrap(ctx, s, W - 380)[0] || '', 216, y + 13);

      // Connector arrow down to the next step.
      if (i < steps.length - 1) {
        ctx.strokeStyle = '#b9b4a8';
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(150, y + 34);
        ctx.lineTo(150, y + step - 34);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(142, y + step - 44);
        ctx.lineTo(150, y + step - 32);
        ctx.lineTo(158, y + step - 44);
        ctx.stroke();
      }
    });
  }

  // Real cartography, drawn from Natural Earth boundaries.
  //
  // Highlights the countries named in the beat, frames the view on them, and
  // draws their neighbours in a muted tone so the region reads in context.
  // Falls back to the name-list card below when the geodata is unavailable or
  // no country in the text can be matched with confidence — a wrong map is
  // worse than an honest list.
  function drawGeoMap(ctx, t, spec, countries) {
    const G = window.BlvckGeo;
    const view = G.padded(G.bounds(countries), 0.55);
    const project = G.projector(view, W, H, 90);

    // theme() returns the palette without a name, so read the lightness off the
    // ground colour rather than trusting a key that is never set.
    const light = (() => {
      const m = /^#?([0-9a-f]{6})$/i.exec(String(t.bg || ''));
      if (!m) return false;
      const v = parseInt(m[1], 16);
      return (((v >> 16) & 255) * 0.299 + ((v >> 8) & 255) * 0.587 + (v & 255) * 0.114) > 140;
    })();

    // Ocean
    ctx.fillStyle = light ? '#dfe7f0' : '#0b1622';
    ctx.fillRect(0, 0, W, H);

    const focus = new Set(countries);

    // Context landmass first, then the subjects on top.
    ctx.lineJoin = 'round';
    const others = G.features().filter((f) => !focus.has(f));
    others.forEach((f) => {
      G.drawFeature(ctx, f, project);
      ctx.fillStyle = light ? "#c9d3df" : "#1b2430";
      ctx.fill();
      ctx.strokeStyle = light ? "#b3c0cf" : "#243040";
      ctx.lineWidth = 1;
      ctx.stroke();
    });

    countries.forEach((f) => {
      G.drawFeature(ctx, f, project);
      ctx.fillStyle = t.accent;
      ctx.fill();
      ctx.strokeStyle = t.ink;
      ctx.lineWidth = 2.5;
      ctx.stroke();
    });

    // Labels, placed on the largest landmass of each highlighted country.
    countries.forEach((f) => {
      const c = G.labelPoint(f);
      if (!c) return;
      const [x, y] = project(c[0], c[1]);
      if (x < 0 || x > W || y < 0 || y > H) return;
      const label = (f.p && (f.p.n || f.p.a)) || '';
      if (!label) return;
      ctx.font = `800 34px ${FONT}`;
      const tw = ctx.measureText(label).width;
      // Plate behind the text so a label over a bright country stays readable.
      ctx.fillStyle = 'rgba(0,0,0,.62)';
      roundRect(ctx, x - tw / 2 - 14, y - 26, tw + 28, 48, 10);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(label, x - tw / 2, y + 9);
    });

    if (spec.title) {
      ctx.fillStyle = 'rgba(0,0,0,.55)';
      ctx.fillRect(0, 0, W, 108);
      ctx.fillStyle = '#fff';
      ctx.font = `800 52px ${FONT}`;
      ctx.fillText(wrap(ctx, String(spec.title), W - 160)[0] || '', 80, 70);
    }
  }

  // Decide between real cartography and the honest fallback.
  //
  // Real geography only when a country can be matched with confidence. A map
  // that highlights the wrong place, or an empty ocean, is worse than a plain
  // list of the places named — the viewer trusts a map far more than a list,
  // so it has to earn that trust.
  async function renderMap(ctx, t, spec) {
    const G = window.BlvckGeo;
    if (G) {
      try {
        await G.load();
        const text = [spec.title, spec.subtitle]
          .concat(Array.isArray(spec.items) ? spec.items : [])
          .filter(Boolean)
          .join(' ');
        // Prefer whole-text detection; fall back to treating each list item as
        // a place name on its own.
        let hits = G.detectCountries(text);
        if (!hits.length && Array.isArray(spec.items)) {
          hits = spec.items.map((i) => G.findCountry(i)).filter(Boolean);
        }
        if (hits.length) {
          drawGeoMap(ctx, t, spec, hits);
          return;
        }
      } catch (err) {
        console.warn('[Graphic] Geodata unavailable, using locator card:', err.message);
      }
    }
    drawMap(ctx, t, spec);
  }

  // Fallback locator card: places listed with pins, used only when real
  // geography is not available.
  function drawMap(ctx, t, spec) {
    const places = (Array.isArray(spec.items) ? spec.items : []).map(String).filter(Boolean).slice(0, 5);

    // A faint graticule. Not cartography — real maps need real geodata, and an
    // invented coastline is confidently wrong on screen — but a measured grid
    // reads as "place" and stops the card looking like a bulleted list.
    ctx.save();
    ctx.strokeStyle = t.rule;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.55;
    for (let x = 100; x < W - 60; x += 64) {
      ctx.beginPath();
      ctx.moveTo(x, 60);
      ctx.lineTo(x, H - 60);
      ctx.stroke();
    }
    for (let y = 60; y < H - 40; y += 64) {
      ctx.beginPath();
      ctx.moveTo(60, y);
      ctx.lineTo(W - 60, y);
      ctx.stroke();
    }
    ctx.restore();

    const top = cardChrome(ctx, t, {
      kicker: places.length > 1 ? 'Route' : 'Location',
      title: spec.title || 'Locations',
      subtitle: spec.subtitle
    });

    const railX = 148;
    const avail = H - top - 70;
    const step = Math.min(92, avail / Math.max(places.length, 1));

    // Connecting path drawn first, so the markers sit on top of it.
    if (places.length > 1) {
      ctx.save();
      ctx.strokeStyle = t.accent;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 4;
      ctx.setLineDash([9, 9]);
      ctx.beginPath();
      ctx.moveTo(railX, top + 18);
      ctx.lineTo(railX, top + (places.length - 1) * step + 18);
      ctx.stroke();
      ctx.restore();
    }

    places.forEach((p, i) => {
      const y = top + i * step + 18;

      // Numbered marker: a filled disc with the stop number, which carries
      // order in a way an identical pin repeated five times cannot.
      ctx.fillStyle = t.accent;
      ctx.beginPath();
      ctx.arc(railX, y, 19, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = t.bg;
      ctx.font = `800 22px ${FONT}`;
      const n = String(i + 1);
      ctx.fillText(n, railX - ctx.measureText(n).width / 2, y + 8);

      ctx.fillStyle = t.ink;
      ctx.font = `600 38px ${FONT}`;
      ctx.fillText(wrap(ctx, p, W - railX - 160)[0] || '', railX + 46, y + 13);
    });
  }

  // --- public ------------------------------------------------------------

  // spec: { kind: 'title'|'checklist'|'stat'|'chart'|'timeline'|'whiteboard'|'map',
  //         title, subtitle, items[], value, label, theme: 'dark'|'light' }
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

    // A data card with no data is not a card. Fail loudly so the caller can
    // send the beat to the camera instead of storing a near-empty frame that
    // will sit in the finished video.
    const DATA_KINDS = ['chart', 'graph', 'bar', 'timeline', 'map', 'whiteboard', 'checklist', 'list'];
    if (DATA_KINDS.indexOf(kind) > -1) {
      const items = Array.isArray(spec.items) ? spec.items.filter(Boolean) : [];
      if (!items.length) {
        throw new Error(
          `a "${kind}" card needs items — the Director must supply the actual content to typeset`
        );
      }
    }
    if (kind === 'checklist' || kind === 'list') drawChecklist(ctx, t, spec);
    else if (kind === 'stat' || kind === 'number') drawStat(ctx, t, spec);
    else if (kind === 'chart' || kind === 'graph' || kind === 'bar') drawChart(ctx, t, spec);
    else if (kind === 'timeline') drawTimeline(ctx, t, spec);
    else if (kind === 'whiteboard') drawWhiteboard(ctx, t, spec);
    else if (kind === 'map') await renderMap(ctx, t, spec);
    else drawTitle(ctx, t, spec);

    // A hairline keeps the card from floating when cut against footage. The
    // whiteboard draws its own light ground, so a dark rule would frame it
    // wrongly.
    ctx.strokeStyle = kind === 'whiteboard' ? '#d9d4c8' : t.rule;
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
