/* Rete: nel programma per Windows (o aprendo l'app da http://127.0.0.1) le richieste
   esterne passano dal server locale, così non ci sono blocchi CORS. Nel browser
   normale si va diretti. */
(function (root) {
  'use strict';

  const Net = {
    proxy: false,
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
        }
      } catch (e) { /* nessun server locale */ }
    },

    url(target) {
      return this.proxy ? `api/proxy?url=${encodeURIComponent(target)}` : target;
    },

    async fetch(target, init) {
      try {
        return await fetch(this.url(target), init);
      } catch (e) {
        throw new Error(`Connessione non riuscita (${new URL(target).host}).`);
      }
    },

    async text(target) {
      const r = await this.fetch(target, { cache: 'no-store' });
      if (!r.ok) throw new Error(`Errore ${r.status} da ${new URL(target).host}`);
      return r.text();
    },

    async json(target) {
      return JSON.parse(await this.text(target));
    },
  };

  root.Net = Net;
})(this);
