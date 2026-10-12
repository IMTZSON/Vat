const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/cabin-sim.js');

function fly(pax, minutes, seed) {
  const sim = C.create({ pax, durationMin: minutes, seed, catalog: C.DEFAULT_CATALOG.A320 });
  const r = C.rng(seed);
  for (let m = 0; m < minutes; m++) C.step(sim, { dtMin: 1, progress: m / minutes, r });
  return sim;
}

test('volo di 2 ore con 150 passeggeri: incasso realistico', () => {
  const sim = fly(150, 120, 42);
  const s = C.summary(sim);
  assert.ok(s.revenue > 400 && s.revenue < 2500, `incasso ${s.revenue}`);
  assert.ok(s.sold > 80 && s.sold < 300, `venduti ${s.sold}`);
  assert.ok(s.perPax > 2.5 && s.perPax < 16, `per passeggero ${s.perPax}`);
  assert.ok(s.top.length > 5);
});

test('le scorte non vanno mai sotto zero e i conti tornano', () => {
  const sim = fly(189, 200, 7);
  for (const it of sim.items) assert.ok(it.stock >= 0, it.name);
  const total = Math.round(sim.sales.reduce((n, x) => n + x.amount, 0) * 100) / 100;
  assert.strictEqual(total, sim.revenue);
});

test('niente vendite fuori dalla finestra del servizio o a servizio chiuso', () => {
  const sim = C.create({ pax: 150, durationMin: 90, seed: 1 });
  const r = C.rng(1);
  assert.strictEqual(C.step(sim, { dtMin: 10, progress: 0.05, r }).length, 0);
  assert.strictEqual(C.step(sim, { dtMin: 10, progress: 0.95, r }).length, 0);
  assert.strictEqual(C.step(sim, { dtMin: 10, progress: 0.4, open: false, r }).length, 0);
  assert.ok(C.step(sim, { dtMin: 10, progress: 0.4, r }).length > 0);
});

test('più passeggeri e voli più lunghi vendono di più; risultato riproducibile', () => {
  const a = C.summary(fly(80, 90, 3)).revenue;
  const b = C.summary(fly(180, 90, 3)).revenue;
  assert.ok(b > a, `${b} <= ${a}`);
  const short = C.summary(fly(150, 50, 5)).revenue;
  const long = C.summary(fly(150, 180, 5)).revenue;
  assert.ok(long > short * 1.8, `${long} vs ${short}`);
  assert.strictEqual(C.summary(fly(150, 120, 9)).revenue, C.summary(fly(150, 120, 9)).revenue);
});

test('il duty free arriva verso la fine del servizio', () => {
  const sim = fly(180, 150, 11);
  const duty = sim.sales.filter((s) => s.cat === 'duty');
  if (duty.length) {
    const avg = duty.reduce((n, s) => n + s.minute, 0) / duty.length;
    assert.ok(avg > 150 * 0.45, `minuto medio duty free ${avg}`);
  }
});
