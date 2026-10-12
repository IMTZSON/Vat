const test = require('node:test');
const assert = require('node:assert');
const R = require('../js/readback.js');
const P = require('../js/precision.js');

const cs = R.parseCallsign('AZA123');
const rules = (t) => R.generateReadback(t, { callsign: cs });

test('tutto coerente: verificato', () => {
  const t = 'Alitalia 123, descend flight level 80, turn left heading 270, contact Roma Radar 125.5';
  const r = P.check({ transcript: t, rules: rules(t), ai: 'Descend FL80, left heading 270, Roma Radar 125.5, Alitalia 123', callsign: cs,
    live: { freqs: [{ freq: 125.5, callsign: 'LIRR_CTR' }], runways: ['16L'], qnh: [1013] } });
  assert.strictEqual(r.status, 'ok', JSON.stringify(r.reasons));
});

test("l'AI inventa un numero: si usano le regole", () => {
  const t = 'Alitalia 123, descend flight level 80';
  const r = P.check({ transcript: t, rules: rules(t), ai: 'Descend FL90, Alitalia 123', callsign: cs });
  assert.strictEqual(r.useRules, true);
  assert.strictEqual(r.status, 'warn');
});

test("l'AI dimentica un valore: avviso e alternativa", () => {
  const t = 'Alitalia 123, descend flight level 80, squawk 4521';
  const r = P.check({ transcript: t, rules: rules(t), ai: 'Descend FL80, Alitalia 123', callsign: cs });
  assert.strictEqual(r.useRules, false);
  assert.strictEqual(r.alt, 'Descend FL80, squawk 4521, Alitalia 123');
  assert.match(r.reasons[0].text, /4521/);
});

test('formati diversi degli stessi numeri non sono errori', () => {
  const t = 'Alitalia one two three, descend altitude six thousand feet, QNH one zero one three, contact tower one one eight decimal seven zero zero, runway one six left';
  const r = P.check({ transcript: t, rules: rules(t), ai: 'Descend 6000 ft, QNH 1013, Tower 118.7, runway 16L, Alitalia 123', callsign: cs });
  assert.strictEqual(r.status, 'ok', JSON.stringify(r.reasons));
});

test('frequenza non tra gli ATC online: suggerisce la più vicina', () => {
  const t = 'Alitalia 123, contact Roma Radar 125.05';
  const r = P.check({ transcript: t, rules: rules(t), callsign: cs, live: { freqs: [{ freq: 125.5, callsign: 'LIRR_CTR' }, { freq: 121.8, callsign: 'LIRF_GND' }, { freq: 122.8, callsign: 'UNICOM' }] } });
  assert.strictEqual(r.status, 'warn');
  assert.match(r.reasons[0].text, /forse 125\.500 \(LIRR_CTR\)/);
  assert.deepStrictEqual(r.suggestion, { freq: '125.5', callsign: 'LIRR_CTR' });
});

test('frequenza online con canale 8.33 equivalente: ok', () => {
  const t = 'Alitalia 123, contact Milano 132.005';
  const r = P.check({ transcript: t, rules: rules(t), callsign: cs, live: { freqs: [{ freq: 132.0, callsign: 'LIMM_CTR' }, { freq: 121.8, callsign: 'X' }] } });
  assert.strictEqual(r.status, 'ok', JSON.stringify(r.reasons));
});

test('pista che non esiste nel volo e QNH diverso dal METAR', () => {
  const t = 'Alitalia 123, runway 09, cleared to land, QNH 1031';
  const r = P.check({ transcript: t, rules: rules(t), callsign: cs, live: { runways: ['16L', '16R', '34L', '34R', '07', '25'], qnh: [1013] } });
  assert.strictEqual(r.status, 'warn');
  assert.ok(r.reasons.some((x) => /pista 09/.test(x.text)));
  assert.ok(r.reasons.some((x) => /QNH 1031/.test(x.text)));
});

test('pista con numero impossibile', () => {
  const t = 'Alitalia 123, runway 61L, cleared to land';
  const r = P.check({ transcript: t, rules: rules(t), callsign: cs });
  assert.strictEqual(r.status, 'warn');
  assert.ok(r.reasons.some((x) => /61L/.test(x.text)));
});

test('audio poco chiaro', () => {
  const a = P.audioConfidence([{ avg_logprob: -1.3, no_speech_prob: 0.1, compression_ratio: 1.2 }]);
  assert.strictEqual(a.level, 'bad');
  const t = 'Alitalia 123 descend flight level 80';
  assert.strictEqual(P.check({ transcript: t, rules: rules(t), callsign: cs, audio: a }).status, 'bad');
  assert.strictEqual(P.audioConfidence([{ avg_logprob: -0.25, no_speech_prob: 0.02, compression_ratio: 1.3 }]).level, 'ok');
  assert.strictEqual(P.audioConfidence([]), null);
});

test('squawk non valido dalle regole', () => {
  const t = 'Alitalia 123, squawk 4891';
  assert.strictEqual(P.check({ transcript: t, rules: rules(t), callsign: cs }).status, 'warn');
});

// ------------------------------------------------------------------ prompt di Whisper, fantasmi ed eco
const { Groq } = require('../js/groq.js');

test('il prompt di Whisper non contiene numeri (tranne quelli del nominativo)', () => {
  const p = Groq.buildPrompt('Alitalia 123', 'Roma Radar, Roma Approach 119.2, runway 16L, QNH 1013, squawk 4521');
  const digits = p.match(/\S*\d\S*/g) || [];
  assert.deepStrictEqual(digits.map((d) => d.replace(/[.,]/g, '')), ['123']);
  assert.match(p, /Roma Radar/);
  assert.match(p, /line up and wait/);
  assert.ok(!/4521|1013|16L|119/.test(p));
  assert.ok(p.length <= 900);
});

test('prompt senza nominativo né contesto: solo vocabolario', () => {
  const p = Groq.buildPrompt('', '');
  assert.ok(!/\d/.test(p));
  assert.strictEqual(p, Groq.VOCAB);
});

test('frasi fantasma di Whisper riconosciute', () => {
  for (const x of ['Thank you.', 'Thanks for watching!', 'you', ' . ', 'Subtitles by the Amara.org community', '[BLANK_AUDIO]']) {
    assert.ok(P.phantom(x), x);
  }
  for (const x of ['Alitalia 123, roger', 'Thank you, Alitalia 123, good day', 'descend FL80']) assert.ok(!P.phantom(x), x);
});

test('eco del prompt: riconosciuta e segnalata come audio non chiaro', () => {
  const prompt = Groq.buildPrompt('Alitalia 123', 'Roma Radar');
  assert.ok(P.promptEcho('Line up and wait, cleared for takeoff, cleared to land, cleared ILS approach', prompt));
  assert.ok(!P.promptEcho('Alitalia 123, runway 16L, line up and wait', prompt));
  assert.ok(!P.promptEcho('Alitalia 123, cleared ILS approach runway 16L, report established', prompt));
  const r = P.check({ transcript: 'Alpha, Bravo, Charlie, Delta, Echo, Foxtrot, Golf, Hotel', rules: { parts: [], warnings: [] }, prompt });
  assert.strictEqual(r.status, 'bad');
});

test('harness di valutazione audio: confronto dei numeri', () => {
  const E = require('../scripts/eval-audio.js');
  const cs = R.parseCallsign('AZA123');
  const a = E.readbackNumbers('Alitalia 123, descend flight level 80, turn left heading 270, contact Roma Radar 125.5', cs);
  assert.deepStrictEqual(a.nums.sort(), ['125.5', '270', '80'].sort());
  assert.deepStrictEqual(E.compare(['80', '270', '125.5'], ['80', '270', '125.05']), { hit: 2, missing: 1, extra: 1 });
  assert.deepStrictEqual(E.compare(['80'], ['80']), { hit: 1, missing: 0, extra: 0 });
});
