/* Configurazione guidata: lingua, nominativo, riconoscimento vocale (con verifica),
   sorgente audio (con prova dal vivo: barra, soglia automatica e trascrizione di ciò che sente).
   Si apre da sola al primo avvio; poi da Altro › Configurazione guidata. */
(function (root) {
  'use strict';

  const STEPS = ['welcome', 'callsign', 'stt', 'audio', 'done'];
  const STEP_KEY = 'readback-copilot-onboard-step';

  root.App.register((App) => {
    const $ = App.$;
    const S = App.settings;
    const t = App.t;
    const dlg = $('onboard');
    const canChrome = !root.Net.desktop && !!(root.SpeechRecognition || root.webkitSpeechRecognition);
    let step = 0;
    let sttOk = false;
    let sttForce = false;
    let testRec = null;
    const draft = {};

    const session = {
      get() { try { return root.sessionStorage.getItem(STEP_KEY); } catch (e) { return null; } },
      set(v) { try { if (v) root.sessionStorage.setItem(STEP_KEY, v); else root.sessionStorage.removeItem(STEP_KEY); } catch (e) { /* ignora */ } },
    };

    // ------------------------------------------------------------ navigazione

    function show(i) {
      stopTest();
      step = Math.max(0, Math.min(STEPS.length - 1, i));
      const id = STEPS[step];
      dlg.querySelectorAll('.ob-step').forEach((s) => { s.hidden = s.dataset.step !== id; });
      $('obBar').style.width = `${Math.round((step / (STEPS.length - 1)) * 100)}%`;
      $('obBack').hidden = step === 0;
      $('obNext').textContent = id === 'done' ? t('ob.finish') : (id === 'stt' && sttForce ? t('ob.continueAnyway') : t('ob.next'));
      $('obDots').innerHTML = STEPS.map((s, k) => `<i class="${k === step ? 'on' : k < step ? 'past' : ''}"></i>`).join('');
      if (id === 'callsign') { setTimeout(() => $('obCallsign').focus(), 50); updateCs(); }
      if (id === 'stt') renderStt();
      if (id === 'audio') renderAudio();
      if (id === 'done') renderDone();
      updateNext();
    }

    function updateNext() {
      const id = STEPS[step];
      let ok = true;
      if (id === 'callsign') ok = !!root.Readback.parseCallsign($('obCallsign').value);
      if (id === 'stt') ok = draft.provider === 'chrome' || (draft.provider === 'local' ? !!$('obLocalUrl').value.trim() : !!$('obKey').value.trim());
      $('obNext').disabled = !ok;
    }

    function open(at) {
      // Groq è il consigliato: Chrome solo se l'utente l'aveva già scelto
      const choseChrome = S.mode === 'free' && canChrome && S.onboarded;
      Object.assign(draft, { provider: choseChrome ? 'chrome' : S.sttProvider, source: S.audioSource });
      $('obCallsign').value = S.callsign;
      $('obTelephony').value = S.telephony;
      $('obKey').value = S.groqKey;
      $('obLocalUrl').value = S.localSttUrl;
      sttOk = false;
      sttForce = false;
      $('obSttMsg').textContent = '';
      renderLang();
      if (!dlg.open) dlg.showModal();
      show(Math.max(0, STEPS.indexOf(at)));
    }

    function close(done) {
      stopTest();
      session.set(null);
      if (done || !S.onboarded) App.set('onboarded', true);
      if (dlg.open) dlg.close();
    }

    async function next() {
      const id = STEPS[step];
      if (id === 'callsign') {
        App.set('callsign', $('obCallsign').value.trim().toUpperCase());
        App.set('telephony', $('obTelephony').hidden ? '' : $('obTelephony').value.trim());
      }
      if (id === 'stt') {
        if (draft.provider !== 'chrome' && !sttOk && !sttForce) {
          const ok = await testStt();
          if (!ok) { sttForce = true; show(step); return; }
        }
        saveStt();
      }
      if (id === 'done') { close(true); App.switchTab('listen'); return; }
      show(step + 1);
    }

    $('obNext').addEventListener('click', next);
    $('obBack').addEventListener('click', () => show(step - 1));
    $('obClose').addEventListener('click', () => close(false));
    dlg.addEventListener('cancel', (e) => { e.preventDefault(); close(false); });
    dlg.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT' && !$('obNext').disabled) { e.preventDefault(); next(); } });

    // ------------------------------------------------------------ 1. lingua

    function renderLang() {
      const cur = root.I18n.lang;
      $('obLang').querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.lang === cur));
    }
    $('obLang').querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.lang === root.I18n.lang) { show(1); return; }
      // La pagina si ricarica nella nuova lingua e la configurazione riprende dal nominativo
      session.set('callsign');
      App.set('uiLang', b.dataset.lang);
    }));

    // ------------------------------------------------------------ 2. nominativo

    function updateCs() {
      const raw = $('obCallsign').value;
      const tel = $('obTelephony').hidden ? '' : $('obTelephony').value;
      const cs = root.Readback.parseCallsign(raw, tel);
      const hint = $('obCsHint');
      hint.className = 'ob-hint';
      if (!raw.trim()) hint.textContent = t('ob.csExamples');
      else if (!cs) hint.textContent = '';
      else if (cs.type === 'unknown' && !tel) {
        $('obTelephony').hidden = false;
        hint.textContent = t('ob.csUnknown');
      } else {
        hint.className = 'ob-hint good';
        hint.textContent = t('listen.csCalls', { name: cs.display });
      }
      if (cs && cs.type !== 'unknown' && !tel) $('obTelephony').hidden = cs.type !== 'unknown';
      updateNext();
    }
    $('obCallsign').addEventListener('input', updateCs);
    $('obTelephony').addEventListener('input', updateCs);

    // ------------------------------------------------------------ 3. riconoscimento vocale

    // In Chrome senza chiave si può usare il riconoscimento del browser
    if (canChrome) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'ob-card';
      card.dataset.provider = 'chrome';
      card.innerHTML = '<b></b><span></span>';
      card.querySelector('b').textContent = t('ob.chromeTitle');
      card.querySelector('span').textContent = t('ob.chromeDesc');
      $('obProvider').append(card);
    }

    function renderStt() {
      $('obProvider').querySelectorAll('.ob-card').forEach((c) => c.classList.toggle('active', c.dataset.provider === draft.provider));
      $('obGroqBox').hidden = draft.provider !== 'groq';
      $('obLocalBox').hidden = draft.provider !== 'local';
    }
    $('obProvider').addEventListener('click', (e) => {
      const c = e.target.closest('.ob-card');
      if (!c) return;
      draft.provider = c.dataset.provider;
      sttOk = false;
      sttForce = false;
      $('obSttMsg').textContent = '';
      renderStt();
      show(step);
    });
    for (const id of ['obKey', 'obLocalUrl']) $(id).addEventListener('input', () => { sttOk = false; sttForce = false; $('obSttMsg').textContent = ''; show(step); });

    async function testStt() {
      const msg = $('obSttMsg');
      msg.className = 'ob-hint';
      msg.textContent = t('common.checking');
      const r = await App.testStt(draft.provider === 'local'
        ? { provider: 'local', url: $('obLocalUrl').value.trim() }
        : { provider: 'groq', key: $('obKey').value.trim() });
      sttOk = r.ok;
      msg.className = `ob-hint ${r.ok ? 'good' : 'bad'}`;
      msg.textContent = r.ok ? `✅ ${r.message}` : `❌ ${r.message}`;
      return r.ok;
    }
    $('obTest').addEventListener('click', testStt);
    $('obTestLocal').addEventListener('click', testStt);

    function saveStt() {
      if (draft.provider === 'chrome') { App.set('mode', 'free'); return; }
      App.set('mode', 'groq');
      App.set('sttProvider', draft.provider);
      if (draft.provider === 'local') App.set('localSttUrl', $('obLocalUrl').value.trim());
      else App.set('groqKey', $('obKey').value.trim());
    }

    // ------------------------------------------------------------ 4. audio

    function renderAudio() {
      const chrome = S.mode === 'free';
      $('obSource').hidden = chrome;
      $('obSource').querySelectorAll('.ob-card').forEach((c) => c.classList.toggle('active', c.dataset.source === draft.source));
      $('obDeviceRow').hidden = chrome || draft.source !== 'device';
      $('obAudioMsg').className = 'ob-hint';
      $('obAudioMsg').textContent = chrome ? t('ob.chromeAudio') : t('ob.audioHint');
      if (!chrome && draft.source === 'device') fillDevices(false);
    }

    async function fillDevices(unlock) {
      try {
        if (unlock) await root.AudioCapture.unlockDeviceLabels();
        const inputs = await root.AudioCapture.listInputs();
        const sel = $('obDevice');
        sel.innerHTML = '';
        sel.append(new Option(t('settings.default'), ''));
        let cable = '';
        for (const d of inputs) {
          if (!d.deviceId || d.deviceId === 'default' || d.deviceId === 'communications') continue;
          sel.append(new Option(d.label || t('app.unnamedDevice'), d.deviceId));
          if (/cable output|vb-audio/i.test(d.label || '')) cable = cable || d.deviceId;
        }
        // VB-Cable trovato: lo propone da solo
        sel.value = S.device || cable;
        if (sel.value !== (S.device || cable)) sel.value = '';
      } catch (e) {
        $('obAudioMsg').textContent = t('app.devicesError', { msg: e.message });
      }
    }
    $('obDeviceRefresh').addEventListener('click', () => fillDevices(true));
    $('obDevice').addEventListener('change', () => App.set('device', $('obDevice').value));
    $('obSource').addEventListener('click', (e) => {
      const c = e.target.closest('.ob-card');
      if (!c) return;
      draft.source = c.dataset.source;
      App.set('audioSource', draft.source);
      stopTest();
      renderAudio();
    });

    function stopTest() {
      if (testRec) { const r = testRec; testRec = null; r.stop(); }
      const btn = $('obAudioTest');
      btn.classList.remove('recording');
      btn.querySelector('span').textContent = t('ob.test');
      $('obMeterBar').style.width = '0%';
    }

    $('obAudioTest').addEventListener('click', async () => {
      if (testRec) { stopTest(); return; }
      if (S.mode === 'free') return;
      const msg = $('obAudioMsg');
      msg.className = 'ob-hint';
      msg.textContent = t('ob.listening');
      const rec = new root.AudioCapture.SegmentRecorder({
        auto: true,
        threshold: S.threshold,
        maxMs: 12000,
        onLevel: (rms, speaking, th) => {
          $('obMeterBar').style.width = `${Math.min(100, (rms / 0.15) * 100)}%`;
          $('obMeterBar').classList.toggle('on', speaking);
          $('obMeterTh').style.left = `${Math.min(100, (th / 0.15) * 100)}%`;
        },
        onSegment: async (wav, ms) => {
          msg.className = 'ob-hint good';
          msg.textContent = t('ob.heardSegment', { sec: (ms / 1000).toFixed(1) });
          if (!App.sttReady()) return;
          try {
            const local = S.sttProvider === 'local';
            const r = await root.Groq.transcribe(wav, { key: local ? '' : S.groqKey, base: local ? S.localSttUrl : '', model: S.whisperModel });
            if (r.text && !root.Precision.phantom(r.text)) msg.textContent = t('ob.heardText', { text: r.text });
          } catch (e) {
            msg.className = 'ob-hint bad';
            msg.textContent = e.message;
          }
        },
        onEnded: () => stopTest(),
      });
      try {
        await rec.start(draft.source, draft.source === 'device' ? $('obDevice').value : '');
        testRec = rec;
        const btn = $('obAudioTest');
        btn.classList.add('recording');
        btn.querySelector('span').textContent = t('ob.stopTest');
      } catch (e) {
        msg.className = 'ob-hint bad';
        msg.textContent = t('ob.audioError', { msg: e.message });
      }
    });

    // ------------------------------------------------------------ 5. pronto

    function renderDone() {
      const cs = App.callsignInfo();
      const stt = S.mode === 'free' ? t('ob.chromeTitle') : S.sttProvider === 'local' ? `${t('ob.localTitle')} (${S.localSttUrl})` : 'Groq Whisper';
      const src = S.mode === 'free' ? t('ob.chromeAudioShort') : S.audioSource === 'system' ? t('settings.pcAudio') : t('ob.cableTitle');
      const rows = [
        ['radio', t('listen.callsign'), cs ? `${cs.code} · "${cs.display}"` : '—'],
        ['mic', t('settings.stt'), stt],
        ['headphones', t('settings.listenFrom'), src],
      ];
      $('obSummary').innerHTML = '';
      for (const [icon, k, v] of rows) {
        const li = document.createElement('li');
        li.innerHTML = `${root.Icons.svg(icon)}<span></span><b></b>`;
        li.querySelector('span').textContent = k;
        li.querySelector('b').textContent = v;
        $('obSummary').append(li);
      }
    }

    // ------------------------------------------------------------ apertura

    App.on('onboard', (at) => open(typeof at === 'string' ? at : 'welcome'));
    root.Icons.hydrate(dlg);

    // Primo avvio: si apre da sola, a meno che l'app sia già configurata (utenti delle versioni precedenti)
    const resume = session.get();
    if (resume) open(resume);
    else if (!S.onboarded) {
      if (App.callsignInfo() && App.sttReady() && App.storedKeys.includes('callsign')) App.set('onboarded', true);
      else setTimeout(() => open('welcome'), 400);
    }
  });
})(this);
