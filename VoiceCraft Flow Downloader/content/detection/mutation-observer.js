// content/detection/mutation-observer.js

class MediaMutationObserver {
  constructor(detector) {
    this.detector = detector;
    this.observer = null;
  }

  start() {
    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => {
      let shouldScan = false;

      for (let mutation of mutations) {
        if (mutation.type === 'childList') {
          mutation.addedNodes.forEach(node => {
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
