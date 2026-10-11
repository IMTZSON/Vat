const test = require('node:test');
const assert = require('node:assert');
const Scenarios = require('../js/scenarios.js');
const Metar = require('../js/metar.js');

const phases = Scenarios.PHASES.map((p) => p.id).filter((p) => p !== 'full');

test('ogni scenario genera un readback con istruzioni', () => {
  for (const phase of phases) {
    for (let seed = 1; seed <= 60; seed++) {
      for (const difficulty of ['easy', 'normal', 'hard']) {
        const s = Scenarios.generate(phase, { seed, difficulty, callsign: 'AZA123' });
        const real = s.expected.parts.filter((p) => p.type !== 'ack');
        assert.ok(real.length > 0, `nessuna istruzione riconosciuta: ${s.atc}`);
        assert.strictEqual(s.expected.forUs, true, s.atc);
      }
    }
  }
});

test('un readback perfetto (scritto o pronunciato) prende 100', () => {
  for (const phase of phases) {
    for (let seed = 1; seed <= 60; seed++) {
      const s = Scenarios.generate(phase, { seed, callsign: 'AZA123' });
      const w = Scenarios.score(s.expected, s.expected.readback);
      assert.strictEqual(w.score, 100, `scritto: ${s.expected.readback} -> ${JSON.stringify(w.items.filter((i) => !i.ok))}`);
      const sp = Scenarios.score(s.expected, s.expected.spoken);
      assert.strictEqual(sp.score, 100, `pronunciato: ${s.expected.spoken} -> ${JSON.stringify(sp.items.filter((i) => !i.ok))}`);
    }
  }
});

test('errori nel readback vengono segnalati', () => {
  const s = { expected: require('../js/readback.js').generateReadback('Alitalia 123, descend flight level 80, turn left heading 270', { callsign: 'AZA123' }) };
  const r = Scenarios.score(s.expected, 'climb flight level 80, left heading 270');
  assert.strictEqual(r.perfect, false);
  const bad = r.items.filter((i) => !i.ok).map((i) => i.label);
  assert.deepStrictEqual(bad, ['Quota', 'Nominativo']);
  const ok = Scenarios.score(s.expected, 'descend flight level eight zero, left heading two seven zero, Alitalia one two three');
  assert.strictEqual(ok.score, 100);
});

test('volo completo con valori coerenti', () => {
  const steps = Scenarios.fullFlight({ seed: 7, callsign: 'RYR45AB', dep: 'LIRF', arr: 'LIMC' });
  assert.strictEqual(steps.length, 18);
  assert.match(steps[0].atc, /^Ryanair 45AB, cleared to Milano Malpensa via/);
  for (const s of steps) assert.strictEqual(s.expected.forUs, true, s.atc);
  const sq = steps[0].atc.match(/squawk (\d{4})/)[1];
  assert.ok(!/[89]/.test(sq));
});

test('METAR decodificato in italiano', () => {
  const m = Metar.decode('METAR LIRF 111450Z 24012G25KT 210V270 9999 -SHRA FEW030CB BKN045 18/12 Q1013 NOSIG');
  assert.strictEqual(m.station, 'LIRF');
  assert.deepStrictEqual(m.wind, { dir: 240, speed: 12, gust: 25, unit: 'nodi', varFrom: 210, varTo: 270 });
  assert.strictEqual(m.qnh.hpa, 1013);
  assert.strictEqual(m.temp, 18);
  assert.ok(m.lines.some((l) => l.includes('rovesci di pioggia leggera')));
  assert.ok(m.lines.some((l) => l.includes('cumulonembi')));
  assert.strictEqual(m.category, 'VFR');
  const us = Metar.decode('KJFK 111451Z 00000KT 1/2SM FG OVC002 M01/M01 A2992');
  assert.strictEqual(us.wind.speed, 0);
  assert.strictEqual(us.category, 'LIFR');
  assert.strictEqual(us.qnh.hpa, 1013);
  assert.strictEqual(us.temp, -1);
  const cavok = Metar.decode('LIMC 111450Z VRB03KT CAVOK 22/10 Q1020');
  assert.ok(cavok.cavok);
  assert.ok(cavok.lines[0].includes('variabile'));
});
