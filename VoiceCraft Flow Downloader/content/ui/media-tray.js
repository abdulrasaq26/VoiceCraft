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
        <div class="fmd-header-title">VoiceCraft Flow Downloader</div>
        <button class="fmd-close-btn">&times;</button>
      </div>
      <div class="fmd-filter-bar" style="display: flex; align-items: center;">
        <button class="fmd-filter-btn active" data-filter="all" id="filter-all">All (0)</button>
        <button class="fmd-filter-btn" data-filter="image" id="filter-img">Images (0)</button>
        <button class="fmd-filter-btn" data-filter="video" id="filter-vid">Videos (0)</button>
        
        <div style="margin-left: auto; display: flex; align-items: center; gap: 6px;">
            <div id="fmd-crawl-status" style="display: none; font-size: 10px; font-weight: bold; color: #89b4fa;">IDLE</div>
            <button id="fmd-btn-crawl" style="background: #89b4fa; color: #11111b; border: none; border-radius: 4px; padding: 4px 8px; font-size: 10px; font-weight: bold; cursor: pointer;">Auto-Crawl</button>
            <button id="fmd-btn-stop" style="display: none; background: #f38ba8; color: #11111b; border: none; border-radius: 4px; padding: 4px 8px; font-size: 10px; font-weight: bold; cursor: pointer;">Stop</button>
        </div>
      </div>
      <div class="fmd-media-grid" id="media-grid"></div>
      <div class="fmd-footer">
        <div class="fmd-footer-actions">
          <button class="fmd-btn-text" id="btn-select-all">Select All</button>
          <button class="fmd-btn-text" id="btn-clear">Clear</button>
          <button class="fmd-btn-text" id="btn-delete-invalid" style="color: #f38ba8; margin-left: 10px;">Delete Invalid</button>
        </div>
        <button class="fmd-btn-primary" id="btn-download">Download (0)</button>
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
    const header = this.shadow.querySelector('.fmd-header');
    let isDragging = false;
    let currentX = 0;
    let currentY = 0;
    let initialX = 0;
    let initialY = 0;

    header.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        
        // Grab exact pixel coordinates relative to viewport
        const rect = this.trayEl.getBoundingClientRect();
        
        // Set exact top/left and clear bottom/right constraints so it moves freely
        this.trayEl.style.bottom = 'auto';
        this.trayEl.style.right = 'auto';
        this.trayEl.style.top = rect.top + 'px';
        this.trayEl.style.left = rect.left + 'px';
        this.trayEl.style.transform = 'none';

        initialX = e.clientX - rect.left;
        initialY = e.clientY - rect.top;
        isDragging = true;
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            e.preventDefault();
            currentX = e.clientX - initialX;
            currentY = e.clientY - initialY;
            
            // Constrain top boundary so header is always grabbable
            if (currentY < 0) currentY = 0;
            
            this.trayEl.style.left = currentX + 'px';
            this.trayEl.style.top = currentY + 'px';
        }
    });

    document.addEventListener('mouseup', () => {
        if (!isDragging) return;
        isDragging = false;
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
                btnCrawl.style.display = 'none';
                btnStop.style.display = 'block';
                crawlStatus.style.display = 'block';
                
                const updateUI = (stats) => {
                    crawlStatus.textContent = stats.state;
                    if (stats.state === 'COMPLETE' || stats.state === 'STOPPED') {
                        btnStop.style.display = 'none';
                        btnCrawl.style.display = 'block';
                        window.FlowCrawlerInstance.unsubscribe(updateUI);
                        setTimeout(() => crawlStatus.style.display = 'none', 3000);
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
        e.target.classList.add('active');
        this.currentFilter = e.target.dataset.filter;
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

      } catch (err) {
        console.error("Error during resolution", err);
        this.btnDownload.disabled = false;
        this.btnDownload.textContent = 'Error';
      }
    });
  }

  show() {
    this.init();
    this.trayEl.style.display = 'flex';
    this.isVisible = true;
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
        item.ui.element.style.display = 'block';
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
    
    this.btnDownload.textContent = `Download (${count})`;
    this.btnDownload.disabled = count === 0;

    // Update filter badges
    const total = imgCount + vidCount;
    this.shadow.querySelector('#filter-all').textContent = `All (${total})`;
    this.shadow.querySelector('#filter-img').textContent = `Images (${imgCount})`;
    this.shadow.querySelector('#filter-vid').textContent = `Videos (${vidCount})`;
  }
}

window.MediaTray = MediaTray;
