/* Avviso di aggiornamento: confronta il numero di build del programma (scritto dalla CI in
   package.json) con le build pubblicate su GitHub Releases (tag "build-N"). Al massimo un controllo
   ogni 6 ore; nessun dato personale inviato. Funzioni pure esportate per i test. */
(function (root) {
  'use strict';

  const REPO = 'IMTZSON/Vat';
  const API = `https://api.github.com/repos/${REPO}/releases?per_page=15`;
  const EVERY_MS = 6 * 3600 * 1000;

  // Release più recente con numero di build maggiore di quello attuale (o null)
  function newer(releases, currentBuild) {
    const cur = Number(currentBuild) || 0;
    let best = null;
    for (const r of releases || []) {
      if (!r || r.draft) continue;
      const m = String(r.tag_name || '').match(/^build-(\d+)$/);
      if (!m) continue;
      const n = Number(m[1]);
      if (n > cur && (!best || n > best.build)) best = { build: n, url: r.html_url, name: r.name || r.tag_name, date: r.published_at };
    }
    return best;
  }

  const api = { newer, REPO };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.Updates = api;

  root.App.register((App) => {
    const $ = App.$;
    const S = App.settings;
    const t = App.t;

    async function check(force) {
      const info = App.version;
      if (!info || !info.build || (!S.checkUpdates && !force)) return null;
      const last = App.storage.get('readback-copilot-update-check', 0);
      if (!force && Date.now() - last < EVERY_MS) {
        const cached = App.storage.get('readback-copilot-update', null);
        if (cached && cached.build > Number(info.build)) show(cached);
        return cached;
      }
      try {
        const rel = await root.Net.json(API);
        const found = newer(rel, info.build);
        App.storage.set('readback-copilot-update-check', Date.now());
        App.storage.set('readback-copilot-update', found);
        if (found) show(found);
        return found;
      } catch (e) {
        return null;
      }
    }

    function show(u) {
      if (!u || S.updateDismissed === u.build) return;
      $('updateText').textContent = t('update.available', { build: u.build });
      $('updateBanner').hidden = false;
      $('updateGet').onclick = () => App.desktop.openExternal(u.url);
      $('updateLater').onclick = () => { App.set('updateDismissed', u.build); $('updateBanner').hidden = true; };
    }

    // ------------------------------------------------------------ programma installato: aggiornamento in un clic
    const U = App.desktop.updater;
    let auto = false;

    function showAuto(s) {
      const banner = $('updateBanner');
      const text = $('updateText');
      const btn = $('updateGet');
      let bar = banner.querySelector('.update-progress');
      if (!bar) {
        bar = document.createElement('span');
        bar.className = 'update-progress';
        bar.innerHTML = '<i></i>';
        btn.before(bar);
      }
      if (s.state === 'downloading') {
        text.textContent = t('update.downloading', { version: s.version || '' });
        bar.hidden = false;
        bar.firstChild.style.width = `${s.percent || 0}%`;
        btn.hidden = true;
        banner.hidden = S.updateDismissed === `dl-${s.version}`;
        $('updateLater').onclick = () => { App.set('updateDismissed', `dl-${s.version}`); banner.hidden = true; };
      } else if (s.state === 'ready') {
        text.textContent = t('update.ready', { version: s.version || '' });
        bar.hidden = true;
        btn.hidden = false;
        btn.textContent = t('update.restart');
        // Mai durante l'ascolto senza chiedere: il riavvio interrompe la radio
        btn.onclick = () => {
          if (App.isListening && App.isListening() && !confirm(t('update.confirmListening'))) return;
          U.install();
        };
        $('updateLater').onclick = () => { banner.hidden = true; App.toast(t('update.onQuit')); };
        banner.hidden = false;
      }
    }

    async function setup() {
      if (U) {
        try {
          const s = await U.state();
          auto = !!(s && s.supported);
        } catch (e) { auto = false; }
      }
      if (auto) {
        U.onState(showAuto);
        if (S.checkUpdates) U.check();
        // Il programma resta aperto per ore: un controllo ogni 6 ore
        setInterval(() => { if (S.checkUpdates) U.check(); }, EVERY_MS);
      } else {
        check(false);
      }
    }

    App.checkUpdates = (force) => (auto ? U.check() : check(force));
    App.on('setting:checkUpdates', (v) => {
      if (v) App.checkUpdates(true);
      else $('updateBanner').hidden = true;
    });
    // Dopo l'avvio, senza rallentarlo
    setTimeout(setup, 4000);
  });
})(this);
