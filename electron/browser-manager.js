import { WebContentsView, session, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class BrowserManager {
  constructor(mainWindow) {
    this.mainWindow = mainWindow;
    this.tabs = new Map();
    this.activeTabId = null;
    this.tabCounter = 0;
    this.bounds = { x: 0, y: 0, width: 0, height: 0 };
    this.isBrowserActive = false;
    this.setupIPC();
  }

  setupIPC() {
    ipcMain.on('browser:mount', (event, bounds) => {
      this.isBrowserActive = true;
      if (bounds) this.bounds = bounds;
      this.updateActiveTabBounds();
    });

    ipcMain.on('browser:unmount', () => {
      this.isBrowserActive = false;
      if (this.activeTabId && this.tabs.has(this.activeTabId)) {
        const tab = this.tabs.get(this.activeTabId);
        this.mainWindow.contentView.removeChild(tab.view);
      }
    });

    ipcMain.on('browser:resize', (event, bounds) => {
      this.bounds = bounds;
      if (this.isBrowserActive) {
        this.updateActiveTabBounds();
      }
    });

    ipcMain.handle('browser:create-tab', (event, { url, profileId }) => {
      return this.createTab(url, profileId);
    });

    ipcMain.on('browser:close-tab', (event, tabId) => {
      this.closeTab(tabId);
    });

    ipcMain.on('browser:activate-tab', (event, tabId) => {
      this.activateTab(tabId);
    });

    ipcMain.on('browser:navigate', (event, { tabId, url }) => {
      const tab = this.tabs.get(tabId);
      if (tab) tab.view.webContents.loadURL(url);
    });

    ipcMain.on('browser:go-back', (event, tabId) => {
      const tab = this.tabs.get(tabId);
      if (tab && tab.view.webContents.canGoBack()) tab.view.webContents.goBack();
    });

    ipcMain.on('browser:go-forward', (event, tabId) => {
      const tab = this.tabs.get(tabId);
      if (tab && tab.view.webContents.canGoForward()) tab.view.webContents.goForward();
    });

    ipcMain.on('browser:reload', (event, tabId) => {
      const tab = this.tabs.get(tabId);
      if (tab) tab.view.webContents.reload();
    });

    ipcMain.on('browser:open-devtools', (event, tabId) => {
      const tab = this.tabs.get(tabId);
      if (tab) tab.view.webContents.openDevTools({ mode: 'detach' });
    });
  }

  createTab(url, profileId = 'default') {
    const tabId = 'tab-' + (++this.tabCounter);
    const partition = profileId === 'default' ? 'persist:browser' : `persist:browser-${profileId}`;
    
    const view = new WebContentsView({
      webPreferences: {
        partition,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true
      }
    });

    const tab = {
      id: tabId,
      url,
      title: 'Loading...',
      favicon: null,
      loading: true,
      canGoBack: false,
      canGoForward: false,
      profileId,
      partition,
      view
    };

    this.tabs.set(tabId, tab);

    // Setup event listeners for the WebContents
    const wc = view.webContents;

    wc.on('did-start-loading', () => {
      tab.loading = true;
      this.notifyTabUpdate(tabId);
    });

    wc.on('did-stop-loading', () => {
      tab.loading = false;
      tab.title = wc.getTitle() || wc.getURL();
      tab.url = wc.getURL();
      tab.canGoBack = wc.canGoBack();
      tab.canGoForward = wc.canGoForward();
      this.notifyTabUpdate(tabId);
    });

    wc.on('page-title-updated', (e, title) => {
      tab.title = title;
      this.notifyTabUpdate(tabId);
    });

    wc.on('page-favicon-updated', (e, favicons) => {
      if (favicons && favicons.length > 0) {
        tab.favicon = favicons[0];
        this.notifyTabUpdate(tabId);
      }
    });

    wc.on('did-navigate', (e, url) => {
      tab.url = url;
      this.notifyTabUpdate(tabId);
    });

    wc.on('did-navigate-in-page', (e, url) => {
      tab.url = url;
      this.notifyTabUpdate(tabId);
    });
    
    wc.setWindowOpenHandler(({ url }) => {
      this.createTab(url, profileId);
      return { action: 'deny' };
    });

    // Load initial URL
    if (url) {
      wc.loadURL(url);
    }

    this.activateTab(tabId);
    return tabId;
  }

  closeTab(tabId) {
    if (!this.tabs.has(tabId)) return;
    const tab = this.tabs.get(tabId);
    
    // If it's active, remove view
    if (this.activeTabId === tabId) {
      this.mainWindow.contentView.removeChild(tab.view);
      this.activeTabId = null;
    }
    
    // Destroy webcontents
    // WebContentsView doesn't have an explicit destroy, but closing it removes it
    // Setting to null enables GC. We can call close() if available, but webContents is managed by view.
    // In Electron, we can just remove references. If needed we can call webContents.close() ? No, that's for window.
    this.tabs.delete(tabId);

    // Try to activate another tab
    if (this.tabs.size > 0) {
      const firstTab = Array.from(this.tabs.keys())[0];
      this.activateTab(firstTab);
    }
  }

  activateTab(tabId) {
    if (!this.tabs.has(tabId)) return;
    
    // Remove old active tab view
    if (this.activeTabId && this.tabs.has(this.activeTabId)) {
      const oldTab = this.tabs.get(this.activeTabId);
      try {
        this.mainWindow.contentView.removeChild(oldTab.view);
      } catch (e) {
        // Ignored if not a child
      }
    }

    this.activeTabId = tabId;
    const newTab = this.tabs.get(tabId);
    
    if (this.isBrowserActive) {
      this.mainWindow.contentView.addChildView(newTab.view);
      this.updateActiveTabBounds();
    }
    
    this.mainWindow.webContents.send('browser:active-tab-changed', tabId);
    this.notifyTabUpdate(tabId);
  }

  updateActiveTabBounds() {
    if (this.activeTabId && this.tabs.has(this.activeTabId) && this.isBrowserActive) {
      const tab = this.tabs.get(this.activeTabId);
      tab.view.setBounds(this.bounds);
    }
  }

  notifyTabUpdate(tabId) {
    if (!this.tabs.has(tabId)) return;
    const tab = this.tabs.get(tabId);
    this.mainWindow.webContents.send('browser:tab-updated', {
      id: tab.id,
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      loading: tab.loading,
      canGoBack: tab.canGoBack,
      canGoForward: tab.canGoForward
    });
  }
}
