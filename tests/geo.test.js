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

test('greatCircle: estremi, punto medio e antimeridiano', () => {
  const G = require('../js/geo.js');
  const pts = G.greatCircle({ lat: 41.8, lon: 12.25 }, { lat: 51.47, lon: -0.45 }, 10);
  assert.equal(pts.length, 11);
  assert.ok(Math.abs(pts[0][0] - 41.8) < 1e-6 && Math.abs(pts[0][1] - 12.25) < 1e-6);
  assert.ok(Math.abs(pts[10][0] - 51.47) < 1e-6 && Math.abs(pts[10][1] + 0.45) < 1e-6);
  // sul cerchio massimo la somma delle distanze è uguale alla distanza diretta
  let sum = 0;
  for (let i = 1; i < pts.length; i++) sum += G.distance({ lat: pts[i - 1][0], lon: pts[i - 1][1] }, { lat: pts[i][0], lon: pts[i][1] });
  assert.ok(Math.abs(sum - G.distance({ lat: 41.8, lon: 12.25 }, { lat: 51.47, lon: -0.45 })) < 0.5);
  // Tokyo → Los Angeles: longitudini continue oltre 180
  const pac = G.greatCircle({ lat: 35.55, lon: 139.78 }, { lat: 33.94, lon: -118.4 }, 20);
  for (let i = 1; i < pac.length; i++) assert.ok(Math.abs(pac[i][1] - pac[i - 1][1]) < 30);
  assert.ok(Math.abs(pac[20][1] - (360 - 118.4)) < 1e-6);
  assert.ok(Math.max(...pac.map((p) => p[0])) > 45, 'la rotta sale verso nord');
  assert.deepEqual(G.greatCircle({ lat: 1, lon: 2 }, { lat: 1, lon: 2 }, 2), [[1, 2], [1, 2], [1, 2]]);
});

test('arco di cerchio massimo e posizione stimata', () => {
  const half = Geo.interpolate(LIRF, LIMC, 0.5);
  assert.ok(Math.abs(Geo.distance(LIRF, half) - Geo.distance(half, LIMC)) < 0.1);
  // Londra–New York: l'arco passa molto più a nord della retta
  const mid = Geo.interpolate({ lat: 51.47, lon: -0.46 }, { lat: 40.64, lon: -73.78 }, 0.5);
  assert.ok(mid.lat > 52, String(mid.lat));
  const p = Geo.destination(LIRF, 90, 60);
  assert.ok(Math.abs(Geo.distance(LIRF, p) - 60) < 0.1);
  assert.ok(Math.abs(Geo.bearing(LIRF, p) - 90) < 1);
});

test('Top of Descent con la regola 3:1', () => {
  assert.strictEqual(Geo.todDistance(36000, 0), 118);
  assert.strictEqual(Geo.todDistance(36000, 1000), 115);
  assert.strictEqual(Geo.todDistance(2000), 0);
  const route = [LIRF, { lat: 43.7, lon: 10.5 }, LIMC];
  const total = Geo.distance(route[0], route[1]) + Geo.distance(route[1], route[2]);
  const td = Geo.pointAlong(route, 100);
  const prog = Geo.routeProgress(route, td);
  assert.ok(Math.abs(prog.remaining - 100) < 1, String(prog.remaining));
  assert.deepStrictEqual(Geo.pointAlong(route, total + 50), { lat: LIRF.lat, lon: LIRF.lon });
  assert.ok(prog.at && prog.leg === 1);
});
