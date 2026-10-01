/**
 * Caption style library.
 *
 * Every preset is a complete, data-only description of how captions look.
 * The renderer (caption-renderer.js) draws from these definitions alone, for
 * both the editor preview and the exported video, so a style can't look one
 * way in preview and another in the file.
 *
 * Sizes are fractions of the frame height and spacing is in `em` (fractions
 * of the font size), so a style looks identical at 1080p preview and a 720p
 * export.
 */

// Font stacks. Everything here is either bundled (CaptionFont) or ships with
// Windows/macOS, so preview and export resolve the same face offline.
export const CAPTION_FONTS = [
  { id: 'caption', label: 'VoiceCraft Sans', css: '"CaptionFont", "Segoe UI", system-ui, sans-serif' },
  { id: 'segoe', label: 'Segoe UI', css: '"Segoe UI", "Helvetica Neue", Arial, sans-serif' },
  { id: 'arial', label: 'Arial', css: 'Arial, "Helvetica Neue", Helvetica, sans-serif' },
  { id: 'impact', label: 'Impact', css: 'Impact, "Arial Black", "Haettenschweiler", sans-serif' },
  { id: 'arialblack', label: 'Arial Black', css: '"Arial Black", "Segoe UI Black", Arial, sans-serif' },
  { id: 'georgia', label: 'Georgia', css: 'Georgia, "Times New Roman", serif' },
  { id: 'times', label: 'Times New Roman', css: '"Times New Roman", Times, serif' },
  { id: 'trebuchet', label: 'Trebuchet MS', css: '"Trebuchet MS", "Segoe UI", sans-serif' },
  { id: 'verdana', label: 'Verdana', css: 'Verdana, Geneva, sans-serif' },
  { id: 'mono', label: 'Consolas (mono)', css: 'Consolas, "Cascadia Mono", "Courier New", monospace' },
];

export function fontCss(fontId) {
  const f = CAPTION_FONTS.find((x) => x.id === fontId);
  return (f || CAPTION_FONTS[0]).css;
}

/*
 * Preset fields
 *   font        CAPTION_FONTS id
 *   size        font size as a fraction of frame height
 *   weight      CSS font weight
 *   uppercase   render in capitals
 *   letterSpacing  em
 *   lineHeight  line pitch as a multiple of the font size
 *   color       base text colour
 *   activeColor colour used by word-level animations for the spoken word
 *   dimColor    colour for not-yet-spoken words (karaoke / word fade)
 *   stroke      { color, width(em) } or null
 *   shadow      { color, blur(em), x(em), y(em) } or null
 *   background  { mode: none|line|block|bar|word, color, opacity, radius(em), padX(em), padY(em), accent? }
 *   position    bottom | center | top
 *   offset      distance from that edge as a fraction of frame height
 *   align       left | center | right
 *   maxWordsPerLine, maxLines
 *   animation   the animation this style is designed around (used as the
 *               suggestion when picking it; the user can choose any)
 */
export const CAPTION_STYLES = {
  minimal: {
    id: 'minimal', name: 'Minimal', blurb: 'Light, small, unobtrusive',
    font: 'segoe', size: 0.042, weight: 400, uppercase: false, letterSpacing: 0.01, lineHeight: 1.22,
    color: '#ffffff', activeColor: '#ffffff', dimColor: 'rgba(255,255,255,0.45)',
    stroke: null, shadow: { color: 'rgba(0,0,0,0.85)', blur: 0.18, x: 0, y: 0.04 },
    background: { mode: 'none' },
    position: 'bottom', offset: 0.06, align: 'center', maxWordsPerLine: 9, maxLines: 2,
    animation: 'fade-in',
  },
  clean: {
    id: 'clean', name: 'Clean', blurb: 'White with a crisp outline',
    font: 'caption', size: 0.052, weight: 700, uppercase: false, letterSpacing: 0, lineHeight: 1.16,
    color: '#ffffff', activeColor: '#ffffff', dimColor: 'rgba(255,255,255,0.45)',
    stroke: { color: '#000000', width: 0.14 }, shadow: null,
    background: { mode: 'none' },
    position: 'bottom', offset: 0.07, align: 'center', maxWordsPerLine: 8, maxLines: 2,
    animation: 'none',
  },
  documentary: {
    id: 'documentary', name: 'Documentary', blurb: 'Soft shadow, warm highlight',
    font: 'georgia', size: 0.05, weight: 600, uppercase: false, letterSpacing: 0.005, lineHeight: 1.2,
    color: '#f5f1e8', activeColor: '#ffd36b', dimColor: 'rgba(245,241,232,0.5)',
    stroke: { color: 'rgba(0,0,0,0.55)', width: 0.06 }, shadow: { color: 'rgba(0,0,0,0.9)', blur: 0.3, x: 0, y: 0.05 },
    background: { mode: 'none' },
    position: 'bottom', offset: 0.08, align: 'center', maxWordsPerLine: 8, maxLines: 2,
    animation: 'active-color',
  },
  cinematic: {
    id: 'cinematic', name: 'Cinematic', blurb: 'Wide-spaced serif capitals',
    font: 'times', size: 0.04, weight: 400, uppercase: true, letterSpacing: 0.18, lineHeight: 1.4,
    color: '#f4ecdf', activeColor: '#ffffff', dimColor: 'rgba(244,236,223,0.4)',
    stroke: null, shadow: { color: 'rgba(0,0,0,0.95)', blur: 0.35, x: 0, y: 0.02 },
    background: { mode: 'none' },
    position: 'bottom', offset: 0.1, align: 'center', maxWordsPerLine: 7, maxLines: 2,
    animation: 'fade-in',
  },
  bold: {
    id: 'bold', name: 'Bold', blurb: 'Heavy caps, thick outline',
    font: 'impact', size: 0.075, weight: 400, uppercase: true, letterSpacing: 0.02, lineHeight: 1.05,
    color: '#ffffff', activeColor: '#ffe14d', dimColor: 'rgba(255,255,255,0.5)',
    stroke: { color: '#000000', width: 0.2 }, shadow: { color: 'rgba(0,0,0,0.6)', blur: 0, x: 0.06, y: 0.08 },
    background: { mode: 'none' },
    position: 'bottom', offset: 0.12, align: 'center', maxWordsPerLine: 4, maxLines: 2,
    animation: 'word-pop',
  },
  social: {
    id: 'social', name: 'Social Media', blurb: 'Centered, punchy, green pop',
    font: 'arialblack', size: 0.068, weight: 900, uppercase: true, letterSpacing: 0.01, lineHeight: 1.1,
    color: '#ffffff', activeColor: '#3cff7a', dimColor: 'rgba(255,255,255,0.5)',
    stroke: { color: '#000000', width: 0.18 }, shadow: { color: 'rgba(0,0,0,0.7)', blur: 0.1, x: 0, y: 0.07 },
    background: { mode: 'none' },
    position: 'center', offset: 0.0, align: 'center', maxWordsPerLine: 3, maxLines: 2,
    animation: 'word-scale',
  },
  highlight: {
    id: 'highlight', name: 'Highlight', blurb: 'Coloured box behind the spoken word',
    font: 'arial', size: 0.056, weight: 800, uppercase: false, letterSpacing: 0, lineHeight: 1.3,
    color: '#ffffff', activeColor: '#7c5cff', dimColor: 'rgba(255,255,255,0.55)',
    stroke: { color: '#000000', width: 0.1 }, shadow: null,
    background: { mode: 'none' },
    position: 'bottom', offset: 0.1, align: 'center', maxWordsPerLine: 6, maxLines: 2,
    animation: 'word-highlight',
  },
  typewriter: {
    id: 'typewriter', name: 'Typewriter', blurb: 'Monospace on a dark strip',
    font: 'mono', size: 0.044, weight: 600, uppercase: false, letterSpacing: 0.02, lineHeight: 1.35,
    color: '#e8ffe8', activeColor: '#e8ffe8', dimColor: 'rgba(232,255,232,0.35)',
    stroke: null, shadow: null,
    background: { mode: 'block', color: '#0a0a0a', opacity: 0.78, radius: 0.12, padX: 0.5, padY: 0.28 },
    position: 'bottom', offset: 0.08, align: 'left', maxWordsPerLine: 9, maxLines: 2,
    animation: 'typewriter',
  },
  modern: {
    id: 'modern', name: 'Modern', blurb: 'Frosted pill, clean sans',
    font: 'segoe', size: 0.048, weight: 600, uppercase: false, letterSpacing: 0, lineHeight: 1.25,
    color: '#ffffff', activeColor: '#9ecbff', dimColor: 'rgba(255,255,255,0.5)',
    stroke: null, shadow: null,
    background: { mode: 'block', color: '#1a1b2e', opacity: 0.72, radius: 0.6, padX: 0.7, padY: 0.32 },
    position: 'bottom', offset: 0.08, align: 'center', maxWordsPerLine: 8, maxLines: 2,
    animation: 'slide-up',
  },
  boxed: {
    id: 'boxed', name: 'Boxed', blurb: 'Solid box behind each line',
    font: 'caption', size: 0.05, weight: 700, uppercase: false, letterSpacing: 0, lineHeight: 1.5,
    color: '#ffffff', activeColor: '#ffd400', dimColor: 'rgba(255,255,255,0.5)',
    stroke: null, shadow: null,
    background: { mode: 'line', color: '#000000', opacity: 0.66, radius: 0.08, padX: 0.38, padY: 0.12 },
    position: 'bottom', offset: 0.07, align: 'center', maxWordsPerLine: 8, maxLines: 2,
    animation: 'none',
  },
  lowerthird: {
    id: 'lowerthird', name: 'Lower Third', blurb: 'Left-aligned bar with accent',
    font: 'segoe', size: 0.042, weight: 600, uppercase: false, letterSpacing: 0.01, lineHeight: 1.3,
    color: '#ffffff', activeColor: '#ffb84d', dimColor: 'rgba(255,255,255,0.5)',
    stroke: null, shadow: null,
    background: { mode: 'bar', color: '#101218', opacity: 0.85, radius: 0.05, padX: 0.8, padY: 0.45, accent: '#6366f1' },
    position: 'bottom', offset: 0.1, align: 'left', maxWordsPerLine: 9, maxLines: 2,
    animation: 'slide-right',
  },
  large: {
    id: 'large', name: 'Large Centered', blurb: 'Big statement in mid-frame',
    font: 'arialblack', size: 0.09, weight: 900, uppercase: false, letterSpacing: -0.01, lineHeight: 1.05,
    color: '#ffffff', activeColor: '#ffffff', dimColor: 'rgba(255,255,255,0.45)',
    stroke: { color: '#000000', width: 0.12 }, shadow: { color: 'rgba(0,0,0,0.75)', blur: 0.25, x: 0, y: 0.06 },
    background: { mode: 'none' },
    position: 'center', offset: 0, align: 'center', maxWordsPerLine: 4, maxLines: 3,
    animation: 'scale-in',
  },
  karaoke: {
    id: 'karaoke', name: 'Karaoke', blurb: 'Words fill with colour as spoken',
    font: 'arial', size: 0.058, weight: 900, uppercase: false, letterSpacing: 0, lineHeight: 1.2,
    color: '#ffffff', activeColor: '#29d3ff', dimColor: 'rgba(255,255,255,0.95)',
    stroke: { color: '#08131f', width: 0.16 }, shadow: { color: 'rgba(0,0,0,0.6)', blur: 0.12, x: 0, y: 0.05 },
    background: { mode: 'none' },
    position: 'bottom', offset: 0.1, align: 'center', maxWordsPerLine: 6, maxLines: 2,
    animation: 'karaoke',
  },
  yellow: {
    id: 'yellow', name: 'Yellow Classic', blurb: 'Broadcast yellow with outline',
    font: 'caption', size: 0.052, weight: 700, uppercase: false, letterSpacing: 0, lineHeight: 1.16,
    color: '#ffd400', activeColor: '#ffffff', dimColor: 'rgba(255,212,0,0.45)',
    stroke: { color: '#000000', width: 0.14 }, shadow: null,
    background: { mode: 'none' },
    position: 'bottom', offset: 0.07, align: 'center', maxWordsPerLine: 8, maxLines: 2,
    animation: 'none',
  },
};

export const CAPTION_STYLE_ORDER = [
  'clean', 'minimal', 'documentary', 'cinematic', 'bold', 'social', 'highlight',
  'karaoke', 'typewriter', 'modern', 'boxed', 'lowerthird', 'large', 'yellow',
];
export const CAPTION_STYLE_LIST = CAPTION_STYLE_ORDER.map((id) => CAPTION_STYLES[id]);

// Style ids used before this library existed (still in saved projects).
const LEGACY_STYLE_IDS = { classic: 'clean', boldsocial: 'bold', 'word-reveal': 'clean' };

export function normalizeStyleId(id) {
  if (CAPTION_STYLES[id]) return id;
  return LEGACY_STYLE_IDS[id] || 'clean';
}

export function getCaptionStyle(styleId) {
  return CAPTION_STYLES[normalizeStyleId(styleId)];
}

// Size buttons scale the preset's own size, so "Large" on Minimal is still
// smaller than "Large" on Bold.
export const CAPTION_SIZE_MULT = { sm: 0.82, md: 1, lg: 1.22 };

/*
 * Customisation layer. `overrides` holds only what the user changed; anything
 * absent falls back to the preset. Keys:
 *   font, weight, uppercase, color, activeColor, strokeColor, strokeWidth,
 *   shadow (bool), bgColor, bgOpacity, position, offset, align,
 *   letterSpacing, maxWordsPerLine
 * plus the long-standing project settings passed separately:
 *   size ('sm'|'md'|'lg'), fontScale (absolute fraction of H or null),
 *   lineHeight (multiple or null).
 */
export function resolveCaptionStyle(styleId, { size = 'md', fontScale = null, lineHeight = null, overrides = {} } = {}) {
  const base = getCaptionStyle(styleId);
  const o = overrides || {};
  const s = JSON.parse(JSON.stringify(base));

  s.size = fontScale > 0 ? fontScale : base.size * (CAPTION_SIZE_MULT[size] || 1);
  if (lineHeight > 0) s.lineHeight = lineHeight;
  if (o.font) s.font = o.font;
  if (o.weight) s.weight = +o.weight;
  if (typeof o.uppercase === 'boolean') s.uppercase = o.uppercase;
  if (o.color) s.color = o.color;
  if (o.activeColor) s.activeColor = o.activeColor;
  if (o.letterSpacing != null && o.letterSpacing !== '') s.letterSpacing = +o.letterSpacing;
  if (o.maxWordsPerLine > 0) s.maxWordsPerLine = +o.maxWordsPerLine;
  if (o.position) s.position = o.position;
  if (o.offset != null && o.offset !== '') s.offset = +o.offset;
  if (o.align) s.align = o.align;

  if (o.strokeWidth != null && o.strokeWidth !== '') {
    const w = +o.strokeWidth;
    s.stroke = w > 0 ? { color: o.strokeColor || (s.stroke && s.stroke.color) || '#000000', width: w } : null;
  } else if (o.strokeColor && s.stroke) {
    s.stroke.color = o.strokeColor;
  }

  if (typeof o.shadow === 'boolean') {
    s.shadow = o.shadow ? (base.shadow || { color: 'rgba(0,0,0,0.85)', blur: 0.22, x: 0, y: 0.05 }) : null;
  }

  if (o.bgColor || (o.bgOpacity != null && o.bgOpacity !== '')) {
    const bg = s.background && s.background.mode !== 'none'
      ? s.background
      : { mode: 'line', radius: 0.12, padX: 0.4, padY: 0.14 };
    if (o.bgColor) bg.color = o.bgColor;
    if (o.bgOpacity != null && o.bgOpacity !== '') bg.opacity = +o.bgOpacity;
    if (!bg.color) bg.color = '#000000';
    if (bg.opacity == null) bg.opacity = 0.6;
    s.background = bg.opacity > 0 ? bg : { mode: 'none' };
  }
  return s;
}

// Effective values for the Customize controls (preset value unless overridden).
export function effectiveStyleValues(styleId, opts) {
  const s = resolveCaptionStyle(styleId, opts);
  const bgOn = s.background && s.background.mode !== 'none';
  return {
    font: s.font, weight: s.weight, uppercase: !!s.uppercase,
    color: s.color, activeColor: s.activeColor,
    strokeColor: s.stroke ? s.stroke.color : '#000000', strokeWidth: s.stroke ? s.stroke.width : 0,
    shadow: !!s.shadow,
    bgColor: bgOn ? s.background.color : '#000000', bgOpacity: bgOn ? s.background.opacity : 0,
    position: s.position, offset: s.offset, align: s.align,
    letterSpacing: s.letterSpacing, lineHeight: s.lineHeight, maxWordsPerLine: s.maxWordsPerLine,
    size: s.size,
  };
}
