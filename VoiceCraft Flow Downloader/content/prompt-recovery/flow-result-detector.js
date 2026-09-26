class FlowResultDetector {
  /**
   * Scans the page (via FlowTray) for generated assets
   * Returns an array of clean titles/names.
   */
  static getDetectedAssets() {
      const assets = [];
      if (!window.FlowTray) return assets;
      
      window.FlowTray.mediaItems.forEach(item => {
          if (item.data && item.data.title) {
              assets.push({
                  title: item.data.title,
                  cleanName: window.NameNormalizer ? window.NameNormalizer.normalize(item.data.title) : item.data.title.replace(/[\/\\?%*:|"<> \n\r]/g, '-').replace(/--+/g, '-')
              });
          }
      });
      return assets;
  }
}
window.FlowResultDetector = FlowResultDetector;
