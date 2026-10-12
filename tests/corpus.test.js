/* Corpus di regressione: frasi ATC realistiche con il readback atteso.
   Ogni frase viene provata anche (1) senza punteggiatura e in minuscolo, come la scrive il
   riconoscimento vocale di Chrome, e (2) con i numeri pronunciati cifra per cifra.
   Ogni errore segnalato da chi usa l'app va aggiunto qui. */
const test = require('node:test');
const assert = require('node:assert');
const R = require('../js/readback.js');

// [callsign, frase ATC, readback atteso, opzioni]  (opzioni: { spell: false } se la variante a parole non ha senso)
const CASES = [
  // ---------------------------------------------------------------- Delivery
  ['AZA123', 'Alitalia 123, cleared to Milano Malpensa via TORLI 5A departure, runway 25, climb initially 6000 feet, squawk 4521',
    'Cleared to Milano Malpensa, TORLI 5A departure, runway 25, initial climb 6000 ft, squawk 4521, Alitalia 123'],
  ['AZA123', 'Alitalia 123, cleared to LIMC via flight planned route, BOLLA 1E departure, initial climb altitude 5000 feet, squawk 3412',
    'Cleared to LIMC, BOLLA 1E departure, flight planned route, initial climb 5000 ft, squawk 3412, Alitalia 123'],
  ['AZA123', 'Alitalia 123, cleared to Malpensa airport, TORLI 5A departure, flight planned route, climb 6000 feet, squawk 4521, departure frequency 125.5',
    'Cleared to Malpensa, TORLI 5A departure, flight planned route, climb 6000 ft, squawk 4521, Departure 125.5, Alitalia 123'],
  ['AZA123', 'Alitalia 123, cleared to Roma Fiumicino via BOLLA 5A departure, climb initially 6000 feet, expect flight level 360 10 minutes after departure, squawk 2741',
    'Cleared to Roma Fiumicino, BOLLA 5A departure, initial climb 6000 ft, expect FL360 10 min after departure, squawk 2741, Alitalia 123'],
  ['RYR45AB', 'Ryanair 45AB, cleared to Bergamo, RITEB 2C departure, climb initially 5000 feet, squawk 6123',
    'Cleared to Bergamo, RITEB 2C departure, initial climb 5000 ft, squawk 6123, Ryanair 45AB'],
  ['AZA123', 'Alitalia 123, information Charlie is current, QNH 1015', 'Information Charlie, QNH 1015, Alitalia 123'],
  ['AZA123', 'Alitalia 123, readback correct, contact Ground 121.8', 'Ground 121.8, Alitalia 123'],
  ['AZA123', 'Alitalia 123, startup approved, QNH 1012', 'Startup approved, QNH 1012, Alitalia 123'],

  // ---------------------------------------------------------------- Ground
  ['AZA123', 'Alitalia 123, pushback approved, tail east', 'Pushback approved, tail east, Alitalia 123'],
  ['AZA123', 'Alitalia 123, push and start approved, facing south', 'Push and start approved, facing south, Alitalia 123'],
  ['AZA123', 'Alitalia 123, push and start approved, expect runway 16R', 'Push and start approved, expect runway 16R, Alitalia 123'],
  ['AZA123', 'Alitalia 123, taxi to holding point runway 25 via Kilo, Delta, Alpha', 'Taxi to holding point runway 25, via Kilo, Delta, Alpha, Alitalia 123'],
  ['AZA123', 'Alitalia 123, taxi holding point Alpha 2, runway 26L via Papa Alpha Sierra', 'Taxi holding point Alpha 2, runway 26L, via Papa, Alpha, Sierra, Alitalia 123'],
  ['AZA123', 'Alitalia 123, taxi via Bravo, Charlie to holding point Charlie 3 runway 34L', 'Taxi via Bravo, Charlie to holding point Charlie 3, runway 34L, Alitalia 123'],
  ['AZA123', 'Alitalia 123, taxi to holding point runway 16L via Alpha, Bravo, hold short of runway 16R',
    'Taxi to holding point runway 16L, via Alpha, Bravo, holding short runway 16R, Alitalia 123'],
  ['AZA123', 'Alitalia 123, hold short of runway 16L', 'Holding short runway 16L, Alitalia 123'],
  ['AZA123', 'Alitalia 123, cross runway 16L, then taxi via Alpha to holding point runway 25', 'Cross runway 16L, taxi via Alpha to holding point runway 25, Alitalia 123'],
  ['AZA123', 'Alitalia 123, give way to the Lufthansa A320 from left to right', 'Giving way to the Lufthansa A320, Alitalia 123'],
  ['AZA123', 'Alitalia 123, continue taxi, contact Tower 118.7', 'Continue taxi, Tower 118.7, Alitalia 123'],
  ['AZA123', 'Alitalia 123, hold position', 'Holding position, Alitalia 123'],
  ['AZA123', 'Alitalia 123, taxi to stand 205 via Tango, Mike', 'Taxi to stand 205, via Tango, Mike, Alitalia 123'],
  ['AZA123', 'Alitalia 123, contact Tower on 118.700', 'Tower 118.7, Alitalia 123'],
  ['AZA123', 'Alitalia 123, monitor Tower 118.7', 'Monitor Tower 118.7, Alitalia 123'],

  // ---------------------------------------------------------------- Tower
  ['AZA123', 'Alitalia 123, runway 25, line up and wait', 'Runway 25, line up and wait, Alitalia 123'],
  ['AZA123', 'Alitalia 123, behind the landing A320, line up and wait runway 25, behind', 'Behind the landing A320, line up and wait runway 25, behind, Alitalia 123'],
  ['AZA123', 'Alitalia 123, wind 250 degrees 10 knots, runway 25, cleared for take-off', 'Runway 25, cleared for takeoff, Alitalia 123'],
  ['AZA123', 'Alitalia 123, runway 25, cleared for takeoff, wind 240 degrees 12 knots gusting 22', 'Runway 25, cleared for takeoff, Alitalia 123'],
  ['AZA123', 'Alitalia 123, after departure turn left heading 180, runway 25 cleared for takeoff', 'After departure, left heading 180, runway 25, cleared for takeoff, Alitalia 123'],
  ['AZA123', 'Alitalia 123, contact Roma Departure 125.5, good day', 'Roma Departure 125.5, Alitalia 123'],
  ['AZA123', 'Alitalia 123, wind 160 degrees 4 knots, runway 16L, cleared to land', 'Runway 16L, cleared to land, Alitalia 123'],
  ['AZA123', 'Alitalia 123, runway 16L, cleared to land, wind 170 degrees 8 knots', 'Runway 16L, cleared to land, Alitalia 123'],
  ['AZA123', 'Alitalia 123, continue approach, number 2, traffic on short final', 'Continue approach, Alitalia 123'],
  ['AZA123', 'Alitalia 123, go around, climb 3000 feet, turn right heading 360', 'Going around, climb 3000 ft, right heading 360, Alitalia 123'],
  ['AZA123', 'Alitalia 123, vacate via Bravo 3, contact Ground 121.9', 'Vacate via Bravo 3, Ground 121.9, Alitalia 123'],
  ['AZA123', 'Alitalia 123, vacate left via Bravo, contact Ground 121.8', 'Vacate left via Bravo, Ground 121.8, Alitalia 123'],

  // ---------------------------------------------------------------- Partenza / radar
  ['AZA123', 'Alitalia 123, Roma Radar, radar contact, climb flight level 140', 'Climb FL140, Alitalia 123'],
  ['AZA123', 'Alitalia 123, identified, climb flight level 240, proceed direct ELKAP', 'Climb FL240, direct ELKAP, Alitalia 123'],
  ['AZA123', 'Alitalia 123, climb and maintain flight level 360', 'Climb FL360, Alitalia 123'],
  ['AZA123', 'Alitalia 123, climb to flight level 250, no speed restriction', 'Climb FL250, no speed restrictions, Alitalia 123'],
  ['AZA123', 'Alitalia 123, turn right heading 095, climb 7000 feet', 'Right heading 095, climb 7000 ft, Alitalia 123'],
  ['AZA123', 'Alitalia 123, maintain flight level 180, expect higher in 5 minutes', 'Maintain FL180, Alitalia 123'],
  ['AZA123', 'Alitalia 123, stop climb at flight level 200', 'Stop climb at FL200, Alitalia 123'],
  ['AZA123', 'Alitalia 123, climb flight level 300, rate of climb 1500 feet per minute or greater', 'Climb FL300, rate of climb 1500 ft/min or greater, Alitalia 123'],
  ['AZA123', 'Alitalia 123, resume own navigation direct GILIX', 'Direct GILIX, Alitalia 123'],
  ['AZA123', 'Alitalia 123, contact Milano Control 134.875', 'Milano Control 134.875, Alitalia 123'],
  ['AZA123', 'Alitalia 123, contact Padova 120.725, bye bye', 'Padova 120.725, Alitalia 123'],
  ['AZA123', 'Alitalia 123, squawk 2361', 'Squawk 2361, Alitalia 123'],
  ['AZA123', 'Alitalia 123, squawk ident', 'Squawk ident, Alitalia 123'],
  ['AZA123', 'Alitalia 123, recycle squawk 4512', 'Squawk 4512, Alitalia 123'],
  ['AZA123', 'Alitalia 123, maintain Mach 0.78', 'Maintain Mach 0.78, Alitalia 123', { spell: false }],
  ['AZA123', 'Alitalia 123, turn left 10 degrees, report heading', 'Turn left 10 degrees, wilco, Alitalia 123'],
  ['AZA123', 'Alitalia 123, turn left heading 270', 'Left heading 270, Alitalia 123'],
  ['AZA123', 'Alitalia 123, fly heading 090', 'Heading 090, Alitalia 123'],
  ['AZA123', 'Alitalia 123, continue present heading', 'Continue present heading, Alitalia 123'],
  ['BAW12', 'Speedbird 12, climb flight level 320', 'Climb FL320, Speedbird 12'],

  // ---------------------------------------------------------------- Crociera / discesa
  ['AZA123', 'Alitalia 123, descend flight level 120, expect ILS approach runway 16L', 'Descend FL120, expect ILS approach runway 16L, Alitalia 123'],
  ['AZA123', 'Alitalia 123, descend to flight level 100, reach by DIPAL', 'Descend FL100 level by DIPAL, Alitalia 123'],
  ['AZA123', 'Alitalia 123, when ready descend flight level 230', 'When ready, descend FL230, Alitalia 123'],
  ['AZA123', 'Alitalia 123, descend now flight level 80, reduce speed 250 knots', 'Descend FL80, reduce speed 250 kt, Alitalia 123'],
  ['AZA123', 'Alitalia 123, cleared DIPAL 2A arrival, descend flight level 100', 'Cleared DIPAL 2A arrival, descend FL100, Alitalia 123'],
  ['AZA123', 'Alitalia 123, descend flight level 100', 'Descend FL100, Alitalia 123'],
  ['AZA123', 'Alitalia 123, descend via STAR', 'Descend via STAR, Alitalia 123'],
  ['AZA123', 'Alitalia 123, hold over BOLLA as published, expect further clearance at 1530', 'Hold over BOLLA as published, expect further clearance 1530, Alitalia 123'],
  ['AZA123', 'Alitalia 123, contact Roma Approach 119.2', 'Roma Approach 119.2, Alitalia 123'],

  // ---------------------------------------------------------------- Avvicinamento
  ['AZA123', 'Alitalia 123, Roma Approach, descend to altitude 5000 feet, QNH 1009', 'Descend 5000 ft, QNH 1009, Alitalia 123'],
  ['AZA123', 'Alitalia 123, descend 4000 feet QNH 1013, turn left heading 230', 'Descend 4000 ft, QNH 1013, left heading 230, Alitalia 123'],
  ['AZA123', 'Alitalia 123, descend altitude 3500 feet, QNH 998', 'Descend 3500 ft, QNH 998, Alitalia 123'],
  ['AZA123', 'Alitalia 123, turn right heading 160, cleared ILS runway 16L, report established', 'Right heading 160, cleared ILS approach runway 16L, wilco, Alitalia 123'],
  ['AZA123', 'Alitalia 123, 10 miles from touchdown, cleared ILS approach runway 16L', 'Cleared ILS approach runway 16L, Alitalia 123'],
  ['AZA123', 'Alitalia 123, reduce speed 180 knots until 4 miles final', 'Reduce speed 180 kt until 4 DME, Alitalia 123'],
  ['AZA123', 'Alitalia 123, speed 160 knots until 4 DME', 'Speed 160 kt until 4 DME, Alitalia 123'],
  ['AZA123', 'Alitalia 123, maintain 170 knots, contact Tower 119.2', 'Maintain 170 kt, Tower 119.2, Alitalia 123'],
  ['AZA123', 'Alitalia 123, cleared RNAV approach runway 34L', 'Cleared RNAV approach runway 34L, Alitalia 123'],
  ['AZA123', 'Alitalia 123, cleared visual approach runway 25', 'Cleared visual approach runway 25, Alitalia 123'],
  ['AZA123', 'Alitalia 123, transition level 70, descend altitude 6000 feet QNH 1020', 'Transition level 70, descend 6000 ft, QNH 1020, Alitalia 123'],
  ['AZA123', 'Alitalia 123, altimeter 2992, descend and maintain 3000', 'Altimeter 2992, descend 3000 ft, Alitalia 123'],

  // ---------------------------------------------------------------- Nessun readback / casi speciali
  ['AZA123', 'Alitalia 123, traffic 2 o\'clock, 5 miles, opposite direction, 1000 feet above', 'Roger, Alitalia 123', { spell: false }],
  ['AZA123', 'Alitalia 123, radar contact', 'Roger, Alitalia 123'],
  ['AZA123', 'Alitalia 123, report established localizer', 'Wilco, Alitalia 123'],
  ['AZA123', 'Alitalia 123, say again', 'Ripeti la tua ultima chiamata'],
  ['AZA123', 'Alitalia 123, standby', '— nessuna risposta (standby)'],
  ['AZA123', 'Alitalia 123, report your level', 'Riporta il tuo livello'],

  // ---------------------------------------------------------------- Aviazione generale
  ['I-ABCD', 'India Alpha Bravo Charlie Delta, squawk 7000, QNH 1018', 'Squawk 7000, QNH 1018, I-ABCD'],
  ['I-ABCD', 'India Charlie Delta, runway 23, cleared to land', 'Runway 23, cleared to land, I-ABCD'],
];

const DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];

// Come il riconoscimento vocale di Chrome: minuscolo, senza punteggiatura
const speechStyle = (s) => s.toLowerCase().replace(/[,.'](?!\d)/g, ' ').replace(/\s+/g, ' ').trim();

// Numeri pronunciati come in radio
function spelled(s) {
  return s
    .replace(/\b(\d{4,5}) feet\b/g, (m, n) => `${R.spokenAltitude(n)} feet`)
    .replace(/\bflight level (\d{2,3})\b/g, (m, n) => R.spokenFL(n))
    .replace(/\brunway (\d{1,2})([LRC])\b/g, (m, n, x) => `runway ${R.spokenRunway(n + x)}`)
    .replace(/\b(\d+)([A-Z]{1,2})\b/g, (m, n, x) => `${R.spellDigits(n)} ${x.split('').map((c) => R.LETTER_WORD[c]).join(' ')}`)
    .replace(/\d+\.\d+/g, (m) => R.spellDigits(m))
    .replace(/(?<![A-Za-z0-9])\d+(?![A-Za-z0-9])/g, (m) => R.spellDigits(m));
}

for (const [cs, input, expected, opts] of CASES) {
  test(input, () => {
    assert.strictEqual(R.generateReadback(input, { callsign: cs }).readback, expected);
  });
  test(`[stile riconoscimento vocale] ${input}`, () => {
    assert.strictEqual(R.generateReadback(speechStyle(input), { callsign: cs }).readback, expected);
  });
  if (!opts || opts.spell !== false) {
    const sp = spelled(input);
    test(`[numeri a parole] ${sp}`, () => {
      assert.strictEqual(R.generateReadback(sp, { callsign: cs }).readback, expected);
    });
  }
}

test('il corpus ha abbastanza casi', () => {
  assert.ok(CASES.length >= 80, `solo ${CASES.length} casi`);
});
