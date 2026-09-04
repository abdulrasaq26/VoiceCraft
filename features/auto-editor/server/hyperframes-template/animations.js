window.CompositionAnimations = {
  apply(timeline, target, animations, startTime) {
    if (!animations || !animations.length) return;

    animations.forEach(anim => {
      const { property, from, to, duration, delay = 0, easing = "linear" } = anim;
      
      const vars = {
        ease: easing,
        duration: duration,
      };

      if (to !== undefined) vars[property] = to;

      if (from !== undefined) {
        // fromTo
        const fromVars = { [property]: from };
        timeline.fromTo(target, fromVars, vars, startTime + delay);
      } else {
        // to
        timeline.to(target, vars, startTime + delay);
      }
    });
  }
};
