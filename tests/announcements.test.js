const test = require('node:test');
const assert = require('node:assert');
const PA = require('../js/announcements-data.js');
const Metar = require('../js/metar.js');

const FULL = {
  callsign: 'AZA1234', captain: 'Rossi', depCity: 'Roma', arrCity: 'Milano', aircraft: 'A20N', cruiseFl: 360,
  minutesTotal: 65, minutesLeft: 42, arrMetar: Metar.decode('LIMC 121150Z 36008KT 9999 -RA BKN030 14/09 Q1012'),
};

const bad = /undefined|null|NaN|\{|\}|\s,|\s\.|\.\.|\s{2}/;

test('annunci compilati con tutti i dati, senza buchi', () => {
  const list = PA.build(FULL);
  assert.strictEqual(list.length, PA.LIST.length);
  for (const a of list) {
    for (const t of [a.it, a.en]) assert.doesNotMatch(t, bad, `${a.id}: ${t}`);
  }
  const cap = list.find((a) => a.id === 'welcome-captain');
  assert.match(cap.it, /volo|comandante Rossi/);
  assert.match(cap.en, /Captain Rossi/);
  assert.match(cap.en, /Alitalia/);
  assert.match(cap.it, /Airbus A320neo/);
  assert.match(cap.it, /36\.000 piedi/);
  assert.match(cap.en, /one hour and 5 minutes/);
  const cruise = list.find((a) => a.id === 'cruise');
  assert.match(cruise.it, /tra circa 40 minuti/);
  assert.match(cruise.it, /14 gradi con pioggia/);
  assert.match(cruise.en, /in Milan|in Milano/);
});

test('annunci senza dati del volo: frasi comunque corrette', () => {
  for (const a of PA.build({})) {
    for (const t of [a.it, a.en]) assert.doesNotMatch(t, bad, `${a.id}: ${t}`);
  }
  const w = PA.build({}).find((a) => a.id === 'boarding');
  assert.match(w.it, /questo volo/);
});

test('nome della compagnia: marchio, non nominativo radio', () => {
  assert.match(PA.build({ callsign: 'BAW123' })[0].en, /British Airways flight 123/);
  assert.match(PA.build({ callsign: 'XYZ9' })[0].it, /volo XYZ9/);
  assert.match(PA.build({ callsign: 'XYZ9', airlineName: 'Pizza Air' })[0].it, /volo Pizza Air 9/);
});

test('meteo in parole semplici', () => {
  const w = (raw) => PA.weatherWords(Metar.decode(raw));
  assert.strictEqual(w('LIRF 121150Z 24010KT CAVOK 20/10 Q1015').it, 'con cielo sereno');
  assert.strictEqual(w('LIRF 121150Z 24010KT 9999 VCTS SCT040CB 20/10 Q1015').en, 'with thunderstorms in the area');
  assert.strictEqual(w('LIRF 121150Z 24010KT 0300 FG VV001 10/10 Q1015').it, 'con nebbia');
  assert.strictEqual(PA.weatherWords(null), null);
});

test('annuncio proposto in base alla fase', () => {
  const list = PA.build(FULL);
  assert.strictEqual(PA.suggest(list, 'parked', {}).id, 'boarding');
  assert.strictEqual(PA.suggest(list, 'parked', { boarding: true }).id, 'doors');
  assert.strictEqual(PA.suggest(list, 'descent', {}).id, 'descent');
  assert.strictEqual(PA.suggest(list, 'approach', {}).id, 'crew-landing');
  assert.strictEqual(PA.suggest(list, 'cruise', { service: true, cruise: true }), null);
});
