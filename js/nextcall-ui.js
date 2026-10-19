/* Card "Prossima chiamata" nella Live Activity: cosa dire adesso, a chi e su che frequenza.
   Lo stato (istruzioni ricevute) si azzera quando cambia il volo. */
(function (root) {
  'use strict';

  root.App.register((App) => {
    const $ = App.$;
    const S = App.settings;
    const t = App.t;
    const N = root.NextCall;
    const KEY = 'readback-copilot-nextcall';
    const flightKey = () => (App.flight ? `${App.flight.dep}-${App.flight.arr}` : '');
    const saved = App.storage.get(KEY, null);
    let state = saved && saved.key === flightKey() ? { ...N.emptyState(), ...saved.s } : N.emptyState();
    let stateKey = flightKey();
    let current = null;
    const save = () => App.storage.set(KEY, { key: stateKey, s: state });

    // Senza tracking la fase si deduce dalle istruzioni ricevute
    function phase() {
      if (App.track && App.isTracking && App.isTracking()) return App.track.phase;
      if (state.vacate || state.landing) return 'taxi-in';
      if (state.approach) return 'approach';
      if (state.descent) return 'descent';
      if (state.takeoff) return 'climb';
      if (state.taxi || state.lineup) return 'taxi-out';
      return 'parked';
    }

    // La stazione più "bassa" online alla partenza (Delivery, altrimenti Ground, Tower, Approach)
    function depStation(dep) {
      const data = root.Vatsim && root.Vatsim.last;
      if (!data || !dep) return 'Delivery';
      const names = { 2: 'Delivery', 3: 'Ground', 4: 'Tower', 5: 'Approach' };
      const f = root.Vatsim.atcAt(data, dep).ctrls.map((c) => c.facility).filter((x) => names[x]).sort((a, b) => a - b)[0];
      return f ? names[f] : 'Delivery';
    }

    function ctx() {
      const f = App.flight || {};
      const cs = App.callsignInfo();
      const city = (icao) => ((root.World.airport(icao) || {}).city || '');
      const val = (id) => (($(id) && $(id).value) || '').trim().toUpperCase();
      return {
        phase: phase(),
        cs: cs ? { display: cs.display, spoken: cs.spoken } : null,
        flight: f,
        depCity: city(f.dep),
        arrCity: city(f.arr),
        stand: S.callStand,
        atisDep: val('callAtisDep'),
        atisArr: val('callAtisArr'),
        alt: App.track ? App.track.alt : null,
        toTod: App.todNm,
        depStation: depStation(f.dep),
      };
    }

    function render() {
      const box = $('nextCall');
      const c = ctx();
      current = c.cs && App.flight ? N.suggest(state, c) : null;
      App.emit('next-call', current);
      box.hidden = !current;
      if (!current) return;
      box.querySelector('.eyebrow').textContent = `${t('next.title')} · ${t(current.key)}`;
      $('nextText').textContent = current.text;
      const fq = $('nextFreq');
      fq.hidden = !current.freq;
      fq.textContent = current.freq ? `${current.station} ${current.freq}` : '';
      fq.title = t('next.copyFreq');
    }

    App.on('hotkey', (name) => { if (name === 'next-done') $('nextDone').click(); });
    // Stazione con cui si parla adesso (per l'aiuto emergenze)
    App.nextCallStation = () => (current && current.station) || '';
    $('nextSpeak').addEventListener('click', () => current && root.TTS.speak(current.spoken));
    $('nextDone').addEventListener('click', () => {
      if (!current) return;
      state = N.markDone(state, current.id);
      save();
      render();
    });
    $('nextFreq').addEventListener('click', async () => {
      if (!current || !current.freq) return;
      try { await navigator.clipboard.writeText(current.freq); } catch (e) { /* appunti non disponibili */ }
      App.toast(t('next.copied', { freq: current.freq }));
    });

    App.on('readback', (item) => {
      if (!item || !item.result || item.result.forUs !== true) return;
      state = N.observe(state, item.result);
      save();
      render();
    });
    App.on('flight', () => {
      if (stateKey === flightKey()) return;
      stateKey = flightKey();
      state = N.emptyState();
      save();
      render();
    });
    App.on('track', render);
    for (const k of ['callsign', 'telephony', 'callStand']) App.on(`setting:${k}`, render);
    for (const id of ['callAtisDep', 'callAtisArr']) if ($(id)) $(id).addEventListener('input', render);
    render();
  });
})(this);
