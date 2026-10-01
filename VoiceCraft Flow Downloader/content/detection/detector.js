// content/detection/detector.js

// Finds media in the page and hands it to the shared registry
// (content/detection/media-registry.js), which de-duplicates it and keeps it.
// Elements are processed every time they're seen, so a name Flow renders
// after the picture still reaches the registry.
class DOMDetector {
  constructor() {
    this.registry = window.FlowMediaRegistry;
  }

  // Kept for callers; the registry is per Flow project and never forgets.
  reset() {}

  scan() {
    const queryDeep = (selector, root = document) => {
      let results = Array.from(root.querySelectorAll(selector));
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.shadowRoot && !/^(fmd-|flow-media-downloader-host)/.test(node.id || '')) { // not our own panels
          results = results.concat(queryDeep(selector, node.shadowRoot));
        }
      }
      return results;
    };

    const images = queryDeep('img');
    const videos = queryDeep('video');
    const divs = queryDeep('div, a, span');

    images.forEach(img => this.processElement(img));
    videos.forEach(video => this.processElement(video));
    
    // Extract background images
    divs.forEach(div => {
        const style = window.getComputedStyle(div);
        if (style.backgroundImage && style.backgroundImage !== 'none') {
            const match = style.backgroundImage.match(/url\(['"]?([^'"]+)['"]?\)/i);
            if (match && match[1]) {
                const url = match[1];
                if (!url.startsWith('data:')) { // skip inline
                    const virtualImg = document.createElement('img');
                    virtualImg.src = url;
                    virtualImg.__fmdHost = div; // names and ids come from the real tile
                    const rect = div.getBoundingClientRect();
                    Object.defineProperty(virtualImg, 'clientWidth', { value: rect.width });
                    Object.defineProperty(virtualImg, 'clientHeight', { value: rect.height });
                    virtualImg.dataset.fmdOriginalY = window.scrollY + rect.top;
                    this.processElement(virtualImg);
                }
            }
        }
    });
  }

  processElement(element) {
    if (window.FlowAdapter && window.FlowAdapter.shouldIgnore(element)) {
      return;
    }

    const normalized = window.MediaNormalizer.normalize(element);
    if (normalized) this.registry.ingest(normalized);
  }
}

window.DOMDetector = DOMDetector;
