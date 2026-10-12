/* Allenamento: genera istruzioni ATC realistiche per fase di volo e valuta il readback
   del pilota. Le procedure (SID, STAR, waypoint, frequenze) sono di fantasia. */
(function (root) {
  'use strict';

  const R = (typeof require === 'function' && typeof module !== 'undefined') ? require('./readback.js') : root.Readback;

  const PHASES = [
    { id: 'delivery', label: 'Delivery – autorizzazione' },
    { id: 'ground', label: 'Ground – push e rullaggio' },
    { id: 'tower', label: 'Tower – decollo e atterraggio' },
    { id: 'departure', label: 'Partenza – radar' },
    { id: 'cruise', label: 'Crociera – controllo d\'area' },
    { id: 'approach', label: 'Avvicinamento' },
    { id: 'mixed', label: 'Misto (tutte le fasi)' },
    { id: 'full', label: 'Volo completo (in sequenza)' },
  ];

  const AIRPORTS = {
    LIRF: { city: 'Roma', name: 'Roma Fiumicino', rwys: ['16L', '34R', '16R', '34L', '07', '25'], acc: 'Roma', lat: 41.8003, lon: 12.2389 },
    LIRA: { city: 'Ciampino', name: 'Roma Ciampino', rwys: ['15', '33'], acc: 'Roma', lat: 41.7994, lon: 12.5949 },
    LIMC: { city: 'Malpensa', name: 'Milano Malpensa', rwys: ['35L', '35R', '17L', '17R'], acc: 'Milano', lat: 45.6306, lon: 8.7231 },
    LIML: { city: 'Linate', name: 'Milano Linate', rwys: ['36', '18'], acc: 'Milano', lat: 45.4451, lon: 9.2767 },
    LIME: { city: 'Bergamo', name: 'Bergamo', rwys: ['28', '10'], acc: 'Milano', lat: 45.6689, lon: 9.7042 },
    LIPZ: { city: 'Venezia', name: 'Venezia', rwys: ['04R', '22L', '04L', '22R'], acc: 'Padova', lat: 45.5053, lon: 12.3519 },
    LIPE: { city: 'Bologna', name: 'Bologna', rwys: ['12', '30'], acc: 'Padova', lat: 44.5354, lon: 11.2887 },
    LIRQ: { city: 'Firenze', name: 'Firenze', rwys: ['05', '23'], acc: 'Roma', lat: 43.81, lon: 11.2051 },
    LIRN: { city: 'Napoli', name: 'Napoli', rwys: ['06', '24'], acc: 'Roma', lat: 40.886, lon: 14.2908 },
    LICC: { city: 'Catania', name: 'Catania', rwys: ['08', '26'], acc: 'Roma', lat: 37.4668, lon: 15.0664 },
    LICJ: { city: 'Palermo', name: 'Palermo', rwys: ['07', '25', '02', '20'], acc: 'Roma', lat: 38.176, lon: 13.091 },
    LIBD: { city: 'Bari', name: 'Bari', rwys: ['07', '25'], acc: 'Brindisi', lat: 41.1389, lon: 16.7606 },
    LIEO: { city: 'Olbia', name: 'Olbia', rwys: ['05', '23'], acc: 'Roma', lat: 40.8987, lon: 9.5176 },
    LIMF: { city: 'Torino', name: 'Torino', rwys: ['36', '18'], acc: 'Milano', lat: 45.2008, lon: 7.6496 },
  };

  const FIXES = ['BOLLA', 'TORLI', 'RITEB', 'ELKAP', 'XIBIL', 'NIKMO', 'OSKAT', 'GILIX', 'PEDUK', 'ROTUN', 'VALMA', 'SORIN', 'DIPAL', 'ETNAS', 'MAREK', 'LUPEN'];
  const TAXIWAYS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'K', 'L', 'M', 'N', 'P', 'R', 'S', 'T', 'W', 'Y'];
  const DIRS = ['north', 'south', 'east', 'west'];
  const SID_LETTERS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'M', 'N', 'P', 'Q', 'R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z'];

  // ------------------------------------------------------------- casualità

  function rng(seed) {
    if (seed === undefined) return Math.random;
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
  const between = (r, a, b, step) => a + step * Math.floor(r() * (Math.floor((b - a) / step) + 1));

  // ---------------------------------------------------- pezzi di frase [scritto, pronunciato]

  const sp = R.spellDigits;
  const S = {
    fl: (n) => [`flight level ${n}`, R.spokenFL(n)],
    alt: (n) => [`${n} feet`, `${R.spokenAltitude(n)} feet`],
    hdg: (h) => { const x = String(h).padStart(3, '0'); return [`heading ${x}`, `heading ${sp(x)}`]; },
    rwy: (r) => [`runway ${r}`, `runway ${R.spokenRunway(r)}`],
    qnh: (q) => [`QNH ${q}`, `QNH ${sp(String(q))}`],
    sq: (c) => [`squawk ${c}`, `squawk ${sp(c)}`],
    freq: (f) => [f, sp(f)],
    wind: (d, k) => { const x = String(d).padStart(3, '0'); return [`wind ${x} degrees ${k} knots`, `wind ${sp(x)} degrees ${sp(String(k))} knots`]; },
    twys: (list) => [list.map((l) => R.LETTER_WORD[l]).join(' '), list.map((l) => R.LETTER_WORD[l].toLowerCase()).join(' ')],
    sid: (name) => { const m = name.match(/^([A-Z]+) (\d)([A-Z])$/); return [name, `${m[1].toLowerCase()} ${sp(m[2])} ${R.LETTER_WORD[m[3]].toLowerCase()}`]; },
  };
  const join = (...segs) => [segs.map((s) => (Array.isArray(s) ? s[0] : s)).join(' '), segs.map((s) => (Array.isArray(s) ? s[1] : s)).join(' ')];

  // ------------------------------------------------------------- contesto volo

  function makeContext(opts, r) {
    opts = opts || {};
    const cs = (opts.callsign && typeof opts.callsign === 'object') ? opts.callsign : (R.parseCallsign(opts.callsign || 'AZA123') || R.parseCallsign('AZA123'));
    const W = (typeof require === 'function' && typeof module !== 'undefined') ? require('./world.js') : root.World;
    const airport = (icao, fallbackName) => {
      const known = AIRPORTS[icao];
      if (known) return { icao, ...known };
      // Aeroporto fuori dall'elenco curato: nome, città, piste e centro dal database mondiale
      const w = W && W.airport(icao);
      if (w && w.rwys.length) return { icao, city: w.city || w.name, name: fallbackName || w.name, rwys: w.rwys, acc: w.acc || w.city || 'Control' };
      const name = fallbackName || icao || 'Roma Fiumicino';
      const city = name.split(/[\s/-]+/)[0];
      return { icao, city, name, rwys: ['09', '27'], acc: 'Roma' };
    };
    const icaos = Object.keys(AIRPORTS);
    const dep = airport(opts.dep || pick(r, icaos), opts.depName);
    let arrIcao = opts.arr;
    while (!arrIcao || arrIcao === dep.icao) arrIcao = pick(r, icaos);
    const arr = airport(arrIcao, opts.arrName);
    const depRwy = opts.depRwy || pick(r, dep.rwys);
    const arrRwy = opts.arrRwy || pick(r, arr.rwys);
    const sid = opts.sid ? opts.sid.replace(/^([A-Z]+)(\d)([A-Z])$/, '$1 $2$3') : `${pick(r, FIXES)} ${between(r, 1, 9, 1)}${pick(r, SID_LETTERS)}`;
    return {
      cs, dep, arr, depRwy, arrRwy,
      sid: /^[A-Z]+ \d[A-Z]$/.test(sid) ? sid : `${pick(r, FIXES)} 5A`,
      squawk: squawk(r),
      cruise: opts.cruise || between(r, 240, 390, 10),
    };
  }

  function squawk(r) {
    let c;
    do { c = `${between(r, 1, 6, 1)}${between(r, 0, 7, 1)}${between(r, 0, 7, 1)}${between(r, 0, 7, 1)}`; } while (['1200', '2000', '7000'].includes(c));
    return c;
  }
  const FREQ_RANGE = { ground: [121600, 121975], tower: [118100, 120000], radar: [119000, 136975] };
  function freq(r, kind) {
    const [a, b] = FREQ_RANGE[kind] || FREQ_RANGE.radar;
    const khz = between(r, a, b, 25);
    let s = (khz / 1000).toFixed(3).replace(/0+$/, '');
    if (s.endsWith('.')) s += '0';
    return s;
  }
  const qnh = (r) => between(r, 996, 1031, 1);
  const rwyHeading = (rwy) => Number(rwy.replace(/\D/g, '')) * 10;
  function windFor(r, rwy) {
    let d = rwyHeading(rwy) + between(r, -40, 40, 10);
    d = ((d % 360) + 360) % 360 || 360;
    return S.wind(d, between(r, 3, 18, 1));
  }
  const otherRwy = (ap, rwy) => ap.rwys.find((x) => x !== rwy && x.slice(0, 2) !== rwy.slice(0, 2)) || ap.rwys.find((x) => x !== rwy) || rwy;
  function twys(r, n) {
    const out = [];
    while (out.length < n) { const t = pick(r, TAXIWAYS); if (!out.includes(t)) out.push(t); }
    return out;
  }

  // ------------------------------------------------------------- modelli per fase

  const T = {
    delivery: [
      (c, r) => ({ st: `${c.dep.city} Delivery`, segs: [`cleared to ${c.arr.name} via`, S.sid(c.sid), 'departure, climb initially', S.alt(between(r, 4000, 7000, 1000)), ',', S.sq(c.squawk)] }),
      (c, r) => ({ st: `${c.dep.city} Delivery`, segs: [`cleared to ${c.arr.name} via`, S.sid(c.sid), 'departure,', S.rwy(c.depRwy), ', climb initially', S.alt(between(r, 4000, 7000, 1000)), ',', S.sq(c.squawk)] }),
      (c, r) => ({ st: `${c.dep.city} Delivery`, hard: true, segs: [`cleared to ${c.arr.name} via`, S.sid(c.sid), 'departure, climb initially', S.alt(between(r, 4000, 7000, 1000)), ', expect', S.fl(c.cruise), '10 minutes after departure,', S.sq(c.squawk)] }),
    ],
    ground: [
      (c, r) => ({ st: `${c.dep.city} Ground`, segs: ['push and start approved, facing', pick(r, DIRS)] }),
      (c, r) => ({ st: `${c.dep.city} Ground`, segs: ['taxi to holding point', S.rwy(c.depRwy), 'via', S.twys(twys(r, 2)), ',', S.qnh(qnh(r))] }),
      (c, r) => ({ st: `${c.dep.city} Ground`, hard: true, segs: ['taxi to holding point', S.rwy(c.depRwy), 'via', S.twys(twys(r, 3)), ', hold short of', S.rwy(otherRwy(c.dep, c.depRwy))] }),
      (c, r) => ({ st: `${c.arr.city} Ground`, segs: [`taxi to stand ${between(r, 101, 230, 1)} via`, S.twys(twys(r, 2))] }),
      () => ({ st: 'Ground', segs: ['hold position'] }),
    ],
    tower: [
      (c) => ({ st: `${c.dep.city} Tower`, segs: [S.rwy(c.depRwy), ', line up and wait'] }),
      (c, r) => ({ st: `${c.dep.city} Tower`, segs: [windFor(r, c.depRwy), ',', S.rwy(c.depRwy), ', cleared for takeoff'] }),
      (c, r) => ({ st: `${c.arr.city} Tower`, segs: [windFor(r, c.arrRwy), ',', S.rwy(c.arrRwy), ', cleared to land'] }),
      (c, r) => ({ st: `${c.arr.city} Tower`, segs: ['contact', `${c.arr.city} Ground`, S.freq(freq(r, 'ground'))] }),
      (c, r) => ({ st: `${c.dep.city} Tower`, hard: true, segs: ['after departure turn right', S.hdg(between(r, 10, 360, 10)), ',', S.rwy(c.depRwy), ', cleared for takeoff'] }),
    ],
    departure: [
      (c, r) => ({ st: `${c.dep.city} Radar`, segs: ['radar contact, climb', S.fl(between(r, 80, 200, 10))] }),
      (c, r) => ({ st: `${c.dep.city} Radar`, segs: ['turn left', S.hdg(between(r, 10, 360, 10)), ', climb', S.alt(between(r, 5000, 9000, 1000))] }),
      (c, r) => ({ st: `${c.dep.city} Radar`, segs: [`proceed direct ${pick(r, FIXES)}, climb`, S.fl(between(r, 100, 240, 10))] }),
      (c, r) => ({ st: `${c.dep.city} Radar`, segs: ['contact', `${c.dep.acc} Control`, S.freq(freq(r))] }),
    ],
    cruise: [
      (c, r) => ({ st: `${c.dep.acc} Control`, segs: ['climb', S.fl(c.cruise)] }),
      (c, r) => ({ st: `${c.arr.acc} Control`, segs: ['descend', S.fl(between(r, 90, 240, 10))] }),
      (c, r) => ({ st: `${c.dep.acc} Control`, segs: [S.sq(squawk(r))] }),
      (c, r) => ({ st: `${c.dep.acc} Control`, segs: [`proceed direct ${pick(r, FIXES)}`] }),
      (c, r) => ({ st: `${c.arr.acc} Control`, hard: true, segs: ['descend', S.fl(between(r, 90, 200, 10)), ', reduce speed', `${between(r, 250, 280, 10)} knots`] }),
      (c, r) => ({ st: `${c.arr.acc} Control`, segs: ['contact', `${c.arr.city} Approach`, S.freq(freq(r))] }),
    ],
    approach: [
      (c, r) => ({ st: `${c.arr.city} Approach`, segs: ['descend to altitude', S.alt(between(r, 3000, 6000, 500)), ',', S.qnh(qnh(r))] }),
      (c, r) => ({ st: `${c.arr.city} Approach`, segs: ['turn right', S.hdg(between(r, 10, 360, 10)), ', descend', S.alt(between(r, 2000, 5000, 1000))] }),
      (c, r) => ({ st: `${c.arr.city} Approach`, segs: ['turn left', S.hdg(between(r, 10, 360, 10)), ', cleared ILS approach', S.rwy(c.arrRwy), ', report established'] }),
      (c, r) => ({ st: `${c.arr.city} Approach`, segs: ['reduce speed', `${between(r, 160, 220, 10)} knots`, ', contact', `${c.arr.city} Tower`, S.freq(freq(r, 'tower'))] }),
      (c, r) => ({ st: `${c.arr.city} Approach`, hard: true, segs: ['descend to altitude', S.alt(between(r, 3000, 5000, 1000)), ',', S.qnh(qnh(r)), ', turn left', S.hdg(between(r, 10, 360, 10)), ', reduce speed', `${between(r, 180, 220, 10)} knots`] }),
    ],
  };

  // Sequenza del volo completo: [fase, indice modello]
  const FULL = [
    ['delivery', 0], ['ground', 0], ['ground', 1], ['tower', 0], ['tower', 1], ['departure', 0], ['departure', 2],
    ['departure', 3], ['cruise', 0], ['cruise', 1], ['cruise', 5], ['approach', 0], ['approach', 1], ['approach', 2],
    ['approach', 3], ['tower', 2], ['tower', 3], ['ground', 3],
  ];

  function build(phase, tpl, ctx, r) {
    const t = tpl(ctx, r);
    const [text, spoken] = join(...t.segs);
    const clean = (s) => s.replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();
    const atc = clean(`${ctx.cs.display}, ${text}`);
    const atcSpoken = clean(`${ctx.cs.spoken}, ${spoken}`);
    const expected = R.generateReadback(atc, { callsign: ctx.cs });
    return { phase, station: t.st, atc, atcSpoken, expected };
  }

  // phase: id di PHASES (tranne 'full'); difficulty: 'easy' | 'normal' | 'hard'
  function generate(phase, opts) {
    opts = opts || {};
    const r = rng(opts.seed);
    const ctx = opts.ctx || makeContext(opts, r);
    let ph = phase;
    if (ph === 'mixed' || !T[ph]) ph = pick(r, Object.keys(T));
    let list = T[ph];
    if (opts.difficulty === 'easy') list = list.filter((t) => !t({ ...ctx }, rng(1)).hard);
    if (opts.difficulty === 'hard' && r() < 0.6) {
      const hardOnes = list.filter((t) => t({ ...ctx }, rng(1)).hard);
      if (hardOnes.length) list = hardOnes;
    }
    return build(ph, pick(r, list), ctx, r);
  }

  function fullFlight(opts) {
    opts = opts || {};
    const r = rng(opts.seed);
    const ctx = makeContext(opts, r);
    return FULL.map(([ph, idx]) => build(ph, T[ph][idx], ctx, r));
  }

  // ------------------------------------------------------------- valutazione

  const KEY_WORDS = new Set(['climb', 'descend', 'maintain', 'left', 'right', 'land', 'takeoff', 'line', 'wait', 'hold', 'short',
    'cross', 'direct', 'ils', 'rnav', 'visual', 'approach', 'push', 'start', 'position', 'around', 'expect', 'via', 'stand']);

  function canon(text) {
    const toks = R.tokenize(text).map((t) => (R.PHONETIC[t] ? R.PHONETIC[t].toLowerCase() : t));
    // "flight level two five zero one zero minutes" -> fl 250 10 minutes
    for (let k = 0; k < toks.length; k++) {
      if (toks[k] === 'fl' && /^\d{4,5}$/.test(toks[k + 1] || '') && toks[k + 2] === 'minutes') toks.splice(k + 1, 1, toks[k + 1].slice(0, 3), toks[k + 1].slice(3));
    }
    const out = [];
    for (let i = 0; i < toks.length; i++) {
      let t = toks[i];
      if (t === 'holding') t = 'hold';
      if (t === 'pushback') t = 'push';
      if (t === 'startup') t = 'start';
      if (/^\d+$/.test(t)) t = String(Number(t));
      else if (/^\d+\.\d+$/.test(t)) t = String(parseFloat(t));
      const m = t.match(/^0*(\d{1,2})([lrc])$/);
      if (m) t = m[1] + m[2];
      const nx = toks[i + 1];
      const rwyNum = /^\d{1,2}$/.test(t) && Number(t) >= 1 && Number(t) <= 36;
      if (rwyNum && ['left', 'right', 'center', 'l', 'r', 'c'].includes(nx) && !['heading', 'fl'].includes(toks[i - 1]) && !['heading', 'turn'].includes(toks[i + 2])) {
        t += nx[0];
        i++;
      } else if (/^\d$/.test(t) && /^[a-z]$/.test(nx || '') && !['l', 'r', 'c'].includes(nx)) {
        t += nx;
        i++;
      }
      out.push(t);
    }
    return out;
  }

  const LABELS = {
    level: 'Quota', heading: 'Prua', speed: 'Velocità', squawk: 'Squawk', qnh: 'QNH', frequency: 'Frequenza', runway: 'Pista',
    taxi: 'Rullaggio', clearance: 'Autorizzazione', approach: 'Avvicinamento', arrival: 'Arrivo', direct: 'Diretto', ground: 'Push/Start', phrase: 'Istruzione',
  };

  function essentials(part) {
    return canon(part.display).filter((t) => /\d/.test(t) || KEY_WORDS.has(t) || /^[a-z]$/.test(t));
  }

  function score(expected, userText) {
    const said = new Set(canon(userText));
    const items = expected.parts.filter((p) => p.type !== 'ack').map((p) => {
      const need = essentials(p);
      const missing = need.filter((t) => !said.has(t));
      return { label: LABELS[p.type] || 'Istruzione', expected: p.display, ok: missing.length === 0, missing };
    });
    const cs = expected.callsign;
    const csOk = cs ? R.detectForUs(R.tokenize(userText), cs) === true : true;
    items.push({ label: 'Nominativo', expected: cs ? cs.display : '', ok: csOk, missing: [] });
    const ok = items.filter((x) => x.ok).length;
    return { items, score: Math.round((ok / items.length) * 100), perfect: ok === items.length };
  }

  const api = { PHASES, AIRPORTS, generate, fullFlight, score, canon, essentials, makeContext };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scenarios = api;
})(this);
