// VoiceCraft Studio — Electron preload
// Runs in an isolated context between main process and renderer.
// We expose NOTHING extra — the app communicates with its backend
// exclusively via HTTP (localhost:3000), same as in the browser/Railway build.
// contextIsolation: true ensures the renderer has no access to Node.js APIs.

window.addEventListener('DOMContentLoaded', () => {
  // Keep the window title consistent with the app name
  if (document.title === '') document.title = 'VoiceCraft Studio';
});
