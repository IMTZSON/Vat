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
    const num = (v) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? null : Math.round(Number(v)));
    const fuelPlan = {
      ramp: num(fuel.plan_ramp), taxi: num(fuel.taxi), trip: num(fuel.enroute_burn), cont: num(fuel.contingency),
      altn: num(fuel.alternate_burn), reserve: num(fuel.reserve), extra: num(fuel.extra),
      takeoff: num(fuel.plan_takeoff), landing: num(fuel.plan_landing), flow: num(fuel.avg_fuel_flow),
    };
    const weights = {
      zfw: num(w.est_zfw), maxZfw: num(w.max_zfw), tow: num(w.est_tow), maxTow: num(w.max_tow),
      ldw: num(w.est_ldw), maxLdw: num(w.max_ldw), payload: num(w.payload),
    };
    const arrElev = num(d.elevation);
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
      fuelPlan: fuelPlan.ramp ? fuelPlan : null, weights: weights.zfw ? weights : null, arrElev,
      ete: t.est_time_enroute ? Number(t.est_time_enroute) : null,
      out: t.sched_out ? Number(t.sched_out) : null,
    };
  }

  const api = { parse };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SimBrief = api;
})(this);
