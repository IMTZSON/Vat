/* Programma per Windows: finestra dell'app, cattura audio del PC, scorciatoie globali
   e modalità compatta sopra il simulatore. */
'use strict';

const { app, BrowserWindow, ipcMain, shell, globalShortcut, session, desktopCapturer, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const server = require('./server');

let win = null;
let origin = '';
let normalBounds = null;

const HOTKEYS = {
  'CommandOrControl+Shift+L': 'toggle-listen',
  'CommandOrControl+Shift+R': 'speak',
  'CommandOrControl+Shift+O': 'overlay',
};

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return;
    if (win.isMinimized()) win.restore();
    win.focus();
  });
  app.whenReady().then(init).catch((e) => {
    dialog.showErrorBox('Readback Copilot', `Avvio non riuscito: ${e.message}`);
    app.quit();
  });
}

async function init() {
  Menu.setApplicationMenu(null);
  const { port } = await server.start(path.join(__dirname, '..'), { desktop: true, version: app.getVersion() });
  origin = `http://127.0.0.1:${port}`;

  const ses = session.defaultSession;
  const allowed = ['media', 'display-capture', 'clipboard-sanitized-write', 'speaker-selection'];
  ses.setPermissionRequestHandler((wc, permission, cb) => cb(allowed.includes(permission)));
  ses.setPermissionCheckHandler((wc, permission) => allowed.includes(permission));
  // "Audio del PC": cattura l'audio di sistema senza finestra di scelta.
  ses.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] })
      .then((sources) => callback({ video: sources[0], audio: 'loopback' }))
      .catch(() => callback({}));
  });

  createWindow();
  for (const [accel, name] of Object.entries(HOTKEYS)) {
    try { globalShortcut.register(accel, () => win && win.webContents.send('hotkey', name)); } catch (e) { /* scorciatoia occupata */ }
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 360,
    minHeight: 200,
    backgroundColor: '#0b1220',
    title: 'Readback Copilot',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  win.loadURL(`${origin}/`);

  const isInternal = (url) => url === origin || url.startsWith(`${origin}/`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!isInternal(url)) {
      e.preventDefault();
      if (/^https?:\/\//.test(url)) shell.openExternal(url);
    }
  });
  win.on('closed', () => { win = null; });
}

ipcMain.on('set-on-top', (e, on) => {
  if (win) win.setAlwaysOnTop(!!on, 'screen-saver');
});

ipcMain.on('set-compact', (e, on) => {
  if (!win) return;
  if (on) {
    if (!normalBounds) normalBounds = win.getBounds();
    if (win.isMaximized()) win.unmaximize();
    win.setSize(560, 250);
    win.setAlwaysOnTop(true, 'screen-saver');
  } else {
    win.setAlwaysOnTop(false);
    if (normalBounds) win.setBounds(normalBounds);
    normalBounds = null;
  }
});

ipcMain.on('open-external', (e, url) => {
  if (/^https?:\/\//.test(String(url))) shell.openExternal(String(url));
});

ipcMain.handle('save-text', async (e, { name, text }) => {
  const safe = String(name || 'readback.txt').replace(/[^\w.-]/g, '_');
  const ext = (path.extname(safe).slice(1) || 'txt').toLowerCase();
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), safe),
    filters: [{ name: ext === 'csv' ? 'CSV (Excel)' : 'Testo', extensions: [ext] }],
  });
  if (r.canceled || !r.filePath) return false;
  await fs.promises.writeFile(r.filePath, String(text), 'utf8');
  return true;
});

ipcMain.handle('info', () => ({ version: app.getVersion(), origin }));

app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => app.quit());
