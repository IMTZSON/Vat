/* Interfaccia: collega audio, riconoscimento vocale, motore di readback e AI. */
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const STORE_KEY = 'readback-copilot-settings';

  const DEFAULTS = {
    callsign: '',
    telephony: '',
    mode: 'free',
    lang: 'en-US',
    hideOthers: true,
    groqKey: '',
    useAI: true,
    audioSource: 'device',
    device: '',
    whisperModel: 'whisper-large-v3-turbo',
    llmModel: 'llama-3.3-70b-versatile',
    threshold: 0.02,
  };

  const EXAMPLES = [
    'Alitalia 123, descend FL80, turn left heading 270, contact Roma Radar 125.5',
    'Alitalia 123, cleared to Milano Malpensa via BOLLA 5A departure, climb initially 6000 feet, squawk 4521',
    'Alitalia 123, taxi to holding point runway 16L via alpha bravo, hold short of runway 16R',
    'Alitalia 123, runway 16L, cleared to land, wind 160 degrees 5 knots',
    'Alitalia 123, descend to altitude 4000 feet, QNH 1013, cleared ILS approach runway 16L',
    'Alitalia 123, reduce speed 180 knots, contact Roma Director 119.2',
  ];

  const CHIP_LABEL = {
    level: 'Quota', heading: 'Prua', speed: 'Velocità', squawk: 'Squawk', qnh: 'Altimetro',
    frequency: 'Frequenza', runway: 'Pista', taxi: 'Rullaggio', clearance: 'Autorizzazione',
    approach: 'Avvicinamento', arrival: 'Arrivo', direct: 'Diretto', ground: 'Terra',
  };

  // ------------------------------------------------------------ impostazioni

  let settings = { ...DEFAULTS };
  try { settings = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORE_KEY) || '{}') }; } catch (e) { /* storage non disponibile */ }
  const save = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify(settings)); } catch (e) { /* ignora */ } };

  const bindings = ['callsign', 'telephony', 'mode', 'lang', 'hideOthers', 'groqKey', 'useAI', 'audioSource', 'device', 'whisperModel', 'llmModel', 'threshold'];
  for (const key of bindings) {
    const el = $(key);
    if (el.type === 'checkbox') el.checked = !!settings[key];
    else el.value = settings[key];
    el.addEventListener(el.tagName === 'SELECT' || el.type === 'checkbox' || el.type === 'range' ? 'change' : 'input', () => {
      settings[key] = el.type === 'checkbox' ? el.checked : (el.type === 'range' ? Number(el.value) : el.value);
      save();
      if (key === 'callsign' || key === 'telephony') updateCallsignHint();
      if (key === 'threshold') { if (recorder) recorder.threshold = settings.threshold; drawThreshold(); }
      if (key === 'mode') updateModeUI();
    });
  }
  $('threshold').addEventListener('input', (e) => { settings.threshold = Number(e.target.value); if (recorder) recorder.threshold = settings.threshold; drawThreshold(); });

  function callsignInfo() {
    return Readback.parseCallsign(settings.callsign, settings.telephony);
  }

  function updateCallsignHint() {
    const cs = callsignInfo();
    const hint = $('csHint');
    if (!cs) { hint.textContent = 'Inserisci il tuo nominativo: così l\'app riconosce le chiamate per te e lo aggiunge in fondo al readback.'; return; }
    if (cs.type === 'unknown') { hint.textContent = `Compagnia non in elenco: scrivi come ti chiama l'ATC nel campo "Nominativo radio" (es. "Alitalia").`; return; }
    hint.textContent = `L'ATC ti chiamerà: ${cs.display} — pronuncia: "${cs.spoken}"`;
  }

  function updateModeUI() {
    $('meterWrap').hidden = !(settings.mode === 'groq' && running);
    if (settings.mode === 'groq' && !settings.groqKey) $('settingsPanel').open = true;
  }

  // ------------------------------------------------------------ stato UI

  function setStatus(text, cls) {
    const el = $('status');
    el.textContent = text;
    el.className = `status ${cls || 'idle'}`;
  }

  let current = null;
  const history = [];

  function render(item) {
    current = item;
    const r = item.result;
    const rb = $('readback');
    rb.textContent = r.readback || '—';
    rb.classList.remove('flash');
    void rb.offsetWidth;
    rb.classList.add('flash');
    $('spoken').textContent = r.spoken ? `"${r.spoken}"` : '';
    $('heard').textContent = item.heard || '—';

    const forUs = $('forUs');
    if (r.forUs === true) { forUs.textContent = 'Per te'; forUs.className = 'badge ok'; }
    else if (r.forUs === 'maybe') { forUs.textContent = 'Forse per te: controlla'; forUs.className = 'badge maybe'; }
    else if (r.forUs === false) { forUs.textContent = 'Non per te'; forUs.className = 'badge no'; }
    else { forUs.textContent = 'Nominativo non impostato'; forUs.className = 'badge muted'; }

    const src = $('srcBadge');
    if (item.aiPending) { src.textContent = 'AI in corso…'; src.className = 'badge ai'; }
    else if (r.source === 'AI') { src.textContent = 'AI'; src.className = 'badge ai'; }
    else { src.textContent = 'Regole'; src.className = 'badge muted'; }

    const chips = $('chips');
    chips.innerHTML = '';
    for (const p of r.parts || []) {
      if (!CHIP_LABEL[p.type]) continue;
      const c = document.createElement('span');
      c.className = 'chip';
      const b = document.createElement('b');
      b.textContent = CHIP_LABEL[p.type];
      c.append(b, p.display);
      chips.append(c);
    }

    const warn = $('warnings');
    warn.innerHTML = '';
    const notes = [...(r.warnings || [])];
    if (r.noReadbackNeeded) notes.push('Nessuna istruzione da ripetere: basta un "Roger" (o "Wilco" se ti chiede di riportare).');
    if (r.note) notes.push(r.note);
    for (const n of notes) {
      const li = document.createElement('li');
      li.textContent = n;
      warn.append(li);
    }
  }

  function renderHistory() {
    const ol = $('history');
    ol.innerHTML = '';
    if (!history.length) {
      ol.innerHTML = '<li class="empty">Nessuna trasmissione ancora.</li>';
      return;
    }
    for (const item of history) {
      const li = document.createElement('li');
      if (item.result.forUs === false) li.className = 'other';
      const t = document.createElement('div');
      t.className = 't';
      t.textContent = `${item.time}${item.result.forUs === false ? ' · non per te' : ''}${item.result.source === 'AI' ? ' · AI' : ''}`;
      const rb = document.createElement('div');
      rb.className = 'rb';
      rb.textContent = item.result.readback;
      const atc = document.createElement('div');
      atc.className = 'atc';
      atc.textContent = `ATC: ${item.heard}`;
      li.append(t, rb, atc);
      li.addEventListener('click', () => render(item));
      ol.append(li);
    }
  }

  // ------------------------------------------------------------ elaborazione

  async function handleTranscript(text, origin) {
    text = (text || '').trim();
    if (!text) return;
    const cs = callsignInfo();
    const result = Readback.generateReadback(text, { callsign: cs });
    const item = {
      heard: text,
      origin,
      result,
      time: new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
    };
    history.unshift(item);
    if (history.length > 30) history.pop();

    const show = origin === 'prova' || !(settings.hideOthers && result.forUs === false);
    const wantAI = settings.mode === 'groq' && settings.useAI && settings.groqKey;
    if (wantAI && show) item.aiPending = true;
    if (show) render(item);
    renderHistory();

    if (wantAI && show) {
      try {
        const ai = await Groq.readback(text, { key: settings.groqKey, model: settings.llmModel, callsign: cs ? cs.display : '' });
        item.result = {
          ...result,
          readback: ai.readback,
          spoken: ai.spoken || '',
          note: ai.note || '',
          parts: result.parts,
          source: 'AI',
        };
      } catch (e) {
        item.result = { ...result, warnings: [...result.warnings, `AI non disponibile (${e.message}): mostro il readback a regole.`] };
      }
      item.aiPending = false;
      if (current === item) render(item);
      renderHistory();
    }
  }

  // ------------------------------------------------------------ ascolto

  let running = false;
  let recognition = null;
  let recorder = null;

  function startFree() {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) throw new Error('Questo browser non ha il riconoscimento vocale: usa Google Chrome o Microsoft Edge.');
    recognition = new SR();
    recognition.lang = settings.lang;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        if (res.isFinal) handleTranscript(res[0].transcript, 'chrome');
        else interim += res[0].transcript;
      }
      $('live').textContent = interim ? `Sto sentendo: ${interim}` : '';
    };
    recognition.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        stop();
        setStatus('Microfono negato', 'error');
        $('live').textContent = 'Permetti l\'accesso al microfono a questa pagina (icona nella barra degli indirizzi).';
        return;
      }
      $('live').textContent = `Errore riconoscimento: ${e.error}`;
    };
    recognition.onend = () => {
      if (running && recognition) setTimeout(() => { try { recognition.start(); } catch (err) { /* già avviato */ } }, 250);
    };
    recognition.start();
  }

  async function startGroq() {
    if (!settings.groqKey) {
      $('settingsPanel').open = true;
      throw new Error('Inserisci la chiave Groq nelle Impostazioni (è gratuita su console.groq.com).');
    }
    recorder = new AudioCapture.SegmentRecorder({
      threshold: settings.threshold,
      onLevel: (rms, speaking) => {
        const bar = $('meterBar');
        bar.style.width = `${Math.min(100, (rms / 0.15) * 100)}%`;
        bar.classList.toggle('on', speaking);
      },
      onEnded: () => { if (running) stop(); },
      onSegment: async (wav) => {
        setStatus('Trascrivo…', 'busy');
        try {
          const cs = callsignInfo();
          const text = await Groq.transcribe(wav, { key: settings.groqKey, model: settings.whisperModel, callsign: cs ? cs.display : '' });
          if (text) await handleTranscript(text, 'whisper');
        } catch (e) {
          $('live').textContent = e.message;
        }
        if (running) setStatus('In ascolto', 'listening');
      },
    });
    await recorder.start(settings.audioSource, settings.device);
    drawThreshold();
  }

  async function start() {
    $('live').textContent = '';
    try {
      running = true;
      if (settings.mode === 'groq') await startGroq();
      else startFree();
      setStatus('In ascolto', 'listening');
      $('toggle').textContent = '■ Ferma';
      $('toggle').classList.add('stop');
      updateModeUI();
    } catch (e) {
      running = false;
      stop();
      setStatus('Errore', 'error');
      $('live').textContent = e.message || String(e);
    }
  }

  function stop() {
    running = false;
    if (recognition) { recognition.onend = null; try { recognition.stop(); } catch (e) { /* ignora */ } recognition = null; }
    if (recorder) { recorder.stop(); recorder = null; }
    setStatus('Fermo', 'idle');
    $('toggle').textContent = '▶ Avvia ascolto';
    $('toggle').classList.remove('stop');
    updateModeUI();
  }

  $('toggle').addEventListener('click', () => (running ? stop() : start()));

  function drawThreshold() {
    $('meterTh').style.left = `${Math.min(100, (settings.threshold / 0.15) * 100)}%`;
  }

  // ------------------------------------------------------------ dispositivi e modelli

  async function refreshDevices(unlock) {
    try {
      if (unlock) await AudioCapture.unlockDeviceLabels();
      const inputs = await AudioCapture.listInputs();
      const sel = $('device');
      sel.innerHTML = '<option value="">Predefinito</option>';
      for (const d of inputs) {
        if (!d.deviceId || d.deviceId === 'default') continue;
        const o = document.createElement('option');
        o.value = d.deviceId;
        o.textContent = d.label || 'Dispositivo senza nome';
        sel.append(o);
      }
      sel.value = settings.device;
      if (sel.value !== settings.device) sel.value = '';
    } catch (e) {
      $('live').textContent = `Impossibile leggere i dispositivi: ${e.message}`;
    }
  }
  $('refreshDevices').addEventListener('click', () => refreshDevices(true));

  $('loadModels').addEventListener('click', async () => {
    const msg = $('modelsMsg');
    if (!settings.groqKey) { msg.textContent = 'Prima inserisci la chiave.'; return; }
    msg.textContent = 'Carico…';
    try {
      const models = await Groq.listModels(settings.groqKey);
      const list = $('modelList');
      list.innerHTML = '';
      for (const m of models) {
        const o = document.createElement('option');
        o.value = m;
        list.append(o);
      }
      msg.textContent = `${models.length} modelli: scegli dai campi sopra.`;
    } catch (e) {
      msg.textContent = e.message;
    }
  });

  // ------------------------------------------------------------ prova e voce

  $('tryBtn').addEventListener('click', () => handleTranscript($('tryText').value, 'prova'));
  $('tryText').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('tryBtn').click(); }
  });
  for (const ex of EXAMPLES) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = ex;
    b.addEventListener('click', () => {
      const cs = callsignInfo();
      const text = cs ? ex.replace('Alitalia 123', cs.display) : ex;
      $('tryText').value = text;
      handleTranscript(text, 'prova');
    });
    $('examples').append(b);
  }

  $('speak').addEventListener('click', () => {
    if (!current || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance(current.result.spoken || current.result.readback);
    u.lang = 'en-GB';
    u.rate = 0.95;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  });

  updateCallsignHint();
  drawThreshold();
  updateModeUI();
  if (navigator.mediaDevices && navigator.mediaDevices.enumerateDevices) refreshDevices(false);
})();
