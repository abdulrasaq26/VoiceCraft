// content/ui/media-tray.js

class MediaTray {
  constructor() {
    this.mediaItems = new Map(); // id -> { data, ui }
    this.isVisible = false;
    this.container = null;
    this.shadow = null;
  }

  init() {
    if (this.container) return;

    this.container = document.createElement('div');
    this.container.id = 'flow-media-downloader-host';
    this.shadow = this.container.attachShadow({ mode: 'closed' });

    // Inject styles
    const styleLink = document.createElement('link');
    styleLink.rel = 'stylesheet';
    styleLink.href = chrome.runtime.getURL('content/ui/styles.css');
    this.shadow.appendChild(styleLink);

    // Render Tray UI
    const tray = document.createElement('div');
    tray.className = 'fmd-tray-container';
    tray.style.display = 'none';

    tray.innerHTML = `
      <div class="fmd-header">
        <span class="fmd-logo">V</span>
        <div class="fmd-header-title">Flow Downloader<span class="fmd-header-sub" id="fmd-sub">Images and videos found in this project</span></div>
        <button class="fmd-close-btn" title="Close">✕</button>
      </div>
      <div class="fmd-filter-bar">
        <div class="fmd-seg" role="tablist">
          <button class="fmd-filter-btn active" data-filter="all" id="filter-all">All 0</button>
          <button class="fmd-filter-btn" data-filter="image" id="filter-img">Images 0</button>
          <button class="fmd-filter-btn" data-filter="video" id="filter-vid">Videos 0</button>
        </div>
        <span class="fmd-grow"></span>
        <span class="fmd-crawl-status" id="fmd-crawl-status" hidden>IDLE</span>
        <button class="fmd-btn" id="fmd-btn-crawl" title="Scroll through the whole project and collect everything">Auto-crawl</button>
        <button class="fmd-btn fmd-btn--danger" id="fmd-btn-stop" hidden>Stop</button>
      </div>
      <div class="fmd-media-grid" id="media-grid"></div>
      <div class="fmd-footer">
        <div class="fmd-footer-actions">
          <button class="fmd-btn-text" id="btn-select-all">Select all</button>
          <button class="fmd-btn-text" id="btn-clear">Clear</button>
          <button class="fmd-btn-text fmd-btn-text--danger" id="btn-delete-invalid" title="Remove items whose name isn't a timestamp like 0-21">Remove unnamed</button>
          <span class="fmd-sel-count" id="fmd-sel-count"></span>
        </div>
        <button class="fmd-btn-primary" id="btn-download" disabled>Download</button>
      </div>
    `;

    this.shadow.appendChild(tray);
    document.body.appendChild(this.container);

    this.trayEl = tray;
    this.gridEl = tray.querySelector('#media-grid');
    this.btnDownload = tray.querySelector('#btn-download');

    this.bindEvents();
    this.makeDraggable();
  }

  makeDraggable() {
    if (!window.FloatingPanelManager) return;
    window.FloatingPanelManager.register('downloader', {
      el: this.trayEl,
      handle: this.shadow.querySelector('.fmd-header'),
      isOpen: () => this.isVisible,
    });
  }

  bindEvents() {

    // Crawler hooks
    const btnCrawl = this.shadow.querySelector('#fmd-btn-crawl');
    const btnStop = this.shadow.querySelector('#fmd-btn-stop');
    const crawlStatus = this.shadow.querySelector('#fmd-crawl-status');
    
    if (btnCrawl) {
        btnCrawl.addEventListener('click', () => {
            if (window.FlowCrawlerInstance) {
                btnCrawl.hidden = true;
                btnStop.hidden = false;
                crawlStatus.hidden = false;
                
                const updateUI = (stats) => {
                    crawlStatus.textContent = stats.state;
                    if (stats.state === 'COMPLETE' || stats.state === 'STOPPED') {
                        btnStop.hidden = true;
                        btnCrawl.hidden = false;
                        window.FlowCrawlerInstance.unsubscribe(updateUI);
                        setTimeout(() => { crawlStatus.hidden = true; }, 3000);
                    }
                };
                
                window.FlowCrawlerInstance.subscribe(updateUI);
                window.FlowCrawlerInstance.start();
            }
        });
        
        btnStop.addEventListener('click', () => {
            if (window.FlowCrawlerInstance) {
                window.FlowCrawlerInstance.stop();
            }
        });
    }

    this.shadow.querySelector('.fmd-close-btn').addEventListener('click', () => this.hide());

    
    // Filters
    this.currentFilter = 'all';
    const filterBtns = this.shadow.querySelectorAll('.fmd-filter-btn');
    filterBtns.forEach(btn => {
      btn.addEventListener('click', (e) => {
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        this.currentFilter = btn.dataset.filter;
        this.applyFilter();
      });
    });

    this.shadow.querySelector('#btn-select-all').addEventListener('click', () => {
      this.mediaItems.forEach(item => {
        if (item.data.status !== 'rejected') {
          item.data.status = 'selected';
          item.ui.updateSelectionState();
        }
      });
      this.updateFooter();
    });

    this.shadow.querySelector('#btn-clear').addEventListener('click', () => {
      this.mediaItems.forEach(item => {
        if (item.data.status === 'selected') {
          item.data.status = 'detected';
          item.ui.updateSelectionState();
        }
      });
      this.updateFooter();
    });

    this.shadow.querySelector('#btn-delete-invalid').addEventListener('click', () => {
      const invalidKeys = [];
      const validFormat = /^\d+-\d+$/;
      
      this.mediaItems.forEach((item, key) => {
          let name = item.data.title || '';
          if (name) {
              name = name.replace(/[^a-zA-Z0-9-]/g, '');
          }
          if (!validFormat.test(name)) {
              invalidKeys.push(key);
          }
      });
      
      invalidKeys.forEach(key => {
          const item = this.mediaItems.get(key);
          if (item && item.ui && item.ui.element) {
              item.ui.element.remove();
          }
          this.mediaItems.delete(key);
      });
      
      this.updateFooter();
    });

    this.btnDownload.addEventListener('click', async () => {
      const selected = Array.from(this.mediaItems.values())
        .filter(item => item.data.status === 'selected')
        .map(item => item.data);
      
      if (selected.length === 0) return;

      this.btnDownload.disabled = true;
      this.btnDownload.textContent = 'Resolving media...';

      try {
        const resolvedItems = [];
        for (const item of selected) {
          const resolved = await window.MediaResolver.resolve(item);
          resolvedItems.push(resolved);
        }

        this.btnDownload.textContent = 'Queueing...';

        // Send in batches of 25 to prevent Chrome IPC 'Message length exceeded' crash
        // when downloading hundreds of data URLs at once.
        const batchSize = 25;
        for (let i = 0; i < resolvedItems.length; i += batchSize) {
            const batch = resolvedItems.slice(i, i + batchSize);
            await new Promise((resolveMsg) => {
                chrome.runtime.sendMessage({
                  action: 'downloadSelected',
                  items: batch
                }, (response) => {
                  resolveMsg(response);
                });
            });
        }

        this.btnDownload.disabled = false;
        selected.forEach(s => s.status = 'queued');
        this.updateFooter();
        this.flashDownload(`Queued ${selected.length} ✓`);

      } catch (err) {
        console.error("Error during resolution", err);
        this.btnDownload.disabled = false;
        this.flashDownload('Could not resolve media — try again');
      }
    });
  }

  flashDownload(text) {
    this.btnDownload.textContent = text;
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.updateFooter(), 1800);
  }

  show() {
    this.init();
    this.trayEl.style.display = 'flex';
    this.isVisible = true;
    if (window.FloatingPanelManager) window.FloatingPanelManager.restorePosition('downloader');
  }

  hide() {
    if (this.trayEl) {
      this.trayEl.style.display = 'none';
    }
    this.isVisible = false;
  }

  addMedia(mediaData) {
    this.init();
    
    if (this.mediaItems.has(mediaData.id)) return;

    const ui = new window.MediaItemUI(mediaData, {
      onSelectionChange: () => this.updateFooter(),
      onRemove: (data) => {
        this.mediaItems.delete(data.id);
        this.updateFooter();
      }
    });

    this.mediaItems.set(mediaData.id, { data: mediaData, ui });
    
    // Convert to array and sort alphanumerically by title
    const sortedEntries = Array.from(this.mediaItems.entries()).sort((a, b) => {
        const titleA = a[1].data.title || '';
        const titleB = b[1].data.title || '';
        return titleA.localeCompare(titleB, undefined, { numeric: true, sensitivity: 'base' });
    });

    // Reconstruct the map in sorted order
    this.mediaItems = new Map(sortedEntries);
    
    // Re-render the grid in the correct order
    this.gridEl.innerHTML = '';
    this.mediaItems.forEach(item => {
        this.gridEl.appendChild(item.ui.element);
    });
    
    this.updateFooter();
  }

  clearAll() {
    this.mediaItems.forEach(item => {
      if (item.ui && item.ui.element) {
        item.ui.element.remove();
      }
    });
    this.mediaItems.clear();
    this.updateFooter();
  }

  applyFilter() {
    this.mediaItems.forEach(item => {
      if (!item.ui || !item.ui.element) return;
      if (this.currentFilter === 'all' || item.data.type === this.currentFilter) {
        item.ui.element.style.display = '';
      } else {
        item.ui.element.style.display = 'none';
      }
    });
  }

  updateFooter() {
    if (!this.btnDownload) return; // Prevent crash if called before init

    let count = 0;
    let imgCount = 0;
    let vidCount = 0;

    this.mediaItems.forEach(item => {
      if (item.data.status === 'selected') count++;
      if (item.data.status !== 'rejected') {
         if (item.data.type === 'image') imgCount++;
         if (item.data.type === 'video') vidCount++;
      }
    });
    
    this.btnDownload.textContent = count ? `Download ${count} item${count === 1 ? '' : 's'}` : 'Select items to download';
    this.btnDownload.disabled = count === 0;

    // Filter counts
    const total = imgCount + vidCount;
    this.shadow.querySelector('#filter-all').textContent = `All ${total}`;
    this.shadow.querySelector('#filter-img').textContent = `Images ${imgCount}`;
    this.shadow.querySelector('#filter-vid').textContent = `Videos ${vidCount}`;
    this.shadow.querySelector('#fmd-sel-count').textContent = count ? `${count} selected` : '';
  }
}

window.MediaTray = MediaTray;
