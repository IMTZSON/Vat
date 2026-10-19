const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { LinkHub, startLink, newToken, normToken, sameToken } = require('../electron/link.js');

test('collegamento: codice di abbinamento, eventi con stato iniziale, long-poll e comandi', async () => {
  const t = newToken();
  assert.match(t, /^[0-9A-Z]{10}$/);
  assert.ok(sameToken(`${t.slice(0, 5)}-${t.slice(5).toLowerCase()}`, t));
  assert.ok(!sameToken('', t));
  assert.strictEqual(normToken('ab-cO1l'), 'ABC011');
  const cmds = [];
  const hub = new LinkHub({ onCommand: (c, d) => cmds.push([c, d]) });
  hub.publish('flight', { dep: 'LIRF', arr: 'LIMC' });
  hub.publish('readback', { readback: 'Squawk 4521, Alitalia 123' });
  hub.publish('readback', { readback: 'Climb FL120, Alitalia 123' });
  // appena collegato: lo stato (ultimo di ogni tipo), niente cronologia
  const first = await hub.next(0, 0);
  assert.strictEqual(first.seq, 3);
  assert.deepStrictEqual(first.state.map((e) => e.type), ['flight', 'readback']);
  assert.strictEqual(first.state[1].data.readback, 'Climb FL120, Alitalia 123');
  // long-poll: aspetta il prossimo evento
  const waiting = hub.next(3, 2000);
  setTimeout(() => hub.publish('next', { text: 'Milano Radar, Alitalia 123' }), 30);
  const got = await waiting;
  assert.deepStrictEqual(got.events.map((e) => e.type), ['next']);
  // nessun evento entro il tempo: risposta vuota
  assert.deepStrictEqual((await hub.next(4, 20)).events, []);
  assert.ok(hub.command('replay'));
  assert.ok(!hub.command('rm -rf'));
  assert.deepStrictEqual(cmds, [['replay', null]]);
});

test('collegamento: server di rete con codice obbligatorio, solo /link/* e i file dell\'app', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-link-'));
  fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><title>RC</title>');
  fs.mkdirSync(path.join(root, 'js'));
  fs.writeFileSync(path.join(root, 'js', 'a.js'), 'x');
  fs.writeFileSync(path.join(root, 'package.json'), '{"secret":1}');
  const cmds = [];
  const { server, port, hub } = await startLink({ root, ports: [0], host: '127.0.0.1', name: 'PC-Luca', version: '4.4.0', onCommand: (c, d) => cmds.push([c, d]) });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${port}`;
  const ping = await (await fetch(`${base}/link/ping`)).json();
  assert.deepStrictEqual(ping, { ok: true, app: 'readback-copilot', name: 'PC-Luca', version: '4.4.0' });
  assert.strictEqual((await fetch(`${base}/link/events?since=0`)).status, 401);
  assert.strictEqual((await fetch(`${base}/link/events?since=0`, { headers: { 'X-Link-Token': 'SBAGLIATO1' } })).status, 401);
  hub.publish('sim', { com1: 121.8 });
  const ok = await fetch(`${base}/link/events?since=0&wait=0`, { headers: { 'X-Link-Token': hub.token } });
  assert.strictEqual(ok.headers.get('access-control-allow-origin'), '*');
  const body = await ok.json();
  assert.strictEqual(body.state[0].data.com1, 121.8);
  const cmd = await fetch(`${base}/link/command`, { method: 'POST', headers: { 'X-Link-Token': hub.token, 'Content-Type': 'application/json' }, body: JSON.stringify({ cmd: 'toggle-listen' }) });
  assert.strictEqual(cmd.status, 200);
  assert.deepStrictEqual(cmds, [['toggle-listen', null]]);
  assert.strictEqual(hub.connected(), 1);
  // l'app sì, il resto no; niente proxy né store sul server di rete
  assert.strictEqual((await fetch(`${base}/`)).status, 200);
  assert.strictEqual((await fetch(`${base}/js/a.js`)).status, 200);
  assert.strictEqual((await fetch(`${base}/package.json`)).status, 404);
  assert.strictEqual((await fetch(`${base}/api/proxy?url=https://api.groq.com`)).status, 404);
  assert.strictEqual((await fetch(`${base}/api/store`)).status, 404);
  // codice rigenerato: il vecchio non vale più; troppi tentativi sbagliati: blocco
  const old = hub.token;
  hub.regenerate();
  assert.strictEqual((await fetch(`${base}/link/events?since=0&wait=0&t=${old}`)).status, 401);
  for (let i = 0; i < 20; i++) await fetch(`${base}/link/events?t=X${i}`);
  assert.strictEqual((await fetch(`${base}/link/events?since=0&wait=0`, { headers: { 'X-Link-Token': hub.token } })).status, 429);
});
