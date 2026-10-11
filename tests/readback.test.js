const test = require('node:test');
const assert = require('node:assert');
const { generateReadback, parseCallsign } = require('../js/readback.js');

const rb = (text, callsign = 'AZA123') => generateReadback(text, { callsign });

const CASES = [
  ['Alitalia 123, descend FL80, turn left heading 270, contact Roma 125.5',
    'Descend FL80, left heading 270, Roma 125.5, Alitalia 123'],
  ['alitalia one two three descend flight level eight zero turn left heading two seven zero contact roma radar one two five decimal five',
    'Descend FL80, left heading 270, Roma Radar 125.5, Alitalia 123'],
  ['Alitalia 123 climb and maintain flight level one two zero',
    'Climb FL120, Alitalia 123'],
  ['alitalia 123 descend to altitude 4000 feet QNH 1013',
    'Descend 4000 ft, QNH 1013, Alitalia 123'],
  ['alitalia 123 descend three thousand five hundred feet q n h one zero zero niner',
    'Descend 3500 ft, QNH 1009, Alitalia 123'],
  ['Alitalia 123 squawk 4521',
    'Squawk 4521, Alitalia 123'],
  ['Alitalia 123 runway 16L cleared to land wind 160 degrees 5 knots',
    'Runway 16L, cleared to land, Alitalia 123'],
  ['Alitalia 123 wind 250 degrees 8 knots runway 25 cleared for takeoff',
    'Runway 25, cleared for takeoff, Alitalia 123'],
  ['alitalia 123 line up and wait runway 34 right',
    'Line up and wait runway 34R, Alitalia 123'],
  ['Alitalia 123 taxi to holding point runway 16L via alpha bravo hold short of runway 16R',
    'Taxi to holding point runway 16L via A, B, holding short runway 16R, Alitalia 123'],
  ['Alitalia 123 cleared to Milano Malpensa via BOLLA 5A departure, climb initially 6000 feet, squawk 4521',
    'Cleared to Milano Malpensa, BOLLA 5A departure, initial climb 6000 ft, squawk 4521, Alitalia 123'],
  ['Alitalia 123 reduce speed 180 knots',
    'Reduce speed 180 kt, Alitalia 123'],
  ['Alitalia 123 speed 250 knots or greater',
    'Speed 250 kt or greater, Alitalia 123'],
  ['Alitalia 123 proceed direct TORLI',
    'Direct TORLI, Alitalia 123'],
  ['Alitalia 123 turn right heading 090 cleared ILS approach runway 16L',
    'Right heading 090, cleared ILS approach runway 16L, Alitalia 123'],
  ['Alitalia 123 push and start approved face south',
    'Push and start approved, facing south, Alitalia 123'],
  ['Alitalia 123 contact Roma Ground 121.8 goodbye',
    'Roma Ground 121.8, Alitalia 123'],
  ['Alitalia 123 radar contact',
    'Roger, Alitalia 123'],
  ['Alitalia 123 report established localizer',
    'Wilco, Alitalia 123'],
  ['Alitalia 123 hold position',
    'Holding position, Alitalia 123'],
  ['Alitalia 123 descend flight level one hundred',
    'Descend FL100, Alitalia 123'],
  ['Alitalia 123 climb flight level one twenty',
    'Climb FL120, Alitalia 123'],
  ['Alitalia 123 descend via STAR',
    'Descend via STAR, Alitalia 123'],
  ['Alitalia 123 contact Milano Approach 126.75',
    'Milano Approach 126.75, Alitalia 123'],
];

for (const [input, expected] of CASES) {
  test(input, () => {
    assert.strictEqual(rb(input).readback, expected);
  });
}

test('pronuncia ICAO', () => {
  const r = rb('Alitalia 123, descend FL80, turn left heading 270, contact Roma 125.5, squawk 4521');
  assert.strictEqual(r.spoken,
    'descend flight level eight zero, left heading two seven zero, Roma one two five decimal five, squawk four five two one, Alitalia one two three');
  const a = rb('alitalia 123 descend 3500 feet');
  assert.strictEqual(a.spoken, 'descend three thousand five hundred feet, Alitalia one two three');
});

test('riconosce se la chiamata è per noi', () => {
  assert.strictEqual(rb('Alitalia 123 climb FL120').forUs, true);
  assert.strictEqual(rb('Ryanair 45 climb FL120').forUs, false);
  assert.strictEqual(rb('Alitalia 456 climb FL120').forUs, false);
  assert.strictEqual(rb('Lufthansa 4 alpha bravo climb FL120', 'DLH4AB').forUs, true);
  assert.strictEqual(rb('India Alpha Bravo Charlie Delta squawk 7000', 'I-ABCD').forUs, true);
  assert.strictEqual(rb('India Charlie Delta squawk 7000', 'I-ABCD').forUs, true);
  assert.strictEqual(rb('climb FL120', '').forUs, null);
});

test('avvisi su valori sospetti', () => {
  assert.ok(rb('Alitalia 123 squawk 4891').warnings.length > 0);
  assert.ok(rb('Alitalia 123 qnh 1913').warnings.length > 0);
});

test('nominativi', () => {
  assert.strictEqual(parseCallsign('AZA123').display, 'Alitalia 123');
  assert.strictEqual(parseCallsign('ryr45ab').display, 'Ryanair 45AB');
  assert.strictEqual(parseCallsign('I-ABCD').spoken, 'India Alpha Bravo Charlie Delta');
  assert.strictEqual(parseCallsign('XYZ123', 'Foobar').display, 'Foobar 123');
});

test('chiamata per altri: niente nostro nominativo in fondo', () => {
  assert.strictEqual(rb('Ryanair 45 climb FL240').readback, 'Climb FL240');
});

test('errori tipici del riconoscimento vocale', () => {
  assert.strictEqual(rb('Alitalia 123 squad 4521 q and h 1013').readback, 'Squawk 4521, QNH 1013, Alitalia 123');
  assert.strictEqual(rb('Alitalia 123 contact Roma radar 125 5').readback, 'Roma Radar 125.5, Alitalia 123');
  assert.strictEqual(rb('alitalia 123 descend fly level 90').readback, 'Descend FL90, Alitalia 123');
});
