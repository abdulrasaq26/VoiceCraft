// content/detection/flow-adapter.js

class FlowAdapter {
  static shouldIgnore(element) {
    // V1 heuristic: ignore very small images (likely UI icons)
    const tagName = element.tagName.toLowerCase();
    
    if (tagName === 'img') {
      const width = element.naturalWidth || element.width || element.clientWidth;
      const height = element.naturalHeight || element.height || element.clientHeight;
      
      // If dimensions are known and very small (UI icons), ignore
      if (width > 0 && width < 100 && height > 0 && height < 100) {
        return true; 
      }

      // Ignore tracking pixels or empty images
      if (width === 1 && height === 1) {
        return true;
      }
    }

    return false;
  }

  static shouldIgnoreNetworkMedia(media) {
    // Media from network observer
    // Ignore small files (handled mostly by background, but double check)
    if (media.size > 0 && media.size < 10240) {
      return true;
    }
    
    // Ignore common tracking/UI or API endpoints that duplicate DOM blobs
    const url = media.url.toLowerCase();
    if (url.includes('google-analytics') || url.includes('favicon') || url.includes('/api/')) {
      return true;
    }

    return false;
  }

  static getTitle(element) {
    const isGeneric = (text) => {
        if (!text) return true;
        const lower = text.toLowerCase();
        
        const uiTerms = [
            'image', 'media', 'generated image', 'share', 'download', 'edit', 
            'delete', 'copy', 'more', 'options', 'menu', 'close', 'favorite', 
            'like', 'save', 'open', 'expand', 'settings', 'details', 'info',
            'view', 'prompt', 'generate', 'create', 'refresh', 'retry', 'cancel',
            'see all', 'something went wrong', 'error', 'failed', 'retry'
        ];
        
        if (uiTerms.includes(lower)) return true;
        
        if (lower.startsWith('option')) return true;
        if (lower.startsWith('see all')) return true;
        if (lower.startsWith('something went')) return true;
        
        return lower.includes('tile displaying') || 
               lower.includes('user\'s image') || 
               lower.includes('google flow can make mistakes') ||
               lower.includes('double check it') ||
               lower.length < 2;
    };

    // Attempt to extract a meaningful name from the DOM
    if (element.alt && !isGeneric(element.alt)) {
      return element.alt.trim();
    }
    
    if (element.getAttribute('aria-label') && !isGeneric(element.getAttribute('aria-label'))) {
      return element.getAttribute('aria-label').trim();
    }
    
    if (element.title && !isGeneric(element.title)) {
      return element.title.trim();
    }

    // Try to find Flow's native download button in the same container
    try {
      const container = element.closest('div');
      if (container) {
          // Look for any anchor with a download attribute
          const downloadBtn = container.querySelector('a[download]');
          if (downloadBtn && downloadBtn.getAttribute('download')) {
              const dlName = downloadBtn.getAttribute('download');
              // Strip extension if present to just get the title
              return dlName.replace(/\.[^/.]+$/, "");
          }
      }
    } catch (e) {}

    // Try finding text in nearby sibling or parent (aggressive)
    try {
      let current = element.parentElement;
      for (let i = 0; i < 8; i++) { // search up 8 levels
        if (!current) break;
        
        const textElements = current.querySelectorAll('span, p, h1, h2, h3, h4');
        for (const el of textElements) {
           const text = el.textContent.trim();
           if (text.length >= 2 && text.length < 200 && !isGeneric(text)) {
              return text;
           }
        }
        
        const inner = current.innerText;
        if (inner) {
           const lines = inner.split('\n');
           for (const line of lines) {
              const clean = line.trim();
              if (clean.length >= 2 && clean.length < 200 && !isGeneric(clean)) return clean;
           }
        }

        current = current.parentElement;
      }
    } catch (e) {}

    return null;
  }
}

window.FlowAdapter = FlowAdapter;
