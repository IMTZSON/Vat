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
