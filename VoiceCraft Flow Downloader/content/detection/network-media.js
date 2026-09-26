// content/detection/network-media.js

class NetworkMediaListener {
  constructor(detector) {
    this.detector = detector;
  }

  start() {
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.action === 'networkMediaDetected') {
        this.handleNetworkMedia(message.media);
      }
    });
  }

  async handleNetworkMedia(media) {
    // FlowAdapter check for network media
    if (window.FlowAdapter && window.FlowAdapter.shouldIgnoreNetworkMedia) {
      if (window.FlowAdapter.shouldIgnoreNetworkMedia(media)) {
        return;
      }
    }

    // Network media lacks DOM dimensions. We can optionally fetch dimensions 
    // by loading it into an Image object silently, or just assume it's valid.
    // For V2, we assume anything that passed the background size filter is good.
    const width = 0; 
    const height = 0;

    const title = window.lastDetectedFlowTitle || null;
    const fingerprint = window.MediaFingerprint.generate(media.url, media.type, width, height, title);
    
    // Check deduplication
    if (this.detector.detectedFingerprints.has(fingerprint)) {
      return;
    }
    
    this.detector.detectedFingerprints.add(fingerprint);

    const normalized = {
      id: `media_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      type: media.type,
      url: media.url,
      thumbnail: media.type === 'video' ? null : media.url,
      width: width,
      height: height,
      status: 'selected', // auto-select
      fingerprint: fingerprint,
      title: title,
      element: null, // No DOM element
      isNetwork: true
    };

    if (this.detector.onMediaDetected) {
      this.detector.onMediaDetected(normalized);
    }
  }
}

window.NetworkMediaListener = NetworkMediaListener;
