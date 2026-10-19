const test = require('node:test');
const assert = require('node:assert');
const { createVad, encodeWav, downsample } = require('../js/audio.js');

const RATE = 16000;
const BLOCK = 1600; // 100 ms

// Blocco di "audio": rumore di fondo + eventuale tono (voce) di ampiezza amp
function block(noise, amp, seed) {
  const out = new Float32Array(BLOCK);
  let s = seed || 1;
  for (let i = 0; i < BLOCK; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    out[i] = ((s / 2147483648) * 2 - 1) * noise + Math.sin(i / 3) * amp;
  }
  return out;
}

function run(vad, plan) {
  let k = 0;
  for (const [n, noise, amp] of plan) for (let i = 0; i < n; i++) vad.push(block(noise, amp, ++k));
}

test('soglia fissa: una frase tra due silenzi = un segmento, con il preroll', () => {
  const segs = [];
  const vad = createVad({ rate: RATE, threshold: 0.05, onSegment: (s, ms) => segs.push(ms) });
  run(vad, [[10, 0.001, 0], [20, 0.001, 0.3], [12, 0.001, 0]]);
  assert.strictEqual(segs.length, 1);
  // 20 blocchi di voce + preroll (fino a 5) + coda di silenzio (~800 ms)
  assert.ok(segs[0] >= 2000 && segs[0] <= 3500, `durata ${segs[0]}`);
});

test('segmenti troppo corti (click) vengono scartati', () => {
  const segs = [];
  const vad = createVad({ rate: RATE, threshold: 0.05, onSegment: (s, ms) => segs.push(ms) });
  run(vad, [[10, 0.001, 0], [1, 0.001, 0.5], [12, 0.001, 0]]);
  // preroll + 1 blocco + coda supera 500 ms solo grazie alla coda: la regola minMs conta la durata totale
  assert.ok(segs.length <= 1);
  const vad2 = createVad({ rate: RATE, threshold: 0.05, minMs: 1500, onSegment: (s, ms) => segs.push(ms) });
  segs.length = 0;
  run(vad2, [[10, 0.001, 0], [1, 0.001, 0.5], [12, 0.001, 0]]);
  assert.strictEqual(segs.length, 0);
});

test('soglia automatica: si adatta al rumore del simulatore e sente comunque l\'ATC', () => {
  const segs = [];
  const vad = createVad({ rate: RATE, threshold: 0.02, auto: true, onSegment: (s, ms) => segs.push(ms) });
  // rumore motori forte (rms ~0.06, sopra la soglia manuale di 0.02!)
  run(vad, [[30, 0.1, 0]]);
  assert.strictEqual(segs.length, 0, 'il solo rumore non deve aprire frasi');
  assert.ok(vad.threshold > 0.06, `soglia ${vad.threshold}`);
  run(vad, [[20, 0.1, 0.5], [15, 0.1, 0]]);
  assert.strictEqual(segs.length, 1, 'la voce sopra il rumore apre una frase');
});

test('soglia automatica: in un ambiente silenzioso scende', () => {
  const vad = createVad({ rate: RATE, threshold: 0.05, auto: true });
  run(vad, [[40, 0.0005, 0]]);
  assert.ok(vad.threshold < 0.01, `soglia ${vad.threshold}`);
});

test('isteresi: un calo breve a metà frase non la spezza', () => {
  const segs = [];
  const vad = createVad({ rate: RATE, threshold: 0.05, onSegment: (s, ms) => segs.push(ms) });
  run(vad, [[5, 0.001, 0], [8, 0.001, 0.3], [3, 0.001, 0], [8, 0.001, 0.3], [12, 0.001, 0]]);
  assert.strictEqual(segs.length, 1);
});

test('flush chiude la frase in corso quando si ferma l\'ascolto', () => {
  const segs = [];
  const vad = createVad({ rate: RATE, threshold: 0.05, onSegment: (s, ms) => segs.push(ms) });
  run(vad, [[5, 0.001, 0], [15, 0.001, 0.3]]);
  assert.strictEqual(segs.length, 0);
  vad.flush();
  assert.strictEqual(segs.length, 1);
});

test('frasi lunghissime vengono tagliate a maxMs', () => {
  const segs = [];
  const vad = createVad({ rate: RATE, threshold: 0.05, maxMs: 3000, onSegment: (s, ms) => segs.push(ms) });
  run(vad, [[2, 0.001, 0], [70, 0.001, 0.3]]);
  assert.ok(segs.length >= 2);
});

test('WAV 16 kHz mono valido', async () => {
  const wav = encodeWav(downsample(new Float32Array(48000), 48000, 16000), 16000);
  const bytes = Buffer.from(wav instanceof ArrayBuffer ? wav : await wav.arrayBuffer());
  assert.strictEqual(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.strictEqual(bytes.readUInt32LE(24), 16000);
  assert.strictEqual(bytes.length, 44 + 16000 * 2);
});

test('opzioni non indicate (undefined) usano i valori predefiniti', () => {
  const segs = [];
  const vad = createVad({ rate: RATE, threshold: 0.05, silenceMs: undefined, minMs: undefined, maxMs: undefined, onSegment: (s, ms) => segs.push(ms) });
  run(vad, [[5, 0.001, 0], [10, 0.001, 0.3], [12, 0.001, 0]]);
  assert.strictEqual(segs.length, 1);
});

const { createClipBuffer } = require('../js/audio.js');

test('buffer PTT: tiene il preroll, registra tra begin ed end, poi riparte', () => {
  const b = createClipBuffer({ rate: 1000, prerollMs: 300, maxMs: 2000 });
  const chunk = (v, n) => new Float32Array(n || 100).fill(v);
  for (let i = 0; i < 10; i++) b.push(chunk(0.1)); // 1 s di silenzio: ne restano ~300 ms
  b.begin();
  assert.ok(b.recording);
  for (let i = 0; i < 5; i++) b.push(chunk(0.5));
  const out = b.end();
  assert.ok(!b.recording);
  assert.ok(out.length >= 800 && out.length <= 900, `campioni ${out.length}`);
  assert.strictEqual(out[out.length - 1], 0.5);
  assert.strictEqual(b.end(), null, 'senza begin non c\'è niente');
  for (let i = 0; i < 40; i++) b.push(chunk(0.2));
  b.begin();
  for (let i = 0; i < 100; i++) b.push(chunk(0.3)); // oltre maxMs: si ferma a 2 s
  assert.ok(b.end().length <= 2000 + 300);
});
