const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { Store } = require('../electron/store.js');
const server = require('../electron/server.js');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-store-')), 'data.json');

test('archivio su file: salva, rilegge e resiste a un file rovinato', () => {
  const file = tmpFile();
  const a = new Store(file);
  assert.ok(a.isNew);
  assert.ok(a.set('readback-copilot-settings', { callsign: 'AZA123', groqKey: 'gsk_x' }));
  assert.ok(!a.set('altro-programma', 1), 'solo chiavi dell\'app');
  a.flush();
  const b = new Store(file);
  assert.deepStrictEqual(b.get('readback-copilot-settings'), { callsign: 'AZA123', groqKey: 'gsk_x' });
  assert.ok(!b.isNew);
  b.set('readback-copilot-settings', null);
  b.flush();
  assert.strictEqual(new Store(file).get('readback-copilot-settings'), undefined);

  fs.writeFileSync(file, '{rotto');
  const c = new Store(file);
  assert.ok(c.isNew);
  assert.ok(fs.readdirSync(path.dirname(file)).some((f) => f.includes('.corrupt-')), 'copia del file rovinato');
});

test('importazione dal vecchio localStorage: non sovrascrive i dati già nel file', () => {
  const s = new Store(tmpFile());
  s.set('readback-copilot-flight', { dep: 'LIRF' });
  const n = s.merge({ 'readback-copilot-flight': { dep: 'XXXX' }, 'readback-copilot-history': [1, 2], foo: 1 });
  assert.strictEqual(n, 1);
  assert.deepStrictEqual(s.get('readback-copilot-flight'), { dep: 'LIRF' });
  assert.deepStrictEqual(s.get('readback-copilot-history'), [1, 2]);
});

function req(port, method, p, body, headers) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path: p, method, headers: { host: `127.0.0.1:${port}`, ...(headers || {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => { const txt = Buffer.concat(chunks).toString(); let json = null; try { json = JSON.parse(txt); } catch (e) { json = txt; } resolve({ status: res.statusCode, json }); });
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}

test('server: Chrome legge e scrive lo stesso archivio, gli altri siti no', async (t) => {
  const store = new Store(tmpFile());
  store.set('readback-copilot-settings', { callsign: 'AZA123' });
  const { server: srv, port } = await server.start(path.join(__dirname, '..'), { version: 'test', ports: [0], store });
  t.after(() => srv.close());

  const ping = await req(port, 'GET', '/api/ping');
  assert.strictEqual(ping.json.store, true);
  const all = await req(port, 'GET', '/api/store');
  assert.deepStrictEqual(all.json.data['readback-copilot-settings'], { callsign: 'AZA123' });

  const body = JSON.stringify({ key: 'readback-copilot-flight', value: { dep: 'EGLL' } });
  const noHeader = await req(port, 'PUT', '/api/store', body, { 'content-type': 'application/json' });
  assert.strictEqual(noHeader.status, 405, 'senza intestazione dedicata non si scrive');
  const evil = await req(port, 'PUT', '/api/store', body, { 'x-readback-copilot': '1', origin: 'https://evil.example' });
  assert.strictEqual(evil.status, 403);
  const ok = await req(port, 'PUT', '/api/store', body, { 'x-readback-copilot': '1', origin: `http://127.0.0.1:${port}` });
  assert.strictEqual(ok.status, 200);
  assert.deepStrictEqual(store.get('readback-copilot-flight'), { dep: 'EGLL' });
  const badKey = await req(port, 'PUT', '/api/store', JSON.stringify({ key: 'x', value: 1 }), { 'x-readback-copilot': '1' });
  assert.strictEqual(badKey.status, 400);
});

test('server senza archivio (npm run serve): /api/store risponde "nessun archivio"', async (t) => {
  const { server: srv, port } = await server.start(path.join(__dirname, '..'), { version: 'test', ports: [0] });
  t.after(() => srv.close());
  const r = await req(port, 'GET', '/api/store');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.json.data, null);
  const w = await req(port, 'PUT', '/api/store', JSON.stringify({ key: 'readback-copilot-x', value: 1 }), { 'x-readback-copilot': '1' });
  assert.strictEqual(w.status, 200);
  assert.strictEqual(w.json.data, null, 'nessuna scrittura senza archivio');
});
