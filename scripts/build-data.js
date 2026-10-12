#!/usr/bin/env node
/* Costruisce data/world.json: aeroporti con piste (OurAirports, pubblico dominio), nominativi radio
   delle compagnie (OpenFlights, ODbL) e nomi dei centri di controllo VATSIM (VATSpy Data Project, CC BY-SA 4.0).

   Uso:  node scripts/build-data.js [cartella-sorgenti]
   Se la cartella non contiene i file, li scarica. Il risultato è deterministico (chiavi ordinate). */
'use strict';

const fs = require('fs');
const path = require('path');

const SOURCES = {
  'airports.csv': 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/airports.csv',
  'runways.csv': 'https://raw.githubusercontent.com/davidmegginson/ourairports-data/main/runways.csv',
  'airlines.dat': 'https://raw.githubusercontent.com/jpatokal/openflights/master/data/airlines.dat',
  'VATSpy.dat': 'https://raw.githubusercontent.com/vatsimnetwork/vatspy-data-project/master/VATSpy.dat',
};

// CSV con virgolette (RFC 4180); OpenFlights usa anche \N per "vuoto".
function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.length > 1);
}

function table(text) {
  const [head, ...rows] = parseCsv(text);
  return rows.map((r) => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}

const RWY = /^(0[1-9]|[12]\d|3[0-6])[LRC]?$/;
const round = (x) => Math.round(Number(x) * 1e4) / 1e4;
const title = (s) => String(s || '').toLowerCase().replace(/(^|[\s'/(-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());

// Nome breve per le stazioni ("Roma Tower"): la città senza province o note, altrimenti il nome
// dell'aeroporto senza "International Airport" e simili.
function radioName(name, city) {
  const c = String(city || '').replace(/\s*\(.*?\)\s*/g, ' ').split(/[,/]/)[0].trim();
  if (c) return c;
  return String(name || '').split(',')[0].replace(/\b(international|intl\.?|regional|municipal|county)?\s*(airport|airfield|aerodrome|air base|airstrip)\b.*$/i, '').trim() || String(name || '');
}

function buildAirports(airportsCsv, runwaysCsv, firOf) {
  const runways = new Map();
  for (const r of table(runwaysCsv)) {
    if (r.closed === '1') continue;
    const list = runways.get(r.airport_ident) || [];
    for (const id of [r.le_ident, r.he_ident]) {
      const x = String(id || '').trim().toUpperCase();
      if (RWY.test(x) && !list.includes(x)) list.push(x);
    }
    runways.set(r.airport_ident, list);
  }
  const out = {};
  for (const a of table(airportsCsv)) {
    if (!['large_airport', 'medium_airport', 'small_airport'].includes(a.type)) continue;
    const icao = [a.icao_code, a.gps_code, a.ident].map((x) => String(x || '').toUpperCase()).find((x) => /^[A-Z]{4}$/.test(x));
    if (!icao) continue;
    const rw = runways.get(a.ident) || [];
    if (!rw.length) continue;
    // Se due record hanno lo stesso codice, vince l'aeroporto più grande
    const rank = { large_airport: 3, medium_airport: 2, small_airport: 1 }[a.type];
    if (out[icao] && out[icao].rank >= rank) continue;
    out[icao] = { rank, v: [a.name, radioName(a.name, a.municipality), round(a.latitude_deg), round(a.longitude_deg), rw.join(' '), a.iso_country || '', (firOf && firOf[icao]) || ''] };
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k].v]));
}

function buildAirlines(dat) {
  const out = {};
  for (const r of parseCsv(dat)) {
    const [, , , , icao, callsign, , active] = r.map((x) => (x === '\\N' ? '' : x));
    if (active !== 'Y' || !/^[A-Z]{3}$/.test(icao || '') || !callsign || callsign.length < 2) continue;
    if (/^(n\/a|unknown|-+)$/i.test(callsign)) continue;
    // Il primo record attivo vince. Sigle brevi restano maiuscole (KLM, UPS, SAS).
    if (!out[icao]) out[icao] = callsign.trim().replace(/\s+/g, ' ').split(' ').map((w) => (w.length <= 3 && /^[A-Z]+$/.test(w) ? w : title(w))).join(' ');
  }
  return Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
}

function vatspySection(dat, name) {
  const lines = dat.split(/\r?\n/);
  const i = lines.indexOf(`[${name}]`);
  const out = [];
  for (let k = i + 1; k < lines.length && !lines[k].startsWith('['); k++) if (lines[k] && !lines[k].startsWith(';')) out.push(lines[k].split('|'));
  return out;
}

// ICAO aeroporto -> FIR (VATSpy, sezione [Airports])
function firOfAirport(dat) {
  const out = {};
  for (const [icao, , , , , fir, pseudo] of vatspySection(dat, 'Airports')) if (pseudo !== '1' && icao && fir) out[icao.toUpperCase()] = fir.trim().toUpperCase();
  return out;
}

function buildFirs(dat) {
  const section = (name) => vatspySection(dat, name);
  // Parola usata per il centro nei vari paesi (es. "Control", "Radar", "Centro"), per prefisso ICAO a 2 lettere
  const word = {};
  for (const [, prefix, ctr] of section('Countries')) if (prefix && ctr) word[prefix] = ctr.trim();
  const firs = {};
  for (const [icao, name, prefix] of section('FIRs')) {
    let radio = String(name || '').split(' - ')[0].replace(/\s*\(.*?\)\s*/g, ' ').trim();
    if (!radio) continue;
    const id = String(icao || '').trim().toUpperCase();
    radio = radio.replace(/\bACC\b/, 'Control').replace(/\s+/g, ' ').trim();
    if (!/\b(radar|control|centre|center|centro|information|approach|oceanic)\b/i.test(radio)) radio = `${radio} ${word[id.slice(0, 2)] || 'Control'}`;
    radio = radio.replace(/\s+/g, ' ');
    // Indicizzato sia per prefisso del nominativo VATSIM (es. LON_S) sia per ICAO (es. EGTT)
    for (const key of [String(prefix || '').trim().toUpperCase(), id]) if (key && !firs[key]) firs[key] = radio;
  }
  return Object.fromEntries(Object.keys(firs).sort().map((k) => [k, firs[k]]));
}

async function main() {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, '..', '.data-cache'));
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, url] of Object.entries(SOURCES)) {
    const p = path.join(dir, file);
    if (fs.existsSync(p)) continue;
    process.stdout.write(`Scarico ${file}… `);
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${url}: ${r.status}`);
    fs.writeFileSync(p, Buffer.from(await r.arrayBuffer()));
    console.log('ok');
  }
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const world = {
    meta: {
      built: new Date().toISOString().slice(0, 10),
      sources: {
        airports: 'OurAirports (public domain) — https://ourairports.com/data/',
        airlines: 'OpenFlights airlines database (ODbL 1.0) — https://openflights.org/data',
        firs: 'VATSpy Data Project (CC BY-SA 4.0) — https://github.com/vatsimnetwork/vatspy-data-project',
      },
    },
    airports: buildAirports(read('airports.csv'), read('runways.csv'), firOfAirport(read('VATSpy.dat'))),
    airlines: buildAirlines(read('airlines.dat')),
    firs: buildFirs(read('VATSpy.dat')),
  };
  const out = path.join(__dirname, '..', 'data', 'world.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(world));
  console.log(`${out}: ${Object.keys(world.airports).length} aeroporti, ${Object.keys(world.airlines).length} compagnie, ${Object.keys(world.firs).length} centri, ${(fs.statSync(out).size / 1024).toFixed(0)} KB`);
}

if (require.main === module) main().catch((e) => { console.error(e.message); process.exit(1); });
module.exports = { parseCsv, buildAirports, buildAirlines, buildFirs, radioName, firOfAirport };
