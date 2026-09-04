window.AutoEditorComposition = {
  timeline: null,
  
  async init(spec) {
    // Set project dimensions
    const viewport = document.getElementById('viewport');
    viewport.style.width = `${spec.project.width}px`;
    viewport.style.height = `${spec.project.height}px`;

    // Preload assets
    await CompositionAssets.preload(spec.assets);

    // Build timeline
    this.timeline = CompositionTimeline.build(spec);
    
    console.log("Composition ready. Duration:", spec.project.duration);
  },

  seek(timeSeconds) {
    if (this.timeline) {
      this.timeline.seek(timeSeconds);
    }
  }
};
