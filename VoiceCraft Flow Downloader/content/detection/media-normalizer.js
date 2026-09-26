// content/detection/media-normalizer.js

class MediaNormalizer {
  static normalize(element) {
    if (!element) return null;

    const tagName = element.tagName.toLowerCase();
    
    if (tagName === 'img') {
      return this.normalizeImage(element);
    } else if (tagName === 'video') {
      return this.normalizeVideo(element);
    }
    
    return null;
  }

  static extractMetadata(el) {
    const metadata = {
        labels: [],
        containerText: ''
    };
    try {
        if (el.alt) metadata.labels.push(el.alt);
        if (el.title) metadata.labels.push(el.title);
        
        let parent = el.parentElement;
        let depth = 0;
        while (parent && depth < 3) {
            if (parent.getAttribute('aria-label')) metadata.labels.push(parent.getAttribute('aria-label'));
            if (parent.title) metadata.labels.push(parent.title);
            if (parent.textContent && parent.textContent.trim().length > 0 && parent.textContent.length < 200) {
                metadata.containerText = parent.textContent.trim();
            }
            parent = parent.parentElement;
            depth++;
        }
    } catch(e) {}
    return metadata;
  }

  static normalizeImage(img) {
    // Try to get the best resolution URL
    const url = img.currentSrc || img.src;
    if (!url) return null;
    
    // Skip tiny inline data for V1 unless it was specifically extracted from a Canvas
    if (url.startsWith('data:') && img.dataset.isCanvas !== 'true') return null; 

    const width = img.naturalWidth || img.width || img.clientWidth;
    const height = img.naturalHeight || img.height || img.clientHeight;

    const title = window.FlowAdapter ? window.FlowAdapter.getTitle(img) : null;
    
    if (title && title.length > 3) {
      window.lastDetectedFlowTitle = title;
    }

    const fingerprint = window.MediaFingerprint.generate(url, 'image', width, height, title);

    return {
      id: `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'image',
      url: url,
      thumbnail: url,
      width: width,
      height: height,
      status: 'detected',
      fingerprint: fingerprint,
      title: title,
      element: img,
      metadata: this.extractMetadata(img)
    };
  }

  static normalizeVideo(video) {
    const url = video.currentSrc || video.src;
    
    // Check for <source> elements if no direct src
    let finalUrl = url;
    if (!finalUrl) {
      const source = video.querySelector('source');
      if (source) {
        finalUrl = source.src;
      }
    }

    if (!finalUrl) return null;

    const width = video.videoWidth || video.width || video.clientWidth;
    const height = video.videoHeight || video.height || video.clientHeight;
    const duration = video.duration || 0;

    const title = window.FlowAdapter ? window.FlowAdapter.getTitle(video) : null;
    const fingerprint = window.MediaFingerprint.generate(finalUrl, 'video', width, height, title);

    return {
      id: `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: 'video',
      url: finalUrl,
      thumbnail: video.poster || null, // Might need canvas capture if no poster
      width: width,
      height: height,
      duration: duration,
      status: 'detected',
      fingerprint: fingerprint,
      title: title,
      element: video
    };
  }
}

window.MediaNormalizer = MediaNormalizer;
