const test = require('node:test');
const assert = require('node:assert');
const Taxi = require('../js/taxi.js');
const R = require('../js/readback.js');

const cs = R.parseCallsign('AZA123');
const parts = (t) => R.generateReadback(t, { callsign: cs }).parts;

// Aeroporto di prova (formato Overpass): pista 16L/34R, pista trasversale 07/25 sul taxiway B,
// taxiway A parallelo, raccordi A1/A2 con punti attesa, B e C dal piazzale, stand 512.
const N = (id, lat, lon, tags) => ({ type: 'node', id, lat, lon, ...(tags ? { tags } : {}) });
const W = (id, aeroway, ref, nodes) => ({ type: 'way', id, nodes, tags: { aeroway, ...(ref ? { ref } : {}) } });
const OVERPASS = { elements: [
  N(1, 45.010, 9.000), N(3, 45.004, 9.000), N(4, 44.996, 9.000), N(2, 44.990, 9.000),
  N(10, 45.006, 9.003), N(11, 45.004, 9.003), N(14, 45.000, 9.003), N(12, 44.996, 9.003), N(13, 44.994, 9.003),
  N(20, 45.004, 9.0015, { aeroway: 'holding_position', ref: 'A2' }), N(21, 44.992, 9.0015, { aeroway: 'holding_position', ref: 'A1' }),
  N(30, 45.000, 9.008), N(42, 45.000, 9.0052), N(32, 44.994, 9.008),
  N(40, 44.999, 9.0052), N(41, 45.001, 9.0052),
  N(33, 45.0005, 9.010, { aeroway: 'parking_position', ref: '512' }),
  W(100, 'runway', '16L/34R', [1, 3, 4, 2]),
  W(101, 'runway', '07/25', [40, 42, 41]),
  W(110, 'taxiway', 'A', [10, 11, 14, 12, 13]),
  W(111, 'taxiway', 'A2', [11, 20, 3]),
  W(112, 'taxiway', 'A1', [13, 21, 2]),
  W(113, 'taxiway', 'B', [30, 42, 14]),
  W(114, 'taxiway', 'C', [30, 32, 13]),
  W(115, 'taxilane', null, [33, 30]),
] };
const ground = Taxi.compactOverpass(OVERPASS);
const graph = Taxi.buildGraph(ground);
const STAND = { lat: 45.0005, lon: 9.0099 };

test('istruzioni di rullaggio lette dal readback', () => {
  assert.deepStrictEqual(Taxi.parseClearance(parts('Alitalia 123 taxi to holding point A2 runway 16L via B')), { target: { kind: 'holding', ref: 'A2', runway: '16L' }, via: ['B'], holdShort: [], cross: [] });
  const p = Taxi.parseClearance(parts('Alitalia 123 taxi to holding point alpha 1 runway 34R via november, alpha, hold short runway 07'));
  assert.deepStrictEqual([p.target.ref, p.via, p.holdShort], ['A1', ['N', 'A'], ['07']]);
  assert.deepStrictEqual(Taxi.parseClearance(parts('Alitalia 123 taxi to stand 512 via K, L')).target, { kind: 'stand', ref: '512' });
  const v = Taxi.parseClearance(parts('Alitalia 123 taxi via Bravo 3 and Charlie to holding point Charlie 1 runway 25'));
  assert.deepStrictEqual([v.via, v.target.ref, v.target.runway], [['B3', 'C'], 'C1', '25']);
  const c = Taxi.parseClearance(parts('Alitalia 123 taxi to runway 27L via A, B1 cross runway 23'));
  assert.deepStrictEqual([c.target, c.via, c.cross], [{ kind: 'runway', ref: null, runway: '27L' }, ['A', 'B1'], ['23']]);
  assert.strictEqual(Taxi.parseClearance(parts('Alitalia 123 climb flight level 240')), null);
  assert.strictEqual(Taxi.refOf('Kilo 12'), 'K12');
  assert.strictEqual(Taxi.refOf('the apron'), null);
});

test('dati OpenStreetMap compattati', () => {
  assert.strictEqual(ground.ways.length, 8);
  assert.deepStrictEqual(ground.points.map((p) => [p.kind, p.ref]), [['holding', 'A2'], ['holding', 'A1'], ['stand', '512']]);
  assert.deepStrictEqual(ground.nodes[20], [45.004, 9.0015]);
  assert.deepStrictEqual(Taxi.runwayIds('16L/34R'), ['16L', '34R']);
});

test('percorso: dallo stand al punto attesa A2 via B e A, con la pista attraversata', () => {
  const plan = Taxi.parseClearance(parts('Alitalia 123 taxi to holding point A2 runway 16L via B, A'));
  const r = Taxi.route(graph, STAND, plan);
  assert.ok(r.ok, r.reason);
  assert.deepStrictEqual(r.points, [33, 30, 42, 14, 11, 20].map((id) => ground.nodes[id]));
  assert.deepStrictEqual(r.crossings.map((c) => c.runway), ['07/25'], 'attraversamento della 07/25 segnalato');
  assert.deepStrictEqual(r.end, ground.nodes[20]);
  assert.ok(r.length > 900 && r.length < 1400, String(r.length));
});

test('percorso: segue i taxiway nell\'ordine dato (C poi A verso A1), anche se B sarebbe più corto', () => {
  const plan = Taxi.parseClearance(parts('Alitalia 123 taxi to holding point A1 runway 34R via C, A'));
  const r = Taxi.route(graph, STAND, plan);
  assert.ok(r.ok);
  assert.deepStrictEqual(r.points, [33, 30, 32, 13, 21].map((id) => ground.nodes[id]));
  assert.deepStrictEqual(r.crossings, []);
});

test('percorso: taxiway sconosciuti segnalati, destinazione solo pista, aereo lontano', () => {
  const plan = Taxi.parseClearance(parts('Alitalia 123 taxi to runway 16L via Zulu, B, A'));
  const r = Taxi.route(graph, STAND, plan);
  assert.deepStrictEqual(r.missing, ['Z']);
  assert.ok(r.ok);
  assert.ok([ground.nodes[3], ground.nodes[2]].some((n) => n[0] === r.end[0] && n[1] === r.end[1]), 'arriva su un raccordo della pista 16L');
  assert.strictEqual(Taxi.route(graph, { lat: 46, lon: 10 }, plan).reason, 'far');
  assert.strictEqual(Taxi.namedWays(ground, plan).length, 2);
});
