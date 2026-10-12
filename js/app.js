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
    trainPhase: 'delivery',
    trainDifficulty: 'normal',
    trainShowText: false,
    simbriefUser: '',
    callStand: '',
    ttsVoice: '',
    ttsRate: 1,
    onTop: false,
    aircraft: 'A320',
    cabSource: 'auto',
    cabMinutes: 90,
    tab: 'listen',
  };

  const storage = {
    get(key, fallback) {
      try { const v = localStorage.getItem(key); return v === null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* storage non disponibile */ }
    },
  };

  const stored = storage.get(STORE_KEY, {});
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
    onHotkey: (fn) => bridge && bridge.onHotkey(fn),
    info: () => (bridge ? bridge.info() : Promise.resolve(null)),
  };

  const App = {
    $,
    storage,
    desktop,
    defaults: DEFAULTS,
    settings: { ...DEFAULTS, ...stored },
    storedKeys: Object.keys(stored),
    flight: storage.get('readback-copilot-flight', null),
    modules: [],

    save() { storage.set(STORE_KEY, this.settings); },

    set(key, value) {
      this.settings[key] = value;
      this.save();
      this.emit(`setting:${key}`, value);
    },

    on(evt, fn) { (listeners[evt] = listeners[evt] || []).push(fn); },
    emit(evt, data) { (listeners[evt] || []).forEach((fn) => { try { fn(data); } catch (e) { console.error(e); } }); },

    register(fn) { this.modules.push(fn); },

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
      $('topTitle').textContent = view.dataset.title || 'Readback Copilot';
      const back = $('backBtn');
      back.hidden = !parent;
      back.dataset.target = parent || '';
      if (parent) back.querySelector('span').textContent = document.querySelector(`.view[data-view="${parent}"]`).dataset.title;
      if (this.settings.tab !== id) this.set('tab', id);
      root.scrollTo({ top: 0 });
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
          sel.innerHTML = '<option value="">Predefinito</option>';
          for (const d of inputs) {
            if (!d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') continue;
            const o = document.createElement('option');
            o.value = d.deviceId;
            o.textContent = d.label || 'Dispositivo senza nome (premi ↻)';
            sel.append(o);
          }
          sel.value = this.settings[id];
          if (sel.value !== this.settings[id]) sel.value = '';
        }
      } catch (e) {
        this.toast(`Impossibile leggere i dispositivi audio: ${e.message}`);
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
      exit.className = 'icon-btn compact-exit glass';
      exit.title = 'Esci dalla modalità compatta (Ctrl+Shift+O)';
      exit.innerHTML = root.Icons.svg('maximize-2');
      exit.addEventListener('click', () => this.setCompact(false));
      document.body.append(exit);

      this.bindSettings();
      this.buildSegmented();
      document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => this.switchTab(b.dataset.tab)));
      document.querySelectorAll('[data-go]').forEach((b) => b.addEventListener('click', () => this.switchTab(b.dataset.go)));
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
        if (was) this.toast(`Il modello Groq "${was}" non è più disponibile: ora uso "${model}".`, 6000);
      };

      root.TTS.voiceName = this.settings.ttsVoice;
      root.TTS.rate = this.settings.ttsRate;
      this.on('setting:ttsVoice', (v) => { root.TTS.voiceName = v; });
      this.on('setting:ttsRate', (v) => { root.TTS.rate = v; });
      const fillVoices = () => {
        const sel = $('ttsVoice');
        sel.innerHTML = '<option value="">Automatica</option>';
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

      $('resetAll').addEventListener('click', () => {
        if (!confirm('Ripristinare tutte le impostazioni? (la chiave Groq verrà cancellata)')) return;
        storage.set(STORE_KEY, {});
        location.reload();
      });

      // Scorciatoie da tastiera (nel browser funzionano solo con la finestra attiva)
      document.addEventListener('keydown', (e) => {
        if (!e.ctrlKey || !e.shiftKey) return;
        const map = { KeyL: 'toggle-listen', KeyR: 'speak', KeyO: 'overlay' };
        if (map[e.code]) { e.preventDefault(); this.emit('hotkey', map[e.code]); }
      });
      desktop.onHotkey((name) => this.emit('hotkey', name));
      this.on('hotkey', (name) => { if (name === 'overlay') this.setCompact(!document.body.classList.contains('compact')); });

      const info = await desktop.info();
      if (info) {
        document.body.classList.add('is-desktop');
        $('desktopInfo').textContent = `Programma per Windows, versione ${info.version}. Le scorciatoie funzionano anche con il simulatore in primo piano.`;
        $('aboutLine').textContent = `Readback Copilot ${info.version} · programma per Windows`;
      }

      for (const init of this.modules) {
        try { init(this); } catch (e) { console.error(e); }
      }
      if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) this.refreshDevices(false);
      this.switchTab(this.settings.tab || 'listen');
    },
  };

  root.App = App;
})(this);
