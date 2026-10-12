/* Archivio delle impostazioni e dei dati dell'app su file (cartella dati utente di Windows).
   Prima stavano nel localStorage del browser, legato alla porta del server locale: se la porta
   cambiava, l'utente ritrovava l'app vuota. Scrittura atomica (file temporaneo + rinomina),
   raggruppata per non scrivere a ogni tasto premuto. */
'use strict';

const fs = require('fs');
const path = require('path');

const MAX_VALUE = 2 * 1024 * 1024;

class Store {
  constructor(file, opts) {
    this.file = file;
    this.delay = (opts && opts.delay) || 300;
    this.data = {};
    this.timer = null;
    try {
      const raw = fs.readFileSync(file, 'utf8');
      const obj = JSON.parse(raw);
      if (obj && typeof obj === 'object' && !Array.isArray(obj)) this.data = obj;
    } catch (e) {
      // File mancante o rovinato: si riparte vuoti, ma il file rovinato si conserva per sicurezza
      if (e.code !== 'ENOENT' && fs.existsSync(file)) {
        try { fs.copyFileSync(file, `${file}.corrupt-${Date.now()}`); } catch (err) { /* ignora */ }
      }
    }
  }

  get isNew() { return !Object.keys(this.data).length; }

  all() { return { ...this.data }; }

  get(key) { return this.data[key]; }

  // Solo chiavi dell'app e valori serializzabili di dimensione ragionevole
  set(key, value) {
    if (typeof key !== 'string' || !/^readback-copilot[\w.-]*$/.test(key)) return false;
    if (value === undefined || value === null) delete this.data[key];
    else {
      const size = JSON.stringify(value).length;
      if (size > MAX_VALUE) return false;
      this.data[key] = value;
    }
    this.schedule();
    return true;
  }

  // Importa i dati dal vecchio localStorage (solo le chiavi che il file non ha ancora)
  merge(obj) {
    let n = 0;
    for (const [k, v] of Object.entries(obj || {})) if (!(k in this.data) && this.set(k, v)) n++;
    return n;
  }

  schedule() {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), this.delay);
  }

  flush() {
    clearTimeout(this.timer);
    this.timer = null;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data));
    fs.renameSync(tmp, this.file);
  }
}

module.exports = { Store };
