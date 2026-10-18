/* Aiuto emergenze: modulo MAYDAY / PAN PAN già compilato con posizione, livello, prua, autonomia e persone
   a bordo (simulatore, tracking VATSIM o SimBrief), da leggere ad alta voce, con le risposte dell'ATC. */
(function (root) {
  'use strict';

  root.App.register((App) => {
    const $ = App.$;
    const t = App.t;
    const E = root.Emergency;
    const dlg = $('emergencySheet');
    if (!dlg || !E) return;
    let msg = null;

    const fill = (sel, items) => { sel.innerHTML = ''; for (const [v, label] of items) { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.append(o); } };
    const city = (ap) => (ap ? ap.city || ap.name : '');
    const num = (id) => { const v = parseInt($(id).value, 10); return Number.isFinite(v) && v > 0 ? v : null; };

    // Dove siamo: simulatore (preciso), altrimenti l'ultima posizione VATSIM
    function state() {
      const s = App.sim && App.sim();
      const d = s && s.data;
      if (d && typeof d.lat === 'number' && d.lat) return { lat: d.lat, lon: d.lon, alt: d.alt, vs: d.vs, hdg: d.hdg, onGround: !!d.onGround };
      const tr = App.track;
      if (tr && tr.pos) return { lat: tr.pos.lat, lon: tr.pos.lon, alt: tr.alt, vs: tr.vs, hdg: tr.heading, onGround: ['parked', 'taxi-out', 'taxi-in', 'arrived'].includes(tr.phase) };
      return null;
    }

    // Autonomia stimata dal piano SimBrief: carburante all'atterraggio + quello per la tratta che resta
    function fuelMinutes() {
      const fp = App.flight && App.flight.fuelPlan;
      if (!fp || !(fp.flow > 0)) return null;
      const tr = App.track;
      const left = tr && tr.remaining > 0 && tr.gs > 80 ? (fp.landing || 0) + fp.flow * (tr.remaining / tr.gs) : fp.takeoff;
      return left > 0 ? Math.round((left / fp.flow) * 60) : null;
    }

    function prefill() {
      const f = App.flight || {};
      const st = state();
      const near = st ? root.World.nearest(st.lat, st.lon, 4) : [];
      const opts = [];
      const altn = f.altn && root.World.airport(f.altn);
      if (altn) opts.push([f.altn, `${f.altn} · ${city(altn)} (ALTN)`]);
      for (const ap of near) if (ap && !opts.some((o) => o[0] === ap.icao)) opts.push([ap.icao, `${ap.icao} · ${city(ap)}`]);
      fill($('emDivert'), opts);
      $('emDivertField').hidden = !opts.length;
      if (!$('emStation').value) $('emStation').value = (App.nextCallStation && App.nextCallStation()) || '';
      const fm = fuelMinutes();
      if (fm && !$('emFuel').value) $('emFuel').value = fm;
      if (f.pax && !$('emPob').value) $('emPob').value = f.pax + 6;
    }

    function render() {
      const f = App.flight || {};
      const st = state();
      const intent = $('emIntent').value;
      $('emDivertField').hidden = intent !== 'divert' || !$('emDivert').options.length;
      $('emDescendField').hidden = intent !== 'descend';
      let place = null;
      if (st) {
        const ap = root.World.nearest(st.lat, st.lon, 1)[0];
        if (ap) place = { name: city(ap), dist: root.Geo.distance(ap, st), bearing: root.Geo.bearing(ap, st) };
      }
      const cs = App.callsignInfo();
      msg = E.build({
        kind: $('emKind').value, station: $('emStation').value.trim(), cs: cs ? { display: cs.display, spoken: cs.spoken } : null,
        nature: $('emNature').value, intent, place,
        alt: st ? st.alt : null, vs: st ? st.vs : 0, hdg: st ? st.hdg : null, onGround: st ? st.onGround : false,
        fuelMin: num('emFuel'), pob: num('emPob'), descendTo: num('emDescend'),
        depName: city(root.World.airport(f.dep)), arrName: city(root.World.airport(f.arr)),
        divertName: city(root.World.airport($('emDivert').value)),
      });
      const ol = $('emParts');
      ol.innerHTML = '';
      for (const p of msg.parts) {
        const li = document.createElement('li');
        const k = document.createElement('span');
        k.textContent = t(`em.p.${p.key}`);
        const v = document.createElement('b');
        v.textContent = p.d;
        li.append(k, v);
        ol.append(li);
      }
      $('emSquawk').hidden = !msg.squawk;
      $('emSquawk').textContent = msg.squawk ? t('em.squawk', { code: msg.squawk }) : '';
      const rl = $('emReplies');
      rl.innerHTML = '';
      for (const r of msg.replies) {
        const li = document.createElement('li');
        const a = document.createElement('p');
        a.className = 'em-atc';
        a.textContent = `ATC: ${r.atc}`;
        const p = document.createElement('p');
        p.className = 'em-pilot';
        p.textContent = r.pilot ? `↳ ${r.pilot}` : t('em.noReply');
        li.append(a, p);
        rl.append(li);
      }
      $('emCancel').textContent = msg.cancel;
    }

    App.openEmergency = () => {
      fill($('emNature'), Object.keys(E.NATURES).map((k) => [k, t(`em.n.${k}`)]));
      fill($('emIntent'), E.INTENTS.map((k) => [k, t(`em.i.${k}`)]));
      prefill();
      $('emKind').value = 'mayday';
      $('emKind').dispatchEvent(new Event('sync'));
      render();
      if (!dlg.open) dlg.showModal();
    };
    // la natura suggerisce il tipo (fumo -> MAYDAY, malore -> PAN PAN) e le intenzioni più probabili
    $('emNature').addEventListener('change', () => {
      const n = $('emNature').value;
      $('emKind').value = E.NATURES[n].kind;
      $('emKind').dispatchEvent(new Event('sync'));
      if (n === 'decompression') $('emIntent').value = 'descend';
      else if (n === 'medical') $('emIntent').value = 'continue';
      else if ($('emIntent').value === 'descend') $('emIntent').value = 'nearest';
      render();
    });
    for (const id of ['emKind', 'emIntent', 'emDivert']) $(id).addEventListener('change', render);
    for (const id of ['emStation', 'emFuel', 'emPob', 'emDescend']) $(id).addEventListener('input', render);
    $('emSpeak').addEventListener('click', () => msg && root.TTS.speak(msg.spoken));
    $('emCopy').addEventListener('click', async () => {
      if (!msg) return;
      try { await navigator.clipboard.writeText(msg.display); App.toast(t('em.copied')); } catch (e) { /* appunti non disponibili */ }
    });
    $('emClose').addEventListener('click', () => { root.TTS.stop(); dlg.close(); });
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
    $('emOpen').addEventListener('click', () => App.openEmergency());
    document.querySelectorAll('[data-em-open]').forEach((b) => b.addEventListener('click', () => App.openEmergency()));
  });
})(this);
