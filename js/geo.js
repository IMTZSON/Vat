/* Calcoli geografici e fase del volo (funzioni pure, testate). */
(function (root) {
  'use strict';

  const R_NM = 3440.065;
  const rad = (d) => (d * Math.PI) / 180;

  function distance(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLon = rad(b.lon - a.lon);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
    return 2 * R_NM * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function bearing(a, b) {
    const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
    const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
    return (Math.atan2(y, x) * 180 / Math.PI + 360) % 360;
  }

  // Distanza (NM, approssimazione piana locale) di p dal segmento a-b e frazione t del segmento
  function toSegment(p, a, b) {
    const k = Math.cos(rad((a.lat + b.lat) / 2));
    const ax = a.lon * k; const ay = a.lat;
    const bx = b.lon * k; const by = b.lat;
    const px = p.lon * k; const py = p.lat;
    const dx = bx - ax; const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    const q = { lat: ay + t * dy, lon: (ax + t * dx) / k };
    return { d: distance(p, q), t };
  }

  // Progresso lungo la rotta pianificata: NM totali, percorsi, rimanenti, prossimo punto
  function routeProgress(route, pos) {
    if (!route || route.length < 2 || !pos) return null;
    const legs = [];
    let total = 0;
    for (let i = 0; i < route.length - 1; i++) { const l = distance(route[i], route[i + 1]); legs.push(l); total += l; }
    let best = { d: Infinity, i: 0, t: 0 };
    for (let i = 0; i < legs.length; i++) {
      const s = toSegment(pos, route[i], route[i + 1]);
      if (s.d < best.d - 0.01) best = { d: s.d, i, t: s.t };
    }
    let remaining = distance(pos, route[best.i + 1]);
    for (let i = best.i + 1; i < legs.length; i++) remaining += legs[i];
    remaining = Math.min(remaining, total + best.d);
    const flown = Math.max(0, total - remaining);
    return { total, flown, remaining, pct: total ? Math.min(1, flown / total) : 0, next: route[best.i + 1], offRoute: best.d };
  }

  /* Arco di cerchio massimo da a a b in n segmenti: [[lat, lon], ...]. Le longitudini restano continue
     (es. 179 → 181 invece di 179 → -179), così la linea non attraversa tutta la mappa all'antimeridiano. */
  function greatCircle(a, b, n) {
    const steps = Math.max(1, n || 32);
    const p1 = [rad(a.lat), rad(a.lon)];
    const p2 = [rad(b.lat), rad(b.lon)];
    const d = distance(a, b) / R_NM;
    const out = [];
    let prevLon = null;
    for (let i = 0; i <= steps; i++) {
      const f = i / steps;
      let lat;
      let lon;
      if (d < 1e-9) { lat = a.lat; lon = a.lon; } else {
        const A = Math.sin((1 - f) * d) / Math.sin(d);
        const B = Math.sin(f * d) / Math.sin(d);
        const x = A * Math.cos(p1[0]) * Math.cos(p1[1]) + B * Math.cos(p2[0]) * Math.cos(p2[1]);
        const y = A * Math.cos(p1[0]) * Math.sin(p1[1]) + B * Math.cos(p2[0]) * Math.sin(p2[1]);
        const z = A * Math.sin(p1[0]) + B * Math.sin(p2[0]);
        lat = (Math.atan2(z, Math.sqrt(x * x + y * y)) * 180) / Math.PI;
        lon = (Math.atan2(y, x) * 180) / Math.PI;
      }
      if (prevLon !== null) { while (lon - prevLon > 180) lon -= 360; while (lon - prevLon < -180) lon += 360; }
      prevLon = lon;
      out.push([lat, lon]);
    }
    return out;
  }

  function eta(remainingNm, gsKt, now) {
    if (!gsKt || gsKt < 60 || remainingNm === null || remainingNm === undefined) return null;
    return new Date((now || Date.now()) + (remainingNm / gsKt) * 3600000);
  }

  // Fasi del volo (etichette tradotte in strings.js come fphase.<id>)
  const PHASES = ['parked', 'taxi-out', 'takeoff', 'climb', 'cruise', 'descent', 'approach', 'landed', 'taxi-in', 'arrived'];
  const AIRBORNE = new Set(['takeoff', 'climb', 'cruise', 'descent', 'approach']);
  const BEFORE = new Set([null, undefined, 'parked', 'taxi-out']);

  /* s: { alt (ft), gs (kt), vs (ft/min), remaining (NM | null), cruiseFt (ft | null) }, prev: fase precedente
     -> fase attuale (vedi PHASES) */
  function phase(s, prev) {
    const onGround = s.gs < 50 && Math.abs(s.vs || 0) < 400;
    if (onGround) {
      if (BEFORE.has(prev)) return s.gs < 5 ? 'parked' : 'taxi-out';
      if (AIRBORNE.has(prev)) return 'landed';
      return s.gs < 5 ? 'arrived' : 'taxi-in';
    }
    // Da terra a in volo = decollo; se l'app parte col volo già in corso, si classifica e basta
    if (prev === 'parked' || prev === 'taxi-out') return 'takeoff';
    const vs = s.vs || 0;
    const near = (s.remaining !== null && s.remaining !== undefined && s.remaining < 35) || s.alt < 8000;
    if (prev === 'takeoff' && vs > 300 && s.alt < 3000) return 'takeoff';
    if (vs > 300) return 'climb';
    if (vs < -300) return near ? 'approach' : 'descent';
    if ((prev === 'descent' || prev === 'approach') && near) return 'approach';
    const cruiseFt = s.cruiseFt || 0;
    if ((cruiseFt && s.alt >= cruiseFt * 0.85) || s.alt >= 15000) return 'cruise';
    return AIRBORNE.has(prev) ? prev : 'cruise';
  }

  // Eventi per il logbook quando la fase cambia
  function events(prev, next) {
    const out = [];
    if (prev === next) return out;
    if (prev === null || prev === undefined) return out;
    if (prev === 'parked' && next === 'taxi-out') out.push('offBlock');
    if ((prev === 'parked' || prev === 'taxi-out') && AIRBORNE.has(next)) { if (prev === 'parked') out.push('offBlock'); out.push('takeoff'); }
    if (AIRBORNE.has(prev) && next === 'landed') out.push('landing');
    if (next === 'arrived' && prev !== 'arrived' && prev !== 'parked') out.push('onBlock');
    return out;
  }

  const api = { distance, bearing, greatCircle, routeProgress, eta, phase, events, PHASES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Geo = api;
})(this);
