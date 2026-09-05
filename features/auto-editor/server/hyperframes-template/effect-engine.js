/**
 * EffectEngine - Phase 5 & 6 Motion-Graphics Runtime
 * CSS/SVG-based visual effects as isolated plugins.
 * Each plugin: { apply(tl, el, opts, layerStart, layerDuration) }
 *
 * Supported effects (v2): blur, brightness, contrast, saturation, hue-rotate,
 *                          vignette, grain, shadow, glow
 * New effects (v3): light-sweep, accent-line, shadow-bars
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
      gsap.set(grainEl, { opacity: 0 });
      el.appendChild(grainEl);
      tl.set(grainEl, { opacity: opts.intensity || 0.08 }, start);
      tl.set(grainEl, { opacity: 0 }, start + dur);
    },

    // ── V3 NEW EFFECTS ──────────────────────────────────────────────────────

    "light-sweep"(tl, el, opts, start, _dur) {
      const sweepStart = start + (opts.start || 0);
      const sweepDur   = opts.duration || 0.7;
      const angle      = opts.angle !== undefined ? opts.angle : 30;

      const sweepEl = document.createElement("div");
      sweepEl.className = "vc-light-sweep";
      sweepEl.style.setProperty("--vc-sweep-angle", `${angle}deg`);
      gsap.set(sweepEl, { xPercent: -120, opacity: 0 });
      el.appendChild(sweepEl);

      tl.set(sweepEl, { opacity: 1 }, sweepStart);
      tl.to(sweepEl, { xPercent: 120, duration: sweepDur, ease: "power2.inOut" }, sweepStart);
      tl.set(sweepEl, { opacity: 0 }, sweepStart + sweepDur);
    },

    "accent-line"(tl, el, opts, start, _dur) {
      const lineStart = start + (opts.start || 0);
      const lineDur   = opts.duration || 0.4;
      const color     = opts.color || "#00E5FF";
      const pos       = opts.position || "under";

      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("class", `vc-accent-line vc-accent-line--${pos}`);
      svg.setAttribute("viewBox", "0 0 100 4");
      svg.setAttribute("preserveAspectRatio", "none");

      const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
      line.setAttribute("x1", "0"); line.setAttribute("y1", "2");
      line.setAttribute("x2", "100"); line.setAttribute("y2", "2");
      line.setAttribute("stroke", color);
      line.setAttribute("stroke-width", "2");
      line.setAttribute("stroke-linecap", "round");

      const totalLength = 100;
      gsap.set(line, { strokeDasharray: totalLength, strokeDashoffset: totalLength });
      svg.appendChild(line);
      el.appendChild(svg);

      tl.set(svg, { opacity: 1 }, lineStart);
      tl.to(line, { strokeDashoffset: 0, duration: lineDur, ease: "power2.out" }, lineStart);
    },

    "shadow-bars"(tl, el, opts, start, dur) {
      const heightPct = opts.heightPct != null ? opts.heightPct : 8;
      const barTop = document.createElement("div");
      const barBot = document.createElement("div");
      barTop.className = "vc-shadow-bar vc-shadow-bar--top";
      barBot.className = "vc-shadow-bar vc-shadow-bar--bottom";
      barTop.style.height = `${heightPct}%`;
      barBot.style.height = `${heightPct}%`;
      gsap.set([barTop, barBot], { opacity: 0 });
      el.appendChild(barTop);
      el.appendChild(barBot);
      tl.to([barTop, barBot], { opacity: 1, duration: 0.4, ease: "power2.out" }, start);
      tl.to([barTop, barBot], { opacity: 0, duration: 0.3, ease: "power1.in" }, start + dur - 0.35);
    },
  };

  /**
   * Apply all effects for a layer element.
   * Accepts both v2 string effects (e.g. "vignette") and v3 object effects (e.g. { type: "vignette", intensity: 0.6 }).
   */
  function applyEffects(tl, el, effects, layerStart, layerDuration) {
    if (!effects || !effects.length) return;
    effects.forEach(eff => {
      const effObj = typeof eff === "string" ? { type: eff } : eff;
      const plugin = PLUGINS[effObj.type];
      if (!plugin) {
        console.warn(`EffectEngine: unknown effect "${effObj.type}"`);
        return;
      }
      plugin(tl, el, effObj, layerStart, layerDuration);
    });
  }

  return { applyEffects };
})();
