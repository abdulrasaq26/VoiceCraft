// Preload for built-in browser tabs. Exposes nothing to the page; it only
// relays between the Flow Downloader content scripts (via window.postMessage,
// see content/host-bridge.js) and the main process, which provides what
// Electron's extension support lacks (chrome.downloads, chrome.scripting).
const { ipcRenderer, webFrame } = require('electron');

// flow.google.com wraps the page's reCAPTCHA execute() so that tokens asked
// for by anything but Flow's own code are stamped "extension_hijack_detected"
// (Google then rejects the request as unusual activity). Before any page
// script runs, watch the grecaptcha → enterprise → execute assignments and
// keep the genuine (native) execute as window.__vcRealExecute; the public one
// stays native too. Flow's own code uses its private copy, so Flow is unaffected.
const RECAPTCHA_TRAP = `(function () {
  if (window.__vcRecapTrap) return; window.__vcRecapTrap = true;
  var isNative = function (fn) { try { return typeof fn === 'function' && Function.prototype.toString.call(fn).indexOf('[native code]') >= 0; } catch (_) { return false; } };
  var keep = function (ent, fn) { try { var b = fn.bind(ent); window.__vcRealExecute = function (k, o) { return b(k, o); }; } catch (_) {} };
  var trapExecute = function (ent) {
    if (!ent || ent.__vcTrapped) return;
    var current; try { current = ent.execute; } catch (_) {}
    if (isNative(current)) keep(ent, current);
    try {
      Object.defineProperty(ent, 'execute', { configurable: true, enumerable: true,
        get: function () { return current; },
        set: function (v) { if (isNative(v)) { current = v; keep(ent, v); } else if (!isNative(current)) { current = v; } } });
      ent.__vcTrapped = true;
    } catch (_) { if (isNative(current)) keep(ent, current); }
  };
  var trapGre = function (gre) {
    if (!gre || gre.__vcGreTrapped) return; gre.__vcGreTrapped = true;
    var ent; try { ent = gre.enterprise; } catch (_) {}
    if (ent) { trapExecute(ent); return; }
    try { Object.defineProperty(gre, 'enterprise', { configurable: true, enumerable: true, get: function () { return ent; }, set: function (v) { ent = v; trapExecute(v); } }); } catch (_) {}
  };
  if (window.grecaptcha) { trapGre(window.grecaptcha); return; }
  var g;
  try { Object.defineProperty(window, 'grecaptcha', { configurable: true, enumerable: true, get: function () { return g; }, set: function (v) { g = v; trapGre(v); } }); } catch (_) {}
})();`;
if (/(^|\.)flow\.google\.com$/i.test(location.hostname)) {
  webFrame.executeJavaScript(RECAPTCHA_TRAP).catch(() => {});
}

// Google sign-in pages see a standard Firefox (see browser-manager.js): hide
// the Chromium-only navigator.userAgentData there too, before the page runs.
if (/^accounts\.google\.com$/i.test(location.hostname)) {
  webFrame.executeJavaScript(
    "try { Object.defineProperty(Navigator.prototype, 'userAgentData', { get: () => undefined, configurable: true }); } catch (e) {}"
  ).catch(() => {});
}

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
  } else if (d.type === 'import-media') {
    // Flow Downloader → AutoEditor. Bytes (ArrayBuffer) or URLs; the main
    // process fetches URLs with this tab's session.
    const items = Array.isArray(d.items) ? d.items.slice(0, 1000).map((it) => ({
      name: String(it.name || '').slice(0, 200), type: it.type === 'video' ? 'video' : 'image',
      url: typeof it.url === 'string' ? it.url : '', mime: typeof it.mime === 'string' ? it.mime : '',
      key: String(it.key || '').slice(0, 300), flowMediaId: String(it.flowMediaId || '').slice(0, 200),
      bytes: it.bytes instanceof ArrayBuffer ? it.bytes : null,
    })) : [];
    const result = await ipcRenderer.invoke('flow-host:import-media', { items });
    window.postMessage({ channel: TO_EXT, type: 'reply', replyTo: d.requestId, result }, '*');
  } else if (d.type === 'get-flow-auth') {
    const result = await ipcRenderer.invoke('flow-host:get-flow-auth');
    window.postMessage({ channel: TO_EXT, type: 'reply', replyTo: d.requestId, result }, '*');
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
