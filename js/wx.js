/* Meteo di un aeroporto (METAR dal servizio di VATSIM, TAF da aviationweather.gov) con una cache
   di 10 minuti condivisa tra la scheda Volo e la mappa, più un riquadro compatto per i popup. */
(function (root) {
  'use strict';

  const TTL = 10 * 60e3;
  const cache = new Map();
  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const t = (k, v) => root.I18n.t(k, v);

  async function load(icao) {
    const info = { icao, t: Date.now() };
    const metar = (async () => {
      try {
        const raw = (await root.Net.text(`https://metar.vatsim.net/${icao}`)).trim();
        if (raw) info.metar = root.Metar.decode(raw.split('\n')[0]);
        else info.metarError = t('flight.noMetarHere');
      } catch (e) { info.metarError = t('flight.metarError', { msg: e.message }); }
    })();
    const taf = (async () => {
      try {
        const raw = (await root.Net.text(root.Taf.URL(icao))).trim();
        // la risposta può contenere più TAF o righe a capo: teniamo il primo, su una riga
        const first = raw.split(/\n(?=TAF\b)/)[0].replace(/\s+/g, ' ').trim();
        if (first) info.taf = root.Taf.parse(first.startsWith('TAF') ? first : `TAF ${first}`);
        if (!info.taf) info.tafError = t('taf.none');
      } catch (e) { info.tafError = t('taf.error', { msg: e.message }); }
    })();
    await Promise.all([metar, taf]);
    return info;
  }

  // get(icao, maxAge): maxAge = 0 forza l'aggiornamento
  function get(icao, maxAge) {
    const key = String(icao || '').toUpperCase();
    const age = maxAge === undefined ? TTL : maxAge;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.t <= age) return hit.p;
    const p = load(key);
    cache.set(key, { t: Date.now(), p });
    p.catch(() => cache.delete(key));
    return p;
  }

  // Riquadro compatto: condizioni attuali e le prossime ore (per i popup della mappa)
  function compactHtml(info, ap) {
    const Taf = root.Taf;
    const I = root.Icons.svg;
    const a = ap || {};
    const m = info && info.metar;
    let html = '';
    if (m) {
      const icon = Taf.icon({ wx: m.wx, clouds: m.clouds, cavok: m.cavok }, Taf.isNight(Date.now(), a.lat, a.lon));
      const parts = [Taf.windShort(m.wind && { ...m.wind, speed: m.wind.unit === 'm/s' ? Math.round(m.wind.speed * 1.944) : m.wind.speed }), Taf.visShort({ cavok: m.cavok, visibility: m.visibility })];
      if (m.qnh) parts.push(`Q${m.qnh.hpa}`);
      if (m.temp !== null) parts.push(`${m.temp}°`);
      html += `<div class="pw-now cat-${m.category || 'NA'}"><span class="wx-icon">${I(icon)}</span><div><b>${esc(m.category || '—')}</b> ${esc(parts.join(' · '))}
        <code class="metar">${esc(m.raw)}</code></div></div>`;
    } else if (info && info.metarError) html += `<span class="muted">${esc(info.metarError)}</span>`;
    const steps = info && info.taf ? Taf.timeline(info.taf, Date.now(), 3, 5) : [];
    if (steps.length) {
      html += `<div class="fc-strip mini">${steps.map((s, k) => `<div class="fc-chip cat-${s.main.category || 'NA'}" title="${esc(Taf.describe(s.main))}">
        <span class="h">${k === 0 && s.t - Date.now() < 3600e3 ? esc(t('taf.now')) : `${String(new Date(s.t).getUTCHours()).padStart(2, '0')}Z`}</span>${I(Taf.icon(s.main, Taf.isNight(s.t, a.lat, a.lon)))}
        <b>${esc(Taf.windShort(s.main.wind))}</b><i class="bar"></i>${s.worst && s.worst !== s.main.category ? `<em class="dot cat-${s.worst}"></em>` : ''}</div>`).join('')}</div>`;
    }
    return `<div class="fc pop-wx">${html || `<span class="muted">${esc(t('flight.noMetar'))}</span>`}</div>`;
  }

  root.AirportWx = { get, compactHtml };
})(this);
