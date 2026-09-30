const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  if (document.title === '') document.title = 'VoiceCraft Studio';
});

// Host-page API for the built-in browser (public/browser.js).
const listen = (channel) => (callback) => {
  const fn = (e, data) => callback(data);
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
};

contextBridge.exposeInMainWorld('electronBrowser', {
  // layout
  mount: (bounds) => ipcRenderer.send('browser:mount', bounds),
  unmount: () => ipcRenderer.send('browser:unmount'),
  resize: (bounds) => ipcRenderer.send('browser:resize', bounds),
  setHidden: (hidden) => ipcRenderer.send('browser:set-hidden', hidden),
  init: () => ipcRenderer.invoke('browser:init'),

  // tabs
  createTab: (url, profileId, opts = {}) => ipcRenderer.invoke('browser:create-tab', { url, profileId, ...opts }),
  closeTab: (tabId) => ipcRenderer.send('browser:close-tab', tabId),
  activateTab: (tabId) => ipcRenderer.send('browser:activate-tab', tabId),
  setOrder: (ids) => ipcRenderer.send('browser:set-order', ids),
  reopenClosed: () => ipcRenderer.invoke('browser:reopen-closed'),

  // navigation
  navigate: (tabId, input) => ipcRenderer.send('browser:navigate', { tabId, input }),
  goBack: (tabId) => ipcRenderer.send('browser:go-back', tabId),
  goForward: (tabId) => ipcRenderer.send('browser:go-forward', tabId),
  reload: (tabId, hard = false) => ipcRenderer.send('browser:reload', { tabId, hard }),
  stop: (tabId) => ipcRenderer.send('browser:stop', tabId),
  focusPage: (tabId) => ipcRenderer.send('browser:focus-page', tabId),
  openDevTools: (tabId) => ipcRenderer.send('browser:open-devtools', tabId),
  print: (tabId) => ipcRenderer.send('browser:print', tabId),
  toggleMute: (tabId) => ipcRenderer.send('browser:toggle-mute', tabId),
  zoom: (tabId, dir) => ipcRenderer.send('browser:zoom', { tabId, dir }),
  find: (tabId, text, forward = true, followUp = false) => ipcRenderer.send('browser:find', { tabId, text, forward, followUp }),
  stopFind: (tabId) => ipcRenderer.send('browser:stop-find', tabId),

  // menus
  tabMenu: (tabId) => ipcRenderer.send('browser:tab-menu', { tabId }),
  appMenu: (x, y) => ipcRenderer.send('browser:app-menu', { x, y }),

  // Flow extension tools
  flowCommand: (tabId, action) => ipcRenderer.send('browser:flow-command', { tabId, action }),

  // data
  setSettings: (patch) => ipcRenderer.invoke('browser:set-settings', patch),
  pickDownloadDir: () => ipcRenderer.invoke('browser:pick-download-dir'),
  clearData: (profileId, what) => ipcRenderer.invoke('browser:clear-data', { profileId, what }),
  bookmarks: (op, args = {}) => ipcRenderer.invoke('browser:bookmarks', { op, ...args }),
  history: (op, args = {}) => ipcRenderer.invoke('browser:history', { op, ...args }),
  downloadAction: (id, action) => ipcRenderer.send('browser:download-action', { id, action }),
  clearDownloads: () => ipcRenderer.send('browser:downloads-clear'),
  openDownloadDir: () => ipcRenderer.send('browser:open-download-dir'),

  // events
  onTabCreated: listen('browser:tab-created'),
  onTabUpdated: listen('browser:tab-updated'),
  onTabClosed: listen('browser:tab-closed'),
  onActiveTabChanged: listen('browser:active-tab-changed'),
  onCommand: listen('browser:command'),
  onFindResult: listen('browser:find-result'),
  onDownloadUpdated: listen('browser:download-updated'),
  onDownloadRemoved: listen('browser:download-removed'),
  onDownloadsReset: listen('browser:downloads-reset'),
  onPageFullscreen: listen('browser:page-fullscreen'),
});
