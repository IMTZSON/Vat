const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Sec = require('../js/sectors.js');
const W = require('../js/world.js');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'data', f), 'utf8');
const db = Sec.build(read('vatspy.dat'), JSON.parse(read('fir-boundaries.json')), JSON.parse(read('tracon-boundaries.json')), { airport: (x) => W.airport(x) });
const ids = (cs) => db.volumesFor(cs).map((v) => v.id);

test('dati inclusi: migliaia di settori reali', () => {
  assert.ok(db.stats.firs > 1000, JSON.stringify(db.stats));
  assert.ok(db.stats.tracons > 1000);
  assert.ok(db.stats.uirs > 30);
});

test('CTR: il confine FIR giusto, anche con prefissi non ICAO e sottosettori', () => {
  assert.deepStrictEqual(ids('LIRR_CTR'), ['FIR:LIRR']);
  assert.deepStrictEqual(ids('LON_S_CTR'), ['FIR:EGTT-S']);
  assert.deepStrictEqual(ids('LON_CTR'), ['FIR:EGTT']);
  assert.deepStrictEqual(ids('EDGG_N_CTR'), ['FIR:EDGG-N']);
  assert.deepStrictEqual(ids('PAR_CTR'), ['FIR:LFFF']);
  assert.deepStrictEqual(ids('NY_CTR'), ['FIR:KZNY']);
  assert.strictEqual(db.volumesFor('LIRR_CTR')[0].name, 'Roma Radar');
  assert.strictEqual(db.volumesFor('LON_S_CTR')[0].name, 'London ACC (South)');
});

test('settori oceanici e UIR', () => {
  assert.deepStrictEqual(ids('EGGX_FSS'), ['FIR:EGGX']);
  assert.deepStrictEqual(ids('EURN_FSS'), ['UIR:EURN']);
  assert.ok(db.volumesFor('EURN_FSS')[0].polygons.length > 3, 'una UIR unisce più FIR');
});

test('APP/DEP: area TRACON di SimAware, prefisso più lungo', () => {
  assert.deepStrictEqual(ids('EGLL_N_APP'), ['TRACON:EGLL']);
  assert.ok(ids('JFK_APP')[0].startsWith('TRACON:N90'));
  assert.ok(ids('LFPG_APP')[0].startsWith('TRACON:'));
});

test('cerchi solo dove non esiste un poligono pubblico', () => {
  const twr = db.volumesFor('LIRF_TWR')[0];
  assert.strictEqual(twr.radiusNM, 12);
  assert.ok(Math.abs(twr.center.lat - 41.8) < 0.1);
  assert.strictEqual(db.volumesFor('LIMC_DEL')[0].radiusNM, 3);
  assert.strictEqual(db.volumesFor('SFO_TWR')[0].airport, 'KSFO', 'alias IATA/LID');
  assert.deepStrictEqual(ids('LIRF_OBS'), [], 'gli osservatori non hanno settore');
  assert.deepStrictEqual(ids(''), []);
});

test('FIR che contiene un punto (le FIR vere vincono sui sottosettori)', () => {
  assert.strictEqual(db.firContaining(41.8, 12.25).id, 'FIR:LIRR');
  assert.match(db.firContaining(51.47, -0.46).id, /^FIR:EGT/, 'Londra (EGTT o l\'area più piccola EGTL)');
  assert.ok(Sec.contains(db.volumesFor('LIRF_TWR')[0], 41.85, 12.3));
  assert.ok(!Sec.contains(db.volumesFor('LIRF_TWR')[0], 42.5, 12.3));
});

test('parser VATSpy: righe, commenti, UIR in entrambi i formati', () => {
  const v = Sec.parseVatspy('; commento\n[Countries]\nItaly|LI|Radar\n[Airports]\nLIRF|Fiumicino|41.8|12.25|FCO|LIRR|0\n[FIRs]\nLIRR|Roma||LIRR\n[UIRs]\nEURX|Euro|LIRR,LIMM\nEURY|Euro Y|45|10|LIRR\n');
  assert.deepStrictEqual(v.firs[0], { icao: 'LIRR', name: 'Roma', prefix: 'LIRR', boundary: 'LIRR' });
  assert.deepStrictEqual(v.uirs[0].firs, ['LIRR', 'LIMM']);
  assert.deepStrictEqual(v.uirs[1].firs, ['LIRR']);
  assert.strictEqual(v.airports[0].lid, 'FCO');
});
