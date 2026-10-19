/* Scheda Bordo › Annunci: annunci PA compilati con il volo, letti con il "din-don" e la voce di Windows.
   La fase del volo propone l'annuncio giusto. */
(function (root) {
  'use strict';

  root.App.register((App) => {
    const $ = App.$;
    const S = App.settings;
    const PA = root.Announcements;
    const t = App.t;
    const L = (x) => root.I18n.pick(x);
    const phaseName = (p) => t(`fphase.${p}`);
    const KEY = 'readback-copilot-pa';
    let state = App.storage.get(KEY, null) || { key: '', done: {} };
    let speaking = null; // { id, stop }
    let open = null;
    let lastPhase = null;
    let arrMetar = null;

    const flightKey = () => (App.flight ? `${App.flight.dep}-${App.flight.arr}-${App.flight.callsign || ''}` : '');
    const save = () => App.storage.set(KEY, state);
    if (state.key !== flightKey()) state = { key: flightKey(), done: {} };

    function ctx() {
      const f = App.flight || {};
      const city = (icao, name) => {
        const a = root.World.airport(icao);
        return (a && a.city) || (name || '').split(/[\s/-]+/)[0] || icao || '';
      };
      let total = f.ete ? f.ete / 60 : null;
      const route = App.routePoints ? App.routePoints() : [];
      if (!total && route.length > 1) {
        let nm = 0;
        for (let i = 1; i < route.length; i++) nm += root.Geo.distance(route[i - 1], route[i]);
        total = (nm / 430) * 60 + 15;
      }
      const t = App.track;
      const left = t && t.remaining !== null && t.remaining !== undefined && t.gs > 100 ? (t.remaining / t.gs) * 60 + 4 : null;
      return {
        callsign: (App.callsignInfo() || {}).code || f.callsign || '',
        airlineName: S.airlineName,
        captain: S.captainName,
        depCity: f.dep ? city(f.dep, f.depName) : '',
        arrCity: f.arr ? city(f.arr, f.arrName) : '',
        aircraft: f.aircraft || S.aircraft,
        cruiseFl: f.cruise,
        minutesTotal: total,
        minutesLeft: left !== null ? left : total,
        arrMetar,
      };
    }

    const langs = () => (S.paLang === 'it' ? ['it'] : S.paLang === 'en' ? ['en'] : ['it', 'en']);
    const phase = () => (App.track && App.track.phase) || 'parked';

    function current(list) {
      return PA.suggest(list, phase(), state.done) || list.find((a) => !state.done[a.id] && !a.anytime) || null;
    }

    // Lettura: din-don, poi frase per frase (Chrome tronca le frasi molto lunghe)
    async function speak(a) {
      if (speaking) { const was = speaking.id; stopSpeaking(); if (was === a.id) return; }
      let stopped = false;
      speaking = { id: a.id, stop: () => { stopped = true; root.TTS.stop(); } };
      render();
      let order = langs();
      if (order.includes('it') && 'speechSynthesis' in root && !root.TTS.voices('it').length) {
        order = order.filter((l) => l !== 'it');
        App.toast(t('pa.noItalian'), 6000);
        if (!order.length) order = ['en'];
      }
      await root.TTS.chime();
      for (const l of order) {
        const parts = a[l].match(/[^.!?]+[.!?]*/g) || [a[l]];
        for (const p of parts) {
          if (stopped) break;
          await root.TTS.speak(p.trim(), { lang: l, queue: true });
        }
        if (stopped) break;
      }
      if (!stopped) { state.done[a.id] = true; save(); }
      if (speaking && speaking.id === a.id) speaking = null;
      render();
    }
    function stopSpeaking() {
      if (speaking) speaking.stop();
      speaking = null;
    }

    function textFor(a) {
      const order = langs();
      return order.map((l) => a[l]);
    }

    function renderHero(list) {
      const el = $('paHero');
      const I = root.Icons.svg;
      const a = current(list);
      if (!a) {
        el.innerHTML = `<div class="pa-empty">${I('circle-check')}<b>${t('pa.allDone')}</b><span>${t('pa.allDoneSub')}</span></div>`;
        return;
      }
      el.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'pa-hero-head';
      head.innerHTML = `<span class="pa-ico">${I('megaphone')}</span><div><span class="eyebrow"></span><h3></h3></div>`;
      head.querySelector('.eyebrow').textContent = t('pa.suggested', { phase: phaseName(phase()), who: L(a.who) });
      head.querySelector('h3').textContent = L(a.title);
      const txt = document.createElement('div');
      txt.className = 'pa-text';
      for (const t of textFor(a)) { const p = document.createElement('p'); p.textContent = t; txt.append(p); }
      const row = document.createElement('div');
      row.className = 'btn-row';
      const play = document.createElement('button');
      play.className = `btn primary${speaking && speaking.id === a.id ? ' stop' : ''}`;
      play.innerHTML = speaking && speaking.id === a.id ? `${I('square')} <span>${t('pa.stop')}</span>` : `${I('volume-2')} <span>${t('pa.read')}</span>`;
      play.addEventListener('click', () => speak(a));
      const done = document.createElement('button');
      done.className = 'btn tinted';
      done.innerHTML = `${I('check')} <span>${t('pa.done')}</span>`;
      done.addEventListener('click', () => { state.done[a.id] = true; save(); render(); });
      row.append(play, done);
      el.append(head, txt, row);
    }

    function renderList(list) {
      const ol = $('paList');
      const I = root.Icons.svg;
      const sug = current(list);
      ol.innerHTML = '';
      for (const a of list) {
        const li = document.createElement('li');
        li.className = `pa-item${state.done[a.id] ? ' done' : ''}${sug && sug.id === a.id ? ' next' : ''}${open === a.id ? ' open' : ''}`;
        li.innerHTML = `<button class="pa-row" type="button"><span class="pa-check">${I('check')}</span><span class="pa-title"><b></b><small></small></span><span class="pa-play" title="${t('pa.listen')}">${I(speaking && speaking.id === a.id ? 'square' : 'volume-2')}</span></button><div class="pa-body"></div>`;
        li.querySelector('b').textContent = L(a.title);
        li.querySelector('small').textContent = `${L(a.who)} · ${a.anytime ? t('pa.whenNeeded') : a.phases.map(phaseName).join(', ')}`;
        for (const t of textFor(a)) { const p = document.createElement('p'); p.textContent = t; li.querySelector('.pa-body').append(p); }
        li.querySelector('.pa-row').addEventListener('click', (e) => {
          if (e.target.closest('.pa-play')) { speak(a); return; }
          if (e.target.closest('.pa-check')) { state.done[a.id] = !state.done[a.id]; save(); render(); return; }
          open = open === a.id ? null : a.id;
          render();
        });
        ol.append(li);
      }
    }

    function render() {
      const list = PA.build(ctx());
      renderHero(list);
      renderList(list);
    }

    // METAR di arrivo per il meteo negli annunci (cache condivisa con la scheda Volo)
    async function loadArrMetar() {
      const f = App.flight;
      if (!f || !f.arr || !root.AirportWx) return;
      try {
        const info = await root.AirportWx.get(f.arr);
        if (info && info.metar && info.metar !== arrMetar) { arrMetar = info.metar; render(); }
      } catch (e) { /* senza meteo gli annunci lo saltano */ }
    }

    $('paReset').addEventListener('click', () => { state.done = {}; save(); render(); });
    for (const k of ['paLang', 'captainName', 'airlineName', 'callsign', 'telephony', 'aircraft']) App.on(`setting:${k}`, render);
    App.on('wx', loadArrMetar);
    if (root.I18n.onChange) root.I18n.onChange(render);
    App.on('flight', () => {
      if (state.key !== flightKey()) { state = { key: flightKey(), done: {} }; save(); arrMetar = null; }
      render();
      loadArrMetar();
    });
    App.on('track', (e) => {
      if (e.phase === lastPhase) return;
      const first = lastPhase === null;
      lastPhase = e.phase;
      render();
      const a = current(PA.build(ctx()));
      if (!first && a && a.phases.includes(e.phase)) App.toast(t('pa.toast', { name: L(a.title) }), 5000);
    });
    App.on('tab', (id) => { if (id === 'cabin') loadArrMetar(); });
    render();
  });
})(this);
