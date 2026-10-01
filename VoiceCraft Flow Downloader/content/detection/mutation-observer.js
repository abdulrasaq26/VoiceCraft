// content/detection/mutation-observer.js

class MediaMutationObserver {
  constructor(detector) {
    this.detector = detector;
    this.observer = null;
    this.pendingTiles = new Set();
    this.tileTimer = null;
  }

  // Text that appears or changes next to a picture (Flow renders a result's
  // name after its image) sends that tile's media back through detection, so
  // the registry learns the name. Batched per animation frame.
  recheckAround(node) {
    let el = node && (node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement);
    for (let i = 0; el && i < 6; i++, el = el.parentElement) {
      const media = el.querySelectorAll('img, video');
      if (media.length > 3) return; // reached the grid: not one tile
      if (media.length) { this.pendingTiles.add(el); break; }
    }
    if (this.pendingTiles.size && !this.tileTimer) {
      // A timer, not requestAnimationFrame: background tabs (the Automator runs
      // Flow in one) never paint, so frames never come.
      this.tileTimer = setTimeout(() => {
        this.tileTimer = null;
        const tiles = [...this.pendingTiles];
        this.pendingTiles.clear();
        for (const t of tiles) {
          if (!t.isConnected) continue;
          t.querySelectorAll('img, video').forEach((m) => this.detector.processElement(m));
        }
      }, 40);
    }
  }

  start() {
    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      let shouldScan = false;

      for (let mutation of mutations) {
        if (mutation.type === 'characterData') {
          this.recheckAround(mutation.target);
        } else if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
            if (node.nodeType === Node.TEXT_NODE || (node.nodeType === Node.ELEMENT_NODE && node.tagName !== 'IMG' && node.tagName !== 'VIDEO' && !node.querySelector('img, video'))) {
              this.recheckAround(node);
            }
            // Check if node is an element
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Direct match
              if (node.tagName === 'IMG' || node.tagName === 'VIDEO') {
                this.detector.processElement(node);
              }
              // Nested match
              else {
                const imgs = node.querySelectorAll('img');
                const videos = node.querySelectorAll('video');
                const divs = node.querySelectorAll('div, a, span');
                imgs.forEach(img => this.detector.processElement(img));
                videos.forEach(video => this.detector.processElement(video));

                divs.forEach(div => {
                    const style = window.getComputedStyle(div);
                    if (style.backgroundImage && style.backgroundImage !== 'none') {
                        const match = style.backgroundImage.match(/url\(['"]?([^'"]+)['"]?\)/i);
                        if (match && match[1] && !match[1].startsWith('data:')) {
                            const virtualImg = document.createElement('img');
                            virtualImg.src = match[1];
                            virtualImg.__fmdHost = div;
                            const rect = div.getBoundingClientRect();
                            Object.defineProperty(virtualImg, 'clientWidth', { value: rect.width });
                            Object.defineProperty(virtualImg, 'clientHeight', { value: rect.height });
                            this.detector.processElement(virtualImg);
                        }
                    }
                });
              }
            }
          });
        } else if (mutation.type === 'attributes') {
          // If an existing image changes its src or a div changes its background-image
          const target = mutation.target;
          if (target.tagName === 'IMG' || target.tagName === 'VIDEO') {
            this.detector.processElement(target);
          } else if (target.tagName === 'DIV' || target.tagName === 'SPAN' || target.tagName === 'A') {
            const style = window.getComputedStyle(target);
            if (style.backgroundImage && style.backgroundImage !== 'none') {
                const match = style.backgroundImage.match(/url\(['"]?([^'"]+)['"]?\)/i);
                if (match && match[1] && !match[1].startsWith('data:')) {
                    const virtualImg = document.createElement('img');
                    virtualImg.src = match[1];
                    virtualImg.__fmdHost = target;
                    const rect = target.getBoundingClientRect();
                    Object.defineProperty(virtualImg, 'clientWidth', { value: rect.width });
                    Object.defineProperty(virtualImg, 'clientHeight', { value: rect.height });
                    this.detector.processElement(virtualImg);
                }
            }
          }
        }
      }
    });

    this.observer.observe(document.body, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ['src', 'srcset', 'currentSrc', 'style', 'class']
    });
  }

  stop() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }
}

window.MediaMutationObserver = MediaMutationObserver;
