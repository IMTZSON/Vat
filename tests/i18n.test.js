const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const I18n = require('../js/i18n.js');
const { STRINGS } = require('../js/strings.js');

const root = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const jsFiles = fs.readdirSync(path.join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`);

test('ogni testo ha italiano e inglese, con gli stessi segnaposto', () => {
  for (const [key, val] of Object.entries(STRINGS)) {
    assert.ok(Array.isArray(val) && val.length === 2, key);
    assert.ok(val[0] && val[1], `${key}: manca una lingua`);
    const ph = (s) => (s.match(/\{\w+\}/g) || []).sort().join(',');
    assert.strictEqual(ph(val[0]), ph(val[1]), `${key}: segnaposto diversi`);
    const tags = (s) => (s.match(/<\/?\w+/g) || []).sort().join(',');
    assert.strictEqual(tags(val[0]), tags(val[1]), `${key}: markup diverso`);
  }
});

test('nessuna chiave duplicata in strings.js', () => {
  const keys = [...read('js/strings.js').matchAll(/^ {4}'([^']+)': \[/gm)].map((m) => m[1]);
  const dup = keys.filter((k, i) => keys.indexOf(k) !== i);
  assert.deepStrictEqual(dup, []);
  assert.strictEqual(keys.length, Object.keys(STRINGS).length);
});

test('tutte le chiavi usate nell\'HTML esistono', () => {
  const html = read('index.html');
  const used = [...html.matchAll(/data-i18n(?:-html|-title|-placeholder|-aria|-title-key)?="([^"]+)"/g)].map((m) => m[1]);
  assert.ok(used.length > 150);
  const missing = [...new Set(used.filter((k) => !I18n.has(k)))];
  assert.deepStrictEqual(missing, []);
});

test('tutte le chiavi usate nel codice esistono', () => {
  const missing = [];
  const prefixes = [];
  for (const f of jsFiles) {
    if (f === 'js/strings.js') continue;
    const src = read(f);
    for (const m of src.matchAll(/\b(?:t|tr|tx_|App\.t|I18n\.t|this\.t)\(\s*'([a-zA-Z][\w.-]*)'/g)) if (!I18n.has(m[1])) missing.push(`${f}: ${m[1]}`);
    for (const m of src.matchAll(/\b(?:t|tr|App\.t|I18n\.t)\(\s*`([a-zA-Z][\w.-]*)\.\$\{/g)) prefixes.push(m[1]);
  }
  assert.deepStrictEqual(missing, []);
  for (const p of prefixes) assert.ok(Object.keys(STRINGS).some((k) => k.startsWith(`${p}.`)), `prefisso ${p}`);
});

test('fasi del volo e voci del readback: tutte tradotte', () => {
  for (const ph of require('../js/geo.js').PHASES) assert.ok(I18n.has(`fphase.${ph}`), ph);
  for (const p of require('../js/scenarios.js').PHASES) assert.ok(I18n.has(`phase.${p.id}`), p.id);
});

test('cambio lingua: testi, contenuti bilingui, date e valute', () => {
  const was = I18n.lang;
  try {
    I18n.lang = 'en';
    assert.strictEqual(I18n.t('listen.csCalls', { name: 'Alitalia 123' }), 'ATC calls you "Alitalia 123"');
    assert.strictEqual(I18n.pick(['Ciao', 'Hello']), 'Hello');
    assert.strictEqual(I18n.pick('Roger'), 'Roger');
    assert.match(I18n.money(3.5), /€\s?3\.50|3\.50\s?€/);
    I18n.lang = 'it';
    assert.strictEqual(I18n.t('listen.csCalls', { name: 'Alitalia 123' }), 'L\'ATC ti chiama "Alitalia 123"');
    assert.match(I18n.money(3.5), /3,50/);
    assert.strictEqual(I18n.t('chiave.inesistente'), 'chiave.inesistente');
  } finally {
    I18n.lang = was;
  }
});

test('readback in inglese: avvisi e casi speciali tradotti', () => {
  const R = require('../js/readback.js');
  const was = I18n.lang;
  try {
    I18n.lang = 'en';
    const r = R.generateReadback('Alitalia 123, report your level', { callsign: 'AZA123' });
    assert.strictEqual(r.readback, 'Report your level');
    assert.match(r.info[0], /ATC wants your level/);
    assert.match(R.generateReadback('Alitalia 123 squawk 4891', { callsign: 'AZA123' }).warnings[0], /not valid/);
  } finally {
    I18n.lang = was;
  }
});
