/* Collegamento al simulatore nell'interfaccia: stato nell'HUD, verifiche delle istruzioni ATC
   (squawk, frequenza, QNH, livello, prua) e avviso nella Live Activity quando qualcosa non torna. */
(function (root) {
  'use strict';

  root.App.register((App) => {
    const $ = App.$;
    const S = App.settings;
    const t = App.t;
    const C = root.Compliance;
    const bridge = App.desktop.sim;
    let state = C.emptyState();
    let sim = null;
    let status = 'off';
    const warned = new Set();

    function setStatus(s) {
      status = s;
      $('simStatusText').textContent = bridge ? t(`sim.${s}`) : t('sim.onlyDesktop');
      render();
    }

    function render() {
      const row = $('simRow');
      const connected = status === 'msfs' || status === 'xplane';
      row.hidden = !bridge || status === 'off';
      row.classList.toggle('on', connected);
      $('simLabel').textContent = t(`sim.${status}`);
      const checks = connected && sim ? C.check(state, sim, Date.now()) : [];
      const box = $('simChecks');
      box.innerHTML = '';
      if (App.lastLanding) {
        const l = App.lastLanding;
        const chip = document.createElement('span');
        chip.className = `sim-chip landing ${l.score >= 75 ? 'ok' : 'warn'}`;
        chip.textContent = `🛬 ${l.fpm} ft/min · ${t(`landing.${l.id}`)}`;
        box.append(chip);
      }
      for (const c of checks.filter((x) => x.status !== 'wait')) {
        const chip = document.createElement('span');
        chip.className = `sim-chip ${c.status}`;
        // conferma: il valore impostato; avviso: il valore che l'ATC ha chiesto
        chip.textContent = c.status === 'ok' ? `✓ ${t(c.key, c.vars)}` : `⚠ ${t(c.key.replace('.bad', '.ok'), c.vars)}`;
        chip.title = t(c.key, c.vars);
        box.append(chip);
      }
      // L'avviso più importante va nella Live Activity (visibile anche in modalità compatta)
      const warn = checks.find((c) => c.status === 'warn');
      const alert = $('simAlert');
      alert.hidden = !warn;
      if (warn) {
        alert.textContent = `⚠ ${t(warn.key, warn.vars)}`;
        const id = `${warn.type}:${warn.vars.want}`;
        if (!warned.has(id)) {
          warned.add(id);
          root.TTS.ping();
          App.toast(t(warn.key, warn.vars), 8000);
        }
      }
    }

    // Atterraggio: voto, bip, e il dato passa al logbook e al resoconto
    function landed(ev) {
      App.lastLanding = ev;
      root.TTS.ping();
      App.toast(t('landing.toast', { fpm: ev.fpm, g: ev.g.toFixed(2), grade: t(`landing.${ev.id}`), score: ev.score }), 10000);
      App.emit('landing', ev);
      render();
    }
    if (bridge && bridge.onTouchdown) bridge.onTouchdown(landed);

    if (bridge) {
      bridge.onStatus(setStatus);
      bridge.onData((d) => { sim = d; render(); });
      bridge.status().then(setStatus).catch(() => {});
      if (S.simLink) bridge.enable(true);
      App.on('setting:simLink', (on) => bridge.enable(!!on));
    } else {
      $('simLink').disabled = true;
      setStatus('off');
    }

    App.on('readback', (item) => {
      if (!item || !item.result || item.result.forUs !== true) return;
      state = C.observe(state, item.result, Date.now());
      render();
    });
    App.on('flight', () => { state = C.emptyState(); warned.clear(); App.lastLanding = null; render(); });
    // Le attese scadono anche senza nuovi dati dal simulatore
    setInterval(() => { if (sim) render(); }, 5000);
    App.sim = () => ({ status, data: sim });
  });
})(this);
