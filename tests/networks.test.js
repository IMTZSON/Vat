const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const N = require('../js/networks.js');

const fixture = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8'));

test('VATSIM: piloti e controllori nel formato comune (osservatori esclusi)', () => {
  const v = N.vatsim(fixture('vatsim-data-sample.json'));
  assert.strictEqual(v.net, 'vatsim');
  const aza = v.pilots.find((p) => p.callsign === 'AZA123');
  assert.deepStrictEqual(
    { dep: aza.dep, arr: aza.arr, aircraft: aza.aircraft, alt: aza.alt, gs: aza.gs, hdg: aza.hdg, cruise: aza.cruise, key: aza.key },
    { dep: 'LIRF', arr: 'EGLL', aircraft: 'A320', alt: 35012, gs: 452, hdg: 312, cruise: 36000, key: 'vatsim:AZA123' },
  );
  const cs = v.atc.map((c) => c.callsign);
  assert.ok(cs.includes('LIRR_CTR') && cs.includes('LIRF_ATIS'));
  assert.ok(!cs.includes('LIRF_OBS'));
  assert.ok(v.atc.find((c) => c.callsign === 'LIRF_ATIS').isAtis);
  assert.match(v.atc.find((c) => c.callsign === 'LIRR_CTR').freq, /^\d{3}\.\d{3}$/);
});

test('IVAO: whazzup v2, record incompleti saltati', () => {
  const v = N.ivao(fixture('ivao-whazzup.json'));
  assert.strictEqual(v.pilots.length, 2);
  const ity = v.pilots[0];
  assert.deepStrictEqual(
    { net: ity.net, callsign: ity.callsign, dep: ity.dep, arr: ity.arr, aircraft: ity.aircraft, alt: ity.alt, gs: ity.gs, cruise: ity.cruise },
    { net: 'ivao', callsign: 'ITY456', dep: 'LIRF', arr: 'EGLL', aircraft: 'A20N', alt: 35000, gs: 452, cruise: 35000 },
  );
  assert.ok(N.onGround(v.pilots[1]));
  assert.deepStrictEqual(v.atc.map((c) => [c.callsign, c.freq]), [['LIRR_CTR', '125.500'], ['LIRF_TWR', '118.700']]);
  assert.deepStrictEqual(N.ivao(null).pilots, []);
  assert.deepStrictEqual(N.ivao({ clients: { pilots: 'x' } }).pilots, []);
});

test('filtri: rete, fase del volo, ricerca, solo i miei aeroporti', () => {
  const all = [...N.vatsim(fixture('vatsim-data-sample.json')).pilots, ...N.ivao(fixture('ivao-whazzup.json')).pilots];
  assert.ok(N.filterPilots(all, { ivao: false }).every((p) => p.net === 'vatsim'));
  assert.ok(N.filterPilots(all, { phase: 'ground' }).every((p) => N.onGround(p)));
  assert.ok(N.filterPilots(all, { phase: 'high' }).every((p) => p.alt >= 24500));
  assert.deepStrictEqual(N.filterPilots(all, { query: 'ity4' }).map((p) => p.callsign), ['ITY456']);
  assert.ok(N.filterPilots(all, { query: 'EGLL' }).length >= 2, 'anche per aeroporto');
  assert.ok(N.filterPilots(all, { mine: { dep: 'LIRF', arr: 'EGLL' } }).every((p) => ['LIRF', 'EGLL'].includes(p.dep) || ['LIRF', 'EGLL'].includes(p.arr)));
  assert.deepStrictEqual(N.search(all, 'aza').map((p) => p.callsign).slice(0, 1), ['AZA123']);
});

test('livelli del piano di volo e frequenze', () => {
  assert.strictEqual(N.planLevel('FL350'), 35000);
  assert.strictEqual(N.planLevel('F350'), 35000);
  assert.strictEqual(N.planLevel('36000'), 36000);
  assert.strictEqual(N.planLevel('350'), 35000);
  assert.strictEqual(N.planLevel('A045'), 4500);
  assert.strictEqual(N.planLevel('VFR'), null);
  assert.strictEqual(N.freqText(125.5), '125.500');
  assert.strictEqual(N.freqText(118700), '118.700');
  assert.strictEqual(N.freqText(null), '');
});
