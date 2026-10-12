/* Verifiche di precisione su ogni readback: qualità dell'audio, AI confrontata con regole e
   trascrizione, e confronto con i dati live (ATC online, piste, QNH del METAR).
   Obiettivo: non mostrare mai in silenzio un valore dubbio. */
(function (root) {
  'use strict';

  const req = (name, global) => ((typeof require === 'function' && typeof module !== 'undefined') ? require(name) : root[global]);
  const Sc = req('./scenarios.js', 'Scenarios');
  const I18n = req('./i18n.js', 'I18n');
  const tr = (k, v) => I18n.t(k, v);

  function lev(a, b) {
    const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
      for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    return d[a.length][b.length];
  }

  const numbers = (text) => Sc.canon(text || '').filter((t) => /\d/.test(t));

  // Qualità della trascrizione Whisper (segmenti di verbose_json)
  function audioConfidence(segments) {
    if (!segments || !segments.length) return null;
    const avg = Math.min(...segments.map((s) => (typeof s.avg_logprob === 'number' ? s.avg_logprob : 0)));
    const noSpeech = Math.max(...segments.map((s) => s.no_speech_prob || 0));
    const comp = Math.max(...segments.map((s) => s.compression_ratio || 0));
    let level = 'ok';
    if (avg < -1.0 || noSpeech > 0.6 || comp > 2.4) level = 'bad';
    else if (avg < -0.7 || noSpeech > 0.35) level = 'warn';
    return { avg, noSpeech, comp, level };
  }

  const words = (text) => String(text || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(Boolean);

  // Frasi "fantasma" che Whisper scrive quando sente solo rumore o silenzio.
  const PHANTOMS = [
    /^(thank you|thanks)( (very|so) much)?( for watching| for listening)?$/,
    /^(you|bye|bye bye|okay|ok|oh|uh|um|hmm|yeah|so|the)$/,
    /^(please )?(like and )?subscribe.*$/, /^subtitles? by.*$/, /^(transcribed|transcription) by.*$/,
    /^(music|applause|silence|noise|static|blank audio|inaudible)$/, /^\.*$/,
  ];
  function phantom(text) {
    const w = words(text).join(' ');
    return !w || PHANTOMS.some((re) => re.test(w));
  }

  // La trascrizione ripete un pezzo lungo del prompt (eco): segno che Whisper non ha capito l'audio.
  function promptEcho(text, prompt, minRun) {
    const a = words(text);
    const b = words(prompt);
    const need = minRun || 7;
    if (a.length < need || b.length < need) return false;
    let best = 0;
    const prev = new Array(b.length + 1).fill(0);
    for (let i = 1; i <= a.length; i++) {
      let diag = 0;
      for (let j = 1; j <= b.length; j++) {
        const tmp = prev[j];
        prev[j] = a[i - 1] === b[j - 1] ? diag + 1 : 0;
        if (prev[j] > best) best = prev[j];
        diag = tmp;
      }
    }
    return best >= need;
  }

  /* opts: {
       transcript: string,            cosa ha capito il riconoscimento vocale
       rules: risultato di Readback.generateReadback,
       ai: string | null,             readback proposto dall'AI
       callsign: oggetto nominativo,
       audio: risultato di audioConfidence | null,
       prompt: prompt dato a Whisper (per riconoscere l'eco) | undefined,
       live: { freqs: [{freq, callsign}], runways: ['16L', ...], qnh: [1013, ...] } | null
     }
     -> { status: 'ok' | 'warn' | 'bad', reasons: [{level, text}], useRules, alt, suggestion } */
  function check(opts) {
    const reasons = [];
    const add = (level, text) => reasons.push({ level, text });
    const rules = opts.rules || { parts: [], warnings: [], readback: '' };
    const csNums = new Set(opts.callsign ? numbers(opts.callsign.display) : []);
    const strip = (arr) => arr.filter((n) => !csNums.has(n));
    const heard = new Set(numbers(opts.transcript));
    let useRules = false;
    let alt = null;
    let suggestion = null;

    // 1. Audio
    if (opts.prompt && promptEcho(opts.transcript, opts.prompt)) add('bad', tr('verify.echo'));
    if (opts.audio && opts.audio.level === 'bad') add('bad', tr('verify.audioBad'));
    else if (opts.audio && opts.audio.level === 'warn') add('warn', tr('verify.audioWarn'));

    // 2. Avvisi delle regole (squawk con 8/9, QNH fuori scala, frequenza non valida…)
    for (const w of rules.warnings || []) add('warn', w);

    // 3. AI confrontata con trascrizione e regole
    if (opts.ai) {
      const aiNums = strip(numbers(opts.ai));
      const invented = [...new Set(aiNums.filter((n) => !heard.has(n)))];
      if (invented.length) {
        useRules = true;
        add('warn', tr('verify.aiInvented', { nums: invented.join(', ') }));
      } else {
        const ruleText = (rules.parts || []).filter((p) => p.type !== 'ack').map((p) => p.display).join(' ');
        const missing = [...new Set(strip(numbers(ruleText)).filter((n) => !aiNums.includes(n)))];
        if (missing.length) {
          alt = rules.readback;
          add('warn', tr('verify.aiMissing', { nums: missing.join(', '), rules: rules.readback }));
        }
      }
    }

    // 4. Dati live
    const live = opts.live || {};
    const allText = (rules.parts || []).map((p) => p.display).join(' | ');
    const freqList = (live.freqs || []).filter((x) => x.callsign !== 'UNICOM');
    if (freqList.length) {
      for (const p of rules.parts || []) {
        if (p.type !== 'frequency') continue;
        const m = p.display.match(/(\d{3}\.\d{1,3})/);
        if (!m) continue;
        const f = parseFloat(m[1]);
        const all = live.freqs;
        if (all.some((x) => Math.abs(x.freq - f) < 0.01)) continue;
        // Più simile = cifre quasi uguali (125.05 ↔ 125.5) o valore vicinissimo
        const digits = (x) => x.toFixed(3).replace(/0+$/, '').replace('.', '');
        const score = (x) => Math.min(lev(digits(x.freq), digits(f)), Math.abs(x.freq - f) <= 0.15 ? 1 : 9);
        const nearest = all.reduce((best, x) => (!best || score(x) < score(best) ? x : best), null);
        if (nearest && score(nearest) <= 1) {
          suggestion = { freq: nearest.freq.toFixed(3).replace(/0+$/, '').replace(/\.$/, '.0'), callsign: nearest.callsign };
          add('warn', tr('verify.freqMaybe', { freq: m[1], near: nearest.freq.toFixed(3), cs: nearest.callsign }));
        } else {
          add('warn', tr('verify.freqUnknown', { freq: m[1] }));
        }
      }
    }
    if (live.runways && live.runways.length) {
      const known = new Set(live.runways.map((r) => String(r).toUpperCase()));
      const rwys = [...new Set((allText.match(/runway (\d{2}[LRC]?)/gi) || []).map((x) => x.split(' ')[1].toUpperCase()))];
      for (const r of rwys) if (!known.has(r)) add('warn', tr('verify.rwyUnknown', { rwy: r, list: [...known].join(', ') }));
    }
    const qnhs = (live.qnh || []).filter(Boolean);
    if (qnhs.length) {
      const m = allText.match(/QNH (\d{3,4})/);
      if (m && qnhs.every((q) => Math.abs(q - Number(m[1])) > 3)) {
        add('warn', tr('verify.qnhDiff', { qnh: m[1], metar: qnhs.join(' / ') }));
      }
    }

    const status = reasons.some((r) => r.level === 'bad') ? 'bad' : (reasons.length ? 'warn' : 'ok');
    return { status, reasons, useRules, alt, suggestion };
  }

  const api = { check, audioConfidence, numbers, phantom, promptEcho };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Precision = api;
})(this);
