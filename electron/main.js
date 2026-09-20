// VoiceCraft Studio — Electron main process
// Starts the existing server.js HTTP server then opens a BrowserWindow.
// No Node.js APIs are exposed to the renderer — all communication
// goes through the existing HTTP server at localhost:3000, exactly
// as in the Railway/browser deployment.

import { app, BrowserWindow, shell, Menu, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

// MUST be set before server.js is imported.
// Prevents server.js auto-start (avoids duplicate-listen errors when
// Electron also calls startServer() explicitly).
process.env.ELECTRON = '1';

// Config
const PORT    = process.env.PORT || 3000;
const DEV_URL = `http://localhost:${PORT}`;

// Wait for localhost:PORT/api/health to respond (max 15s).
// Polls every 200ms so the window never gets a brief ERR_CONNECTION_REFUSED.
function waitForServer(maxMs = 15_000, intervalMs = 200) {
  const deadline = Date.now() + maxMs;
  return new Promise((resolve, reject) => {
    function probe() {
      const req = http.get(`${DEV_URL}/api/health`, (res) => {
        res.resume();
        resolve();
      });
      req.setTimeout(intervalMs);
      req.on('timeout', () => req.destroy());
      req.on('error', () => {
        if (Date.now() >= deadline) {
          reject(new Error(`VoiceCraft server did not respond within ${maxMs}ms`));
        } else {
          setTimeout(probe, intervalMs);
        }
      });
    }
    probe();
  });
}

let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1280,
    height:    840,
    minWidth:  960,
    minHeight: 600,
    title:     'VoiceCraft Studio',
    icon:      path.join(__dirname, 'icon.ico'),
    backgroundColor: '#0a0a0a',  // match app dark theme — no white flash
    show: false,                 // show only after first paint
    webPreferences: {
      preload:          path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          false,   // lets preload.js use require() if ever needed
    },
  });

  // Clean app — no File/Edit/View/Help menu bar
  Menu.setApplicationMenu(null);

  // Open _blank links in the system browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadURL(DEV_URL);
}

app.whenReady().then(async () => {
  try {
    // Import server.js AFTER setting ELECTRON=1 so it does not auto-start.
    const { startServer } = await import('../server.js');
    await startServer(PORT);
    await waitForServer();
    createWindow();
  } catch (err) {
    console.error('[VoiceCraft] Startup error:', err);
    dialog.showErrorBox(
      'VoiceCraft Studio — startup error',
      `The internal server could not start:\n\n${err.message}`
    );
    app.quit();
  }
});

// Quit when all windows closed (Windows / Linux)
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// macOS: re-open window when dock icon clicked
app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
