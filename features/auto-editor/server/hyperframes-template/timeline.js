window.CompositionTimeline = {
  build(spec) {
    // We use GSAP timeline paused because HyperFrames will scrub it manually
    const mainTimeline = gsap.timeline({ paused: true });

    // Track 0: Visuals
    const visualTrack = spec.tracks.find(t => t.type === 'visual');
    if (visualTrack) {
      const visualLayer = document.getElementById('visual-track');
      
      visualTrack.clips.forEach(clip => {
        const container = document.createElement('div');
        container.className = 'clip-container';
        container.id = clip.id;

        const asset = CompositionAssets.get(clip.assetId);
        if (asset) {
          if (asset.type === 'image') {
            const img = asset.element.cloneNode(true);
            img.className = 'clip-media';
            container.appendChild(img);
          } else if (asset.type === 'video') {
            const vid = asset.element.cloneNode(true);
            vid.className = 'clip-media';
            // Setup GSAP to scrub video time
            mainTimeline.fromTo(vid, 
              { currentTime: 0 }, 
              { currentTime: clip.duration, duration: clip.duration, ease: "none" }, 
              clip.start
            );
            container.appendChild(vid);
          }
        }

        visualLayer.appendChild(container);

        // Ensure visible only during clip time
        mainTimeline.set(container, { opacity: 1 }, clip.start);
        mainTimeline.set(container, { opacity: 0 }, clip.start + clip.duration);

        // Transition IN
        CompositionTransitions.applyIn(mainTimeline, container, clip.transitionIn, clip.start);
        
        // Transition OUT
        CompositionTransitions.applyOut(mainTimeline, container, clip.transitionOut, clip.start + clip.duration);

        // Animations (inside container, maybe animate media directly or container)
        // For now animate container
        CompositionAnimations.apply(mainTimeline, container, clip.animations, clip.start);
      });
    }

    // Track 1: Text
    const textTrack = spec.tracks.find(t => t.type === 'text');
    if (textTrack) {
      const textLayer = document.getElementById('text-track');
      
      textTrack.clips.forEach(clip => {
        const container = document.createElement('div');
        container.id = clip.id;
        
        CompositionTypography.apply(container, clip);
        textLayer.appendChild(container);

        // Ensure visible during clip time
        mainTimeline.set(container, { opacity: 1 }, clip.start);
        mainTimeline.set(container, { opacity: 0 }, clip.start + clip.duration);

        CompositionTransitions.applyIn(mainTimeline, container, clip.transitionIn, clip.start);
        CompositionTransitions.applyOut(mainTimeline, container, clip.transitionOut, clip.start + clip.duration);
        CompositionAnimations.apply(mainTimeline, container, clip.animations, clip.start);
      });
    }

    // Add empty tween to ensure timeline spans full duration
    mainTimeline.set({}, {}, spec.project.duration);

    return mainTimeline;
  }
};
