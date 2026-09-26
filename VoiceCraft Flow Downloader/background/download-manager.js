// background/download-manager.js

class DownloadManager {
  constructor() {
    this.queue = [];
    this.isDownloading = false;
    this.activeDownloads = new Map(); // downloadId -> mediaItem
    this.mediaToTabMap = new Map(); // mediaId -> tabId
    this.currentDownloadPath = null;

    this.bindEvents();
  }



  enqueue(items, tabId) {
    // Generate a unique batch folder name for this download session
    const dateObj = new Date();
    const dateStr = dateObj.toISOString().split('T')[0];
    const timeStr = dateObj.toTimeString().split(' ')[0].replace(/:/g, '-');
    const currentBatchId = `batch_${dateStr}_${timeStr}`;

    items.forEach(item => {
      item.batchId = currentBatchId; // Assign to item
      this.mediaToTabMap.set(item.id, tabId);
      this.queue.push(item);
      this.broadcastState(item.id, 'queued', 0);
    });

    if (!this.isDownloading) {
      this.processQueue();
    }
  }

  async processQueue() {
    if (this.queue.length === 0) {
      this.isDownloading = false;
      return;
    }

    this.isDownloading = true;
    const item = this.queue.shift();
    
    try {
      this.broadcastState(item.id, 'downloading', 0);
      const downloadId = await this.startDownload(item);
      if (downloadId) {
        this.activeDownloads.set(downloadId, item);
      } else {
        throw new Error("Download failed to start");
      }
    } catch (error) {
      console.error(`Flow Media Downloader: Failed to download ${item.id}:`, error);
      this.broadcastState(item.id, 'error', 0);
      
      // Since it failed instantly, we can process the next one immediately
      // Small timeout to prevent infinite rapid failure loops
      setTimeout(() => this.processQueue(), 500);
    }
  }

  startDownload(item) {
    return new Promise((resolve, reject) => {
      chrome.storage.local.get({
        baseFolder: 'Flow Media Downloader',
        filenameTemplate: '{title}.{ext}'
      }, (settings) => {
        // Force upgrade the old default
        if (settings.baseFolder === 'GoogleFlow' || settings.baseFolder === 'Flow Downloader') {
            settings.baseFolder = 'Flow Media Downloader';
        }
        
        const dateObj = new Date();
        const dateStr = dateObj.toISOString().split('T')[0];
        const timeStr = dateObj.toTimeString().split(' ')[0].replace(/:/g, '');
        
        let extension = item.type === 'video' ? 'mp4' : 'png';
        if (item.mimeType) {
           if (item.mimeType.includes('webp')) extension = 'webp';
           else if (item.mimeType.includes('jpeg') || item.mimeType.includes('jpg')) extension = 'jpg';
           else if (item.mimeType.includes('gif')) extension = 'gif';
           else if (item.mimeType.includes('webm')) extension = 'webm';
        }

        const id = item.id.split('_').pop() || Math.random().toString(36).substr(2,6);
        
        let title = 'Flow';
        if (item.title) {
            // Only replace illegal Windows/Mac filename characters and newlines
            title = item.title.replace(/[/\\?%*:|"<>\n\r]/g, '-').substring(0, 100);
        } else {
            try {
              if (item.url && !item.url.startsWith('blob:') && !item.url.startsWith('data:')) {
                 const urlPart = item.url.split('/').pop().split('?')[0];
                 if (urlPart && urlPart.includes('.')) title = urlPart.split('.')[0];
              }
            } catch (e) {}
        }
        if (!title || title.trim() === '') title = 'Flow';

        // Apply template
        let filename = settings.filenameTemplate
            .replace('{title}', title)
            .replace('{date}', dateStr)
            .replace('{time}', timeStr)
            .replace('{id}', id)
            .replace('{type}', item.type)
            .replace('{ext}', extension);
        
        // Cleanup extra dashes/underscores from missing vars
        filename = filename.replace(/--+/g, '-').replace(/__+/g, '_');

        let path; if (item.isAutomated) { path = `${settings.baseFolder}/${(item.project||"").replace(/[\/\?%*:\|\"<>\n\r]/g,"-")}/${(item.batch||"").replace(/[\/\?%*:\|\"<>\n\r]/g,"-")}/${(item.jobId||"").replace(/[\/\?%*:\|\"<>\n\r]/g,"-")}.${extension}`; } else { path = `${settings.baseFolder}/${item.batchId || dateStr}/${filename}`; }
        
        // Store the intended filename so onDeterminingFilename can force it
        this.currentDownloadPath = path;

        if (chrome.downloads && chrome.downloads.download) {
          chrome.downloads.download({
            url: item.url,
            filename: path,
            conflictAction: 'uniquify',
            saveAs: false
          }, (downloadId) => {
            if (chrome.runtime.lastError) reject(chrome.runtime.lastError);
            else resolve(downloadId);
          });
        } else {
          // Electron fallback
          fetch('http://localhost:3000/api/extension-bridge/download', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ url: item.url, filename: path })
          }).then(res => res.json()).then(data => {
             if (data.error) reject(new Error(data.error));
             else {
                const fakeId = Math.floor(Math.random() * 1000000);
                resolve(fakeId);
                // fake completion
                setTimeout(() => {
                  this.handleDownloadChange({ id: fakeId, state: { current: 'complete' } });
                }, 500);
             }
          }).catch(reject);
        }
      });
    });
  }

  bindEvents() {
    if (chrome.downloads) {
      chrome.downloads.onChanged.addListener(this.handleDownloadChange.bind(this));
      chrome.downloads.onDeterminingFilename.addListener((item, suggest) => {
      if (this.currentDownloadPath) {
          const intended = this.currentDownloadPath;
          this.currentDownloadPath = null; // consume it
          suggest({ filename: intended, conflictAction: 'uniquify' });
          return true;
      }
      suggest();
    });
    }
  }

  handleDownloadChange(delta) {
    const item = this.activeDownloads.get(delta.id);
    if (!item) return;

    if (delta.state) {
      if (delta.state.current === 'complete') {
        this.broadcastState(item.id, 'downloaded', 100);
        this.activeDownloads.delete(delta.id);
        
        // Add to persistent history
        this.saveToHistory(item);
        
        this.processQueue(); // Start next
      } else if (delta.state.current === 'interrupted') {
        this.broadcastState(item.id, 'error', 0);
        this.activeDownloads.delete(delta.id);
        
        this.processQueue(); // Start next
      }
    }
  }

  async saveToHistory(item) {
    const key = item.fingerprint || item.url;
    // Assuming StorageManager is globally available from service-worker imports
    if (typeof StorageManager !== 'undefined') {
      const history = await StorageManager.get('downloadHistory', []);
      if (!history.includes(key)) {
        history.push(key);
        await StorageManager.save('downloadHistory', history);
      }
    }
  }

  broadcastState(mediaId, status, progress) {
    const tabId = this.mediaToTabMap.get(mediaId);
    if (!tabId) return;

    chrome.tabs.sendMessage(tabId, {
      action: 'downloadProgress',
      mediaId,
      status,
      progress
    }, () => {
      if (chrome.runtime.lastError) {
         // ignore
      }
    });
  }
}

self.downloadManager = new DownloadManager();
