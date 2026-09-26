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

  // Initialize V3 Automator Engine
  const queueManager = new window.QueueManager();
  queueManager.loadFromStorage();
  
  const automatorAdapter = new window.FlowAutomatorAdapter();
  const flowDriver = new window.FlowDriver(queueManager, automatorAdapter);
  const assetMatcher = new window.AssetMatcher(queueManager);
  const automatorPanel = new window.AutomatorPanel(queueManager, automatorAdapter);

  if (window.AutomatorEvents) {
    window.AutomatorEvents.on('ASSET_MATCHED', async (eventData) => {
      const { job, media } = eventData;
      
      // Auto-resolve to PNG/MP4
      const resolvedMedia = await window.MediaResolver.resolve(media);
      resolvedMedia.status = 'downloading';
      
      job.status = 'downloading';
      window.AutomatorEvents.emit('DOWNLOAD_STARTED', job);
      
      chrome.runtime.sendMessage({
        action: 'download',
        mediaItem: resolvedMedia,
        tabId: null // Handled dynamically
      });
    });

    window.AutomatorEvents.on('JOB_FAILED', (job) => {
        queueManager.saveToStorage();
        if (queueManager.isRunning) {
            queueManager.processNext();
        }
    });
  }

  // Listen for messages from popup
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === 'toggle_automator') {
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
      
      // Also notify Automator if active
      if (window.AutomatorEvents && message.status === 'downloaded') {
        // We find the job that has this asset
        const job = queueManager.jobs.find(j => j.assets && j.assets.some(a => a.id === message.mediaId));
        if (job) {
          job.status = 'completed';
          window.AutomatorEvents.emit('JOB_COMPLETED', job);
          queueManager.saveToStorage();
          queueManager.processNext(); // Loop to next job!
        }
      } else if (window.AutomatorEvents && message.status === 'error') {
        const job = queueManager.jobs.find(j => j.assets && j.assets.some(a => a.id === message.mediaId));
        if (job) {
          job.status = 'error';
          window.AutomatorEvents.emit('JOB_FAILED', job);
        }
      }
    }
  });

})();
