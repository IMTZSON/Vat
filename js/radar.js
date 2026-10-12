/* Mappa radar: base vettoriale offline (sempre disponibile) o dettagliata, settori ATC REALI
   (FIR/UIR di VATSpy, TRACON di SimAware, cerchi solo per TWR/GND/DEL), aeroporti con ATC e traffico
   live di VATSIM e IVAO con filtri. La mappa e il tuo volo sono in tracking.js. */
(function (root) {
  'use strict';

  const L = root.L;
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const DEFAULTS = { vatsim: true, ivao: true, pilots: true, sectors: true, airports: true, labels: true, firLines: true, mine: false, phase: 'all', base: 'vector' };
  const KIND_COLOR = { fir: '--sec-ctr', uir: '--sec-uir', tracon: '--sec-app', tower: '--sec-twr', ground: '--sec-gnd', delivery: '--sec-del', atis: '--sec-atis' };
  const POS_LETTER = { delivery: 'D', ground: 'G', tower: 'T', atis: 'A' };
  const VATSIM_EVERY = 15000;
  const IVAO_EVERY = 30000;
  // Sagoma dell'aereo (punta in su), disegnata ruotata sulla prua
  const PLANE = typeof Path2D === 'function' ? new Path2D('M0 -9 C1 -9 1.4 -7.6 1.4 -6.4 L1.4 -2.2 L8.4 2 L8.4 3.8 L1.4 1.8 L1.4 5.8 L3.6 7.4 L3.6 8.8 L0 7.8 L-3.6 8.8 L-3.6 7.4 L-1.4 5.8 L-1.4 1.8 L-8.4 3.8 L-8.4 2 L-1.4 -2.2 L-1.4 -6.4 C-1.4 -7.6 -1 -9 0 -9 Z') : null;

  root.App.register((App) => {
    const map = App.map;
    if (!map || !L) return;
    const $ = App.$;
    const t = App.t;
    const S = App.settings;
    const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    const opts = () => ({ ...DEFAULTS, ...(S.radar || {}) });
    const setOpt = (k, v) => { App.set('radar', { ...opts(), [k]: v }); };

    // Pannelli (ordine di disegno): base < confini FIR < settori < traffico < etichette
    for (const [name, z] of [['basemap', 150], ['firlines', 380], ['sectors', 410], ['traffic', 450], ['labels', 620]]) {
      map.createPane(name).style.zIndex = z;
    }
    map.getPane('basemap').style.pointerEvents = 'none';
    map.getPane('firlines').style.pointerEvents = 'none';
    map.getPane('traffic').style.pointerEvents = 'none';
    const canvasFor = (pane) => L.canvas({ pane, padding: 0.4 });

    // ================================================================== mappa base
    let vector = null;
    let tiles = null;
    const basemaps = {};
    let tileErrors = 0;
    // 1:50M fino allo zoom 5, poi 1:10M (coste e confini precisi da vicino)
    const DETAIL_ZOOM = 6;
    const wantDetail = () => map.getZoom() >= DETAIL_ZOOM;
    let vectorDetail = null;

    async function loadBasemap(detail) {
      const k = detail ? 'hi' : 'lo';
      if (!basemaps[k]) {
        basemaps[k] = fetch(detail ? 'data/basemap-10m.json' : 'data/basemap.json').then((r) => r.json())
          .then((topo) => root.topojson.feature(topo, topo.objects.countries));
      }
      return basemaps[k];
    }

    function styleVector() {
      return { color: css('--map-border'), weight: 0.7, fillColor: css('--map-land'), fillOpacity: 1, interactive: false };
    }

    async function setBase() {
      const o = opts();
      document.getElementById('map').classList.toggle('base-vector', o.base !== 'detailed');
      if (o.base === 'detailed') {
        if (vector) { vector.remove(); vector = null; vectorDetail = null; }
        if (!tiles) addTiles();
        return;
      }
      if (tiles) { tiles.remove(); tiles = null; }
      const detail = wantDetail();
      if (vector && vectorDetail === detail) return;
      try {
        const geo = await loadBasemap(detail);
        if (opts().base === 'detailed' || wantDetail() !== detail) return;
        if (vector) vector.remove();
        vector = L.geoJSON(geo, { pane: 'basemap', renderer: canvasFor('basemap'), style: styleVector, interactive: false }).addTo(map);
        vectorDetail = detail;
      } catch (e) {
        basemaps[detail ? 'hi' : 'lo'] = null; // si riprova al prossimo zoom
      }
    }
    map.on('zoomend', () => { if (opts().base !== 'detailed' && vectorDetail !== wantDetail()) setBase(); });

    // Mappa dettagliata (OpenStreetMap o MapTiler): se le tile non arrivano si torna alla base offline
    function addTiles() {
      const dark = root.matchMedia && root.matchMedia('(prefers-color-scheme: dark)').matches;
      const style = dark ? 'dark' : 'light';
      const key = (S.mapKey || '').trim();
      let url;
      if (root.Net.proxy) url = `api/tile/${style}/{z}/{x}/{y}.png${key ? `?k=${encodeURIComponent(key)}` : ''}`;
      else if (key) url = `https://api.maptiler.com/maps/${dark ? 'streets-v2-dark' : 'streets-v2'}/256/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}`;
      else url = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
      document.getElementById('map').classList.toggle('tiles-osm', !key);
      tileErrors = 0;
      let loaded = 0;
      tiles = L.tileLayer(url, {
        maxZoom: 18,
        attribution: `${key ? '© <a href="https://www.maptiler.com/copyright/">MapTiler</a> · ' : ''}© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>`,
      }).addTo(map);
      tiles.on('tileload', () => { loaded++; });
      tiles.on('tileerror', () => {
        tileErrors++;
        if (tileErrors >= 4 && loaded === 0 && opts().base === 'detailed') {
          App.toast(t('radar.tilesFailed'), 6000);
          setOpt('base', 'vector');
        }
      });
    }

    // Tutti i confini FIR, molto tenui (come i radar di VATSIM)
    let firLines = null;
    function drawFirLines() {
      if (firLines) { firLines.remove(); firLines = null; }
      if (!db || !opts().firLines) return;
      const feats = db.volumes.filter((v) => v.kind === 'fir' && !v.id.includes('-')).map((v) => ({ type: 'Feature', geometry: { type: 'MultiPolygon', coordinates: v.polygons } }));
      firLines = L.geoJSON({ type: 'FeatureCollection', features: feats }, { pane: 'firlines', renderer: canvasFor('firlines'), interactive: false, style: { color: css('--map-fir'), weight: 0.8, fill: false } }).addTo(map);
    }

    // ================================================================== dati: settori e reti
    let db = null;
    const nets = { vatsim: null, ivao: null };
    const netError = { vatsim: '', ivao: '' };

    async function loadSectors() {
      const src = (name, file) => (root.Net.proxy ? `api/mapdata/${name}` : `data/${file}`);
      const [dat, fir, tracon] = await Promise.all([
        fetch(src('vatspy', 'vatspy.dat')).then((r) => r.text()),
        fetch(src('fir', 'fir-boundaries.json')).then((r) => r.json()),
        fetch(src('tracon', 'tracon-boundaries.json')).then((r) => r.json()).catch(() => null),
      ]);
      db = root.Sectors.build(dat, fir, tracon, { airport: (x) => root.World.airport(x) });
      App.sectors = db;
      drawFirLines();
      renderAtc();
    }

    async function pollVatsim() {
      try {
        nets.vatsim = root.Networks.vatsim(await root.Vatsim.feed(10000));
        netError.vatsim = '';
      } catch (e) { netError.vatsim = e.message; }
      refresh();
    }
    async function pollIvao() {
      try {
        nets.ivao = root.Networks.ivao(await root.Net.json(root.Networks.IVAO_URL));
        netError.ivao = '';
      } catch (e) { netError.ivao = e.message; }
      refresh();
    }

    let timers = [];
    function schedule() {
      timers.forEach(clearInterval);
      timers = [];
      const o = opts();
      const want = o.pilots || o.sectors || o.airports;
      if (!want) return;
      if (o.vatsim) { pollVatsim(); timers.push(setInterval(() => { if (!document.body.classList.contains('compact')) pollVatsim(); }, VATSIM_EVERY)); }
      if (o.ivao) { pollIvao(); timers.push(setInterval(() => { if (!document.body.classList.contains('compact')) pollIvao(); }, IVAO_EVERY)); }
    }

    const activeNets = () => ['vatsim', 'ivao'].filter((n) => opts()[n] && nets[n]);
    const allPilots = () => activeNets().flatMap((n) => nets[n].pilots);
    const allAtc = () => activeNets().flatMap((n) => nets[n].atc);

    // ================================================================== settori ATC
    const sectorLayer = L.layerGroup().addTo(map);
    const airportLayer = L.layerGroup().addTo(map);
    let sectorKey = '';

    function kindOf(volume, position) {
      if (volume.kind === 'fir') return 'fir';
      if (volume.kind === 'uir') return 'uir';
      if (position === 'tower') return 'tower'; // poligono SimAware di una torre
      if (volume.kind === 'tracon') return 'tracon';
      return position;
    }

    function atcPopup(list, title, approx) {
      const rows = list.map((c) => `
        <div class="atc-row">
          <div class="atc-top"><b>${esc(c.callsign)}</b><span class="net-tag ${esc(c.net)}">${c.net === 'ivao' ? 'IVAO' : 'VATSIM'}</span><span class="atc-freq">${esc(c.freq)}</span></div>
          ${c.name ? `<div class="atc-name">${esc(c.name)}</div>` : ''}
          ${c.atis && c.atis.length ? `<div class="atc-atis">${esc(c.atis.join(' '))}</div>` : ''}
        </div>`).join('');
      return `<div class="radar-pop"><div class="pop-title">${esc(title)}</div>${approx ? `<div class="pop-note">${esc(t('radar.approx'))}</div>` : ''}${rows}</div>`;
    }

    // Meteo nei popup degli aeroporti: segnaposto riempito all'apertura (METAR + prossime ore del TAF)
    const wxSlot = (icao) => `<div class="pop-wx-slot" data-wx="${esc(icao)}"><span class="muted">${esc(t('flight.updating'))}</span></div>`;
    // subito sotto il titolo (il primo </div> chiude .pop-title)
    const withWx = (html, icao) => html.replace('</div>', `</div>${wxSlot(icao)}`);
    map.on('popupopen', (e) => {
      const el = e.popup.getElement() && e.popup.getElement().querySelector('[data-wx]');
      if (!el || !root.AirportWx) return;
      const icao = el.dataset.wx;
      root.AirportWx.get(icao).then((info) => {
        if (!el.isConnected) return;
        // niente popup.update(): ridisegnerebbe il contenuto originale; il popup cresce verso l'alto da solo
        el.innerHTML = root.AirportWx.compactHtml(info, root.World.airport(icao));
        // se crescendo il popup finisce sotto la Live Activity in alto, sposta la mappa
        const top = e.popup.getElement().getBoundingClientRect().top - map.getContainer().getBoundingClientRect().top;
        if (top < 130) map.panBy([0, top - 130]);
      }).catch(() => { el.remove(); });
    });

    // Popup di un aeroporto qualsiasi (dalla ricerca): nome, controllori online e meteo
    function airportPopup(ap) {
      const list = allAtc().filter((c) => c.callsign.startsWith(`${ap.icao}_`));
      const html = list.length ? atcPopup(list, `${ap.icao} · ${ap.name}`) : `<div class="radar-pop"><div class="pop-title">${esc(`${ap.icao} · ${ap.name}`)}</div><div class="pop-sub">${esc(t('radar.noAtcHere'))}</div></div>`;
      L.popup({ className: 'radar-popup', maxWidth: 320, autoPanPaddingTopLeft: L.point(20, 130) }).setLatLng([ap.lat, ap.lon]).setContent(withWx(html, ap.icao)).openOn(map);
      App.emit('airport-open', ap.icao);
    }

    function renderAtc() {
      const o = opts();
      if (!db) return;
      // Settori: un volume può essere coperto da più controllori (anche di reti diverse)
      const groups = new Map();
      const airports = new Map();
      for (const c of allAtc()) {
        const position = db.position(c.callsign);
        const vols = db.volumesFor(c.callsign);
        for (const v of vols) {
          // TWR/GND/DEL/ATIS senza poligono pubblico: lettere sull'aeroporto, nessun cerchio
          if (v.kind === 'airport') {
            const ap = v.airport;
            if (!ap) continue;
            const a = airports.get(ap) || { icao: ap, center: v.center, name: v.name.replace(/\s+\w+$/, ''), list: [], positions: new Set() };
            a.list.push(c);
            a.positions.add(position);
            airports.set(ap, a);
            continue;
          }
          const g = groups.get(v.id) || { v, kind: kindOf(v, position), list: [] };
          g.list.push(c);
          groups.set(v.id, g);
        }
      }
      const key = `${o.sectors}|${o.airports}|${[...groups.keys()].sort().join(',')}|${[...airports.values()].map((a) => a.icao + [...a.positions].sort().join('')).sort().join(',')}|${allAtc().map((c) => c.key).sort().join(',')}`;
      if (key === sectorKey) return;
      sectorKey = key;
      sectorLayer.clearLayers();
      airportLayer.clearLayers();

      if (o.sectors) {
        // Prima le aree grandi, sopra le piccole (così si può cliccare l'APP dentro un CTR)
        const order = { uir: 0, fir: 1, tracon: 2, tower: 3, ground: 4, delivery: 5 };
        const sorted = [...groups.values()].sort((a, b) => (order[a.kind] || 9) - (order[b.kind] || 9));
        for (const g of sorted) {
          const color = css(KIND_COLOR[g.kind] || '--sec-ctr');
          const ivaoOnly = g.list.every((c) => c.net === 'ivao');
          // Cerchio solo per un APP senza area TRACON nei dati: tratteggiato e segnalato come approssimato
          const approx = g.v.radiusNM !== undefined;
          const style = { pane: 'sectors', color, weight: g.kind === 'fir' || g.kind === 'uir' ? 1.4 : 1.6, opacity: approx ? 0.6 : 0.85, fillColor: color, fillOpacity: approx ? 0.05 : g.kind === 'uir' ? 0.05 : 0.11, dashArray: approx ? '2 6' : ivaoOnly ? '6 4' : null };
          let shape;
          if (approx) shape = L.circle([g.v.center.lat, g.v.center.lon], { ...style, radius: g.v.radiusNM * 1852 });
          else shape = L.polygon(g.v.polygons.map((p) => p.map((ring) => ring.map(([x, y]) => [y, x]))), style);
          shape.bindPopup(() => atcPopup(g.list, g.v.name, approx), { className: 'radar-popup', maxWidth: 320 });
          shape.addTo(sectorLayer);
          // Etichetta del settore (FIR/UIR/TRACON): il prefisso del nominativo
          if (!approx) {
            const label = [...new Set(g.list.map((c) => c.callsign.replace(/_(CTR|FSS|APP|DEP|TWR)$/, '')))].slice(0, 2).join(' / ');
            L.marker([g.v.center.lat, g.v.center.lon], {
              pane: 'labels', interactive: true,
              // Le aree TRACON contengono l'aeroporto: etichetta più in basso per non coprire le sue lettere
              icon: L.divIcon({ className: `sector-label k-${g.kind}`, html: `<span style="--c:${color}">${esc(label)}</span>`, iconSize: null }),
            }).bindPopup(() => atcPopup(g.list, g.v.name), { className: 'radar-popup', maxWidth: 320 }).addTo(sectorLayer);
          }
        }
      }

      if (o.airports) {
        // Aeroporti con ATC: lettere D G T A colorate (come i radar di VATSIM)
        for (const a of airports.values()) {
          const letters = ['delivery', 'ground', 'tower', 'atis'].filter((p) => a.positions.has(p))
            .map((p) => `<i class="pos-${p}">${POS_LETTER[p]}</i>`).join('');
          if (!letters) continue;
          L.marker([a.center.lat, a.center.lon], {
            pane: 'labels',
            icon: L.divIcon({ className: 'apt-badge', html: `<span class="apt-code">${esc(a.icao)}</span><span class="apt-pos">${letters}</span>`, iconSize: null, iconAnchor: [0, 10] }),
          }).bindPopup(() => withWx(atcPopup(a.list, `${a.icao} · ${a.name}`), a.icao), { className: 'radar-popup', maxWidth: 320 }).on('popupopen', () => App.emit('airport-open', a.icao)).addTo(airportLayer);
        }
      }
    }

    // ================================================================== traffico (canvas)
    const Traffic = L.Layer.extend({
      onAdd(m) {
        this._canvas = L.DomUtil.create('canvas', 'traffic-canvas');
        m.getPane('traffic').appendChild(this._canvas);
        m.on('moveend zoomend resize viewreset', this._reset, this);
        m.on('zoomstart', this._hide, this);
        this._reset();
      },
      onRemove(m) {
        L.DomUtil.remove(this._canvas);
        m.off('moveend zoomend resize viewreset', this._reset, this);
        m.off('zoomstart', this._hide, this);
      },
      _hide() { this._canvas.style.visibility = 'hidden'; },
      _reset() {
        const size = this._map.getSize();
        const ratio = root.devicePixelRatio || 1;
        this._canvas.width = size.x * ratio;
        this._canvas.height = size.y * ratio;
        this._canvas.style.width = `${size.x}px`;
        this._canvas.style.height = `${size.y}px`;
        L.DomUtil.setPosition(this._canvas, this._map.containerPointToLayerPoint([0, 0]));
        this._canvas.style.visibility = '';
        this.redraw();
      },
      redraw() {
        if (!this._map) return;
        const m = this._map;
        const ctx = this._canvas.getContext('2d');
        const ratio = root.devicePixelRatio || 1;
        ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
        const size = m.getSize();
        ctx.clearRect(0, 0, size.x, size.y);
        this._pts = [];
        const list = visiblePilots();
        const zoom = m.getZoom();
        const centerLng = m.getCenter().lng;
        const colors = { vatsim: css('--traffic-vatsim'), ivao: css('--traffic-ivao') };
        const halo = css('--traffic-halo');
        const scale = zoom < 4 ? 0.62 : zoom < 6 ? 0.8 : 1;
        const labels = opts().labels && zoom >= 6;
        ctx.font = '600 10.5px Inter, system-ui, sans-serif';
        let labelCount = 0;
        for (const p of list) {
          // Copia del mondo più vicina al centro della mappa
          let lon = p.lon;
          while (lon - centerLng > 180) lon -= 360;
          while (lon - centerLng < -180) lon += 360;
          const pt = m.latLngToContainerPoint([p.lat, lon]);
          if (pt.x < -20 || pt.y < -20 || pt.x > size.x + 20 || pt.y > size.y + 20) continue;
          const ground = root.Networks.onGround(p);
          const selected = selectedKey === p.key;
          ctx.save();
          ctx.translate(pt.x, pt.y);
          ctx.rotate((p.hdg * Math.PI) / 180);
          ctx.scale(scale * (selected ? 1.35 : 1), scale * (selected ? 1.35 : 1));
          ctx.globalAlpha = ground ? 0.55 : 1;
          ctx.lineWidth = 2.4;
          ctx.strokeStyle = halo;
          if (PLANE) { ctx.stroke(PLANE); ctx.fillStyle = selected ? css('--accent') : colors[p.net]; ctx.fill(PLANE); }
          ctx.restore();
          this._pts.push({ x: pt.x, y: pt.y, p });
          if ((labels || selected) && labelCount < 400 && (!ground || zoom >= 9)) {
            labelCount++;
            const txt = `${p.callsign}${!ground && zoom >= 7 ? `  ${fmtLevel(p.alt)}` : ''}`;
            ctx.lineWidth = 3;
            ctx.strokeStyle = halo;
            ctx.strokeText(txt, pt.x + 9, pt.y + 4);
            ctx.fillStyle = css('--traffic-label');
            ctx.fillText(txt, pt.x + 9, pt.y + 4);
          }
        }
      },
      // Aereo più vicino a un punto dello schermo (entro 12 px)
      hit(x, y) {
        let best = null;
        let bd = 144;
        for (const q of this._pts || []) {
          const d = (q.x - x) ** 2 + (q.y - y) ** 2;
          if (d < bd) { bd = d; best = q.p; }
        }
        return best;
      },
    });
    const traffic = new Traffic().addTo(map);

    const fmtLevel = (ft) => (ft >= 10500 ? `FL${Math.round(ft / 100)}` : `${Math.round(ft / 100) * 100} ft`);

    function visiblePilots() {
      const o = opts();
      if (!o.pilots) return [];
      const own = App.callsignInfo();
      const f = App.flight;
      const list = root.Networks.filterPilots(allPilots(), { vatsim: o.vatsim, ivao: o.ivao, phase: o.phase, mine: o.mine && f ? { dep: f.dep, arr: f.arr } : null });
      // Il tuo aereo lo disegna già tracking.js
      return own ? list.filter((p) => p.callsign !== own.code) : list;
    }

    // Selezione, popup e "segui"
    let selectedKey = null;
    let follow = false;
    let popup = null;

    function pilotPopup(p) {
      const ap = (icao) => { const a = root.World.airport(icao); return a ? (a.city || a.name) : ''; };
      const route = p.dep || p.arr ? `<div class="pop-route"><div><b>${esc(p.dep || '—')}</b><span>${esc(ap(p.dep))}</span></div><i>${root.Icons.svg('plane')}</i><div class="r"><b>${esc(p.arr || '—')}</b><span>${esc(ap(p.arr))}</span></div></div>` : '';
      const ground = root.Networks.onGround(p);
      return `<div class="radar-pop">
        <div class="pop-title">${esc(p.callsign)} <span class="net-tag ${esc(p.net)}">${p.net === 'ivao' ? 'IVAO' : 'VATSIM'}</span></div>
        ${p.name ? `<div class="pop-sub">${esc(p.name)}</div>` : ''}
        ${route}
        <div class="pop-grid">
          <div><span>${esc(t('radar.aircraft'))}</span><b>${esc(p.aircraft || '—')}</b></div>
          <div><span>${esc(t('hud.level'))}</span><b>${ground ? esc(t('radar.onGround')) : esc(fmtLevel(p.alt))}</b></div>
          <div><span>GS</span><b>${Math.round(p.gs)} kt</b></div>
          <div><span>HDG</span><b>${String(Math.round(p.hdg)).padStart(3, '0')}°</b></div>
          <div><span>SQK</span><b>${esc(p.squawk || '—')}</b></div>
          <div><span>${esc(t('radar.cruise'))}</span><b>${p.cruise ? esc(fmtLevel(p.cruise)) : '—'}</b></div>
        </div>
        <button class="pill-btn accent pop-follow" data-follow="${esc(p.key)}">${root.Icons.svg('crosshair')} ${esc(t('radar.follow'))}</button>
      </div>`;
    }

    function select(p, open) {
      selectedKey = p ? p.key : null;
      traffic.redraw();
      if (!p) { if (popup) map.closePopup(popup); return; }
      if (open) {
        popup = L.popup({ className: 'radar-popup', maxWidth: 300, autoPan: true, offset: [0, -6] }).setLatLng([p.lat, p.lon]).setContent(pilotPopup(p)).openOn(map);
      }
    }

    // Il clic su un aereo vince sui settori sottostanti: lo si intercetta prima che arrivi ai livelli di Leaflet
    map.getContainer().addEventListener('click', (e) => {
      if (e.target.closest('.leaflet-popup, .leaflet-marker-icon, .leaflet-control')) return;
      const r = map.getContainer().getBoundingClientRect();
      const p = traffic.hit(e.clientX - r.left, e.clientY - r.top);
      if (!p) return;
      e.stopPropagation();
      follow = false;
      select(p, true);
    }, true);
    map.on('popupclose', (e) => { if (e.popup === popup) { selectedKey = null; follow = false; traffic.redraw(); } });
    map.on('dragstart', () => { follow = false; });
    map.getContainer().addEventListener('mousemove', (e) => {
      const r = map.getContainer().getBoundingClientRect();
      map.getContainer().classList.toggle('over-plane', !!traffic.hit(e.clientX - r.left, e.clientY - r.top));
    });
    map.getContainer().addEventListener('click', (e) => {
      const b = e.target.closest('[data-follow]');
      if (!b) return;
      follow = true;
      const p = allPilots().find((x) => x.key === b.dataset.follow);
      if (p) map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 8), { duration: 0.8 });
    });

    function updateSelected() {
      if (!selectedKey) return;
      const p = allPilots().find((x) => x.key === selectedKey);
      if (!p) return;
      if (popup && map.hasLayer(popup)) { popup.setLatLng([p.lat, p.lon]); popup.setContent(pilotPopup(p)); }
      if (follow) map.panTo([p.lat, p.lon], { animate: true });
    }

    // ================================================================== pannello filtri
    const panel = $('radarPanel');
    function syncPanel() {
      const o = opts();
      panel.querySelectorAll('[data-radar]').forEach((el) => { el.checked = !!o[el.dataset.radar]; });
      panel.querySelectorAll('.net-chip').forEach((b) => b.classList.toggle('on', !!o[b.dataset.net]));
      for (const [id, k] of [['radarPhase', 'phase'], ['radarBase', 'base']]) {
        const sel = $(id);
        if (sel.value !== o[k]) { sel.value = o[k]; sel.dispatchEvent(new Event('sync')); }
      }
      $('radarDot').hidden = !(o.pilots || o.sectors);
    }
    function renderStatus() {
      const fmt = (n) => n.toLocaleString(root.I18n.locale());
      for (const [net, id] of [['vatsim', 'cntVatsim'], ['ivao', 'cntIvao']]) {
        const d = nets[net];
        $(id).textContent = netError[net] && !d ? '!' : d ? fmt(d.pilots.length) : '—';
        $(id).title = netError[net] || (d ? t('radar.counts', { pilots: fmt(d.pilots.length), atc: fmt(d.atc.length) }) : '');
      }
      const shown = visiblePilots().length;
      const atc = allAtc().filter((c) => !c.isAtis).length;
      $('radarStatus').textContent = t('radar.status', { pilots: fmt(shown), atc: fmt(atc) });
    }

    $('mapLayers').addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) syncPanel(); });
    $('radarClose').addEventListener('click', () => { panel.hidden = true; });
    panel.querySelectorAll('[data-radar]').forEach((el) => el.addEventListener('change', () => setOpt(el.dataset.radar, el.checked)));
    panel.querySelectorAll('.net-chip').forEach((b) => b.addEventListener('click', () => setOpt(b.dataset.net, !opts()[b.dataset.net])));
    $('radarPhase').addEventListener('change', () => setOpt('phase', $('radarPhase').value));
    $('radarBase').addEventListener('change', () => setOpt('base', $('radarBase').value));

    // Ricerca: nominativo (vola all'aereo) o aeroporto (lo inquadra)
    $('radarSearch').addEventListener('input', () => {
      const q = $('radarSearch').value.trim();
      const ol = $('radarResults');
      ol.innerHTML = '';
      if (!q) return;
      const ap = /^[A-Za-z0-9]{4}$/.test(q) ? root.World.airport(q) : null;
      if (ap) {
        const li = document.createElement('li');
        li.innerHTML = `${root.Icons.svg('map')}<b>${esc(ap.icao)}</b><span>${esc(ap.name)}</span>`;
        li.addEventListener('click', () => { map.flyTo([ap.lat, ap.lon], 10, { duration: 0.8 }); map.once('moveend', () => airportPopup(ap)); });
        ol.append(li);
      }
      for (const p of root.Networks.search(allPilots(), q, 6)) {
        const li = document.createElement('li');
        li.innerHTML = `<i class="net-dot ${esc(p.net)}"></i><b>${esc(p.callsign)}</b><span>${esc([p.dep, p.arr].filter(Boolean).join(' → ') || p.aircraft)}</span>`;
        li.addEventListener('click', () => { follow = true; map.flyTo([p.lat, p.lon], Math.max(map.getZoom(), 8), { duration: 0.8 }); setTimeout(() => select(p, true), 850); });
        ol.append(li);
      }
      if (!ol.children.length) { const li = document.createElement('li'); li.className = 'empty'; li.textContent = t('radar.noResults'); ol.append(li); }
    });

    // ================================================================== aggiornamenti
    function refresh() {
      renderAtc();
      traffic.redraw();
      updateSelected();
      renderStatus();
    }

    App.on('setting:radar', (v) => {
      const prev = refresh.prev || {};
      const o = opts();
      syncPanel();
      if (prev.base !== o.base) setBase();
      if (prev.firLines !== o.firLines) drawFirLines();
      if (prev.vatsim !== o.vatsim || prev.ivao !== o.ivao || prev.pilots !== o.pilots || prev.sectors !== o.sectors || prev.airports !== o.airports) schedule();
      sectorKey = '';
      refresh.prev = o;
      refresh();
    });
    refresh.prev = opts();
    App.on('setting:mapKey', () => { if (opts().base === 'detailed') { if (tiles) tiles.remove(); tiles = null; setBase(); } });
    App.on('flight', () => { if (opts().mine) traffic.redraw(); });
    App.on('theme', () => {
      if (vector) vector.setStyle(styleVector());
      if (opts().base === 'detailed') { if (tiles) tiles.remove(); tiles = null; addTiles(); }
      drawFirLines();
      sectorKey = '';
      refresh();
    });
    App.radar = { refresh, nets, opts, select, visiblePilots };

    setBase();
    syncPanel();
    loadSectors().catch(() => { App.toast(t('radar.sectorsFailed'), 5000); });
    schedule();
  });
})(this);
