#!/usr/bin/env node
/* Misura la precisione su audio ATC reali: trascrive ogni file con Whisper (Groq o server locale),
   genera il readback con il motore a regole e confronta i NUMERI (livelli, prue, frequenze, squawk,
   QNH, piste) con quelli attesi. È il dato che conta: un numero sbagliato in radio è l'errore grave.

   Cartella di prova: un file manifest.json + gli audio (wav/mp3/m4a/ogg):
     [{ "file": "001.wav", "callsign": "AZA123", "atc": "Alitalia 123, descend FL80, ...", "context": "Roma Radar" }, ...]
   "atc" = ciò che l'ATC ha detto davvero (trascritto a mano).

   Uso:
     GROQ_API_KEY=gsk_... node scripts/eval-audio.js cartella [--model whisper-large-v3-turbo]
     node scripts/eval-audio.js cartella --local http://127.0.0.1:8080
   Uscita: riepilogo a schermo + cartella/report.json (per confrontare versioni del prompt o del modello). */
'use strict';

const fs = require('fs');
const path = require('path');
const { Groq } = require('../js/groq.js');
const R = require('../js/readback.js');
const P = require('../js/precision.js');

const MIME = { '.wav': 'audio/wav', '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.ogg': 'audio/ogg', '.flac': 'audio/flac', '.webm': 'audio/webm' };

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : null;
}

// Numeri del readback, senza quelli del nominativo
function readbackNumbers(text, cs) {
  const rb = R.generateReadback(text, { callsign: cs });
  const csNums = new Set(cs ? P.numbers(cs.display) : []);
  return { rb, nums: P.numbers(rb.parts.map((p) => p.display).join(' ')).filter((n) => !csNums.has(n)) };
}

function compare(expected, got) {
  const left = [...got];
  let hit = 0;
  for (const n of expected) {
    const i = left.indexOf(n);
    if (i >= 0) { hit++; left.splice(i, 1); }
  }
  return { hit, missing: expected.length - hit, extra: left.length };
}

async function main() {
  const dir = process.argv[2];
  if (!dir || !fs.existsSync(path.join(dir, 'manifest.json'))) {
    console.error('Uso: node scripts/eval-audio.js <cartella con manifest.json> [--local URL] [--model nome]');
    process.exit(2);
  }
  const local = arg('local');
  const key = process.env.GROQ_API_KEY || '';
  if (!local && !key) { console.error('Serve GROQ_API_KEY oppure --local URL'); process.exit(2); }
  const model = arg('model') || '';
  const items = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  const rows = [];
  let tot = { exp: 0, hit: 0, extra: 0, perfect: 0, flagged: 0, wrongUnflagged: 0 };

  for (const it of items) {
    const cs = R.parseCallsign(it.callsign);
    const buf = fs.readFileSync(path.join(dir, it.file));
    const blob = new Blob([buf], { type: MIME[path.extname(it.file).toLowerCase()] || 'audio/wav' });
    const t0 = Date.now();
    let heard = '';
    let segments = [];
    try {
      const r = await Groq.transcribe(blob, { key, model, base: local || '', callsign: cs ? cs.display : '', context: it.context || '' });
      heard = r.text;
      segments = r.segments;
    } catch (e) {
      heard = '';
      console.error(`${it.file}: ${e.message}`);
    }
    const ms = Date.now() - t0;
    const exp = readbackNumbers(it.atc, cs);
    const got = readbackNumbers(heard, cs);
    const c = compare(exp.nums, got.nums);
    const verify = P.check({ transcript: heard, rules: got.rb, callsign: cs, audio: P.audioConfidence(segments), prompt: Groq.buildPrompt(cs ? cs.display : '', it.context || '') });
    const wrong = c.missing > 0 || c.extra > 0;
    tot.exp += exp.nums.length;
    tot.hit += c.hit;
    tot.extra += c.extra;
    if (!wrong) tot.perfect++;
    if (verify.status !== 'ok') tot.flagged++;
    // L'errore peggiore: numeri sbagliati mostrati come "Verificato"
    if (wrong && verify.status === 'ok') tot.wrongUnflagged++;
    rows.push({ file: it.file, ms, atc: it.atc, heard, expected: exp.nums, got: got.nums, ...c, verify: verify.status, reasons: verify.reasons.map((x) => x.text) });
    console.log(`${wrong ? '✗' : '✓'} ${it.file.padEnd(16)} ${String(ms).padStart(5)} ms  ${verify.status.padEnd(4)}  ${heard}`);
  }

  const pct = (a, b) => (b ? `${((a / b) * 100).toFixed(1)}%` : '—');
  const summary = {
    files: items.length,
    numberAccuracy: pct(tot.hit, tot.exp),
    inventedNumbers: tot.extra,
    perfectTransmissions: pct(tot.perfect, items.length),
    flaggedForCheck: pct(tot.flagged, items.length),
    wrongButShownAsVerified: tot.wrongUnflagged,
    model: model || (local ? 'local' : 'auto'),
    provider: local ? `local ${local}` : 'groq',
    date: new Date().toISOString(),
  };
  console.log('\n', summary);
  fs.writeFileSync(path.join(dir, 'report.json'), JSON.stringify({ summary, rows }, null, 2));
}

if (require.main === module) main().catch((e) => { console.error(e); process.exit(1); });
module.exports = { readbackNumbers, compare };
