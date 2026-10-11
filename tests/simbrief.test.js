const test = require('node:test');
const assert = require('node:assert');
const SimBrief = require('../js/simbrief.js');

const OFP = {
  fetch: { status: 'Success' },
  params: { units: 'kgs' },
  general: { icao_airline: 'AZA', flight_number: '1234', initial_altitude: '36000', route: 'BOLLA UL50 TORLI' },
  origin: { icao_code: 'LIRF', name: 'Rome Fiumicino', plan_rwy: '25' },
  destination: { icao_code: 'LIMC', name: 'Milan Malpensa', plan_rwy: '35L' },
  alternate: { icao_code: 'LIML' },
  aircraft: { icaocode: 'A20N', name: 'A320neo', reg: 'EI-DTA' },
  atc: { callsign: 'AZA1234' },
  fuel: { plan_ramp: '6500' },
  weights: { est_zfw: '58000', est_tow: '64000' },
  times: { est_time_enroute: '3900', sched_out: '1760000000' },
  navlog: { fix: [
    { ident: 'BOLLA', via_airway: 'BOLLA5A', is_sid_star: '1' },
    { ident: 'TORLI', via_airway: 'UL50', is_sid_star: '0' },
    { ident: 'SRN', via_airway: 'SRN1A', is_sid_star: '1' },
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
});

test('errore SimBrief leggibile', () => {
  assert.throws(() => SimBrief.parse({ fetch: { status: 'Error: Unknown UserID' } }), /Unknown UserID/);
});

test('OFP con un solo fix (oggetto, non lista)', () => {
  const f = SimBrief.parse({ ...OFP, navlog: { fix: { ident: 'X', via_airway: 'DCT', is_sid_star: '0' } } });
  assert.strictEqual(f.sid, null);
});
