const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const path = require('path');
const server = require('../electron/server.js');

const PNG = Buffer.from('89504e470d0a1a0a', 'hex');
const realFetch = global.fetch;
let calls = [];

// Fornitori di mappe finti
global.fetch = async (url, init) => {
  const u = String(url);
  calls.push({ url: u, ua: init && init.headers && init.headers['User-Agent'] });
  if (u.includes('maptiler.com') && u.includes('key=good')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
  if (u.includes('maptiler.com')) return new Response('Invalid key', { status: 403, headers: { 'content-type': 'text/plain' } });
  if (u.includes('tile.openstreetmap.org')) return new Response(PNG, { status: 200, headers: { 'content-type': 'image/png' } });
  return new Response('API key required', { status: 200, headers: { 'content-type': 'text/html' } });
};

function get(port, p, headers) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: { host: `127.0.0.1:${port}`, ...(headers || {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    }).on('error', reject);
  });
}

test('tile della mappa: OSM senza chiave, MapTiler con chiave, ripiego e cache', async (t) => {
  const { server: srv, port } = await server.start(path.join(__dirname, '..'), { version: 'test', ports: [0] });
  t.after(() => { srv.close(); global.fetch = realFetch; });

  calls = [];
  let r = await get(port, '/api/tile/light/5/17/11.png');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers['x-tile-source'], 'osm');
  assert.ok(r.body.equals(PNG));
  assert.match(calls[0].ua, /^ReadbackCopilot\/test/);

  calls = [];
  r = await get(port, '/api/tile/light/5/17/11.png');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(calls.length, 0, 'la seconda volta arriva dalla cache');

  r = await get(port, '/api/tile/dark/6/34/23.png?k=good');
  assert.strictEqual(r.headers['x-tile-source'], 'maptiler');

  r = await get(port, '/api/tile/dark/6/34/24.png?k=bad');
  assert.strictEqual(r.status, 200);
  assert.strictEqual(r.headers['x-tile-source'], 'osm', 'chiave sbagliata: si torna a OpenStreetMap');

  r = await get(port, '/api/tile/light/3/9/1.png');
  assert.strictEqual(r.status, 400, 'tile fuori dalla griglia');

  r = await get(port, '/api/tile/light/5/17/11.png', { host: 'evil.com' });
  assert.strictEqual(r.status, 403);
});

function request(port, p, headers) {
  return new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port, path: p, headers: { host: `127.0.0.1:${port}`, ...(headers || {}) } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    }).on('error', reject);
  });
}

test('proxy: solo dall\'app (intestazione dedicata), solo destinazioni consentite', async (t) => {
  const seen = [];
  const prev = global.fetch;
  global.fetch = async (url) => { seen.push(String(url)); return new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } }); };
  const { server: srv, port } = await server.start(path.join(__dirname, '..'), { version: 'test', ports: [0] });
  t.after(() => { srv.close(); global.fetch = prev; });
  const q = (u) => `/api/proxy?url=${encodeURIComponent(u)}`;
  const H = { 'x-readback-copilot': '1' };

  assert.strictEqual((await request(port, q('https://data.vatsim.net/v3/vatsim-data.json'))).status, 403, 'senza intestazione');
  assert.strictEqual((await request(port, q('https://data.vatsim.net/v3/vatsim-data.json'), { ...H, 'sec-fetch-site': 'cross-site' })).status, 403, 'da un altro sito');
  assert.strictEqual((await request(port, q('https://data.vatsim.net/v3/vatsim-data.json'), H)).status, 200);
  assert.strictEqual((await request(port, q('https://api.github.com/repos/IMTZSON/Vat/releases'), { ...H, 'sec-fetch-site': 'same-origin' })).status, 200);
  assert.strictEqual((await request(port, q('https://evil.example/x'), H)).status, 403);
  assert.strictEqual((await request(port, q('http://data.vatsim.net/x'), H)).status, 403, 'host pubblici solo in https');
  // Server Whisper locale: sul PC o nella rete di casa
  assert.strictEqual((await request(port, q('http://127.0.0.1:8080/v1/models'), H)).status, 200);
  assert.strictEqual((await request(port, q('http://192.168.1.20:9000/v1/models'), H)).status, 200);
  assert.strictEqual((await request(port, q('http://8.8.8.8/v1/models'), H)).status, 403);
  assert.strictEqual((await request(port, q('file:///etc/passwd'), H)).status, 403);
  assert.ok(seen.some((u) => u.startsWith('http://127.0.0.1:8080/')));
  assert.ok(!seen.some((u) => u.includes('evil') || u.includes('8.8.8.8')));
});

test('indirizzi privati riconosciuti', () => {
  for (const h of ['localhost', '127.0.0.1', '10.0.0.5', '192.168.0.10', '172.16.0.1', '172.31.255.1', '[::1]']) assert.ok(server.isPrivateHost(h), h);
  for (const h of ['8.8.8.8', '172.32.0.1', 'example.com', '192.169.0.1', '']) assert.ok(!server.isPrivateHost(h), h);
});

test('dati della mappa: scaricati una volta al giorno, poi cache, senza rete la copia inclusa', async (t) => {
  const os = require('os');
  const fs = require('fs');
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-map-'));
  const prev = global.fetch;
  let online = true;
  let calls = 0;
  global.fetch = async (url) => {
    calls++;
    if (!online) throw new Error('offline');
    if (String(url).includes('VATSpy.dat')) return new Response('[Countries]\n[FIRs]\nLIRR|Roma||LIRR\n', { status: 200 });
    return new Response('{"type":"FeatureCollection","features":[]}', { status: 200 });
  };
  const { server: srv, port } = await server.start(path.join(__dirname, '..'), { version: 'test', ports: [0], cacheDir });
  t.after(() => { srv.close(); global.fetch = prev; });

  let r = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/api/mapdata/vatspy', headers: { host: `127.0.0.1:${port}` } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ src: res.headers['x-map-data'], b })); }));
  assert.strictEqual(r.src, 'fresh');
  assert.match(r.b, /LIRR\|Roma/);
  r = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/api/mapdata/vatspy', headers: { host: `127.0.0.1:${port}` } }, (res) => { res.resume(); res.on('end', () => resolve({ src: res.headers['x-map-data'] })); }));
  assert.strictEqual(r.src, 'cache');
  assert.strictEqual(calls, 1);

  // Senza rete e senza cache: la copia inclusa nel programma
  online = false;
  r = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/api/mapdata/tracon', headers: { host: `127.0.0.1:${port}` } }, (res) => { let b = ''; res.on('data', (c) => { b += c; }); res.on('end', () => resolve({ src: res.headers['x-map-data'], len: b.length })); }));
  assert.strictEqual(r.src, 'bundled');
  assert.ok(r.len > 100000);
  // Risposta sbagliata (es. pagina di errore): non sovrascrive niente
  online = true;
  global.fetch = async () => new Response('<html>rate limited</html>', { status: 200 });
  r = await new Promise((resolve) => http.get({ host: '127.0.0.1', port, path: '/api/mapdata/fir', headers: { host: `127.0.0.1:${port}` } }, (res) => { res.resume(); res.on('end', () => resolve({ src: res.headers['x-map-data'] })); }));
  assert.strictEqual(r.src, 'bundled');
  assert.ok(!fs.existsSync(path.join(cacheDir, 'fir-boundaries.json')));
});

test('servizio Pro: configurazione solo con indirizzi https', () => {
  const { proConfig } = require('../electron/server.js');
  assert.deepStrictEqual(proConfig({ endpoint: 'https://pro.example.com/', checkout: 'https://shop.example.com/buy' }), { endpoint: 'https://pro.example.com', checkout: 'https://shop.example.com/buy' });
  assert.strictEqual(proConfig({ endpoint: 'http://pro.example.com' }), null);
  assert.strictEqual(proConfig({ endpoint: '' }), null);
  assert.deepStrictEqual(proConfig({ endpoint: 'https://pro.example.com', checkout: 'javascript:alert(1)' }), { endpoint: 'https://pro.example.com', checkout: '' });
});
