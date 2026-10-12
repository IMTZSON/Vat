const test = require('node:test');
const assert = require('node:assert');
const W = require('../js/world.js');
const R = require('../js/readback.js');
const Sc = require('../js/scenarios.js');
const B = require('../scripts/build-data.js');

test('database mondiale caricato: migliaia di aeroporti con piste', () => {
  assert.ok(W.loaded);
  const egll = W.airport('EGLL');
  assert.ok(egll.rwys.includes('27L') && egll.rwys.includes('09R'));
  assert.ok(Math.abs(egll.lat - 51.47) < 0.05);
  assert.strictEqual(W.airport('egll').icao, 'EGLL');
  assert.strictEqual(W.airport('ZZZZ'), null);
  assert.strictEqual(W.airport(''), null);
});

test('gli aeroporti italiani curati hanno la precedenza su nomi e centro', () => {
  const a = W.airport('LIRF');
  assert.strictEqual(a.city, 'Roma');
  assert.strictEqual(a.acc, 'Roma');
  assert.ok(a.rwys.includes('16L'));
});

test('nomi radio delle stazioni VATSIM', () => {
  assert.strictEqual(W.stationName('LIRF_TWR'), 'Roma Tower');
  assert.strictEqual(W.stationName('LIRR_CTR'), 'Roma Radar');
  assert.strictEqual(W.stationName('LON_S_CTR'), 'London Control');
  assert.match(W.stationName('JFK_TWR'), /New York Tower/);
  assert.strictEqual(W.stationName('XXXX_GND'), 'XXXX Ground');
});

test('nominativi radio dal database mondiale, ma l\'elenco curato vince', () => {
  assert.strictEqual(R.parseCallsign('VLG1234').display, 'Vueling 1234');
  assert.strictEqual(R.parseCallsign('THY1').display, 'Turkish 1', 'curato: Turkish, non Turkair');
  assert.strictEqual(R.parseCallsign('ITY123').display, 'Itarrow 123');
  assert.strictEqual(R.parseCallsign('QQQ12').type, 'unknown');
});

test('aeroporti vicini', () => {
  const near = W.nearest(41.8, 12.25, 3).map((a) => a.icao);
  assert.strictEqual(near[0], 'LIRF');
});

test('allenamento fuori dall\'Italia: piste e stazioni reali', () => {
  const c = Sc.makeContext({ dep: 'EGLL', arr: 'EDDF' }, () => 0.5);
  assert.strictEqual(c.dep.city, 'London');
  assert.ok(W.airport('EGLL').rwys.includes(c.depRwy), c.depRwy);
  assert.ok(W.airport('EDDF').rwys.includes(c.arrRwy), c.arrRwy);
  const steps = Sc.fullFlight({ dep: 'EGLL', arr: 'EDDF', seed: 7 });
  assert.ok(steps.some((s) => /London Ground/.test(s.station)));
  assert.ok(steps.some((s) => /Langen Control/.test(s.station)));
});

test('build-data: CSV con virgolette, virgole e righe vuote', () => {
  const rows = B.parseCsv('a,b,c\n"x, y","say ""hi""",3\r\n\n1,2,3\n');
  assert.deepStrictEqual(rows, [['a', 'b', 'c'], ['x, y', 'say "hi"', '3'], ['1', '2', '3']]);
});

test('build-data: piste chiuse ed eliporti esclusi, codici normalizzati', () => {
  const airports = 'ident,type,name,latitude_deg,longitude_deg,iso_country,municipality,icao_code,gps_code\n'
    + 'LIRF,large_airport,Fiumicino,41.8,12.25,IT,Rome (RM),LIRF,LIRF\n'
    + 'XH1,heliport,Heli,1,1,IT,X,,\n'
    + '00AA,small_airport,Ranch,1,1,US,Leoti,,\n';
  const runways = 'airport_ident,closed,le_ident,he_ident\nLIRF,0,16L,34R\nLIRF,1,07,25\nXH1,0,H1,\n00AA,0,N,S\n';
  const out = B.buildAirports(airports, runways, { LIRF: 'LIRR' });
  assert.deepStrictEqual(Object.keys(out), ['LIRF']);
  assert.deepStrictEqual(out.LIRF, ['Fiumicino', 'Rome', 41.8, 12.25, '16L 34R', 'IT', 'LIRR']);
});

test('build-data: compagnie attive con sigle maiuscole', () => {
  const dat = '1,"KLM Royal Dutch",\\N,"KL","KLM","KLM","Netherlands","Y"\n2,"Old","\\N","","OLD","OLDIE","X","N"\n3,"Easy","\\N","U2","EZY","EASY","UK","Y"\n';
  assert.deepStrictEqual(B.buildAirlines(dat), { EZY: 'Easy', KLM: 'KLM' });
});
