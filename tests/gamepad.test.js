const test = require('node:test');
const assert = require('node:assert');
const G = require('../js/gamepad.js');

const pad = (id, index, downs) => ({ id, index, buttons: Array.from({ length: 12 }, (_, i) => ({ pressed: downs.includes(i), value: downs.includes(i) ? 1 : 0 })) });

test('joystick PTT: cattura il primo pulsante nuovo e segue premuto/rilasciato', async () => {
  let pads = [pad('Thrustmaster T.16000M (Vendor: 044f Product: b10a)', 0, [2])]; // il 2 era già premuto
  const changes = [];
  const p = G.createPoller(() => pads, (d) => changes.push(d));
  const got = p.capture();
  p.tick();
  pads = [pad(pads[0].id, 0, [2, 5])];
  p.tick();
  const b = await got;
  assert.deepStrictEqual(b, { kind: 'gamepad', pad: pads[0].id, button: 5 });
  p.setBinding(b);
  pads = [pad(pads[0].id, 0, [])]; p.tick();
  pads = [pad(pads[0].id, 1, [5])]; p.tick(); // indice cambiato: conta l'id del dispositivo
  p.tick();
  pads = [pad(pads[0].id, 1, [])]; p.tick();
  assert.deepStrictEqual(changes, [true, false]);
  assert.strictEqual(G.shortName(pads[0].id), 'Thrustmaster T.16000M');
});

test('joystick PTT: dispositivo scollegato = rilasciato; binding non valido ignorato', () => {
  let pads = [pad('Yoke', 0, [1])];
  const changes = [];
  const p = G.createPoller(() => pads, (d) => changes.push(d));
  p.setBinding({ kind: 'gamepad', pad: 'Yoke', button: 1 });
  p.tick();
  pads = [null];
  p.tick();
  assert.deepStrictEqual(changes, [true, false]);
  p.setBinding({ kind: 'key', code: 30 });
  assert.strictEqual(p.active(), false);
});
