window.CompositionTransitions = {
  applyIn(timeline, target, transition, startTime) {
    if (!transition) {
      // default cut in
      timeline.set(target, { opacity: 1 }, startTime);
      return;
    }

    const { type, duration = 0.5 } = transition;
    
    // ensure visible
    timeline.set(target, { opacity: 1 }, startTime);

    if (type === 'fade' || type === 'crossfade') {
      timeline.fromTo(target, { opacity: 0 }, { opacity: 1, duration, ease: "linear" }, startTime);
    } else if (type === 'slide-left') {
      timeline.fromTo(target, { x: "100%" }, { x: "0%", duration, ease: "power2.out" }, startTime);
    } else if (type === 'zoom') {
      timeline.fromTo(target, { scale: 0.5, opacity: 0 }, { scale: 1, opacity: 1, duration, ease: "back.out(1.5)" }, startTime);
    } else {
      // default fallback cut
    }
  },

  applyOut(timeline, target, transition, endTime) {
    if (!transition) {
      // default cut out
      timeline.set(target, { opacity: 0 }, endTime);
      return;
    }

    const { type, duration = 0.5 } = transition;
    const startTime = endTime - duration;

    if (type === 'fade' || type === 'crossfade') {
      timeline.to(target, { opacity: 0, duration, ease: "linear" }, startTime);
    } else if (type === 'slide-left') {
      timeline.to(target, { x: "-100%", duration, ease: "power2.in" }, startTime);
    } else if (type === 'zoom') {
      timeline.to(target, { scale: 1.5, opacity: 0, duration, ease: "power2.in" }, startTime);
    } else {
      timeline.set(target, { opacity: 0 }, endTime);
    }
  }
};
