/* Scheda Allenamento: l'ATC simulato parla, tu rispondi, l'app ti corregge. */
(function (root) {
  'use strict';

  root.App.register((App) => {
    const $ = App.$;
    const S = App.settings;
    const Sc = root.Scenarios;
    const STATS_KEY = 'readback-copilot-stats';
    let stats = App.storage.get(STATS_KEY, null) || { total: 0, sum: 0, perfect: 0, streak: 0, bestStreak: 0, byPhase: {} };
    let cur = null;
    let flightSteps = null;
    let stepIdx = 0;
    let session = null;
    let answered = false;

    const sel = $('trainPhase');
    for (const p of Sc.PHASES) {
      const o = document.createElement('option');
      o.value = p.id;
      o.textContent = p.label;
      sel.append(o);
    }
    sel.value = S.trainPhase;
    App.on('setting:trainPhase', () => { flightSteps = null; });
    App.on('flight', () => { flightSteps = null; });

    function flightOpts() {
      const f = App.flight || {};
      const cs = App.callsignInfo();
      return {
        callsign: cs || undefined,
        dep: f.dep, arr: f.arr, depName: f.depName, arrName: f.arrName,
        depRwy: f.depRwy, arrRwy: f.arrRwy, sid: f.sid, cruise: f.cruise,
      };
    }

    function setEnabled(on) {
      for (const id of ['trainReplay', 'trainReveal', 'trainMic', 'trainInput', 'trainSend']) $(id).disabled = !on;
    }

    function showAtcText(show) {
      const el = $('trainAtc');
      el.textContent = cur.atc;
      el.classList.toggle('hiddenText', !show);
      $('trainReveal').textContent = show ? '🙈 Nascondi testo' : '👁 Mostra testo';
      el.dataset.shown = show ? '1' : '';
    }

    function next() {
      cancelSession();
      const phase = S.trainPhase;
      if (phase === 'full') {
        if (!flightSteps || stepIdx >= flightSteps.length) {
          flightSteps = Sc.fullFlight(flightOpts());
          stepIdx = 0;
        }
        cur = flightSteps[stepIdx++];
        $('trainStep').textContent = `Passo ${stepIdx}/${flightSteps.length}`;
      } else {
        cur = Sc.generate(phase, { ...flightOpts(), difficulty: S.trainDifficulty });
        $('trainStep').textContent = '';
      }
      answered = false;
      $('trainStation').textContent = `📻 ${cur.station}`;
      $('trainStation').className = 'badge ai';
      showAtcText(!!S.trainShowText);
      $('trainResult').hidden = true;
      $('trainInput').value = '';
      $('trainLive').textContent = '';
      setEnabled(true);
      $('trainNext').textContent = '▶ Prossima istruzione';
      root.TTS.speak(cur.atcSpoken);
    }

    function cancelSession() {
      if (session) { try { session.cancel(); } catch (e) { /* ignora */ } session = null; }
      $('trainMic').classList.remove('recording');
      $('trainMic').textContent = '🎤 Parla';
    }

    async function micStart() {
      if (!cur || session) return;
      root.TTS.stop();
      try {
        session = await root.STT.start(S, (txt) => { $('trainLive').textContent = `Sto sentendo: ${txt}`; });
        $('trainMic').classList.add('recording');
        $('trainMic').textContent = '⏹ Fine';
        $('trainLive').textContent = 'Parla ora…';
      } catch (e) {
        session = null;
        $('trainLive').textContent = e.message;
      }
    }

    async function micStop() {
      if (!session) return;
      const s = session;
      session = null;
      $('trainMic').classList.remove('recording');
      $('trainMic').textContent = '🎤 Parla';
      $('trainLive').textContent = 'Riconosco…';
      try {
        const text = await s.stop();
        if (!text) { $('trainLive').textContent = 'Non ho sentito niente: riprova (parla dopo aver premuto 🎤).'; return; }
        $('trainLive').textContent = '';
        $('trainInput').value = text;
        evaluate(text);
      } catch (e) {
        $('trainLive').textContent = e.message;
      }
    }

    function evaluate(text) {
      if (!cur || !text.trim()) return;
      const res = Sc.score(cur.expected, text);
      $('trainResult').hidden = false;
      const sc = $('trainScore');
      sc.textContent = `${res.score}%`;
      sc.className = `score ${res.score === 100 ? 'ok' : res.score >= 60 ? 'maybe' : 'no'}`;
      $('trainSaid').textContent = text;
      const ul = $('trainItems');
      ul.innerHTML = '';
      for (const it of res.items) {
        const li = document.createElement('li');
        li.className = it.ok ? 'ok' : 'no';
        li.textContent = `${it.ok ? '✅' : '❌'} ${it.label}: ${it.expected}${!it.ok && it.missing.length ? ` (mancava: ${it.missing.join(', ')})` : ''}`;
        ul.append(li);
      }
      $('trainCorrect').textContent = cur.expected.readback;
      $('trainCorrectSpoken').textContent = `"${cur.expected.spoken}"`;
      showAtcText(true);

      if (!answered) {
        answered = true;
        stats.total++;
        stats.sum += res.score;
        if (res.perfect) { stats.perfect++; stats.streak++; stats.bestStreak = Math.max(stats.bestStreak, stats.streak); } else stats.streak = 0;
        const p = stats.byPhase[cur.phase] || { n: 0, sum: 0 };
        p.n++;
        p.sum += res.score;
        stats.byPhase[cur.phase] = p;
        App.storage.set(STATS_KEY, stats);
        renderStats();
      }
      if (res.perfect) App.toast('Perfetto! 👏');
    }

    function renderStats() {
      const el = $('trainStats');
      if (!stats.total) { el.innerHTML = '<p class="hint">Ancora nessun esercizio. Inizia con "Nuova istruzione"!</p>'; return; }
      const avg = Math.round(stats.sum / stats.total);
      const label = (id) => (Sc.PHASES.find((p) => p.id === id) || { label: id }).label.split(' –')[0];
      const rows = Object.entries(stats.byPhase).map(([id, p]) => {
        const v = Math.round(p.sum / p.n);
        return `<div class="statRow"><span>${label(id)}</span><div class="bar"><div style="width:${v}%"></div></div><b>${v}%</b><span class="hint">${p.n}</span></div>`;
      }).join('');
      el.innerHTML = `
        <div class="kpis">
          <div><b>${stats.total}</b><span>esercizi</span></div>
          <div><b>${avg}%</b><span>media</span></div>
          <div><b>${stats.perfect}</b><span>perfetti</span></div>
          <div><b>${stats.bestStreak}</b><span>record di fila</span></div>
        </div>
        <div class="statRows">${rows}</div>`;
    }

    $('trainNext').addEventListener('click', next);
    $('trainReplay').addEventListener('click', () => cur && root.TTS.speak(cur.atcSpoken));
    $('trainReveal').addEventListener('click', () => cur && showAtcText(!$('trainAtc').dataset.shown));
    $('trainMic').addEventListener('click', () => (session ? micStop() : micStart()));
    $('trainSend').addEventListener('click', () => evaluate($('trainInput').value));
    $('trainInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); evaluate($('trainInput').value); } });
    $('trainListenCorrect').addEventListener('click', () => cur && root.TTS.speak(cur.expected.spoken));
    $('trainRetry').addEventListener('click', () => {
      if (!cur) return;
      $('trainResult').hidden = true;
      $('trainInput').value = '';
      showAtcText(!!S.trainShowText);
      root.TTS.speak(cur.atcSpoken);
    });
    $('trainResetStats').addEventListener('click', () => {
      if (!confirm('Azzerare i progressi?')) return;
      stats = { total: 0, sum: 0, perfect: 0, streak: 0, bestStreak: 0, byPhase: {} };
      App.storage.set(STATS_KEY, stats);
      renderStats();
    });

    // Tieni premuto Spazio per parlare (quando non stai scrivendo)
    const isTyping = () => ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement && document.activeElement.tagName);
    document.addEventListener('keydown', (e) => {
      if (e.code !== 'Space' || e.repeat || isTyping() || $('trainMic').disabled || document.querySelector('[data-view="train"]').hidden) return;
      e.preventDefault();
      micStart();
    });
    document.addEventListener('keyup', (e) => {
      if (e.code !== 'Space' || isTyping() || document.querySelector('[data-view="train"]').hidden) return;
      e.preventDefault();
      micStop();
    });

    renderStats();
  });
})(this);
