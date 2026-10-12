/* Simulazione realistica del servizio di bordo (buy on board): vendite distribuite nel tempo in base
   a passeggeri, durata del volo, popolarità dei prodotti e momento del servizio. Funzioni pure. */
(function (root) {
  'use strict';

  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const I18n = isNode ? require('./i18n.js') : root.I18n;
  const pick = (x) => (I18n ? I18n.pick(x) : (Array.isArray(x) ? x[0] : x));
  const CAT_NAMES = { drink: ['Bevande', 'Drinks'], snack: ['Snack', 'Snacks'], meal: ['Pasti', 'Meals'], duty: ['Duty free', 'Duty free'] };
  // Acquisti medi per passeggero per ora di servizio
  const RATE = { drink: 0.42, snack: 0.24, meal: 0.13, duty: 0.035 };
  const SEATS = { A320: 180, B737: 189 };
  const WINDOW = [0.12, 0.85]; // il servizio si apre dopo la salita e si chiude prima dell'avvicinamento

  const BASE = [
    { id: 'water', name: ['Acqua naturale 50cl', 'Still water 50cl'], cat: 'drink', price: 2.5, stock: 80, pop: 1.0 },
    { id: 'cola', name: 'Coca-Cola 33cl', cat: 'drink', price: 3.5, stock: 60, pop: 0.9 },
    { id: 'coffee', name: ['Caffè espresso', 'Espresso'], cat: 'drink', price: 2.8, stock: 70, pop: 1.0 },
    { id: 'juice', name: ['Succo d\'arancia', 'Orange juice'], cat: 'drink', price: 3.0, stock: 40, pop: 0.6 },
    { id: 'tea', name: ['Tè caldo', 'Hot tea'], cat: 'drink', price: 2.5, stock: 30, pop: 0.35 },
    { id: 'beer', name: ['Birra 33cl', 'Beer 33cl'], cat: 'drink', price: 5.5, stock: 30, pop: 0.45 },
    { id: 'wine', name: ['Vino rosso 18,7cl', 'Red wine 18.7cl'], cat: 'drink', price: 7.5, stock: 20, pop: 0.25 },
    { id: 'chips', name: ['Patatine', 'Crisps'], cat: 'snack', price: 2.8, stock: 40, pop: 0.8 },
    { id: 'cookies', name: ['Biscotti', 'Cookies'], cat: 'snack', price: 2.5, stock: 40, pop: 0.7 },
    { id: 'choco', name: ['Barretta al cioccolato', 'Chocolate bar'], cat: 'snack', price: 2.5, stock: 40, pop: 0.75 },
    { id: 'taralli', name: ['Taralli', 'Pretzels'], cat: 'snack', price: 2.5, stock: 30, pop: 0.5 },
    { id: 'panino', name: ['Panino prosciutto e formaggio', 'Ham and cheese sandwich'], cat: 'meal', price: 7.5, stock: 25, pop: 0.9 },
    { id: 'piadina', name: ['Piadina vegetariana', 'Veggie wrap'], cat: 'meal', price: 7.0, stock: 15, pop: 0.5 },
    { id: 'pasta', name: ['Insalata di pasta', 'Pasta salad'], cat: 'meal', price: 8.5, stock: 12, pop: 0.4 },
    { id: 'perfume', name: ['Profumo 50ml', 'Perfume 50ml'], cat: 'duty', price: 49, stock: 6, pop: 0.5 },
    { id: 'model', name: ['Modellino aereo', 'Model aircraft'], cat: 'duty', price: 25, stock: 8, pop: 0.6 },
    { id: 'watch', name: ['Orologio', 'Watch'], cat: 'duty', price: 89, stock: 4, pop: 0.2 },
  ];
  // Listino predefinito nella lingua attuale (si genera ogni volta: la lingua può cambiare)
  const defaultCatalog = () => ({
    A320: BASE.map((x) => ({ ...x, name: pick(x.name) })),
    B737: BASE.map((x) => ({ ...x, name: pick(x.name), stock: Math.round(x.stock * 1.1) })),
  });

  function rng(seed) {
    let s = (seed === undefined ? Math.floor(Math.random() * 2 ** 31) : seed) >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function poisson(lambda, r) {
    if (lambda <= 0) return 0;
    if (lambda > 30) return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (r() + r() + r() - 1.5) * 2));
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do { k++; p *= r(); } while (p > L);
    return k - 1;
  }

  // Domanda relativa nel corso del servizio (x = 0 apertura, 1 chiusura); media ~1 su tutto il servizio
  function demand(cat, x) {
    if (x < 0 || x > 1) return 0;
    switch (cat) {
      case 'drink': return x < 0.6 ? 1.45 : 0.45;
      case 'meal': return x < 0.1 ? 0.6 : (x < 0.6 ? 1.6 : 0.2);
      case 'snack': return 1;
      case 'duty': return x < 0.55 ? 0.15 : 2.0;
      default: return 1;
    }
  }

  function durationFactor(cat, durationMin) {
    if (cat !== 'meal') return 1;
    if (durationMin < 60) return 0.4;
    if (durationMin > 150) return 1.3;
    return 1;
  }

  function create(opts) {
    const items = (opts.catalog || defaultCatalog().A320).map((x) => ({ ...x, stock: Number(x.stock) || 0, price: Number(x.price) || 0, pop: Number(x.pop) || 0.5, sold: 0 }));
    return { pax: Math.max(0, Math.round(opts.pax || 0)), durationMin: Math.max(10, opts.durationMin || 90), items, sales: [], revenue: 0, sold: 0, missed: 0, minute: 0, seed: opts.seed };
  }

  const serviceX = (progress) => (progress - WINDOW[0]) / (WINDOW[1] - WINDOW[0]);

  /* Avanza la simulazione di dtMin minuti. progress: 0..1 del volo. open: false forza il servizio chiuso
     (es. turbolenza, salita sotto FL100). Restituisce le nuove vendite. */
  function step(sim, { dtMin, progress, open, r }) {
    const rand = r || rng(sim.seed === undefined ? undefined : sim.seed + Math.round(sim.minute * 10));
    sim.minute += dtMin;
    const x = serviceX(progress);
    if (open === false || x < 0 || x > 1 || !sim.pax) return [];
    const out = [];
    const cap = sim.pax * 1.6;
    for (const cat of Object.keys(RATE)) {
      const lambda = sim.pax * RATE[cat] * (dtMin / 60) * demand(cat, x) * durationFactor(cat, sim.durationMin);
      const n = poisson(lambda, rand);
      for (let k = 0; k < n; k++) {
        if (sim.sold >= cap) break;
        const pool = sim.items.filter((it) => it.cat === cat && it.stock > 0 && it.pop > 0);
        if (!pool.length) { sim.missed++; continue; }
        const tot = pool.reduce((s, it) => s + it.pop, 0);
        let pick = rand() * tot;
        let it = pool[pool.length - 1];
        for (const c of pool) { pick -= c.pop; if (pick <= 0) { it = c; break; } }
        const qty = cat === 'drink' && rand() < 0.15 && it.stock >= 2 ? 2 : 1;
        it.stock -= qty;
        it.sold += qty;
        const amount = Math.round(it.price * qty * 100) / 100;
        sim.revenue = Math.round((sim.revenue + amount) * 100) / 100;
        sim.sold += qty;
        const sale = { minute: Math.round(sim.minute), id: it.id, name: it.name, cat, qty, amount };
        sim.sales.push(sale);
        out.push(sale);
      }
    }
    return out;
  }

  function summary(sim) {
    const top = sim.items.filter((it) => it.sold > 0).map((it) => ({ name: it.name, qty: it.sold, amount: Math.round(it.sold * it.price * 100) / 100 }))
      .sort((a, b) => b.qty - a.qty || b.amount - a.amount);
    const byCat = {};
    for (const s of sim.sales) byCat[s.cat] = Math.round(((byCat[s.cat] || 0) + s.amount) * 100) / 100;
    return { revenue: sim.revenue, sold: sim.sold, missed: sim.missed, top, byCat, perPax: sim.pax ? Math.round((sim.revenue / sim.pax) * 100) / 100 : 0 };
  }

  const api = { SEATS, WINDOW, create, step, summary, rng };
  Object.defineProperty(api, 'DEFAULT_CATALOG', { enumerable: true, get: defaultCatalog });
  Object.defineProperty(api, 'CATS', { enumerable: true, get: () => Object.fromEntries(Object.entries(CAT_NAMES).map(([k, v]) => [k, pick(v)])) });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CabinSim = api;
})(this);
