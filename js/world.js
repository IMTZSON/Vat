/* Dati mondiali (data/world.json, costruito da scripts/build-data.js): aeroporti con piste,
   nominativi radio delle compagnie e nomi dei centri di controllo VATSIM.
   Nel browser si carica con World.load(); in Node è subito disponibile.
   Gli aeroporti italiani curati a mano (Scenarios.AIRPORTS) hanno la precedenza per nomi e città. */
(function (root) {
  'use strict';

  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  let data = null;
  if (isNode) {
    try { data = require('../data/world.json'); } catch (e) { data = null; }
  }

  const SUFFIX = { DEL: 'Delivery', GND: 'Ground', TWR: 'Tower', APP: 'Approach', DEP: 'Departure', CTR: 'Control', FSS: 'Information', ATIS: 'Information', RMP: 'Apron' };

  const World = {
    get loaded() { return !!data; },
    curated: null,

    async load(url) {
      if (data) return data;
      try {
        const r = await fetch(url || 'data/world.json');
        if (r.ok) data = await r.json();
      } catch (e) { /* senza dati mondiali si usano solo quelli curati */ }
      return data;
    },

    _curated() {
      if (this.curated) return this.curated;
      if (isNode) { try { return require('./scenarios.js').AIRPORTS; } catch (e) { return {}; } }
      return (root.Scenarios && root.Scenarios.AIRPORTS) || {};
    },

    // { icao, name, city, lat, lon, rwys: [...], country, acc? } oppure null
    airport(icao) {
      const code = String(icao || '').toUpperCase();
      if (!/^[A-Z0-9]{3,4}$/.test(code)) return null;
      const cur = this._curated()[code];
      const w = data && data.airports[code];
      if (!cur && !w) return null;
      const base = w ? { icao: code, name: w[0], city: w[1], lat: w[2], lon: w[3], rwys: w[4] ? w[4].split(' ') : [], country: w[5], fir: w[6] || '' } : { icao: code, rwys: [] };
      // Centro di controllo dell'area ("Roma" per "Roma Radar"), per le chiamate e l'allenamento
      if (!base.acc && base.fir && data && data.firs[base.fir]) base.acc = data.firs[base.fir].replace(/\s+(radar|control|centre|center|centro|information)$/i, '');
      if (cur) Object.assign(base, { name: cur.name, city: cur.city, acc: cur.acc, rwys: cur.rwys.length ? [...new Set([...cur.rwys, ...base.rwys])] : base.rwys, lat: base.lat || cur.lat, lon: base.lon || cur.lon });
      return base;
    },

    // Nominativo radio di una compagnia dal codice ICAO a 3 lettere
    airline(code) {
      return (data && data.airlines[String(code || '').toUpperCase()]) || null;
    },

    // Nome radio di una stazione VATSIM: LIRF_TWR -> "Roma Tower", LIRR_CTR -> "Roma Radar", LON_S_CTR -> "London Control"
    stationName(callsign) {
      const parts = String(callsign || '').toUpperCase().split('_');
      const type = parts[parts.length - 1];
      const head = parts.slice(0, -1);
      if (type === 'CTR' || type === 'FSS') {
        for (let n = head.length; n > 0; n--) {
          const key = head.slice(0, n).join('_');
          const fir = data && data.firs[key];
          if (fir) return fir;
        }
      }
      let ap = this.airport(head[0]);
      if (!ap && /^[A-Z]{3}$/.test(head[0] || '')) ap = this.airport(`K${head[0]}`); // USA: JFK_TWR
      const place = ap ? ap.city || ap.name : head[0] || '';
      return `${place} ${SUFFIX[type] || ''}`.trim();
    },

    // FIR a cui appartiene una stazione VATSIM: LON_S_CTR -> EGTT, EGLL_N_APP -> EGTT, NY_CTR -> KZNY
    firOfStation(callsign) {
      const head = String(callsign || '').toUpperCase().split('_').slice(0, -1);
      if (!head.length || !data) return null;
      for (let n = head.length; n > 0; n--) {
        const id = data.firIds && data.firIds[head.slice(0, n).join('_')];
        if (id) return id;
      }
      const ap = this.airport(head[0]) || (/^[A-Z]{3}$/.test(head[0]) ? this.airport(`K${head[0]}`) : null);
      return ap && ap.fir ? ap.fir : null;
    },

    // Distanza approssimativa per cercare gli aeroporti vicini (gradi, sufficiente per ordinare)
    nearest(lat, lon, n) {
      if (!data) return [];
      const k = Math.cos((lat * Math.PI) / 180);
      return Object.entries(data.airports)
        .map(([icao, a]) => ({ icao, d: (a[2] - lat) ** 2 + ((a[3] - lon) * k) ** 2 }))
        .sort((a, b) => a.d - b.d).slice(0, n || 5).map((x) => this.airport(x.icao));
    },

    meta() { return data ? data.meta : null; },
  };

  if (isNode && module.exports) module.exports = World;
  else root.World = World;
})(this);
