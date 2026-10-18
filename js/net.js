/* Rete: nel programma per Windows (o aprendo l'app da http://127.0.0.1) le richieste
   esterne passano dal server locale, così non ci sono blocchi CORS. Nel browser
   normale si va diretti. */
(function (root) {
  'use strict';

  const Net = {
    proxy: false,
    pro: null,
    desktop: false,

    async init() {
      // "desktop" = dentro la finestra del programma per Windows (non in Chrome sullo stesso server).
      this.desktop = !!root.desktop;
      if (!/^https?:$/.test(location.protocol)) return;
      try {
        const r = await fetch('api/ping', { cache: 'no-store' });
        if (r.ok) {
          const info = await r.json();
          this.proxy = !!info.ok;
          this.pro = info.pro || null;
        }
      } catch (e) { /* nessun server locale */ }
    },

    url(target) {
      return this.proxy ? `api/proxy?url=${encodeURIComponent(target)}` : target;
    },

    async fetch(target, init) {
      const opts = { ...(init || {}) };
      if (this.proxy) opts.headers = { ...(opts.headers || {}), 'X-Readback-Copilot': '1' };
      try {
        return await fetch(this.url(target), opts);
      } catch (e) {
        throw new Error(root.I18n ? root.I18n.t('net.failed', { host: new URL(target).host }) : `Connection failed (${new URL(target).host}).`);
      }
    },

    async text(target) {
      const r = await this.fetch(target, { cache: 'no-store' });
      if (!r.ok) throw new Error(root.I18n ? root.I18n.t('net.status', { status: r.status, host: new URL(target).host }) : `Error ${r.status} from ${new URL(target).host}`);
      return r.text();
    },

    async json(target) {
      return JSON.parse(await this.text(target));
    },
  };

  root.Net = Net;
})(this);
