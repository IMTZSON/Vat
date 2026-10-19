const test = require('node:test');
const assert = require('node:assert');
const L = require('../js/landing.js');

test('voto dell\'atterraggio: ft/min, G e rimbalzi', () => {
  assert.strictEqual(L.grade({ fpm: 45, g: 1.1, bounces: 0 }).id, 'butter');
  assert.strictEqual(L.grade({ fpm: -150, g: 1.2, bounces: 0 }).id, 'smooth');
  assert.strictEqual(L.grade({ fpm: 250, g: 1.3, bounces: 0 }).id, 'firm');
  assert.strictEqual(L.grade({ fpm: 450, g: 1.4, bounces: 0 }).id, 'hard');
  assert.strictEqual(L.grade({ fpm: 800, g: 2.1, bounces: 0 }).id, 'veryHard');
  assert.strictEqual(L.grade({ fpm: 50, g: 1.9, bounces: 0 }).id, 'hard', 'G alto');
  assert.strictEqual(L.grade({ fpm: 100, g: 1.2, bounces: 1 }).id, 'firm', 'un rimbalzo');
  assert.ok(L.grade({ fpm: 45, g: 1.0, bounces: 0 }).score > L.grade({ fpm: 150, g: 1.4, bounces: 0 }).score);
});

function fly(samples) {
  const events = [];
  const d = L.createDetector((e) => events.push(e));
  for (const s of samples) d.feed(s);
  return events;
}
// volo di 60 s, poi discesa a -180 ft/min e contatto; campioni ogni 100 ms
function approach(touchVs, extra) {
  const out = [];
  let t = 0;
  for (; t < 60000; t += 100) out.push({ t, onGround: false, vs: t > 50000 ? touchVs : -700, g: 1 });
  for (const s of extra || []) out.push({ ...s, t: (t += 100) });
  for (let i = 0; i < 50; i++) out.push({ t: (t += 100), onGround: true, vs: 0, g: 1 });
  return out;
}

test('rilevamento del contatto (X-Plane: ultimo VS in volo)', () => {
  const ev = fly(approach(-180, [{ onGround: true, vs: -20, g: 1.35 }]));
  assert.strictEqual(ev.length, 1);
  assert.deepStrictEqual([ev[0].fpm, ev[0].g, ev[0].bounces, ev[0].id], [180, 1.35, 0, 'firm']);
});

test('MSFS: velocità al contatto del simulatore; rimbalzo contato', () => {
  const ev = fly(approach(-300, [{ onGround: true, vs: 0, g: 1.2, tdv: -1.5 }, { onGround: false, vs: 50, g: 1 }, { onGround: false, vs: -60, g: 1 }]));
  assert.strictEqual(ev.length, 1);
  assert.strictEqual(ev[0].fpm, 90);
  assert.strictEqual(ev[0].bounces, 1);
});

test('niente atterraggi finti a terra o subito dopo il decollo', () => {
  const d = [];
  const det = L.createDetector((e) => d.push(e));
  for (let t = 0; t < 10000; t += 100) det.feed({ t, onGround: true, vs: 0 });
  for (let t = 10000; t < 15000; t += 100) det.feed({ t, onGround: false, vs: 800 });
  for (let t = 15000; t < 20000; t += 100) det.feed({ t, onGround: true, vs: 0 });
  assert.strictEqual(d.length, 0);
});
