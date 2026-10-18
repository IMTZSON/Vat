const test = require('node:test');
const assert = require('node:assert');
const dgram = require('dgram');
const { EventEmitter } = require('events');
const Sim = require('../electron/sim.js');
const C = require('../js/compliance.js');
const R = require('../js/readback.js');

const cs = R.parseCallsign('AZA123');
const hear = (s, text, at) => C.observe(s, R.generateReadback(text, { callsign: cs }), at);

test('protocollo X-Plane: iscrizione RREF e lettura dei valori', () => {
  const b = Sim.buildRref(2, 3, 'sim/cockpit/radios/transponder_code');
  assert.strictEqual(b.length, 413);
  assert.strictEqual(b.toString('ascii', 0, 5), 'RREF\0');
  assert.strictEqual(b.readInt32LE(5), 2);
  assert.strictEqual(b.readInt32LE(9), 3);
  assert.strictEqual(b.toString('ascii', 13, 13 + 35), 'sim/cockpit/radios/transponder_code');
  const r = Buffer.alloc(5 + 16);
  r.write('RREF,', 0, 'ascii');
  r.writeInt32LE(0, 5); r.writeFloatLE(121800, 9);
  r.writeInt32LE(3, 13); r.writeFloatLE(4521, 17);
  assert.deepStrictEqual(Sim.parseRref(r), [{ index: 0, value: 121800 }, { index: 3, value: 4521 }]);
  assert.strictEqual(Sim.parseRref(Buffer.from('DATA*')), null);
});

test('valori di X-Plane e MSFS nel formato comune', () => {
  const x = Sim.fromXplane({ com1: 121800, com1Stby: 118700, com2: 132905, xpdr: 4521, baroInHg: 29.8, altSel: 6000, hdgSel: 270.4, alt: 4321.6, gsMs: 128.6, hdg: -10, onGround: 0 });
  assert.deepStrictEqual(x, { com1: 121.8, com1Stby: 118.7, com2: 132.905, xpdr: '4521', baro: 1009.1, altSel: 6000, hdgSel: 270, alt: 4322, gs: 250, hdg: 350, onGround: false });
  assert.strictEqual(Sim.fromXplane({ xpdr: 9999 }).xpdr, null, 'codice non ottale');
  assert.strictEqual(Sim.decodeBcd(0x4521), '4521');
  assert.strictEqual(Sim.decodeBcd(0x0200), '0200');
  const m = Sim.fromMsfs([125.5, 121.8, 118.7, 1013.25, 24000, 90, 8000.4, 300, 45, 0], 0x7000);
  assert.strictEqual(m.com1, 125.5);
  assert.strictEqual(m.xpdr, '7000');
  assert.strictEqual(m.baro, 1013.3);
  assert.strictEqual(m.onGround, false);
});

test('SimLink: trova X-Plane sulla rete locale e inoltra i dati', async (t) => {
  // Finto X-Plane: risponde alle iscrizioni RREF con COM1 e transponder
  const xp = dgram.createSocket('udp4');
  await new Promise((r) => xp.bind(0, '127.0.0.1', r));
  const subs = [];
  xp.on('message', (msg, rinfo) => {
    subs.push(msg.readInt32LE(9));
    const r = Buffer.alloc(21);
    r.write('RREF,', 0, 'ascii');
    r.writeInt32LE(0, 5); r.writeFloatLE(124350, 9);
    r.writeInt32LE(3, 13); r.writeFloatLE(2000, 17);
    xp.send(r, rinfo.port, rinfo.address);
  });
  const statuses = [];
  const data = [];
  const link = new Sim.SimLink({ dgram, simconnect: null, xpPort: xp.address().port, onStatus: (s) => statuses.push(s), onData: (d) => data.push(d) });
  t.after(() => { link.stop(); xp.close(); });
  link.start();
  for (let i = 0; i < 40 && !data.length; i++) await new Promise((r) => setTimeout(r, 50));
  assert.ok(subs.length >= Sim.XP_REFS.length, 'iscrizione a tutti i dataref');
  assert.deepStrictEqual(statuses.slice(0, 2), ['searching', 'xplane']);
  assert.strictEqual(data[0].source, 'xplane');
  assert.strictEqual(data[0].com1, 124.35);
  assert.strictEqual(data[0].xpdr, '2000');
});

test('SimLink: MSFS via SimConnect (finto) e ritorno a "searching" quando il simulatore si chiude', async (t) => {
  const handle = new EventEmitter();
  const defs = [];
  handle.addToDataDefinition = (id, name, unit) => defs.push([name, unit]);
  handle.requestDataOnSimObject = () => {};
  handle.close = () => {};
  const fake = { Protocol: { KittyHawk: 5 }, SimConnectDataType: { FLOAT64: 4, INT32: 1 }, SimConnectConstants: { OBJECT_ID_USER: 0 }, SimConnectPeriod: { SECOND: 4 }, open: async () => ({ handle }) };
  const data = [];
  const statuses = [];
  const link = new Sim.SimLink({ simconnect: fake, dgram: null, onData: (d) => data.push(d), onStatus: (s) => statuses.push(s) });
  t.after(() => link.stop());
  link.start();
  await new Promise((r) => setTimeout(r, 10));
  assert.strictEqual(defs.length, Sim.MSFS_VARS.length + 1);
  assert.deepStrictEqual(defs[defs.length - 1], ['TRANSPONDER CODE:1', 'BCO16']);
  const vals = [121.8, 118.7, 0, 1009, 5000, 270, 4000, 210, 268, 0];
  let k = 0;
  handle.emit('simObjectData', { requestID: 1, data: { readFloat64: () => vals[k++], readInt32: () => 0x4521 } });
  assert.strictEqual(data[0].source, 'msfs');
  assert.strictEqual(data[0].xpdr, '4521');
  assert.strictEqual(data[0].com1, 121.8);
  handle.emit('quit');
  assert.deepStrictEqual(statuses, ['searching', 'msfs', 'searching']);
});

test('controllo dell\'esecuzione: squawk, frequenza, QNH, livello e prua', () => {
  const t0 = 1000000;
  let s = C.emptyState();
  s = hear(s, 'Alitalia 123 squawk 4521, QNH 1009, contact Roma Radar 125.5', t0);
  s = hear(s, 'Alitalia 123 climb flight level 240 turn left heading 270', t0);
  const sim = { com1: 121.8, xpdr: '2000', baro: 1013.2, altSel: 6000, hdgSel: 160, alt: 3000, onGround: false };
  // subito: si aspetta che il pilota esegua
  assert.ok(C.check(s, sim, t0 + 5000).every((c) => c.status === 'wait'));
  const late = C.check(s, sim, t0 + 60000);
  assert.deepStrictEqual(late.map((c) => [c.type, c.status]), [['squawk', 'warn'], ['freq', 'warn'], ['qnh', 'warn'], ['level', 'warn'], ['heading', 'warn']]);
  assert.deepStrictEqual(late[0].vars, { want: '4521', have: '2000' });
  assert.strictEqual(late[1].vars.want, '125.500');
  const good = { com1: 125.5, xpdr: '4521', baro: 1009.1, altSel: 24000, hdgSel: 268, alt: 3000, onGround: false };
  assert.ok(C.check(s, good, t0 + 60000).every((c) => c.status === 'ok'));
  // dopo il cambio di frequenza, ascoltare l'ATIS su COM1 non genera avvisi
  assert.ok(!C.check(s, { ...good, com1: 127.85 }, t0 + 70000).some((c) => c.type === 'freq'));
  // sopra i 5000 ft niente QNH (si vola con 1013)
  assert.ok(!C.check(s, { ...good, alt: 12000, baro: 1013.2 }, t0 + 70000).some((c) => c.type === 'qnh'));
  // autopilota senza selettore standard: il livello non si controlla
  assert.ok(!C.check(s, { ...good, altSel: 0 }, t0 + 70000).some((c) => c.type === 'level'));
});

test('istruzioni per altri e altimetro in pollici', () => {
  let s = C.observe(C.emptyState(), R.generateReadback('Ryanair 45AB squawk 1234', { callsign: cs }));
  assert.strictEqual(s.squawk, null);
  s = hear(s, 'Alitalia 123 altimeter 2992');
  assert.ok(!s.qnh || s.qnh.hpa === 1013);
});
