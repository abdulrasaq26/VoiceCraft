/**
 * LowerThirdEngine - Phase 5 Motion-Graphics Runtime
 *
 * Reusable lower-third component system.
 * Presets are data-driven objects, not hardcoded HTML.
 *
 * Presets: minimal, modern, news, corporate, social, cinematic
 */
window.LowerThirdEngine = (function () {

  // ---- Preset Definitions ----
  // Each preset: { containerClass, titleClass, subtitleClass, accentLine, bgClass }

  const PRESET_STYLES = {
    minimal: {
      container: "vc-lt vc-lt--minimal",
      accent:    "vc-lt-accent vc-lt-accent--line",
      title:     "vc-lt-title vc-lt-title--minimal",
      subtitle:  "vc-lt-subtitle vc-lt-subtitle--minimal",
      bg:        null,
    },
    modern: {
      container: "vc-lt vc-lt--modern",
      accent:    null,
      title:     "vc-lt-title vc-lt-title--modern",
      subtitle:  "vc-lt-subtitle vc-lt-subtitle--modern",
      bg:        "vc-lt-bg vc-lt-bg--pill",
    },
    news: {
      container: "vc-lt vc-lt--news",
      accent:    "vc-lt-accent vc-lt-accent--bar",
      title:     "vc-lt-title vc-lt-title--news",
      subtitle:  "vc-lt-subtitle vc-lt-subtitle--news",
      bg:        "vc-lt-bg vc-lt-bg--bar",
    },
    corporate: {
      container: "vc-lt vc-lt--corporate",
      accent:    "vc-lt-accent vc-lt-accent--side",
      title:     "vc-lt-title vc-lt-title--corporate",
      subtitle:  "vc-lt-subtitle vc-lt-subtitle--corporate",
      bg:        "vc-lt-bg vc-lt-bg--dark",
    },
    social: {
      container: "vc-lt vc-lt--social",
      accent:    null,
      title:     "vc-lt-title vc-lt-title--social",
      subtitle:  "vc-lt-subtitle vc-lt-subtitle--social",
      bg:        "vc-lt-bg vc-lt-bg--card",
    },
    cinematic: {
      container: "vc-lt vc-lt--cinematic",
      accent:    "vc-lt-accent vc-lt-accent--underline",
      title:     "vc-lt-title vc-lt-title--cinematic",
      subtitle:  "vc-lt-subtitle vc-lt-subtitle--cinematic",
      bg:        null,
    },
  };

  /**
   * Build the DOM structure for a lower-third layer.
   */
  function buildDOM(layer) {
    const preset = layer.preset || "modern";
    const styles = PRESET_STYLES[preset] || PRESET_STYLES.modern;
    const data   = layer.data || {};

    const container = document.createElement("div");
    container.id = layer.id;
    container.className = styles.container;

    // Background
    if (styles.bg) {
      const bg = document.createElement("div");
      bg.className = styles.bg;
      container.appendChild(bg);
    }

    // Accent line / bar
    if (styles.accent) {
      const acc = document.createElement("div");
      acc.className = styles.accent;
      container.appendChild(acc);
    }

    // Text block
    const textBlock = document.createElement("div");
    textBlock.className = "vc-lt-text";

    if (data.title) {
      const title = document.createElement("div");
      title.className = styles.title;
      title.textContent = data.title;
      textBlock.appendChild(title);
    }

    if (data.subtitle) {
      const sub = document.createElement("div");
      sub.className = styles.subtitle;
      sub.textContent = data.subtitle;
      textBlock.appendChild(sub);
    }

    container.appendChild(textBlock);
    return container;
  }

  /**
   * Create a lower-third layer and add it to the master timeline.
   */
  function createLowerThird(tl, trackEl, layer, layerStart, layerDuration) {
    const el = buildDOM(layer);
    gsap.set(el, { opacity: 0 });
    trackEl.appendChild(el);

    // Use TransitionEngine for entrance / exit
    tl.set(el, { opacity: 1 }, layerStart);
    TransitionEngine.applyIn(tl, el, layer.transitionIn, layerStart);
    TransitionEngine.applyOut(tl, el, layer.transitionOut, layerStart + layerDuration);

    // Apply animations if any
    if (layer.animations && layer.animations.length) {
      AnimationEngine.applyAnimations(tl, el, layer.animations, layerStart, layerDuration);
    }

    return el;
  }

  return { createLowerThird, PRESET_STYLES };
})();
