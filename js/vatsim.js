/* Dati live VATSIM (feed v3): controllori online, ATIS, piloti. Condiviso da Volo, Tracking e verifiche. */
(function (root) {
  'use strict';

  const FEED_URL = 'https://data.vatsim.net/v3/vatsim-data.json';
  const FACILITY = { 1: 'FSS', 2: 'Delivery', 3: 'Ground', 4: 'Tower', 5: 'Approach / Radar', 6: 'Centre (CTR)' };
  let cache = null;
  const World = () => ((typeof require === 'function' && typeof module !== 'undefined') ? require('./world.js') : root.World);
  let pending = null;

  const Vatsim = {
    FACILITY,
    last: null,

    // Feed con cache (VATSIM lo aggiorna ogni 15 secondi)
    async feed(maxAgeMs) {
      const age = maxAgeMs === undefined ? 30000 : maxAgeMs;
      if (cache && Date.now() - cache.t < age) return cache.data;
      if (!pending) {
        pending = root.Net.json(FEED_URL)
          .then((data) => { cache = { t: Date.now(), data }; this.last = data; return data; })
          .finally(() => { pending = null; });
      }
      return pending;
    },

    matchesAirport(callsign, icao) {
      if (!icao) return false;
      return callsign.startsWith(`${icao}_`) || (icao[0] === 'K' && callsign.startsWith(`${icao.slice(1)}_`));
    },

    atcAt(data, icao) {
      const ctrls = (data.controllers || []).filter((c) => c.facility > 0 && this.matchesAirport(c.callsign, icao));
      const centers = (data.controllers || []).filter((c) => c.facility === 6 && c.callsign.startsWith(icao.slice(0, 2)) && !this.matchesAirport(c.callsign, icao)).slice(0, 6);
      const atis = (data.atis || []).filter((a) => this.matchesAirport(a.callsign, icao));
      return { ctrls, centers, atis };
    },

    // Frequenze plausibili per il volo: controllori di partenza/arrivo e dei centri della stessa zona
    // (stesso prefisso ICAO o stessa FIR secondo VATSpy: LON_S_CTR copre EGLL anche se non inizia con "EG").
    frequenciesFor(data, icaos) {
      const list = [];
      const seen = new Set();
      const prefixes = new Set(icaos.filter(Boolean).map((x) => x.slice(0, 2)));
      const W = World();
      const firs = new Set(W ? icaos.map((x) => (W.airport(x) || {}).fir).filter(Boolean) : []);
      const add = (freq, callsign) => {
        const f = Number(freq);
        if (!f || f === 199.998 || seen.has(`${f}|${callsign}`)) return;
        seen.add(`${f}|${callsign}`);
        list.push({ freq: f, callsign });
      };
      for (const c of data.controllers || []) {
        if (c.facility <= 0) continue;
        const local = icaos.some((x) => this.matchesAirport(c.callsign, x));
        const area = [...prefixes].some((p) => c.callsign.startsWith(p));
        const fir = firs.size && firs.has(W.firOfStation(c.callsign));
        if (local || area || fir) add(c.frequency, c.callsign);
      }
      for (const a of data.atis || []) if (icaos.some((x) => this.matchesAirport(a.callsign, x))) add(a.frequency, a.callsign);
      add('122.800', 'UNICOM');
      return list;
    },

    pilot(data, callsign) {
      const cs = String(callsign || '').toUpperCase();
      return (data.pilots || []).find((p) => p.callsign.toUpperCase() === cs) || null;
    },
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = Vatsim;
  else root.Vatsim = Vatsim;
})(this);
