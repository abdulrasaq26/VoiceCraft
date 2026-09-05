/**
 * AnimationEngine - Phase 5 Motion-Graphics Runtime
 *
 * Two responsibilities:
 *  1. Expand animation presets into canonical keyframe arrays
 *  2. Delegate keyframe arrays to KeyframeEngine
 *
 * Preset catalogue is data-driven — add a new preset without touching
 * the core timeline or layer-engine.
 */
window.AnimationEngine = (function () {

  // ----- Preset Catalogue -----
  // Each preset is a function(duration, opts) -> animation[] (keyframe format)
  const PRESETS = {

    "ken-burns": (dur, opts = {}) => {
      const amt = opts.amount || 0.12;
      return [
        { property: "scale", keyframes: [{ time: 0, value: 1 }, { time: dur, value: 1 + amt }], easing: "power1.inOut" },
      ];
    },

    "zoom-out": (dur, opts = {}) => {
      const amt = opts.amount || 0.12;
      return [
        { property: "scale", keyframes: [{ time: 0, value: 1 + amt }, { time: dur, value: 1 }], easing: "power1.inOut" },
      ];
    },

    "pan-left": (dur, opts = {}) => {
      const px = opts.pixels || 60;
      return [
        { property: "x", keyframes: [{ time: 0, value: 0 }, { time: dur, value: -px }], easing: "power1.inOut" },
      ];
    },

    "pan-right": (dur, opts = {}) => {
      const px = opts.pixels || 60;
      return [
        { property: "x", keyframes: [{ time: 0, value: 0 }, { time: dur, value: px }], easing: "power1.inOut" },
      ];
    },

    "pan-up": (dur, opts = {}) => {
      const px = opts.pixels || 40;
      return [
        { property: "y", keyframes: [{ time: 0, value: 0 }, { time: dur, value: -px }], easing: "power1.inOut" },
      ];
    },

    "pan-down": (dur, opts = {}) => {
      const px = opts.pixels || 40;
      return [
        { property: "y", keyframes: [{ time: 0, value: 0 }, { time: dur, value: px }], easing: "power1.inOut" },
      ];
    },

    "zoom-in-pan-right": (dur, opts = {}) => {
      const amt = opts.amount || 0.10; const px = opts.pixels || 50;
      return [
        { property: "scale", keyframes: [{ time: 0, value: 1 }, { time: dur, value: 1 + amt }], easing: "power1.inOut" },
        { property: "x",     keyframes: [{ time: 0, value: 0 }, { time: dur, value: px }],      easing: "power1.inOut" },
      ];
    },

    "zoom-in-pan-left": (dur, opts = {}) => {
      const amt = opts.amount || 0.10; const px = opts.pixels || 50;
      return [
        { property: "scale", keyframes: [{ time: 0, value: 1 }, { time: dur, value: 1 + amt }], easing: "power1.inOut" },
        { property: "x",     keyframes: [{ time: 0, value: 0 }, { time: dur, value: -px }],     easing: "power1.inOut" },
      ];
    },

    "zoom-out-pan-right": (dur, opts = {}) => {
      const amt = opts.amount || 0.10; const px = opts.pixels || 50;
      return [
        { property: "scale", keyframes: [{ time: 0, value: 1 + amt }, { time: dur, value: 1 }], easing: "power1.inOut" },
        { property: "x",     keyframes: [{ time: 0, value: -px }, { time: dur, value: 0 }],     easing: "power1.inOut" },
      ];
    },

    "dramatic-push": (dur, opts = {}) => {
      const amt = opts.amount || 0.25;
      return [
        { property: "scale", keyframes: [{ time: 0, value: 1 }, { time: dur, value: 1 + amt }], easing: "power3.in" },
      ];
    },

    "smooth-reveal": (dur, opts = {}) => {
      const rise = opts.rise || 20;
      return [
        { property: "opacity", keyframes: [{ time: 0, value: 0 }, { time: Math.min(0.8, dur * 0.3), value: 1 }], easing: "power2.out" },
        { property: "y",       keyframes: [{ time: 0, value: rise }, { time: Math.min(0.8, dur * 0.3), value: 0 }], easing: "power2.out" },
      ];
    },

    "parallax": (dur, opts = {}) => {
      const amt = opts.amount || 30;
      return [
        { property: "y", keyframes: [{ time: 0, value: 0 }, { time: dur, value: -amt * 0.5 }], easing: "none" },
      ];
    },

    "rotate-drift": (dur, opts = {}) => {
      const deg = opts.degrees || 2;
      return [
        { property: "rotation", keyframes: [{ time: 0, value: -deg }, { time: dur, value: deg }], easing: "power1.inOut" },
      ];
    },

    // ── V3 NEW PRESETS ────────────────────────────────────────────────────────

    /**
     * Cinematic slow push — the v3 default for restrained intensity.
     * Scale 1.0 → 1.05 over the full clip duration with a gentle ease.
     */
    "cinematic-push": (dur, opts = {}) => {
      const amt = opts.amount || 0.05;
      const x   = opts.x || 0;
      const anims = [
        { property: "scale", keyframes: [{ time: 0, value: 1 }, { time: dur, value: 1 + amt }], easing: "power1.inOut" },
      ];
      if (x !== 0) {
        anims.push({ property: "x", keyframes: [{ time: 0, value: 0 }, { time: dur, value: x }], easing: "power1.inOut" });
      }
      return anims;
    },

    /**
     * 3D perspective tilt — subtle rotationX/Y that creates a sense of depth.
     * Designed for hero/climax moments. Use sparingly.
     */
    "perspective-tilt": (dur, opts = {}) => {
      const rx = opts.rotationX || 3;
      const ry = opts.rotationY || 2;
      return [
        { property: "rotationX", keyframes: [{ time: 0, value: rx }, { time: dur * 0.5, value: -rx * 0.5 }, { time: dur, value: 0 }], easing: "power2.inOut" },
        { property: "rotationY", keyframes: [{ time: 0, value: 0 }, { time: dur * 0.5, value: ry }, { time: dur, value: 0 }], easing: "power2.inOut" },
      ];
    },

    /**
     * Negative-space drift — moves the image away from a declared subject side
     * so typography can occupy the cleared zone.
     * opts.side: "left" | "right" | "up" | "down"
     */
    "negative-space-drift": (dur, opts = {}) => {
      const side = opts.side || "right";
      const px   = opts.pixels || 40;
      const propMap = { left: ["x", -px], right: ["x", px], up: ["y", -px], down: ["y", px] };
      const [prop, val] = propMap[side] || ["x", px];
      return [
        { property: prop, keyframes: [{ time: 0, value: 0 }, { time: dur, value: val }], easing: "power1.inOut" },
        { property: "scale", keyframes: [{ time: 0, value: 1 }, { time: dur, value: 1.04 }], easing: "power1.inOut" },
      ];
    },
  };

  /**
   * Expand a preset name into canonical animation keyframe arrays.
   * Returns [{ property, keyframes, easing }, ...]
   */
  function expandPreset(presetName, duration, opts) {
    const fn = PRESETS[presetName];
    if (!fn) {
      console.warn(`AnimationEngine: unknown preset "${presetName}"`);
      return [];
    }
    return fn(duration, opts || {});
  }

  /**
   * Apply all animations for a layer — handles both explicit keyframes
   * and preset expansion, then delegates to KeyframeEngine.
   *
   * @param {gsap.core.Timeline} tl
   * @param {Element} target
   * @param {Array} animations        - layer.animations []
   * @param {number} layerStart
   * @param {number} layerDuration
   */
  function applyAnimations(tl, target, animations, layerStart, layerDuration) {
    if (!animations || !animations.length) return;

    const resolved = [];
    animations.forEach(anim => {
      if (anim.preset) {
        const expanded = expandPreset(anim.preset, anim.duration || layerDuration, anim.opts);
        expanded.forEach(a => resolved.push(a));
      } else if (anim.keyframes && anim.property) {
        resolved.push(anim);
      }
    });

    KeyframeEngine.applyAnimations(tl, target, resolved, layerStart);
  }

  return { applyAnimations, expandPreset, PRESETS };
})();
