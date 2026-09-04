/**
 * EffectEngine - Phase 5 Motion-Graphics Runtime
 * CSS/SVG-based visual effects as isolated plugins.
 * Each plugin: { apply(tl, el, opts, layerStart, layerDuration) }
 *
 * Supported effects: blur, brightness, contrast, saturation, hue-rotate,
 *                    vignette, grain, shadow, glow
 */
window.EffectEngine = (function () {

  // --- Effect Plugins ---

  const PLUGINS = {

    blur(tl, el, opts, start, dur) {
      const amount = opts.amount || 8;
      const ease = opts.easing || "power2.inOut";
      if (opts.animateIn) {
        tl.fromTo(el, { filter: `blur(${amount}px)` }, { filter: "blur(0px)", duration: opts.animateIn, ease }, start);
      } else {
        tl.set(el, { filter: `blur(${amount}px)` }, start);
        tl.set(el, { filter: "blur(0px)" }, start + dur);
      }
    },

    brightness(tl, el, opts, start, dur) {
      const val = opts.value != null ? opts.value : 1.2;
      tl.set(el, { filter: `brightness(${val})` }, start);
      tl.set(el, { filter: "brightness(1)" }, start + dur);
    },

    contrast(tl, el, opts, start, dur) {
      const val = opts.value != null ? opts.value : 1.2;
      tl.set(el, { filter: `contrast(${val})` }, start);
      tl.set(el, { filter: "contrast(1)" }, start + dur);
    },

    saturation(tl, el, opts, start, dur) {
      const val = opts.value != null ? opts.value : 1.4;
      tl.set(el, { filter: `saturate(${val})` }, start);
      tl.set(el, { filter: "saturate(1)" }, start + dur);
    },

    "hue-rotate"(tl, el, opts, start, dur) {
      const deg = opts.degrees || 30;
      tl.set(el, { filter: `hue-rotate(${deg}deg)` }, start);
      tl.set(el, { filter: "hue-rotate(0deg)" }, start + dur);
    },

    vignette(tl, el, opts, start, dur) {
      // Implemented via a sibling overlay div
      const intensity = opts.intensity != null ? opts.intensity : 0.5;
      const vEl = document.createElement("div");
      vEl.className = "vc-vignette";
      vEl.style.setProperty("--vc-vignette-intensity", intensity);
      gsap.set(vEl, { opacity: 0 });
      el.appendChild(vEl);
      tl.set(vEl, { opacity: 1 }, start);
      tl.set(vEl, { opacity: 0 }, start + dur);
    },

    glow(tl, el, opts, start, dur) {
      const color = opts.color || "rgba(255,255,255,0.6)";
      const spread = opts.spread || 20;
      tl.set(el, { filter: `drop-shadow(0 0 ${spread}px ${color})` }, start);
      tl.set(el, { filter: "none" }, start + dur);
    },

    shadow(tl, el, opts, start, dur) {
      const x = opts.x || 4, y = opts.y || 8, blur = opts.blur || 16;
      const color = opts.color || "rgba(0,0,0,0.6)";
      tl.set(el, { filter: `drop-shadow(${x}px ${y}px ${blur}px ${color})` }, start);
      tl.set(el, { filter: "none" }, start + dur);
    },

    grain(tl, el, opts, start, dur) {
      // Grain is handled via CSS animation on a pseudo-overlay class
      const grainEl = document.createElement("div");
      grainEl.className = "vc-grain";
      gsap.set(grainEl, { opacity: opts.intensity || 0.08 });
      el.appendChild(grainEl);
      tl.set(grainEl, { opacity: opts.intensity || 0.08 }, start);
      tl.set(grainEl, { opacity: 0 }, start + dur);
    },
  };

  /**
   * Apply all effects for a layer element.
   * @param {gsap.core.Timeline} tl
   * @param {Element} el
   * @param {Array} effects     - layer.effects []
   * @param {number} layerStart
   * @param {number} layerDuration
   */
  function applyEffects(tl, el, effects, layerStart, layerDuration) {
    if (!effects || !effects.length) return;
    effects.forEach(eff => {
      const plugin = PLUGINS[eff.type];
      if (!plugin) {
        console.warn(`EffectEngine: unknown effect "${eff.type}"`);
        return;
      }
      plugin(tl, el, eff, layerStart, layerDuration);
    });
  }

  return { applyEffects };
})();
