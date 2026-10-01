const { contextBridge, ipcRenderer } = require('electron');

window.addEventListener('DOMContentLoaded', () => {
  if (document.title === '') document.title = 'VoiceCraft Studio';
  // Inside the studio the studio bar is the navigation, so each module hides
  // its own workspace switcher.
  document.documentElement.classList.add('vc-studio');
  const st = document.createElement('style');
  st.textContent = '.vc-studio .app-workspaces, .vc-studio nav.ws { display: none !important; }';
  document.head.appendChild(st);
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
  setWindowFullscreen: (on) => ipcRenderer.send('browser:set-window-fullscreen', on),
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
  onWindowFullscreen: listen('browser:window-fullscreen'),
});

// Studio: modules, the current project and its asset library (electron/studio.js).
contextBridge.exposeInMainWorld('studio', {
  getState: () => ipcRenderer.invoke('studio:get-state'),
  editorReady: () => ipcRenderer.send('studio:editor-ready'),
  switchTo: (module) => ipcRenderer.send('studio:switch', module),
  setProject: (project) => ipcRenderer.invoke('studio:set-project', project),
  assets: (projectId) => ipcRenderer.invoke('studio:assets', { projectId }),
  assetCounts: (ids) => ipcRenderer.invoke('studio:asset-counts', ids),
  addAsset: (asset) => ipcRenderer.invoke('studio:add-asset', asset),
  removeAsset: (projectId, assetId) => ipcRenderer.invoke('studio:remove-asset', { projectId, assetId }),
  deleteProjectAssets: (ids) => ipcRenderer.invoke('studio:delete-project-assets', ids),
  sendToEditor: (projectId, assetIds) => ipcRenderer.send('studio:send-to-editor', { projectId, assetIds }),
  projectMenu: (x, y, projects) => ipcRenderer.send('studio:project-menu', { x, y, projects }),
  setFocusMode: (on) => ipcRenderer.send('studio:focus-mode', !!on),
  assetUrl: (projectId, assetId) => `vcasset://${encodeURIComponent(projectId)}/${encodeURIComponent(assetId)}`,
  onModuleChanged: listen('studio:module-changed'),
  onProjectChanged: listen('studio:project-changed'),
  onAssetAdded: listen('studio:asset-added'),
  onAssetRemoved: listen('studio:asset-removed'),
  onProjectsDeleted: listen('studio:projects-deleted'),
  onImportAssets: listen('studio:import-assets'),
  onCheckTransfer: listen('studio:check-transfer'),
  onNewProject: listen('studio:new-project'),
  onShowProjects: listen('studio:show-projects'),
  onFocusMode: listen('studio:focus-mode'),
});
