// Preload for built-in browser tabs. Exposes nothing to the page; it only
// relays between the Flow Downloader content scripts (via window.postMessage,
// see content/host-bridge.js) and the main process, which provides what
// Electron's extension support lacks (chrome.downloads, chrome.scripting).
const { ipcRenderer } = require('electron');

const TO_HOST = 'voicecraft-flow:to-host';
const TO_EXT = 'voicecraft-flow:to-ext';

function markHost() {
  if (document.documentElement) document.documentElement.setAttribute('data-voicecraft-host', '1');
}
markHost();
document.addEventListener('DOMContentLoaded', markHost);

window.addEventListener('message', async (e) => {
  const d = e.data;
  if (e.source !== window || !d || d.channel !== TO_HOST) return;
  if (d.type === 'download') {
    ipcRenderer.send('flow-host:download', {
      url: String(d.url || ''), relPath: String(d.relPath || ''), mediaId: d.mediaId,
      meta: d.meta && typeof d.meta === 'object' ? {
        source: String(d.meta.source || ''), name: String(d.meta.name || ''), prompt: String(d.meta.prompt || '').slice(0, 4000),
        type: String(d.meta.type || ''), flowMediaId: String(d.meta.flowMediaId || ''),
      } : null,
    });
  } else if (d.type === 'exec-main-world') {
    const result = await ipcRenderer.invoke('flow-host:exec-main-world', d.payload || {});
    window.postMessage({ channel: TO_EXT, type: 'reply', replyTo: d.requestId, result }, '*');
  } else if (d.type === 'inject-main') {
    ipcRenderer.send('flow-host:inject-main', { file: String(d.file || '') });
  } else if (d.type === 'panel-state') {
    ipcRenderer.send('flow-host:panel-state', { open: d.open || null });
  } else if (d.type === 'send-to-editor') {
    ipcRenderer.send('flow-host:send-to-editor', { flowMediaIds: Array.isArray(d.flowMediaIds) ? d.flowMediaIds.map(String) : null });
  } else if (d.type === 'get-project') {
    const project = await ipcRenderer.invoke('flow-host:get-project');
    window.postMessage({ channel: TO_EXT, type: 'message', message: { action: 'studio-project', project } }, '*');
  } else if (d.type === 'hello') {
    window.postMessage({ channel: TO_EXT, type: 'host-ready' }, '*');
  }
});

ipcRenderer.on('flow-host:to-ext', (e, message) => {
  window.postMessage({ channel: TO_EXT, type: 'message', message }, '*');
});
