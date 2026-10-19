/* Scheda Ascolto: sente l'ATC, trascrive e mostra il readback.
   Con il coach attivo, dopo una chiamata per te ascolta il tuo microfono e valuta il tuo readback. */
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

  const CHIP_TYPES = ['level', 'heading', 'speed', 'squawk', 'qnh', 'frequency', 'runway', 'taxi', 'clearance', 'approach', 'arrival', 'direct', 'ground'];
  const COACH_WINDOW_MS = 25000;

  root.App.register((App) => {
    const $ = App.$;
    const S = App.settings;
    const t = App.t;
    const HISTORY_KEY = 'readback-copilot-history';
    const COACH_KEY = 'readback-copilot-coach';
    const history = App.storage.get(HISTORY_KEY, []);
    let coachStats = App.storage.get(COACH_KEY, null) || root.Coach.emptyStats();
    let current = null;
    let running = false;
    let recognition = null;
    let recorder = null;
    let order = Promise.resolve();
    let pending = 0;

    // Trascrizione: Groq, server Whisper locale o Pro (stessa API compatibile OpenAI)
    const proToken = () => `${S.proKey}::${S.proInstance}`;
    const sttOpts = () => {
      if (S.sttProvider === 'local') return { key: '', model: S.whisperModel, base: S.localSttUrl };
      if (S.sttProvider === 'pro' && root.Net.pro) return { key: proToken(), model: '', base: root.Net.pro.endpoint };
      return { key: S.groqKey, model: S.whisperModel };
    };
    // AI per il readback: con la chiave Groq o col Pro (il server locale non ha un LLM)
    const aiOpts = () => {
      if (S.sttProvider === 'pro' && root.Net.pro && S.proInstance) return { key: proToken(), base: root.Net.pro.endpoint };
      if (S.sttProvider !== 'local' && S.sttProvider !== 'pro' && S.groqKey) return { key: S.groqKey, model: S.llmModel };
      return null;
    };
    const transcribe = (wav, extra) => root.Groq.transcribe(wav, { ...sttOpts(), ...extra });

    // ------------------------------------------------------------ nominativo e modalità

    function updateCallsignHint() {
      const cs = App.callsignInfo();
      const hint = $('csHint');
      hint.title = '';
      if (!cs) hint.textContent = t('listen.csFirst');
      else if (cs.type === 'unknown') hint.textContent = t('listen.csUnknown');
      else { hint.textContent = t('listen.csCalls', { name: cs.display }); hint.title = t('listen.csSpoken', { spoken: cs.spoken }); }
    }

    function updateModeUI() {
      $('meterWrap').hidden = !(S.mode === 'groq' && running);
      $('desktopFree').hidden = !(root.Net.desktop && S.mode === 'free');
      $('threshold').disabled = !!S.autoThreshold;
    }

    App.on('setting:callsign', updateCallsignHint);
    App.on('setting:telephony', updateCallsignHint);
    App.on('setting:mode', () => { if (running) stop(); updateModeUI(); });
    App.on('setting:threshold', (v) => { if (recorder) recorder.threshold = v; drawThreshold(); });
    App.on('setting:autoThreshold', (v) => { if (recorder) recorder.auto = v; updateModeUI(); drawThreshold(); });

    $('openChrome').addEventListener('click', () => App.desktop.openExternal(`${location.origin}/`));

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

    const badge = (el, text, cls) => { el.textContent = text; el.className = `badge ${cls}`; };

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
      if (r.forUs === true) badge(forUs, t('listen.forYou'), 'ok');
      else if (r.forUs === 'maybe') badge(forUs, t('listen.maybeYou'), 'maybe');
      else if (r.forUs === false) badge(forUs, t('listen.notYou'), 'no');
      else badge(forUs, t('listen.noCallsign'), 'muted');

      const src = $('srcBadge');
      if (item.aiPending) badge(src, t('listen.aiPending'), 'ai');
      else if (r.source === 'AI') badge(src, 'AI', 'ai');
      else badge(src, t('listen.rules'), 'muted');

      const chips = $('chips');
      chips.innerHTML = '';
      for (const p of r.parts || []) {
        if (!CHIP_TYPES.includes(p.type)) continue;
        const c = document.createElement('span');
        c.className = 'chip';
        const b = document.createElement('b');
        b.textContent = p.type === 'qnh' ? t('listen.altimeter') : root.Scenarios.partLabel(p.type);
        c.append(b, p.display);
        chips.append(c);
      }

      const v = item.verify;
      const vb = $('verify');
      if (!v || item.aiPending) badge(vb, '', 'muted');
      else if (v.status === 'ok') badge(vb, `✅ ${t('listen.verified')}`, 'ok');
      else if (v.status === 'warn') badge(vb, `⚠️ ${t('listen.check')}`, 'maybe');
      else badge(vb, `⛔ ${t('listen.unclear')}`, 'no');
      rb.classList.toggle('doubt', !!v && v.status === 'bad');

      const warn = $('warnings');
      warn.innerHTML = '';
      const fromVerify = v ? v.reasons.map((x) => x.text) : [];
      const notes = [...fromVerify, ...(r.warnings || []).filter((w) => !fromVerify.includes(w))];
      for (const n of r.info || []) if (!notes.includes(n)) notes.push(n);
      if (r.noReadbackNeeded && r.source !== 'AI' && !r.special) notes.push(t('listen.justRoger'));
      if (r.note) notes.push(r.note);
      for (const n of notes) {
        const li = document.createElement('li');
        li.textContent = n;
        warn.append(li);
      }
      renderCoach(item);
    }

    // Risultato del coach sotto il readback (e badge in alto)
    function renderCoach(item) {
      const box = $('coachOut');
      const b = $('coachBadge');
      const c = item.coach;
      if (!c) { box.hidden = true; b.hidden = true; return; }
      b.hidden = false;
      if (c.state === 'listening') {
        badge(b, `🎙️ ${t(item.coachPtt ? 'coach.pressPtt' : 'coach.listening')}`, 'ai');
        box.hidden = true;
        return;
      }
      if (c.state === 'missed') { badge(b, t('coach.noReply'), 'muted'); box.hidden = true; return; }
      if (c.state === 'error') { badge(b, t('coach.error'), 'muted'); box.hidden = false; box.textContent = c.error; return; }
      badge(b, `🎯 ${c.score}%`, c.score === 100 ? 'ok' : c.score >= 60 ? 'maybe' : 'no');
      box.hidden = false;
      box.innerHTML = '';
      const said = document.createElement('p');
      said.className = 'coach-said';
      const lbl = document.createElement('span');
      lbl.className = 'eyebrow';
      lbl.textContent = t('coach.youSaid');
      said.append(lbl, ` ${c.said}`);
      box.append(said);
      if (c.missed && c.missed.length) {
        const ul = document.createElement('ul');
        ul.className = 'coach-missed';
        for (const m of c.missed) {
          const li = document.createElement('li');
          li.textContent = `${root.Scenarios.partLabel(m.type)}: ${m.expected}`;
          ul.append(li);
        }
        box.append(ul);
      } else {
        const ok = document.createElement('p');
        ok.className = 'coach-ok';
        ok.textContent = t('coach.perfect');
        box.append(ok);
      }
    }

    function saveHistory() {
      App.storage.set(HISTORY_KEY, history.slice(0, 100).map((h) => ({
        heard: h.heard, time: h.time, date: h.date, coach: h.coach && h.coach.state === 'done' ? h.coach : undefined,
        result: { readback: h.result.readback, spoken: h.result.spoken, forUs: h.result.forUs, source: h.result.source, parts: h.result.parts, warnings: h.result.warnings, info: h.result.info, special: h.result.special, note: h.result.note },
      })));
    }

    // Conversazione a fumetti: ATC a sinistra, il tuo readback a destra
    function renderHistory() {
      const ol = $('history');
      ol.innerHTML = '';
      if (!history.length) {
        ol.innerHTML = `<li class="empty">${root.Icons.svg('message-circle')}</li>`;
        ol.firstChild.append(t('listen.emptyChat'));
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
        if (item.clip) {
          const b = document.createElement('button');
          b.className = 'bubble-replay';
          b.title = t('replay.this');
          b.innerHTML = root.Icons.svg('rotate-ccw');
          b.addEventListener('click', (e) => { e.stopPropagation(); replay(item, 1); });
          atc.querySelector('.meta').append(b);
        }
        const me = document.createElement('li');
        const state = v && v.status === 'bad' ? 'bad' : (v && v.status === 'warn' ? 'warn' : '');
        me.className = `msg me ${r.forUs === false ? 'other' : state}`;
        me.innerHTML = '<div class="bubble"></div><div class="meta"></div>';
        me.querySelector('.bubble').textContent = r.readback;
        const tags = [];
        if (r.forUs === false) tags.push(t('listen.tagNotYou'));
        else if (v) tags.push(v.status === 'ok' ? `✓ ${t('listen.tagVerified')}` : v.status === 'warn' ? `⚠ ${t('listen.tagCheck')}` : `⛔ ${t('listen.tagUnclear')}`);
        if (r.source === 'AI') tags.push('AI');
        if (item.coach && item.coach.state === 'done') tags.push(`🎯 ${item.coach.score}%`);
        me.querySelector('.meta').textContent = tags.join(' · ');
        for (const li of [atc, me]) { li.addEventListener('click', () => render(item, true)); ol.append(li); }
      }
    }

    $('exportHistory').addEventListener('click', async () => {
      if (!history.length) { App.toast(t('listen.historyEmpty')); return; }
      const lines = history.slice().reverse().map((h) => {
        const head = `[${h.date || ''} ${h.time}]${h.result.forUs === false ? ` (${t('listen.tagNotYou')})` : ''}`;
        const coach = h.coach && h.coach.state === 'done' ? `\n${t('export.said')}  ${h.coach.said} (${h.coach.score}%)` : '';
        return `${head}\nATC:  ${h.heard}\n${t('export.me')}  ${h.result.readback}${coach}\n`;
      });
      const ok = await App.desktop.saveText(`readback-${new Date().toISOString().slice(0, 10)}.txt`, lines.join('\n'));
      if (ok) App.toast(t('listen.historyExported'));
    });
    $('clearHistory').addEventListener('click', () => {
      if (!confirm(t('listen.historyClearConfirm'))) return;
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
    async function refreshLive() {
      const f = App.flight;
      const next = { freqs: [], runways: [], qnh: [], whisper: '' };
      const ctx = [];
      if (f && f.dep && f.arr) {
        // Piste di partenza e arrivo (database mondiale): se un aeroporto è sconosciuto si salta il controllo
        const dep = root.World.airport(f.dep);
        const arr = root.World.airport(f.arr);
        if (dep && arr && dep.rwys.length && arr.rwys.length) next.runways = [...new Set([...dep.rwys, ...arr.rwys, f.depRwy, f.arrRwy].filter(Boolean))];
        if (App.wx && Date.now() - App.wx.t < 3600000) next.qnh = [App.wx.dep, App.wx.arr].filter(Boolean);
        try {
          const data = await root.Vatsim.feed(60000);
          next.freqs = root.Vatsim.frequenciesFor(data, [f.dep, f.arr]);
          // Solo i nomi delle stazioni (mai le frequenze: vedi Groq.buildPrompt)
          const st = [...new Set(next.freqs.filter((x) => x.callsign !== 'UNICOM').slice(0, 10).map((x) => root.World.stationName(x.callsign)))];
          if (st.length) ctx.push(st.join(', '));
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
      return root.Precision.check({ transcript: item.heard, rules: item.rules, ai: aiText || null, callsign: cs, audio: item.audio, live, prompt: item.prompt });
    }

    // ------------------------------------------------------------ coach: ascolta il tuo readback

    let coachRec = null;
    let coachTimer = null;
    let pttSession = null;
    function coachCancel() {
      clearTimeout(coachTimer);
      if (coachRec) { const r = coachRec; coachRec = null; r.stop(); }
      if (pttSession) { const p = pttSession; pttSession = null; p.rec.close(); }
    }

    // Valuta il readback registrato e chiude la finestra del coach
    async function coachScore(item, wav, finish) {
      try {
        const cs = App.callsignInfo();
        const r = await transcribe(wav, { callsign: cs ? cs.display : '' });
        if (!r.text || root.Precision.phantom(r.text)) { finish({ state: 'missed' }); return; }
        const ev = root.Coach.evaluate(item.rules, r.text);
        coachStats = root.Coach.record(coachStats, ev);
        App.storage.set(COACH_KEY, coachStats);
        App.emit('coach', coachStats);
        App.emit('coach-score', ev);
        finish({ state: 'done', score: ev.score, said: ev.said, missed: ev.missed.map((m) => ({ type: m.type, expected: m.expected })), ptt: !!item.coachPtt });
      } catch (e) {
        finish({ state: 'error', error: e.message });
      }
    }

    // Con il tasto PTT: registra esattamente la tua trasmissione (dalla pressione al rilascio)
    async function coachListenPtt(item, finish) {
      const rec = new root.AudioCapture.PttRecorder();
      try {
        await rec.open(S.micDevice);
      } catch (e) {
        finish({ state: 'error', error: t('coach.micError', { msg: e.message }) });
        return;
      }
      item.coachPtt = true;
      if (current === item) renderCoach(item);
      pttSession = { item, rec, finish, held: false };
      coachTimer = setTimeout(() => { if (pttSession && pttSession.item === item && !pttSession.held) { coachCancel(); finish({ state: 'missed' }); } }, COACH_WINDOW_MS);
    }

    App.on('ptt', (down) => {
      $('txBadge').hidden = !down;
      activity.classList.toggle('tx', !!down);
      const s = pttSession;
      if (!s) return;
      if (down) { s.held = true; s.rec.begin(); return; }
      s.held = false;
      const wav = s.rec.end();
      if (!wav) return; // pressione troppo breve: si continua ad aspettare
      pttSession = null;
      clearTimeout(coachTimer);
      s.rec.close();
      coachScore(s.item, wav, s.finish);
    });

    async function coachListen(item) {
      coachCancel();
      // Stesso dispositivo dell'ATC (es. VB-Cable come microfono predefinito): il coach sentirebbe l'ATC, non te
      if (S.audioSource === 'device' && (S.micDevice || '') === (S.device || '')) {
        item.coach = { state: 'error', error: t('coach.sameDevice') };
        if (current === item) renderCoach(item);
        return;
      }
      item.coach = { state: 'listening' };
      if (current === item) renderCoach(item);
      const finish = (data) => {
        clearTimeout(coachTimer);
        item.coach = data;
        if (current === item) renderCoach(item);
        renderHistory();
        saveHistory();
      };
      if (App.pttActive()) { await coachListenPtt(item, finish); return; }
      let got = false;
      const rec = new root.AudioCapture.SegmentRecorder({
        auto: true,
        threshold: 0.02,
        silenceMs: 900,
        minMs: 600,
        maxMs: 15000,
        onSegment: async (wav) => {
          if (got) return;
          got = true;
          if (coachRec === rec) coachCancel();
          await coachScore(item, wav, finish);
        },
      });
      coachRec = rec;
      try {
        await rec.start('device', S.micDevice);
      } catch (e) {
        coachRec = null;
        finish({ state: 'error', error: t('coach.micError', { msg: e.message }) });
        return;
      }
      coachTimer = setTimeout(() => { if (coachRec === rec && !got) { coachCancel(); finish({ state: 'missed' }); } }, COACH_WINDOW_MS);
    }

    // ------------------------------------------------------------ elaborazione

    // ------------------------------------------------------------ riascolto della radio
    // Ultime trasmissioni registrate (solo in memoria): si possono riascoltare, anche rallentate
    const clips = [];
    let player = null;
    function keepClip(wav) {
      if (!wav || typeof Blob !== 'function' || !(wav instanceof Blob)) return null;
      const clip = { wav, t: Date.now() };
      clips.push(clip);
      if (clips.length > 12) clips.shift();
      updateReplayUI();
      return clip;
    }
    // Trasmissione da riascoltare: quella mostrata, altrimenti l'ultima per te, altrimenti l'ultima sentita
    function replayTarget(item) {
      if (item && item.clip) return item.clip;
      if (current && current.clip) return current.clip;
      const mine = history.find((h) => h.clip && h.result.forUs !== false);
      return (mine && mine.clip) || clips[clips.length - 1] || null;
    }
    function stopReplay() {
      if (player) { player.pause(); URL.revokeObjectURL(player.src); player = null; }
      document.querySelectorAll('.replay-on').forEach((b) => b.classList.remove('replay-on'));
    }
    function replay(item, rate) {
      const clip = replayTarget(item);
      if (!clip) { App.toast(t(S.mode === 'groq' ? 'replay.none' : 'replay.needWhisper')); return; }
      stopReplay();
      root.TTS.stop();
      const a = new Audio(URL.createObjectURL(clip.wav));
      // velocità ridotta senza voce "da orco"
      a.preservesPitch = true;
      a.playbackRate = rate || 1;
      a.volume = 1;
      player = a;
      const btn = $(rate && rate < 1 ? 'replaySlow' : 'replay');
      if (btn) btn.classList.add('replay-on');
      a.onended = () => { if (player === a) stopReplay(); };
      // un riascolto interrotto da quello nuovo non deve fermare il nuovo
      a.play().catch(() => { if (player === a) stopReplay(); });
    }
    function updateReplayUI() {
      const has = clips.length > 0;
      for (const id of ['replay', 'replaySlow']) $(id).classList.toggle('dim', !has);
    }
    $('replay').addEventListener('click', () => replay(null, 1));
    $('replaySlow').addEventListener('click', () => replay(null, 0.75));

    async function handleTranscript(text, origin, audio, prompt, clip) {
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
        prompt: prompt || '',
        clip: clip || null,
        ts: Date.now(),
        date: root.I18n.date(now),
        time: root.I18n.time(now, true),
      };
      item.verify = verify(item);
      history.unshift(item);
      if (history.length > 100) history.pop();

      const show = origin === 'prova' || !(S.hideOthers && result.forUs === false);
      const wantAI = S.mode === 'groq' && S.useAI && !!aiOpts() && show;
      if (wantAI) item.aiPending = true;
      if (show) {
        render(item, true);
        if (origin !== 'prova' && result.forUs === true) beep();
      }
      // Coach: solo in ascolto reale, per chiamate per te con qualcosa da ripetere
      if (S.coach && origin === 'whisper' && result.forUs === true && root.Coach.worthScoring(result)) coachListen(item);
      renderHistory();
      saveHistory();

      if (wantAI) {
        try {
          const ai = await root.Groq.readback(text, { ...aiOpts(), callsign: cs ? cs.display : '' });
          item.verify = verify(item, ai.readback);
          // Se l'AI ha messo un numero che l'ATC non ha detto, vince il readback a regole
          item.result = item.verify.useRules
            ? { ...result, note: ai.note || '' }
            : { ...result, readback: ai.readback, spoken: ai.spoken || '', note: ai.note || '', source: 'AI' };
        } catch (e) {
          item.result = { ...result, warnings: [...result.warnings, t('listen.aiDown', { msg: e.message })] };
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
      if (root.Net.desktop) throw new Error(t('listen.freeDesktop'));
      const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
      if (!SR) throw new Error(t('listen.noWebSpeech'));
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
        $('live').textContent = interim ? t('listen.hearing', { text: interim }) : '';
      };
      recognition.onerror = (e) => {
        if (e.error === 'no-speech' || e.error === 'aborted') return;
        if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
          stop();
          App.setStatus(t('listen.micDenied'), 'error');
          $('live').textContent = t('listen.micAllow');
          return;
        }
        $('live').textContent = t('listen.srError', { error: e.error });
      };
      recognition.onend = () => {
        if (running && recognition) setTimeout(() => { try { recognition.start(); } catch (err) { /* già avviato */ } }, 250);
      };
      recognition.start();
    }

    async function startWhisper() {
      if (!App.sttReady()) {
        App.emit('onboard', 'stt');
        throw new Error(S.sttProvider === 'local' ? t('listen.needLocal') : t('listen.needKey'));
      }
      recorder = new root.AudioCapture.SegmentRecorder({
        threshold: S.threshold,
        auto: S.autoThreshold,
        onLevel: (rms, speaking, th) => {
          const bar = $('meterBar');
          bar.style.width = `${Math.min(100, (rms / 0.15) * 100)}%`;
          bar.classList.toggle('on', speaking);
          $('toggle').style.setProperty('--lvl', Math.min(1, rms / 0.08).toFixed(2));
          if (S.autoThreshold) drawThreshold(th);
        },
        onEnded: () => { if (running) stop(); },
        // Le trascrizioni partono subito (in parallelo) ma i risultati si mostrano
        // nell'ordine in cui l'ATC ha parlato: una risposta lenta non scavalca la successiva.
        onSegment: (wav) => {
          const cs = App.callsignInfo();
          const csName = cs ? cs.display : '';
          const context = live && live.whisper;
          const prompt = root.Groq.buildPrompt(csName, context);
          pending++;
          App.setStatus(t('listen.transcribing'), 'busy');
          const clip = keepClip(wav);
          const job = transcribe(wav, { callsign: csName, context }).then((r) => ({ r }), (e) => ({ e }));
          order = order.then(async () => {
            const { r, e } = await job;
            try {
              if (e) $('live').textContent = e.message;
              else if (r.text && root.Precision.phantom(r.text)) $('live').textContent = t('listen.ignoredNoise', { text: r.text });
              else if (r.text) await handleTranscript(r.text, 'whisper', root.Precision.audioConfidence(r.segments), prompt, clip);
            } finally {
              pending--;
              if (running && !pending) App.setStatus(t('status.listening'), 'listening');
            }
          });
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
        if (S.mode === 'groq') await startWhisper();
        else startFree();
        App.setStatus(t('status.listening'), 'listening');
        $('toggle').classList.add('on');
        $('toggle').setAttribute('aria-label', t('listen.stop'));
        $('toggleLabel').textContent = t('listen.on');
        activity.classList.add('listening');
        updateModeUI();
      } catch (e) {
        stop();
        App.setStatus(t('status.error'), 'error');
        $('live').textContent = e.message || String(e);
      }
    }

    function stop() {
      running = false;
      coachCancel();
      if (recognition) { recognition.onend = null; try { recognition.stop(); } catch (e) { /* ignora */ } recognition = null; }
      if (recorder) { recorder.stop(); recorder = null; }
      App.setStatus(t('status.idle'), 'idle');
      $('toggle').classList.remove('on');
      $('toggle').style.setProperty('--lvl', 0);
      $('toggle').setAttribute('aria-label', t('listen.start'));
      $('toggleLabel').textContent = t('listen.off');
      activity.classList.remove('listening');
      updateModeUI();
    }

    function drawThreshold(th) {
      const v = th !== undefined ? th : (S.autoThreshold && recorder ? recorder.threshold : S.threshold);
      $('meterTh').style.left = `${Math.min(100, (v / 0.15) * 100)}%`;
      $('meterTh').classList.toggle('auto', !!S.autoThreshold);
    }

    function speakCurrent() {
      if (current) root.TTS.speak(current.result.spoken || current.result.readback);
    }

    $('toggle').addEventListener('click', () => (running ? stop() : start()));
    $('speak').addEventListener('click', speakCurrent);
    App.on('hotkey', (name) => {
      if (name === 'toggle-listen') (running ? stop() : start());
      if (name === 'speak') speakCurrent();
      if (name === 'replay') replay(null, 1);
      if (name === 'replay-slow') replay(null, 0.75);
    });
    updateReplayUI();
    App.isListening = () => running;
    // Statistiche radio di un volo (per il resoconto): chiamate per te, verificate, audio non chiaro, voto del coach
    App.radioStats = (since) => {
      const mine = history.filter((h) => h.result && h.result.forUs === true && h.origin !== 'prova' && (!since || (h.ts || 0) >= since));
      const scored = mine.filter((h) => h.coach && h.coach.state === 'done');
      return {
        calls: mine.length,
        verified: mine.filter((h) => h.verify && h.verify.status === 'ok').length,
        unclear: mine.filter((h) => h.verify && h.verify.status === 'bad').length,
        coach: scored.length ? Math.round(scored.reduce((n, h) => n + h.coach.score, 0) / scored.length) : null,
      };
    };

    // ------------------------------------------------------------ modelli e verifica del servizio

    $('loadModels').addEventListener('click', async () => {
      const msg = $('modelsMsg');
      const local = S.sttProvider === 'local';
      if (local ? !S.localSttUrl : !S.groqKey) { msg.textContent = t(local ? 'settings.needUrl' : 'settings.needKey'); return; }
      msg.textContent = t('common.loading');
      try {
        const models = await root.Groq.listModels(local ? '' : S.groqKey, local ? S.localSttUrl : '');
        const list = $('modelList');
        list.innerHTML = '';
        for (const m of models) list.append(new Option(m, m));
        msg.textContent = t('settings.modelsFound', { n: models.length });
      } catch (e) {
        msg.textContent = e.message;
      }
    });

    $('testGroq').addEventListener('click', async () => {
      const msg = $('modelsMsg');
      msg.textContent = t('common.checking');
      const r = await App.testStt();
      msg.textContent = r.ok ? `✅ ${r.message}` : `❌ ${r.message}`;
    });

    // Prova del servizio di trascrizione (usata anche dalla configurazione guidata)
    App.testStt = async (opts) => {
      const o = { provider: S.sttProvider, key: S.groqKey, url: S.localSttUrl, ...(opts || {}) };
      try {
        if (o.provider === 'pro') {
          if (!root.Net.pro || !S.proInstance) return { ok: false, message: t('pro.needActivation') };
          const ai = await root.Groq.readback('Alitalia 123, descend flight level 80, turn left heading 270', { key: proToken(), base: root.Net.pro.endpoint, callsign: 'Alitalia 123' });
          return { ok: true, message: t('pro.testOk', { readback: ai.readback }) };
        }
        if (o.provider === 'local') {
          if (!o.url) return { ok: false, message: t('settings.needUrl') };
          // Un secondo di silenzio: il server deve rispondere con una trascrizione (anche vuota)
          const wav = root.AudioCapture.encodeWav(new Float32Array(16000), 16000);
          await root.Groq.transcribe(wav, { base: o.url, model: S.whisperModel });
          return { ok: true, message: t('settings.localOk', { url: root.Groq.normalizeBase(o.url) }) };
        }
        if (!o.key) return { ok: false, message: t('settings.needKey') };
        const ai = await root.Groq.readback('Alitalia 123, descend flight level 80, turn left heading 270', { key: o.key, model: S.llmModel, callsign: 'Alitalia 123' });
        return { ok: true, message: t('settings.groqOk', { model: ai.model, readback: ai.readback }) };
      } catch (e) {
        return { ok: false, message: e.message };
      }
    };

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

    // ------------------------------------------------------------ statistiche del coach (scheda Allenamento)

    function renderCoachStats() {
      const el = $('coachStats');
      const s = coachStats;
      if (!s.total) {
        el.innerHTML = '';
        const p = document.createElement('p');
        p.className = 'hint';
        p.textContent = S.coach ? t('coach.statsEmpty') : t('coach.statsOff');
        el.append(p);
        return;
      }
      const avg = Math.round(s.sum / s.total);
      el.innerHTML = `
        <div class="kpis">
          <div><b>${s.total}</b><span>${t('coach.kpiTotal')}</span></div>
          <div><b>${avg}%</b><span>${t('train.kpiAvg')}</span></div>
          <div><b>${s.perfect}</b><span>${t('train.kpiPerfect')}</span></div>
          <div><b>${s.bestStreak}</b><span>${t('train.kpiStreak')}</span></div>
        </div>`;
      const weak = root.Coach.weakest(s, 3);
      if (weak.length) {
        const p = document.createElement('p');
        p.className = 'hint coach-weak';
        p.textContent = t('coach.weakest', { list: weak.map((w) => `${w.label} (${w.ok}/${w.n})`).join(', ') });
        el.append(p);
      }
    }
    App.on('coach', renderCoachStats);
    App.on('setting:coach', renderCoachStats);
    // ------------------------------------------------------------ tasto PTT (impostazioni)

    function renderPtt() {
      const k = S.pttKey;
      $('pttLabel').textContent = k ? k.label : t('ptt.none');
      $('pttLabel').classList.toggle('set', !!k);
      $('pttClear').hidden = !k;
    }
    // Il primo tasto, pulsante del mouse o pulsante del joystick premuto diventa il PTT
    $('pttSet').addEventListener('click', async () => {
      const pad = App.gamepad;
      if (!App.pttAvailable && !pad) return;
      $('pttLabel').textContent = t(pad ? 'ptt.pressNowPad' : 'ptt.pressNow');
      $('pttLabel').classList.add('capturing');
      const timeout = new Promise((res) => setTimeout(() => res(null), 15000));
      const tries = [timeout];
      if (App.pttAvailable) tries.push(App.desktop.ptt.capture());
      if (pad) tries.push(pad.capture().then((b) => b && { ...b, label: `🎮 ${t('ptt.padButton', { n: b.button + 1 })} · ${root.GamepadPtt.shortName(b.pad)}` }));
      const b = await Promise.race(tries);
      if (pad) pad.cancelCapture();
      $('pttLabel').classList.remove('capturing');
      if (b) {
        App.set('pttKey', b);
        if (pad) pad.setBinding(b);
        if (App.pttAvailable) await App.desktop.ptt.set(b.kind === 'gamepad' ? null : b);
        App.toast(t('ptt.saved', { key: b.label }));
      }
      renderPtt();
    });
    $('pttClear').addEventListener('click', async () => {
      App.set('pttKey', null);
      if (App.gamepad) App.gamepad.setBinding(null);
      if (App.pttAvailable) await App.desktop.ptt.set(null);
      renderPtt();
    });
    renderPtt();

    $('coachResetStats').addEventListener('click', () => {
      if (!confirm(t('train.resetConfirm'))) return;
      coachStats = root.Coach.emptyStats();
      App.storage.set(COACH_KEY, coachStats);
      renderCoachStats();
    });

    updateCallsignHint();
    drawThreshold();
    updateModeUI();
    renderHistory();
    renderCoachStats();
    if (history.length) render(history[0]);
  });
})(this);
