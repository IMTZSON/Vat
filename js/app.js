/* Nucleo dell'interfaccia: impostazioni, schede, notifiche e ponte col programma Windows. */
(function (root) {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'readback-copilot-settings';

  const DEFAULTS = {
    callsign: '',
    telephony: '',
    mode: 'free',
    lang: 'en-US',
    hideOthers: true,
    beep: true,
    groqKey: '',
    useAI: true,
    audioSource: 'device',
    device: '',
    micDevice: '',
    whisperModel: '',
    llmModel: '',
    threshold: 0.02,
    autoThreshold: true,
    trainPhase: 'delivery',
    trainDifficulty: 'normal',
    trainShowText: false,
    simbriefUser: '',
    callStand: '',
    ttsVoice: '',
    ttsRate: 1,
    onTop: false,
    mapKey: '',
    paLang: 'it-en',
    simLink: true,
    proKey: '',
    proInstance: '',
    captainName: '',
    airlineName: '',
    aircraft: 'A320',
    cabSource: 'auto',
    cabMinutes: 90,
    tab: 'listen',
    uiLang: 'auto',
    sttProvider: 'groq',
    localSttUrl: '',
    coach: false,
    checkUpdates: true,
    onboarded: false,
    pttKey: null,
    telemetry: false,
    crashReports: false,
    telemetryId: '',
    phoneLink: false,
    linkHost: '',
    linkToken: '',
    linkName: '',
  };

  /* Archivio dati. Backend scelto all'avvio (storage.init):
     - 'file': programma per Windows, file nella cartella dati utente (electron/store.js);
     - 'server': Chrome aperto dal programma, stesso file tramite il server locale;
     - 'local': localStorage del browser.
     Il localStorage resta come copia di sicurezza. Al primo avvio col file si importano i vecchi dati. */
  const PREFIX = 'readback-copilot';
  const local = {
    get(key) { try { const v = localStorage.getItem(key); return v === null ? undefined : JSON.parse(v); } catch (e) { return undefined; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage non disponibile */ } },
    all() {
      const out = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i);
          if (k && k.startsWith(PREFIX)) { const v = local.get(k); if (v !== undefined && v !== null) out[k] = v; }
        }
      } catch (e) { /* storage non disponibile */ }
      return out;
    },
  };
  let cache = null;
  const copy = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
  const nativePrefs = () => (root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform() && root.capacitorPreferences ? root.capacitorPreferences.Preferences : null);

  const storage = {
    backend: 'local',

    async init() {
      const br = root.desktop && root.desktop.store;
      try {
        if (br) {
          const { data, isNew } = await br.load();
          cache = data || {};
          if (isNew) {
            const old = local.all();
            if (Object.keys(old).length) { await br.merge(old); cache = { ...old, ...cache }; }
          }
          this.backend = 'file';
        } else if (nativePrefs()) {
          // App per telefono: archivio nativo (Preferences), che il sistema non cancella come la cache del browser
          const prefs = nativePrefs();
          const { keys } = await prefs.keys();
          cache = {};
          for (const k of keys.filter((x) => x.startsWith('readback-copilot'))) {
            const { value } = await prefs.get({ key: k });
            try { cache[k] = JSON.parse(value); } catch (e) { /* valore illeggibile */ }
          }
          const old = local.all();
          for (const [k, v] of Object.entries(old)) if (!(k in cache)) { cache[k] = v; prefs.set({ key: k, value: JSON.stringify(v) }); }
          this.backend = 'native';
        } else if (root.location && /^https?:$/.test(root.location.protocol)) {
          const r = await fetch('api/store', { cache: 'no-store' });
          const data = r.ok ? (await r.json()).data : null;
          if (data) { cache = data; this.backend = 'server'; }
        }
      } catch (e) { cache = null; this.backend = 'local'; }
    },

    get(key, fallback) {
      const v = cache ? copy(cache[key]) : local.get(key);
      return v === undefined || v === null ? fallback : v;
    },

    // Restituisce una promessa che si risolve quando il dato è al sicuro
    set(key, value) {
      local.set(key, value);
      if (!cache) return Promise.resolve();
      cache[key] = copy(value);
      if (this.backend === 'file') { root.desktop.store.set(key, cache[key]); return Promise.resolve(); }
      if (this.backend === 'native') {
        const prefs = nativePrefs();
        return (value === undefined || value === null ? prefs.remove({ key }) : prefs.set({ key, value: JSON.stringify(value) })).catch(() => {});
      }
      return fetch('api/store', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Readback-Copilot': '1' }, body: JSON.stringify({ key, value }) })
        .then(() => {}, () => {});
    },
  };

  const listeners = {};

  // Ponte col programma per Windows (electron/preload.js); nel browser usa alternative.
  const bridge = root.desktop || null;
  const desktop = {
    available: !!bridge,
    setOnTop: (on) => bridge && bridge.setOnTop(on),
    setCompact: (on) => bridge && bridge.setCompact(on),
    openExternal(url) {
      if (bridge) bridge.openExternal(url);
      else root.open(url, '_blank', 'noopener');
    },
    async saveText(name, text) {
      if (bridge) return bridge.saveText(name, text);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
      a.download = name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      return true;
    },
    // Immagine PNG da un canvas (dataURL): nel programma con la finestra "Salva", nel browser come download
    async saveImage(name, dataUrl) {
      const base64 = String(dataUrl).split(',')[1] || '';
      if (bridge && bridge.saveFile) return bridge.saveFile(name, base64);
      const a = document.createElement('a');
      a.href = dataUrl;
      a.download = name;
      a.click();
      return true;
    },
    onHotkey: (fn) => bridge && bridge.onHotkey(fn),
    ptt: bridge && bridge.ptt ? bridge.ptt : null,
    sim: bridge && bridge.sim ? bridge.sim : null,
    updater: bridge && bridge.updater ? bridge.updater : null,
    info: () => (bridge ? bridge.info() : Promise.resolve(null)),
  };

  const App = {
    $,
    storage,
    desktop,
    defaults: DEFAULTS,
    settings: { ...DEFAULTS },
    storedKeys: [],
    flight: null,
    modules: [],

    // Carica i dati salvati (prima di start)
    async load() {
      await storage.init();
      const stored = storage.get(STORE_KEY, {});
      // Chi aveva già la 3.x (solo in italiano) resta in italiano anche su un Windows in inglese
      if (Object.keys(stored).length && !('uiLang' in stored)) stored.uiLang = 'it';
      this.settings = { ...DEFAULTS, ...stored };
      this.storedKeys = Object.keys(stored);
      this.flight = storage.get('readback-copilot-flight', null);
      root.I18n.setLang(this.settings.uiLang);
    },

    save() { this._lastSave = storage.set(STORE_KEY, this.settings); return this._lastSave; },

    set(key, value) {
      this.settings[key] = value;
      this.save();
      this.emit(`setting:${key}`, value);
    },

    on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    emit(evt, data) { (listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); },

    register(fn) { this.modules.push(fn); },

    t: (k, v) => root.I18n.t(k, v),

    // PTT di vPilot disponibile (programma per Windows) e impostato
    pttAvailable: false,
    pttActive() { const k = this.settings.pttKey; return !!(k && (k.kind === 'gamepad' ? this.gamepad : this.pttAvailable)); },
    gamepad: null,

    // Il riconoscimento vocale è configurato? (chiave Groq, server locale o modalità Chrome)
    sttReady() {
      const s = this.settings;
      if (s.mode === 'free') return true;
      if (s.sttProvider === 'pro') return !!(root.Net && root.Net.pro && s.proKey && s.proInstance);
      return s.sttProvider === 'local' ? !!s.localSttUrl : !!s.groqKey;
    },

    callsignInfo() { return root.Readback.parseCallsign(this.settings.callsign, this.settings.telephony); },

    setFlight(f) {
      this.flight = f;
      storage.set('readback-copilot-flight', f);
      this.emit('flight', f);
    },

    toast(msg, ms) {
      const t = $('toast');
      t.textContent = msg;
      t.hidden = false;
      clearTimeout(this._toastTimer);
      this._toastTimer = setTimeout(() => { t.hidden = true; }, ms || 3500);
    },

    setStatus(text, cls) {
      const el = $('status');
      el.textContent = text;
      el.className = `status ${cls || 'idle'}`;
    },

    // Schede principali (tab bar) e sotto-pagine (es. Altro › Impostazioni) con pulsante indietro
    switchTab(id) {
      const view = document.querySelector(`.view[data-view="${id}"]`) || document.querySelector('.view[data-view="listen"]');
      id = view.dataset.view;
      const parent = view.dataset.parent || null;
      document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === (parent || id)));
      document.querySelectorAll('.view').forEach((v) => { v.hidden = v !== view; });
      const titleOf = (v) => (v.dataset.i18nTitleKey ? this.t(v.dataset.i18nTitleKey) : v.dataset.title);
      $('topTitle').textContent = titleOf(view) || 'Readback Copilot';
      const back = $('backBtn');
      back.hidden = !parent;
      back.dataset.target = parent || '';
      if (parent) back.querySelector('span').textContent = titleOf(document.querySelector(`.view[data-view="${parent}"]`));
      if (this.settings.tab !== id) this.set('tab', id);
      if ($('panelScroll')) $('panelScroll').scrollTop = 0;
      this.emit('tab', id);
    },

    // Controlli segmentati iOS costruiti sopra le <select class="seg">
    buildSegmented() {
      document.querySelectorAll('select.seg').forEach((sel) => {
        const seg = document.createElement('div');
        seg.className = 'segmented';
        const sync = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.value === sel.value));
        for (const o of sel.options) {
          const b = document.createElement('button');
          b.type = 'button';
          b.textContent = o.textContent;
          b.dataset.value = o.value;
          b.addEventListener('click', () => { sel.value = o.value; sel.dispatchEvent(new Event('change')); sync(); });
          seg.append(b);
        }
        sel.after(seg);
        sync();
        if (sel.dataset.setting) this.on(`setting:${sel.dataset.setting}`, () => setTimeout(sync));
        sel.addEventListener('sync', sync);
      });
    },

    setCompact(on) {
      document.body.classList.toggle('compact', on);
      if (on) this.switchTab('listen');
      desktop.setCompact(on);
      if (!on) desktop.setOnTop(this.settings.onTop);
    },

    async refreshDevices(unlock) {
      try {
        if (unlock) await root.AudioCapture.unlockDeviceLabels();
        const inputs = await root.AudioCapture.listInputs();
        for (const id of ['device', 'micDevice']) {
          const sel = $(id);
          sel.innerHTML = '';
          sel.append(new Option(this.t('settings.default'), ''));
          for (const d of inputs) {
            if (!d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') continue;
            const o = document.createElement('option');
            o.value = d.deviceId;
            o.textContent = d.label || this.t('app.unnamedDevice');
            sel.append(o);
          }
          sel.value = this.settings[id];
          if (sel.value !== this.settings[id]) sel.value = '';
        }
      } catch (e) {
        this.toast(this.t('app.devicesError', { msg: e.message }));
      }
    },

    bindSettings() {
      document.querySelectorAll('[data-setting]').forEach((el) => {
        const key = el.dataset.setting;
        const read = () => (el.type === 'checkbox' ? el.checked : (el.type === 'range' ? Number(el.value) : el.value));
        const write = () => { if (el.type === 'checkbox') el.checked = !!this.settings[key]; else el.value = this.settings[key]; };
        write();
        this.on(`setting:${key}`, () => { if (read() !== this.settings[key]) write(); });
        const evt = el.tagName === 'SELECT' || el.type === 'checkbox' ? 'change' : 'input';
        el.addEventListener(evt, () => this.set(key, read()));
      });
    },

    async start() {
      root.Icons.hydrate(document);
      // Pulsante per uscire dalla modalità compatta (la barra in alto è nascosta)
      const exit = document.createElement('button');
      exit.className = 'fab compact-exit glass';
      exit.title = this.t('app.exitCompact');
      exit.innerHTML = root.Icons.svg('maximize-2');
      exit.addEventListener('click', () => this.setCompact(false));
      document.body.append(exit);

      // Il Pro compare solo quando il suo server è configurato (package.json "pro")
      if (!(root.Net && root.Net.pro)) {
        document.querySelectorAll('option[data-pro]').forEach((o) => o.remove());
        if (this.settings.sttProvider === 'pro') this.settings.sttProvider = 'groq';
      }
      this.bindSettings();
      this.buildSegmented();
      // Cambio lingua: si ricarica la pagina (tutti i testi si rigenerano nella nuova lingua)
      this.on('setting:uiLang', () => setTimeout(() => Promise.resolve(this._lastSave).then(() => location.reload()), 120));
      // Groq o server Whisper locale: mostra solo i campi che servono
      const sttUi = () => {
        document.body.classList.toggle('stt-local', this.settings.sttProvider === 'local');
        document.body.classList.toggle('stt-pro', this.settings.sttProvider === 'pro');
      };
      this.on('setting:sttProvider', sttUi);
      sttUi();
      document.querySelectorAll('[data-onboard]').forEach((b) => b.addEventListener('click', () => this.emit('onboard')));
      document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => this.switchTab(b.dataset.tab)));
      document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => this.switchTab(b.dataset.go)));
      document.querySelectorAll('[data-tab-go]').forEach((b) => b.addEventListener('click', () => this.switchTab(b.dataset.tabGo)));
      $('backBtn').addEventListener('click', () => this.switchTab($('backBtn').dataset.target || 'more'));
      $('overlayBtn').addEventListener('click', () => this.setCompact(!document.body.classList.contains('compact')));
      document.querySelectorAll('.refreshDevices').forEach((b) => b.addEventListener('click', () => this.refreshDevices(true)));

      this.on('setting:onTop', (v) => desktop.setOnTop(v));
      if (this.settings.onTop) desktop.setOnTop(true);

      // Groq ha cambiato modello (quello impostato non esiste più): salvalo e avvisa.
      root.Groq.onModelChange = (kind, model) => {
        const key = kind === 'stt' ? 'whisperModel' : 'llmModel';
        if (this.settings[key] === model) return;
        const was = this.settings[key];
        this.set(key, model);
        if (was) this.toast(this.t('app.modelRetired', { was, model }), 6000);
      };

      root.TTS.voiceName = this.settings.ttsVoice;
      root.TTS.rate = this.settings.ttsRate;
      this.on('setting:ttsVoice', (v) => { root.TTS.voiceName = v; });
      this.on('setting:ttsRate', (v) => { root.TTS.rate = v; });
      const fillVoices = () => {
        const sel = $('ttsVoice');
        sel.innerHTML = '';
        sel.append(new Option(this.t('settings.automaticF'), ''));
        for (const v of root.TTS.voices()) {
          const o = document.createElement('option');
          o.value = v.name;
          o.textContent = `${v.name} (${v.lang})`;
          sel.append(o);
        }
        sel.value = this.settings.ttsVoice;
      };
      fillVoices();
      if ('speechSynthesis' in root) speechSynthesis.onvoiceschanged = fillVoices;
      $('ttsTest').addEventListener('click', () => root.TTS.speak('Alitalia one two three, descend flight level eight zero, turn left heading two seven zero.'));

      $('resetAll').addEventListener('click', async () => {
        if (!confirm(this.t('settings.resetConfirm'))) return;
        await storage.set(STORE_KEY, {});
        setTimeout(() => location.reload(), 150);
      });

      // Scorciatoie da tastiera (nel browser funzionano solo con la finestra attiva)
      document.addEventListener('keydown', (e) => {
        if (!e.ctrlKey || !e.shiftKey) return;
        const map = { KeyL: 'toggle-listen', KeyR: 'speak', KeyO: 'overlay', KeyA: 'replay', KeyD: 'replay-slow' };
        if (map[e.code]) { e.preventDefault(); this.emit('hotkey', map[e.code]); }
      });
      desktop.onHotkey((name) => this.emit('hotkey', name));
      this.on('hotkey', (name) => { if (name === 'overlay') this.setCompact(!document.body.classList.contains('compact')); });

      const info = await desktop.info();
      if (info) {
        document.body.classList.add('is-desktop');
        $('desktopInfo').textContent = this.t('app.desktopInfo', { version: info.version });
        $('aboutLine').textContent = this.t('app.aboutLine', { version: info.version + (info.build ? ` (build ${info.build})` : '') });
        this.version = info;
      }

      // Tasto PTT: il programma osserva la tastiera di sistema e avvisa quando trasmetti
      if (desktop.ptt) {
        try {
          this.pttAvailable = !!(await desktop.ptt.available());
          if (this.pttAvailable) {
            desktop.ptt.onChange((down) => this.emit('ptt', down));
            if (this.settings.pttKey) await desktop.ptt.set(this.settings.pttKey);
          }
        } catch (e) { this.pttAvailable = false; }
      }
      // PTT sul joystick (Gamepad API): pulsanti di joystick, yoke e throttle
      if (root.GamepadPtt && navigator.getGamepads) {
        this.gamepad = root.GamepadPtt.createPoller(() => navigator.getGamepads(), (down) => this.emit('ptt', down));
        this.gamepad.setBinding(this.settings.pttKey);
        setInterval(() => { if (this.gamepad.active()) this.gamepad.tick(); }, 30);
      }
      document.body.classList.toggle('has-ptt', !!(this.pttAvailable || this.gamepad));

      for (const init of this.modules) {
        try { init(this); } catch (e) { console.error(e); }
      }

      // Card di benvenuto: 3 passi, sparisce quando sono fatti
      const welcome = () => {
        const s = this.settings;
        const sttDone = s.mode === 'free' ? !!s.onboarded : this.sttReady();
        const steps = [!!this.callsignInfo(), sttDone, !!this.flight];
        steps.forEach((ok, k) => $(`wStep${k + 1}`).classList.toggle('done', ok));
        $('welcome').hidden = steps.every(Boolean);
      };
      for (const k of ['callsign', 'telephony', 'groqKey', 'sttProvider', 'localSttUrl', 'mode', 'onboarded', 'proInstance']) this.on(`setting:${k}`, welcome);
      this.on('flight', welcome);
      welcome();
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) this.refreshDevices(false);
      this.switchTab(this.settings.tab || 'listen');
    },
  };

  root.App = App;
})(this);
