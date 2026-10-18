const test = require('node:test');
const assert = require('node:assert');
const N = require('../js/nextcall.js');
const R = require('../js/readback.js');

const cs = R.parseCallsign('AZA123');
const CTX = { cs: { display: cs.display, spoken: cs.spoken }, flight: { dep: 'LIRF', arr: 'LIMC', depRwy: '16L', arrRwy: '35R', aircraft: 'A320', cruise: 360 }, depCity: 'Roma', arrCity: 'Milano', stand: '305', atisDep: 'B', atisArr: 'K' };
const hear = (state, text) => N.observe(state, R.generateReadback(text, { callsign: cs }));

test('un volo intero: la prossima chiamata segue le istruzioni ATC', () => {
  let s = N.emptyState();
  let n = N.suggest(s, { ...CTX, phase: 'parked', depStation: 'Delivery' });
  assert.strictEqual(n.key, 'next.clearance');
  assert.strictEqual(n.text, 'Roma Delivery, Alitalia 123, A320, stand 305, information Bravo, request IFR clearance to Milano');

  s = hear(s, 'Alitalia 123 cleared to Milano Malpensa via TORLI 5A departure climb initially 6000 feet squawk 4521');
  n = N.suggest(s, { ...CTX, phase: 'parked' });
  assert.strictEqual(n.key, 'next.push');

  s = hear(s, 'Alitalia 123 contact Roma Ground 121.8');
  n = N.suggest(s, { ...CTX, phase: 'parked' });
  assert.strictEqual(n.key, 'next.push');
  assert.strictEqual(n.station, 'Roma Ground');
  assert.strictEqual(n.freq, '121.8');
  assert.strictEqual(n.text, 'Roma Ground, Alitalia 123, stand 305, request pushback and startup');

  s = hear(s, 'Alitalia 123 pushback and startup approved facing south');
  assert.strictEqual(N.suggest(s, { ...CTX, phase: 'parked' }).key, 'next.taxi');
  s = hear(s, 'Alitalia 123 taxi to holding point A2 runway 16L via B');
  n = N.suggest(s, { ...CTX, phase: 'taxi-out' });
  assert.strictEqual(n.key, 'next.ready');
  assert.match(n.spoken, /runway one six left, ready for departure/);

  s = hear(s, 'Alitalia 123 contact Roma Tower 118.7');
  n = N.suggest(s, { ...CTX, phase: 'taxi-out' });
  assert.strictEqual(n.text, 'Roma Tower, Alitalia 123, holding point runway 16L, ready for departure');
  assert.strictEqual(n.freq, '118.7');

  s = hear(s, 'Alitalia 123 runway 16L cleared for takeoff wind 240 8 knots');
  assert.strictEqual(N.suggest(s, { ...CTX, phase: 'takeoff' }), null);

  s = hear(s, 'Alitalia 123 contact Roma Radar 125.5');
  n = N.suggest(s, { ...CTX, phase: 'climb', alt: 4300 });
  assert.strictEqual(n.key, 'next.firstClimb');
  assert.strictEqual(n.text, 'Roma Radar, Alitalia 123, passing 4300 feet, climbing 6000 feet');

  s = hear(s, 'Alitalia 123 climb flight level 240');
  s = hear(s, 'Alitalia 123 contact Milano Control 134.875');
  n = N.suggest(s, { ...CTX, phase: 'cruise', alt: 36000 });
  assert.strictEqual(n.text, 'Milano Control, Alitalia 123, flight level 360');

  s = hear(s, 'Alitalia 123 roger');
  assert.strictEqual(N.suggest(s, { ...CTX, phase: 'cruise', alt: 36000, toTod: 80 }), null);
  assert.strictEqual(N.suggest(s, { ...CTX, phase: 'cruise', alt: 36000, toTod: 12 }).text, 'Alitalia 123, request descent');

  s = hear(s, 'Alitalia 123 descend flight level 120');
  s = hear(s, 'Alitalia 123 contact Milano Approach 126.75');
  n = N.suggest(s, { ...CTX, phase: 'descent', alt: 15000 });
  assert.strictEqual(n.text, 'Milano Approach, Alitalia 123, descending flight level 120, information Kilo');

  s = hear(s, 'Alitalia 123 cleared ILS approach runway 35R');
  assert.strictEqual(N.suggest(s, { ...CTX, phase: 'approach' }).text, 'Milano Tower, Alitalia 123, established ILS runway 35R');
  s = hear(s, 'Alitalia 123 contact Milano Tower 119.0');
  assert.strictEqual(N.suggest(s, { ...CTX, phase: 'approach' }).key, 'next.established');
  s = hear(s, 'Alitalia 123 runway 35R cleared to land');
  s = hear(s, 'Alitalia 123 vacate left via B then contact ground 121.9');
  n = N.suggest(s, { ...CTX, phase: 'taxi-in' });
  assert.strictEqual(n.text, 'Milano Ground, Alitalia 123, runway 35R vacated, request taxi to stand');
  assert.strictEqual(n.freq, '121.9');
});

test('le chiamate per altri non cambiano lo stato; "fatto" salta la proposta', () => {
  let s = N.emptyState();
  s = N.observe(s, R.generateReadback('Ryanair 45AB contact Roma Ground 121.8', { callsign: cs }));
  assert.strictEqual(s.handoff, null);
  const n = N.suggest(s, { ...CTX, phase: 'parked' });
  s = N.markDone(s, n.id);
  assert.strictEqual(N.suggest(s, { ...CTX, phase: 'parked' }), null);
  s = hear(s, 'Alitalia 123 cleared to Milano Malpensa via TORLI 5A departure climb initially 6000 feet squawk 4521');
  assert.strictEqual(N.suggest(s, { ...CTX, phase: 'parked' }).key, 'next.push', 'una nuova istruzione riattiva i suggerimenti');
});

test('nomi e tipi di stazione', () => {
  assert.strictEqual(N.stationKind('Roma Radar'), 'radar');
  assert.strictEqual(N.stationKind('Ground'), 'ground');
  assert.strictEqual(N.stationKind('Milano Approach'), 'approach');
  assert.strictEqual(N.stationKind('Malpensa Tower'), 'tower');
  assert.deepStrictEqual(N.clearedLevel('Climb FL240'), ['flight level 240', 'flight level two four zero']);
});
