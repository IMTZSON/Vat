const test = require('node:test');
const assert = require('node:assert');
const E = require('../js/emergency.js');

const cs = { display: 'Alitalia 123', spoken: 'Alitalia one two three' };

test('MAYDAY nell\'ordine ICAO, con pronuncia radio e squawk 7700', () => {
  const m = E.build({ kind: 'mayday', station: 'Roma Radar', cs, nature: 'engine', intent: 'divert', divertName: 'Firenze', place: { name: 'Firenze', dist: 24.6, bearing: 44 }, alt: 23960, vs: -1800, hdg: 95, fuelMin: 85, pob: 168 });
  assert.strictEqual(m.display, 'MAYDAY MAYDAY MAYDAY, Roma Radar, Alitalia 123, engine failure, request diversion to Firenze, 25 miles north-east of Firenze, passing FL240 descending, heading 095, fuel endurance 1 hour 25 minutes, 168 persons on board');
  assert.match(m.spoken, /^Mayday Mayday Mayday, Roma Radar, Alitalia one two three, .*two five miles north-east.*passing flight level two four zero descending, heading zero niner five, fuel endurance one hour two five minutes, one six eight persons on board$/);
  assert.strictEqual(m.squawk, '7700');
  assert.match(m.replies[0].atc, /roger MAYDAY, squawk 7700/);
  assert.ok(m.replies.some((r) => /stop transmitting/.test(r.atc) && r.pilot === null));
  assert.match(m.replies.find((r) => /persons on board/.test(r.atc)).pilot, /^168 persons on board, fuel endurance 1 hour 25 minutes, Alitalia 123$/);
  assert.strictEqual(m.cancel, 'Roma Radar, Alitalia 123, cancel MAYDAY');
});

test('PAN PAN medico, MAYDAY FUEL, discesa di emergenza, a terra senza posizione', () => {
  const p = E.build({ kind: 'panpan', station: 'Milano Control', cs, nature: 'medical', intent: 'continue', arrName: 'Malpensa', alt: 36000, vs: 0, hdg: 320 });
  assert.match(p.display, /^PAN PAN, PAN PAN, PAN PAN, Milano Control, Alitalia 123, passenger medical emergency, continuing to Malpensa, request priority landing, FL360, heading 320$/);
  assert.strictEqual(p.squawk, null);
  assert.ok(!p.replies.some((r) => /stop transmitting/.test(r.atc)));
  const f = E.build({ kind: 'mayday', cs, nature: 'fuel', intent: 'nearest' });
  assert.match(f.display, /^MAYDAY MAYDAY MAYDAY FUEL, Alitalia 123, fuel emergency, request vectors/);
  const d = E.build({ kind: 'mayday', cs, nature: 'decompression', intent: 'descend', descendTo: 10000, alt: 37000, vs: -4000, hdg: 180 });
  assert.match(d.display, /rapid decompression, emergency descent to FL100, heading 180$/);
  assert.match(d.spoken, /emergency descent to flight level one hundred/);
  const g = E.build({ kind: 'mayday', cs, nature: 'fire', intent: 'hold', onGround: true, place: { name: 'Roma', dist: 0, bearing: 0 }, alt: 100, hdg: 160 });
  assert.strictEqual(g.display, 'MAYDAY MAYDAY MAYDAY, Alitalia 123, engine fire, request holding to troubleshoot');
});
