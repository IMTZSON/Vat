/* Readback Copilot Pro: attivazione della licenza (Lemon Squeezy, tramite il server Pro),
   minuti usati nel mese e acquisto. Con il Pro attivo la trascrizione e l'AI non richiedono chiavi. */
(function (root) {
  'use strict';

  root.App.register((App) => {
    const $ = App.$;
    const S = App.settings;
    const t = App.t;
    const cfg = root.Net.pro;
    if (!cfg) return;

    async function api(path, init) {
      const opts = { ...(init || {}), headers: { 'Content-Type': 'application/json', ...((init && init.headers) || {}) } };
      const r = await root.Net.fetch(`${cfg.endpoint}${path}`, opts);
      let data = {};
      try { data = await r.json(); } catch (e) { /* risposta non JSON */ }
      if (!r.ok) throw new Error((data.error && data.error.message) || `${r.status}`);
      return data;
    }
    const auth = () => ({ Authorization: `Bearer ${S.proKey}::${S.proInstance}` });
    const fmtMin = (sec) => Math.round(sec / 60);

    function render(status) {
      const active = !!(S.proKey && S.proInstance);
      $('proDeactivate').hidden = !active;
      $('proActivate').hidden = active;
      $('proKeyInput').closest('.row').hidden = active;
      $('proBuy').hidden = active || !cfg.checkout;
      $('proBadge').classList.toggle('muted', !active);
      const usage = $('proUsage');
      if (!active) { $('proStatus').textContent = t('pro.notActive'); usage.hidden = true; return; }
      if (status && status.limit_seconds) {
        const pct = Math.min(100, Math.round((status.used_seconds / status.limit_seconds) * 100));
        $('proStatus').textContent = t('pro.usage', { used: fmtMin(status.used_seconds), limit: fmtMin(status.limit_seconds) });
        usage.hidden = false;
        $('proUsageBar').style.width = `${pct}%`;
        $('proUsageBar').classList.toggle('high', pct >= 85);
      } else if (status && status.error) {
        $('proStatus').textContent = status.error;
        usage.hidden = true;
      } else {
        $('proStatus').textContent = t('pro.active');
      }
    }

    async function refresh() {
      if (!(S.proKey && S.proInstance)) { render(); return; }
      try { render(await api('/v1/license/status', { method: 'GET', headers: auth() })); } catch (e) { render({ error: e.message }); }
    }

    $('proActivate').addEventListener('click', async () => {
      const key = $('proKeyInput').value.trim();
      if (!key) { $('proStatus').textContent = t('pro.needKey'); return; }
      $('proStatus').textContent = t('common.checking');
      try {
        const host = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || 'PC';
        const r = await api('/v1/license/activate', { method: 'POST', body: JSON.stringify({ license_key: key, instance_name: `Readback Copilot · ${host}` }) });
        App.set('proKey', key);
        App.set('proInstance', r.instance_id);
        App.set('sttProvider', 'pro');
        App.set('mode', 'groq');
        $('proKeyInput').value = '';
        App.toast(t('pro.activated'), 6000);
        refresh();
      } catch (e) {
        $('proStatus').textContent = `❌ ${e.message}`;
      }
    });

    $('proDeactivate').addEventListener('click', async () => {
      if (!confirm(t('pro.deactivateConfirm'))) return;
      try { await api('/v1/license/deactivate', { method: 'POST', body: JSON.stringify({ license_key: S.proKey, instance_id: S.proInstance }) }); } catch (e) { /* si libera comunque in locale */ }
      App.set('proInstance', '');
      App.set('proKey', '');
      render();
    });

    $('proBuy').addEventListener('click', () => App.desktop.openExternal(cfg.checkout));
    App.on('setting:sttProvider', (v) => { if (v === 'pro') refresh(); });
    App.on('tab', (id) => { if (id === 'settings' && S.sttProvider === 'pro') refresh(); });
    render();
    App.proRefresh = refresh;
  });
})(this);
