const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { PttController, keyNames } = require('../electron/ptt.js');

function fakeHook() {
  const h = new EventEmitter();
  h.running = false;
  h.start = () => { h.running = true; };
  h.stop = () => { h.running = false; };
  return h;
}

test('PTT: premuto e rilasciato, ripetizioni della tastiera ignorate, altri tasti ignorati', () => {
  const hook = fakeHook();
  const changes = [];
  const p = new PttController(hook, { names: keyNames({ CapsLock: 58, Ctrl: 29 }), onChange: (d) => changes.push(d) });
  assert.strictEqual(hook.running, false, 'senza tasto non si ascolta nulla');
  assert.deepStrictEqual(p.setBinding({ kind: 'key', code: 58 }), { kind: 'key', code: 58, label: 'CapsLock' });
  assert.strictEqual(hook.running, true);
  hook.emit('keydown', { keycode: 58 });
  hook.emit('keydown', { keycode: 58 });
  hook.emit('keydown', { keycode: 30 });
  hook.emit('keyup', { keycode: 58 });
  hook.emit('keyup', { keycode: 58 });
  assert.deepStrictEqual(changes, [true, false]);
  p.setBinding(null);
  assert.strictEqual(hook.running, false);
});

test('PTT: cambiare tasto mentre è premuto lo rilascia', () => {
  const hook = fakeHook();
  const changes = [];
  const p = new PttController(hook, { onChange: (d) => changes.push(d) });
  p.setBinding({ kind: 'key', code: 58 });
  hook.emit('keydown', { keycode: 58 });
  p.setBinding({ kind: 'mouse', code: 4 });
  assert.deepStrictEqual(changes, [true, false]);
  hook.emit('mousedown', { button: 4 });
  hook.emit('mouseup', { button: 4 });
  assert.deepStrictEqual(changes, [true, false, true, false]);
});

test('PTT: cattura del tasto (Esc annulla, clic sinistro ignorato, pulsante laterale accettato)', async () => {
  const hook = fakeHook();
  const p = new PttController(hook, { names: { 29: 'Ctrl' } });
  let c = p.capture(1000);
  assert.strictEqual(hook.running, true, 'durante la cattura si ascolta');
  hook.emit('keydown', { keycode: 1 });
  assert.strictEqual(await c, null);
  assert.strictEqual(hook.running, false);
  c = p.capture(1000);
  hook.emit('mousedown', { button: 1 });
  hook.emit('mousedown', { button: 5 });
  assert.deepStrictEqual(await c, { kind: 'mouse', code: 5, label: 'Mouse 5' });
  c = p.capture(1000);
  hook.emit('keydown', { keycode: 29 });
  assert.deepStrictEqual(await c, { kind: 'key', code: 29, label: 'Ctrl' });
  assert.strictEqual(await p.capture(20), null, 'scade se non si preme niente');
});
