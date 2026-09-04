/**
 * KeyframeEngine - Phase 5 Motion-Graphics Runtime
 * Converts keyframe arrays into GSAP tweens on the master timeline.
 * Schema: { property, keyframes: [{time, value},...], easing }
 */
window.KeyframeEngine = (function () {

  function buildTweens(tl, target, property, keyframes, easing, startOffset) {
    if (!keyframes || keyframes.length < 2) return;
    const ease = easing || "power2.out";

    // Shorthand: "position" splits into x and y
    if (property === "position") {
      buildTweens(tl, target, "x", keyframes.map(k => ({ time: k.time, value: k.x || 0 })), easing, startOffset);
      buildTweens(tl, target, "y", keyframes.map(k => ({ time: k.time, value: k.y || 0 })), easing, startOffset);
      return;
    }

    for (let i = 0; i < keyframes.length - 1; i++) {
      const from = keyframes[i];
      const to   = keyframes[i + 1];
      const segDur = to.time - from.time;
      if (segDur <= 0) continue;
      const absStart = startOffset + from.time;
      // Use the declared easing only on the last segment; intermediate segments use linear
      const segEase = (i === keyframes.length - 2) ? ease : "none";
      tl.fromTo(target, { [property]: from.value }, { [property]: to.value, duration: segDur, ease: segEase }, absStart);
    }
  }

  function applyAnimations(tl, target, animations, layerStart) {
    if (!animations || !animations.length) return;
    animations.forEach(anim => {
      if (!anim.keyframes || !anim.property) return;
      buildTweens(tl, target, anim.property, anim.keyframes, anim.easing, layerStart);
    });
  }

  return { buildTweens, applyAnimations };
})();
