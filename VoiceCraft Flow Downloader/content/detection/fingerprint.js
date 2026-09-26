// content/detection/fingerprint.js

class MediaFingerprint {
  /**
   * Generates a unique fingerprint for a media element
   * normalized URL + media type + dimensions
   */
  static generate(url, type, width, height, title) {
    const dim = width && height ? `${width}x${height}` : 'unknown';
    
    // For VIDEOS, we aggressively deduplicate by title to merge DOM blobs with Network MP4s
    if (type === 'video' && title && title.length > 3) {
       return `vid|${title}|${dim}`;
    }
    
    // For IMAGES, we must ensure every generation is unique so the Automator doesn't stall
    // when the user runs the same prompt multiple times. Blob URLs and Data URLs are unique.
    const cleanUrl = this.normalizeUrl(url);
    // Ignore dimensions for images to prevent duplicates when DOM node resizes during load
    return `${cleanUrl}|${type}`;
  }

  static normalizeUrl(url) {
    if (!url) return '';
    try {
      if (url.startsWith('blob:')) {
        return url; 
      }
      
      const parsedUrl = new URL(url);
      
      // Strip query parameters to prevent cache-busters from creating duplicates
      parsedUrl.search = ''; 
      
      let finalStr = parsedUrl.toString();
      
      // Strip Google FIFE sizing parameters (e.g. =w1024-h1024)
      if (finalStr.includes('googleusercontent.com') && finalStr.includes('=')) {
          finalStr = finalStr.split('=')[0];
      }
      
      return finalStr;
    } catch (e) {
      return url;
    }
  }
}

window.MediaFingerprint = MediaFingerprint;
