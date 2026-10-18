/* Rullaggio sulla mappa: all'istruzione "taxi" dell'ATC disegna lo schema dell'aeroporto (piste e taxiway
   di OpenStreetMap), il percorso da seguire, il punto attesa e le piste da attraversare. */
(function (root) {
  'use strict';

  root.App.register((App) => {
    const L = root.L;
    const map = App.map;
    const T = root.Taxi;
    const t = App.t;
    if (!map || !L || !T) return;
    map.createPane('groundmap').style.zIndex = 385;
    map.createPane('taxiroute').style.zIndex = 430;
    map.getPane('groundmap').style.pointerEvents = 'none';
    const css = (name, fallback) => getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
    const cache = {};
    let layers = [];
    let current = null; // { icao, plan, at }

    function clear() {
      layers.forEach((l) => l.remove());
      layers = [];
      current = null;
    }
    const add = (l) => { l.addTo(map); layers.push(l); return l; };

    async function ground(icao) {
      if (cache[icao]) return cache[icao];
      const ap = root.World.airport(icao);
      if (!ap || typeof ap.lat !== 'number' || !root.Net.proxy) return null;
      cache[icao] = fetch(`api/ground?icao=${encodeURIComponent(icao)}&lat=${ap.lat}&lon=${ap.lon}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      const g = await cache[icao];
      if (!g) delete cache[icao];
      return g;
    }

    // Posizione dell'aereo: dal simulatore (precisa), altrimenti da VATSIM se è all'aeroporto
    function position(icao) {
      const s = App.sim && App.sim();
      if (s && s.data && typeof s.data.lat === 'number' && s.data.lat) return { lat: s.data.lat, lon: s.data.lon };
      const ap = root.World.airport(icao);
      const p = App.track && App.track.pos;
      if (p && ap && root.Geo.distance(p, ap) < 4) return p;
      return null;
    }

    // Schema dell'aeroporto: piste larghe, taxiway sottili, nome di ogni taxiway una volta
    function drawAirport(g) {
      const rw = css('--ground-runway', '#64748b');
      const tw = css('--ground-taxi', '#cbd5e1');
      const ll = (ids) => ids.map((id) => g.nodes[id]);
      for (const w of g.ways) {
        if (w.kind === 'runway') add(L.polyline(ll(w.nodes), { pane: 'groundmap', color: rw, weight: 9, opacity: 0.9, lineCap: 'butt', interactive: false }));
      }
      const longest = {};
      for (const w of g.ways) {
        if (w.kind === 'runway') continue;
        add(L.polyline(ll(w.nodes), { pane: 'groundmap', color: tw, weight: w.kind === 'taxilane' ? 1.5 : 3, opacity: 0.9, interactive: false }));
        if (w.ref && (!longest[w.ref] || w.nodes.length > longest[w.ref].nodes.length)) longest[w.ref] = w;
      }
      for (const w of Object.values(longest)) {
        const mid = g.nodes[w.nodes[Math.floor(w.nodes.length / 2)]];
        add(L.marker(mid, { pane: 'groundmap', interactive: false, keyboard: false, icon: L.divIcon({ className: 'twy-label-icon', html: `<span class="twy-label">${w.ref.replace(/[^A-Z0-9]/g, '')}</span>`, iconSize: [0, 0] }) }));
      }
    }

    const bearing = (a, b) => root.Geo.bearing({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] });

    function drawRoute(r, plan) {
      const accent = css('--accent', '#3b82f6');
      add(L.polyline(r.points, { pane: 'taxiroute', color: css('--route-case', '#ffffff'), weight: 10, opacity: 0.85, lineCap: 'round', lineJoin: 'round', interactive: false }));
      add(L.polyline(r.points, { pane: 'taxiroute', color: accent, weight: 5, opacity: 1, lineCap: 'round', lineJoin: 'round', interactive: false }));
      // frecce lungo il percorso ogni ~120 m
      let acc = 0;
      let arrows = 0;
      for (let i = 1; i < r.points.length && arrows < 40; i++) {
        const a = r.points[i - 1];
        const b = r.points[i];
        acc += root.Geo.distance({ lat: a[0], lon: a[1] }, { lat: b[0], lon: b[1] }) * 1852;
        if (acc >= 120) {
          acc = 0;
          arrows++;
          add(L.marker([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], { pane: 'taxiroute', interactive: false, keyboard: false, icon: L.divIcon({ className: 'taxi-arrow-icon', html: `<span class="taxi-arrow" style="transform: rotate(${Math.round(bearing(a, b))}deg)">➤</span>`, iconSize: [14, 14], iconAnchor: [7, 7] }) }));
        }
      }
      // punto attesa / destinazione
      const label = plan.target ? (plan.target.ref || (plan.target.runway ? `RWY ${plan.target.runway}` : '')) : '';
      const last = r.points[r.points.length - 1];
      const prev = r.points[r.points.length - 2] || last;
      add(L.marker(last, { pane: 'taxiroute', interactive: false, keyboard: false, icon: L.divIcon({ className: 'taxi-hold-icon', html: `<span class="taxi-hold" style="transform: rotate(${Math.round(bearing(prev, last))}deg)"></span><span class="taxi-hold-label">${label.replace(/[<>&"]/g, '')}</span>`, iconSize: [0, 0] }) }));
      for (const c of r.crossings) {
        add(L.marker(c.at, { pane: 'taxiroute', interactive: false, keyboard: false, icon: L.divIcon({ className: 'taxi-cross-icon', html: `<span class="taxi-cross">${t('taxi.cross', { rwy: String(c.runway).replace(/[<>&"]/g, '') })}</span>`, iconSize: [0, 0] }) }));
      }
      map.fitBounds(L.latLngBounds(r.points), { ...(App.mapPadding ? App.mapPadding() : {}), maxZoom: 17 });
    }

    async function show(plan, icao) {
      clear();
      current = { icao, plan, at: Date.now() };
      const g = await ground(icao);
      if (!current || current.plan !== plan) return; // nel frattempo è arrivata un'altra istruzione
      if (!g || !g.ways.length) { App.toast(t('taxi.noData', { icao }), 6000); return; }
      drawAirport(g);
      const pos = position(icao);
      const route = pos ? T.route(T.buildGraph(g), pos, plan) : { ok: false, reason: 'nopos' };
      const path = [...plan.via, plan.target && (plan.target.ref || plan.target.runway)].filter(Boolean).join(' → ');
      if (route.ok) {
        drawRoute(route, plan);
        App.toast(`${t('taxi.route', { path, m: route.length })}${route.crossings.length ? ` · ${t('taxi.crossings', { n: route.crossings.length })}` : ''}${route.missing.length ? ` · ${t('taxi.missing', { refs: route.missing.join(', ') })}` : ''}`, 8000);
      } else {
        // percorso non calcolabile: si evidenziano i taxiway nominati
        const named = T.namedWays(g, plan);
        for (const pts of named) add(L.polyline(pts, { pane: 'taxiroute', color: css('--accent', '#3b82f6'), weight: 5, opacity: 0.9, interactive: false }));
        if (named.length) map.fitBounds(L.latLngBounds(named.flat()), { maxZoom: 16 });
        App.toast(t(route.reason === 'nopos' ? 'taxi.noPos' : 'taxi.noRoute', { path }), 7000);
      }
      App.emit('taxi', { plan, route });
    }

    App.on('readback', (item) => {
      if (!item || !item.result || item.result.forUs !== true) return;
      const plan = T.parseClearance(item.result.parts);
      if (!plan || !App.flight) return;
      // stand = all'arrivo; punto attesa o pista = alla partenza
      const icao = plan.target && plan.target.kind === 'stand' ? App.flight.arr : App.flight.dep;
      show(plan, icao);
    });
    // decollo, arrivo allo stand o nuovo volo: il percorso sparisce
    App.on('track', (e) => { if (current && ['takeoff', 'climb', 'arrived'].includes(e.phase) && Date.now() - current.at > 30000) clear(); });
    App.on('flight', clear);
    App.clearTaxi = clear;
    App.showTaxi = show;
    // Nomi dei taxiway dell'aeroporto (per la prova generale): [] se i dati del suolo non ci sono
    App.groundRefs = async (icao) => {
      const g = icao ? await ground(icao) : null;
      return g ? [...new Set(g.ways.filter((w) => w.kind !== 'runway' && w.ref).map((w) => w.ref))] : [];
    };
  });
})(this);
