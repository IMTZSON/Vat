/* Collegamento col telefono in Wi-Fi (spento di default). Un secondo server in ascolto sulla rete di casa
   espone SOLO /link/* e i file dell'app (mai il proxy né i dati salvati), protetto da un codice di
   abbinamento mostrato nel QR. Il telefono riceve gli eventi del PC con un long-poll e manda comandi.
   Long-poll invece di WebSocket: funziona con le richieste native di iOS/Android e nei browser. */
'use strict';

const http = require('http');
const os = require('os');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORTS = [47810, 47811, 47812, 0];
const MAX_EVENTS = 300;
const WAIT_MS = 25000;
// Comandi che il telefono può mandare al PC
const COMMANDS = ['toggle-listen', 'speak', 'replay', 'replay-slow', 'next-done', 'sync', 'flight'];
// Eventi di "stato": il telefono appena collegato riceve l'ultimo di ognuno
const STATE_TYPES = ['flight', 'next', 'sim', 'listening', 'taxi', 'career', 'readback', 'landing', 'wx', 'tx'];
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2' };

// Codice di abbinamento: 10 caratteri (50 bit), facile da scrivere a mano (XXXXX-XXXXX)
function newToken() {
  return Array.from(crypto.randomBytes(10), (b) => ALPHABET[b % 32]).join('');
}
const normToken = (s) => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');

function sameToken(a, b) {
  const x = Buffer.from(normToken(a));
  const y = Buffer.from(normToken(b));
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}

// Indirizzi IPv4 della rete di casa (per il QR)
function lanAddresses() {
  const out = [];
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' && a.family !== 4) continue;
      if (a.internal) continue;
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(a.address)) out.push(a.address);
    }
  }
  return out;
}

class LinkHub {
  /* opts: { token, onCommand(cmd, data), now } */
  constructor(opts) {
    this.token = (opts && opts.token) || newToken();
    this.onCommand = (opts && opts.onCommand) || (() => {});
    this.now = (opts && opts.now) || Date.now;
    this.seq = 0;
    this.events = [];
    this.state = {};
    this.waiters = new Set();
    this.clients = new Map(); // ip -> ultimo contatto
    this.fails = [];
  }

  publish(type, data) {
    const ev = { seq: ++this.seq, t: this.now(), type: String(type), data: data === undefined ? null : data };
    this.events.push(ev);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    if (STATE_TYPES.includes(ev.type)) this.state[ev.type] = ev;
    for (const w of this.waiters) w();
    return ev.seq;
  }

  // Eventi dopo "since"; se non ce ne sono si aspetta fino a waitMs. since=0: stato iniziale.
  next(since, waitMs) {
    const s = Number(since) || 0;
    const ready = () => {
      if (!s) return { seq: this.seq, events: [], state: Object.values(this.state).sort((a, b) => a.seq - b.seq) };
      const evs = this.events.filter((e) => e.seq > s);
      // il telefono è rimasto indietro (buffer pieno): gli si rimanda lo stato completo
      if (evs.length && evs[0].seq > s + 1) return { seq: this.seq, events: [], state: Object.values(this.state).sort((a, b) => a.seq - b.seq) };
      return evs.length || s > this.seq ? { seq: this.seq, events: evs } : null;
    };
    const now = ready();
    if (now || !waitMs) return Promise.resolve(now || { seq: this.seq, events: [] });
    return new Promise((resolve) => {
      const done = () => { clearTimeout(timer); this.waiters.delete(done); resolve(ready() || { seq: this.seq, events: [] }); };
      const timer = setTimeout(done, waitMs);
      this.waiters.add(done);
    });
  }

  command(cmd, data) {
    if (!COMMANDS.includes(cmd)) return false;
    this.onCommand(cmd, data === undefined ? null : data);
    return true;
  }

  regenerate() {
    this.token = newToken();
    this.clients.clear();
    for (const w of this.waiters) w();
    return this.token;
  }

  // Troppi codici sbagliati in un minuto: si blocca per un po' (contro chi prova a indovinare)
  blocked() {
    const t = this.now();
    this.fails = this.fails.filter((x) => t - x < 60000);
    return this.fails.length >= 20;
  }

  connected() {
    const t = this.now();
    return [...this.clients.values()].filter((x) => t - x < 40000).length;
  }
}

function send(res, status, body, type) {
  const data = typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...CORS });
  res.end(data);
}
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, X-Link-Token', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };

function readJson(req, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch (e) { reject(e); } });
    req.on('error', reject);
  });
}

/* Gestore HTTP del server di rete. opts: { root, name, version } */
function createLinkHandler(hub, opts) {
  const rootDir = path.resolve(opts.root || path.join(__dirname, '..'));
  return async function handler(req, res) {
    const url = new URL(req.url, 'http://link.local');
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

    if (url.pathname.startsWith('/link/')) {
      if (url.pathname === '/link/ping') return send(res, 200, { ok: true, app: 'readback-copilot', name: opts.name || os.hostname(), version: opts.version || '' });
      if (hub.blocked()) return send(res, 429, { error: { message: 'Troppi tentativi, riprova tra un minuto' } });
      const token = req.headers['x-link-token'] || url.searchParams.get('t');
      if (!sameToken(token, hub.token)) { hub.fails.push(hub.now()); return send(res, 401, { error: { message: 'Codice non valido' } }); }
      hub.clients.set(req.socket.remoteAddress || '?', hub.now());
      if (url.pathname === '/link/events' && req.method === 'GET') {
        const wait = Math.min(WAIT_MS, Math.max(0, Number(url.searchParams.get('wait') ?? WAIT_MS)));
        const out = await hub.next(url.searchParams.get('since'), wait);
        return send(res, 200, { ok: true, ...out });
      }
      if (url.pathname === '/link/command' && req.method === 'POST') {
        let body;
        try { body = await readJson(req, 2 * 1024 * 1024); } catch (e) { return send(res, 400, { error: { message: 'Richiesta non valida' } }); }
        if (!hub.command(String(body.cmd || ''), body.data)) return send(res, 400, { error: { message: 'Comando sconosciuto' } });
        return send(res, 200, { ok: true });
      }
      return send(res, 404, { error: { message: 'Not found' } });
    }

    // L'app web per il telefono (senza installare niente): solo index.html, css, js, data
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, 'Method not allowed', 'text/plain');
    let rel = decodeURIComponent(url.pathname);
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

/* Avvia il server di rete -> { server, port, hub, addresses } */
function startLink(opts) {
  const o = opts || {};
  const hub = o.hub || new LinkHub({ token: o.token, onCommand: o.onCommand });
  const handler = createLinkHandler(hub, o);
  const ports = o.ports || PORTS;
  return new Promise((resolve, reject) => {
    const tryPort = (i) => {
      if (i >= ports.length) { reject(new Error('Nessuna porta libera')); return; }
      const server = http.createServer(handler);
      server.once('error', () => tryPort(i + 1));
      server.listen(ports[i], o.host || '0.0.0.0', () => resolve({ server, port: server.address().port, hub, addresses: lanAddresses() }));
    };
    tryPort(0);
  });
}

module.exports = { LinkHub, startLink, createLinkHandler, newToken, normToken, sameToken, lanAddresses, COMMANDS, STATE_TYPES };
