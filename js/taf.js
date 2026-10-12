/* Previsioni TAF: lettura, condizioni previste a un'ora qualsiasi e icona "da app meteo".
   Formato ICAO Annex 3: TAF [AMD|COR] ICAO DDHHMMZ DDHH/DDHH <condizioni> poi gruppi
   FMDDHHMM (cambia tutto), BECMG DDHH/DDHH (cambia gradualmente gli elementi indicati),
   TEMPO DDHH/DDHH (fluttuazioni temporanee), PROB30/PROB40 [TEMPO] DDHH/DDHH.
   Funzioni pure; i testi usano gli stessi decodificatori del METAR. */
(function (root) {
  'use strict';

  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const Metar = isNode ? require('./metar.js') : root.Metar;

  const H = 3600e3;
  const RANK = { VFR: 0, MVFR: 1, IFR: 2, LIFR: 3 };

  // Giorno del mese → data UTC vicina a "ref" (gestisce il cambio di mese e l'ora 24)
  function dayTime(ref, day, hour, minute) {
    const r = new Date(ref);
    let best = null;
    for (const dm of [-1, 0, 1]) {
      const d = Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + dm, day, hour, minute || 0);
      // un giorno inesistente (31 in un mese da 30) scivola nel mese dopo: lo scartiamo
      if (new Date(Date.UTC(r.getUTCFullYear(), r.getUTCMonth() + dm, day)).getUTCDate() !== day) continue;
      if (best === null || Math.abs(d - r) < Math.abs(best - r)) best = d;
    }
    return best;
  }
  const range = (ref, tok) => {
    const m = String(tok).match(/^(\d{2})(\d{2})\/(\d{2})(\d{2})$/);
    if (!m) return null;
    const from = dayTime(ref, +m[1], +m[2]);
    const to = dayTime(from, +m[3], +m[4]);
    return to > from ? { from, to } : null;
  };

  // Elementi meteo di un gruppo: vento, visibilità, fenomeni, nubi
  function elements(toks, i, el) {
    for (; i < toks.length; i++) {
      const t = toks[i];
      let m;
      if (/^(FM\d{6}|BECMG|TEMPO|PROB\d{2}|RMK)$/.test(t)) break;
      if ((m = t.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/))) {
        const k = m[4] === 'MPS' ? 1.944 : 1;
        el.wind = { dir: m[1] === 'VRB' ? null : Number(m[1]), speed: Math.round(Number(m[2]) * k), gust: m[3] ? Math.round(Number(m[3]) * k) : null };
        continue;
      }
      if ((m = t.match(/^(\d{3})V(\d{3})$/))) continue;
      if (t === 'CAVOK') { el.cavok = true; el.visibility = 10000; el.clouds = []; el.wx = []; continue; }
      if ((m = t.match(/^(\d{4})(NDV)?$/))) { el.visibility = Number(m[1]) >= 9999 ? 10000 : Number(m[1]); el.cavok = false; continue; }
      if (t === 'P6SM') { el.visibility = 10000; el.cavok = false; continue; }
      if ((m = t.match(/^(\d+)(?:\/(\d+))?SM$/))) {
        // "1 1/2SM": la parte intera è il gruppo prima
        const whole = m[2] && /^\d$/.test(toks[i - 1] || '') ? Number(toks[i - 1]) : 0;
        el.visibility = Math.min(10000, Math.round((whole + (m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1]))) * 1609));
        el.cavok = false;
        continue;
      }
      if (t === 'NSW') { el.wx = []; continue; }
      if (['NSC', 'SKC', 'CLR', 'NCD'].includes(t)) { el.clouds = []; continue; }
      if ((m = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU)?$/))) {
        // le nubi di un gruppo sostituiscono quelle precedenti
        if (!el._clouds) { el.clouds = []; el._clouds = true; }
        el.clouds.push({ cover: m[1], base: m[2] === '///' ? null : Number(m[2]) * 100, type: m[3] || null });
        el.cavok = false;
        continue;
      }
      if (/^T[XN]M?\d{2}\/\d{4}Z$/.test(t) || /^(WS|QNH|AMD|COR|AUTO)/.test(t)) continue;
      if (Metar.isWeather(t)) {
        if (!el._wx) { el.wx = []; el._wx = true; }
        el.wx.push(t);
        el.cavok = false;
      }
    }
    delete el._clouds;
    delete el._wx;
    return i;
  }

  function finish(p) {
    p.category = Metar.category(p.visibility, p.clouds, p.cavok);
    return p;
  }

  /* parse(raw, now) → { station, issued, from, to, periods: [{ kind, prob, from, to, ...elementi, category }] }
     kind: BASE | FM | BECMG | TEMPO | PROB (PROB può essere anche "PROB30 TEMPO": tempo = true) */
  function parse(raw, now) {
    const text = String(raw || '').replace(/=+\s*$/, '').replace(/\s+/g, ' ').trim();
    const toks = text.split(' ');
    const out = { raw: text, station: null, issued: null, from: null, to: null, amended: false, periods: [] };
    let i = 0;
    while (/^(TAF|AMD|COR|RTD)$/.test(toks[i] || '')) { if (toks[i] === 'AMD' || toks[i] === 'COR') out.amended = true; i++; }
    if (!/^[A-Z][A-Z0-9]{3}$/.test(toks[i] || '')) return null;
    out.station = toks[i++];
    const ref = now === undefined ? Date.now() : +now;
    let m = (toks[i] || '').match(/^(\d{2})(\d{2})(\d{2})Z$/);
    if (m) { out.issued = dayTime(ref, +m[1], +m[2], +m[3]); i++; }
    const issued = out.issued || ref;
    const valid = range(issued, toks[i] || '');
    if (!valid) return null;
    i++;
    out.from = valid.from;
    out.to = valid.to;
    if (toks[i] === 'NIL' || toks[i] === 'CNL') { out.cancelled = true; return out; }

    const base = { kind: 'BASE', prob: null, from: out.from, to: out.to, wind: null, visibility: null, cavok: false, wx: [], clouds: [] };
    i = elements(toks, i, base);
    out.periods.push(finish(base));

    while (i < toks.length) {
      const t = toks[i];
      if (t === 'RMK') break;
      let p = null;
      if ((m = t.match(/^FM(\d{2})(\d{2})(\d{2})$/))) {
        p = { kind: 'FM', prob: null, from: dayTime(issued, +m[1], +m[2], +m[3]), to: out.to, wind: null, visibility: null, cavok: false, wx: [], clouds: [] };
        i++;
      } else if (t === 'BECMG' || t === 'TEMPO' || /^PROB\d{2}$/.test(t)) {
        const prob = /^PROB(\d{2})$/.test(t) ? Number(t.slice(4)) : null;
        let tempo = t === 'TEMPO';
        i++;
        if (prob && toks[i] === 'TEMPO') { tempo = true; i++; }
        const r = range(issued, toks[i] || '');
        if (!r) { i++; continue; }
        i++;
        p = { kind: prob ? 'PROB' : t, prob, tempo, from: r.from, to: r.to };
      } else { i++; continue; }
      i = elements(toks, i, p);
      out.periods.push(p);
    }

    // FM chiude il periodo prevalente precedente; BECMG/TEMPO/PROB ereditano dal prevalente per la categoria
    const main = out.periods.filter((p) => p.kind === 'BASE' || p.kind === 'FM').sort((a, b) => a.from - b.from);
    for (let k = 0; k < main.length - 1; k++) main[k].to = main[k + 1].from;
    for (const p of out.periods) if (p.kind !== 'BASE' && p.kind !== 'FM') merge(prevailing(out, p.from), p);
    for (const p of out.periods) if (p.kind === 'FM') finish(p);
    return out;
  }

  // Unione di elementi: quelli del cambiamento sostituiscono quelli di partenza
  function merge(base, ch) {
    const r = { ...base };
    for (const k of ['wind', 'visibility', 'cavok']) if (ch[k] !== undefined && ch[k] !== null) r[k] = ch[k];
    if (ch.wx !== undefined) r.wx = ch.wx;
    if (ch.clouds !== undefined) r.clouds = ch.clouds;
    if (ch.cavok) { r.visibility = 10000; r.clouds = []; r.wx = []; }
    r.category = Metar.category(r.visibility, r.clouds, r.cavok);
    // un gruppo di cambiamento senza visibilità né nubi eredita la categoria di partenza
    ch.category = r.category;
    ch.full = r;
    return ch;
  }

  // Condizioni prevalenti a un istante (base + FM + BECMG già conclusi), senza TEMPO e PROB
  function prevailing(taf, time) {
    const t = +time;
    let cur = null;
    for (const p of taf.periods) if ((p.kind === 'BASE' || p.kind === 'FM') && p.from <= t) cur = p;
    if (!cur) cur = taf.periods[0];
    let r = { wind: cur.wind, visibility: cur.visibility, cavok: cur.cavok, wx: cur.wx, clouds: cur.clouds };
    for (const p of taf.periods) {
      if (p.kind !== 'BECMG' || p.from < cur.from) continue;
      if (p.to <= t) r = { ...r, ...pick(p) };
    }
    r.category = Metar.category(r.visibility, r.clouds, r.cavok);
    return r;
  }
  const pick = (p) => {
    const o = {};
    for (const k of ['wind', 'visibility', 'cavok', 'wx', 'clouds']) if (p[k] !== undefined && p[k] !== null) o[k] = p[k];
    if (p.cavok) { o.visibility = 10000; o.clouds = []; o.wx = []; }
    return o;
  };

  /* Condizioni a un istante: { main, changes: [periodi TEMPO/PROB/BECMG in corso], worst: categoria peggiore } */
  function at(taf, time) {
    if (!taf || !taf.periods.length) return null;
    const t = +time;
    const main = prevailing(taf, t);
    const changes = taf.periods.filter((p) => p.kind !== 'BASE' && p.kind !== 'FM' && p.from <= t && t < p.to);
    let worst = main.category;
    for (const c of changes) if (c.category && (worst === undefined || RANK[c.category] > RANK[worst])) worst = c.category;
    return { main, changes, worst, inside: t >= taf.from && t < taf.to };
  }

  // Ore piene (ogni "step" ore) dentro la validità, a partire da "start"
  function timeline(taf, start, step, max) {
    if (!taf) return [];
    const s = step || 3;
    let t = Math.max(+start || taf.from, taf.from);
    t = Math.ceil(t / H) * H;
    const out = [];
    for (; t < taf.to && out.length < (max || 10); t += s * H) out.push({ t, ...at(taf, t) });
    return out;
  }

  // Sole sotto l'orizzonte? (formula approssimata, precisa a pochi minuti: basta per l'icona)
  function isNight(time, lat, lon) {
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return false;
    const d = new Date(+time);
    const start = Date.UTC(d.getUTCFullYear(), 0, 0);
    const doy = (d - start) / 864e5;
    const decl = (23.44 * Math.PI / 180) * Math.sin((2 * Math.PI * (284 + doy)) / 365);
    const solar = d.getUTCHours() + d.getUTCMinutes() / 60 + lon / 15;
    const ha = ((solar - 12) * 15 * Math.PI) / 180;
    const la = (lat * Math.PI) / 180;
    const el = Math.asin(Math.sin(la) * Math.sin(decl) + Math.cos(la) * Math.cos(decl) * Math.cos(ha));
    return (el * 180) / Math.PI < -0.833;
  }

  // Icona Lucide per un insieme di condizioni { wx, clouds, cavok }
  function icon(c, night) {
    const wx = ((c && c.wx) || []).join(' ');
    if (/TS/.test(wx)) return 'cloud-lightning';
    if (/SN|SG|PL|GS|GR|IC/.test(wx)) return 'cloud-snow';
    if (/RA|UP/.test(wx)) return /SH/.test(wx) ? 'cloud-rain' : (/-RA/.test(wx) ? 'cloud-drizzle' : 'cloud-rain');
    if (/DZ/.test(wx)) return 'cloud-drizzle';
    if (/FG|BR/.test(wx)) return 'cloud-fog';
    if (/HZ|FU|DU|SA|VA/.test(wx)) return 'haze';
    const covers = ((c && c.clouds) || []).map((x) => x.cover);
    if (covers.includes('OVC') || covers.includes('VV') || covers.includes('BKN')) return 'cloud';
    if (covers.includes('SCT') || covers.includes('FEW')) return night ? 'cloud-moon' : 'cloud-sun';
    return night ? 'moon' : 'sun';
  }

  // Testi compatti per i chip: "270/12G25", "3000 m", "10 km+"
  function windShort(w) {
    if (!w) return '—';
    if (w.speed === 0) return '00000';
    return `${w.dir === null ? 'VRB' : String(w.dir).padStart(3, '0')}/${w.speed}${w.gust ? `G${w.gust}` : ''}`;
  }
  function visShort(c) {
    if (!c) return '—';
    if (c.cavok) return 'CAVOK';
    if (c.visibility === null || c.visibility === undefined) return '—';
    return c.visibility >= 9999 ? '10 km+' : c.visibility >= 5000 ? `${Math.round(c.visibility / 1000)} km` : `${c.visibility} m`;
  }
  // Testo del tempo previsto ("pioggia leggera, nubi sparse a 3000 ft")
  function describe(c) {
    if (!c) return '';
    if (c.cavok) return 'CAVOK';
    const parts = (c.wx || []).map(Metar.weatherText);
    for (const cl of c.clouds || []) parts.push(Metar.cloudText(cl));
    return parts.join(', ');
  }

  const api = { parse, at, prevailing, timeline, isNight, icon, windShort, visShort, describe, RANK, URL: (icao) => `https://aviationweather.gov/api/data/taf?ids=${encodeURIComponent(icao)}&format=raw` };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Taf = api;
})(this);
