const test = require('node:test');
const assert = require('node:assert');
const C = require('../js/career.js');

const NOW = Date.parse('2026-10-19T12:00:00Z');
const DAY = 86400000;

test('carriera: XP, grado, badge e totali da voli, atterraggi, radio e allenamento', () => {
  let s = C.empty();
  let r = C.add(s, { type: 'flight', id: 'f1', v: { min: 80, dep: 'LIRF', arr: 'LIMC' } }, NOW);
  s = r.state;
  assert.strictEqual(r.xp >= 130, true);
  assert.deepStrictEqual(r.badges.includes('firstFlight'), true);
  r = C.add(s, { type: 'landing', v: { fpm: 52, score: 96 } }, NOW);
  s = r.state;
  assert.ok(r.badges.includes('butter'));
  for (let i = 0; i < 3; i++) s = C.add(s, { type: 'radio', v: { verified: i < 2 } }, NOW).state;
  const sum = C.summary(s, NOW);
  assert.strictEqual(sum.totals.flights, 1);
  assert.strictEqual(sum.totals.minutes, 80);
  assert.deepStrictEqual(sum.totals.airports, ['LIRF', 'LIMC']);
  assert.strictEqual(sum.totals.verified, 2);
  assert.strictEqual(sum.totals.avgFpm, 52);
  assert.strictEqual(sum.rank, C.rankOf(sum.xp).rank);
  // lo stesso volo non conta due volte
  assert.strictEqual(C.add(s, { type: 'flight', id: 'f1', v: { min: 80 } }, NOW).xp, 0);
  // salita di grado
  r = C.add(C.empty(), { type: 'flight', id: 'f2', v: { min: 300, dep: 'LIMC', arr: 'KJFK' } }, NOW);
  assert.strictEqual(r.rankUp, 'ppl');
  assert.ok(r.badges.includes('longhaul'));
  assert.strictEqual(C.rankOf(0).next, 'ppl');
  assert.strictEqual(C.rankOf(99999).progress, 1);
});

test('carriera: sfide del giorno uguali per la stessa data, completate una sola volta', () => {
  assert.deepStrictEqual(C.dailyIds('2026-10-19'), C.dailyIds('2026-10-19'));
  assert.strictEqual(new Set(C.dailyIds('2026-10-19')).size, 3);
  let s = C.empty();
  const ids = C.daily(s, NOW).map((c) => c.id);
  // completa tutte le sfide di oggi con eventi adatti
  const feed = { train5: () => ({ type: 'train', v: { score: 90 } }), perfect3: () => ({ type: 'train', v: { score: 100 } }), rehearsal: () => ({ type: 'rehearsal', v: { avg: 80, n: 18 } }),
    flight: () => ({ type: 'flight', v: { min: 30 } }), fly60: () => ({ type: 'flight', v: { min: 70 } }), verified10: () => ({ type: 'radio', v: { verified: true } }), coach3: () => ({ type: 'coach', v: { score: 90 } }),
    land150: () => ({ type: 'landing', v: { fpm: 120, score: 85 } }), butter: () => ({ type: 'landing', v: { fpm: 40, score: 98 } }), emergency: () => ({ type: 'emergency', v: {} }) };
  const completed = [];
  for (const id of ids) for (let i = 0; i < C.CHALLENGES[id].goal && i < 12; i++) { const r = C.add(s, feed[id](), NOW); s = r.state; completed.push(...r.challenges); }
  assert.deepStrictEqual([...new Set(completed)].sort(), [...ids].sort());
  assert.ok(C.daily(s, NOW).every((c) => c.done));
  assert.strictEqual(C.summary(s, NOW).totals.challenges, 3);
  assert.deepStrictEqual(C.add(s, feed[ids[0]](), NOW).challenges, []);
});

test('carriera: giorni di fila, settimane, unione PC + telefono, archivio', () => {
  let s = C.empty();
  for (let d = 0; d < 7; d++) s = C.add(s, { type: 'train', v: { score: 70 }, t: NOW - d * DAY }, NOW).state;
  const sum = C.summary(s, NOW);
  assert.strictEqual(sum.totals.streak, 7);
  assert.ok(s.badges.streak7);
  assert.strictEqual(sum.weeks.length, 8);
  assert.ok(sum.weeks[7].train === 70);
  const phone = C.add(C.empty(), { type: 'flight', id: 'p1', v: { min: 60 } }, NOW).state;
  const both = C.merge(s, phone);
  assert.strictEqual(both.events.length, s.events.length + phone.events.length);
  assert.strictEqual(C.merge(both, phone).events.length, both.events.length);
  // eventi oltre 180 giorni finiscono nell'archivio senza perdere XP
  const old = C.add(C.empty(), { type: 'flight', id: 'old', v: { min: 100 }, t: NOW - 200 * DAY }, NOW).state;
  assert.strictEqual(old.events.length, 0);
  assert.strictEqual(C.summary(old, NOW).xp, 150);
  assert.strictEqual(C.summary(old, NOW).totals.flights, 1);
});
