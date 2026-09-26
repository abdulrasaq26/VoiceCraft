// content/automation/asset-matcher.js

class AssetMatcher {
  constructor(queueManager) {
    this.queueManager = queueManager;
    
    window.AutomatorEvents.on('JOB_SUBMITTED', this.captureBaseline.bind(this));
    window.AutomatorEvents.on('GENERATION_STARTED', this.startActivePolling.bind(this));
    window.AutomatorEvents.on('ASSET_DETECTED', this.handleAsset.bind(this));
  }

  captureBaseline(job) {
    // Collect all currently known image URLs from the deep DOM
    const queryDeep = (selector, root = document) => {
      let results = Array.from(root.querySelectorAll(selector));
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
      let node;
      while ((node = walker.nextNode())) {
        if (node.shadowRoot && node.id !== 'flow-media-downloader-host') {
          results = results.concat(queryDeep(selector, node.shadowRoot));
        }
      }
      return results;
    };
    
    const imgs = queryDeep('img');
    const videos = queryDeep('video');
    const divs = queryDeep('div, a, span');
    
    job.baselineUrls = new Set();
    job.baselineMaxY = 0;

    const addBaseline = (url, el) => {
        if (!url || url.startsWith('data:')) return;
        job.baselineUrls.add(url);
        if (el) {
            try {
                const rect = el.getBoundingClientRect();
                const absoluteY = window.scrollY + rect.top;
                if (absoluteY > job.baselineMaxY) job.baselineMaxY = absoluteY;
            } catch(e) {}
        }
    };

    imgs.forEach(img => addBaseline(img.src, img));
    videos.forEach(v => addBaseline(v.src, v));
    
    divs.forEach(div => {
        const style = window.getComputedStyle(div);
        if (style.backgroundImage && style.backgroundImage !== 'none') {
            const match = style.backgroundImage.match(/url\(['"]?([^'"]+)['"]?\)/i);
            if (match && match[1]) addBaseline(match[1], div);
        }
    });
    
    console.log(`[AssetMatcher] Captured baseline. Max Y: ${job.baselineMaxY}`);
  }

  handleAsset(media) {
    console.log(`[AssetMatcher] Received ASSET_DETECTED for ${media.url}`);
    const currentJob = this.queueManager.currentJob;
    if (!currentJob) {
        console.log(`[AssetMatcher] Rejected: No current job`);
        return;
    }
    if (currentJob.status !== 'generating') {
        console.log(`[AssetMatcher] Rejected: Job status is ${currentJob.status}, not 'generating'`);
        return; 
    }

    if (currentJob.type !== media.type) {
        console.log(`[AssetMatcher] Rejected: Media type mismatch`);
        return;
    }
    
    // 2. Check timing against baseline
    if (currentJob.baselineUrls && currentJob.baselineUrls.has(media.url)) {
        let isNewChatBlock = false;
        if (media.element) {
            try {
                let absoluteY = 0;
                if (media.element.dataset.fmdOriginalY) {
                    absoluteY = parseFloat(media.element.dataset.fmdOriginalY);
                } else {
                    const rect = media.element.getBoundingClientRect();
                    absoluteY = window.scrollY + rect.top;
                }
                if (absoluteY > currentJob.baselineMaxY + 20) {
                    isNewChatBlock = true;
                }
            } catch(e) {}
        }
        
        if (!isNewChatBlock) {
            console.log(`[AssetMatcher] Rejected: URL was in baseline and not physically lower on the page.`);
            return; 
        } else {
            console.log(`[AssetMatcher] Accepted CACHED URL because it rendered physically lower on the page!`);
        }
    }

    console.log(`[AssetMatcher] Matched NEW generated asset ${media.id} to job ${currentJob.id}`);
    
    // Stop the active poller
    if (currentJob._pollInterval) {
        clearInterval(currentJob._pollInterval);
        currentJob._pollInterval = null;
    }

    // Augment the media object with automator metadata
    media.isAutomated = true;
    media.jobId = currentJob.id;
    media.project = this.queueManager.project;
    media.batch = this.queueManager.batch;
    media.title = currentJob.id;

    // Record it
    currentJob.assets.push(media);
    currentJob.status = 'resolving';
    window.AutomatorEvents.emit('ASSET_MATCHED', { job: currentJob, media });
  }

  // Actively poll the DOM while generating to bypass MutationObserver blind spots (Shadow DOMs, React virtual DOM swaps)
  startActivePolling(job) {
    if (job._pollInterval) clearInterval(job._pollInterval);
    
    job._pollInterval = setInterval(() => {
        if (job.status !== 'generating') {
            clearInterval(job._pollInterval);
            return;
        }
        
        console.log(`[AssetMatcher] Actively polling DOM for job ${job.id}...`);
        
        // Directly invoke the detector's scanner to force a deep DOM check
        if (window.FlowDetector) {
            window.FlowDetector.scan();
        }
    }, 1500); // Poll every 1.5 seconds
  }
}

window.AssetMatcher = AssetMatcher;
