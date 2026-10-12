/* Logbook: registra da solo i voli dal tracking (off-block, decollo, atterraggio, on-block)
   e permette di aggiungerli/modificarli a mano. Visualizzato in Cockpit › Logbook. */
(function (root) {
  'use strict';

  const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const minutes = (a, b) => (a && b ? Math.max(0, Math.round((b - a) / 60000)) : null);
  const hhmm = (min) => (min === null || min === undefined ? '—' : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`);
  const time = (t) => (t ? new Date(t).toLocaleTimeString('it-IT', { hour: '2-digit', minute: '2-digit' }) : '—');
  const euro = (v) => (Number(v) || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

  root.App.register((App) => {
    const $ = App.$;
    const KEY = 'readback-copilot-logbook';
    const CUR = 'readback-copilot-current-log';
    let list = App.storage.get(KEY, []);
    let current = App.storage.get(CUR, null);
    const save = () => { App.storage.set(KEY, list); App.storage.set(CUR, current); };

    function ensureCurrent() {
      const f = App.flight || {};
      const cs = App.callsignInfo();
      if (!current || current.dep !== f.dep || current.arr !== f.arr) {
        current = { id: `f${Date.now()}`, date: new Date().toISOString().slice(0, 10), callsign: cs ? cs.code : '', dep: f.dep || '', arr: f.arr || '', aircraft: f.aircraft || App.settings.aircraft, auto: true };
      }
      return current;
    }

    function finish() {
      if (!current) return;
      current.blockMin = minutes(current.offBlock, current.onBlock);
      current.airMin = minutes(current.takeoff, current.landing);
      list.unshift(current);
      App.toast(`Volo ${current.dep} → ${current.arr} registrato nel logbook (${hhmm(current.blockMin || current.airMin)}).`, 5000);
      current = null;
      save();
      render();
    }

    App.on('track', (e) => {
      if (!e.events || !e.events.length) return;
      const c = ensureCurrent();
      for (const ev of e.events) c[ev] = e.t;
      save();
      if (e.events.includes('onBlock')) finish();
    });

    App.on('cabin-summary', (sum) => {
      const target = current || list[0];
      if (!target) return;
      target.revenue = sum.revenue;
      target.sold = sum.sold;
      save();
      render();
    });

    function render() {
      const totBlock = list.reduce((n, x) => n + (x.blockMin || x.airMin || 0), 0);
      const totAir = list.reduce((n, x) => n + (x.airMin || 0), 0);
      const totRev = list.reduce((n, x) => n + (Number(x.revenue) || 0), 0);
      $('logStats').innerHTML = `
        <div><span>Voli</span><b>${list.length}</b></div>
        <div><span>Ore blocco</span><b>${hhmm(totBlock)}</b></div>
        <div><span>Ore volo</span><b>${hhmm(totAir)}</b></div>
        <div><span>Incasso bordo</span><b>${euro(totRev)}</b></div>`;
      const ol = $('logList');
      ol.innerHTML = '';
      if (current && (current.offBlock || current.takeoff)) {
        const li = document.createElement('li');
        li.className = 'log-item';
        li.innerHTML = `<div class="route-line">${esc(current.dep)} → ${esc(current.arr)} <span class="badge ai">in corso</span></div>
          <div class="meta">Off-block ${time(current.offBlock)} · Decollo ${time(current.takeoff)}</div>`;
        ol.append(li);
      }
      if (!list.length && !ol.children.length) { ol.innerHTML = '<li class="empty">Nessun volo registrato. Con "Segui il volo" nella scheda Volo i voli si registrano da soli.</li>'; return; }
      for (const x of list) {
        const li = document.createElement('li');
        li.className = 'log-item';
        li.innerHTML = `<div class="route-line">${esc(x.dep)} → ${esc(x.arr)} <span class="hint">${esc(x.callsign || '')} · ${esc(x.aircraft || '')}</span></div>
          <div class="meta">${esc(new Date(x.date).toLocaleDateString('it-IT'))} · Blocco ${hhmm(x.blockMin)} · Volo ${hhmm(x.airMin)} · Off ${time(x.offBlock)} · On ${time(x.onBlock)}${x.revenue ? ` · Bordo ${euro(x.revenue)}` : ''}${x.auto ? '' : ' · inserito a mano'}</div>
          ${x.notes ? `<div class="meta">${esc(x.notes)}</div>` : ''}
          <div class="actions"><button class="icon-btn" data-del="${esc(x.id)}" title="Elimina">${root.Icons.svg('trash-2')}</button></div>`;
        ol.append(li);
      }
      ol.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => {
        if (!confirm('Eliminare questo volo dal logbook?')) return;
        list = list.filter((x) => x.id !== b.dataset.del);
        save();
        render();
      }));
    }

    $('logAdd').addEventListener('click', () => {
      const f = App.flight || {};
      const route = prompt('Rotta (es. LIRF-LIMC):', f.dep && f.arr ? `${f.dep}-${f.arr}` : '');
      if (!route) return;
      const [dep, arr] = route.toUpperCase().split(/[\s-]+/);
      const dur = prompt('Durata del volo (ore:minuti, es. 1:10):', '1:00') || '';
      const m = dur.match(/^(\d{1,2})[:.](\d{2})$/);
      const mins = m ? Number(m[1]) * 60 + Number(m[2]) : null;
      const cs = App.callsignInfo();
      list.unshift({ id: `m${Date.now()}`, date: new Date().toISOString().slice(0, 10), callsign: cs ? cs.code : '', dep: dep || '', arr: arr || '', aircraft: f.aircraft || App.settings.aircraft, blockMin: mins, airMin: mins, auto: false });
      save();
      render();
    });

    $('logExport').addEventListener('click', async () => {
      if (!list.length) { App.toast('Il logbook è vuoto.'); return; }
      const head = 'data;nominativo;partenza;arrivo;aereo;off_block;decollo;atterraggio;on_block;ore_blocco;ore_volo;incasso_bordo;venduti';
      const iso = (t) => (t ? new Date(t).toISOString().slice(11, 16) : '');
      const rows = list.map((x) => [x.date, x.callsign, x.dep, x.arr, x.aircraft, iso(x.offBlock), iso(x.takeoff), iso(x.landing), iso(x.onBlock), hhmm(x.blockMin), hhmm(x.airMin), (Number(x.revenue) || 0).toFixed(2).replace('.', ','), x.sold || ''].join(';'));
      const ok = await App.desktop.saveText(`logbook-${new Date().toISOString().slice(0, 10)}.csv`, [head, ...rows].join('\n'));
      if (ok) App.toast('Logbook esportato.');
    });

    render();
  });
})(this);
