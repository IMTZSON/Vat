/* Funzioni del programma Windows esposte in modo sicuro all'interfaccia (window.desktop). */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  setOnTop: (on) => ipcRenderer.send('set-on-top', !!on),
  setCompact: (on) => ipcRenderer.send('set-compact', !!on),
  openExternal: (url) => ipcRenderer.send('open-external', String(url)),
  saveText: (name, text) => ipcRenderer.invoke('save-text', { name: String(name), text: String(text) }),
  onHotkey: (fn) => ipcRenderer.on('hotkey', (_e, name) => fn(String(name))),
  info: () => ipcRenderer.invoke('info'),
  store: {
    load: () => ipcRenderer.invoke('store-load'),
    set: (key, value) => ipcRenderer.send('store-set', String(key), value),
    merge: (obj) => ipcRenderer.invoke('store-merge', obj),
  },
});
