/* Scheda Volo: piano di volo SimBrief, meteo, ATC online su VATSIM e le chiamate da fare. */
(function (root) {
  'use strict';

  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  root.App.register((App) => {
    const $ = App.$;
    const S = App.settings;
    const R = root.Readback;
    const AIRPORTS = root.Scenarios.AIRPORTS;
    let wx = { dep: null, arr: null };

    // ------------------------------------------------------------ SimBrief

    $('simbriefLoad').addEventListener('click', async () => {
      const user = (S.simbriefUser || '').trim();
      const msg = $('simbriefMsg');
      if (!user) { msg.textContent = 'Scrivi il tuo nome utente SimBrief.'; return; }
      msg.textContent = 'Carico da SimBrief…';
      const param = /^\d+$/.test(user) ? `userid=${user}` : `username=${encodeURIComponent(user)}`;
      try {
        const j = await root.Net.json(`https://www.simbrief.com/api/xml.fetcher.php?${param}&json=1`);
        const f = root.SimBrief.parse(j);
        App.setFlight(f);
        if (f.callsign) App.set('callsign', f.callsign);
        msg.textContent = `✅ Caricato: ${f.callsign} ${f.dep} → ${f.arr}. Il nominativo è stato impostato.`;
        refreshWx();
      } catch (e) {
        msg.textContent = `❌ ${e.message}${root.Net.proxy ? '' : ' (nel browser SimBrief può essere bloccato: usa il programma per Windows)'}`;
      }
    });

    $('manUse').addEventListener('click', () => {
      const dep = $('manDep').value.trim().toUpperCase();
      const arr = $('manArr').value.trim().toUpperCase();
      if (!/^[A-Z]{4}$/.test(dep) || !/^[A-Z]{4}$/.test(arr)) { App.toast('Inserisci due codici ICAO di 4 lettere (es. LIRF e LIMC).'); return; }
      const fl = Number($('manFl').value) || null;
      App.setFlight({
        source: 'manuale', callsign: (App.callsignInfo() || {}).code || '',
        dep, depName: (AIRPORTS[dep] || {}).name || dep, arr, arrName: (AIRPORTS[arr] || {}).name || arr, cruise: fl,
        pax: Number($('manPax').value) || null, aircraft: App.settings.aircraft,
      });
      refreshWx();
    });

    function fmtDur(sec) {
      if (!sec) return '–';
      return `${Math.floor(sec / 3600)}h ${String(Math.round((sec % 3600) / 60)).padStart(2, '0')}m`;
    }

    function renderSummary() {
      const f = App.flight;
      const el = $('flightSummary');
      if (!f) { el.innerHTML = ''; return; }
      const cell = (label, value) => (value ? `<div><span>${label}</span><b>${esc(value)}</b></div>` : '');
      el.innerHTML = `
        <div class="fs-head"><b>${esc(f.callsign || '')}</b> ${esc(f.dep)} → ${esc(f.arr)} <span class="hint">(${esc(f.source)})</span></div>
        <div class="fs-grid">
          ${cell('Partenza', `${f.dep} ${f.depName || ''}`)}
          ${cell('Arrivo', `${f.arr} ${f.arrName || ''}`)}
          ${cell('Alternato', f.altn)}
          ${cell('Aereo', [f.aircraft, f.reg].filter(Boolean).join(' · '))}
          ${cell('Crociera', f.cruise ? `FL${f.cruise}` : '')}
          ${cell('Piste previste', [f.depRwy, f.arrRwy].filter(Boolean).join(' → '))}
          ${cell('SID / STAR', [f.sid, f.star].filter(Boolean).join(' / '))}
          ${cell('Durata', f.ete ? fmtDur(f.ete) : '')}
          ${cell('Carburante', f.fuel ? `${f.fuel} ${f.units}` : '')}
          ${cell('ZFW / TOW', f.zfw ? `${f.zfw} / ${f.tow} ${f.units}` : '')}
        </div>
        ${f.route ? `<div class="route"><span>Rotta</span><code>${esc(f.route)}</code></div>` : ''}`;
    }

    // ------------------------------------------------------------ meteo e ATC

    const feed = (maxAge) => root.Vatsim.feed(maxAge);
    const atcAt = (data, icao) => root.Vatsim.atcAt(data, icao);

    function renderAirport(elId, title, icao, info) {
      const el = $(elId);
      if (!icao) { el.innerHTML = `<h3>${title}</h3><p class="hint">Carica un piano di volo.</p>`; return; }
      const ap = AIRPORTS[icao];
      let html = `<h3>${title} · ${esc(icao)} <span class="hint">${esc(ap ? ap.name : '')}</span>`;
      if (info && info.metar && info.metar.category) html += ` <span class="badge cat-${info.metar.category}">${info.metar.category}</span>`;
      html += '</h3>';
      if (!info) { el.innerHTML = `${html}<p class="hint">Premi "Aggiorna meteo e ATC".</p>`; return; }
      if (info.metar) {
        html += `<code class="metar">${esc(info.metar.raw)}</code><ul class="wxLines">${info.metar.lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>`;
      } else {
        html += `<p class="hint">${esc(info.metarError || 'METAR non disponibile.')}</p>`;
      }
      if (info.atc) {
        const { ctrls, centers, atis } = info.atc;
        if (ctrls.length || atis.length) {
          html += '<div class="label">ATC online su VATSIM</div><ul class="atcList">';
          for (const c of ctrls) html += `<li><b>${esc(c.frequency)}</b> ${esc(root.Vatsim.FACILITY[c.facility] || '')} <span class="hint">${esc(c.callsign)}</span></li>`;
          for (const a of atis) html += `<li><b>${esc(a.frequency)}</b> ATIS ${a.atis_code ? `<span class="badge ai">${esc(a.atis_code)}</span>` : ''} <span class="hint">${esc(a.callsign)}</span></li>`;
          html += '</ul>';
          for (const a of atis) {
            if (a.text_atis && a.text_atis.length) html += `<details><summary class="hint">Testo ATIS</summary><p class="atisText">${esc(a.text_atis.join(' '))}</p></details>`;
          }
        } else {
          html += '<p class="hint">Nessun controllore online in questo aeroporto: su VATSIM si usa <b>UNICOM 122.800</b> (via messaggi di testo) per annunciare le proprie intenzioni.</p>';
        }
        if (centers.length) html += `<div class="label">Centri in zona (indicativo)</div><ul class="atcList">${centers.map((c) => `<li><b>${esc(c.frequency)}</b> <span class="hint">${esc(c.callsign)}</span></li>`).join('')}</ul>`;
      } else if (info.atcError) {
        html += `<p class="hint">${esc(info.atcError)}</p>`;
      }
      el.innerHTML = html;
    }

    async function loadAirport(icao) {
      const info = {};
      try {
        const raw = (await root.Net.text(`https://metar.vatsim.net/${icao}`)).trim();
        if (raw) info.metar = root.Metar.decode(raw.split('\n')[0]);
        else info.metarError = 'Nessun METAR per questo aeroporto.';
      } catch (e) { info.metarError = `METAR non disponibile: ${e.message}`; }
      try { info.atc = atcAt(await feed(), icao); } catch (e) { info.atcError = `Dati VATSIM non disponibili: ${e.message}`; }
      return info;
    }

    async function refreshWx() {
      const f = App.flight;
      renderSummary();
      if (!f) return;
      $('wxMsg').textContent = 'Aggiorno…';
      const [dep, arr] = await Promise.all([loadAirport(f.dep), loadAirport(f.arr)]);
      wx = { dep, arr };
      // QNH del METAR, usato dalle verifiche dei readback
      App.wx = { dep: dep.metar && dep.metar.qnh ? dep.metar.qnh.hpa : null, arr: arr.metar && arr.metar.qnh ? arr.metar.qnh.hpa : null, t: Date.now() };
      App.emit('wx', App.wx);
      renderAirport('apDep', 'Partenza', f.dep, dep);
      renderAirport('apArr', 'Arrivo', f.arr, arr);
      const letter = (info) => info && info.atc && info.atc.atis.map((a) => a.atis_code).find(Boolean);
      if (!$('callAtisDep').value && letter(dep)) $('callAtisDep').value = letter(dep);
      if (!$('callAtisArr').value && letter(arr)) $('callAtisArr').value = letter(arr);
      renderCalls();
      $('wxMsg').textContent = `Aggiornato alle ${new Date().toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' })}${root.Net.proxy ? '' : ' (nel browser alcuni dati possono essere bloccati: il programma per Windows non ha questo limite)'}`;
    }
    $('wxRefresh').addEventListener('click', refreshWx);

    // ------------------------------------------------------------ le tue chiamate

    function renderCalls() {
      const f = App.flight || {};
      const cs = App.callsignInfo() || R.parseCallsign('AZA123');
      const city = (icao, name) => (AIRPORTS[icao] ? AIRPORTS[icao].city : (name || icao || '…').split(/[\s/-]+/)[0]);
      const depCity = city(f.dep, f.depName);
      const arrCity = city(f.arr, f.arrName);
      const acc = (AIRPORTS[f.dep] || {}).acc || depCity;
      const stand = S.callStand || '[stand]';
      const atisDep = ($('callAtisDep').value || '').toUpperCase();
      const atisArr = ($('callAtisArr').value || '').toUpperCase();
      const L = (x) => (R.LETTER_WORD[x] ? R.LETTER_WORD[x] : '[lettera ATIS]');
      const rwy = (r) => (r ? [`runway ${r}`, `runway ${R.spokenRunway(r)}`] : ['runway [pista]', 'runway']);
      const csP = [cs.display, cs.spoken];
      const fl = f.cruise ? [`flight level ${f.cruise}`, R.spokenFL(f.cruise)] : ['flight level [livello]', 'flight level'];
      const P = (...segs) => [segs.map((s) => (Array.isArray(s) ? s[0] : s)).join(' '), segs.map((s) => (Array.isArray(s) ? s[1] : s)).join(' ')];

      const calls = [
        ['Delivery', 'Chiedi l\'autorizzazione IFR (dopo aver ascoltato l\'ATIS)', P(`${depCity} Delivery,`, csP, f.aircraft ? `, ${f.aircraft}` : '', `, stand ${stand}, information`, [L(atisDep), L(atisDep)], `, request IFR clearance to ${f.arrName || f.arr || '[destinazione]'}`)],
        ['Ground', 'Chiedi push e accensione motori', P(`${depCity} Ground,`, csP, `, stand ${stand}, request pushback and startup`)],
        ['Ground', 'Chiedi il rullaggio', P(`${depCity} Ground,`, csP, ', request taxi')],
        ['Tower', 'Al punto attesa, pronto a partire', P(`${depCity} Tower,`, csP, ', holding point', rwy(f.depRwy), ', ready for departure')],
        ['Partenza', 'Primo contatto dopo il decollo', P(`${depCity} Radar,`, csP, ', passing [quota attuale], climbing [quota autorizzata]')],
        ['Crociera', 'Primo contatto col centro', P(`${acc} Control,`, csP, ',', fl)],
        ['Crociera', 'Chiedi di scendere (circa 100 NM prima)', P(csP, ', request descent')],
        ['Avvicinamento', 'Primo contatto con l\'avvicinamento', P(`${arrCity} Approach,`, csP, ', descending [livello], information', [L(atisArr), L(atisArr)])],
        ['Tower', 'Stabilizzato sull\'ILS', P(`${arrCity} Tower,`, csP, ', established ILS', rwy(f.arrRwy))],
        ['Ground', 'Pista liberata', P(`${arrCity} Ground,`, csP, ',', rwy(f.arrRwy), 'vacated, request taxi to stand')],
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
        b.title = 'Ascolta';
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
      if (!cs) { out.textContent = 'Imposta prima il tuo nominativo (scheda Ascolto).'; return; }
      out.textContent = 'Cerco…';
      try {
        const data = await feed(0);
        const me = root.Vatsim.pilot(data, cs.code);
        if (!me) { out.textContent = `Non risulti connesso come ${cs.code}. Controlla di aver usato lo stesso nominativo in vPilot.`; return; }
        const fp = me.flight_plan || {};
        const assigned = fp.assigned_transponder && fp.assigned_transponder !== '0000' ? fp.assigned_transponder : null;
        const sqWarn = assigned && assigned !== me.transponder ? `<li class="warnLine">⚠️ Squawk impostato ${esc(me.transponder)} ma assegnato ${esc(assigned)}: correggilo!</li>` : '';
        out.innerHTML = `<ul class="wxLines">
          <li>✅ Connesso come <b>${esc(me.callsign)}</b> ${fp.departure ? `(${esc(fp.departure)} → ${esc(fp.arrival)})` : '(nessun piano di volo inviato)'}</li>
          <li>Quota ${esc(me.altitude)} ft · velocità al suolo ${esc(me.groundspeed)} kt · prua ${esc(me.heading)}°</li>
          <li>Transponder ${esc(me.transponder)}${assigned ? ` · assegnato ${esc(assigned)}` : ''} · QNH impostato ${esc(me.qnh_mb)} hPa</li>
          ${sqWarn}
        </ul>`;
      } catch (e) {
        out.textContent = `Dati VATSIM non disponibili: ${e.message}`;
      }
    });

    renderSummary();
    renderCalls();
    if (App.flight) {
      renderAirport('apDep', 'Partenza', App.flight.dep, null);
      renderAirport('apArr', 'Arrivo', App.flight.arr, null);
    }
    App.on('tab', (id) => { if (id === 'flight' && App.flight && !wx.dep) refreshWx(); });
  });
})(this);
