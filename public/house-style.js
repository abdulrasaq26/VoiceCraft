// The house style, and the reference a house can learn one from.
//
// A documentary does not have a look per scene. It has ONE look, and every
// beat is an instance of it — that is most of what separates a film from a
// deck of slides. The component library already refuses to let a model set
// colours or positions; this decides what those colours ARE, once, for the
// whole project.
//
// A style is not only a palette. It carries:
//
//   tokens       what the components paint with
//   pace/ease    how the motion feels — an archival film breathes, a data
//                brief snaps
//   maxElements  HOW MUCH GOES ON SCREEN AT ONCE, which is a house rule, not
//                a preference, and is the one part of a style that actually
//                constrains what the model is allowed to ask for
//   guidance     what the Composer is told about the film it is working on
//
// The last two are why this is a skill system rather than a theme picker: the
// style reaches the model's brief and the parser's gate, not just the CSS.
//
// AND IT CAN BE LEARNED FROM A PICTURE. Given a reference frame — a still from
// the footage, an approved asset, a look the director likes — fromReference()
// reads its palette and derives a style from it, then FORCES the result to be
// legible. A palette lifted straight from a photograph is frequently
// unreadable: mid-grey type on a mid-grey ground is what an honest average of
// most images looks like. Contrast is enforced here, in the derivation, rather
// than being noticed later by the evaluator, because a beat that has already
// been rendered has already cost thirty seconds.
(() => {
  'use strict';

  const LS = 'blvck:visual-style';

  // ── Colour, as arithmetic ────────────────────────────────────────────────

  const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
  const hex = (r, g, b) => '#' + [r, g, b]
    .map((n) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('');

  function rgbOf(colour) {
    const s = String(colour || '').trim();
    const m = s.match(/^#?([0-9a-f]{6})$/i);
    if (m) {
      const n = parseInt(m[1], 16);
      return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
    }
    const p = s.match(/rgba?\(([^)]+)\)/i);
    if (p) {
      const [r, g, b] = p[1].split(',').map((x) => parseFloat(x));
      return { r: r || 0, g: g || 0, b: b || 0 };
    }
    return { r: 0, g: 0, b: 0 };
  }

  /** WCAG relative luminance. */
  function luminance(c) {
    const f = (v) => {
      const x = v / 255;
      return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  }

  /** WCAG contrast ratio, 1 (identical) to 21 (black on white). */
  function contrast(a, b) {
    const la = luminance(rgbOf(a)), lb = luminance(rgbOf(b));
    return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
  }

  function hsl(c) {
    const r = c.r / 255, g = c.g / 255, b = c.b / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min;
    let h = 0;
    if (d) {
      if (max === r) h = ((g - b) / d) % 6;
      else if (max === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60; if (h < 0) h += 360;
    }
    const l = (max + min) / 2;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    return { h, s, l };
  }

  function fromHsl({ h, s, l }) {
    const c = (1 - Math.abs(2 * l - 1)) * s;
    const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
    const m = l - c / 2;
    const t = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x]
            : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
    return { r: (t[0] + m) * 255, g: (t[1] + m) * 255, b: (t[2] + m) * 255 };
  }

  const hexOf = (c) => hex(c.r, c.g, c.b);

  const rgba = (colour, alpha) => {
    const c = rgbOf(colour);
    return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${alpha})`;
  };

  /**
   * Move a colour along its own lightness until it stands off another one.
   *
   * Hue and saturation are kept: the point of deriving from a reference is to
   * keep the reference's colour, so a teal that has to get darker stays teal.
   */
  function separate(colour, against, ratio, prefer) {
    if (contrast(colour, against) >= ratio) return colour;
    const base = hsl(rgbOf(colour));
    const groundLight = luminance(rgbOf(against)) > 0.18;
    const dir = prefer === 'darker' ? -1 : prefer === 'lighter' ? 1 : (groundLight ? -1 : 1);
    let best = colour, bestRatio = contrast(colour, against);
    for (let step = 1; step <= 20; step++) {
      const l = clamp(base.l + dir * step * 0.05, 0.02, 0.98);
      const cand = hexOf(fromHsl({ h: base.h, s: base.s, l }));
      const r = contrast(cand, against);
      if (r > bestRatio) { best = cand; bestRatio = r; }
      if (r >= ratio) return cand;
    }
    // Nothing on this hue reached it: legibility wins over fidelity.
    const fallback = luminance(rgbOf(against)) > 0.18 ? '#12100c' : '#f6f8fa';
    return contrast(fallback, against) > bestRatio ? fallback : best;
  }

  // ── The styles a project can be made in ──────────────────────────────────
  //
  // Each is a way of making documentary, not a colour scheme. The differences
  // that matter are the ones a viewer would name: how much is on screen, how
  // fast it arrives, and whether it looks like paper or like a screen.

  const STYLES = {
    'broadcast-brief': {
      label: 'Broadcast brief',
      description: 'Dark ground, amber accent, one idea at a time. The default.',
      tokens: { bg: '#0b0d12', ink: '#f2f5f8', accent: '#f5b301',
                serif: 'Georgia, "Times New Roman", serif',
                ease: 'power3.out', pace: 1 },
      maxElements: 3,
      prefers: ['title', 'stat', 'progression'],
      guidance: [
        'THE FILM: a broadcast brief. Plain, current, unsentimental. One idea on',
        'screen at a time, stated in the fewest words that still say it.'
      ]
    },

    archival: {
      label: 'Archival',
      description: 'Paper ground, ink type, slow. Built around pictures rather than figures.',
      tokens: { bg: '#efe7d8', ink: '#231c14', accent: '#8c2f1e',
                serif: '"Iowan Old Style", "Palatino Linotype", Georgia, serif',
                ease: 'power1.out', pace: 1.45 },
      maxElements: 2,
      prefers: ['image', 'title', 'timeline'],
      guidance: [
        'THE FILM: archival. It moves slowly and it trusts pictures more than',
        'figures. Prefer a photograph and a line of type over a chart. At most',
        'two things on screen, and let them sit.'
      ]
    },

    'data-brief': {
      label: 'Data brief',
      description: 'Near-black, cyan accent, quick. Figures and stages.',
      tokens: { bg: '#070b10', ink: '#e8f1f8', accent: '#39d0d8',
                serif: '"Helvetica Neue", Helvetica, Arial, sans-serif',
                ease: 'power2.inOut', pace: 0.8 },
      maxElements: 4,
      prefers: ['stat', 'comparison', 'progression'],
      guidance: [
        'THE FILM: a data brief. It is precise and it moves. Reach for the',
        'figure and the sequence — a number the viewer can hold, or the stages',
        'something passes through.'
      ]
    }
  };

  const DEFAULT_STYLE = 'broadcast-brief';

  // ── What is in force ─────────────────────────────────────────────────────

  let state = null;

  function load() {
    if (state) return state;
    try { state = JSON.parse(localStorage.getItem(LS) || 'null') || {}; }
    catch (e) { state = {}; }
    return state;
  }

  function persist() {
    try { localStorage.setItem(LS, JSON.stringify(state || {})); } catch (e) { /* private mode */ }
  }

  /** The style in force: a name, plus anything a reference or a project overrode. */
  function current(project) {
    const s = load();
    const name = (project && project.visualStyle) || s.style || DEFAULT_STYLE;
    const base = STYLES[name] || STYLES[DEFAULT_STYLE];
    return {
      name: STYLES[name] ? name : DEFAULT_STYLE,
      label: base.label,
      description: base.description,
      maxElements: base.maxElements,
      prefers: base.prefers,
      guidance: base.guidance,
      // Order matters: the style is the ground, a learned reference sits on
      // top of it, and an explicit project override beats both.
      tokens: Object.assign({}, base.tokens, s.tokens || {},
                            (project && project.visualLanguage) || {}),
      reference: s.reference || null
    };
  }

  function set(name) {
    if (!STYLES[name]) throw new Error(`there is no style called "${name}"`);
    load(); state.style = name;
    // A style change drops a palette learned under the previous one: they were
    // derived together and half of each is not a look.
    if (state.reference) { delete state.tokens; delete state.reference; }
    persist();
    return current();
  }

  function clearReference() {
    load(); delete state.tokens; delete state.reference; persist();
  }

  function styles() {
    return Object.keys(STYLES).map((k) =>
      ({ name: k, label: STYLES[k].label, description: STYLES[k].description }));
  }

  // ── Learning a style from a picture ──────────────────────────────────────

  /** Load anything image-shaped into something drawable. */
  async function imageOf(src) {
    if (src && src.width && src.height && (src.tagName === 'IMG' || src.tagName === 'CANVAS')) return src;
    const url = (src instanceof Blob) ? URL.createObjectURL(src) : String(src);
    try {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      const ok = await new Promise((res) => {
        img.onload = () => res(true); img.onerror = () => res(false);
        img.src = url;
        setTimeout(() => res(!!img.naturalWidth), 15000);
      });
      if (!ok || !img.naturalWidth) throw new Error('the reference could not be read as an image');
      return img;
    } finally {
      if (src instanceof Blob) setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
  }

  /**
   * The colours a picture is actually made of.
   *
   * Quantised to 32 levels per channel and counted, rather than averaged: the
   * mean of a photograph is mud, and mud is exactly the palette that would then
   * have to be thrown away for being illegible.
   */
  async function paletteOf(src, { size = 72, take = 8 } = {}) {
    const img = await imageOf(src);
    const c = document.createElement('canvas');
    c.width = size; c.height = size;
    const g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(img, 0, 0, size, size);
    const data = g.getImageData(0, 0, size, size).data;

    const buckets = new Map();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;                     // transparent
      const key = ((data[i] >> 3) << 10) | ((data[i + 1] >> 3) << 5) | (data[i + 2] >> 3);
      const b = buckets.get(key) || { r: 0, g: 0, b: 0, n: 0 };
      b.r += data[i]; b.g += data[i + 1]; b.b += data[i + 2]; b.n++;
      buckets.set(key, b);
    }
    const total = [...buckets.values()].reduce((a, b) => a + b.n, 0) || 1;
    const colours = [...buckets.values()]
      .sort((a, b) => b.n - a.n)
      .slice(0, take)
      .map((b) => {
        const rgb = { r: b.r / b.n, g: b.g / b.n, b: b.b / b.n };
        const h = hsl(rgb);
        return { hex: hex(rgb.r, rgb.g, rgb.b), weight: Math.round((b.n / total) * 100) / 100,
                 hue: Math.round(h.h), sat: Math.round(h.s * 100) / 100,
                 light: Math.round(h.l * 100) / 100 };
      });
    return { colours, dominant: colours[0] || null };
  }

  /**
   * Derive a style from a reference frame.
   *
   * The ground keeps the reference's hue. The type is whichever pole — near
   * black or near white — the ground is furthest from, then pushed until it
   * clears 4.5:1. The accent is the most saturated colour in the picture that
   * is not the ground, pushed until it clears 3:1. If the picture has no
   * saturated colour at all, the style's own accent is kept rather than
   * inventing one, because a grey photograph is not a statement about accents.
   */
  async function fromReference(src, { name = 'reference', apply = true, base } = {}) {
    const palette = await paletteOf(src);
    if (!palette.dominant) throw new Error('the reference had no readable pixels');

    const style = current();
    const start = Object.assign({}, style.tokens, base || {});
    const dom = palette.dominant;

    // The ground: the reference's own dominant colour, calmed. A ground at
    // full saturation eats every piece of type placed on it.
    const domHsl = hsl(rgbOf(dom.hex));
    const bg = hexOf(fromHsl({
      h: domHsl.h,
      s: clamp(domHsl.s * 0.55, 0, 0.42),
      l: domHsl.l > 0.5 ? clamp(domHsl.l, 0.82, 0.94) : clamp(domHsl.l, 0.05, 0.16)
    }));

    const pole = luminance(rgbOf(bg)) > 0.18 ? '#1a1512' : '#f4f7fa';
    const ink = separate(pole, bg, 4.5);

    // The accent is the colour that is NOT the ground. Ranking by saturation
    // alone gave a teal accent on a teal ground — measured, on a frame whose
    // only other colour was a small warm lamp: the wall filled the picture and
    // outscored it, and the result was a monochrome scheme with an accent in
    // name only. Distance round the wheel is what makes an accent one, so it
    // dominates the ranking and weight is only a tiebreak.
    const groundHue = hsl(rgbOf(bg)).h;
    const away = (h) => { const d = Math.abs(h - groundHue) % 360; return d > 180 ? 360 - d : d; };
    const candidate = palette.colours
      .filter((c) => c.sat >= 0.22)
      .map((c) => ({ c, score: c.sat * (0.35 + away(c.hue) / 180) * (0.85 + c.weight * 0.15) }))
      .sort((a, b) => b.score - a.score)[0];
    // Whatever it ends up being — found or inherited — it has to stand off the
    // ground it is going to sit on. A style's own accent was chosen against
    // that style's ground, and a reference has just replaced the ground.
    const accent = separate(candidate ? candidate.c.hex : start.accent, bg, 3);

    const tokens = Object.assign({}, start, {
      bg, ink, accent,
      dim: rgba(ink, 0.62),
      rule: rgba(ink, 0.18)
    });

    const result = {
      tokens, palette: palette.colours,
      contrast: {
        ink: Math.round(contrast(ink, bg) * 10) / 10,
        accent: Math.round(contrast(accent, bg) * 10) / 10
      },
      reference: { name, at: Date.now(), dominant: dom.hex,
                   colours: palette.colours.map((c) => c.hex) }
    };

    if (apply) {
      load();
      state.tokens = tokens;
      state.reference = result.reference;
      persist();
    }
    return result;
  }

  /** What the Composer is told about the film it is working on. */
  function guidanceFor(project) {
    const s = current(project);
    const NL = String.fromCharCode(10);
    return s.guidance.concat([
      'It favours these components: ' + s.prefers.join(', ') + '.',
      'At most ' + s.maxElements + ' components — this is the house rule for this'
      + ' film and asking for more only means some are refused.'
    ]).join(NL);
  }

  window.BlvckHouseStyle = {
    current, set, styles, clearReference, guidanceFor,
    fromReference, paletteOf,
    contrast, luminance, separate, rgba,
    STYLES, DEFAULT_STYLE
  };
})();
