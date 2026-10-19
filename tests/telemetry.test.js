const test = require('node:test');
const assert = require('node:assert');
const T = require('../js/telemetry.js');

const D1 = Date.parse('2026-10-18T10:00:00Z');
const D2 = Date.parse('2026-10-19T09:00:00Z');

test('statistiche: contatori per giorno, il giorno chiuso diventa da inviare, niente testo libero', () => {
  let s = T.count(null, 'start', 1, D1);
  s = T.count(s, 'train', 3, D1);
  s = T.count(s, 'callsign AZA123', 1, D1); // non ammesso
  assert.deepStrictEqual(s.c, { start: 1, train: 3 });
  assert.strictEqual(T.payload(s, { id: 'abc' }, { usage: true, errors: true }), null, 'oggi non si invia niente');
  s = T.count(s, 'start', 1, D2);
  assert.deepStrictEqual(s.c, { start: 1 });
  const body = T.payload(s, { id: 'a1b2c3d4e5f6a7b8', v: '4.4.0', p: 'windows', l: 'it' }, { usage: true, errors: false });
  assert.deepStrictEqual(body, { id: 'a1b2c3d4e5f6a7b8', v: '4.4.0', p: 'windows', l: 'it', days: [{ d: '2026-10-18', c: { start: 1, train: 3 }, e: [] }] });
  // solo errori consentiti: i contatori non partono
  assert.deepStrictEqual(T.payload(s, { id: 'x' }, { usage: false, errors: true }).days, []);
  assert.match(T.newId(), /^[0-9a-f]{24}$/);
});

test('statistiche: errori ripuliti da percorsi, nominativi, email e chiavi; raggruppati', () => {
  const msg = 'TypeError at C:\\Users\\Mario\\AppData\\app.js:12 for AZA123 mario@example.com gsk_abcdefghijklmnop https://api.example.com/v1/x?token=1';
  const clean = T.scrub(msg);
  assert.doesNotMatch(clean, /Mario|AZA123|mario@|gsk_abc|token=/);
  assert.match(clean, /<path>.*<cs>.*<email>.*<key>.*https:\/\/api\.example\.com\/v1\/…/);
  assert.match(T.scrub('at /home/luca/vat/js/app.js:3'), /at <path>/);
  let s = T.error(null, 'Boom AZA123', 'stack', D1);
  s = T.error(s, 'Boom AZA123', 'stack', D1);
  assert.deepStrictEqual(s.e, [{ m: 'Boom <cs>', s: 'stack', n: 2 }]);
});

test('server Pro: /v1/t accetta solo dati validi e scrive in Analytics Engine', async () => {
  const { handle, telemetryPoints } = await import('../server/pro/worker.mjs');
  const written = [];
  const env = { TELEMETRY: { writeDataPoint: (p) => written.push(p) } };
  const post = (body) => handle(new Request('https://pro.example.com/v1/t', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), env);
  assert.strictEqual((await post('nope')).status, 400);
  assert.strictEqual((await post({ id: 'NOT-HEX', days: [] })).status, 400);
  const r = await post({ id: 'a1b2c3d4e5f6a7b8', v: '4.4.0', p: 'android', l: 'pt', days: [{ d: '2026-10-18', c: { start: 2, train: 5, hacker: 9 }, e: [{ m: 'Boom', s: 'x', n: 3 }] }] });
  assert.strictEqual(r.status, 204);
  assert.strictEqual(written.length, 2);
  assert.deepStrictEqual(written[0].blobs, ['usage', '2026-10-18', '4.4.0', 'android', 'pt']);
  assert.strictEqual(written[0].doubles[0], 2);
  assert.strictEqual(written[1].blobs[0], 'error');
  assert.strictEqual(telemetryPoints({ id: 'a1b2c3d4e5f6a7b8', days: [{ d: 'ieri' }] }).length, 0);
});
