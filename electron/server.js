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

module.exports = { start, ALLOWED_HOSTS };

if (require.main === module) {
  const pkg = require('../package.json');
  start(path.join(__dirname, '..'), { desktop: false, version: pkg.version }).then(({ port }) => {
    console.log(`Readback Copilot: apri http://127.0.0.1:${port}/ in Chrome o Edge`);
  });
}
