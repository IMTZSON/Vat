/* Scheda Allenamento: l'ATC simulato parla, tu rispondi, l'app ti corregge. */
(function (root) {
  'use strict';

  root.App.register((App) => {
    const $ = App.$;
    const S = App.settings;
    const Sc = root.Scenarios;
    const t = App.t;
    const icoText = (icon, text) => { const sp = document.createElement('span'); sp.textContent = text; return `${root.Icons.svg(icon)} ${sp.innerHTML}`; };
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
    App.on('setting:trainPhase', () => { flightSteps = null; report = null; renderReport(); });
    App.on('flight', () => { flightSteps = null; twys = []; });

    let twys = [];   // taxiway veri dell'aeroporto di partenza (prova generale)
    let report = null; // { steps: [{ station, score, items }] } durante il volo completo

    function flightOpts() {
      const f = App.flight || {};
      const cs = App.callsignInfo();
      return {
        callsign: cs || undefined,
        dep: f.dep, arr: f.arr, depName: f.depName, arrName: f.arrName,
        depRwy: f.depRwy, arrRwy: f.arrRwy, sid: f.sid, cruise: f.cruise,
        ...realData(f),
      };
    }

    // Dati veri del volo per la prova generale: frequenze online su VATSIM, fix della rotta, QNH, taxiway
    function realData(f) {
      const out = { freqs: {}, fixes: (f.fixes || []).map((x) => x.ident), twys };
      const data = root.Vatsim && root.Vatsim.last;
      if (data && f.arr) {
        const at = root.Vatsim.atcAt(data, f.arr);
        const byFac = (n) => at.ctrls.find((c) => c.facility === n);
        for (const [key, fac] of [['arrApproach', 5], ['arrTower', 4], ['arrGround', 3]]) if (byFac(fac)) out.freqs[key] = byFac(fac).frequency;
      }
      if (data && f.dep) {
        const ctr = root.Vatsim.atcAt(data, f.dep).centers[0];
        if (ctr) { out.freqs.center = ctr.frequency; out.centerName = root.World.stationName(ctr.callsign); }
      }
      if (App.wx && Date.now() - App.wx.t < 3600000) { out.qnhDep = App.wx.dep; out.qnhArr = App.wx.arr; }
      return out;
    }

    // Prova generale: il volo completo con i dati veri, a voce, con il report finale
    App.startRehearsal = async () => {
      if (!App.flight || !App.flight.dep || !App.flight.arr) { App.toast(t('rehearsal.noFlight')); return; }
      if (App.groundRefs) twys = await Promise.race([App.groundRefs(App.flight.dep), new Promise((res) => setTimeout(() => res([]), 5000))]);
      if (S.trainPhase !== 'full') App.set('trainPhase', 'full');
      $('trainPhase').value = 'full';
      flightSteps = null;
      App.switchTab('train');
      next();
    };

    function renderReport() {
      const el = $('trainReport');
      if (!report || !report.steps.length) { el.hidden = true; return; }
      const avg = Math.round(report.steps.reduce((s, x) => s + x.score, 0) / report.steps.length);
      const missed = {};
      for (const st of report.steps) for (const it of st.items) if (!it.ok) missed[it.label] = (missed[it.label] || 0) + 1;
      const top = Object.entries(missed).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const esc = (s) => String(s).replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
      const cls = (v) => (v === 100 ? 'ok' : v >= 60 ? 'maybe' : 'no');
      el.innerHTML = `
        <div class="eyebrow">${esc(t('rehearsal.report'))}</div>
        <div class="report-head"><div class="score ${cls(avg)}">${avg}%</div><p>${esc(t('rehearsal.summary', { n: report.steps.length, perfect: report.steps.filter((s) => s.score === 100).length }))}</p></div>
        <ol class="report-steps">${report.steps.map((s) => `<li><span>${esc(s.station)}</span><b class="${cls(s.score)}">${s.score}%</b></li>`).join('')}</ol>
        <div class="eyebrow">${esc(t('rehearsal.missed'))}</div>
        <p class="hint">${top.length ? top.map(([k, n]) => `${esc(k)} ×${n}`).join(' · ') : esc(t('rehearsal.none'))}</p>`;
      el.hidden = false;
    }

    function setEnabled(on) {
      for (const id of ['trainReplay', 'trainReveal', 'trainMic', 'trainInput', 'trainSend']) $(id).disabled = !on;
    }

    function showAtcText(show) {
      const el = $('trainAtc');
      el.textContent = cur.atc;
      el.classList.toggle('hiddenText', !show);
      $('trainReveal').innerHTML = show ? icoText('eye-off', t('train.hide')) : icoText('eye', t('train.reveal'));
      el.dataset.shown = show ? '1' : '';
    }

    function next() {
      cancelSession();
      const phase = S.trainPhase;
      if (phase === 'full') {
        if (!flightSteps || stepIdx >= flightSteps.length) {
          flightSteps = Sc.fullFlight(flightOpts());
          stepIdx = 0;
          report = { steps: [] };
          renderReport();
        }
        cur = flightSteps[stepIdx++];
        $('trainStep').textContent = t('train.step', { n: stepIdx, total: flightSteps.length });
      } else {
        cur = Sc.generate(phase, { ...flightOpts(), difficulty: S.trainDifficulty });
        $('trainStep').textContent = '';
      }
      answered = false;
      $('trainStation').innerHTML = icoText('radio', cur.station);
      $('trainStation').className = 'badge ai';
      showAtcText(!!S.trainShowText);
      $('trainResult').hidden = true;
      $('trainInput').value = '';
      $('trainLive').textContent = '';
      setEnabled(true);
      $('trainNext').innerHTML = icoText('play', t('train.nextInstr'));
      root.TTS.speak(cur.atcSpoken);
    }

    function cancelSession() {
      if (session) { try { session.cancel(); } catch (e) { /* ignora */ } session = null; }
      $('trainMic').classList.remove('recording');
      $('trainMic').innerHTML = icoText('mic', t('train.talk'));
    }

    async function micStart() {
      if (!cur || session) return;
      root.TTS.stop();
      try {
        session = await root.STT.start(S, (txt) => { $('trainLive').textContent = t('listen.hearing', { text: txt }); });
        $('trainMic').classList.add('recording');
        $('trainMic').innerHTML = icoText('square', t('train.done'));
        $('trainLive').textContent = t('train.speakNow');
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
      $('trainMic').innerHTML = icoText('mic', t('train.talk'));
      $('trainLive').textContent = t('train.recognizing');
      try {
        const text = await s.stop();
        if (!text) { $('trainLive').textContent = t('train.heardNothing'); return; }
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
        li.textContent = `${it.ok ? '✅' : '❌'} ${it.label}: ${it.expected}${!it.ok && it.missing.length ? ` (${t('train.missing', { list: it.missing.join(', ') })})` : ''}`;
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
        App.emit('train-answer', { score: res.score, phase: cur.phase });
        if (report && flightSteps && flightSteps.includes(cur)) {
          report.steps.push({ station: cur.station, score: res.score, items: res.items });
          if (stepIdx >= flightSteps.length) {
            renderReport();
            const avg = Math.round(report.steps.reduce((s, x) => s + x.score, 0) / report.steps.length);
            App.emit('rehearsal-done', { avg, n: report.steps.length });
          }
        }
      }
      if (res.perfect) App.toast(t('train.perfect'));
    }

    function renderStats() {
      const el = $('trainStats');
      if (!stats.total) { el.innerHTML = ''; const p = document.createElement('p'); p.className = 'hint'; p.textContent = t('train.noStats'); el.append(p); return; }
      const avg = Math.round(stats.sum / stats.total);
      const label = (id) => (Sc.PHASES.find((p) => p.id === id) || { label: id }).label.split(' –')[0].split(' (')[0];
      const rows = Object.entries(stats.byPhase).map(([id, p]) => {
        const v = Math.round(p.sum / p.n);
        return `<div class="statRow"><span>${label(id)}</span><div class="bar"><div style="width:${v}%"></div></div><b>${v}%</b><span class="hint">${p.n}</span></div>`;
      }).join('');
      el.innerHTML = `
        <div class="kpis">
          <div><b>${stats.total}</b><span>${t('train.kpiTotal')}</span></div>
          <div><b>${avg}%</b><span>${t('train.kpiAvg')}</span></div>
          <div><b>${stats.perfect}</b><span>${t('train.kpiPerfect')}</span></div>
          <div><b>${stats.bestStreak}</b><span>${t('train.kpiStreak')}</span></div>
        </div>
        <div class="statRows">${rows}</div>`;
    }

    $('trainNext').addEventListener('click', next);
    $('rehearsalBtn').addEventListener('click', () => App.startRehearsal());
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
      if (!confirm(t('train.resetConfirm'))) return;
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
