const test = require('node:test');
const assert = require('node:assert');
const Geo = require('../js/geo.js');

const LIRF = { lat: 41.8003, lon: 12.2389 };
const LIMC = { lat: 45.6306, lon: 8.7231 };

test('distanza Fiumicino–Malpensa ~ 275 NM', () => {
  const d = Geo.distance(LIRF, LIMC);
  assert.ok(d > 265 && d < 285, String(d));
  const b = Geo.bearing(LIRF, LIMC);
  assert.ok(b > 320 && b < 335, String(b));
});

test('progresso sulla rotta', () => {
  const route = [LIRF, { lat: 43.7, lon: 10.5 }, LIMC];
  const start = Geo.routeProgress(route, LIRF);
  assert.ok(start.pct < 0.02);
  const mid = Geo.routeProgress(route, { lat: 43.7, lon: 10.5 });
  assert.ok(mid.pct > 0.4 && mid.pct < 0.6, String(mid.pct));
  const end = Geo.routeProgress(route, { lat: 45.6, lon: 8.75 });
  assert.ok(end.remaining < 5, String(end.remaining));
  assert.strictEqual(Geo.routeProgress([LIRF], LIRF), null);
});

test('ETA', () => {
  const t0 = Date.UTC(2026, 9, 12, 12, 0);
  assert.strictEqual(Geo.eta(240, 480, t0).getTime(), t0 + 30 * 60000);
  assert.strictEqual(Geo.eta(240, 20, t0), null);
});

test('fasi di un volo completo ed eventi del logbook', () => {
  const samples = [
    { alt: 10, gs: 0, vs: 0 }, { alt: 10, gs: 15, vs: 0 }, { alt: 300, gs: 160, vs: 2000 }, { alt: 8000, gs: 280, vs: 2500 },
    { alt: 36000, gs: 450, vs: 0, remaining: 200 }, { alt: 30000, gs: 440, vs: -2000, remaining: 120 }, { alt: 4000, gs: 200, vs: -900, remaining: 15 },
    { alt: 700, gs: 120, vs: 0, remaining: 1 }, { alt: 700, gs: 30, vs: 0 }, { alt: 700, gs: 12, vs: 0 }, { alt: 700, gs: 0, vs: 0 },
  ];
  let prev = null;
  const phases = [];
  const evs = [];
  for (const s of samples) {
    const p = Geo.phase({ cruiseFt: 36000, remaining: null, ...s }, prev);
    evs.push(...Geo.events(prev, p));
    phases.push(p);
    prev = p;
  }
  assert.deepStrictEqual(phases, ['parked', 'taxi-out', 'takeoff', 'climb', 'cruise', 'descent', 'approach', 'approach', 'landed', 'taxi-in', 'arrived']);
  assert.deepStrictEqual(evs, ['offBlock', 'takeoff', 'landing', 'onBlock']);
});

test('collegato già in volo: niente decollo finto', () => {
  const p = Geo.phase({ alt: 36000, gs: 450, vs: 0, cruiseFt: 36000 }, null);
  assert.strictEqual(p, 'cruise');
  assert.deepStrictEqual(Geo.events(null, p), []);
});
