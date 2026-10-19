/* Traffico live delle reti VATSIM e IVAO in un formato unico per la mappa radar.
   VATSIM: feed v3 (data.vatsim.net/v3/vatsim-data.json).
   IVAO:   whazzup v2 (api.ivao.aero/v2/tracker/whazzup). Il parser è tollerante: legge i campi noti
           e salta i record incompleti, così una piccola modifica del formato non rompe la mappa.
   Funzioni pure. */
(function (root) {
  'use strict';

  const IVAO_URL = 'https://api.ivao.aero/v2/tracker/whazzup';
  const VATSIM_URL = 'https://data.vatsim.net/v3/vatsim-data.json';

  const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
  const str = (v) => (v === null || v === undefined ? '' : String(v));
  const freqText = (f) => {
    const n = num(f);
    if (!Number.isFinite(n) || n <= 0) return '';
    return (n > 1000 ? n / 1000 : n).toFixed(3);
  };
  const validPos = (lat, lon) => Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180 && !(lat === 0 && lon === 0);

  // Quota del piano di volo: "FL350", "F350", "35000", "A045" → piedi
  function planLevel(v) {
    const s = str(v).toUpperCase().trim();
    let m = s.match(/^F(?:L)?(\d{2,3})$/);
    if (m) return Number(m[1]) * 100;
    m = s.match(/^A(\d{2,3})$/);
    if (m) return Number(m[1]) * 100;
    m = s.match(/^(\d{3,5})$/);
    if (m) return Number(m[1]) < 1000 ? Number(m[1]) * 100 : Number(m[1]);
    return null;
  }

  function vatsim(data) {
    const pilots = [];
    const atc = [];
    for (const p of (data && data.pilots) || []) {
      const lat = num(p.latitude);
      const lon = num(p.longitude);
      if (!p.callsign || !validPos(lat, lon)) continue;
      const fp = p.flight_plan || {};
      pilots.push({
        net: 'vatsim', key: `vatsim:${p.callsign}`, callsign: str(p.callsign).toUpperCase(), name: str(p.name), cid: p.cid,
        lat, lon, alt: num(p.altitude) || 0, gs: num(p.groundspeed) || 0, hdg: num(p.heading) || 0,
        squawk: str(p.transponder), dep: str(fp.departure).toUpperCase(), arr: str(fp.arrival).toUpperCase(),
        aircraft: str(fp.aircraft_short || fp.aircraft).split('/')[0].toUpperCase(), route: str(fp.route), rules: str(fp.flight_rules),
        cruise: planLevel(fp.altitude), logon: p.logon_time || '',
      });
    }
    const addAtc = (c, isAtis) => {
      if (!c || !c.callsign) return;
      const callsign = str(c.callsign).toUpperCase();
      if (/_OBS$/.test(callsign) || num(c.facility) === 0) return;
      atc.push({
        net: 'vatsim', key: `vatsim:${callsign}`, callsign, name: str(c.name), cid: c.cid, freq: freqText(c.frequency),
        atis: Array.isArray(c.text_atis) ? c.text_atis.map(str) : [], atisCode: str(c.atis_code), isAtis: !!isAtis || /_ATIS$/.test(callsign),
        logon: c.logon_time || '', rating: c.rating,
      });
    };
    for (const c of (data && data.controllers) || []) addAtc(c, false);
    for (const c of (data && data.atis) || []) addAtc(c, true);
    return { net: 'vatsim', updated: (data && data.general && data.general.update_timestamp) || '', pilots, atc };
  }

  function ivao(data) {
    const clients = (data && (data.clients || data)) || {};
    const pilots = [];
    const atc = [];
    for (const p of clients.pilots || []) {
      const t = p.lastTrack || p.last_track || {};
      const lat = num(t.latitude !== undefined ? t.latitude : p.latitude);
      const lon = num(t.longitude !== undefined ? t.longitude : p.longitude);
      if (!p.callsign || !validPos(lat, lon)) continue;
      const fp = p.flightPlan || p.flight_plan || {};
      const ac = fp.aircraft || {};
      pilots.push({
        net: 'ivao', key: `ivao:${p.callsign}`, callsign: str(p.callsign).toUpperCase(), name: '', cid: p.userId || p.vid || '',
        lat, lon, alt: num(t.altitude) || 0, gs: num(t.groundSpeed !== undefined ? t.groundSpeed : t.ground_speed) || 0, hdg: num(t.heading) || 0,
        onGround: t.onGround === true, squawk: str(t.transponder), dep: str(fp.departureId || fp.departure).toUpperCase(), arr: str(fp.arrivalId || fp.arrival).toUpperCase(),
        aircraft: str(ac.icaoCode || fp.aircraftId || '').toUpperCase(), route: str(fp.route), rules: str(fp.flightRules),
        cruise: planLevel(fp.level), logon: p.createdAt || '',
      });
    }
    for (const c of clients.atcs || clients.atc || []) {
      if (!c || !c.callsign) continue;
      const callsign = str(c.callsign).toUpperCase();
      const s = c.atcSession || c.atc_session || {};
      const a = c.atis || {};
      atc.push({
        net: 'ivao', key: `ivao:${callsign}`, callsign, name: '', cid: c.userId || '', freq: freqText(s.frequency !== undefined ? s.frequency : c.frequency),
        atis: Array.isArray(a.lines) ? a.lines.map(str) : [], atisCode: str(a.revision || ''), isAtis: /_ATIS$/.test(callsign),
        logon: c.createdAt || '',
      });
    }
    return { net: 'ivao', updated: (data && data.updatedAt) || '', pilots, atc };
  }

  /* Filtri della mappa. f: { vatsim, ivao, phase: 'all'|'ground'|'air'|'high', query, mine: {dep, arr} | null }
     a terra: velocità < 50 kt (o onGround di IVAO) */
  function onGround(p) { return p.onGround === true || p.gs < 50; }

  function filterPilots(list, f) {
    const q = str(f && f.query).toUpperCase().trim();
    const phase = (f && f.phase) || 'all';
    const mine = f && f.mine;
    return list.filter((p) => {
      if (f && f[p.net] === false) return false;
      if (phase === 'ground' && !onGround(p)) return false;
      if (phase === 'air' && onGround(p)) return false;
      if (phase === 'high' && (onGround(p) || p.alt < 24500)) return false;
      if (q && !(p.callsign.includes(q) || p.dep === q || p.arr === q || p.aircraft === q)) return false;
      if (mine && (mine.dep || mine.arr)) {
        const set = new Set([mine.dep, mine.arr].filter(Boolean));
        if (!set.has(p.dep) && !set.has(p.arr)) return false;
      }
      return true;
    });
  }

  // Ricerca: prima i nominativi che iniziano con il testo, poi quelli che lo contengono
  function search(list, query, n) {
    const q = str(query).toUpperCase().trim();
    if (!q) return [];
    const starts = list.filter((p) => p.callsign.startsWith(q));
    const has = list.filter((p) => !p.callsign.startsWith(q) && p.callsign.includes(q));
    return [...starts, ...has].slice(0, n || 6);
  }

  const api = { vatsim, ivao, filterPilots, search, onGround, planLevel, freqText, IVAO_URL, VATSIM_URL };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Networks = api;
})(this);
