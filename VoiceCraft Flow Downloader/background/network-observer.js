// background/network-observer.js

class NetworkObserver {
  constructor() {
    this.isObserving = false;
    this.seenUrls = new Set();
  }

  start() {
    if (this.isObserving) return;
    
    if (!chrome.webRequest || !chrome.webRequest.onCompleted) {
       console.warn("Flow Media Downloader: webRequest API not available.");
       return;
    }

    try {
      // We listen to all URLs, but filter strictly
      chrome.webRequest.onCompleted.addListener(
        this.handleRequest.bind(this),
        { urls: ["<all_urls>"] },
        ["responseHeaders"]
      );
      this.isObserving = true;
      console.log("Flow Media Downloader: Network Observer started.");
    } catch (e) {
      console.error("Flow Media Downloader: Failed to attach network observer:", e);
    }
  }

  handleRequest(details) {
    // Only care about images and media (video/audio)
    if (details.type !== 'image' && details.type !== 'media') {
      return;
    }

    // Ignore very small files if Content-Length is available
    // Flow generated assets are typically > 100KB. We'll ignore < 10KB.
    const contentLengthHeader = details.responseHeaders?.find(h => h.name.toLowerCase() === 'content-length');
    if (contentLengthHeader) {
      const size = parseInt(contentLengthHeader.value, 10);
      if (size < 10240) return; // Ignore < 10KB
    }

    // Filter out common tracking/UI garbage
    const url = details.url.toLowerCase();
    if (url.includes('google-analytics.com') || 
        url.includes('fonts.googleapis.com') || 
        url.includes('favicon') ||
        url.includes('avatar') ||
        url.includes('profile')) {
      return;
    }

    // Deduplicate at network level (session only)
    if (this.seenUrls.has(details.url)) return;
    this.seenUrls.add(details.url);

    // Send the detected URL to the active tab's content script
    // We only send it to the tab that initiated the request if possible
    if (details.tabId > 0) {
      chrome.tabs.sendMessage(details.tabId, {
        action: 'networkMediaDetected',
        media: {
          url: details.url,
          type: details.type === 'media' ? 'video' : 'image',
          mimeType: this.extractMimeType(details.responseHeaders),
          size: contentLengthHeader ? parseInt(contentLengthHeader.value, 10) : 0
        }
      }, () => {
        // Ignore errors if the content script is not injected
        if (chrome.runtime.lastError) {
          // ignore silently
        }
      });
    }
  }

  extractMimeType(headers) {
    if (!headers) return null;
    const ct = headers.find(h => h.name.toLowerCase() === 'content-type');
    return ct ? ct.value.split(';')[0] : null;
  }
}

// In Manifest V3 with standard scripts, we instantiate it directly
try {
  self.NetworkObserver = new NetworkObserver();
  self.NetworkObserver.start();
} catch (err) {
  console.error("Failed to start NetworkObserver:", err);
}
