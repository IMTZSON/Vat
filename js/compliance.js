/* Controllo dell'esecuzione: confronta le istruzioni ATC ricevute (squawk, frequenza, QNH, livello, prua)
   con quello che risulta nel simulatore. Modulo puro: observe() registra le istruzioni, check() le verifica.
   Ogni verifica: { type, status: 'ok' | 'warn' | 'wait', key, vars } (key = testo in strings.js). */
(function (root) {
  'use strict';

  // Tempi concessi per eseguire l'istruzione prima di avvisare (ms)
  const GRACE = { squawk: 20000, freq: 30000, qnh: 45000, level: 25000, heading: 20000 };
  const EXPIRE = { freq: 180000, qnh: 600000, level: 900000, heading: 300000 };

  const emptyState = () => ({ squawk: null, freq: null, qnh: null, level: null, heading: null });

  function observe(state, result, now) {
    const s = { ...emptyState(), ...(state || {}) };
    if (!result || result.forUs !== true) return s;
    const t = now || Date.now();
    for (const p of result.parts || []) {
      const d = String(p.display || '');
      let m;
      if (p.type === 'squawk' && (m = d.match(/\b([0-7]{4})\b/))) s.squawk = { code: m[1], at: t };
      if (p.type === 'frequency' && (m = d.match(/^(.*?)\s*(1[1-3]\d\.\d{1,3})$/))) s.freq = { station: m[1].trim(), mhz: Number(m[2]), text: m[2], at: t };
      if (p.type === 'qnh' && (m = d.match(/(\d{3,4})/))) {
        const v = Number(m[1]);
        // QNH in hPa (950-1060) oppure altimetro in pollici (2992 -> 29.92)
        const hpa = v >= 900 && v <= 1100 ? v : (v >= 2700 && v <= 3200 ? Math.round((v / 100) * 33.8639) : null);
        if (hpa) s.qnh = { hpa, text: m[1], at: t };
      }
      if (p.type === 'level') {
        if ((m = d.match(/FL\s?(\d{2,3})/i))) s.level = { ft: Number(m[1]) * 100, text: `FL${Number(m[1])}`, at: t };
        else if ((m = d.match(/(\d{3,5})\s*ft/i))) s.level = { ft: Number(m[1]), text: `${Number(m[1])} ft`, at: t };
      }
      if (p.type === 'heading' && (m = d.match(/heading\s+(\d{3})/i))) s.heading = { deg: Number(m[1]) % 360, text: m[1], at: t };
    }
    return s;
  }

  const angle = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
  const fmtFreq = (v) => (typeof v === 'number' ? v.toFixed(3) : '—');

  /* sim: { com1, com2, xpdr, baro, altSel, hdgSel, alt, onGround }
     -> verifiche attive, la più importante per prima (avvisi prima delle conferme) */
  function check(state, sim, now) {
    const s = { ...emptyState(), ...(state || {}) };
    const t = now || Date.now();
    const out = [];
    if (!sim) return out;
    const due = (x, type) => t - x.at >= GRACE[type];
    const alive = (x, type) => !EXPIRE[type] || t - x.at < EXPIRE[type];

    if (s.squawk && sim.xpdr) {
      const ok = sim.xpdr === s.squawk.code;
      out.push({ type: 'squawk', status: ok ? 'ok' : (due(s.squawk, 'squawk') ? 'warn' : 'wait'), key: ok ? 'sim.okSquawk' : 'sim.badSquawk', vars: { want: s.squawk.code, have: sim.xpdr } });
    }
    if (s.freq && alive(s.freq, 'freq') && (sim.com1 || sim.com2)) {
      const ok = [sim.com1, sim.com2].some((f) => typeof f === 'number' && Math.abs(f - s.freq.mhz) < 0.003);
      if (ok) s.freq.done = true;
      // Dopo aver cambiato frequenza una volta non si avvisa più (si può ascoltare l'ATIS, ecc.)
      if (ok || !s.freq.done) out.push({ type: 'freq', status: ok ? 'ok' : (due(s.freq, 'freq') ? 'warn' : 'wait'), key: ok ? 'sim.okFreq' : 'sim.badFreq', vars: { want: fmtFreq(s.freq.mhz), station: s.freq.station, have: fmtFreq(sim.com1) } });
    }
    // Il QNH si controlla solo in basso (sopra l'altitudine di transizione si vola con 1013)
    if (s.qnh && alive(s.qnh, 'qnh') && typeof sim.baro === 'number' && typeof sim.alt === 'number' && sim.alt < 5000) {
      const ok = Math.abs(sim.baro - s.qnh.hpa) < 1.5;
      out.push({ type: 'qnh', status: ok ? 'ok' : (due(s.qnh, 'qnh') ? 'warn' : 'wait'), key: ok ? 'sim.okQnh' : 'sim.badQnh', vars: { want: s.qnh.hpa, have: Math.round(sim.baro) } });
    }
    // Livello e prua: solo se l'aereo usa i selettori standard dell'autopilota (alcuni add-on no)
    if (s.level && alive(s.level, 'level') && sim.altSel > 0) {
      const ok = Math.abs(sim.altSel - s.level.ft) <= 100;
      out.push({ type: 'level', status: ok ? 'ok' : (due(s.level, 'level') ? 'warn' : 'wait'), key: ok ? 'sim.okLevel' : 'sim.badLevel', vars: { want: s.level.text, have: `${sim.altSel} ft` } });
    }
    if (s.heading && alive(s.heading, 'heading') && typeof sim.hdgSel === 'number' && !sim.onGround) {
      const ok = angle(sim.hdgSel, s.heading.deg) <= 5;
      out.push({ type: 'heading', status: ok ? 'ok' : (due(s.heading, 'heading') ? 'warn' : 'wait'), key: ok ? 'sim.okHeading' : 'sim.badHeading', vars: { want: s.heading.text, have: String(sim.hdgSel).padStart(3, '0') } });
    }
    const rank = { warn: 0, wait: 1, ok: 2 };
    return out.sort((a, b) => rank[a.status] - rank[b.status]);
  }

  const api = { emptyState, observe, check, GRACE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Compliance = api;
})(this);
