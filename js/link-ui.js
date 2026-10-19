/* Collegamento PC ↔ telefono in Wi-Fi.
   Sul PC (programma per Windows): Impostazioni › Telefono mostra il QR e pubblica al telefono readback,
   prossima chiamata, simulatore, rullaggio, volo e atterraggio; esegue i comandi che arrivano.
   Sul telefono (app o pagina web): Altro › Collega al PC, inquadra il QR o scrivi indirizzo e codice. */
(function (root) {
  'use strict';

  root.App.register((App) => {
    const $ = App.$;
    const S = App.settings;
    const t = App.t;
    const bridge = root.desktop && root.desktop.link;
    const esc = (s) => String(s === undefined || s === null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const fmtCode = (c) => String(c || '').replace(/^(.{5})(.+)$/, '$1-$2');
    document.body.classList.toggle('has-link-host', !!bridge);

    // Readback ridotto all'essenziale (niente audio) per il telefono
    const slim = (item) => ({
      heard: item.heard, ts: item.ts, verify: item.verify ? { status: item.verify.status, reasons: (item.verify.reasons || []).map((r) => ({ text: r.text })) } : null,
      result: { readback: item.result.readback, spoken: item.result.spoken, forUs: item.result.forUs, source: item.result.source, parts: (item.result.parts || []).map((p) => ({ type: p.type, display: p.display })) },
    });
    const FLIGHT_KEYS = ['source', 'dep', 'arr', 'depName', 'arrName', 'depRwy', 'arrRwy', 'sid', 'star', 'cruise', 'route', 'fixes', 'aircraft', 'callsign', 'pax', 'fuelPlan', 'depPos', 'arrPos', 'altn'];
    const slimFlight = (f) => (f ? Object.fromEntries(FLIGHT_KEYS.filter((k) => f[k] !== undefined).map((k) => [k, f[k]])) : null);

    // =================================================================== PC
    if (bridge) {
      let info = null;
      const publish = (type, data) => { if (info) bridge.publish(type, data); };

      async function showInfo(i) {
        info = i;
        $('linkBox').hidden = !i;
        if (!i) return;
        const host = `${i.addresses[0] || '127.0.0.1'}:${i.port}`;
        const url = `http://${host}/#pair=${i.token}&n=${encodeURIComponent(i.name || '')}`;
        const qr = root.qrcode(0, 'M');
        qr.addData(url);
        qr.make();
        $('linkQr').innerHTML = qr.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
        $('linkAddr').textContent = i.addresses.length ? i.addresses.map((a) => `${a}:${i.port}`).join(' · ') : t('link.noLan');
        $('linkCode').textContent = fmtCode(i.token);
        $('linkStatus').textContent = i.connected ? t('link.phoneOn', { n: i.connected }) : t('link.waiting');
        $('linkStatus').classList.toggle('on', !!i.connected);
        publishAll();
      }

      // Stato completo (il telefono appena collegato riceve l'ultimo di ogni tipo)
      function publishAll() {
        publish('flight', slimFlight(App.flight));
        publish('listening', !!(App.isListening && App.isListening()));
        publishSim();
        if (App.career) publish('career', App.career.summary());
      }
      let simTimer = 0;
      function publishSim() {
        const s = App.sim ? App.sim() : null;
        if (!s) return;
        const d = s.data || {};
        publish('sim', { status: s.status, checks: (App.simChecks || []).filter((c) => c.status !== 'wait'), landing: App.lastLanding || null, data: { lat: d.lat, lon: d.lon, alt: d.alt, hdg: d.hdg, vs: d.vs, onGround: d.onGround, com1: d.com1, xpdr: d.xpdr } });
      }

      App.on('setting:phoneLink', async (on) => showInfo(await bridge.enable(!!on)));
      if (S.phoneLink) bridge.enable(true).then(showInfo).catch(() => {});
      $('linkRegen').addEventListener('click', async () => { if (confirm(t('link.regenConfirm'))) showInfo(await bridge.regenerate()); });
      setInterval(async () => {
        if (!info) return;
        const i = await bridge.info();
        if (i && i.connected !== info.connected) showInfo(i);
        // dati del simulatore al massimo una volta al secondo
        if (Date.now() - simTimer > 1000) { simTimer = Date.now(); publishSim(); }
      }, 1500);

      App.on('readback', (item) => { if (item && item.result && item.origin !== 'prova') publish('readback', slim(item)); });
      App.on('next-call', (c) => publish('next', c ? { key: c.key, station: c.station, freq: c.freq, text: c.text, spoken: c.spoken } : null));
      App.on('listening', (on) => publish('listening', !!on));
      App.on('ptt', (down) => publish('tx', !!down));
      App.on('flight', (f) => publish('flight', slimFlight(f)));
      App.on('landing', () => publishSim());
      App.on('taxi', (e) => publish('taxi', e && e.route && e.route.ok ? { plan: e.plan, route: { ok: true, points: e.route.points, crossings: e.route.crossings, length: e.route.length, missing: e.route.missing } } : null));
      App.on('career', (sum) => publish('career', sum));

      // Comandi dal telefono: gli stessi delle scorciatoie da tastiera
      bridge.onCommand(({ cmd, data }) => {
        if (['toggle-listen', 'speak', 'replay', 'replay-slow', 'next-done'].includes(cmd)) App.emit('hotkey', cmd);
        if (cmd === 'flight' && data && data.dep && data.arr) { App.setFlight({ ...data, source: data.source || 'phone' }); App.toast(t('link.flightFromPhone', { dep: data.dep, arr: data.arr })); }
        if (cmd === 'sync' && data) {
          if (App.career && data.career) App.career.merge(data.career);
          if (App.logbook && data.logbook) App.logbook.merge(data.logbook);
          publish('sync-data', { career: App.career ? App.career.state() : null, logbook: App.logbook ? App.logbook.list() : [] });
        }
      });
      return;
    }

    // =================================================================== TELEFONO
    let since = 0;
    let running = false;
    let status = 'off'; // off | connecting | on | lost
    let pcName = '';
    let last = { next: null, listening: false };

    // Pagina aperta dal QR (versione web servita dal PC): abbinamento automatico
    const m = /[#&]pair=([0-9A-Za-z-]+)/.exec(location.hash || '');
    if (m) {
      App.set('linkHost', location.host);
      App.set('linkToken', m[1]);
      const n = /[#&]n=([^&]*)/.exec(location.hash);
      if (n) App.set('linkName', decodeURIComponent(n[1]));
      history.replaceState(null, '', location.pathname);
    }

    const base = () => `http://${S.linkHost}`;
    async function call(pathname, opts) {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), (opts && opts.timeout) || 35000);
      try {
        const r = await fetch(`${base()}${pathname}`, { ...(opts || {}), headers: { 'X-Link-Token': S.linkToken, 'Content-Type': 'application/json', ...((opts && opts.headers) || {}) }, signal: ctrl.signal, cache: 'no-store' });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) { const e = new Error((body.error && body.error.message) || `HTTP ${r.status}`); e.status = r.status; throw e; }
        return body;
      } finally { clearTimeout(timer); }
    }
    const command = (cmd, data) => call('/link/command', { method: 'POST', body: JSON.stringify({ cmd, data }), timeout: 8000 }).catch((e) => App.toast(t('link.cmdFail', { msg: e.message })));

    function setStatus(s, msg) {
      status = s;
      document.body.classList.toggle('pc-linked', s === 'on');
      App.emit('link', s);
      renderPanel(msg);
    }

    function apply(ev) {
      const d = ev.data;
      switch (ev.type) {
        case 'readback': if (d && App.showRemoteReadback) App.showRemoteReadback(d); break;
        case 'next': last.next = d; break;
        case 'listening': last.listening = !!d; break;
        case 'tx': document.body.classList.toggle('pc-tx', !!d); break;
        case 'sim': if (App.setRemoteSim) App.setRemoteSim(d); break;
        case 'taxi': if (App.drawRemoteTaxi) { if (d) App.drawRemoteTaxi(d.plan, d.route); else if (App.clearTaxi) App.clearTaxi(); } break;
        case 'flight': if (d && d.dep && d.arr && (!App.flight || App.flight.dep !== d.dep || App.flight.arr !== d.arr)) App.setFlight({ ...d, source: 'pc' }); break;
        case 'sync-data':
          if (App.career && d && d.career) App.career.merge(d.career);
          if (App.logbook && d && d.logbook) App.logbook.merge(d.logbook);
          break;
        default: break;
      }
    }

    async function loop() {
      if (running) return;
      running = true;
      since = 0;
      let fails = 0;
      setStatus('connecting');
      try {
        const ping = await call('/link/ping', { timeout: 6000 });
        pcName = ping.name || S.linkName || 'PC';
      } catch (e) { /* si riprova nel ciclo */ }
      while (running && S.linkHost && S.linkToken) {
        try {
          const r = await call(`/link/events?since=${since}&wait=${since ? 25000 : 0}`);
          if (status !== 'on') { setStatus('on'); sync(); }
          fails = 0;
          for (const ev of [...(r.state || []), ...(r.events || [])]) { try { apply(ev); } catch (err) { console.error(err); } }
          since = r.seq;
          renderPanel();
        } catch (e) {
          if (!running) break;
          if (e.status === 401) { running = false; setStatus('off', t('link.badCode')); break; }
          fails++;
          setStatus('lost', e.message);
          await new Promise((res) => setTimeout(res, Math.min(15000, 1000 * 2 ** Math.min(fails, 4))));
          since = 0;
        }
      }
      running = false;
    }
    function stop() { running = false; setStatus('off'); }

    // Carriera e logbook uniti nei due sensi
    function sync() {
      command('sync', { career: App.career ? App.career.state() : null, logbook: App.logbook ? App.logbook.list() : [] });
    }

    function renderPanel(msg) {
      const paired = !!(S.linkHost && S.linkToken);
      $('pcPair').hidden = paired && status !== 'off';
      $('pcLive').hidden = !paired || status === 'off';
      const st = $('pcState');
      st.className = `badge ${status === 'on' ? 'ok' : status === 'lost' ? 'no' : 'muted'}`;
      st.textContent = status === 'on' ? t('link.on', { name: pcName || S.linkName || 'PC' }) : status === 'lost' ? t('link.lost') : status === 'connecting' ? t('link.connecting') : t('link.off');
      $('pcMsg').textContent = msg || '';
      const n = last.next;
      $('pcNext').hidden = !n;
      if (n) { $('pcNextText').textContent = n.text; $('pcNextFreq').textContent = n.freq ? `${n.station} ${n.freq}` : ''; $('pcNextFreq').hidden = !n.freq; }
      $('pcListen').classList.toggle('on', last.listening);
      $('pcListen').querySelector('span').textContent = t(last.listening ? 'link.stopListen' : 'link.startListen');
    }

    async function connect(host, token) {
      const h = String(host || '').trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
      const tk = String(token || '').trim();
      if (!h || !tk) { App.toast(t('link.fill')); return; }
      App.set('linkHost', /:\d+$/.test(h) ? h : `${h}:47810`);
      App.set('linkToken', tk);
      running = false;
      loop();
    }
    // Indirizzo del QR: http://IP:PORTA/#pair=CODICE&n=NOME
    function fromUrl(text) {
      try {
        const u = new URL(text);
        const tk = /pair=([0-9A-Za-z-]+)/.exec(u.hash);
        const n = /[#&]n=([^&]*)/.exec(u.hash);
        if (!tk) return false;
        if (n) App.set('linkName', decodeURIComponent(n[1]));
        connect(u.host, tk[1]);
        return true;
      } catch (e) { return false; }
    }

    $('pcConnect').addEventListener('click', () => connect($('pcHost').value, $('pcCode').value));
    $('pcScan').hidden = !(App.native && App.native.scanQr);
    $('pcScan').addEventListener('click', async () => {
      try {
        const text = await App.native.scanQr();
        if (text && !fromUrl(text)) App.toast(t('link.badQr'));
      } catch (e) { App.toast(e.message); }
    });
    $('pcUnpair').addEventListener('click', () => { stop(); App.set('linkToken', ''); renderPanel(); });
    $('pcListen').addEventListener('click', () => command('toggle-listen'));
    $('pcReplay').addEventListener('click', () => command('replay'));
    $('pcReplaySlow').addEventListener('click', () => command('replay-slow'));
    $('pcSpeak').addEventListener('click', () => command('speak'));
    $('pcNextDone').addEventListener('click', () => command('next-done'));
    $('pcSendFlight').addEventListener('click', () => {
      if (!App.flight) { App.toast(t('rehearsal.noFlight')); return; }
      command('flight', slimFlight(App.flight)).then(() => App.toast(t('link.flightSent')));
    });
    $('pcSync').addEventListener('click', () => { sync(); App.toast(t('link.synced')); });
    App.linkStatus = () => status;
    renderPanel();
    if (S.linkHost && S.linkToken) loop();
  });
})(this);
