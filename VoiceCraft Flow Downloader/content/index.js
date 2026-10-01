// content/index.js

(function() {
  // Prevent multiple injections
  if (window.FlowMediaDownloaderInitialized) return;
  window.FlowMediaDownloaderInitialized = true;

  console.log('Flow Media Downloader: Content script loaded');

  const tray = new window.MediaTray();
  window.FlowTray = tray; // Expose globally for the Generation Reconciler
  
  const detector = new window.DOMDetector((mediaData) => {
    tray.addMedia(mediaData);
    if (window.AutomatorEvents) {
      window.AutomatorEvents.emit('ASSET_DETECTED', mediaData);
    }
  });
  window.FlowDetector = detector;

  const mutationObserver = new window.MediaMutationObserver(detector);
  mutationObserver.start(); // ALWAYS START FOR AUTOMATOR
  
  const networkListener = new window.NetworkMediaListener(detector);
  networkListener.start();
  
  const flowCrawler = new window.FlowCrawler(detector, tray);
  window.FlowCrawlerInstance = flowCrawler;

  // VoiceCraft Automator: queue prompts and generate them in Flow.
  const automatorEngine = new window.VCAutomatorEngine(new window.VCFlowApi());
  const automatorPanel = new window.AutomatorPanel(automatorEngine);
  window.VCAutomator = automatorEngine;
  window.FlowAutomatorPanel = automatorPanel; // for the VoiceCraft toolbar's panel toggles

  // Listen for messages from popup (and, inside VoiceCraft Studio, from the
  // browser toolbar via content/host-bridge.js).
  const handleExtensionMessage = (message, sender, sendResponse) => {
    if (message.action === 'studio-project') {
      automatorEngine.setStudioProject(message.project || null);
      sendResponse({ status: 'ok' });
    } else if (message.action === 'toggle_automator') {
      automatorPanel.toggle();
      sendResponse({ status: 'toggled' });
    } else if (message.action === 'toggle_recovery') {
      if (!window.promptRecoveryUI) {
          window.promptRecoveryUI = new window.PromptRecoveryUI();
      }
      // Toggle logic
      if (window.promptRecoveryUI.container.style.display === 'flex') {
          window.promptRecoveryUI.hide();
      } else {
          window.promptRecoveryUI.show();
      }
      sendResponse({ status: 'toggled' });
    } else if (message.action === 'scan') {
      console.log('Flow Media Downloader: Scan requested');
      
      // Clear previous state (useful for Single Page Apps like Google Flow)
      detector.reset();
      tray.clearAll();

      // Perform DOM scan
      detector.scan();
      
      // Start watching for new media
      mutationObserver.start();
      
      // Ensure tray is visible
      tray.show();
      
      sendResponse({ status: 'started' });
    } else if (message.action === 'downloadProgress') {
      const item = tray.mediaItems.get(message.mediaId);
      if (item) {
        item.data.status = message.status;
        item.data.progress = message.progress; // e.g. 100 for complete
        item.ui.updateSelectionState(); // update visual
        tray.updateFooter();
      }
      
      // The Automator waits on its own downloads.
      automatorEngine.onDownloadProgress(message);
    }
  };
  chrome.runtime.onMessage.addListener(handleExtensionMessage);
  window.__vcDispatchExtensionMessage = handleExtensionMessage;

})();
