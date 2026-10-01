import { app, BrowserWindow, Menu, shell, dialog } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import http from 'http';
import { BrowserManager } from './browser-manager.js';
import { Studio, registerAssetScheme } from './studio.js';

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
let browserManager = null;
let studio = null;

// Must happen before the app is ready.
registerAssetScheme();

function createWindow() {
  mainWindow = new BrowserWindow({
    width:     1280,
    height:    840,
    minWidth:  960,
    minHeight: 600,
    title:     'VoiceCraft Studio',
    icon:      path.join(__dirname, 'icon.ico'),
    backgroundColor: '#0a0a0a',  // match app dark theme
    show: false,
    webPreferences: {
      preload:          path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration:  false,
      sandbox:          true
    },
  });

  browserManager = new BrowserManager(mainWindow);
  Menu.setApplicationMenu(null);

  // The window shows the studio bar; each module runs in its own persistent
  // view below it (electron/studio.js).
  studio = new Studio(mainWindow, { baseUrl: DEV_URL, browserManager });
  browserManager.onFlowAsset = (savePath, meta) => studio.addFlowAsset({ savePath, meta });
  browserManager.onModuleKey = (input) => studio.moduleKey(input);
  browserManager.onSendToEditor = (flowMediaIds) => studio.sendFlowToEditor(flowMediaIds);
  browserManager.getStudioProject = () => studio.state.project;
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });
  mainWindow.webContents.once('did-finish-load', () => studio.switchTo(studio.state.lastModule || 'voicecraft'));

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => { mainWindow = null; });

  mainWindow.loadURL(DEV_URL + '/studio-shell.html');
}

app.whenReady().then(async () => {
  try {
    // 1. Start Server
    const { startServer } = await import('../server.js');
    await startServer(PORT);
    await waitForServer();
    
    // 2. Create Window. The built-in browser loads the Flow extension into
    // each profile's session itself (BrowserManager.ensureSession).
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

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});
