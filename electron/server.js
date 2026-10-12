/* Server locale: serve l'app su http://127.0.0.1 e fa da ponte verso i servizi esterni
   (Groq, SimBrief, VATSIM), così il browser non blocca le richieste.
   Si può avviare anche da solo: `npm run serve`. */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

const ALLOWED_HOSTS = new Set(['api.groq.com', 'www.simbrief.com', 'metar.vatsim.net', 'data.vatsim.net']);
const MAX_BODY = 25 * 1024 * 1024;

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Richiesta troppo grande')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// Mappe: OpenStreetMap non richiede chiavi; MapTiler (più curata) solo se l'utente inserisce la sua chiave gratuita.
// Le tile passano dal server locale per identificarsi correttamente (regole d'uso OSM) e per tenerle in memoria.
const TILE_CACHE = new Map();
const TILE_CACHE_MAX = 3000;
function tileSources(style, key) {
  const list = [];
  if (key) list.push({ name: 'maptiler', url: `https://api.maptiler.com/maps/${style === 'dark' ? 'streets-v2-dark' : 'streets-v2'}/256/{z}/{x}/{y}.png?key=${encodeURIComponent(key)}` });
  list.push({ name: 'osm', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' });
  return list;
}

async function serveTile(res, m, key, opts) {
  const [, style, z, x, y] = m;
  const zi = Number(z);
  const max = 2 ** zi;
  if (zi < 0 || zi > 19 || Number(x) >= max || Number(y) >= max) return send(res, 400, { error: { message: 'Tile non valida' } });
  for (const src of tileSources(style, key)) {
    const id = `${src.name}/${style}/${z}/${x}/${y}`;
    let hit = TILE_CACHE.get(id);
    if (!hit) {
      try {
        const r = await fetch(src.url.replace('{z}', z).replace('{x}', x).replace('{y}', y), {
          headers: { 'User-Agent': `ReadbackCopilot/${opts.version || 'dev'} (flight simulator companion; https://github.com/IMTZSON/Vat)` },
        });
        const type = r.headers.get('content-type') || '';
        if (!r.ok || !type.startsWith('image/')) continue;
        hit = { type, body: Buffer.from(await r.arrayBuffer()) };
        TILE_CACHE.set(id, hit);
        if (TILE_CACHE.size > TILE_CACHE_MAX) TILE_CACHE.delete(TILE_CACHE.keys().next().value);
      } catch (e) {
        continue;
      }
    }
    res.writeHead(200, { 'Content-Type': hit.type, 'Cache-Control': 'max-age=86400', 'X-Tile-Source': src.name });
    return res.end(hit.body);
  }
  return send(res, 502, { error: { message: 'Mappa non raggiungibile' } });
}

function createHandler(root, opts) {
  const rootDir = path.resolve(root);
  return async function handler(req, res) {
    const port = req.socket.localPort;
    const allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`];
    // Protezione da DNS rebinding e da richieste di altri siti.
    if (!allowedHosts.includes(req.headers.host)) return send(res, 403, { error: { message: 'Host non consentito' } });
    if (req.headers.origin && !allowedHosts.map((h) => `http://${h}`).includes(req.headers.origin)) {
      return send(res, 403, { error: { message: 'Origine non consentita' } });
    }

    const url = new URL(req.url, `http://127.0.0.1:${port}`);

    if (url.pathname === '/api/ping') return send(res, 200, { ok: true, desktop: !!opts.desktop, version: opts.version || '' });

    const tm = url.pathname.match(/^\/api\/tile\/(light|dark)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.png$/);
    if (tm) return serveTile(res, tm, url.searchParams.get('k') || '', opts);

    if (url.pathname === '/api/proxy') {
      let target;
      try { target = new URL(url.searchParams.get('url') || ''); } catch (e) { return send(res, 400, { error: { message: 'URL non valido' } }); }
      if (target.protocol !== 'https:' || !ALLOWED_HOSTS.has(target.hostname)) return send(res, 403, { error: { message: 'Destinazione non consentita' } });
      try {
        const body = ['GET', 'HEAD'].includes(req.method) ? undefined : await readBody(req);
        const headers = { 'User-Agent': `ReadbackCopilot/${opts.version || 'dev'}` };
        for (const h of ['authorization', 'content-type', 'accept']) if (req.headers[h]) headers[h] = req.headers[h];
        const r = await fetch(target, { method: req.method, headers, body });
        const buf = Buffer.from(await r.arrayBuffer());
        return send(res, r.status, buf, r.headers.get('content-type') || 'application/octet-stream');
      } catch (e) {
        return send(res, 502, { error: { message: `Connessione a ${target.hostname} non riuscita: ${e.message}` } });
      }
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: { message: 'Metodo non consentito' } });
    let rel;
    try { rel = decodeURIComponent(url.pathname); } catch (e) { return send(res, 400, 'Bad request', 'text/plain'); }
    if (rel === '/') rel = '/index.html';
    const file = path.resolve(rootDir, `.${path.posix.normalize(rel)}`);
    const okDirs = ['index.html', 'css', 'js'].map((p) => path.join(rootDir, p));
    if (!okDirs.some((d) => file === d || file.startsWith(d + path.sep))) return send(res, 404, 'Not found', 'text/plain');
    fs.readFile(file, (err, data) => {
      if (err) return send(res, 404, 'Not found', 'text/plain');
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  };
}

// Porta fissa (così le impostazioni salvate restano), con alternative se è occupata.
function start(root, opts) {
  opts = opts || {};
  const ports = opts.ports || [47800, 47801, 47802, 47803, 47804, 0];
  const handler = createHandler(root, opts);
  return new Promise((resolve, reject) => {
    const tryPort = (i) => {
      if (i >= ports.length) { reject(new Error('Nessuna porta libera')); return; }
      const server = http.createServer(handler);
      server.once('error', () => tryPort(i + 1));
      server.listen(ports[i], '127.0.0.1', () => resolve({ server, port: server.address().port }));
    };
    tryPort(0);
  });
}

module.exports = { start, ALLOWED_HOSTS, TILE_CACHE };

if (require.main === module) {
  const pkg = require('../package.json');
  start(path.join(__dirname, '..'), { desktop: false, version: pkg.version }).then(({ port }) => {
    console.log(`Readback Copilot: apri http://127.0.0.1:${port}/ in Chrome o Edge`);
  });
}
