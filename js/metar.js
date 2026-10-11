/* Decodifica un METAR in italiano semplice. */
(function (root) {
  'use strict';

  const WX = {
    MI: 'sottile', BC: 'a banchi', PR: 'parziale', DR: 'scaccia-', BL: 'sollevata', SH: 'rovesci di', TS: 'temporale', FZ: 'congelante',
    DZ: 'pioviggine', RA: 'pioggia', SN: 'neve', SG: 'neve granulosa', IC: 'cristalli di ghiaccio', PL: 'ghiaccio granulare',
    GR: 'grandine', GS: 'granella', UP: 'precipitazione', BR: 'foschia', FG: 'nebbia', FU: 'fumo', VA: 'cenere vulcanica',
    DU: 'polvere', SA: 'sabbia', HZ: 'caligine', PO: 'turbini di polvere', SQ: 'groppo', FC: 'tromba d\'aria',
    SS: 'tempesta di sabbia', DS: 'tempesta di polvere',
  };
  const COVER = { FEW: 'poche nubi', SCT: 'nubi sparse', BKN: 'molto nuvoloso', OVC: 'coperto', VV: 'cielo invisibile, visibilità verticale' };
  const WX_RE = /^(\+|-|VC)?((?:MI|BC|PR|DR|BL|SH|TS|FZ)*)((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)*)$/;

  function temp(s) { return s ? (s[0] === 'M' ? -Number(s.slice(1)) : Number(s)) : null; }

  function decode(raw) {
    const out = { raw: String(raw || '').trim(), lines: [], wind: null, visibility: null, clouds: [], weather: [], qnh: null, temp: null, dew: null, cavok: false };
    const toks = out.raw.replace(/=$/, '').split(/\s+/).filter(Boolean);
    let i = 0;
    while (['METAR', 'SPECI'].includes(toks[i])) i++;
    if (/^[A-Z]{4}$/.test(toks[i] || '')) out.station = toks[i++];
    for (; i < toks.length; i++) {
      const t = toks[i];
      let m;
      if (t === 'RMK') break;
      if (['NOSIG', 'BECMG', 'TEMPO'].includes(t)) {
        out.trend = toks.slice(i).join(' ');
        break;
      }
      if (['AUTO', 'COR', 'NIL'].includes(t)) continue;
      if ((m = t.match(/^(\d{2})(\d{2})(\d{2})Z$/))) { out.time = `giorno ${m[1]} alle ${m[2]}:${m[3]} UTC`; continue; }
      if ((m = t.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/))) {
        const unit = m[4] === 'KT' ? 'nodi' : 'm/s';
        out.wind = { dir: m[1] === 'VRB' ? null : Number(m[1]), speed: Number(m[2]), gust: m[3] ? Number(m[3]) : null, unit };
        continue;
      }
      if ((m = t.match(/^(\d{3})V(\d{3})$/)) && out.wind) { out.wind.varFrom = Number(m[1]); out.wind.varTo = Number(m[2]); continue; }
      if (t === 'CAVOK') { out.cavok = true; continue; }
      if ((m = t.match(/^(\d{4})(NDV)?$/)) && !out.visibility) { out.visibility = Number(m[1]); continue; }
      if ((m = t.match(/^P?(\d+)(?:\/(\d+))?SM$/))) { out.visibility = Math.round((m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1])) * 1609); continue; }
      if (/^R\d{2}[LRC]?\//.test(t)) continue;
      if (['NSC', 'NCD', 'SKC', 'CLR'].includes(t)) { out.noClouds = true; continue; }
      if ((m = t.match(/^(FEW|SCT|BKN|OVC|VV)(\d{3}|\/\/\/)(CB|TCU|\/\/\/)?$/))) {
        out.clouds.push({ cover: m[1], base: m[2] === '///' ? null : Number(m[2]) * 100, type: m[3] && m[3] !== '///' ? m[3] : null });
        continue;
      }
      if ((m = t.match(/^(M?\d{2})\/(M?\d{2})?$/))) { out.temp = temp(m[1]); out.dew = temp(m[2]); continue; }
      if ((m = t.match(/^Q(\d{4})$/))) { out.qnh = { hpa: Number(m[1]) }; continue; }
      if ((m = t.match(/^A(\d{4})$/))) { out.qnh = { inhg: Number(m[1]) / 100, hpa: Math.round((Number(m[1]) / 100) * 33.8639) }; continue; }
      if (t.length >= 2 && (m = t.match(WX_RE)) && (m[2] || m[3])) {
        const parts = [];
        const desc = (m[2].match(/../g) || []).map((c) => WX[c]);
        const phen = (m[3].match(/../g) || []).map((c) => WX[c]);
        parts.push(...desc, ...phen);
        let txt = parts.join(' ');
        if (m[1] === '-') txt += ' leggera';
        if (m[1] === '+') txt += ' forte';
        if (m[1] === 'VC') txt += ' nelle vicinanze';
        out.weather.push(txt);
      }
    }

    // ---- frasi in italiano
    const L = out.lines;
    if (out.wind) {
      const w = out.wind;
      if (w.speed === 0) L.push('Vento: calmo');
      else {
        let s = `Vento: ${w.dir === null ? 'variabile' : `da ${String(w.dir).padStart(3, '0')}°`} a ${w.speed} ${w.unit}`;
        if (w.gust) s += `, raffiche ${w.gust}`;
        if (w.varFrom !== undefined) s += ` (variabile tra ${w.varFrom}° e ${w.varTo}°)`;
        L.push(s);
      }
    }
    if (out.cavok) L.push('CAVOK: visibilità 10 km o più, nessuna nube significativa');
    else if (out.visibility !== null) L.push(`Visibilità: ${out.visibility >= 9999 ? '10 km o più' : out.visibility >= 5000 ? `${Math.round(out.visibility / 1000)} km` : `${out.visibility} m`}`);
    if (out.weather.length) L.push(`Fenomeni: ${out.weather.join(', ')}`);
    if (out.clouds.length) {
      L.push(`Nubi: ${out.clouds.map((c) => `${COVER[c.cover]}${c.base !== null ? ` a ${c.base} ft` : ''}${c.type === 'CB' ? ' (cumulonembi!)' : c.type === 'TCU' ? ' (cumuli torreggianti)' : ''}`).join(', ')}`);
    } else if (out.noClouds) L.push('Nubi: nessuna significativa');
    if (out.temp !== null) L.push(`Temperatura ${out.temp}°C, rugiada ${out.dew !== null ? `${out.dew}°C` : 'n/d'}`);
    if (out.qnh) L.push(out.qnh.inhg ? `Altimetro: ${out.qnh.inhg.toFixed(2)} inHg (≈ ${out.qnh.hpa} hPa)` : `QNH: ${out.qnh.hpa} hPa`);
    if (out.trend) L.push(`Tendenza: ${out.trend.startsWith('NOSIG') ? 'nessun cambiamento significativo' : out.trend}`);

    const ceiling = out.clouds.filter((c) => ['BKN', 'OVC', 'VV'].includes(c.cover) && c.base !== null).map((c) => c.base)[0];
    const vis = out.cavok ? 10000 : out.visibility;
    if (vis !== null && vis !== undefined) {
      if (vis < 1600 || (ceiling !== undefined && ceiling < 500)) out.category = 'LIFR';
      else if (vis < 5000 || (ceiling !== undefined && ceiling < 1000)) out.category = 'IFR';
      else if (vis < 8000 || (ceiling !== undefined && ceiling <= 3000)) out.category = 'MVFR';
      else out.category = 'VFR';
    }
    return out;
  }

  const api = { decode };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Metar = api;
})(this);
