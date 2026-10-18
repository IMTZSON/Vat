/* Collegamento al simulatore (solo lettura): Microsoft Flight Simulator via SimConnect
   (node-simconnect, puro JavaScript) e X-Plane via il protocollo UDP ufficiale (RREF).
   Legge radio, transponder, altimetro e selettori dell'autopilota per verificare che le
   istruzioni ATC siano state eseguite. Non scrive mai nulla nel simulatore. */
'use strict';

const Landing = require('../js/landing.js');

const XP_PORT = 49000;
const RETRY_MS = 10000;

// Dataref di X-Plane (indice = posizione nell'elenco)
const XP_REFS = [
  ['com1', 'sim/cockpit2/radios/actuators/com1_frequency_hz_833'],
  ['com1Stby', 'sim/cockpit2/radios/actuators/com1_standby_frequency_hz_833'],
  ['com2', 'sim/cockpit2/radios/actuators/com2_frequency_hz_833'],
  ['xpdr', 'sim/cockpit/radios/transponder_code'],
  ['baroInHg', 'sim/cockpit2/gauges/actuators/barometer_setting_in_hg_pilot'],
  ['altSel', 'sim/cockpit2/autopilot/altitude_dial_ft'],
  ['hdgSel', 'sim/cockpit2/autopilot/heading_dial_deg_mag_pilot'],
  ['alt', 'sim/cockpit2/gauges/indicators/altitude_ft_pilot'],
  ['gsMs', 'sim/flightmodel/position/groundspeed'],
  ['hdg', 'sim/flightmodel/position/mag_psi'],
  ['onGround', 'sim/flightmodel/failures/onground_any'],
  ['vs', 'sim/flightmodel/position/vh_ind_fpm'],
  ['g', 'sim/flightmodel/forces/g_nrml'],
  ['lat', 'sim/flightmodel/position/latitude'],
  ['lon', 'sim/flightmodel/position/longitude'],
];
const XP_HZ = 10; // abbastanza per il contatto con la pista (e il traffico è solo locale)

// Variabili di MSFS: [chiave, nome, unità]; il transponder (BCO16, intero) è sempre l'ultimo
const MSFS_VARS = [
  ['com1', 'COM ACTIVE FREQUENCY:1', 'MHz'],
  ['com1Stby', 'COM STANDBY FREQUENCY:1', 'MHz'],
  ['com2', 'COM ACTIVE FREQUENCY:2', 'MHz'],
  ['baro', 'KOHLSMAN SETTING MB:1', 'millibars'],
  ['altSel', 'AUTOPILOT ALTITUDE LOCK VAR', 'feet'],
  ['hdgSel', 'AUTOPILOT HEADING LOCK DIR', 'degrees'],
  ['alt', 'INDICATED ALTITUDE', 'feet'],
  ['gs', 'GROUND VELOCITY', 'knots'],
  ['hdg', 'PLANE HEADING DEGREES MAGNETIC', 'degrees'],
  ['onGround', 'SIM ON GROUND', 'bool'],
  ['vs', 'VERTICAL SPEED', 'feet per minute'],
  ['g', 'G FORCE', 'GForce'],
  ['lat', 'PLANE LATITUDE', 'degrees'],
  ['lon', 'PLANE LONGITUDE', 'degrees'],
];

// Dati veloci per l'atterraggio (MSFS): letti più volte al secondo, servono solo al rilevatore
const MSFS_FAST = [
  ['onGround', 'SIM ON GROUND', 'bool'],
  ['vs', 'VERTICAL SPEED', 'feet per minute'],
  ['g', 'G FORCE', 'GForce'],
  ['tdv', 'PLANE TOUCHDOWN NORMAL VELOCITY', 'feet per second'],
];

/* Profili degli add-on con selettori propri (riconosciuti dal titolo dell'aereo).
   FlyByWire A32NX: quota del FCU in AUTOPILOT ALTITUDE LOCK VAR:3, prua selezionata in una L-var
   (-1 = prua gestita). Fonte: documentazione FlyByWire (Flight Deck API). Per gli altri add-on
   (Fenix, PMDG…) i selettori non sono standard: si controlla l'andamento reale dell'aereo. */
const PROFILES = [
  { id: 'fbw', match: /A32NX|FlyByWire|FBW/i, vars: [['altSel', 'AUTOPILOT ALTITUDE LOCK VAR:3', 'feet'], ['hdgSel', 'L:A32NX_AUTOPILOT_HEADING_SELECTED', 'number']] },
  { id: 'fenix', match: /Fenix/i, vars: null },
  { id: 'pmdg', match: /PMDG/i, vars: null },
];
const profileFor = (title) => PROFILES.find((p) => p.match.test(String(title || ''))) || null;

// Pacchetto di iscrizione RREF: "RREF\0" + frequenza (int32) + indice (int32) + percorso (400 byte)
function buildRref(freq, index, path) {
  const b = Buffer.alloc(413);
  b.write('RREF\0', 0, 'ascii');
  b.writeInt32LE(freq, 5);
  b.writeInt32LE(index, 9);
  b.write(String(path).slice(0, 399), 13, 'ascii');
  return b;
}

// Risposta RREF: "RREF" + 1 byte, poi coppie (indice int32, valore float32)
function parseRref(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 5 || buf.toString('ascii', 0, 4) !== 'RREF') return null;
  const out = [];
  for (let o = 5; o + 8 <= buf.length; o += 8) out.push({ index: buf.readInt32LE(o), value: buf.readFloatLE(o + 4) });
  return out;
}

// Transponder BCD di MSFS (0x4521) -> "4521"
function decodeBcd(n) {
  const s = Math.max(0, Math.round(Number(n) || 0)).toString(16).padStart(4, '0');
  return /^[0-7]{4}$/.test(s) ? s : null;
}

const round = (v, d) => (v === null || v === undefined || Number.isNaN(v) ? null : Math.round(v * 10 ** d) / 10 ** d);
const khzToMhz = (v) => (v > 1000 ? round(v / 1000, 3) : null);

// Valori grezzi di X-Plane -> formato comune
function fromXplane(raw) {
  const xp = raw.xpdr !== undefined ? String(Math.round(raw.xpdr)).padStart(4, '0') : null;
  return {
    com1: khzToMhz(raw.com1), com1Stby: khzToMhz(raw.com1Stby), com2: khzToMhz(raw.com2),
    xpdr: xp && /^[0-7]{4}$/.test(xp) ? xp : null,
    baro: raw.baroInHg ? round(raw.baroInHg * 33.8639, 1) : null,
    altSel: raw.altSel !== undefined ? Math.round(raw.altSel) : null,
    hdgSel: raw.hdgSel !== undefined ? Math.round(((raw.hdgSel % 360) + 360) % 360) : null,
    alt: raw.alt !== undefined ? Math.round(raw.alt) : null,
    gs: raw.gsMs !== undefined ? Math.round(raw.gsMs * 1.94384) : null,
    hdg: raw.hdg !== undefined ? Math.round(((raw.hdg % 360) + 360) % 360) : null,
    onGround: raw.onGround !== undefined ? raw.onGround > 0.5 : null,
    vs: raw.vs !== undefined ? Math.round(raw.vs) : null,
    g: raw.g !== undefined ? round(raw.g, 2) : null,
    lat: raw.lat !== undefined ? round(raw.lat, 6) : null,
    lon: raw.lon !== undefined ? round(raw.lon, 6) : null,
  };
}

// Valori di MSFS (nell'ordine di MSFS_VARS + transponder) -> formato comune
function fromMsfs(values, xpdrBcd) {
  const v = {};
  MSFS_VARS.forEach(([k], i) => { v[k] = values[i]; });
  return {
    com1: round(v.com1, 3), com1Stby: round(v.com1Stby, 3), com2: round(v.com2, 3),
    xpdr: decodeBcd(xpdrBcd),
    baro: round(v.baro, 1),
    altSel: v.altSel !== undefined ? Math.round(v.altSel) : null,
    hdgSel: v.hdgSel !== undefined ? Math.round(((v.hdgSel % 360) + 360) % 360) : null,
    alt: v.alt !== undefined ? Math.round(v.alt) : null,
    gs: v.gs !== undefined ? Math.round(v.gs) : null,
    hdg: v.hdg !== undefined ? Math.round(((v.hdg % 360) + 360) % 360) : null,
    onGround: v.onGround !== undefined ? v.onGround > 0.5 : null,
    vs: v.vs !== undefined ? Math.round(v.vs) : null,
    g: v.g !== undefined ? round(v.g, 2) : null,
    lat: v.lat !== undefined ? round(v.lat, 6) : null,
    lon: v.lon !== undefined ? round(v.lon, 6) : null,
  };
}

/* deps: { simconnect (modulo node-simconnect o null), dgram, onData(data), onStatus(status), timers? }
   status: 'off' | 'searching' | 'msfs' | 'xplane' */
class SimLink {
  constructor(deps) {
    this.d = deps;
    this.status = 'off';
    this.enabled = false;
    this.msfs = null;
    this.xp = null;
    this.xpRaw = {};
    this.xpLast = 0;
    this.timers = [];
    this.profile = null;
    this.override = {};
    this.detector = Landing.createDetector((ev) => { if (this.d.onTouchdown) this.d.onTouchdown(ev); });
  }

  // Dati comuni + valori del profilo dell'add-on (selettori propri)
  emit(source, data) {
    const out = { source, ...data, ...this.override, profile: this.profile ? this.profile.id : null };
    if (this.profile && !this.profile.vars) { out.altSel = null; out.hdgSel = null; }
    if (this.d.onData) this.d.onData(out);
  }

  setStatus(s) {
    if (s === this.status) return;
    this.status = s;
    if (this.d.onStatus) this.d.onStatus(s);
  }

  start() {
    if (this.enabled) return;
    this.enabled = true;
    this.setStatus('searching');
    this.tryMsfs();
    this.startXplane();
  }

  stop() {
    this.enabled = false;
    this.timers.forEach(clearTimeout);
    this.timers.forEach(clearInterval);
    this.timers = [];
    if (this.msfs) { try { this.msfs.close(); } catch (e) { /* già chiuso */ } this.msfs = null; }
    if (this.xp) {
      try { XP_REFS.forEach(([, path], i) => this.xp.send(buildRref(0, i, path), XP_PORT, '127.0.0.1')); } catch (e) { /* ignora */ }
      try { this.xp.close(); } catch (e) { /* ignora */ }
      this.xp = null;
    }
    this.setStatus('off');
  }

  later(fn, ms) { const t = setTimeout(fn, ms); this.timers.push(t); return t; }

  // ---------------------------------------------------------------- MSFS
  async tryMsfs() {
    const sc = this.d.simconnect;
    if (!this.enabled || !sc || this.msfs) return;
    try {
      const { handle } = await sc.open('Readback Copilot', sc.Protocol.KittyHawk);
      if (!this.enabled) { handle.close(); return; }
      this.msfs = handle;
      const DEF = 1;
      const REQ = 1;
      for (const [, name, unit] of MSFS_VARS) handle.addToDataDefinition(DEF, name, unit, sc.SimConnectDataType.FLOAT64);
      handle.addToDataDefinition(DEF, 'TRANSPONDER CODE:1', 'BCO16', sc.SimConnectDataType.INT32);
      handle.requestDataOnSimObject(REQ, DEF, sc.SimConnectConstants.OBJECT_ID_USER, sc.SimConnectPeriod.SECOND);
      // atterraggio: dati veloci (un fotogramma ogni 4)
      for (const [, name, unit] of MSFS_FAST) handle.addToDataDefinition(2, name, unit, sc.SimConnectDataType.FLOAT64);
      handle.requestDataOnSimObject(2, 2, sc.SimConnectConstants.OBJECT_ID_USER, sc.SimConnectPeriod.VISUAL_FRAME, 0, 0, 3);
      // titolo dell'aereo, per riconoscere gli add-on
      handle.addToDataDefinition(3, 'TITLE', null, sc.SimConnectDataType.STRING256);
      handle.requestDataOnSimObject(3, 3, sc.SimConnectConstants.OBJECT_ID_USER, sc.SimConnectPeriod.SECOND, 1);
      handle.on('simObjectData', (recv) => {
        if (recv.requestID === REQ) {
          const values = MSFS_VARS.map(() => recv.data.readFloat64());
          const xpdr = recv.data.readInt32();
          this.setStatus('msfs');
          this.emit('msfs', fromMsfs(values, xpdr));
        } else if (recv.requestID === 2) {
          const [onGround, vs, g, tdv] = MSFS_FAST.map(() => recv.data.readFloat64());
          this.detector.feed({ t: Date.now(), onGround: onGround > 0.5, vs, g, tdv });
        } else if (recv.requestID === 3) {
          this.setProfile(handle, sc, recv.data.readString256());
        } else if (recv.requestID === 4 && this.profile && this.profile.vars) {
          const [alt, hdg] = this.profile.vars.map(() => recv.data.readFloat64());
          this.override = { altSel: Math.round(alt), hdgSel: hdg >= 0 ? Math.round(((hdg % 360) + 360) % 360) : null };
        }
      });
      const lost = () => {
        if (this.msfs !== handle) return;
        this.msfs = null;
        this.setStatus(this.xpAlive() ? 'xplane' : 'searching');
        this.later(() => this.tryMsfs(), RETRY_MS);
      };
      handle.on('quit', lost);
      handle.on('close', lost);
      handle.on('error', lost);
    } catch (e) {
      // simulatore non avviato: si riprova
      this.later(() => this.tryMsfs(), RETRY_MS);
    }
  }

  // Aereo cambiato: profilo dell'add-on (variabili proprie lette a parte)
  setProfile(handle, sc, title) {
    const p = profileFor(title);
    if ((p && p.id) === (this.profile && this.profile.id)) return;
    this.profile = p;
    this.override = {};
    if (p && p.vars) {
      try {
        handle.clearDataDefinition && handle.clearDataDefinition(4);
        for (const [, name, unit] of p.vars) handle.addToDataDefinition(4, name, unit, sc.SimConnectDataType.FLOAT64);
        handle.requestDataOnSimObject(4, 4, sc.SimConnectConstants.OBJECT_ID_USER, sc.SimConnectPeriod.SECOND);
      } catch (e) { this.profile = null; }
    }
  }

  // ---------------------------------------------------------------- X-Plane
  xpAlive() { return Date.now() - this.xpLast < 5000; }

  startXplane() {
    const dgram = this.d.dgram;
    if (!dgram) return;
    const sock = dgram.createSocket('udp4');
    this.xp = sock;
    sock.on('error', () => { /* porta occupata o rete non disponibile */ });
    sock.on('message', (msg) => {
      const vals = parseRref(msg);
      if (!vals) return;
      for (const { index, value } of vals) if (XP_REFS[index]) this.xpRaw[XP_REFS[index][0]] = value;
      this.xpLast = Date.now();
      if (this.xpRaw.onGround !== undefined) this.detector.feed({ t: this.xpLast, onGround: this.xpRaw.onGround > 0.5, vs: this.xpRaw.vs, g: this.xpRaw.g });
      if (this.status !== 'msfs') this.setStatus('xplane');
    });
    const subscribe = () => {
      if (!this.enabled || this.xp !== sock) return;
      // X-Plane può partire dopo il programma: finché tace si rinnova l'iscrizione
      if (!this.xpAlive()) XP_REFS.forEach(([, path], i) => { try { sock.send(buildRref(XP_HZ, i, path), this.d.xpPort || XP_PORT, '127.0.0.1'); } catch (e) { /* ignora */ } });
      if (!this.xpAlive() && this.status === 'xplane') this.setStatus(this.msfs ? 'msfs' : 'searching');
    };
    sock.bind(0, '127.0.0.1', () => subscribe());
    const iv = setInterval(subscribe, 5000);
    this.timers.push(iv);
    const push = setInterval(() => {
      if (this.xpAlive() && this.status === 'xplane') this.emit('xplane', fromXplane(this.xpRaw));
    }, 1000);
    this.timers.push(push);
  }
}

module.exports = { SimLink, buildRref, parseRref, decodeBcd, fromXplane, fromMsfs, profileFor, XP_REFS, MSFS_VARS, MSFS_FAST, PROFILES };
