/* Aggiornamento automatico in un clic (electron-updater).
   Sorgente: l'ultima release STABILE su GitHub (quella costruita da main), letta tramite
   https://github.com/IMTZSON/Vat/releases/latest/download/latest.yml (vedi "publish" in package.json).
   Scarica in background; installa solo quando l'utente preme "Riavvia e aggiorna" o all'uscita:
   mai un riavvio a sorpresa durante un volo. Non disponibile nella versione portatile.
   Logica separata dal modulo vero (iniettato) per poterla testare. */
'use strict';

function createUpdater({ autoUpdater, send, supported }) {
  let state = { state: supported ? 'idle' : 'unsupported' };
  const emit = (patch) => {
    state = { ...state, ...patch };
    send(state);
  };

  if (supported && autoUpdater) {
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;
    autoUpdater.allowDowngrade = false;
    autoUpdater.on('checking-for-update', () => emit({ state: 'checking' }));
    autoUpdater.on('update-not-available', () => emit({ state: 'current' }));
    autoUpdater.on('update-available', (info) => emit({ state: 'downloading', version: info && info.version, percent: 0 }));
    autoUpdater.on('download-progress', (p) => emit({ state: 'downloading', percent: Math.round((p && p.percent) || 0) }));
    autoUpdater.on('update-downloaded', (info) => emit({ state: 'ready', version: info && info.version, percent: 100 }));
    autoUpdater.on('error', (err) => emit({ state: 'error', message: String((err && err.message) || err).slice(0, 300) }));
  }

  return {
    get state() { return state; },
    supported: !!(supported && autoUpdater),

    async check() {
      if (!this.supported || ['checking', 'downloading', 'ready'].includes(state.state)) return state;
      try { await autoUpdater.checkForUpdates(); } catch (e) { emit({ state: 'error', message: String(e.message || e).slice(0, 300) }); }
      return state;
    },

    install() {
      if (!this.supported || state.state !== 'ready') return false;
      // isSilent: installer senza finestre; isForceRunAfter: riapre il programma aggiornato
      autoUpdater.quitAndInstall(true, true);
      return true;
    },
  };
}

module.exports = { createUpdater };
