/**
 * LayerEngine - Phase 5 Motion-Graphics Runtime
 *
 * Iterates spec.layers, routes each layer to the correct engine,
 * manages z-index ordering, preloads assets.
 *
 * Layer types: "visual", "text", "lower-third"
 * Future:      "overlay", "effect", "canvas", "webgl"
 */
window.LayerEngine = (function () {

  // Track previously built visual elements for push transitions
  let _builtLayers = {};

  /**
   * Preload all assets declared in spec.assets.
   * Returns a map: assetId -> { type, element|src }
   */
  async function preloadAssets(assets) {
    const map = {};
    const promises = (assets || []).map(asset => {
      return new Promise(resolve => {
        if (asset.type === "image") {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => { map[asset.id] = { type: "image", element: img }; resolve(); };
          img.onerror = () => { console.warn("Asset load failed:", asset.id); resolve(); };
          img.src = asset.src || `./${asset.filename}`;
        } else if (asset.type === "video") {
          const vid = document.createElement("video");
          vid.crossOrigin = "anonymous";
          vid.muted = true;
          vid.playsInline = true;
          vid.onloadeddata = () => { map[asset.id] = { type: "video", element: vid }; resolve(); };
          vid.onerror = () => { resolve(); };
          vid.src = asset.src || `./${asset.filename}`;
          vid.load();
        } else if (asset.type === "audio") {
          map[asset.id] = { type: "audio", src: asset.src || `./${asset.filename}` };
          resolve();
        } else {
          resolve();
        }
      });
    });
    await Promise.all(promises);
    return map;
  }

  /**
   * Build a visual (image/video) clip element.
   */
  function buildVisualLayer(tl, viewport, layer, assetMap, zIndex) {
    const asset = assetMap[layer.assetId];
    const container = document.createElement("div");
    container.id = layer.id;
    container.className = "vc-layer vc-layer--visual";
    container.style.zIndex = zIndex;
    gsap.set(container, { opacity: 0 });

    if (asset) {
      if (asset.type === "image") {
        const img = asset.element.cloneNode(true);
        img.className = "vc-media";
        container.appendChild(img);
      } else if (asset.type === "video") {
        const vid = asset.element.cloneNode(true);
        vid.className = "vc-media";
        vid.muted = true;
        // Scrub video playhead via GSAP
        tl.fromTo(vid, { currentTime: 0 },
          { currentTime: layer.duration, duration: layer.duration, ease: "none" },
          layer.start
        );
        container.appendChild(vid);
      }
    }

    viewport.appendChild(container);

    // Visibility window
    tl.set(container, { opacity: 1 }, layer.start);
    tl.set(container, { opacity: 0 }, layer.start + layer.duration);

    // Find previous visual layer element for push transitions
    const prevEl = _builtLayers[`prev_visual`] || null;
    _builtLayers[`prev_visual`] = container;

    // Transitions
    TransitionEngine.applyIn(tl, container, layer.transitionIn, layer.start, prevEl);
    TransitionEngine.applyOut(tl, container, layer.transitionOut, layer.start + layer.duration);

    // Animations (presets + keyframes)
    if (layer.animations && layer.animations.length) {
      AnimationEngine.applyAnimations(tl, container, layer.animations, layer.start, layer.duration);
    }

    // Effects
    if (layer.effects && layer.effects.length) {
      EffectEngine.applyEffects(tl, container, layer.effects, layer.start, layer.duration);
    }

    return container;
  }

  /**
   * Build the entire layer stack from spec.layers.
   *
   * @param {gsap.core.Timeline} tl
   * @param {Element}            viewport
   * @param {Object}             spec       - Composition JSON v2
   * @param {Object}             assetMap   - from preloadAssets()
   * @returns {gsap.core.Timeline}
   */
  function buildLayers(tl, viewport, spec, assetMap) {
    _builtLayers = {};

    // Overlay container for text / lower-thirds (above visual)
    const overlayContainer = document.createElement("div");
    overlayContainer.className = "vc-overlay-container";
    viewport.appendChild(overlayContainer);

    (spec.layers || []).forEach((layer, i) => {
      const zIndex = layer.zIndex != null ? layer.zIndex : i;

      switch (layer.type) {
        case "visual":
          buildVisualLayer(tl, viewport, layer, assetMap, zIndex);
          break;

        case "text":
          TypographyEngine.createTextLayer(tl, overlayContainer, layer, layer.start, layer.duration);
          break;

        case "lower-third":
          LowerThirdEngine.createLowerThird(tl, overlayContainer, layer, layer.start, layer.duration);
          break;

        // future: canvas, webgl, svg, effect
        default:
          console.warn(`LayerEngine: unknown layer type "${layer.type}" (id: ${layer.id})`);
      }
    });

    // Anchor timeline duration
    tl.set({}, {}, spec.project.duration);
    return tl;
  }

  return { preloadAssets, buildLayers };
})();
