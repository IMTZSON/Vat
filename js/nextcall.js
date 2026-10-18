/* "Prossima chiamata": in base alla fase del volo e alle istruzioni ATC ricevute (autorizzazione,
   push, rullaggio, passaggi di frequenza…) prepara la prossima frase da dire, con la stazione giusta.
   Modulo puro: observe() aggiorna lo stato con un readback, suggest() propone la chiamata. */
(function (root) {
  'use strict';

  const R = (typeof require === 'function' && typeof module !== 'undefined') ? require('./readback.js') : root.Readback;

  function emptyState() {
    return { cleared: false, push: false, taxi: false, lineup: false, takeoff: false, approach: false, landing: false, vacate: false, descent: false, level: null, handoff: null, done: {}, seq: 0 };
  }

  // Tipo di stazione dal nome ("Roma Radar" -> radar, "Ground" -> ground)
  function stationKind(name) {
    const n = String(name || '').toLowerCase();
    if (/delivery|clearance/.test(n)) return 'delivery';
    if (/ground|apron|ramp/.test(n)) return 'ground';
    if (/tower/.test(n)) return 'tower';
    if (/director|approach|arrival/.test(n)) return 'approach';
    if (/departure/.test(n)) return 'departure';
    if (/radar|control|centre|center|information/.test(n)) return 'radar';
    return 'radar';
  }

  /* Aggiorna lo stato con un readback (risultato di Readback.generateReadback) indirizzato a noi.
     Ogni nuova chiamata per noi chiude il passaggio di frequenza precedente (il contatto è avvenuto). */
  function observe(state, result) {
    const s = { ...emptyState(), ...state, done: { ...((state && state.done) || {}) } };
    if (!result || result.forUs !== true) return s;
    const parts = result.parts || [];
    let handoff = null;
    for (const p of parts) {
      const d = String(p.display || '');
      if (p.type === 'clearance') s.cleared = true;
      if (p.type === 'ground' && /push|start/i.test(d)) s.push = true;
      if (p.type === 'taxi') { s.taxi = true; if (/stand|gate|parking|apron/i.test(d)) s.taxiIn = true; }
      if (p.type === 'runway' && /line up/i.test(d)) s.lineup = true;
      if (p.type === 'runway' && /cleared for take-?off/i.test(d)) s.takeoff = true;
      if (p.type === 'runway' && /cleared to land/i.test(d)) s.landing = true;
      if (p.type === 'runway' && /vacate/i.test(d)) s.vacate = true;
      if (p.type === 'approach' && /cleared/i.test(d)) s.approach = true;
      if (p.type === 'level') { s.level = d; if (/descend/i.test(d)) s.descent = true; }
      if (p.type === 'frequency') {
        const m = d.match(/^(.*?)\s*(1[1-3]\d\.\d{1,3})$/);
        if (m) handoff = { station: m[1].trim(), freq: m[2], kind: stationKind(m[1]) };
      }
    }
    s.handoff = handoff;
    s.seq = (s.seq || 0) + 1;
    return s;
  }

  // Livello autorizzato in parole: "initial climb 6000 ft" -> ["6000 feet", "six thousand feet"]
  function clearedLevel(display) {
    const d = String(display || '');
    let m = d.match(/FL\s?(\d{2,3})/i);
    if (m) return [`flight level ${Number(m[1])}`, R.spokenFL(Number(m[1]))];
    m = d.match(/(\d{3,5})\s*ft/i);
    if (m) return [`${Number(m[1])} feet`, `${R.spokenAltitude(Number(m[1]))} feet`];
    return null;
  }
  function altWords(ft) {
    if (!ft && ft !== 0) return null;
    if (ft >= 10500) { const fl = Math.round(ft / 1000) * 10; return [`flight level ${fl}`, R.spokenFL(fl)]; }
    const a = Math.round(ft / 100) * 100;
    return [`${a} feet`, `${R.spokenAltitude(a)} feet`];
  }

  /* ctx: { phase, cs: {display, spoken}, flight: {dep, arr, depRwy, arrRwy, aircraft, cruise}, depCity, arrCity, acc,
            stand, atisDep, atisArr, alt, toTod, depStation }
     -> { key, station, freq, text, spoken } oppure null */
  function suggest(state, ctx) {
    const s = { ...emptyState(), ...(state || {}) };
    const c = ctx || {};
    const f = c.flight || {};
    const cs = c.cs || { display: '[callsign]', spoken: '[callsign]' };
    const phase = c.phase || 'parked';
    const onGroundBefore = ['parked', 'taxi-out'].includes(phase);
    const onGroundAfter = ['landed', 'taxi-in', 'arrived'].includes(phase);
    const city = onGroundAfter || ['descent', 'approach'].includes(phase) ? (c.arrCity || f.arr || '') : (c.depCity || f.dep || '');
    const rwyDep = f.depRwy ? [`runway ${f.depRwy}`, `runway ${R.spokenRunway(f.depRwy)}`] : ['runway [rwy]', 'runway'];
    const rwyArr = f.arrRwy ? [`runway ${f.arrRwy}`, `runway ${R.spokenRunway(f.arrRwy)}`] : ['runway [rwy]', 'runway'];
    const atis = (x) => (x && R.LETTER_WORD[x] ? [`information ${R.LETTER_WORD[x]}`, `information ${R.LETTER_WORD[x]}`] : null);
    // Nome completo della stazione: "Ground" -> "Roma Ground"; "Roma Radar" resta com'è
    const fullName = (name) => (/\s/.test(name) || !city ? name : `${city} ${name}`);
    const make = (key, station, freq, ...segs) => {
      const parts = segs.filter(Boolean);
      const txt = parts.map((p) => (Array.isArray(p) ? p[0] : p)).join(' ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();
      const spk = parts.map((p) => (Array.isArray(p) ? p[1] : p)).join(' ').replace(/\s+,/g, ',').replace(/\s+/g, ' ').replace(/\[[^\]]*\]/g, '').trim();
      return s.done[`${key}#${s.seq}`] ? null : { key, station, freq: freq || null, text: txt, spoken: spk, id: `${key}#${s.seq}` };
    };
    const call = (station) => (station ? [`${station},`, `${station},`] : null);
    const csP = [cs.display, cs.spoken];

    // 1) Passaggio di frequenza: primo contatto con la nuova stazione
    const h = s.handoff;
    if (h) {
      const st = fullName(h.station);
      if (h.kind === 'ground' && onGroundAfter) return make('next.vacated', st, h.freq, call(st), csP, ',', rwyArr, 'vacated, request taxi to stand');
      if (h.kind === 'ground' && !s.push) return make('next.push', st, h.freq, call(st), csP, c.stand ? `, stand ${c.stand}` : '', ', request pushback and startup');
      if (h.kind === 'ground' && !s.taxi) return make('next.taxi', st, h.freq, call(st), csP, ', request taxi');
      if (h.kind === 'ground') return make('next.contact', st, h.freq, call(st), csP);
      if (h.kind === 'tower' && onGroundBefore) return make('next.ready', st, h.freq, call(st), csP, ', holding point', rwyDep, ', ready for departure');
      if (h.kind === 'tower') return make('next.established', st, h.freq, call(st), csP, ', established', s.approach ? 'ILS' : 'final', rwyArr);
      const lvl = clearedLevel(s.level);
      const now = altWords(c.alt);
      if (phase === 'climb' || phase === 'takeoff') return make('next.firstClimb', st, h.freq, call(st), csP, now ? [`, passing ${now[0]}`, `, passing ${now[1]}`] : '', lvl ? [`, climbing ${lvl[0]}`, `, climbing ${lvl[1]}`] : '');
      if (phase === 'descent' || phase === 'approach') return make('next.firstDescent', st, h.freq, call(st), csP, lvl ? [`, descending ${lvl[0]}`, `, descending ${lvl[1]}`] : (now ? [`, ${now[0]}`, `, ${now[1]}`] : ''), h.kind === 'approach' ? atis(c.atisArr) && [`, ${atis(c.atisArr)[0]}`, `, ${atis(c.atisArr)[1]}`] : '');
      return make(phase === 'cruise' ? 'next.firstCruise' : 'next.contact', st, h.freq, call(st), csP, now ? [`, ${now[0]}`, `, ${now[1]}`] : '');
    }

    // 2) Senza passaggi di frequenza: secondo la fase
    if (onGroundBefore) {
      if (!s.cleared) {
        const st = fullName(c.depStation || 'Delivery');
        const info = atis(c.atisDep);
        return make('next.clearance', st, null, call(st), csP, f.aircraft ? `, ${f.aircraft}` : '', c.stand ? `, stand ${c.stand}` : '', info ? [`, ${info[0]}`, `, ${info[1]}`] : '', `, request IFR clearance to ${c.arrCity || f.arr || '[destination]'}`);
      }
      if (!s.push && phase === 'parked') return make('next.push', fullName('Ground'), null, call(fullName('Ground')), csP, c.stand ? `, stand ${c.stand}` : '', ', request pushback and startup');
      if (!s.taxi) return make('next.taxi', fullName('Ground'), null, call(fullName('Ground')), csP, ', request taxi');
      if (!s.takeoff && !s.lineup) return make('next.ready', fullName('Tower'), null, call(fullName('Tower')), csP, ', holding point', rwyDep, ', ready for departure');
      return null;
    }
    if (phase === 'cruise' && !s.descent && c.toTod !== null && c.toTod !== undefined && c.toTod < 25) return make('next.descent', null, null, csP, ', request descent');
    if (phase === 'approach' && s.approach && !s.landing) return make('next.established', fullName('Tower'), null, call(fullName('Tower')), csP, ', established ILS', rwyArr);
    if (onGroundAfter && !s.taxiIn && phase !== 'arrived') return make('next.vacated', fullName('Ground'), null, call(fullName('Ground')), csP, ',', rwyArr, 'vacated, request taxi to stand');
    return null;
  }

  // "Fatto": salta la chiamata proposta finché non arriva una nuova istruzione
  function markDone(state, id) {
    const s = { ...emptyState(), ...(state || {}) };
    return { ...s, done: { ...s.done, [id]: true } };
  }

  const api = { emptyState, observe, suggest, markDone, stationKind, clearedLevel };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.NextCall = api;
})(this);
