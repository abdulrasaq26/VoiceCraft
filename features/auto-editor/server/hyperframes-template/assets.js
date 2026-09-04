window.CompositionAssets = {
  assetsMap: {},

  async preload(assetsArray) {
    const promises = assetsArray.map(asset => {
      return new Promise((resolve, reject) => {
        if (asset.type === 'image') {
          const img = new Image();
          img.crossOrigin = "anonymous";
          img.onload = () => {
            this.assetsMap[asset.id] = { type: 'image', element: img };
            resolve();
          };
          img.onerror = () => {
            console.warn("Failed to load image:", asset.src);
            // resolve anyway to avoid breaking render
            resolve();
          };
          img.src = asset.src;
        } else if (asset.type === 'video') {
          const vid = document.createElement('video');
          vid.crossOrigin = "anonymous";
          vid.muted = true;
          vid.playsInline = true;
          // In hyperframes, video playback must be seeked precisely.
          // But usually we just put the video in the DOM and hyperframes orchestrator
          // can manage it, OR we seek it manually in renderHyperFrame.
          vid.onloadeddata = () => {
            this.assetsMap[asset.id] = { type: 'video', element: vid };
            resolve();
          };
          vid.onerror = () => {
            resolve();
          };
          vid.src = asset.src;
          vid.load();
        } else if (asset.type === 'audio') {
          // audio is typically handled by the bundler/assembler, but we can register it
          this.assetsMap[asset.id] = { type: 'audio', src: asset.src };
          resolve();
        } else {
          resolve();
        }
      });
    });

    await Promise.all(promises);
  },

  get(id) {
    return this.assetsMap[id];
  }
};
