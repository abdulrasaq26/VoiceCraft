// Browser Workspace UI (IPC Client)

class BrowserTabs {
  constructor() {
    this.tabs = [];
    this.activeTabId = null;

    this.tabsContainer = document.getElementById('browser-tabs');
    this.contentArea = document.getElementById('browser-content-area');
    this.addressBar = document.getElementById('address-bar');
    
    document.getElementById('btn-new-tab').addEventListener('click', () => {
      this.createTab('https://flow.google.com/');
    });
    
    document.getElementById('btn-go').addEventListener('click', () => {
      this.navigateActive();
    });
    
    this.addressBar.addEventListener('keyup', (e) => {
      if (e.key === 'Enter') this.navigateActive();
    });
    
    document.getElementById('btn-back').addEventListener('click', () => {
      if (this.activeTabId) window.electronBrowser.goBack(this.activeTabId);
    });
    
    document.getElementById('btn-forward').addEventListener('click', () => {
      if (this.activeTabId) window.electronBrowser.goForward(this.activeTabId);
    });
    
    document.getElementById('btn-reload').addEventListener('click', () => {
      if (this.activeTabId) window.electronBrowser.reload(this.activeTabId);
    });

    // Handle bounds sync
    this.resizeObserver = new ResizeObserver(() => this.syncBounds());
    this.resizeObserver.observe(this.contentArea);

    // Initial mount
    setTimeout(() => {
        this.syncBounds();
        if (window.electronBrowser) window.electronBrowser.mount(this.getBounds());
    }, 100);

    if (window.electronBrowser) {
        window.electronBrowser.onTabUpdated((tabData) => {
            this.updateTabUI(tabData);
        });

        window.electronBrowser.onActiveTabChanged((tabId) => {
            this.setActiveTab(tabId);
        });
    }

    // Handle Settings
    document.getElementById('btn-settings').addEventListener('click', () => {
        const settingsCenter = document.getElementById('settings-center');
        if (settingsCenter.style.display === 'none') {
            settingsCenter.style.display = 'flex';
        } else {
            settingsCenter.style.display = 'none';
        }
    });

    document.getElementById('close-settings-center').addEventListener('click', () => {
        document.getElementById('settings-center').style.display = 'none';
    });

    const settingsTabs = document.querySelectorAll('.settings-tab');
    settingsTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            settingsTabs.forEach(t => t.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById('settings-title').textContent = e.target.textContent.replace(/[^\w\s&]/gi, '').trim();
        });
    });

    this.focusMode = false;
    document.getElementById('btn-focus').addEventListener('click', () => this.toggleFocusMode());
    window.addEventListener('keydown', (e) => {
        if (e.key === 'F11') {
            e.preventDefault();
            this.toggleFocusMode();
        }
    });
    
    window.addEventListener('beforeunload', () => {
        if (window.electronBrowser) window.electronBrowser.unmount();
    });

    // Create default tab
    this.createTab('https://flow.google.com/');
  }

  toggleFocusMode() {
      this.focusMode = !this.focusMode;
      const header = document.getElementById('app-header');
      if (this.focusMode) {
          header.style.display = 'none';
      } else {
          header.style.display = 'flex';
      }
  }

  getBounds() {
    const rect = this.contentArea.getBoundingClientRect();
    return {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };
  }

  syncBounds() {
    if (window.electronBrowser) window.electronBrowser.resize(this.getBounds());
  }

  async createTab(url) {
    if (!window.electronBrowser) return;
    const tabId = await window.electronBrowser.createTab(url, 'default');
    
    const tabEl = document.createElement('div');
    tabEl.className = 'browser-tab';
    tabEl.id = tabId;
    
    const titleEl = document.createElement('span');
    titleEl.className = 'browser-tab-title';
    titleEl.textContent = 'Loading...';
    
    const closeBtn = document.createElement('button');
    closeBtn.className = 'browser-tab-close';
    closeBtn.textContent = 'X';
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tabId);
    });
    
    tabEl.appendChild(titleEl);
    tabEl.appendChild(closeBtn);
    
    tabEl.addEventListener('click', () => {
        window.electronBrowser.activateTab(tabId);
    });
    
    this.tabsContainer.insertBefore(tabEl, document.getElementById('btn-new-tab'));
    
    this.tabs.push({ id: tabId, tabEl, titleEl });
  }

  updateTabUI(data) {
      const tab = this.tabs.find(t => t.id === data.id);
      if (tab) {
          tab.titleEl.textContent = data.title;
          if (this.activeTabId === data.id) {
              if (document.activeElement !== this.addressBar) {
                  this.addressBar.value = data.url;
              }
              this.updateFlowTools(data.url);
          }
      }
  }

  updateFlowTools(url) {
      const flowTools = document.querySelectorAll('.flow-tool');
      if (url && (url.includes('flow.google.com') || url.includes('colab.research.google.com'))) {
          flowTools.forEach(el => el.style.display = 'inline-block');
      } else {
          flowTools.forEach(el => el.style.display = 'none');
      }
  }

  setActiveTab(id) {
    this.activeTabId = id;
    this.tabs.forEach(t => {
      if (t.id === id) {
        t.tabEl.classList.add('active');
      } else {
        t.tabEl.classList.remove('active');
      }
    });
  }

  closeTab(id) {
    if (window.electronBrowser) window.electronBrowser.closeTab(id);
    const idx = this.tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    
    const t = this.tabs[idx];
    t.tabEl.remove();
    this.tabs.splice(idx, 1);
  }

  navigateActive() {
    if (!this.activeTabId || !window.electronBrowser) return;
    let url = this.addressBar.value.trim();
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      if (url.includes('.') && !url.includes(' ')) {
        url = 'https://' + url;
      } else {
        url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
      }
    }
    window.electronBrowser.navigate(this.activeTabId, url);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  window.browserWorkspace = new BrowserTabs();
});
