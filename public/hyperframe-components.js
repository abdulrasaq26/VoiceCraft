// The components a HyperFrame scene can be built from, and the brand it wears.
//
// THE MODEL DOES NOT WRITE HTML. It chooses components and supplies their
// content; everything about position, size, easing and colour is decided here.
// That is what keeps the standing rule — no model dictating pixel coordinates
// as authoritative layout — true by construction rather than by a prompt asking
// nicely, and it means a scene cannot come back broken in a way no test
// anticipated. It also means the whole documentary shares one visual language,
// because the language lives in this file rather than being reinvented per beat.
//
// The cost is real and worth stating: a scene can only look like the components
// that exist. That is the correct trade for a first route — the library grows
// from what beats actually asked for, which is a better guide than guessing.
//
// The output is genuine HyperFrame source: a full index.html with the data
// attributes the renderer reads, stable ids so Studio can edit any element, and
// a paused GSAP timeline on window.__timelines. Nothing here is a private
// format that later has to be translated.
(() => {
  'use strict';

  const esc = (v) => String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // ── The project's visual language ────────────────────────────────────────
  //
  // One place, so every scene of a documentary agrees. A project can override
  // any of it; nothing here is baked into a component.
  const DEFAULT_TOKENS = {
    bg: '#0b0d12',
    ink: '#f2f5f8',
    dim: 'rgba(242,245,248,0.62)',
    accent: '#f5b301',
    rule: 'rgba(242,245,248,0.18)',
    serif: 'Georgia, "Times New Roman", serif',
    mono: 'ui-monospace, "SF Mono", Menlo, monospace',
    // How the film moves. An archival film breathes and a data brief snaps,
    // and that is a difference a viewer names before they name a colour.
    ease: 'power3.out',
    pace: 1,
    // The caption band. Subtitles are burned in by the compositor AFTER this
    // video becomes a clip, so a composition that fills the bottom of the frame
    // gets written over. Every component keeps out of it.
    safeBottom: 0.24
  };

  /**
   * The tokens in force.
   *
   * The house style decides these, once, for the whole documentary — the
   * fallback here is what a project with no style chosen looks like, not a
   * second opinion. A project may still override any single token.
   */
  function tokensFor(project) {
    const S = window.BlvckHouseStyle;
    const styled = S ? S.current(project).tokens : {};
    return Object.assign({}, DEFAULT_TOKENS, styled, (project && project.visualLanguage) || {});
  }

  // Durations are written at the house pace: every number in a component's
  // timeline is a broadcast-brief number, and a style that breathes stretches
  // them all together rather than each component having its own opinion.
  const beat = (t) => (n) => Math.round(n * (Number(t.pace) || 1) * 100) / 100;

  // ── Components ───────────────────────────────────────────────────────────
  //
  // Each returns { html, css, timeline } for one element. `t` is the tokens,
  // `i` a per-scene index that keeps ids unique and stable.

  const COMPONENTS = {

    /** A line worth reading, with a kicker above it and a rule beneath. */
    title(spec, t, i) {
      const id = 'title' + i;
      const b = beat(t);
      return {
        html: `<div id="${id}" class="clip hf-title" data-start="0" data-duration="{{D}}" data-track-index="${1 + i}">
  ${spec.kicker ? `<div id="${id}-k" class="hf-kicker">${esc(spec.kicker)}</div>` : ''}
  <div id="${id}-h" class="hf-head">${esc(spec.text || '')}</div>
  <div id="${id}-r" class="hf-rule"></div>
</div>`,
        column: 'left',
        css: `.hf-title{max-width:100%}
.hf-kicker{font-family:${t.mono};font-size:26px;letter-spacing:.28em;text-transform:uppercase;color:${t.accent}}
.hf-head{font-family:${t.serif};font-size:var(--hf-head,104px);line-height:1.05;letter-spacing:-.02em;color:${t.ink};margin-top:18px}
.hf-rule{margin-top:30px;width:0;height:6px;background:${t.accent}}`,
        timeline: `tl.from("#${id}-k",{opacity:0,y:16,duration:${b(.5)},ease:"${t.ease}"},${b(0.08)})
  .from("#${id}-h",{opacity:0,y:38,duration:${b(.75)},ease:"${t.ease}"},${b(0.22)})
  .to("#${id}-r",{width:420,duration:${b(.7)},ease:"${t.ease}"},${b(0.75)});`
      };
    },

    /** One number, and what it is a number of. */
    stat(spec, t, i) {
      const id = 'stat' + i;
      const b = beat(t);
      return {
        html: `<div id="${id}" class="clip hf-stat" data-start="0" data-duration="{{D}}" data-track-index="${1 + i}">
  <div id="${id}-v" class="hf-stat-v">${esc(spec.value || '')}</div>
  <div id="${id}-l" class="hf-stat-l">${esc(spec.label || '')}</div>
</div>`,
        column: 'right',
        css: `.hf-stat{text-align:right}
.hf-stat-v{font-family:${t.serif};font-size:var(--hf-stat,190px);line-height:.95;color:${t.accent};letter-spacing:-.03em}
.hf-stat-l{font-family:${t.mono};font-size:24px;letter-spacing:.12em;text-transform:uppercase;color:${t.dim};margin-top:16px}`,
        timeline: `tl.from("#${id}-v",{opacity:0,scale:.86,duration:${b(.7)},ease:"back.out(1.6)",transformOrigin:"100% 50%"},${b(0.3)})
  .from("#${id}-l",{opacity:0,y:12,duration:${b(.5)},ease:"${t.ease}"},${b(0.62)});`
      };
    },

    /**
     * An ordered progression: stages that lead to one another.
     *
     * The component a sentence about hierarchy or career or process actually
     * needs, and the one no stock search can ever return.
     */
    progression(spec, t, i) {
      const id = 'prog' + i;
      const b = beat(t);
      const S = window.BlvckHouseStyle;
      const glow = S ? S.rgba(t.accent, 0.16) : 'rgba(245,179,1,.16)';
      const steps = (spec.items || []).slice(0, 5);
      const rows = steps.map((s, n) => `
  <div id="${id}-s${n}" class="hf-step${n === steps.length - 1 ? ' hf-step-last' : ''}">
    <span class="hf-dot"></span><span class="hf-step-t">${esc(s)}</span>
  </div>`).join('');
      return {
        html: `<div id="${id}" class="clip hf-prog" data-start="0" data-duration="{{D}}" data-track-index="${1 + i}">${rows}</div>`,
        column: 'left',
        css: `.hf-prog{display:flex;flex-direction:column;gap:26px}
.hf-step{display:flex;align-items:center;gap:22px;font-family:${t.serif};font-size:54px;color:${t.dim}}
.hf-step-last{color:${t.ink}}
.hf-dot{width:18px;height:18px;border-radius:50%;background:${t.rule};flex:none}
.hf-step-last .hf-dot{background:${t.accent};box-shadow:0 0 0 8px ${glow}}`,
        timeline: `tl.from("#${id} .hf-step",{opacity:0,x:-26,duration:${b(.55)},ease:"${t.ease}",stagger:${b(.16)}},${b(0.25)});`
      };
    },

    /**
     * The shot itself, inside the composition.
     *
     * This is what HYBRID means here: rather than laying graphics over a video
     * in our compositor and hoping the two agree, the footage becomes an
     * element of the scene and the graphics are built around it. The renderer
     * composes both and hands back one clip.
     *
     * data-media-start is the source in-point, which is how a nine second beat
     * takes seconds 567.8 to 576.8 of a thirteen minute film without anything
     * being trimmed first. It is the excerpt window the acquisition layer
     * already chose, passed through unchanged.
     */
    footage(spec, t, i) {
      const id = 'shot' + i;
      const at = Number(spec.mediaStart);
      return {
        html: `<video id="${id}" class="clip hf-shot" data-start="0" data-duration="{{D}}"
       data-track-index="0"${Number.isFinite(at) && at > 0 ? ` data-media-start="${at}"` : ''}
       src="assets/${esc(spec.file)}" muted playsinline></video>`,
        column: 'background',
        css: `.hf-shot{position:absolute;inset:0;width:1920px;height:1080px;object-fit:cover}
.hf-scrim{position:absolute;inset:0;background:linear-gradient(90deg,${t.bg}ee 0%,${t.bg}cc 42%,transparent 72%)}`,
        timeline: ''
      };
    },

    /** An approved image, given room and a caption. */
    image(spec, t, i) {
      const id = 'img' + i;
      const b = beat(t);
      return {
        html: `<div id="${id}" class="clip hf-img" data-start="0" data-duration="{{D}}" data-track-index="${1 + i}">
  <img id="${id}-p" src="assets/${esc(spec.file)}" alt="${esc(spec.caption || '')}" />
  ${spec.caption ? `<div id="${id}-c" class="hf-cap">${esc(spec.caption)}</div>` : ''}
</div>`,
        column: 'right',
        css: `.hf-img{width:100%}
.hf-img img{width:100%;height:auto;max-height:520px;object-fit:cover;border-radius:10px;display:block}
.hf-cap{font-family:${t.mono};font-size:20px;color:${t.dim};margin-top:14px;letter-spacing:.04em}`,
        timeline: `tl.from("#${id}-p",{opacity:0,scale:1.06,duration:${b(.9)},ease:"${t.ease}"},${b(0.2)});`
      };
    }
  };

  const DUR = '{{D}}';
  const KINDS = Object.keys(COMPONENTS);

  // What each component needs in order to be drawable at all. The Composer's
  // validator asks this rather than carrying its own copy of the rules.
  const NEEDS = {
    title: (s) => !!String(s.text || '').trim(),
    stat: (s) => !!String(s.value || '').trim(),
    progression: (s) => Array.isArray(s.items) && s.items.filter(Boolean).length >= 2,
    image: (s) => !!String(s.file || '').trim(),
    footage: (s) => !!String(s.file || '').trim()
  };

  function canDraw(spec) {
    const kind = String((spec && spec.kind) || '').toLowerCase();
    if (KINDS.indexOf(kind) < 0) return { ok: false, why: `there is no component called "${kind || '(none)'}"` };
    if (!NEEDS[kind](spec)) {
      return { ok: false, why: `a ${kind} needs ${kind === 'progression' ? 'at least two items'
        : kind === 'stat' ? 'a value' : (kind === 'image' || kind === 'footage')
        ? 'an asset' : 'text'}` };
    }
    return { ok: true, why: '' };
  }

  // ── Composition ──────────────────────────────────────────────────────────

  /**
   * Build one scene's HyperFrame source from a validated element list.
   *
   * `seconds` is the scene's window on the documentary timeline and comes from
   * AETHER. What happens inside those seconds is the composition's own affair
   * and is written here, in the components' timelines.
   */
  function compose({ elements = [], seconds, project, transparent = false,
                     gsapSrc = './vendor/gsap.min.js' } = {}) {
    const t = tokensFor(project);
    const d = Number(seconds);
    if (!Number.isFinite(d) || d <= 0) throw new Error('a composition needs its scene window');

    const built = elements.map((spec, i) => {
      const kind = String(spec.kind).toLowerCase();
      return COMPONENTS[kind](spec, t, i);
    });

    // ARRANGEMENT IS THE LIBRARY'S JOB TOO, and this is the second half of not
    // letting a model name positions. Giving each component its own absolute
    // top and left made every component correct alone and wrong together:
    // measured on a real scene, a title and a progression both sat at the left
    // edge about a third of the way down and drew straight through each other.
    // Components now declare which column they belong to and the columns lay
    // themselves out, so two things cannot land in the same place.
    const NL = String.fromCharCode(10);
    const back  = built.filter((b) => b.column === 'background');
    const left  = built.filter((b) => b.column !== 'right' && b.column !== 'background');
    const right = built.filter((b) => b.column === 'right');
    const put = (list) => list.map((b) => b.html.split(DUR).join(String(d)))
      .join(NL + '        ');

    // Type shrinks as a column fills: two components in one column have half
    // the room one had.
    const scale = '--hf-head:' + (left.length > 1 ? 68 : 104) + 'px;'
                + '--hf-stat:' + (right.length > 1 ? 132 : 190) + 'px;';

    const css = [...new Set(built.map((b) => b.css))].join(NL);
    // The shot goes behind everything, with a scrim over it so typography on
    // the left stays readable against whatever the footage happens to be doing.
    const bg = back.length
      ? put(back) + NL + '      <div class=\"hf-scrim\"></div>' + NL + '      '
      : '';
    const html = bg + '<div class=\"hf-col hf-col-left\">' + NL + '        ' + put(left)
               + NL + '      </div>' + NL + '      <div class=\"hf-col hf-col-right\">' + NL
               + '        ' + put(right) + NL + '      </div>';
    const timeline = built.map((b) => b.timeline).join(NL + '  ');

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="${gsapSrc}"><\/script>
    <style>
      *{margin:0;padding:0;box-sizing:border-box}
      /* An OVERLAY renders transparent, so html and body are left unpainted:
         the rendering guide is explicit that any opaque full-frame ground is
         encoded as visible pixels and the alpha is lost. */
      html,body{width:1920px;height:1080px;overflow:hidden;background:${transparent ? 'transparent' : t.bg}}
      /* The compositor burns subtitles over this video afterwards, so the
         bottom ${Math.round(t.safeBottom * 100)}% of the frame is left clear. */
      #root{position:relative;width:1920px;height:1080px;
            display:flex;align-items:center;gap:80px;
            padding:0 9% ${Math.round(t.safeBottom * 1080)}px 9%;
            ${scale}}
      .hf-col{display:flex;flex-direction:column;gap:46px;flex:1;min-width:0}
      .hf-col-right{align-items:flex-end;text-align:right}
      .hf-col:empty{display:none}
${css.split('\n').map((l) => '      ' + l).join('\n')}
    </style>
  </head>
  <body>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${d}"
         data-width="1920" data-height="1080" data-fps="30">
      ${html}
    </div>
    <script>
      window.__timelines = window.__timelines || {};
      const tl = gsap.timeline({ paused: true });
      ${timeline}
      window.__timelines["main"] = tl;
    <\/script>
  </body>
</html>`;
  }

  /** What the Composer may be told exists. Kept here so it cannot drift. */
  function vocabulary() {
    return [
      'title        a headline, with an optional kicker above it',
      '             { "kind":"title", "text":"…", "kicker":"…" }',
      'stat         one figure and what it counts',
      '             { "kind":"stat", "value":"40%", "label":"…" }',
      'progression  two to five stages that lead to one another',
      '             { "kind":"progression", "items":["…","…","…"] }',
      'image        an approved asset, by its id, with a caption',
      '             { "kind":"image", "assetId":"…", "caption":"…" }',
      'footage      the shot this beat already has, as the background',
      '             { "kind":"footage" }'
    ].join('\n');
  }

  window.BlvckHyperFrameComponents = {
    compose, canDraw, vocabulary, tokensFor,
    KINDS, DEFAULT_TOKENS
  };
})();
