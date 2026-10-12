const test = require('node:test');
const assert = require('node:assert');
const SimBrief = require('../js/simbrief.js');

const OFP = {
  fetch: { status: 'Success' },
  params: { units: 'kgs' },
  general: { icao_airline: 'AZA', flight_number: '1234', initial_altitude: '36000', route: 'BOLLA UL50 TORLI', passengers: '162' },
  origin: { icao_code: 'LIRF', name: 'Rome Fiumicino', plan_rwy: '25', pos_lat: '41.800278', pos_long: '12.238889' },
  destination: { icao_code: 'LIMC', name: 'Milan Malpensa', plan_rwy: '35L', pos_lat: '45.630606', pos_long: '8.728111' },
  alternate: { icao_code: 'LIML' },
  aircraft: { icaocode: 'A20N', name: 'A320neo', reg: 'EI-DTA' },
  atc: { callsign: 'AZA1234' },
  fuel: { plan_ramp: '6500' },
  weights: { est_zfw: '58000', est_tow: '64000' },
  times: { est_time_enroute: '3900', sched_out: '1760000000' },
  navlog: { fix: [
    { ident: 'BOLLA', via_airway: 'BOLLA5A', is_sid_star: '1', pos_lat: '42.1', pos_long: '11.9' },
    { ident: 'TORLI', via_airway: 'UL50', is_sid_star: '0', pos_lat: '43.7', pos_long: '10.5' },
    { ident: 'SRN', via_airway: 'SRN1A', is_sid_star: '1', pos_lat: '45.4', pos_long: '9.0' },
  ] },
};

test('legge un OFP SimBrief', () => {
  const f = SimBrief.parse(OFP);
  assert.strictEqual(f.callsign, 'AZA1234');
  assert.strictEqual(f.dep, 'LIRF');
  assert.strictEqual(f.arr, 'LIMC');
  assert.strictEqual(f.depRwy, '25');
  assert.strictEqual(f.cruise, 360);
  assert.strictEqual(f.sid, 'BOLLA5A');
  assert.strictEqual(f.star, 'SRN1A');
  assert.strictEqual(f.aircraft, 'A20N');
  assert.strictEqual(f.pax, 162);
  assert.deepStrictEqual(f.depPos, { lat: 41.800278, lon: 12.238889 });
  assert.strictEqual(f.fixes.length, 3);
  assert.deepStrictEqual(f.fixes[1], { ident: 'TORLI', lat: 43.7, lon: 10.5 });
});

test('errore SimBrief leggibile', () => {
  assert.throws(() => SimBrief.parse({ fetch: { status: 'Error: Unknown UserID' } }), /Unknown UserID/);
});

test('OFP con un solo fix (oggetto, non lista)', () => {
  const f = SimBrief.parse({ ...OFP, navlog: { fix: { ident: 'X', via_airway: 'DCT', is_sid_star: '0' } } });
  assert.strictEqual(f.sid, null);
});
