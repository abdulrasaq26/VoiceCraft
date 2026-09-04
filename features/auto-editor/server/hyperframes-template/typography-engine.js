/**
 * TypographyEngine - Phase 5 Motion-Graphics Runtime
 *
 * Kinetic typography system with word/char/line splitting and GSAP stagger.
 *
 * Presets: word-reveal, char-cascade, typewriter, blur-reveal, fade-up,
 *          slide-up, pop, bounce
 *
 * Backgrounds: pill, bar, gradient, none
 * Positions: bottom, top, center, custom
 * Font: reads fontFamily from spec; falls back to system-ui (no Google Fonts in Lambda)
 */
window.TypographyEngine = (function () {

  // ---- Text Splitting ----

  function splitWords(text) {
    return text.trim().split(/\s+/);
  }

  function splitChars(text) {
    return text.trim().split("");
  }

  function wrapSpans(parts, className) {
    return parts.map(p => {
      const span = document.createElement("span");
      span.className = className;
      span.textContent = p === " " ? "\u00A0" : p;
      return span;
    });
  }

  // ---- Background Shape Builders ----

  function createBackground(shape, container) {
    if (!shape || shape === "none") return;
    const bg = document.createElement("div");
    bg.className = `vc-text-bg vc-text-bg--${shape}`;
    container.insertBefore(bg, container.firstChild);
    return bg;
  }

  // ---- Preset Definitions ----
  // Each preset: apply(tl, container, spans, layerStart, layerDuration, opts)

  const PRESETS = {

    "word-reveal"(tl, container, spans, start, dur, opts) {
      const stagger = opts.stagger || 0.06;
      const dur_each = opts.wordDur || 0.35;
      const ease = opts.easing || "power2.out";
      gsap.set(spans, { opacity: 0, y: 16 });
      tl.to(spans, { opacity: 1, y: 0, duration: dur_each, stagger, ease }, start);
      // Fade out near end
      tl.to(container, { opacity: 0, duration: 0.25, ease: "power1.in" }, start + dur - 0.3);
    },

    "char-cascade"(tl, container, spans, start, dur, opts) {
      const stagger = opts.stagger || 0.04;
      const dur_each = opts.charDur || 0.25;
      const ease = opts.easing || "back.out(1.4)";
      gsap.set(spans, { opacity: 0, y: 20, rotation: -5 });
      tl.to(spans, { opacity: 1, y: 0, rotation: 0, duration: dur_each, stagger, ease }, start);
      tl.to(container, { opacity: 0, duration: 0.25, ease: "power1.in" }, start + dur - 0.3);
    },

    "typewriter"(tl, container, spans, start, dur, opts) {
      const interval = opts.interval || 0.06;
      gsap.set(spans, { opacity: 0 });
      spans.forEach((span, i) => {
        tl.set(span, { opacity: 1 }, start + i * interval);
      });
      tl.to(container, { opacity: 0, duration: 0.2, ease: "power1.in" }, start + dur - 0.25);
    },

    "blur-reveal"(tl, container, spans, start, dur, opts) {
      const stagger = opts.stagger || 0.07;
      const dur_each = opts.wordDur || 0.4;
      gsap.set(spans, { opacity: 0, filter: "blur(10px)" });
      tl.to(spans, { opacity: 1, filter: "blur(0px)", duration: dur_each, stagger, ease: "power2.out" }, start);
      tl.to(container, { opacity: 0, duration: 0.3, ease: "linear" }, start + dur - 0.35);
    },

    "fade-up"(tl, container, spans, start, dur, opts) {
      // Animate the whole container, not per-word
      gsap.set(container, { opacity: 0, y: 24 });
      tl.to(container, { opacity: 1, y: 0, duration: opts.inDur || 0.4, ease: "power2.out" }, start);
      tl.to(container, { opacity: 0, duration: opts.outDur || 0.3, ease: "power1.in" }, start + dur - (opts.outDur || 0.3));
    },

    "slide-up"(tl, container, spans, start, dur, opts) {
      const stagger = opts.stagger || 0.06;
      gsap.set(spans, { opacity: 0, y: 32 });
      tl.to(spans, { opacity: 1, y: 0, duration: 0.4, stagger, ease: "power3.out" }, start);
      tl.to(container, { opacity: 0, duration: 0.25, ease: "linear" }, start + dur - 0.3);
    },

    "pop"(tl, container, spans, start, dur, opts) {
      const stagger = opts.stagger || 0.05;
      gsap.set(spans, { opacity: 0, scale: 0.4 });
      tl.to(spans, { opacity: 1, scale: 1, duration: 0.3, stagger, ease: "back.out(2)" }, start);
      tl.to(container, { opacity: 0, duration: 0.2, ease: "power1.in" }, start + dur - 0.25);
    },

    "bounce"(tl, container, spans, start, dur, opts) {
      const stagger = opts.stagger || 0.06;
      gsap.set(spans, { opacity: 0, y: -30 });
      tl.to(spans, { opacity: 1, y: 0, duration: 0.5, stagger, ease: "bounce.out" }, start);
      tl.to(container, { opacity: 0, duration: 0.25, ease: "power1.in" }, start + dur - 0.3);
    },
  };

  // ---- Position CSS classes ----
  const POSITION_CLASS = {
    bottom:       "vc-text--bottom",
    top:          "vc-text--top",
    center:       "vc-text--center",
    "lower-third":"vc-text--lower-third",
  };

  // ---- Size presets ----
  const SIZE_CLASS = {
    sm: "vc-text--sm",
    md: "vc-text--md",
    lg: "vc-text--lg",
    xl: "vc-text--xl",
    "2xl": "vc-text--2xl",
  };

  /**
   * Create and animate a text layer.
   *
   * @param {gsap.core.Timeline} tl
   * @param {Element} trackEl        - parent DOM container
   * @param {Object} layer           - layer spec
   * @param {number} layerStart
   * @param {number} layerDuration
   * @returns {Element} the created container element
   */
  function createTextLayer(tl, trackEl, layer, layerStart, layerDuration) {
    const typo = layer.typography || {};
    const preset = typo.preset || "fade-up";
    const text   = typo.text || layer.text || "";
    const bg     = typo.background || "none";
    const pos    = typo.position || "bottom";
    const size   = typo.size || "lg";
    const color  = typo.color || "#FFFFFF";
    const family = typo.fontFamily || "system-ui, sans-serif";

    // Outer wrapper
    const container = document.createElement("div");
    container.id = layer.id;
    container.className = [
      "vc-text-layer",
      POSITION_CLASS[pos] || "vc-text--bottom",
      SIZE_CLASS[size] || "vc-text--lg",
    ].join(" ");
    container.style.color = color;
    container.style.fontFamily = family;
    gsap.set(container, { opacity: 0 });

    // Background shape
    createBackground(bg, container);

    // Text wrapper
    const textWrap = document.createElement("div");
    textWrap.className = "vc-text-content";
    container.appendChild(textWrap);

    // Decide split unit (chars for typewriter/char-cascade, words for the rest)
    const useChars = ["typewriter", "char-cascade"].includes(preset);
    const parts = useChars ? splitChars(text) : splitWords(text);
    const spans = wrapSpans(parts, useChars ? "vc-char" : "vc-word");

    spans.forEach(s => textWrap.appendChild(s));

    // Add to DOM, hidden initially
    trackEl.appendChild(container);
    tl.set(container, { opacity: 1 }, layerStart);
    tl.set(container, { opacity: 0 }, layerStart + layerDuration);

    // Run preset
    const presetFn = PRESETS[preset] || PRESETS["fade-up"];
    presetFn(tl, container, spans, layerStart, layerDuration, typo);

    return container;
  }

  return { createTextLayer, PRESETS };
})();
