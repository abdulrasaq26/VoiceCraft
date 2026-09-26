const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  if (document.title === '') document.title = 'VoiceCraft Studio';
});

contextBridge.exposeInMainWorld('electronBrowser', {
  mount: (bounds) => ipcRenderer.send('browser:mount', bounds),
  unmount: () => ipcRenderer.send('browser:unmount'),
  resize: (bounds) => ipcRenderer.send('browser:resize', bounds),
  createTab: (url, profileId) => ipcRenderer.invoke('browser:create-tab', { url, profileId }),
  closeTab: (tabId) => ipcRenderer.send('browser:close-tab', tabId),
  activateTab: (tabId) => ipcRenderer.send('browser:activate-tab', tabId),
  navigate: (tabId, url) => ipcRenderer.send('browser:navigate', { tabId, url }),
  goBack: (tabId) => ipcRenderer.send('browser:go-back', tabId),
  goForward: (tabId) => ipcRenderer.send('browser:go-forward', tabId),
  reload: (tabId) => ipcRenderer.send('browser:reload', tabId),
  openDevTools: (tabId) => ipcRenderer.send('browser:open-devtools', tabId),
  onTabUpdated: (callback) => ipcRenderer.on('browser:tab-updated', (e, data) => callback(data)),
  onActiveTabChanged: (callback) => ipcRenderer.on('browser:active-tab-changed', (e, tabId) => callback(tabId))
});
