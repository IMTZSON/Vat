/* Programma per Windows: finestra dell'app, cattura audio del PC, scorciatoie globali,
   modalità compatta sopra il simulatore, tasto PTT di vPilot e aggiornamento automatico. */
'use strict';

const { app, BrowserWindow, ipcMain, shell, globalShortcut, session, desktopCapturer, dialog, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const server = require('./server');
const { Store } = require('./store');
const { PttController, keyNames } = require('./ptt');
const { createUpdater } = require('./updater');

let win = null;
let origin = '';
let normalBounds = null;
let store = null;
let ptt = null;
let updater = null;

const send = (channel, data) => { if (win && !win.isDestroyed()) win.webContents.send(channel, data); };

// Modulo nativo per osservare la tastiera di sistema: se manca o non si carica, il PTT resta disattivato
function loadPtt() {
  try {
    const { uIOhook, UiohookKey } = require('uiohook-napi');
    return new PttController(uIOhook, { names: keyNames(UiohookKey), onChange: (down) => send('ptt', !!down) });
  } catch (e) {
    return null;
  }
}

function loadUpdater() {
  // Solo nel programma installato (non in sviluppo né nella versione portatile)
  const supported = app.isPackaged && !process.env.PORTABLE_EXECUTABLE_DIR;
  let autoUpdater = null;
  if (supported) {
    try { ({ autoUpdater } = require('electron-updater')); } catch (e) { autoUpdater = null; }
  }
  return createUpdater({ autoUpdater, supported, send: (s) => send('updater', s) });
}

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
  store = new Store(path.join(app.getPath('userData'), 'readback-copilot-data.json'));
  const { port } = await server.start(path.join(__dirname, '..'), { desktop: true, version: app.getVersion(), build: buildInfo(), store });
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

  ptt = loadPtt();
  updater = loadUpdater();
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

ipcMain.handle('info', () => ({ version: app.getVersion(), origin, build: buildInfo() }));

// Archivio dati su file (vedi store.js)
ipcMain.handle('store-load', () => ({ data: store.all(), isNew: store.isNew }));
ipcMain.on('store-set', (e, key, value) => { store.set(String(key), value); });
ipcMain.handle('store-merge', (e, obj) => store.merge(obj));

// Tasto PTT (vedi ptt.js)
ipcMain.handle('ptt-available', () => !!ptt);
ipcMain.handle('ptt-set', (e, binding) => (ptt ? ptt.setBinding(binding) : null));
ipcMain.handle('ptt-capture', () => (ptt ? ptt.capture(15000) : null));

// Aggiornamento automatico (vedi updater.js)
ipcMain.handle('updater-state', () => (updater ? { ...updater.state, supported: updater.supported } : { state: 'unsupported', supported: false }));
ipcMain.handle('updater-check', () => (updater ? updater.check() : null));
ipcMain.handle('updater-install', () => (updater ? updater.install() : false));

function buildInfo() {
  try { return require('../package.json').buildNumber || null; } catch (e) { return null; }
}

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  try { if (ptt) ptt.release(); } catch (e) { /* ignora */ }
  try { if (store) store.flush(); } catch (e) { /* ignora */ }
});
app.on('window-all-closed', () => app.quit());
