/* Decodifica un METAR in italiano o inglese semplice. */
(function (root) {
  'use strict';

  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const I18n = isNode ? require('./i18n.js') : root.I18n;
  const en = () => !!I18n && I18n.lang === 'en';
  const P = (pair) => pair[en() ? 1 : 0];

  // Fenomeni [italiano, inglese]
  const WX = {
    MI: ['sottile', 'shallow'], BC: ['a banchi', 'patches of'], PR: ['parziale', 'partial'], DR: ['scaccia-', 'low drifting'], BL: ['sollevata', 'blowing'],
    SH: ['rovesci di', 'showers of'], TS: ['temporale', 'thunderstorm'], FZ: ['congelante', 'freezing'],
    DZ: ['pioviggine', 'drizzle'], RA: ['pioggia', 'rain'], SN: ['neve', 'snow'], SG: ['neve granulosa', 'snow grains'], IC: ['cristalli di ghiaccio', 'ice crystals'], PL: ['ghiaccio granulare', 'ice pellets'],
    GR: ['grandine', 'hail'], GS: ['granella', 'small hail'], UP: ['precipitazione', 'precipitation'], BR: ['foschia', 'mist'], FG: ['nebbia', 'fog'], FU: ['fumo', 'smoke'], VA: ['cenere vulcanica', 'volcanic ash'],
    DU: ['polvere', 'dust'], SA: ['sabbia', 'sand'], HZ: ['caligine', 'haze'], PO: ['turbini di polvere', 'dust whirls'], SQ: ['groppo', 'squalls'], FC: ['tromba d\'aria', 'funnel cloud'],
    SS: ['tempesta di sabbia', 'sandstorm'], DS: ['tempesta di polvere', 'duststorm'],
  };
  const COVER = {
    FEW: ['poche nubi', 'few clouds'], SCT: ['nubi sparse', 'scattered clouds'], BKN: ['molto nuvoloso', 'broken clouds'], OVC: ['coperto', 'overcast'],
    VV: ['cielo invisibile, visibilità verticale', 'sky obscured, vertical visibility'],
  };
  const WX_RE = /^(\+|-|VC)?((?:MI|BC|PR|DR|BL|SH|TS|FZ)*)((?:DZ|RA|SN|SG|IC|PL|GR|GS|UP|BR|FG|FU|VA|DU|SA|HZ|PO|SQ|FC|SS|DS)*)$/;
  const T = {
    time: ['giorno {d} alle {h}:{m} UTC', 'day {d} at {h}:{m} UTC'],
    light: ['leggera', 'light'], heavy: ['forte', 'heavy'], vicinity: ['nelle vicinanze', 'in the vicinity'],
    wind: ['Vento', 'Wind'], calm: ['calmo', 'calm'], variable: ['variabile', 'variable'], from: ['da {dir}°', 'from {dir}°'], at: ['a', 'at'],
    kt: ['nodi', 'kt'], gusts: ['raffiche', 'gusting'], varBetween: ['variabile tra {a}° e {b}°', 'varying between {a}° and {b}°'],
    cavok: ['CAVOK: visibilità 10 km o più, nessuna nube significativa', 'CAVOK: visibility 10 km or more, no significant cloud'],
    vis: ['Visibilità', 'Visibility'], vis10: ['10 km o più', '10 km or more'], phen: ['Fenomeni', 'Weather'], clouds: ['Nubi', 'Clouds'],
    at_ft: ['a {ft} ft', 'at {ft} ft'], cb: ['(cumulonembi!)', '(cumulonimbus!)'], tcu: ['(cumuli torreggianti)', '(towering cumulus)'],
    noClouds: ['nessuna significativa', 'none significant'], temp: ['Temperatura {t}°C, rugiada {d}', 'Temperature {t}°C, dew point {d}'], na: ['n/d', 'n/a'],
    altimeter: ['Altimetro', 'Altimeter'], trend: ['Tendenza', 'Trend'], nosig: ['nessun cambiamento significativo', 'no significant change'],
  };
  const tx = (k, v) => P(T[k]).replace(/\{(\w+)\}/g, (m, x) => (v && v[x] !== undefined ? v[x] : ''));

  // Testo di un gruppo di fenomeni ("-SHRA" → "light showers of rain" / "rovesci di pioggia leggera")
  function weatherText(tok) {
    const m = String(tok || '').match(WX_RE);
    if (!m || !(m[2] || m[3])) return String(tok || '');
    const desc = (m[2].match(/../g) || []).map((c) => P(WX[c]));
    const phen = (m[3].match(/../g) || []).map((c) => P(WX[c]));
    let txt;
    if (en()) {
      // "light showers of rain", "thunderstorm with rain", "rain in the vicinity"
      const d = desc.map((x) => (x === 'thunderstorm' && phen.length ? 'thunderstorm with' : x));
      txt = [m[1] === '-' ? tx('light') : m[1] === '+' ? tx('heavy') : '', ...d, ...phen].filter(Boolean).join(' ');
      if (m[1] === 'VC') txt += ` ${tx('vicinity')}`;
    } else {
      txt = [...desc, ...phen].join(' ');
      if (m[1] === '-') txt += ` ${tx('light')}`;
      if (m[1] === '+') txt += ` ${tx('heavy')}`;
      if (m[1] === 'VC') txt += ` ${tx('vicinity')}`;
    }
    return txt;
  }
  const isWeather = (tok) => String(tok || '').length >= 2 && (() => { const m = String(tok).match(WX_RE); return !!(m && (m[2] || m[3])); })();

  function cloudText(c) {
    return `${P(COVER[c.cover])}${c.base !== null ? ` ${tx('at_ft', { ft: c.base })}` : ''}${c.type === 'CB' ? ` ${tx('cb')}` : c.type === 'TCU' ? ` ${tx('tcu')}` : ''}`;
  }

  // Categoria di volo (stessa scala di aviationweather.gov): visibilità in metri, nubi con base in piedi
  function category(vis, clouds, cavok) {
    const ceiling = (clouds || []).filter((c) => ['BKN', 'OVC', 'VV'].includes(c.cover) && c.base !== null).map((c) => c.base)[0];
    const v = cavok ? 10000 : vis;
    if (v === null || v === undefined) return undefined;
    if (v < 1600 || (ceiling !== undefined && ceiling < 500)) return 'LIFR';
    if (v < 5000 || (ceiling !== undefined && ceiling < 1000)) return 'IFR';
    if (v < 8000 || (ceiling !== undefined && ceiling <= 3000)) return 'MVFR';
    return 'VFR';
  }

  function temp(s) { return s ? (s[0] === 'M' ? -Number(s.slice(1)) : Number(s)) : null; }

  function decode(raw) {
    const out = { raw: String(raw || '').trim(), lines: [], wind: null, visibility: null, clouds: [], weather: [], wx: [], qnh: null, temp: null, dew: null, cavok: false };
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
      if ((m = t.match(/^(\d{2})(\d{2})(\d{2})Z$/))) { out.time = tx('time', { d: m[1], h: m[2], m: m[3] }); continue; }
      if ((m = t.match(/^(\d{3}|VRB)(\d{2,3})(?:G(\d{2,3}))?(KT|MPS)$/))) {
        const unit = m[4] === 'KT' ? 'kt' : 'm/s';
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
        out.weather.push(weatherText(t));
        out.wx.push(t);
      }
    }

    // ---- frasi nella lingua dell'interfaccia
    const L = out.lines;
    if (out.wind) {
      const w = out.wind;
      const unit = w.unit === 'kt' ? tx('kt') : 'm/s';
      if (w.speed === 0) L.push(`${tx('wind')}: ${tx('calm')}`);
      else {
        let s = `${tx('wind')}: ${w.dir === null ? tx('variable') : tx('from', { dir: String(w.dir).padStart(3, '0') })} ${tx('at')} ${w.speed} ${unit}`;
        if (w.gust) s += `, ${tx('gusts')} ${w.gust}`;
        if (w.varFrom !== undefined) s += ` (${tx('varBetween', { a: w.varFrom, b: w.varTo })})`;
        L.push(s);
      }
    }
    if (out.cavok) L.push(tx('cavok'));
    else if (out.visibility !== null) L.push(`${tx('vis')}: ${out.visibility >= 9999 ? tx('vis10') : out.visibility >= 5000 ? `${Math.round(out.visibility / 1000)} km` : `${out.visibility} m`}`);
    if (out.weather.length) L.push(`${tx('phen')}: ${out.weather.join(', ')}`);
    if (out.clouds.length) {
      L.push(`${tx('clouds')}: ${out.clouds.map(cloudText).join(', ')}`);
    } else if (out.noClouds) L.push(`${tx('clouds')}: ${tx('noClouds')}`);
    if (out.temp !== null) L.push(tx('temp', { t: out.temp, d: out.dew !== null ? `${out.dew}°C` : tx('na') }));
    if (out.qnh) L.push(out.qnh.inhg ? `${tx('altimeter')}: ${out.qnh.inhg.toFixed(2)} inHg (≈ ${out.qnh.hpa} hPa)` : `QNH: ${out.qnh.hpa} hPa`);
    if (out.trend) L.push(`${tx('trend')}: ${out.trend.startsWith('NOSIG') ? tx('nosig') : out.trend}`);

    const cat = category(out.visibility, out.clouds, out.cavok);
    if (cat) out.category = cat;
    return out;
  }

  const api = { decode, weatherText, isWeather, cloudText, category, WX_RE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Metar = api;
})(this);
