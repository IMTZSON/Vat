/* Scheda Volo: tracking live su mappa dal feed VATSIM (ogni 15 secondi).
   Emette App 'track' con posizione, fase ed eventi (off-block, decollo, atterraggio, on-block). */
(function (root) {
  'use strict';

  const PLANE_SVG = '<svg viewBox="0 0 24 24"><path d="M12 2c.8 0 1.4.9 1.4 2v5.2l7.6 4.6v2l-7.6-2.3v4.4l2.2 1.7V21L12 20l-3.6 1v-1.4l2.2-1.7v-4.4L3 15.8v-2l7.6-4.6V4c0-1.1.6-2 1.4-2z"/></svg>';

  root.App.register((App) => {
    const $ = App.$;
    const L = root.L;
    const A = root.Scenarios.AIRPORTS;
    const TRAIL_KEY = 'readback-copilot-trail';
    let map = null;
    let tiles = null;
    let routeLine = null;
    let trailLine = null;
    let plane = null;
    let fixMarkers = [];
    let timer = null;
    let last = App.storage.get('readback-copilot-track-state', null); // { phase, alt, t }
    let trail = App.storage.get(TRAIL_KEY, []);

    const dark = () => root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches;

    // OpenStreetMap (senza chiave, con un filtro per lo stile chiaro/scuro dell'app) oppure MapTiler se c'è la chiave
    function setTiles() {
      if (!map) return;
      if (tiles) tiles.remove();
      const style = dark() ? 'dark' : 'light';
      const key = (App.settings.mapKey || '').trim();
      let url;
      if (root.Net.proxy) url = `api/tile/${style}/{z}/{x}/{y}.png${key ? `?k=${encodeURIComponent(key)}` : ''}`;
      else if (key) url = `https://api.maptiler.com/maps/${style === 'dark' ? 'streets-v2-dark' : 'streets-v2'}/256/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`;
      else url = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
      $('map').classList.toggle('tiles-osm', !key);
      tiles = L.tileLayer(url, {
        maxZoom: 18,
        attribution: `${key ? '© <a href="https://www.maptiler.com/copyright/">MapTiler</a> · ' : ''}© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>`,
      }).addTo(map);
      tiles.on('tileerror', () => {
        if (key && !tiles._warned) { tiles._warned = true; App.toast('La chiave MapTiler non funziona: controlla in Impostazioni (intanto uso OpenStreetMap).', 6000); }
      });
    }
    App.on('setting:mapKey', () => setTiles());

    function routePoints() {
      const f = App.flight;
      if (!f) return [];
      const dep = f.depPos || (A[f.dep] ? { lat: A[f.dep].lat, lon: A[f.dep].lon } : null);
      const arr = f.arrPos || (A[f.arr] ? { lat: A[f.arr].lat, lon: A[f.arr].lon } : null);
      const pts = [];
      if (dep) pts.push({ ident: f.dep, ...dep });
      for (const x of f.fixes || []) pts.push(x);
      if (arr) pts.push({ ident: f.arr, ...arr });
      return pts;
    }

    function drawRoute() {
      if (!map) return;
      if (routeLine) routeLine.remove();
      fixMarkers.forEach((m) => m.remove());
      fixMarkers = [];
      const pts = routePoints();
      if (pts.length < 2) return;
      const latlngs = pts.map((p) => [p.lat, p.lon]);
      const accent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#3b82f6';
      routeLine = L.polyline(latlngs, { color: accent, weight: 3.5, opacity: 0.85, dashArray: '2 8', lineCap: 'round' }).addTo(map);
      for (const p of [pts[0], pts[pts.length - 1]]) {
        fixMarkers.push(L.circleMarker([p.lat, p.lon], { radius: 7, color: '#fff', weight: 3, fillColor: accent, fillOpacity: 1 }).bindTooltip(p.ident, { permanent: true, direction: 'top', className: 'fix-label', offset: [0, -10] }).addTo(map));
      }
      if (!plane) fitRoute();
    }

    function drawTrail() {
      if (!map) return;
      if (trailLine) trailLine.remove();
      if (trail.length > 1) trailLine = L.polyline(trail.map((p) => [p[0], p[1]]), { color: getComputedStyle(document.documentElement).getPropertyValue('--green').trim() || '#16a34a', weight: 4, opacity: 0.75, lineCap: 'round' }).addTo(map);
    }

    function fitRoute() {
      if (!map) return;
      const pad = App.mapPadding ? App.mapPadding() : { padding: [40, 40] };
      if (routeLine) map.fitBounds(routeLine.getBounds(), { ...pad, maxZoom: 8 });
      else map.fitBounds([[36.5, 6.5], [47.2, 18.6]], pad); // Italia
    }

    function initMap() {
      if (map || !L) return;
      map = L.map('map', { zoomControl: false, attributionControl: true, worldCopyJump: true, zoomSnap: 0.25 }).setView([42.5, 12.5], 6);
      setTiles();
      drawRoute();
      drawTrail();
      if (!routeLine) setTimeout(fitRoute, 50);
      if (root.matchMedia) root.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { setTiles(); drawRoute(); drawTrail(); });
      $('mapZoomIn').addEventListener('click', () => map.zoomIn());
      $('mapZoomOut').addEventListener('click', () => map.zoomOut());
      $('mapFit').addEventListener('click', fitRoute);
      $('mapLocate').addEventListener('click', () => {
        if (plane) map.flyTo(plane.getLatLng(), Math.max(map.getZoom(), 8), { duration: 0.8 });
        else { App.toast('Premi "Segui volo" per vedere la tua posizione su VATSIM.'); fitRoute(); }
      });
      App.on('layout', () => map.invalidateSize());
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
      if (!cs) { $('trackMsg').textContent = 'Imposta il tuo nominativo nella scheda ATC.'; return; }
      let data;
      try {
        data = await root.Vatsim.feed(10000);
      } catch (e) {
        $('trackMsg').textContent = `Dati VATSIM non disponibili: ${e.message}`;
        return;
      }
      const p = root.Vatsim.pilot(data, cs.code);
      if (!p) {
        $('trackMsg').textContent = `Non risulti connesso come ${cs.code}: appena ti colleghi a VATSIM la posizione compare qui.`;
        setPanel({ phase: 'Non connesso', alt: '—', gs: '—', remain: '—', eta: '—', pct: 0 });
        return;
      }
      $('trackMsg').textContent = '';

      // Volo non caricato: lo ricavo dal piano di volo inviato a VATSIM
      const fp = p.flight_plan || {};
      if ((!App.flight || App.flight.dep !== fp.departure) && fp.departure && fp.arrival) {
        App.setFlight({
          source: 'VATSIM', callsign: p.callsign, dep: fp.departure, arr: fp.arrival,
          depName: (A[fp.departure] || {}).name || fp.departure, arrName: (A[fp.arrival] || {}).name || fp.arrival,
          aircraft: fp.aircraft_short || '', cruise: fp.altitude ? Math.round(Number(String(fp.altitude).replace(/\D/g, '')) / (Number(fp.altitude) > 1000 ? 100 : 1)) : null, route: fp.route || '',
        });
      }

      const now = Date.now();
      const pos = { lat: p.latitude, lon: p.longitude };
      const vs = last && last.t && now - last.t > 5000 ? ((p.altitude - last.alt) / ((now - last.t) / 60000)) : 0;
      const route = routePoints();
      const prog = root.Geo.routeProgress(route, pos);
      const remaining = prog ? prog.remaining : null;
      const f = App.flight || {};
      const phase = root.Geo.phase({ alt: p.altitude, gs: p.groundspeed, vs, remaining, cruiseFt: f.cruise ? f.cruise * 100 : null }, last ? last.phase : null);
      const evts = root.Geo.events(last ? last.phase : null, phase);
      last = { phase, alt: p.altitude, t: now };
      App.storage.set('readback-copilot-track-state', last);

      if (!trail.length || root.Geo.distance({ lat: trail[trail.length - 1][0], lon: trail[trail.length - 1][1] }, pos) > 2) {
        trail.push([pos.lat, pos.lon]);
        if (trail.length > 2000) trail.shift();
        App.storage.set(TRAIL_KEY, trail);
      }

      const etaDate = root.Geo.eta(remaining, p.groundspeed, now);
      setPanel({
        phase: root.Geo.PHASES[phase],
        alt: fmtAlt(p.altitude),
        gs: `${p.groundspeed} kt`,
        remain: remaining !== null ? `${Math.round(remaining)} NM` : '—',
        eta: etaDate ? etaDate.toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '—',
        pct: prog ? prog.pct : 0,
        updated: `aggiornato ${new Date(now).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`,
      });

      if (map) {
        const icon = L.divIcon({ className: 'plane-icon', html: `<div class="plane-wrap"><div style="transform: rotate(${p.heading}deg); display: grid">${PLANE_SVG}</div></div>`, iconSize: [34, 34], iconAnchor: [17, 17] });
        if (!plane) {
          plane = L.marker([pos.lat, pos.lon], { icon }).addTo(map);
          // prima posizione: inquadra rotta + aereo insieme
          const b = routeLine ? routeLine.getBounds().extend([pos.lat, pos.lon]) : L.latLngBounds([[pos.lat, pos.lon], [pos.lat, pos.lon]]);
          map.fitBounds(b.pad(0.05), { ...(App.mapPadding ? App.mapPadding() : {}), maxZoom: 8 });
        }
        else {
          plane.setLatLng([pos.lat, pos.lon]);
          plane.setIcon(icon);
          // La mappa segue l'aereo quando esce dalla zona visibile
          map.panInside([pos.lat, pos.lon], App.mapPadding ? App.mapPadding() : {});
        }
        drawTrail();
      }

      App.track = { pos, alt: p.altitude, gs: p.groundspeed, heading: p.heading, vs, phase, progress: prog, remaining, eta: etaDate, pilot: p, t: now };
      App.emit('track', { ...App.track, events: evts });
    }

    function start() {
      if (timer) return;
      App.set('tracking', true);
      $('trackToggle').innerHTML = `${root.Icons.svg('square')} Stop`;
      $('trackToggle').classList.add('stop');
      poll();
      timer = setInterval(poll, 15000);
    }
    function stop() {
      clearInterval(timer);
      timer = null;
      App.set('tracking', false);
      $('trackToggle').innerHTML = `${root.Icons.svg('navigation')} Segui volo`;
      $('trackToggle').classList.remove('stop');
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
    if (App.settings.tracking) start();
  });
})(this);
