/* Scheda Ascolto: sente l'ATC, trascrive e mostra il readback. */
(function (root) {
  'use strict';

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

  root.App.register((App) => {
    const $ = App.$;
    const S = App.settings;
    const HISTORY_KEY = 'readback-copilot-history';
    const history = App.storage.get(HISTORY_KEY, []);
    let current = null;
    let running = false;
    let recognition = null;
    let recorder = null;

    // ------------------------------------------------------------ nominativo e modalità

    function updateCallsignHint() {
      const cs = App.callsignInfo();
      const hint = $('csHint');
      if (!cs) hint.textContent = 'Prima scrivi il tuo nominativo qui sotto.';
      else if (cs.type === 'unknown') hint.textContent = 'Compagnia non in elenco: scrivi il nominativo radio.';
      else { hint.textContent = `L'ATC ti chiama "${cs.display}"`; hint.title = `Pronuncia: ${cs.spoken}`; }
    }

    function updateModeUI() {
      $('meterWrap').hidden = !(S.mode === 'groq' && running);
      $('desktopFree').hidden = !(root.Net.desktop && S.mode === 'free');
    }

    App.on('setting:callsign', updateCallsignHint);
    App.on('setting:telephony', updateCallsignHint);
    App.on('setting:mode', () => { if (running) stop(); updateModeUI(); });
    App.on('setting:threshold', (v) => { if (recorder) recorder.threshold = v; drawThreshold(); });

    $('openChrome').addEventListener('click', () => App.desktop.openExternal(`${location.origin}/`));

    // ------------------------------------------------------------ visualizzazione

    // ------------------------------------------------------------ Live Activity (in alto sulla mappa)
    const activity = $('activity');
    let collapseTimer = null;
    function setExpanded(on, auto) {
      activity.classList.toggle('collapsed', !on);
      clearTimeout(collapseTimer);
      // dopo una nuova chiamata torna compatta da sola, ma solo se nessuno la sta guardando col mouse
      if (on && auto) collapseTimer = setTimeout(() => { if (!activity.matches(':hover')) setExpanded(false); }, 25000);
    }
    $('activityToggle').addEventListener('click', () => setExpanded(activity.classList.contains('collapsed')));
    setExpanded(false);

    function render(item, fresh) {
      current = item;
      const r = item.result;
      const rb = $('readback');
      rb.textContent = r.readback || '—';
      if (fresh) {
        activity.classList.remove('pop');
        void activity.offsetWidth;
        activity.classList.add('pop');
        setExpanded(true, true);
      }
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

      const v = item.verify;
      const vb = $('verify');
      if (vb) {
        if (!v || item.aiPending) { vb.textContent = ''; vb.className = 'badge muted'; }
        else if (v.status === 'ok') { vb.textContent = '✅ Verificato'; vb.className = 'badge ok'; }
        else if (v.status === 'warn') { vb.textContent = '⚠️ Controlla'; vb.className = 'badge maybe'; }
        else { vb.textContent = '⛔ Audio non chiaro'; vb.className = 'badge no'; }
      }
      rb.classList.toggle('doubt', !!v && v.status === 'bad');

      const warn = $('warnings');
      warn.innerHTML = '';
      const fromVerify = v ? v.reasons.map((x) => x.text) : [];
      const notes = [...fromVerify, ...(r.warnings || []).filter((w) => !fromVerify.includes(w))];
      if (r.noReadbackNeeded && r.source !== 'AI') notes.push('Nessuna istruzione da ripetere: basta un "Roger" (o "Wilco" se ti chiede di riportare).');
      if (r.note) notes.push(r.note);
      for (const n of notes) {
        const li = document.createElement('li');
        li.textContent = n;
        warn.append(li);
      }
    }

    function saveHistory() {
      App.storage.set(HISTORY_KEY, history.slice(0, 100).map((h) => ({ heard: h.heard, time: h.time, date: h.date, result: { readback: h.result.readback, spoken: h.result.spoken, forUs: h.result.forUs, source: h.result.source, parts: h.result.parts, warnings: h.result.warnings, note: h.result.note } })));
    }

    // Conversazione a fumetti: ATC a sinistra, il tuo readback a destra
    function renderHistory() {
      const ol = $('history');
      ol.innerHTML = '';
      if (!history.length) {
        ol.innerHTML = `<li class="empty">${root.Icons.svg('message-circle')}Qui comparirà la conversazione con l'ATC.</li>`;
        return;
      }
      for (const item of history.slice(0, 30).reverse()) {
        const r = item.result;
        const v = item.verify;
        const atc = document.createElement('li');
        atc.className = 'msg atc';
        atc.innerHTML = '<div class="bubble"></div><div class="meta"></div>';
        atc.querySelector('.bubble').textContent = item.heard;
        atc.querySelector('.meta').textContent = `ATC · ${item.time}`;
        const me = document.createElement('li');
        const state = v && v.status === 'bad' ? 'bad' : (v && v.status === 'warn' ? 'warn' : '');
        me.className = `msg me ${r.forUs === false ? 'other' : state}`;
        me.innerHTML = '<div class="bubble"></div><div class="meta"></div>';
        me.querySelector('.bubble').textContent = r.readback;
        const tags = [];
        if (r.forUs === false) tags.push('non per te');
        else if (v) tags.push(v.status === 'ok' ? '✓ verificato' : v.status === 'warn' ? '⚠ controlla' : '⛔ audio non chiaro');
        if (r.source === 'AI') tags.push('AI');
        me.querySelector('.meta').textContent = tags.join(' · ');
        for (const li of [atc, me]) { li.addEventListener('click', () => render(item, true)); ol.append(li); }
      }
    }

    $('exportHistory').addEventListener('click', async () => {
      if (!history.length) { App.toast('Lo storico è vuoto.'); return; }
      const lines = history.slice().reverse().map((h) => `[${h.date || ''} ${h.time}]${h.result.forUs === false ? ' (non per me)' : ''}\nATC:  ${h.heard}\nIO:   ${h.result.readback}\n`);
      const ok = await App.desktop.saveText(`readback-${new Date().toISOString().slice(0, 10)}.txt`, lines.join('\n'));
      if (ok) App.toast('Storico esportato.');
    });
    $('clearHistory').addEventListener('click', () => {
      if (!confirm('Svuotare lo storico?')) return;
      history.length = 0;
      saveHistory();
      renderHistory();
    });

    function beep() {
      if (!S.beep) return;
      try {
        const ctx = new AudioContext();
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = 880;
        g.gain.setValueAtTime(0.08, ctx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.15);
        o.connect(g).connect(ctx.destination);
        o.start();
        o.stop(ctx.currentTime + 0.16);
        setTimeout(() => ctx.close(), 300);
      } catch (e) { /* audio non disponibile */ }
    }

    // ------------------------------------------------------------ contesto live per le verifiche

    let live = null;
    const SUFFIX = { DEL: 'Delivery', GND: 'Ground', TWR: 'Tower', APP: 'Approach', DEP: 'Departure', CTR: 'Control', FSS: 'Information', ATIS: 'Information' };
    function stationName(callsign) {
      const parts = callsign.split('_');
      const ap = root.Scenarios.AIRPORTS[parts[0]];
      return `${ap ? ap.city : parts[0]} ${SUFFIX[parts[parts.length - 1]] || ''}`.trim();
    }
    async function refreshLive() {
      const f = App.flight;
      const cs = App.callsignInfo();
      const next = { freqs: [], runways: [], qnh: [], whisper: '' };
      const ctx = [];
      if (cs) ctx.push(`Callsign ${cs.display}`);
      if (f && f.dep && f.arr) {
        const A = root.Scenarios.AIRPORTS;
        if (A[f.dep] && A[f.arr]) next.runways = [...new Set([...A[f.dep].rwys, ...A[f.arr].rwys, f.depRwy, f.arrRwy].filter(Boolean))];
        ctx.push(`Runways ${[f.depRwy, f.arrRwy].filter(Boolean).join(', ')}`);
        if (App.wx && Date.now() - App.wx.t < 3600000) next.qnh = [App.wx.dep, App.wx.arr].filter(Boolean);
        try {
          const data = await root.Vatsim.feed(60000);
          next.freqs = root.Vatsim.frequenciesFor(data, [f.dep, f.arr]);
          const st = next.freqs.filter((x) => x.callsign !== 'UNICOM').slice(0, 8).map((x) => `${stationName(x.callsign)} ${x.freq.toFixed(3).replace(/0+$/, '')}`);
          if (st.length) ctx.push(`Stations ${st.join(', ')}`);
        } catch (e) { /* senza dati VATSIM si saltano i controlli sulle frequenze */ }
      }
      next.whisper = ctx.join('. ');
      live = next;
      return next;
    }
    App.on('flight', () => refreshLive());
    App.on('wx', () => refreshLive());
    setInterval(() => { if (running) refreshLive(); }, 60000);

    function verify(item, aiText) {
      const cs = App.callsignInfo();
      return root.Precision.check({ transcript: item.heard, rules: item.rules, ai: aiText || null, callsign: cs, audio: item.audio, live });
    }

    // ------------------------------------------------------------ elaborazione

    async function handleTranscript(text, origin, audio) {
      text = (text || '').trim();
      if (!text) return;
      const cs = App.callsignInfo();
      const result = root.Readback.generateReadback(text, { callsign: cs });
      const now = new Date();
      const item = {
        heard: text,
        origin,
        result,
        rules: result,
        audio: audio || null,
        date: now.toLocaleDateString('it-IT'),
        time: now.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' }),
      };
      item.verify = verify(item);
      history.unshift(item);
      if (history.length > 100) history.pop();

      const show = origin === 'prova' || !(S.hideOthers && result.forUs === false);
      const wantAI = S.mode === 'groq' && S.useAI && S.groqKey && show;
      if (wantAI) item.aiPending = true;
      if (show) {
        render(item, true);
        if (origin !== 'prova' && result.forUs === true) beep();
      }
      renderHistory();
      saveHistory();

      if (wantAI) {
        try {
          const ai = await root.Groq.readback(text, { key: S.groqKey, model: S.llmModel, callsign: cs ? cs.display : '' });
          item.verify = verify(item, ai.readback);
          // Se l'AI ha messo un numero che l'ATC non ha detto, vince il readback a regole
          item.result = item.verify.useRules
            ? { ...result, note: ai.note || '' }
            : { ...result, readback: ai.readback, spoken: ai.spoken || '', note: ai.note || '', source: 'AI' };
        } catch (e) {
          item.result = { ...result, warnings: [...result.warnings, `AI non disponibile (${e.message}): mostro il readback a regole.`] };
        }
        item.aiPending = false;
        if (current === item) render(item);
        renderHistory();
        saveHistory();
      }
      App.emit('readback', item);
    }

    // ------------------------------------------------------------ ascolto

    function startFree() {
      if (root.Net.desktop) throw new Error('La modalità Gratis funziona solo in Chrome o Edge: premi "Apri l\'app in Chrome", oppure usa la modalità Groq.');
      const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
      if (!SR) throw new Error('Questo browser non ha il riconoscimento vocale: usa Google Chrome o Microsoft Edge.');
      recognition = new SR();
      recognition.lang = S.lang;
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
          App.setStatus('Microfono negato', 'error');
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
      if (!S.groqKey) {
        App.switchTab('settings');
        throw new Error('Inserisci la chiave Groq nelle Impostazioni (è gratuita su console.groq.com).');
      }
      recorder = new root.AudioCapture.SegmentRecorder({
        threshold: S.threshold,
        onLevel: (rms, speaking) => {
          const bar = $('meterBar');
          bar.style.width = `${Math.min(100, (rms / 0.15) * 100)}%`;
          bar.classList.toggle('on', speaking);
          $('toggle').style.setProperty('--lvl', Math.min(1, rms / 0.08).toFixed(2));
        },
        onEnded: () => { if (running) stop(); },
        onSegment: async (wav) => {
          App.setStatus('Trascrivo…', 'busy');
          try {
            const cs = App.callsignInfo();
            const r = await root.Groq.transcribe(wav, { key: S.groqKey, model: S.whisperModel, callsign: cs ? cs.display : '', context: live && live.whisper });
            if (r.text) await handleTranscript(r.text, 'whisper', root.Precision.audioConfidence(r.segments));
          } catch (e) {
            $('live').textContent = e.message;
          }
          if (running) App.setStatus('In ascolto', 'listening');
        },
      });
      await recorder.start(S.audioSource, S.device);
      drawThreshold();
    }

    async function start() {
      $('live').textContent = '';
      try {
        running = true;
        refreshLive();
        if (S.mode === 'groq') await startGroq();
        else startFree();
        App.setStatus('In ascolto', 'listening');
        $('toggle').classList.add('on');
        $('toggle').setAttribute('aria-label', 'Ferma ascolto');
        $('toggleLabel').textContent = 'In ascolto…';
        activity.classList.add('listening');
        updateModeUI();
      } catch (e) {
        stop();
        App.setStatus('Errore', 'error');
        $('live').textContent = e.message || String(e);
      }
    }

    function stop() {
      running = false;
      if (recognition) { recognition.onend = null; try { recognition.stop(); } catch (e) { /* ignora */ } recognition = null; }
      if (recorder) { recorder.stop(); recorder = null; }
      App.setStatus('Fermo', 'idle');
      $('toggle').classList.remove('on');
      $('toggle').style.setProperty('--lvl', 0);
      $('toggle').setAttribute('aria-label', 'Avvia ascolto');
      $('toggleLabel').textContent = 'Ascolto spento';
      activity.classList.remove('listening');
      updateModeUI();
    }

    function drawThreshold() {
      $('meterTh').style.left = `${Math.min(100, (S.threshold / 0.15) * 100)}%`;
    }

    function speakCurrent() {
      if (current) root.TTS.speak(current.result.spoken || current.result.readback);
    }

    $('toggle').addEventListener('click', () => (running ? stop() : start()));
    $('speak').addEventListener('click', speakCurrent);
    App.on('hotkey', (name) => {
      if (name === 'toggle-listen') (running ? stop() : start());
      if (name === 'speak') speakCurrent();
    });

    // ------------------------------------------------------------ Groq: modelli e verifica

    $('loadModels').addEventListener('click', async () => {
      const msg = $('modelsMsg');
      if (!S.groqKey) { msg.textContent = 'Prima inserisci la chiave.'; return; }
      msg.textContent = 'Carico…';
      try {
        const models = await root.Groq.listModels(S.groqKey);
        const list = $('modelList');
        list.innerHTML = '';
        for (const m of models) {
          const o = document.createElement('option');
          o.value = m;
          list.append(o);
        }
        msg.textContent = `${models.length} modelli disponibili: sceglili dai campi sopra.`;
      } catch (e) {
        msg.textContent = e.message;
      }
    });

    $('testGroq').addEventListener('click', async () => {
      const msg = $('modelsMsg');
      if (!S.groqKey) { msg.textContent = 'Prima inserisci la chiave.'; return; }
      msg.textContent = 'Verifico…';
      try {
        const ai = await root.Groq.readback('Alitalia 123, descend flight level 80, turn left heading 270', { key: S.groqKey, model: S.llmModel, callsign: 'Alitalia 123' });
        msg.textContent = `✅ Funziona! Modello ${ai.model}. Risposta AI: "${ai.readback}"`;
      } catch (e) {
        msg.textContent = `❌ ${e.message}`;
      }
    });

    // ------------------------------------------------------------ prova

    $('tryBtn').addEventListener('click', () => handleTranscript($('tryText').value, 'prova'));
    $('tryText').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('tryBtn').click(); }
    });
    for (const ex of EXAMPLES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = ex;
      b.addEventListener('click', () => {
        const cs = App.callsignInfo();
        const text = cs ? ex.replace('Alitalia 123', cs.display) : ex;
        $('tryText').value = text;
        handleTranscript(text, 'prova');
      });
      $('examples').append(b);
    }

    updateCallsignHint();
    drawThreshold();
    updateModeUI();
    renderHistory();
    if (history.length) render(history[0]);
  });
})(this);
