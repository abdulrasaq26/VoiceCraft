// content/detection/detector.js

class DOMDetector {
  constructor(onMediaDetected) {
    this.onMediaDetected = onMediaDetected; // Callback when new media is found
    this.detectedFingerprints = new Set();
  }

  reset() {
    this.detectedFingerprints.clear();
  }

  scan() {
    const queryDeep = (selector, root = document) => {
      let results = Array.from(root.querySelectorAll(selector));
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.shadowRoot) {
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
    
    if (normalized) {
      if (!this.detectedFingerprints.has(normalized.fingerprint)) {
        this.detectedFingerprints.add(normalized.fingerprint);
        
        normalized.status = 'selected'; 
        
        if (this.onMediaDetected) {
          this.onMediaDetected(normalized);
        }
      }
    }
  }
}

window.DOMDetector = DOMDetector;
