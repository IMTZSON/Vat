/* Funzioni del programma Windows esposte in modo sicuro all'interfaccia (window.desktop). */
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  setOnTop: (on) => ipcRenderer.send('set-on-top', !!on),
  setCompact: (on) => ipcRenderer.send('set-compact', !!on),
  openExternal: (url) => ipcRenderer.send('open-external', String(url)),
  saveText: (name, text) => ipcRenderer.invoke('save-text', { name: String(name), text: String(text) }),
  saveFile: (name, base64) => ipcRenderer.invoke('save-file', { name: String(name), base64: String(base64) }),
  onHotkey: (fn) => ipcRenderer.on('hotkey', (_e, name) => fn(String(name))),
  info: () => ipcRenderer.invoke('info'),
  ptt: {
    available: () => ipcRenderer.invoke('ptt-available'),
    set: (binding) => ipcRenderer.invoke('ptt-set', binding || null),
    capture: () => ipcRenderer.invoke('ptt-capture'),
    onChange: (fn) => ipcRenderer.on('ptt', (_e, down) => fn(!!down)),
  },
  updater: {
    state: () => ipcRenderer.invoke('updater-state'),
    check: () => ipcRenderer.invoke('updater-check'),
    install: () => ipcRenderer.invoke('updater-install'),
    onState: (fn) => ipcRenderer.on('updater', (_e, s) => fn(s)),
  },
  sim: {
    enable: (on) => ipcRenderer.send('sim-enable', !!on),
    status: () => ipcRenderer.invoke('sim-status'),
    onData: (fn) => ipcRenderer.on('sim-data', (_e, d) => fn(d)),
    onStatus: (fn) => ipcRenderer.on('sim-status', (_e, s) => fn(String(s))),
    onTouchdown: (fn) => ipcRenderer.on('sim-touchdown', (_e, ev) => fn(ev)),
  },
  // Collegamento col telefono in Wi-Fi
  link: {
    enable: (on) => ipcRenderer.invoke('link-enable', !!on),
    info: () => ipcRenderer.invoke('link-info'),
    regenerate: () => ipcRenderer.invoke('link-regenerate'),
    publish: (type, data) => ipcRenderer.send('link-publish', String(type), data),
    onCommand: (fn) => ipcRenderer.on('link-command', (_e, c) => fn(c)),
  },
  store: {
    load: () => ipcRenderer.invoke('store-load'),
    set: (key, value) => ipcRenderer.send('store-set', String(key), value),
    merge: (obj) => ipcRenderer.invoke('store-merge', obj),
  },
});
