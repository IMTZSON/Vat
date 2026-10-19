/* Statistiche anonime e segnalazione errori: SOLO con il consenso dell'utente (spente di default).
   Si inviano una volta al giorno contatori aggregati (quali funzioni si usano, versione, lingua,
   piattaforma) ed errori ripuliti. Mai audio, frasi, nominativi, posizione o chiavi.
   Senza un indirizzo configurato (package.json "telemetry") non parte niente. */
(function (root) {
  'use strict';

  const MAX_ERRORS = 20;
  // Contatori ammessi: niente testo libero
  const COUNTERS = ['start', 'listen', 'readback', 'verified', 'train', 'rehearsal', 'taxi', 'landing', 'flight', 'debrief', 'emergency', 'career', 'link', 'simbrief', 'view'];

  // Toglie dal testo di un errore tutto ciò che può identificare qualcuno
  function scrub(s) {
    return String(s || '')
      .replace(/[A-Za-z]:\\[^\s:)]+/g, '<path>')
      .replace(/(?:file|https?):\/\/[^\s)]+/g, (u) => { try { const x = new URL(u); return x.protocol === 'file:' ? '<file>' : `${x.origin}${x.pathname.replace(/\/[^/]*$/, '/…')}`; } catch (e) { return '<url>'; } })
      .replace(/\/(?:home|Users|root)\/[^\s:)]+/g, '<path>')
      .replace(/[\w.+-]+@[\w-]+\.[\w.]+/g, '<email>')
      .replace(/\b(gsk|sk|key)[-_][A-Za-z0-9]{8,}\b/g, '<key>')
      .replace(/\b[A-Z]{3}\d{1,4}[A-Z]{0,2}\b/g, '<cs>')
      .replace(/\b\d{5,}\b/g, '<n>')
      .slice(0, 600);
  }

  const today = (now) => new Date(now).toISOString().slice(0, 10);
  const emptyDay = (now) => ({ d: today(now), c: {}, e: [] });

  function count(state, name, n, now) {
    if (!COUNTERS.includes(name)) return state;
    const s = state && state.d === today(now) ? state : { ...emptyDay(now), pending: pendingOf(state, now) };
    return { ...s, c: { ...s.c, [name]: (s.c[name] || 0) + (n || 1) } };
  }

  function error(state, message, stack, now) {
    const s = state && state.d === today(now) ? state : { ...emptyDay(now), pending: pendingOf(state, now) };
    const m = scrub(message).slice(0, 200);
    const e = s.e.slice();
    const same = e.find((x) => x.m === m);
    if (same) same.n++;
    else if (e.length < MAX_ERRORS) e.push({ m, s: scrub(stack), n: 1 });
    return { ...s, e };
  }

  // Il giorno precedente, chiuso, da inviare (con quelli ancora non inviati)
  function pendingOf(state, now) {
    if (!state) return [];
    const old = state.pending || [];
    if (state.d && state.d !== today(now) && (Object.keys(state.c || {}).length || (state.e || []).length)) return [...old, { d: state.d, c: state.c, e: state.e }].slice(-7);
    return old;
  }

  /* Corpo da inviare: un elemento per giorno chiuso. meta: { id, v, p, l } */
  function payload(state, meta, opts) {
    const days = (state && state.pending) || [];
    if (!days.length) return null;
    return {
      id: meta.id, v: meta.v, p: meta.p, l: meta.l,
      days: days.map((x) => ({ d: x.d, c: opts.usage ? x.c : {}, e: opts.errors ? x.e : [] })).filter((x) => Object.keys(x.c).length || x.e.length),
    };
  }

  const newId = () => Array.from((root.crypto && root.crypto.getRandomValues) ? root.crypto.getRandomValues(new Uint8Array(12)) : Array.from({ length: 12 }, () => Math.floor(Math.random() * 256)), (b) => b.toString(16).padStart(2, '0')).join('');

  const api = { scrub, count, error, payload, pendingOf, newId, COUNTERS };
  if (typeof module !== 'undefined' && module.exports) { module.exports = api; return; }
  root.Telemetry = api;

  // ------------------------------------------------------------ nell'app
  root.App.register((App) => {
    const S = App.settings;
    const KEY = 'readback-copilot-telemetry';
    let state = App.storage.get(KEY, null);
    const on = () => !!(S.telemetry || S.crashReports);
    const save = () => App.storage.set(KEY, state);
    const add = (name, n) => { if (S.telemetry) { state = count(state, name, n, Date.now()); save(); } };

    function platform() {
      if (root.Capacitor && root.Capacitor.isNativePlatform && root.Capacitor.isNativePlatform()) return root.Capacitor.getPlatform();
      return root.Net && root.Net.desktop ? 'windows' : 'web';
    }

    async function flush() {
      const endpoint = root.Net && root.Net.telemetry;
      if (!on() || !endpoint) return;
      const now = Date.now();
      if (!state || state.d !== today(now)) state = { ...emptyDay(now), pending: pendingOf(state, now) };
      if (!S.telemetryId) App.set('telemetryId', newId());
      const body = payload(state, { id: S.telemetryId, v: (App.version && App.version.version) || '', p: platform(), l: root.I18n.lang }, { usage: !!S.telemetry, errors: !!S.crashReports });
      if (body && body.days.length) {
        try {
          const r = await root.Net.fetch(`${endpoint}/v1/t`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
          if (!r.ok) return;
        } catch (e) { return; }
      }
      state = { ...state, pending: [] };
      save();
    }

    // Consenso revocato: si cancella quello che non è stato inviato
    for (const k of ['telemetry', 'crashReports']) App.on(`setting:${k}`, () => { if (!on()) { state = null; App.storage.set(KEY, null); } });

    App.on('tab', () => add('view'));
    App.on('readback', (item) => { if (item && item.result && item.result.forUs) { add('readback'); if (item.verify && item.verify.status === 'ok') add('verified'); } });
    App.on('train-answer', () => add('train'));
    App.on('rehearsal-done', () => add('rehearsal'));
    App.on('taxi', () => add('taxi'));
    App.on('landing', () => add('landing'));
    App.on('flight-finished', () => add('flight'));
    App.on('emergency-open', () => add('emergency'));
    App.on('listening', (onNow) => { if (onNow) add('listen'); });
    App.on('link', (st) => { if (st === 'connected') add('link'); });

    root.addEventListener('error', (ev) => {
      if (!S.crashReports) return;
      state = error(state, ev.message, ev.error && ev.error.stack, Date.now());
      save();
    });
    root.addEventListener('unhandledrejection', (ev) => {
      if (!S.crashReports) return;
      const r = ev.reason || {};
      state = error(state, r.message || String(r), r.stack, Date.now());
      save();
    });

    add('start');
    setTimeout(flush, 15000);
    setInterval(flush, 6 * 3600000);
    App.telemetryFlush = flush;
  });
})(this);
