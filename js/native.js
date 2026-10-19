/* App per iOS e Android (Capacitor): voce e riconoscimento vocale nativi, QR del PC, condivisione
   delle immagini, vibrazione, schermo sempre acceso in volo, barra di stato. Nel browser e nel
   programma per Windows non fa niente. Le richieste di rete native (senza blocchi CORS) le attiva
   CapacitorHttp nella configurazione: fetch() passa già dal telefono. */
(function (root) {
  'use strict';

  const Cap = root.Capacitor;
  const isNative = !!(Cap && Cap.isNativePlatform && Cap.isNativePlatform());
  if (!isNative) return;
  const P = (global, name) => (root[global] && root[global][name]) || (Cap.Plugins && Cap.Plugins[name]) || null;
  const TextToSpeech = P('capacitorTextToSpeech', 'TextToSpeech');
  const Speech = P('capacitorSpeechRecognition', 'SpeechRecognition');
  const Barcode = P('capacitorBarcodeScanner', 'BarcodeScanner');
  const Share = P('capacitorShare', 'Share');
  const Filesystem = P('capacitorFilesystemPluginCapacitor', 'Filesystem');
  const Haptics = P('capacitorHaptics', 'Haptics');
  const KeepAwake = P('capacitorKeepAwake', 'KeepAwake');
  const StatusBar = P('capacitorStatusBar', 'StatusBar');
  const platform = Cap.getPlatform();
  document.documentElement.classList.add('is-native', `is-${platform}`);

  // ---------------------------------------------------------------- voce (Android non ha speechSynthesis)
  if (TextToSpeech && root.TTS) {
    root.TTS.speak = function speak(text, opts) {
      if (!text) return Promise.resolve();
      const o = opts || {};
      const it = o.lang === 'it';
      const go = () => TextToSpeech.speak({ text, lang: it ? 'it-IT' : 'en-GB', rate: o.rate || this.rate || 1, pitch: 1, volume: 1, category: 'playback', queueStrategy: o.queue ? 1 : 0 }).catch(() => {});
      return o.queue ? go() : TextToSpeech.stop().catch(() => {}).then(go);
    };
    root.TTS.stop = () => { TextToSpeech.stop().catch(() => {}); };
    root.TTS.voices = () => [];
  }

  // ---------------------------------------------------------------- riconoscimento vocale nativo
  // Stessa interfaccia di webkitSpeechRecognition: modalità "gratis" di ascolto e allenamento
  if (Speech && !(root.SpeechRecognition || root.webkitSpeechRecognition)) {
    class NativeRecognition {
      constructor() {
        this.lang = 'en-US';
        this.continuous = false;
        this.interimResults = true;
        this.onresult = null;
        this.onerror = null;
        this.onend = null;
        this.running = false;
        this.last = '';
        this.subs = [];
      }

      emit(text, isFinal) {
        if (!this.onresult || !text) return;
        const res = [{ transcript: text }];
        res.isFinal = isFinal;
        this.onresult({ resultIndex: 0, results: [res] });
      }

      async begin() {
        this.last = '';
        await Speech.start({ language: this.lang, maxResults: 1, partialResults: true, popup: false });
      }

      async start() {
        try {
          const perm = await Speech.requestPermissions();
          if (perm && perm.speechRecognition && perm.speechRecognition !== 'granted') throw new Error('permission');
          this.running = true;
          this.subs.push(await Speech.addListener('partialResults', (d) => { const m = d && d.matches && d.matches[0]; if (m) { this.last = m; this.emit(m, false); } }));
          // Android si ferma dopo una pausa: in modalità continua la frase diventa definitiva e si riparte
          this.subs.push(await Speech.addListener('listeningState', (d) => {
            if (!d || d.status !== 'stopped' || !this.running) return;
            if (this.last) this.emit(this.last, true);
            if (this.continuous) this.begin().catch(() => this.finish());
            else this.finish();
          }));
          await this.begin();
        } catch (e) {
          this.running = false;
          if (this.onerror) this.onerror({ error: e.message === 'permission' ? 'not-allowed' : 'audio-capture' });
          this.finish();
        }
      }

      finish() {
        this.running = false;
        for (const s of this.subs.splice(0)) { try { s.remove(); } catch (e) { /* già rimosso */ } }
        if (this.onend) { const fn = this.onend; this.onend = null; fn(); }
      }

      async stop() {
        if (!this.running) return;
        this.running = false;
        try { await Speech.stop(); } catch (e) { /* già fermo */ }
        if (this.last) this.emit(this.last, true);
        this.finish();
      }

      abort() { this.last = ''; this.stop(); }
    }
    root.webkitSpeechRecognition = NativeRecognition;
  }

  root.App.register((App) => {
    App.native = {
      platform,
      // QR del PC con la fotocamera -> testo
      async scanQr() {
        if (!Barcode) throw new Error('QR non disponibile');
        if (platform === 'android' && Barcode.isGoogleBarcodeScannerModuleAvailable) {
          const { available } = await Barcode.isGoogleBarcodeScannerModuleAvailable();
          if (!available) await Barcode.installGoogleBarcodeScannerModule();
        }
        const { barcodes } = await Barcode.scan({ formats: ['QR_CODE'] });
        return barcodes && barcodes[0] ? barcodes[0].rawValue : '';
      },
      // Immagine (data URL) nel foglio di condivisione del telefono
      async shareImage(name, dataUrl) {
        if (!Share || !Filesystem) return false;
        const file = await Filesystem.writeFile({ path: name, data: dataUrl.split(',')[1], directory: 'CACHE' });
        await Share.share({ title: name, files: [file.uri] });
        return true;
      },
      haptic() { if (Haptics) Haptics.impact({ style: 'MEDIUM' }).catch(() => {}); },
    };
    if (!Barcode) App.native.scanQr = null;

    // Salva immagine = condividi (Foto, WhatsApp, Discord…)
    App.desktop.saveImage = async (name, dataUrl) => {
      try { return await App.native.shareImage(name, dataUrl); } catch (e) { return false; }
    };

    // Vibrazione quando arriva una chiamata per te
    App.on('readback', (item) => { if (item && item.result && item.result.forUs === true) App.native.haptic(); });

    // Schermo sempre acceso mentre ascolti o segui il volo
    let awake = false;
    const keep = (on) => {
      if (!KeepAwake || on === awake) return;
      awake = on;
      (on ? KeepAwake.keepAwake() : KeepAwake.allowSleep()).catch(() => {});
    };
    App.on('listening', (on) => keep(!!on || !!(App.isTracking && App.isTracking())));
    App.on('track', (e) => keep(!!(e && e.phase && e.phase !== 'arrived') || !!(App.isListening && App.isListening())));
    App.on('link', (st) => keep(st === 'on' || !!(App.isListening && App.isListening())));

    // Barra di stato sopra la mappa, testo chiaro o scuro come il tema
    if (StatusBar) {
      StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
      const style = () => StatusBar.setStyle({ style: document.documentElement.dataset.theme === 'dark' || (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches) ? 'DARK' : 'LIGHT' }).catch(() => {});
      style();
      App.on('theme', style);
    }
  });
})(this);
