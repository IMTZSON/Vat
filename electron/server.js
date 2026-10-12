/* Server locale: serve l'app su http://127.0.0.1 e fa da ponte verso i servizi esterni
   (Groq, SimBrief, VATSIM), così il browser non blocca le richieste.
   Si può avviare anche da solo: `npm run serve`. */
'use strict';

const http = require('http');
const fs = require('fs');
const os = require('os');
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

const ALLOWED_HOSTS = new Set(['api.groq.com', 'www.simbrief.com', 'metar.vatsim.net', 'data.vatsim.net', 'api.github.com', 'api.ivao.aero', 'aviationweather.gov']);

/* Dati della mappa radar (settori ATC): aggiornati dalla fonte ufficiale al massimo una volta al giorno,
   salvati nella cache del PC; senza rete si usa l'ultima copia scaricata o quella inclusa nel programma. */
const MAP_DATA = {
  vatspy: { file: 'vatspy.dat', type: 'text/plain; charset=utf-8', url: 'https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/VATSpy.dat', check: (b) => b.includes('[FIRs]') },
  fir: { file: 'fir-boundaries.json', type: 'application/json; charset=utf-8', url: 'https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/Boundaries.geojson', check: (b) => b.includes('FeatureCollection') },
  tracon: { file: 'tracon-boundaries.json', type: 'application/json; charset=utf-8', url: 'https://github.com/vatsimnetwork/simaware-tracon-project/releases/latest/download/TRACONBoundaries.geojson', check: (b) => b.includes('FeatureCollection') },
};
const MAP_MAX_AGE = 24 * 3600 * 1000;
const mapPending = {};

async function mapData(name, rootDir, opts) {
  const spec = MAP_DATA[name];
  const dir = opts.cacheDir || path.join(os.tmpdir(), 'readback-copilot-cache');
  const cached = path.join(dir, spec.file);
  let stat = null;
  try { stat = fs.statSync(cached); } catch (e) { stat = null; }
  if (stat && Date.now() - stat.mtimeMs < MAP_MAX_AGE) return { body: fs.readFileSync(cached), source: 'cache' };
  if (!mapPending[name]) {
    mapPending[name] = (async () => {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), opts.mapTimeout || 20000);
      try {
        const r = await fetch(spec.url, { signal: ctl.signal, headers: { 'User-Agent': `ReadbackCopilot/${opts.version || 'dev'}` } });
        const body = Buffer.from(await r.arrayBuffer());
        if (!r.ok || !spec.check(body.toString('utf8', 0, Math.min(body.length, 4096)) + body.toString('utf8', Math.max(0, body.length - 4096)))) throw new Error(`HTTP ${r.status}`);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(`${cached}.tmp`, body);
        fs.renameSync(`${cached}.tmp`, cached);
        return { body, source: 'fresh' };
      } finally {
        clearTimeout(timer);
        delete mapPending[name];
      }
    })();
  }
  try {
    return await mapPending[name];
  } catch (e) {
    if (stat) return { body: fs.readFileSync(cached), source: 'stale' };
    return { body: fs.readFileSync(path.join(rootDir, 'data', spec.file)), source: 'bundled' };
  }
}

// Server Whisper locale (whisper.cpp, faster-whisper-server…): sul PC o nella rete di casa, anche in http.
function isPrivateHost(host) {
  const h = String(host || '').replace(/^\[|\]$/g, '').toLowerCase();
  if (h === 'localhost' || h === '::1') return true;
  const m = h.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!m) return false;
  const [a, b] = [Number(m[1]), Number(m[2])];
  return a === 127 || a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31);
}
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

    if (url.pathname === '/api/ping') return send(res, 200, { ok: true, desktop: !!opts.desktop, version: opts.version || '', store: !!opts.store });

    // Dati dell'app condivisi con Chrome ("Apri in Chrome" ritrova nominativo e impostazioni).
    // Scrittura solo con l'intestazione X-Readback-Copilot: una pagina di un altro sito non può
    // mandarla senza un preflight CORS, che qui non viene mai autorizzato.
    if (url.pathname === '/api/store' && !opts.store) return send(res, 200, { data: null });
    if (url.pathname === '/api/store' && opts.store) {
      if (req.method === 'GET') return send(res, 200, { data: opts.store.all() });
      if (req.method === 'PUT' && req.headers['x-readback-copilot'] === '1') {
        try {
          const { key, value } = JSON.parse((await readBody(req)).toString('utf8') || '{}');
          return opts.store.set(String(key), value) ? send(res, 200, { ok: true }) : send(res, 400, { error: { message: 'Chiave non valida' } });
        } catch (e) {
          return send(res, 400, { error: { message: 'JSON non valido' } });
        }
      }
      return send(res, 405, { error: { message: 'Metodo non consentito' } });
    }

    const md = url.pathname.match(/^\/api\/mapdata\/(vatspy|fir|tracon)$/);
    if (md) {
      try {
        const r = await mapData(md[1], rootDir, opts);
        res.writeHead(200, { 'Content-Type': MAP_DATA[md[1]].type, 'Cache-Control': 'no-cache', 'X-Map-Data': r.source, 'X-Content-Type-Options': 'nosniff' });
        return res.end(r.body);
      } catch (e) {
        return send(res, 500, { error: { message: e.message } });
      }
    }

    const tm = url.pathname.match(/^\/api\/tile\/(light|dark)\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})\.png$/);
    if (tm) return serveTile(res, tm, url.searchParams.get('k') || '', opts);

    if (url.pathname === '/api/proxy') {
      // Solo dall'app: intestazione dedicata (un altro sito non può mandarla senza preflight CORS)
      // e, nei browser che la inviano, richiesta dalla stessa origine.
      const site = req.headers['sec-fetch-site'];
      if (req.headers['x-readback-copilot'] !== '1' || (site && !['same-origin', 'none'].includes(site))) {
        return send(res, 403, { error: { message: 'Richiesta non consentita' } });
      }
      let target;
      try { target = new URL(url.searchParams.get('url') || ''); } catch (e) { return send(res, 400, { error: { message: 'URL non valido' } }); }
      const publicOk = target.protocol === 'https:' && ALLOWED_HOSTS.has(target.hostname);
      const privateOk = /^https?:$/.test(target.protocol) && isPrivateHost(target.hostname);
      if (!publicOk && !privateOk) return send(res, 403, { error: { message: 'Destinazione non consentita' } });
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
    const okDirs = ['index.html', 'css', 'js', 'data'].map((p) => path.join(rootDir, p));
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

module.exports = { start, ALLOWED_HOSTS, TILE_CACHE, isPrivateHost, MAP_DATA };

if (require.main === module) {
  const pkg = require('../package.json');
  start(path.join(__dirname, '..'), { desktop: false, version: pkg.version }).then(({ port }) => {
    console.log(`Readback Copilot: apri http://127.0.0.1:${port}/ in Chrome o Edge`);
  });
}
