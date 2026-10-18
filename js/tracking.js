/* Scheda Volo: tracking live su mappa dal feed VATSIM (ogni 15 secondi).
   Tra un dato e l'altro l'aereo si muove da solo (stima da GS e prua), così non salta.
   Emette App 'track' con posizione, fase ed eventi (off-block, decollo, atterraggio, on-block). */
(function (root) {
  'use strict';

  const PLANE_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2c.8 0 1.4.9 1.4 2v5.2l7.6 4.6v2l-7.6-2.3v4.4l2.2 1.7V21L12 20l-3.6 1v-1.4l2.2-1.7v-4.4L3 15.8v-2l7.6-4.6V4c0-1.1.6-2 1.4-2z"/></svg>';

  root.App.register((App) => {
    const $ = App.$;
    const L = root.L;
    const ap = (icao) => root.World.airport(icao) || {};
    const t = App.t;
    const TRAIL_KEY = 'readback-copilot-trail';
    const Geo = root.Geo;
    let map = null;
    let routeLine = null; // parte ancora da volare (tratteggiata)
    let routeDone = null; // parte già volata (piena)
    let routeCase = null;
    let trailLine = null;
    let plane = null;
    let todMarker = null;
    let fixMarkers = [];
    let fixLayer = null;
    let route = [];
    let kin = null; // ultimo dato: { lat, lon, hdg, gs, t, shown, off }
    let timer = null;
    let ticker = null;
    let last = App.storage.get('readback-copilot-track-state', null); // { phase, alt, t, todWarned }
    let trail = App.storage.get(TRAIL_KEY, []);
    const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    const pad = () => (App.mapPadding ? App.mapPadding() : { padding: [40, 40] });
    const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // La mappa base (vettoriale offline o dettagliata), i settori ATC e il traffico sono in radar.js
    function routePoints() {
      const f = App.flight;
      if (!f) return [];
      const pos = (icao) => { const a = ap(icao); return typeof a.lat === 'number' ? { lat: a.lat, lon: a.lon } : null; };
      const dep = f.depPos || pos(f.dep);
      const arr = f.arrPos || pos(f.arr);
      const pts = [];
      if (dep) pts.push({ ident: f.dep, ...dep });
      for (const x of f.fixes || []) pts.push(x);
      if (arr) pts.push({ ident: f.arr, ...arr });
      // Solo partenza e arrivo: la rotta segue l'arco di cerchio massimo
      if (pts.length === 2 && Geo.distance(pts[0], pts[1]) > 80) {
        const gc = Geo.greatCircle(pts[0], pts[1], Math.min(64, Math.ceil(Geo.distance(pts[0], pts[1]) / 40))).map(([lat, lon]) => ({ lat, lon }));
        gc[0].ident = pts[0].ident;
        gc[gc.length - 1].ident = pts[1].ident;
        return gc;
      }
      return pts;
    }

    // Longitudini continue (niente salto di 360° attraversando l'antimeridiano)
    function latlngs(pts) {
      const out = [];
      let prev = null;
      for (const p of pts) {
        let lon = p.lon;
        if (prev !== null) { while (lon - prev > 180) lon -= 360; while (prev - lon > 180) lon += 360; }
        out.push([p.lat, lon]);
        prev = lon;
      }
      return out;
    }

    function drawRoute() {
      if (!map) return;
      for (const l of [routeLine, routeDone, routeCase, todMarker, fixLayer, ...fixMarkers]) if (l) l.remove();
      routeLine = routeDone = routeCase = todMarker = fixLayer = null;
      fixMarkers = [];
      route = routePoints();
      if (route.length < 2) return;
      const accent = css('--accent', '#3b82f6');
      const ll = latlngs(route);
      routeCase = L.polyline(ll, { color: css('--route-case', '#ffffff'), weight: 8, opacity: 0.5, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map);
      routeLine = L.polyline(ll, { color: accent, weight: 3.5, opacity: 0.9, dashArray: '1 9', lineCap: 'round', interactive: false }).addTo(map);
      routeDone = L.polyline([], { color: accent, weight: 4.5, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false }).addTo(map);

      // Aeroporti come pin di vetro con codice e città
      const f = App.flight;
      for (const [p, end] of [[route[0], 'dep'], [route[route.length - 1], 'arr']]) {
        const city = ap(p.ident).city || ((end === 'dep' ? f.depName : f.arrName) || '').split(/[\s/-]+/)[0];
        const icon = L.divIcon({
          className: 'ap-pin-icon',
          html: `<div class="ap-pin ${end}"><span class="ap-dot"></span><span class="ap-label"><b>${esc(p.ident)}</b>${city && city !== p.ident ? `<small>${esc(city)}</small>` : ''}</span></div>`,
          iconSize: [14, 14],
          iconAnchor: [7, 7],
        });
        fixMarkers.push(L.marker([p.lat, p.lon], { icon, keyboard: false, interactive: false, zIndexOffset: 500 }).addTo(map));
      }

      // Waypoint (solo da vicino)
      fixLayer = L.layerGroup();
      for (const p of route.slice(1, -1)) {
        if (!p.ident) continue;
        L.circleMarker([p.lat, p.lon], { radius: 3.5, color: accent, weight: 2, fillColor: css('--bg', '#fff'), fillOpacity: 1, interactive: false })
          .bindTooltip(p.ident, { permanent: true, direction: 'right', className: 'wp-label', offset: [6, 0] })
          .addTo(fixLayer);
      }
      updateFixLayer();
      if (kin) updateSplit(displayed(Date.now()));
      if (!plane) fitRoute();
    }

    function updateFixLayer() {
      if (!map || !fixLayer) return;
      const show = map.getZoom() >= 7;
      if (show && !map.hasLayer(fixLayer)) fixLayer.addTo(map);
      if (!show && map.hasLayer(fixLayer)) fixLayer.remove();
      $('map').classList.toggle('wp-names', map.getZoom() >= 8);
    }

    // Rotta già volata (piena) e da volare (tratteggiata)
    function updateSplit(pos) {
      if (!routeDone || !pos || route.length < 2) return;
      const prog = Geo.routeProgress(route, pos);
      if (!prog) return;
      routeDone.setLatLngs(latlngs(route.slice(0, prog.leg + 1).concat([prog.at])));
      routeLine.setLatLngs(latlngs([prog.at].concat(route.slice(prog.leg + 1))));
    }

    function drawTrail() {
      if (!map) return;
      if (trailLine) trailLine.remove();
      trailLine = null;
      if (trail.length > 1) trailLine = L.polyline(trail.map((p) => [p[0], p[1]]), { pane: 'trail', color: css('--green', '#16a34a'), weight: 3, opacity: 0.55, lineCap: 'round', interactive: false }).addTo(map);
    }

    function fitRoute() {
      if (!map) return;
      const pad = App.mapPadding ? App.mapPadding() : { padding: [40, 40] };
      if (routeLine && route.length > 1) map.fitBounds(L.latLngBounds(latlngs(route)), { ...pad, maxZoom: 8 });
      else if (App.settings.mapView) map.setView(App.settings.mapView.c, App.settings.mapView.z);
      else map.fitBounds(root.I18n.lang === 'it' ? [[36.5, 6.5], [47.2, 18.6]] : [[35, -12], [60, 30]], pad); // Italia o Europa
    }

    function initMap() {
      if (map || !L) return;
      map = L.map('map', { zoomControl: false, attributionControl: true, worldCopyJump: true, zoomSnap: 0.25, minZoom: 2, preferCanvas: true }).setView([42.5, 12.5], 6);
      App.map = map;
      // la scia resta sotto la rotta
      map.createPane('trail').style.zIndex = 395;
      drawRoute();
      drawTrail();
      if (!routeLine) setTimeout(fitRoute, 50);
      if (root.matchMedia) root.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { drawRoute(); drawTrail(); App.emit('theme'); });
      $('mapZoomIn').addEventListener('click', () => map.zoomIn());
      $('mapZoomOut').addEventListener('click', () => map.zoomOut());
      $('mapFit').addEventListener('click', fitRoute);
      $('mapLocate').addEventListener('click', () => {
        if (plane) map.flyTo(plane.getLatLng(), Math.max(map.getZoom(), 8), { duration: 0.8 });
        else { App.toast(t('map.pressFollow')); fitRoute(); }
      });
      map.on('zoomend', updateFixLayer);
      App.on('layout', () => map.invalidateSize());
      // Senza rotta, la mappa riapre dove l'avevi lasciata
      let viewTimer = null;
      map.on('moveend', () => {
        clearTimeout(viewTimer);
        viewTimer = setTimeout(() => { if (!routeLine) { const c = map.getCenter(); App.set('mapView', { c: [+c.lat.toFixed(3), +c.lng.toFixed(3)], z: map.getZoom() }); } }, 800);
      });
    }

    // ------------------------------------------------------------ aereo fluido
    // Posizione mostrata: stima da GS e prua dall'ultimo dato, che assorbe piano piano la correzione
    function displayed(now) {
      if (!kin) return null;
      const dt = Math.max(0, Math.min(45, (now - kin.t) / 1000));
      const p = kin.gs > 30 ? Geo.destination(kin, kin.hdg, (kin.gs * dt) / 3600) : { lat: kin.lat, lon: kin.lon };
      const k = Math.max(0, 1 - (now - kin.shown) / 3000);
      return { lat: p.lat + kin.off.lat * k, lon: p.lon + kin.off.lon * k };
    }

    function tick() {
      if (!plane || !kin) return;
      const pos = displayed(Date.now());
      plane.setLatLng([pos.lat, pos.lon]);
      updateSplit(pos);
    }

    function setPlane(p, now) {
      const reported = Date.parse(p.last_updated);
      // il dato VATSIM può avere qualche secondo: lo porto ad "adesso" (max 30 s, per orologi sfasati)
      const tRep = Number.isFinite(reported) && now - reported >= 0 && now - reported < 30000 ? reported : now;
      const before = plane ? displayed(now) : null;
      kin = { lat: p.latitude, lon: p.longitude, hdg: p.heading, gs: p.groundspeed, t: tRep, shown: now, off: { lat: 0, lon: 0 } };
      const target = displayed(now);
      if (before && Geo.distance(before, target) < 20) kin.off = { lat: before.lat - target.lat, lon: before.lon - target.lon };
      if (!plane) {
        const icon = L.divIcon({ className: 'plane-icon', html: `<div class="plane-wrap"><span class="plane-halo"></span><div class="plane-rot">${PLANE_SVG}</div></div>`, iconSize: [42, 42], iconAnchor: [21, 21] });
        plane = L.marker([target.lat, target.lon], { icon, zIndexOffset: 1000, keyboard: false }).addTo(map);
        // prima posizione: inquadra rotta + aereo insieme
        const b = route.length > 1 ? L.latLngBounds(latlngs(route)).extend([target.lat, target.lon]) : L.latLngBounds([[target.lat, target.lon], [target.lat, target.lon]]);
        map.fitBounds(b.pad(0.05), { ...pad(), maxZoom: 8 });
      } else {
        // La mappa segue l'aereo quando esce dalla zona visibile
        map.panInside([target.lat, target.lon], pad());
      }
      const el = plane.getElement();
      if (el) {
        el.querySelector('.plane-rot').style.transform = `rotate(${p.heading}deg)`;
        el.classList.toggle('on-ground', p.groundspeed < 50);
      }
      if (!ticker) ticker = setInterval(tick, 250);
      tick();
    }

    // ------------------------------------------------------------ Top of Descent
    function updateTod(phase, alt, gs, remaining) {
      const el = $('trkTod');
      const f = App.flight || {};
      if (phase !== 'cruise' || remaining === null || route.length < 2) {
        el.hidden = true;
        if (todMarker) { todMarker.remove(); todMarker = null; }
        return;
      }
      const tod = Geo.todDistance(alt, f.arrElev || 0);
      const toTod = remaining - tod;
      const min = gs > 100 ? Math.round((Math.max(0, toTod) / gs) * 60) : null;
      el.hidden = false;
      el.classList.toggle('now', toTod <= 10);
      el.innerHTML = `${root.Icons.svg('trending-down')}<span>${toTod > 0 ? `${t('tod.in', { nm: Math.round(toTod) })}${min !== null ? ` · ${min} min` : ''}` : t('tod.passed')}</span>`;
      const pt = Geo.pointAlong(route, tod);
      if (pt) {
        const ll = latlngs([route[0], pt]).pop();
        if (!todMarker) {
          todMarker = L.marker(ll, { icon: L.divIcon({ className: 'td-pin-icon', html: '<div class="td-pin">T/D</div>', iconSize: [36, 22], iconAnchor: [18, 11] }), keyboard: false, interactive: false }).addTo(map);
        } else todMarker.setLatLng(ll);
      }
      if (toTod <= 10 && last && !last.todWarned) {
        last.todWarned = true;
        App.storage.set('readback-copilot-track-state', last);
        const cs = App.callsignInfo();
        const say = `${cs ? cs.display : ''}, request descent`;
        root.TTS.ping();
        App.toast(t(toTod > 0 ? 'tod.soon' : 'tod.late', { say }), 12000);
      }
    }

    function fmtAlt(ft) {
      if (ft >= 10500) return `FL${Math.round(ft / 100)}`;
      return `${Math.round(ft / 10) * 10} ft`;
    }

    function setPanel(o) {
      $('trkPhase').textContent = o.phase;
      $('trkAlt').textContent = o.alt;
      $('trkGs').textContent = o.gs;
      $('trkRemain').textContent = o.remain;
      $('trkEta').textContent = o.eta;
      const pct = `${Math.round((o.pct || 0) * 100)}%`;
      $('trkProgress').style.width = pct;
      $('trkProgress').parentElement.style.setProperty('--p', pct);
      $('trkUpdated').textContent = o.updated || '';
    }

    async function poll() {
      const cs = App.callsignInfo();
      if (!cs) { $('trackMsg').textContent = t('flight.setCallsign'); return; }
      let data;
      try {
        data = await root.Vatsim.feed(10000);
      } catch (e) {
        $('trackMsg').textContent = t('flight.vatsimError', { msg: e.message });
        return;
      }
      const p = root.Vatsim.pilot(data, cs.code);
      if (!p) {
        $('trackMsg').textContent = t('track.notConnected', { cs: cs.code });
        setPanel({ phase: t('track.offline'), alt: '—', gs: '—', remain: '—', eta: '—', pct: 0 });
        $('trkTod').hidden = true;
        return;
      }
      $('trackMsg').textContent = '';

      // Volo non caricato: lo ricavo dal piano di volo inviato a VATSIM
      const fp = p.flight_plan || {};
      if ((!App.flight || App.flight.dep !== fp.departure) && fp.departure && fp.arrival) {
        App.setFlight({
          source: 'VATSIM', callsign: p.callsign, dep: fp.departure, arr: fp.arrival,
          depName: ap(fp.departure).name || fp.departure, arrName: ap(fp.arrival).name || fp.arrival,
          aircraft: fp.aircraft_short || '', cruise: fp.altitude ? Math.round(Number(String(fp.altitude).replace(/\D/g, '')) / (Number(fp.altitude) > 1000 ? 100 : 1)) : null, route: fp.route || '',
        });
      }

      const now = Date.now();
      const pos = { lat: p.latitude, lon: p.longitude };
      const vs = last && last.t && now - last.t > 5000 ? ((p.altitude - last.alt) / ((now - last.t) / 60000)) : 0;
      if (route.length < 2) route = routePoints();
      const prog = root.Geo.routeProgress(route, pos);
      const remaining = prog ? prog.remaining : null;
      const f = App.flight || {};
      const phase = root.Geo.phase({ alt: p.altitude, gs: p.groundspeed, vs, remaining, cruiseFt: f.cruise ? f.cruise * 100 : null }, last ? last.phase : null);
      const evts = root.Geo.events(last ? last.phase : null, phase);
      last = { phase, alt: p.altitude, t: now, todWarned: !!(last && last.todWarned) };
      App.storage.set('readback-copilot-track-state', last);

      if (!trail.length || root.Geo.distance({ lat: trail[trail.length - 1][0], lon: trail[trail.length - 1][1] }, pos) > 2) {
        trail.push([pos.lat, pos.lon]);
        if (trail.length > 2000) trail.shift();
        App.storage.set(TRAIL_KEY, trail);
      }

      const etaDate = root.Geo.eta(remaining, p.groundspeed, now);
      setPanel({
        phase: t(`fphase.${phase}`),
        alt: fmtAlt(p.altitude),
        gs: `${p.groundspeed} kt`,
        remain: remaining !== null ? `${Math.round(remaining)} NM` : '—',
        eta: etaDate ? root.I18n.time(etaDate) : '—',
        pct: prog ? prog.pct : 0,
        updated: t('track.updated', { time: root.I18n.time(now, true) }),
      });

      if (map) {
        setPlane(p, now);
        drawTrail();
        updateTod(phase, p.altitude, p.groundspeed, remaining);
      }

      App.track = { pos, alt: p.altitude, gs: p.groundspeed, heading: p.heading, vs, phase, progress: prog, remaining, eta: etaDate, pilot: p, t: now };
      App.emit('track', { ...App.track, events: evts });
    }

    function start() {
      if (timer) return;
      App.set('tracking', true);
      $('trackToggle').innerHTML = `${root.Icons.svg('square')} <span>${t('track.stop')}</span>`;
      $('trackToggle').classList.add('stop');
      poll();
      timer = setInterval(poll, 15000);
    }
    function stop() {
      clearInterval(timer);
      timer = null;
      App.set('tracking', false);
      $('trackToggle').innerHTML = `${root.Icons.svg('navigation')} <span>${t('hud.follow')}</span>`;
      $('trackToggle').classList.remove('stop');
      // l'aereo si ferma dov'è
      if (kin) { const p = displayed(Date.now()); kin = { ...kin, lat: p.lat, lon: p.lon, gs: 0, off: { lat: 0, lon: 0 } }; }
    }

    $('trackToggle').addEventListener('click', () => (timer ? stop() : start()));
    App.on('flight', () => {
      drawRoute();
      // Nuovo volo: nuova scia
      const key = App.flight ? `${App.flight.dep}-${App.flight.arr}` : '';
      if (App.storage.get('readback-copilot-trail-key', '') !== key) {
        trail = [];
        last = null;
        App.storage.set(TRAIL_KEY, trail);
        App.storage.set('readback-copilot-trail-key', key);
        App.storage.set('readback-copilot-track-state', null);
        drawTrail();
      }
    });
    initMap();
    App.isTracking = () => !!timer;
    App.routePoints = () => route;
    if (App.settings.tracking) start();
  });
})(this);
