/**
 * TransitionEngine - Phase 5 Motion-Graphics Runtime
 *
 * 12 transition types, each an isolated { applyIn, applyOut } plugin.
 * Registered in a map — add new transitions by registering a plugin.
 *
 * Types: fade, crossfade, slide-left, slide-right, slide-up, slide-down,
 *        wipe-left, wipe-right, push-left, push-right, blur-in, zoom-through
 */
window.TransitionEngine = (function () {

  const PLUGINS = {};

  function register(name, plugin) {
    PLUGINS[name] = plugin;
  }

  // ---- Helper: set clip-path for wipes ----
  function wipeClip(pct) {
    return `inset(0 ${pct}% 0 0)`;
  }

  // ---- FADE ----
  register("fade", {
    applyIn(tl, el, dur, start) {
      tl.fromTo(el, { opacity: 0 }, { opacity: 1, duration: dur, ease: "linear" }, start);
    },
    applyOut(tl, el, dur, end) {
      tl.to(el, { opacity: 0, duration: dur, ease: "linear" }, end - dur);
    },
  });

  register("crossfade", PLUGINS["fade"]);   // alias

  // ---- SLIDE ----
  register("slide-left", {
    applyIn(tl, el, dur, start) {
      tl.fromTo(el, { x: "100%" }, { x: "0%", duration: dur, ease: "power2.out" }, start);
    },
    applyOut(tl, el, dur, end) {
      tl.to(el, { x: "-100%", duration: dur, ease: "power2.in" }, end - dur);
    },
  });

  register("slide-right", {
    applyIn(tl, el, dur, start) {
      tl.fromTo(el, { x: "-100%" }, { x: "0%", duration: dur, ease: "power2.out" }, start);
    },
    applyOut(tl, el, dur, end) {
      tl.to(el, { x: "100%", duration: dur, ease: "power2.in" }, end - dur);
    },
  });

  register("slide-up", {
    applyIn(tl, el, dur, start) {
      tl.fromTo(el, { y: "100%" }, { y: "0%", duration: dur, ease: "power2.out" }, start);
    },
    applyOut(tl, el, dur, end) {
      tl.to(el, { y: "-100%", duration: dur, ease: "power2.in" }, end - dur);
    },
  });

  register("slide-down", {
    applyIn(tl, el, dur, start) {
      tl.fromTo(el, { y: "-100%" }, { y: "0%", duration: dur, ease: "power2.out" }, start);
    },
    applyOut(tl, el, dur, end) {
      tl.to(el, { y: "100%", duration: dur, ease: "power2.in" }, end - dur);
    },
  });

  // ---- WIPE (clip-path) ----
  register("wipe-left", {
    applyIn(tl, el, dur, start) {
      tl.fromTo(el, { clipPath: "inset(0 100% 0 0)" }, { clipPath: "inset(0 0% 0 0)", duration: dur, ease: "power2.inOut" }, start);
    },
    applyOut(tl, el, dur, end) {
      tl.to(el, { clipPath: "inset(0 0% 0 100%)", duration: dur, ease: "power2.inOut" }, end - dur);
    },
  });

  register("wipe-right", {
    applyIn(tl, el, dur, start) {
      tl.fromTo(el, { clipPath: "inset(0 0% 0 100%)" }, { clipPath: "inset(0 0% 0 0%)", duration: dur, ease: "power2.inOut" }, start);
    },
    applyOut(tl, el, dur, end) {
      tl.to(el, { clipPath: "inset(0 100% 0 0%)", duration: dur, ease: "power2.inOut" }, end - dur);
    },
  });

  // ---- PUSH (both clips move together) ----
  // The "push" effect requires coordinating two elements; applyIn handles both
  register("push-left", {
    applyIn(tl, el, dur, start, prevEl) {
      tl.fromTo(el, { x: "100%" }, { x: "0%", duration: dur, ease: "power2.inOut" }, start);
      if (prevEl) tl.to(prevEl, { x: "-100%", duration: dur, ease: "power2.inOut" }, start);
    },
    applyOut(tl, el, dur, end) {
      // Out handled by the next clip's applyIn
    },
  });

  register("push-right", {
    applyIn(tl, el, dur, start, prevEl) {
      tl.fromTo(el, { x: "-100%" }, { x: "0%", duration: dur, ease: "power2.inOut" }, start);
      if (prevEl) tl.to(prevEl, { x: "100%", duration: dur, ease: "power2.inOut" }, start);
    },
    applyOut(tl, el, dur, end) { },
  });

  // ---- BLUR-IN ----
  register("blur-in", {
    applyIn(tl, el, dur, start) {
      tl.fromTo(el,
        { filter: "blur(20px)", opacity: 0 },
        { filter: "blur(0px)", opacity: 1, duration: dur, ease: "power2.out" },
        start
      );
    },
    applyOut(tl, el, dur, end) {
      tl.to(el, { filter: "blur(20px)", opacity: 0, duration: dur, ease: "power2.in" }, end - dur);
    },
  });

  // ---- ZOOM-THROUGH ----
  register("zoom-through", {
    applyIn(tl, el, dur, start) {
      tl.fromTo(el, { scale: 1.6, opacity: 0 }, { scale: 1, opacity: 1, duration: dur, ease: "power2.out" }, start);
    },
    applyOut(tl, el, dur, end) {
      tl.to(el, { scale: 0.6, opacity: 0, duration: dur, ease: "power2.in" }, end - dur);
    },
  });

  // ---- ZOOM (default: same as zoom-through) ----
  register("zoom", PLUGINS["zoom-through"]);

  /**
   * Apply transition-in for a layer.
   */
  function applyIn(tl, el, transition, layerStart, prevEl) {
    if (!transition) {
      tl.set(el, { opacity: 1 }, layerStart);
      return;
    }
    const { type, duration = 0.5 } = transition;
    tl.set(el, { opacity: 1 }, layerStart);
    const plugin = PLUGINS[type];
    if (!plugin) {
      console.warn(`TransitionEngine: unknown transition "${type}"`);
      return;
    }
    plugin.applyIn(tl, el, duration, layerStart, prevEl);
  }

  /**
   * Apply transition-out for a layer.
   */
  function applyOut(tl, el, transition, layerEnd) {
    if (!transition) {
      tl.set(el, { opacity: 0 }, layerEnd);
      return;
    }
    const { type, duration = 0.5 } = transition;
    const plugin = PLUGINS[type];
    if (!plugin) {
      tl.set(el, { opacity: 0 }, layerEnd);
      return;
    }
    plugin.applyOut(tl, el, duration, layerEnd);
  }

  return { applyIn, applyOut, register, PLUGINS };
})();
