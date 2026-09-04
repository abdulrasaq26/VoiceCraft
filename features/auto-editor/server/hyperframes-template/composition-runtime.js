/**
 * CompositionRuntime - Phase 5 Motion-Graphics Runtime
 *
 * Top-level facade. The only public API consumed by index.html and HyperFrames.
 *
 * API:
 *   await CompositionRuntime.init(spec)  - load assets, build GSAP timeline
 *   CompositionRuntime.seek(t)           - scrub to time t (used by HyperFrames)
 *   CompositionRuntime.timeline          - the underlying GSAP timeline
 *
 * Schema validation: checks spec.schemaVersion === 2
 * Fallback:          accepts v1 (tracks-based) spec and up-converts it
 */
window.CompositionRuntime = (function () {

  let _timeline = null;

  // ---- Schema Up-Converter (v1 → v2) ----
  function upConvertV1(spec) {
    // v1 uses spec.tracks[].clips; v2 uses spec.layers[]
    if (spec.schemaVersion >= 2 || spec.layers) return spec;

    console.warn("CompositionRuntime: up-converting Composition JSON v1 → v2");
    const layers = [];
    (spec.tracks || []).forEach(track => {
      (track.clips || []).forEach(clip => {
        if (track.type === "visual") {
          layers.push({
            id:          clip.id,
            type:        "visual",
            assetId:     clip.assetId,
            start:       clip.start,
            duration:    clip.duration,
            animations:  (clip.animations || []).map(a => {
              // v1 used property/from/to; convert to keyframes
              if (a.keyframes) return a;
              return {
                property: a.property,
                keyframes: [
                  { time: 0,           value: a.from != null ? a.from : 1 },
                  { time: clip.duration, value: a.to   != null ? a.to   : 1 },
                ],
                easing: a.easing || "power2.out",
              };
            }),
            effects:     clip.effects || [],
            transitionIn:  clip.transitionIn  || null,
            transitionOut: clip.transitionOut || null,
          });
        } else if (track.type === "text") {
          (track.clips || []).forEach(c => {
            layers.push({
              id:       c.id,
              type:     "text",
              start:    c.start,
              duration: c.duration,
              typography: {
                text:   c.text || "",
                preset: (c.typography && c.typography.style) || "fade-up",
                size:   (c.typography && c.typography.size)  || "lg",
                color:  "#FFFFFF",
                background: "none",
                position: "bottom",
              },
              animations: c.animations || [],
            });
          });
        }
      });
    });

    return {
      schemaVersion: 2,
      project: spec.project,
      assets:  spec.assets,
      layers,
      audio:   spec.audio || [],
    };
  }

  // ---- Init ----

  async function init(rawSpec) {
    const spec = upConvertV1(rawSpec);

    if (spec.schemaVersion !== 2) {
      console.warn(`CompositionRuntime: unexpected schemaVersion "${spec.schemaVersion}". Attempting to render anyway.`);
    }

    // Set viewport dimensions
    const viewport = document.getElementById("vc-viewport");
    if (viewport) {
      viewport.style.width  = `${spec.project.width}px`;
      viewport.style.height = `${spec.project.height}px`;
    }

    // Preload all assets
    const assetMap = await LayerEngine.preloadAssets(spec.assets);

    // Build master GSAP timeline (paused — HyperFrames scrubs it manually)
    _timeline = gsap.timeline({ paused: true });

    // Build all layers
    LayerEngine.buildLayers(_timeline, viewport, spec, assetMap);

    console.log(
      `CompositionRuntime ready. Duration: ${spec.project.duration}s | Layers: ${(spec.layers || []).length}`
    );
    return _timeline;
  }

  // ---- Seek (called by HyperFrames every frame) ----

  function seek(timeSeconds) {
    if (_timeline) _timeline.seek(timeSeconds, false);
  }

  return {
    init,
    seek,
    get timeline() { return _timeline; },
  };
})();
