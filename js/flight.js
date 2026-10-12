/* Scheda Volo: piano di volo SimBrief, meteo, ATC online su VATSIM e le chiamate da fare. */
(function (root) {
  'use strict';

  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  root.App.register((App) => {
    const $ = App.$;
    const S = App.settings;
    const R = root.Readback;
    const ap = (icao) => root.World.airport(icao) || {};
    const t = App.t;
    let wx = { dep: null, arr: null };

    // ------------------------------------------------------------ SimBrief

    $('simbriefLoad').addEventListener('click', async () => {
      const user = (S.simbriefUser || '').trim();
      const msg = $('simbriefMsg');
      if (!user) { msg.textContent = t('flight.sbNeedUser'); return; }
      msg.textContent = t('flight.sbLoading');
      const param = /^\d+$/.test(user) ? `userid=${user}` : `username=${encodeURIComponent(user)}`;
      try {
        const j = await root.Net.json(`https://www.simbrief.com/api/xml.fetcher.php?${param}&json=1`);
        const f = root.SimBrief.parse(j);
        App.setFlight(f);
        if (f.callsign) App.set('callsign', f.callsign);
        msg.textContent = `✅ ${t('flight.sbLoaded', { cs: f.callsign, dep: f.dep, arr: f.arr })}`;
        refreshWx();
      } catch (e) {
        msg.textContent = `❌ ${e.message}${root.Net.proxy ? '' : ` ${t('flight.sbBrowser')}`}`;
      }
    });

    $('manUse').addEventListener('click', () => {
      const dep = $('manDep').value.trim().toUpperCase();
      const arr = $('manArr').value.trim().toUpperCase();
      if (!/^[A-Z0-9]{4}$/.test(dep) || !/^[A-Z0-9]{4}$/.test(arr)) { App.toast(t('flight.needIcao')); return; }
      for (const x of [dep, arr]) if (root.World.loaded && !root.World.airport(x)) App.toast(t('flight.unknownAirport', { icao: x }), 5000);
      const fl = Number($('manFl').value) || null;
      App.setFlight({
        source: t('flight.manual'), callsign: (App.callsignInfo() || {}).code || '',
        dep, depName: ap(dep).name || dep, arr, arrName: ap(arr).name || arr, cruise: fl,
        pax: Number($('manPax').value) || null, aircraft: App.settings.aircraft,
      });
      refreshWx();
    });

    function fmtDur(sec) {
      if (!sec) return '–';
      return `${Math.floor(sec / 3600)}h ${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}m`;
    }

    // Card del percorso in stile Flighty: codici grandi, linea con l'aereo, dati essenziali
    function renderSummary() {
      const f = App.flight;
      const el = $('flightSummary');
      const I = root.Icons.svg;
      if (!f) {
        el.innerHTML = `<div class="route-empty">${I('plane')}<b>${esc(t('flight.none'))}</b><span>${esc(t('flight.noneSub'))}</span></div>`;
        $('planCard').open = true;
        return;
      }
      const city = (icao, name) => ap(icao).city || (name || '').split(/[\s/-]+/)[0];
      const meta = [];
      if (f.cruise) meta.push(`<span>${esc(t('flight.cruise'))} <b>FL${f.cruise}</b></span>`);
      if (f.aircraft) meta.push(`<span><b>${esc(f.aircraft)}</b>${f.reg ? ` · ${esc(f.reg)}` : ''}</span>`);
      if (f.ete) meta.push(`<span>${esc(t('flight.duration'))} <b>${fmtDur(f.ete)}</b></span>`);
      if (f.pax) meta.push(`<span><b>${f.pax}</b> pax</span>`);
      if (f.depRwy || f.arrRwy) meta.push(`<span>${esc(t('flight.runways'))} <b>${esc([f.depRwy, f.arrRwy].filter(Boolean).join(' → '))}</b></span>`);
      if (f.sid || f.star) meta.push(`<span>${esc([f.sid, f.star].filter(Boolean).join(' / '))}</span>`);
      if (f.fuel) meta.push(`<span>Fuel <b>${esc(f.fuel)}</b> ${esc(f.units || '')}</span>`);
      if (f.altn) meta.push(`<span>Alt. <b>${esc(f.altn)}</b></span>`);
      const pct = App.track && App.track.progress ? Math.round(App.track.progress.pct * 100) : 0;
      el.innerHTML = `
        <div class="route-top"><span class="cs">${esc(f.callsign || '')}</span><span class="badge ai">${esc(f.source || '')}</span></div>
        <div class="route-codes">
          <div class="ap"><b>${esc(f.dep)}</b><span>${esc(city(f.dep, f.depName))}</span></div>
          <div class="route-line" id="routeLine" style="--p: ${pct}%"><div class="done"></div>${I('plane')}</div>
          <div class="ap right"><b>${esc(f.arr)}</b><span>${esc(city(f.arr, f.arrName))}</span></div>
        </div>
        <div class="route-meta">${meta.join('')}</div>
        ${f.route ? `<div class="route-text">${esc(f.route)}</div>` : ''}`;
      $('planCard').open = false;
    }
    let lastEta = 0;
    App.on('track', (e) => {
      const line = document.getElementById('routeLine');
      if (line && e.progress) line.style.setProperty('--p', `${Math.round(e.progress.pct * 100)}%`);
      // la previsione all'arrivo segue l'ETA del tracking (ridisegno solo se cambia di oltre 10 minuti)
      if (e.eta && wx.arr && App.flight && Math.abs(+e.eta - lastEta) > 10 * 60e3) {
        lastEta = +e.eta;
        renderAirport('apArr', t('flight.arr'), App.flight.arr, wx.arr);
      }
    });

    // ------------------------------------------------------------ meteo e ATC

    const feed = (maxAge) => root.Vatsim.feed(maxAge);
    const atcAt = (data, icao) => root.Vatsim.atcAt(data, icao);

    // ------------------------------------------------------------ previsione TAF

    const Z2 = (n) => String(n).padStart(2, '0');
    const zHour = (ms) => `${Z2(new Date(ms).getUTCHours())}Z`;
    const zTime = (ms, refDay) => {
      const d = new Date(ms);
      const hm = `${Z2(d.getUTCHours())}${Z2(d.getUTCMinutes())}Z`;
      return refDay !== undefined && d.getUTCDate() !== refDay ? `${Z2(d.getUTCDate())}/${hm}` : hm;
    };
    // Istante di riferimento: partenza (orario SimBrief se nel futuro) o arrivo (ETA del tracking o orario pianificato)
    function refTime(role) {
      const f = App.flight || {};
      const out = f.out ? f.out * 1000 : null;
      if (role === 'dep') return out && out > Date.now() - 30 * 60e3 ? out : null;
      if (App.track && App.track.eta) return +App.track.eta;
      return out && f.ete ? out + f.ete * 1000 : null;
    }

    function forecastHtml(info, a, role) {
      const Taf = root.Taf;
      const I = root.Icons.svg;
      const head = `<div class="fc-head">${I('calendar-clock')}<b>${esc(t('taf.title'))}</b>`;
      if (info.tafError) return { key: '', body: `<div class="fc">${head}</div><span class="muted">${esc(info.tafError)}</span></div>` };
      const taf = info.taf;
      if (!taf) return { key: '', body: '' };
      if (taf.cancelled || !taf.periods.length) return { key: '', body: `<div class="fc">${head}</div><span class="muted">${esc(t('taf.cancelled'))}</span></div>` };
      const day = new Date(taf.from).getUTCDate();
      let key = '';
      let html = `<div class="fc">${head}<span>${esc(t('taf.valid', { a: zTime(taf.from), b: zTime(taf.to, day) }))}</span></div>`;

      const cond = (c) => c && (c.full || c);
      const ref = refTime(role);
      if (ref) {
        const x = Taf.at(taf, ref);
        const label = t(role === 'arr' ? 'taf.atArr' : 'taf.atDep', { time: zTime(ref) });
        if (!x || !x.inside) key = `<div class="fc-key cat-NA"><div><span class="eyebrow">${esc(label)}</span><span class="fc-desc">${esc(t('taf.outside'))}</span></div></div>`;
        else {
          const icon = Taf.icon(x.main, Taf.isNight(ref, a.lat, a.lon));
          const worse = x.worst && x.worst !== x.main.category ? x.changes.find((c) => c.category === x.worst) : null;
          key = `<div class="fc-key cat-${x.main.category || 'NA'}"><span class="wx-icon">${I(icon)}</span><div><span class="eyebrow">${esc(label)}</span>
            <span class="fc-main"><b>${esc(x.main.category || '—')}</b> ${esc(Taf.windShort(x.main.wind))} · ${esc(Taf.visShort(x.main))}</span>
            ${worse ? `<span class="fc-worse cat-${worse.category}" title="${esc(Taf.describe(cond(worse)))}">${esc(t('taf.possible', { cat: worse.category }))} (${esc(worse.prob ? `PROB${worse.prob}` : worse.kind)})</span>` : ''}
            <span class="fc-desc">${esc(Taf.describe(x.main))}</span></div></div>`;
        }
      }

      // Striscia oraria "da app meteo": ogni 3 ore dall'ora attuale (o dall'inizio della validità)
      const steps = Taf.timeline(taf, Date.now(), 3, 10);
      const near = ref ? steps.reduce((best, s, k) => (Math.abs(s.t - ref) < Math.abs(steps[best].t - ref) ? k : best), 0) : -1;
      if (steps.length) {
        html += `<div class="fc-strip" role="list">${steps.map((s, k) => {
          const night = Taf.isNight(s.t, a.lat, a.lon);
          const tip = [Taf.describe(s.main), ...s.changes.map((c) => `${c.prob ? `PROB${c.prob} ` : ''}${c.tempo || c.kind === 'TEMPO' ? 'TEMPO' : c.kind}: ${Taf.describe(cond(c))}`)].filter(Boolean).join(' · ');
          const worse = s.worst && s.worst !== s.main.category;
          return `<div class="fc-chip cat-${s.main.category || 'NA'}${k === near ? ' ref' : ''}" role="listitem" title="${esc(tip)}">
            <span class="h">${k === 0 && s.t - Date.now() < 3600e3 ? esc(t('taf.now')) : zHour(s.t)}</span>${I(Taf.icon(s.main, night))}
            <b>${esc(Taf.windShort(s.main.wind))}</b><span class="v">${esc(Taf.visShort(s.main))}</span>
            <i class="bar"></i>${worse ? `<em class="dot cat-${s.worst}" aria-label="${esc(t('taf.possible', { cat: s.worst }))}"></em>` : ''}</div>`;
        }).join('')}</div>`;
      }

      // TAF decodificato, gruppo per gruppo
      const line = (p) => {
        const v = { a: zTime(p.from, day), b: zTime(p.to, day), p: p.prob };
        const what = p.kind === 'BASE' ? t('taf.base', v) : p.kind === 'FM' ? t('taf.fm', v) : p.kind === 'BECMG' ? t('taf.becmg', v)
          : p.kind === 'TEMPO' ? t('taf.tempo', v) : (p.tempo ? t('taf.probTempo', v) : t('taf.prob', v));
        const parts = [];
        if (p.wind) parts.push(t('taf.wind', { w: `${Taf.windShort(p.wind)} kt` }));
        if (p.cavok) parts.push('CAVOK');
        else {
          if (p.visibility !== null && p.visibility !== undefined) parts.push(Taf.visShort(p));
          const d = Taf.describe({ wx: p.wx || [], clouds: p.clouds || [] });
          if (d) parts.push(d);
        }
        return `<li><span class="badge cat-${p.category || 'NA'}">${esc(p.category || '—')}</span> <b>${esc(what)}</b>: ${esc(parts.join(', ') || '—')}</li>`;
      };
      html += `<details><summary>${esc(t('taf.decoded'))}</summary><code class="metar">${esc(taf.raw)}</code><ul class="wxLines fcLines">${taf.periods.map(line).join('')}</ul><p class="fc-legend">${esc(t('taf.legend'))}</p></details>`;
      return { key, body: `${html}</div>` };
    }

    // Widget meteo + ATC per un aeroporto
    function renderAirport(elId, title, icao, info) {
      const el = $(elId);
      const I = root.Icons.svg;
      if (!icao) { el.innerHTML = `<div class="wx-head"><div><span class="eyebrow">${esc(title)}</span><b>—</b></div></div><span class="muted">${esc(t('flight.loadAFlight'))}</span>`; return; }
      const a = ap(icao);
      const m = info && info.metar;
      const night = root.Taf.isNight(Date.now(), a.lat, a.lon);
      const nowIcon = m ? root.Taf.icon({ wx: m.wx, clouds: m.clouds, cavok: m.cavok }, night) : null;
      let html = `<div class="wx-head"><div><span class="eyebrow">${esc(title)}</span><b>${esc(icao)}</b><span class="name">${esc(a.name || '')}</span></div>
        <div class="wx-now">${nowIcon ? `<span class="wx-icon">${I(nowIcon)}</span>` : ''}${m && m.category ? `<span class="badge cat-${m.category}">${m.category}</span>` : ''}</div></div>`;
      if (!info) { el.innerHTML = `${html}<span class="muted">${esc(t('flight.pressRefresh'))}</span>`; return; }
      const fc = forecastHtml(info, a, elId === 'apArr' ? 'arr' : 'dep');
      let metarDetails = '';
      if (m) {
        const w = m.wind;
        const wind = !w ? '—' : (w.speed === 0 ? t('wx.calm') : `${w.dir === null ? 'VRB' : String(w.dir).padStart(3, '0')}° / ${w.speed} kt${w.gust ? ` ${t('wx.gustShort')} ${w.gust}` : ''}`);
        const vis = m.cavok ? 'CAVOK' : (m.visibility ? (m.visibility >= 9999 ? '10 km+' : `${m.visibility} m`) : '—');
        html += `<div class="wx-body"><div class="wx-cur"><div class="wx-big"><b>${m.qnh ? m.qnh.hpa : '—'}</b><span>hPa QNH</span></div>
          <div class="wx-line">${I('wind')} ${esc(wind)}</div>
          <div class="wx-line">${I('eye')} ${esc(vis)}${m.temp !== null ? ` · ${I('thermometer')} ${m.temp}°` : ''}</div></div>${fc.key}</div>`;
        metarDetails = `<details><summary>METAR</summary><code class="metar">${esc(m.raw)}</code><ul class="wxLines">${m.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul></details>`;
      } else {
        html += `<span class="muted">${esc(info.metarError || t('flight.noMetar'))}</span>${fc.key}`;
      }
      html += fc.body + metarDetails;
      if (info.atc) {
        const { ctrls, centers, atis } = info.atc;
        const short = (cs) => cs.split('_').pop();
        const chips = [
          ...atis.map((a) => `<span class="freq-chip atis" title="${esc(a.callsign)}">ATIS ${a.atis_code ? `<b>${esc(a.atis_code)}</b>` : ''} ${esc(a.frequency)}</span>`),
          ...ctrls.map((c) => `<span class="freq-chip" title="${esc(c.callsign)}"><b>${esc(c.frequency)}</b> ${esc(short(c.callsign))}</span>`),
          ...centers.slice(0, 2).map((c) => `<span class="freq-chip" title="${esc(c.callsign)} (${esc(t('flight.areaCentre'))})"><b>${esc(c.frequency)}</b> ${esc(c.callsign.split('_')[0])}</span>`),
        ];
        const shown = chips.slice(0, 4);
        if (chips.length > 4) shown.push(`<span class="freq-chip more" title="${esc([...ctrls, ...centers].map((c) => `${c.callsign} ${c.frequency}`).join(' · '))}">+${chips.length - 4}</span>`);
        html += chips.length ? `<div class="freqs">${shown.join('')}</div>` : `<span class="muted">${esc(t('flight.noAtc'))}</span>`;
        for (const a of atis) if (a.text_atis && a.text_atis.length) html += `<details><summary>${esc(t('flight.atisText'))}</summary><p class="atisText">${esc(a.text_atis.join(' '))}</p></details>`;
      } else if (info.atcError) {
        html += `<span class="muted">${esc(info.atcError)}</span>`;
      }
      el.innerHTML = html;
    }

    async function loadAirport(icao) {
      const info = {};
      try {
        const raw = (await root.Net.text(`https://metar.vatsim.net/${icao}`)).trim();
        if (raw) info.metar = root.Metar.decode(raw.split('\n')[0]);
        else info.metarError = t('flight.noMetarHere');
      } catch (e) { info.metarError = t('flight.metarError', { msg: e.message }); }
      try {
        const raw = (await root.Net.text(root.Taf.URL(icao))).trim();
        // la risposta può contenere più TAF o righe a capo: teniamo il primo, su una riga
        const first = raw.split(/\n(?=TAF\b)/)[0].replace(/\s+/g, ' ');
        if (first) info.taf = root.Taf.parse(first.startsWith('TAF') ? first : `TAF ${first}`);
        if (!info.taf) info.tafError = t('taf.none');
      } catch (e) { info.tafError = t('taf.error', { msg: e.message }); }
      try { info.atc = atcAt(await feed(), icao); } catch (e) { info.atcError = t('flight.vatsimError', { msg: e.message }); }
      return info;
    }

    async function refreshWx() {
      const f = App.flight;
      renderSummary();
      if (!f) return;
      $('wxMsg').textContent = t('flight.updating');
      const [dep, arr] = await Promise.all([loadAirport(f.dep), loadAirport(f.arr)]);
      wx = { dep, arr };
      // QNH del METAR, usato dalle verifiche dei readback
      App.wx = { dep: dep.metar && dep.metar.qnh ? dep.metar.qnh.hpa : null, arr: arr.metar && arr.metar.qnh ? arr.metar.qnh.hpa : null, t: Date.now() };
      App.emit('wx', App.wx);
      renderAirport('apDep', t('flight.dep'), f.dep, dep);
      renderAirport('apArr', t('flight.arr'), f.arr, arr);
      const letter = (info) => info && info.atc && info.atc.atis.map((a) => a.atis_code).find(Boolean);
      if (!$('callAtisDep').value && letter(dep)) $('callAtisDep').value = letter(dep);
      if (!$('callAtisArr').value && letter(arr)) $('callAtisArr').value = letter(arr);
      renderCalls();
      $('wxMsg').textContent = `${t('flight.updatedAt', { time: root.I18n.time(Date.now()) })}${root.Net.proxy ? '' : ` ${t('flight.browserLimit')}`}`;
    }
    $('wxRefresh').addEventListener('click', refreshWx);

    // ------------------------------------------------------------ le tue chiamate

    function renderCalls() {
      const f = App.flight || {};
      const cs = App.callsignInfo() || R.parseCallsign('AZA123');
      const city = (icao, name) => ap(icao).city || (name || icao || '…').split(/[\s/-]+/)[0];
      const depCity = city(f.dep, f.depName);
      const arrCity = city(f.arr, f.arrName);
      const acc = ap(f.dep).acc || depCity;
      const stand = S.callStand || '[stand]';
      const atisDep = ($('callAtisDep').value || '').toUpperCase();
      const atisArr = ($('callAtisArr').value || '').toUpperCase();
      const L = (x) => (R.LETTER_WORD[x] ? R.LETTER_WORD[x] : `[${t('calls.atisLetter')}]`);
      const rwy = (r) => (r ? [`runway ${r}`, `runway ${R.spokenRunway(r)}`] : [`runway [${t('calls.runway')}]`, 'runway']);
      const csP = [cs.display, cs.spoken];
      const fl = f.cruise ? [`flight level ${f.cruise}`, R.spokenFL(f.cruise)] : [`flight level [${t('calls.level')}]`, 'flight level'];
      const P = (...segs) => [segs.map((s) => (Array.isArray(s) ? s[0] : s)).join(' '), segs.map((s) => (Array.isArray(s) ? s[1] : s)).join(' ')];

      const calls = [
        ['Delivery', t('calls.delivery'), P(`${depCity} Delivery,`, csP, f.aircraft ? `, ${f.aircraft}` : '', `, stand ${stand}, information`, [L(atisDep), L(atisDep)], `, request IFR clearance to ${f.arrName || f.arr || `[${t('calls.destination')}]`}`)],
        ['Ground', t('calls.push'), P(`${depCity} Ground,`, csP, `, stand ${stand}, request pushback and startup`)],
        ['Ground', t('calls.taxi'), P(`${depCity} Ground,`, csP, ', request taxi')],
        ['Tower', t('calls.ready'), P(`${depCity} Tower,`, csP, ', holding point', rwy(f.depRwy), ', ready for departure')],
        [t('calls.phDeparture'), t('calls.firstDep'), P(`${depCity} Radar,`, csP, `, passing [${t('calls.currentAlt')}], climbing [${t('calls.clearedAlt')}]`)],
        [t('calls.phCruise'), t('calls.firstCtr'), P(`${acc} Control,`, csP, ',', fl)],
        [t('calls.phCruise'), t('calls.descent'), P(csP, ', request descent')],
        [t('calls.phApproach'), t('calls.firstApp'), P(`${arrCity} Approach,`, csP, `, descending [${t('calls.level')}], information`, [L(atisArr), L(atisArr)])],
        ['Tower', t('calls.established'), P(`${arrCity} Tower,`, csP, ', established ILS', rwy(f.arrRwy))],
        ['Ground', t('calls.vacated'), P(`${arrCity} Ground,`, csP, ',', rwy(f.arrRwy), 'vacated, request taxi to stand')],
      ];
      const ol = $('myCalls');
      ol.innerHTML = '';
      for (const [phase, what, [text, spoken]] of calls) {
        const clean = (s) => s.replace(/\s+,/g, ',').replace(/\s+/g, ' ').trim();
        const li = document.createElement('li');
        li.innerHTML = `<div class="callHead"><span class="badge muted">${esc(phase)}</span> <span class="hint">${esc(what)}</span></div><div class="callText">${esc(clean(text))}</div>`;
        const b = document.createElement('button');
        b.className = 'icon-btn';
        b.innerHTML = root.Icons.svg('volume-2');
        b.title = t('common.listen');
        b.addEventListener('click', () => root.TTS.speak(clean(spoken).replace(/\[[^\]]*\]/g, '')));
        li.querySelector('.callHead').append(b);
        ol.append(li);
      }
    }
    for (const id of ['callStand', 'callAtisDep', 'callAtisArr']) $(id).addEventListener('input', renderCalls);
    App.on('setting:callsign', renderCalls);
    App.on('setting:telephony', renderCalls);
    App.on('flight', () => { renderSummary(); renderCalls(); });

    // ------------------------------------------------------------ tu su VATSIM

    $('vatsimMe').addEventListener('click', async () => {
      const out = $('vatsimMeOut');
      const cs = App.callsignInfo();
      if (!cs) { out.textContent = t('flight.setCallsign'); return; }
      out.textContent = t('flight.searching');
      try {
        const data = await feed(0);
        const me = root.Vatsim.pilot(data, cs.code);
        if (!me) { out.textContent = t('flight.notConnected', { cs: cs.code }); return; }
        const fp = me.flight_plan || {};
        const assigned = fp.assigned_transponder && fp.assigned_transponder !== '0000' ? fp.assigned_transponder : null;
        const sqWarn = assigned && assigned !== me.transponder ? `<li class="warnLine">⚠️ ${esc(t('flight.sqWrong', { set: me.transponder, assigned }))}</li>` : '';
        out.innerHTML = `<ul class="wxLines">
          <li>✅ ${esc(t('flight.connectedAs'))} <b>${esc(me.callsign)}</b> ${fp.departure ? `(${esc(fp.departure)} → ${esc(fp.arrival)})` : `(${esc(t('flight.noFp'))})`}</li>
          <li>${esc(t('flight.meLine', { alt: me.altitude, gs: me.groundspeed, hdg: me.heading }))}</li>
          <li>Transponder ${esc(me.transponder)}${assigned ? ` · ${esc(t('flight.assigned'))} ${esc(assigned)}` : ''} · ${esc(t('flight.qnhSet', { qnh: me.qnh_mb }))}</li>
          ${sqWarn}
        </ul>`;
      } catch (e) {
        out.textContent = t('flight.vatsimError', { msg: e.message });
      }
    });

    renderSummary();
    renderCalls();
    renderAirport('apDep', t('flight.dep'), App.flight && App.flight.dep, null);
    renderAirport('apArr', t('flight.arr'), App.flight && App.flight.arr, null);
    App.on('tab', (id) => { if (id === 'flight' && App.flight && !wx.dep) refreshWx(); });
  });
})(this);
