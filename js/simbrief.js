/* Legge il piano di volo (OFP) di SimBrief in formato JSON. */
(function (root) {
  'use strict';

  function parse(j) {
    if (j.fetch && j.fetch.status && j.fetch.status !== 'Success') throw new Error(`SimBrief: ${j.fetch.status}`);
    const g = j.general || {};
    const o = j.origin || {};
    const d = j.destination || {};
    const ac = j.aircraft || {};
    const atc = j.atc || {};
    const fuel = j.fuel || {};
    const w = j.weights || {};
    const t = j.times || {};
    const fixes = j.navlog && j.navlog.fix ? [].concat(j.navlog.fix) : [];
    const isProc = (x) => String(x.is_sid_star) === '1' && x.via_airway && x.via_airway !== 'DCT';
    const sidFix = fixes.find(isProc);
    const starFix = fixes.slice().reverse().find(isProc);
    const callsign = atc.callsign || `${g.icao_airline || ''}${g.flight_number || ''}`;
    const sid = sidFix && /^[A-Z]{2,5}\d[A-Z]$/.test(sidFix.via_airway) ? sidFix.via_airway : null;
    const star = starFix && starFix !== sidFix && /^[A-Z]{2,5}\d[A-Z]$/.test(starFix.via_airway) ? starFix.via_airway : null;
    const pos = (x) => (x && x.pos_lat !== undefined && !Number.isNaN(Number(x.pos_lat)) ? { lat: Number(x.pos_lat), lon: Number(x.pos_long) } : null);
    const route = fixes.map((x) => ({ ident: x.ident, ...pos(x) })).filter((x) => typeof x.lat === 'number' && !Number.isNaN(x.lat));
    const pax = Number(g.passengers) || Number(w.pax_count) || null;
    return {
      source: 'SimBrief',
      depPos: pos(o), arrPos: pos(d), fixes: route, pax,
      callsign,
      dep: o.icao_code, depName: o.name, depRwy: o.plan_rwy || null,
      arr: d.icao_code, arrName: d.name, arrRwy: d.plan_rwy || null,
      altn: (j.alternate && j.alternate.icao_code) || null,
      route: g.route || atc.route || '',
      cruise: g.initial_altitude ? Math.round(Number(g.initial_altitude) / 100) : null,
      aircraft: ac.icaocode || ac.icao_code || '', aircraftName: ac.name || '', reg: ac.reg || '',
      sid, star,
      fuel: fuel.plan_ramp || null, units: (j.params && j.params.units) || '',
      zfw: w.est_zfw || null, tow: w.est_tow || null,
      ete: t.est_time_enroute ? Number(t.est_time_enroute) : null,
      out: t.sched_out ? Number(t.sched_out) : null,
    };
  }

  const api = { parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SimBrief = api;
})(this);
