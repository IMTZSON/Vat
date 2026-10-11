/* Motore di readback: prende la trascrizione di un'istruzione ATC e genera
   la frase che il pilota deve ripetere (formato scritto + pronuncia ICAO).
   Funziona offline, senza AI: usa regole sulla fraseologia standard. */
(function (root) {
  'use strict';

  const Callsigns = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./callsigns.js')
    : root.Callsigns;
  const AIRLINES = (Callsigns && Callsigns.AIRLINES) || {};

  // ---------------------------------------------------------------- lessico

  const UNIT = {
    zero: '0', one: '1', two: '2', three: '3', tree: '3', four: '4', fower: '4',
    five: '5', fife: '5', six: '6', seven: '7', eight: '8', nine: '9', niner: '9',
  };
  const TEEN = {
    ten: '10', eleven: '11', twelve: '12', thirteen: '13', fourteen: '14',
    fifteen: '15', sixteen: '16', seventeen: '17', eighteen: '18', nineteen: '19',
  };
  const TENS = {
    twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50,
    sixty: 60, seventy: 70, eighty: 80, ninety: 90,
  };
  const PHONETIC = {
    alpha: 'A', alfa: 'A', bravo: 'B', charlie: 'C', delta: 'D', echo: 'E',
    foxtrot: 'F', golf: 'G', hotel: 'H', india: 'I', juliet: 'J', juliett: 'J',
    kilo: 'K', lima: 'L', mike: 'M', november: 'N', oscar: 'O', papa: 'P',
    quebec: 'Q', romeo: 'R', sierra: 'S', tango: 'T', uniform: 'U',
    victor: 'V', whiskey: 'W', whisky: 'W', xray: 'X', yankee: 'Y', zulu: 'Z',
  };
  const LETTER_WORD = {
    A: 'Alpha', B: 'Bravo', C: 'Charlie', D: 'Delta', E: 'Echo', F: 'Foxtrot',
    G: 'Golf', H: 'Hotel', I: 'India', J: 'Juliett', K: 'Kilo', L: 'Lima',
    M: 'Mike', N: 'November', O: 'Oscar', P: 'Papa', Q: 'Quebec', R: 'Romeo',
    S: 'Sierra', T: 'Tango', U: 'Uniform', V: 'Victor', W: 'Whiskey',
    X: 'X-ray', Y: 'Yankee', Z: 'Zulu',
  };
  const DIGIT_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];

  // Parole che chiudono un gruppo (nome stazione, destinazione, ecc.)
  const STOP = new Set([
    'climb', 'descend', 'maintain', 'expect', 'turn', 'heading', 'fly', 'speed',
    'reduce', 'increase', 'squawk', 'qnh', 'altimeter', 'contact', 'monitor',
    'runway', 'cleared', 'line', 'hold', 'holding', 'cross', 'taxi', 'via', 'direct',
    'proceed', 'report', 'fl', 'altitude', 'when', 'after', 'behind', 'good',
    'goodbye', 'bye', 'day', 'ciao', 'and', 'then', 'wind', 'information', 'on',
    'initial', 'initially', 'departure', 'arrival', 'approach', 'push', 'pushback',
    'startup', 'start', 'go', 'continue', 'say', 'roger', 'now', 'frequency',
    'radar', 'identified', 'traffic', 'feet', 'knots', 'resume', 'vacate',
  ]);

  // Per i nomi delle stazioni ("Roma Radar", "Milano Approach") alcune parole non chiudono il nome.
  const STATION_STOP = new Set([...STOP, 'frequency'].filter((w) => !['radar', 'approach', 'departure', 'arrival', 'information'].includes(w)));

  const RUNWAY_SIDE = { left: 'L', l: 'L', right: 'R', r: 'R', center: 'C', c: 'C' };
  const SIDE_WORD = { L: 'left', R: 'right', C: 'center' };

  // ------------------------------------------------------------- utilità

  const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
  const titleCase = (words) => words.map(cap).join(' ');
  const isDigits = (t, min, max) => typeof t === 'string' && new RegExp(`^\\d{${min},${max}}$`).test(t);

  function spellDigits(str) {
    return String(str).split('').map((c) => {
      if (c === '.') return 'decimal';
      if (/\d/.test(c)) return DIGIT_WORD[Number(c)];
      if (LETTER_WORD[c.toUpperCase()]) return LETTER_WORD[c.toUpperCase()];
      return c;
    }).join(' ');
  }
  const spellAlnum = spellDigits;

  function spokenAltitude(n) {
    n = Number(n);
    if (n >= 1000 && n % 100 === 0) {
      const th = Math.floor(n / 1000);
      const hu = (n % 1000) / 100;
      let s = `${spellDigits(String(th))} thousand`;
      if (hu) s += ` ${DIGIT_WORD[hu]} hundred`;
      return s;
    }
    if (n < 1000 && n % 100 === 0) return `${DIGIT_WORD[n / 100]} hundred`;
    return spellDigits(String(n));
  }

  function spokenFL(n) {
    n = Number(n);
    if (n > 0 && n % 100 === 0) return `flight level ${DIGIT_WORD[n / 100]} hundred`;
    return `flight level ${spellDigits(String(n))}`;
  }

  function spokenRunway(rwy) {
    const m = rwy.match(/^(\d{1,2})([LRC]?)$/);
    if (!m) return spellDigits(rwy);
    return spellDigits(m[1]) + (m[2] ? ` ${SIDE_WORD[m[2]]}` : '');
  }

  function fixFreq(t) {
    if (!t) return null;
    let s = String(t);
    if (!s.includes('.') && /^1[1-3]\d\d{1,3}$/.test(s)) s = `${s.slice(0, 3)}.${s.slice(3)}`;
    const m = s.match(/^(1[1-3]\d)\.(\d{1,3})$/);
    if (!m) return null;
    let dec = m[2].replace(/0+$/, '');
    if (!dec) dec = '0';
    return `${m[1]}.${dec}`;
  }

  // ------------------------------------------------------- normalizzazione

  function preNormalize(text) {
    let s = ` ${String(text || '').toLowerCase()} `;
    s = s.replace(/(\d),(\d{3})/g, '$1$2');
    s = s.replace(/x-ray|x ray/g, 'xray');
    s = s.replace(/take-off|take off/g, 'takeoff');
    s = s.replace(/start-up|start up/g, 'startup');
    s = s.replace(/push-back|push back/g, 'pushback');
    s = s.replace(/line-up|lineup/g, 'line up');
    s = s.replace(/(\d)\.(\d)/g, '$1§$2');
    s = s.replace(/[^a-z0-9§ ]/g, ' ');
    s = s.replace(/§/g, '.');
    // errori tipici del riconoscimento vocale
    s = s.replace(/\b(flight ?levels?|fly ?level|flight ?lebel)\b/g, ' fl ');
    s = s.replace(/\bfl(\d)/g, 'fl $1');
    s = s.replace(/\b(q ?n ?h|queue and h|q and h|cue and h)\b/g, ' qnh ');
    s = s.replace(/\bqnh(\d)/g, 'qnh $1');
    s = s.replace(/\b(squawking|squawks|squak|squark|squalk|squad|squat)\b/g, ' squawk ');
    s = s.replace(/\b(runaway|run way)\b/g, ' runway ');
    s = s.replace(/\b(hectopascals?|millibars?)\b/g, ' ');
    s = s.replace(/\b(feet|ft)\b/g, ' feet ');
    s = s.replace(/\b(knots?|kts?)\b/g, ' knots ');
    s = s.replace(/\bcentre\b/g, 'center');
    return s.replace(/\s+/g, ' ').trim();
  }

  const isNumTok = (t) => t !== undefined && (/^\d+(\.\d+)?$/.test(t) || t in UNIT || t in TEEN || t in TENS);

  // Unisce numeri pronunciati cifra per cifra: "one two five decimal five" -> "125.5"
  function collapseNumbers(tokens) {
    const out = [];
    let i = 0;
    while (i < tokens.length) {
      if (!isNumTok(tokens[i])) { out.push(tokens[i]); i++; continue; }
      let s = '';
      let j = i;
      while (j < tokens.length) {
        const t = tokens[j];
        if (/^\d+(\.\d+)?$/.test(t)) {
          if (t.includes('.') && s.includes('.')) break;
          if (s && Number(s) >= 1000 && /000$/.test(s) && /^[1-9]00$/.test(t)) s = String(Number(s) + Number(t));
          else s += t;
          j++;
          continue;
        }
        if (t in UNIT) { s += UNIT[t]; j++; continue; }
        if (t in TEEN) { s += TEEN[t]; j++; continue; }
        if (t in TENS) {
          let v = TENS[t];
          j++;
          const nx = tokens[j];
          if (nx in UNIT && UNIT[nx] !== '0') { v += Number(UNIT[nx]); j++; }
          else if (/^[1-9]$/.test(nx || '')) { v += Number(nx); j++; }
          s += String(v);
          continue;
        }
        if ((t === 'decimal' || t === 'point') && s && !s.includes('.') && isNumTok(tokens[j + 1]) && !(tokens[j + 1] in TENS)) {
          s += '.';
          j++;
          continue;
        }
        if (t === 'thousand' && s && !s.includes('.')) {
          let v = Number(s) * 1000;
          j++;
          const a = tokens[j];
          const d = a in UNIT ? UNIT[a] : (/^[1-9]$/.test(a || '') ? a : null);
          if (d !== null && tokens[j + 1] === 'hundred') { v += Number(d) * 100; j += 2; }
          s = String(v);
          break;
        }
        if (t === 'hundred' && s && !s.includes('.')) { s = String(Number(s) * 100); j++; break; }
        break;
      }
      if (s.endsWith('.')) s = s.slice(0, -1);
      out.push(s);
      i = j;
    }
    return out;
  }

  function tokenize(text) {
    const pre = preNormalize(text);
    return collapseNumbers(pre ? pre.split(' ') : []);
  }

  // ------------------------------------------------------- lettori comuni

  // Designatore pista: "16l", "16 left", "34", "07 r"
  function readRunway(toks, j) {
    const t = toks[j];
    if (!t) return null;
    let m = t.match(/^(\d{1,2})([lrc])?$/);
    if (!m || Number(m[1]) < 1 || Number(m[1]) > 36) return null;
    let value = m[1].padStart(2, '0');
    let next = j + 1;
    if (m[2]) value += m[2].toUpperCase();
    else if (RUNWAY_SIDE[toks[next]]) { value += RUNWAY_SIDE[toks[next]]; next++; }
    return { value, next, spoken: spokenRunway(value) };
  }

  // "runway 16l" o solo "16l" (opzionale "runway")
  function readOptRunway(toks, j) {
    let k = j;
    if (toks[k] === 'runway') k++;
    const r = readRunway(toks, k);
    if (!r) return null;
    return { display: ` runway ${r.value}`, spoken: ` runway ${r.spoken}`, next: r.next };
  }

  function readLevel(toks, j) {
    if (toks[j] === 'to' || toks[j] === 'at') j++;
    if (toks[j] === 'fl' && isDigits(toks[j + 1], 2, 3)) {
      const v = Number(toks[j + 1]);
      return { display: `FL${v}`, spoken: spokenFL(v), next: j + 2 };
    }
    let isAlt = false;
    if (toks[j] === 'altitude') { isAlt = true; j++; }
    if (!isDigits(toks[j], 3, 5)) return null;
    if (toks[j + 1] === 'knots') return null;
    const v = Number(toks[j]);
    let next = j + 1;
    if (toks[next] === 'feet') { isAlt = true; next++; }
    if (!isAlt && v < 1000) return { display: `FL${v}`, spoken: spokenFL(v), next };
    return { display: `${v} ft`, spoken: `${spokenAltitude(v)} feet`, next };
  }

  // Lettere fonetiche -> lettere. joinLetters=true: "lima india mike charlie" -> "LIMC"
  function compactWords(words, joinLetters) {
    const out = []; // {d: display, s: spoken, kind}
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      const L = PHONETIC[w];
      const prev = out[out.length - 1];
      if (L) {
        if (prev && prev.kind === 'N' && prev.d.length <= 2) {
          prev.d += L; prev.s += ` ${LETTER_WORD[L].toLowerCase()}`; prev.kind = 'NL';
        } else if (joinLetters && prev && prev.kind === 'L') {
          prev.d += L; prev.s += ` ${LETTER_WORD[L].toLowerCase()}`;
        } else {
          out.push({ d: L, s: LETTER_WORD[L].toLowerCase(), kind: 'L' });
        }
      } else if (/^\d+$/.test(w)) {
        if (prev && prev.kind === 'L' && prev.d.length === 1 && w.length <= 2) {
          prev.d += w; prev.s += ` ${spellDigits(w)}`; prev.kind = 'LN';
        } else {
          out.push({ d: w, s: spellDigits(w), kind: 'N' });
        }
      } else if (/^\d{1,2}[a-z]$/.test(w) || /^[a-z]\d{1,2}$/.test(w)) {
        const up = w.toUpperCase();
        out.push({ d: up, s: spellDigits(up).toLowerCase(), kind: 'NL' });
      } else {
        out.push({ d: w, s: w, kind: 'W' });
      }
    }
    return out;
  }

  // Nome tipo "bolla 5 alpha" -> BOLLA 5A, "lima india mike charlie" -> LIMC
  function nameFromWords(words, upper) {
    const items = compactWords(words, true);
    return {
      display: items.map((x) => (x.kind === 'W' ? (upper ? x.d.toUpperCase() : cap(x.d)) : x.d)).join(' '),
      spoken: items.map((x) => (x.kind === 'W' && !upper ? cap(x.s) : x.s)).join(' '),
    };
  }

  function takeUntilStop(toks, j, max, extraStop, stopSet) {
    const words = [];
    const stop = stopSet || STOP;
    while (j < toks.length && words.length < max) {
      const t = toks[j];
      if (stop.has(t) || (extraStop && extraStop.has(t)) || /^\d/.test(t)) break;
      words.push(t);
      j++;
    }
    return { words, next: j };
  }

  const P = (type, display, spoken, extra) => Object.assign({ type, display, spoken }, extra || {});

  // ---------------------------------------------------------------- regole
  // Ogni regola riceve (toks, i, ctx) e restituisce { part, next } oppure null.

  function ruleClearance(toks, i) {
    if (toks[i] !== 'cleared' || toks[i + 1] !== 'to' || toks[i + 2] === 'land') return null;
    const stop = new Set(['runway', 'climb', 'initial', 'initially', 'squawk', 'maintain', 'expect', 'qnh', 'contact', 'information', 'with', 'and', 'then', 'climbing']);
    let j = i + 2;
    const words = [];
    while (j < toks.length && !stop.has(toks[j]) && words.length < 12) { words.push(toks[j]); j++; }
    if (!words.length) return null;
    let dest = words;
    let route = [];
    let hadDeparture = false;
    const depIdx = words.indexOf('departure');
    const viaIdx = words.indexOf('via');
    if (depIdx >= 0) { hadDeparture = true; }
    const routeEnd = depIdx >= 0 ? depIdx : words.length;
    if (viaIdx >= 0) {
      dest = words.slice(0, viaIdx);
      route = words.slice(viaIdx + 1, routeEnd);
    } else if (depIdx >= 0) {
      const firstNum = words.findIndex((w) => /^\d/.test(w));
      if (firstNum > 0 && firstNum < depIdx) {
        dest = words.slice(0, firstNum - 1);
        route = words.slice(firstNum - 1, depIdx);
      } else {
        dest = words.slice(0, depIdx);
      }
    }
    dest = dest.filter((w) => w !== 'airport');
    if (!dest.length) return null;
    const d = nameFromWords(dest, false);
    let display = `Cleared to ${d.display}`;
    let spoken = `cleared to ${d.spoken}`;
    if (route.length) {
      const flightPlan = route.join(' ').includes('flight plan');
      const r = flightPlan ? { display: 'flight planned route', spoken: 'flight planned route' } : nameFromWords(route, true);
      const via = flightPlan || hadDeparture ? '' : 'via ';
      display += `, ${via}${r.display}${hadDeparture ? ' departure' : ''}`;
      spoken += `, ${via}${r.spoken}${hadDeparture ? ' departure' : ''}`;
    }
    return { part: P('clearance', display, spoken), next: j };
  }

  const APP_TYPES = { ils: 'ILS', rnav: 'RNAV', rnp: 'RNP', gnss: 'GNSS', gps: 'GPS', vor: 'VOR', ndb: 'NDB', loc: 'LOC', localizer: 'localizer', visual: 'visual', dme: 'DME' };

  function ruleApproach(toks, i) {
    const verb = toks[i];
    if (verb !== 'cleared' && verb !== 'expect') return null;
    let k = i + 1;
    const inner = [];
    while (k < toks.length && k <= i + 7 && toks[k] !== 'approach') { inner.push(toks[k]); k++; }
    if (toks[k] !== 'approach') return null;
    const types = inner.filter((w) => APP_TYPES[w]);
    if (!types.length) return null;
    let typeDisplay = types.map((w) => APP_TYPES[w]).join(' ');
    let typeSpoken = types.map((w) => APP_TYPES[w]).join(' ');
    const variant = inner.find((w) => ['zulu', 'yankee', 'xray', 'z', 'y', 'x'].includes(w));
    if (variant) {
      const L = PHONETIC[variant] || variant.toUpperCase();
      typeDisplay += ` ${L}`;
      typeSpoken += ` ${LETTER_WORD[L].toLowerCase()}`;
    }
    let rwy = null;
    for (let x = 0; x < inner.length && !rwy; x++) {
      const r = readRunway(inner, x);
      if (r && (inner[x - 1] === 'runway' || /[lrc]$/.test(inner[x]) || RUNWAY_SIDE[inner[x + 1]])) rwy = r;
    }
    let next = k + 1;
    if (!rwy) {
      const after = readOptRunway(toks, next);
      if (after) { rwy = { value: after.display.replace(' runway ', ''), spoken: after.spoken.replace(' runway ', '') }; next = after.next; }
    }
    const v = verb === 'cleared' ? 'Cleared' : 'Expect';
    let display = `${v} ${typeDisplay} approach`;
    let spoken = `${v.toLowerCase()} ${typeSpoken} approach`;
    if (rwy) { display += ` runway ${rwy.value}`; spoken += ` runway ${rwy.spoken}`; }
    return { part: P('approach', display, spoken), next };
  }

  function ruleArrival(toks, i) {
    if (toks[i] !== 'cleared') return null;
    let k = i + 1;
    const inner = [];
    while (k < toks.length && k <= i + 5 && toks[k] !== 'arrival') { inner.push(toks[k]); k++; }
    if (toks[k] !== 'arrival' || !inner.length) return null;
    const n = nameFromWords(inner, true);
    return { part: P('arrival', `Cleared ${n.display} arrival`, `cleared ${n.spoken} arrival`), next: k + 1 };
  }

  function ruleRunwayOps(toks, i) {
    const t = toks[i];
    const t1 = toks[i + 1];
    const t2 = toks[i + 2];
    const t3 = toks[i + 3];
    let base = null;
    let j = i;
    if (t === 'cleared' && t1 === 'to' && t2 === 'land') { base = ['Cleared to land', 'cleared to land']; j = i + 3; }
    else if (t === 'cleared' && (t1 === 'takeoff' || (t1 === 'for' && t2 === 'takeoff'))) { base = ['Cleared for takeoff', 'cleared for takeoff']; j = t1 === 'for' ? i + 3 : i + 2; }
    else if (t === 'cleared' && (t1 === 'touch' || (t1 === 'for' && t2 === 'touch'))) {
      j = t1 === 'for' ? i + 2 : i + 1;
      if (toks[j] === 'touch' && toks[j + 1] === 'and' && toks[j + 2] === 'go') { base = ['Cleared touch and go', 'cleared touch and go']; j += 3; }
      else return null;
    }
    else if (t === 'line' && t1 === 'up') {
      if (t2 === 'and' && t3 === 'wait') { base = ['Line up and wait', 'line up and wait']; j = i + 4; }
      else { base = ['Line up', 'line up']; j = i + 2; }
    }
    else if (t === 'hold' && t1 === 'short') { base = ['Holding short', 'holding short']; j = i + 2; if (toks[j] === 'of') j++; }
    else if (t === 'cross' && (t1 === 'runway' || readRunway(toks, i + 1))) { base = ['Cross', 'cross']; j = i + 1; }
    else return null;

    const r = readOptRunway(toks, j);
    let display = base[0];
    let spoken = base[1];
    if (r) { display += r.display; spoken += r.spoken; j = r.next; }
    else if (base[0] === 'Cross') return null;
    return { part: P('runway', display, spoken), next: j };
  }

  function rulePhrases(toks, i) {
    const t = toks[i];
    const t1 = toks[i + 1];
    const t2 = toks[i + 2];
    const simple = (d, s, n) => ({ part: P('phrase', d, s), next: i + n });
    if (t === 'hold' && t1 === 'position') return simple('Holding position', 'holding position', 2);
    if (t === 'go' && t1 === 'around') return simple('Going around', 'going around', 2);
    if (t === 'continue' && t1 === 'approach') return simple('Continue approach', 'continue approach', 2);
    if (t === 'runway' && t1 === 'heading') return simple('Runway heading', 'runway heading', 2);
    if ((t === 'continue' || t === 'fly' || t === 'maintain') && t1 === 'present' && t2 === 'heading') {
      return simple(`${cap(t)} present heading`, `${t} present heading`, 3);
    }
    if (t === 'resume' && t1 === 'normal' && t2 === 'speed') return simple('Resume normal speed', 'resume normal speed', 3);
    if (t === 'no' && t1 === 'speed' && /^restrictions?$/.test(t2 || '')) return simple('No speed restrictions', 'no speed restrictions', 3);
    return null;
  }

  function rulePushStart(toks, i) {
    const t = toks[i];
    if (!['push', 'pushback', 'startup', 'start'].includes(t)) return null;
    let k = i;
    const words = [];
    while (k < toks.length && k <= i + 4 && toks[k] !== 'approved') { words.push(toks[k]); k++; }
    if (toks[k] !== 'approved') return null;
    const w = words.join(' ');
    let phrase;
    if (/push/.test(w) && /start/.test(w)) phrase = 'Push and start approved';
    else if (/push/.test(w)) phrase = 'Pushback approved';
    else phrase = 'Startup approved';
    let next = k + 1;
    let tail = '';
    if (['face', 'facing'].includes(toks[next]) && ['north', 'south', 'east', 'west'].includes(toks[next + 1])) {
      tail = `, facing ${toks[next + 1]}`;
      next += 2;
    } else if (toks[next] === 'tail' && ['north', 'south', 'east', 'west'].includes(toks[next + 1])) {
      tail = `, tail ${toks[next + 1]}`;
      next += 2;
    }
    return { part: P('ground', phrase + tail, (phrase + tail).toLowerCase()), next };
  }

  function ruleTaxi(toks, i) {
    if (toks[i] !== 'taxi') return null;
    const stop = new Set(['hold', 'contact', 'monitor', 'qnh', 'squawk', 'cleared', 'give', 'report', 'expect', 'when', 'good', 'goodbye']);
    let j = i + 1;
    const words = [];
    while (j < toks.length && !stop.has(toks[j]) && words.length < 20) { words.push(toks[j]); j++; }
    const items = [];
    for (let k = 0; k < words.length; k++) {
      const w = words[k];
      if (w === 'runway' || /^\d{1,2}[lrc]$/.test(w) || (/^\d{1,2}$/.test(w) && RUNWAY_SIDE[words[k + 1]] && words[k + 1].length > 1)) {
        const r = readRunway(words, w === 'runway' ? k + 1 : k);
        if (r) {
          items.push({ d: `runway ${r.value}`, s: `runway ${r.spoken}`, kind: 'R' });
          k = r.next - 1;
          continue;
        }
      }
      const L = PHONETIC[w];
      if (L) {
        let d = L;
        let s = LETTER_WORD[L].toLowerCase();
        if (/^\d{1,2}$/.test(words[k + 1] || '')) { d += words[k + 1]; s += ` ${spellDigits(words[k + 1])}`; k++; }
        items.push({ d, s, kind: 'T' });
        continue;
      }
      if (/^[a-z]\d{0,2}$/.test(w) && w !== 'a') {
        items.push({ d: w.toUpperCase(), s: spellDigits(w.toUpperCase()), kind: 'T' });
        continue;
      }
      if (/^\d+$/.test(w)) { items.push({ d: w, s: spellDigits(w), kind: 'N' }); continue; }
      items.push({ d: w, s: w, kind: 'W' });
    }
    let display = 'Taxi';
    let spoken = 'taxi';
    items.forEach((x, k) => {
      const sep = k > 0 && x.kind === 'T' && items[k - 1].kind === 'T' ? ', ' : ' ';
      display += sep + x.d;
      spoken += ` ${x.s}`;
    });
    return { part: P('taxi', display, spoken), next: j };
  }

  function ruleLevel(toks, i) {
    const t = toks[i];
    const t1 = toks[i + 1];
    let verb = null;
    let j = i;
    if (t === 'stop' && (t1 === 'climb' || t1 === 'descent')) {
      verb = t1 === 'climb' ? 'Stop climb at' : 'Stop descent at';
      j = i + 2;
      if (toks[j] === 'at') j++;
    } else if ((t === 'initial' && t1 === 'climb') || (t === 'climb' && t1 === 'initially') || (t === 'initially' && t1 === 'climb')) {
      verb = 'Initial climb';
      j = i + 2;
    } else if (t === 'climb' || t === 'descend') {
      verb = cap(t);
      j = i + 1;
      if (toks[j] === 'and' && toks[j + 1] === 'maintain') j += 2;
      else if (toks[j] === 'now') j++;
      if (toks[j] === 'via' && (toks[j + 1] === 'sid' || toks[j + 1] === 'star')) {
        const w = toks[j + 1].toUpperCase();
        return { part: P('level', `${verb} via ${w}`, `${t} via ${w.toLowerCase()}`), next: j + 2 };
      }
    } else if (t === 'maintain') {
      verb = 'Maintain';
      j = i + 1;
    } else if (t === 'expect') {
      verb = 'Expect';
      j = i + 1;
    } else {
      return null;
    }
    const lv = readLevel(toks, j);
    if (!lv) return null;
    let display = `${verb} ${lv.display}`;
    let spoken = `${verb.toLowerCase()} ${lv.spoken}`;
    j = lv.next;
    if (verb === 'Expect' && isDigits(toks[j], 1, 2) && toks[j + 1] === 'minutes') {
      let k = j + 2;
      if (toks[k] === 'after' && toks[k + 1] === 'departure') k += 2;
      display += ` ${toks[j]} min after departure`;
      spoken += ` ${spellDigits(toks[j])} minutes after departure`;
      j = k;
    }
    if (toks[i - 2] === 'when' && toks[i - 1] === 'ready') {
      display = `When ready, ${display.charAt(0).toLowerCase()}${display.slice(1)}`;
      spoken = `when ready ${spoken}`;
    }
    return { part: P('level', display, spoken), next: j };
  }

  function ruleHeading(toks, i) {
    const t = toks[i];
    const t1 = toks[i + 1];
    let dir = null;
    let j;
    if (t === 'turn' && (t1 === 'left' || t1 === 'right')) {
      dir = t1;
      j = i + 2;
      if (toks[j] === 'heading') j++;
    } else if ((t === 'left' || t === 'right') && t1 === 'heading') {
      dir = t;
      j = i + 2;
    } else if (t === 'heading') {
      j = i + 1;
    } else {
      return null;
    }
    if (!isDigits(toks[j], 1, 3)) return null;
    const v = Number(toks[j]);
    if (v < 1 || v > 360) return null;
    const hdg = String(v).padStart(3, '0');
    j++;
    if (toks[j] === 'degrees') j++;
    const display = dir ? `${cap(dir)} heading ${hdg}` : `Heading ${hdg}`;
    const spoken = `${dir ? `${dir} ` : ''}heading ${spellDigits(hdg)}`;
    return { part: P('heading', display, spoken), next: j };
  }

  function ruleSpeed(toks, i) {
    const t = toks[i];
    const t1 = toks[i + 1];
    let j;
    let verb = 'Speed';
    if (t === 'reduce' || t === 'increase') {
      verb = `${cap(t)} speed`;
      j = i + 1;
      if (toks[j] === 'speed') j++;
      if (toks[j] === 'to') j++;
    } else if (t === 'maintain' && t1 === 'speed') {
      verb = 'Maintain speed';
      j = i + 2;
      if (toks[j] === 'to') j++;
    } else if (t === 'maintain' && isDigits(t1, 2, 3) && toks[i + 2] === 'knots') {
      verb = 'Maintain';
      j = i + 1;
    } else if (t === 'speed' && (isDigits(t1, 2, 3) || t1 === 'to')) {
      j = i + 1;
      if (toks[j] === 'to') j++;
    } else {
      return null;
    }
    if (!isDigits(toks[j], 2, 3)) return null;
    const v = toks[j];
    j++;
    if (toks[j] === 'knots') j++;
    let display = `${verb} ${v} kt`;
    let spoken = `${verb.toLowerCase()} ${spellDigits(v)} knots`;
    if (toks[j] === 'or' && ['greater', 'more', 'less', 'higher', 'faster', 'slower'].includes(toks[j + 1])) {
      display += ` or ${toks[j + 1]}`;
      spoken += ` or ${toks[j + 1]}`;
      j += 2;
    }
    if (toks[j] === 'until' && isDigits(toks[j + 1], 1, 2) && ['miles', 'mile', 'dme', 'nautical'].includes(toks[j + 2])) {
      display += ` until ${toks[j + 1]} DME`;
      spoken += ` until ${spellDigits(toks[j + 1])} miles`;
      j += 3;
      if (toks[j] === 'miles') j++;
    }
    return { part: P('speed', display, spoken), next: j };
  }

  function ruleSquawk(toks, i, ctx) {
    if (toks[i] !== 'squawk') return null;
    const t1 = toks[i + 1];
    if (isDigits(t1, 4, 4)) {
      if (/[89]/.test(t1)) ctx.warnings.push(`Lo squawk ${t1} contiene 8 o 9: non è valido, chiedi "say again squawk".`);
      return { part: P('squawk', `Squawk ${t1}`, `squawk ${spellDigits(t1)}`), next: i + 2 };
    }
    if (t1 === 'ident') return { part: P('squawk', 'Squawk ident', 'squawk ident'), next: i + 2 };
    if (t1 === 'standby') return { part: P('squawk', 'Squawk standby', 'squawk standby'), next: i + 2 };
    if (t1 === 'vfr') return { part: P('squawk', 'Squawk VFR', 'squawk v f r'), next: i + 2 };
    if (t1 === 'charlie' || (t1 === 'mode' && toks[i + 2] === 'charlie')) {
      return { part: P('squawk', 'Squawk Charlie', 'squawk charlie'), next: t1 === 'mode' ? i + 3 : i + 2 };
    }
    return null;
  }

  function ruleQnh(toks, i, ctx) {
    const t = toks[i];
    if (t !== 'qnh' && t !== 'altimeter') return null;
    let j = i + 1;
    if (toks[j] === 'setting') j++;
    if (toks[j] === 'is') j++;
    const v = toks[j];
    if (!/^\d{3,4}(\.\d{1,2})?$/.test(v || '')) return null;
    const val = v.replace('.', '');
    if (t === 'qnh') {
      if (Number(val) < 940 || Number(val) > 1060) ctx.warnings.push(`QNH ${val} sembra strano: verifica.`);
      return { part: P('qnh', `QNH ${val}`, `QNH ${spellDigits(val)}`), next: j + 1 };
    }
    return { part: P('qnh', `Altimeter ${val}`, `altimeter ${spellDigits(val)}`), next: j + 1 };
  }

  function ruleContact(toks, i, ctx) {
    const t = toks[i];
    if (t !== 'contact' && t !== 'monitor') return null;
    if (toks[i - 1] === 'radar') return null;
    let j = i + 1;
    const station = takeUntilStop(toks, j, 4, null, STATION_STOP);
    j = station.next;
    if (toks[j] === 'frequency') j++;
    if (toks[j] === 'on') j++;
    let freq = fixFreq(toks[j]);
    if (!freq && /^1[1-3]\d$/.test(toks[j] || '') && /^\d{1,3}$/.test(toks[j + 1] || '')) {
      freq = fixFreq(`${toks[j]}.${toks[j + 1]}`);
      if (freq) j++;
    }
    if (freq) j++;
    else if (toks[j] && /^\d{3,6}(\.\d+)?$/.test(toks[j])) {
      ctx.warnings.push(`Frequenza "${toks[j]}" non valida: chiedi "say again frequency".`);
    }
    if (!freq && !station.words.length) return null;
    const name = titleCase(station.words);
    let display;
    let spoken;
    if (freq) {
      display = `${t === 'monitor' ? 'Monitor ' : ''}${name ? `${name} ` : ''}${freq}`;
      spoken = `${t === 'monitor' ? 'monitor ' : ''}${name ? `${name} ` : ''}${spellDigits(freq)}`;
    } else {
      display = `${cap(t)} ${name}`;
      spoken = `${t} ${name}`;
    }
    return { part: P('frequency', display, spoken), next: j };
  }

  function ruleDirect(toks, i) {
    let j;
    if ((toks[i] === 'proceed' || toks[i] === 'fly' || toks[i] === 'route') && toks[i + 1] === 'direct') j = i + 2;
    else if (toks[i] === 'direct') j = i + 1;
    else return null;
    if (toks[j] === 'to') j++;
    const letters = [];
    while (PHONETIC[toks[j + letters.length]] && letters.length < 5) letters.push(toks[j + letters.length]);
    let display;
    let spoken;
    if (letters.length >= 2) {
      display = letters.map((w) => PHONETIC[w]).join('');
      spoken = letters.join(' ');
      j += letters.length;
    } else {
      const w = toks[j];
      if (!w || STOP.has(w) || /^\d/.test(w)) return null;
      display = w.toUpperCase();
      spoken = w;
      j++;
    }
    return { part: P('direct', `Direct ${display}`, `direct ${spoken}`), next: j };
  }

  function ruleRunway(toks, i) {
    if (toks[i] !== 'runway') return null;
    const r = readRunway(toks, i + 1);
    if (!r) return null;
    let display = `Runway ${r.value}`;
    let spoken = `runway ${r.spoken}`;
    let next = r.next;
    if (toks[next] === 'in' && toks[next + 1] === 'use') next += 2;
    return { part: P('runway', display, spoken), next };
  }

  // L'ordine conta: a parità di posizione vince la prima regola.
  const RULES = [
    ruleClearance, ruleApproach, ruleArrival, ruleRunwayOps, rulePhrases,
    rulePushStart, ruleTaxi, ruleSpeed, ruleLevel, ruleHeading, ruleSquawk,
    ruleQnh, ruleContact, ruleDirect, ruleRunway,
  ];

  // ---------------------------------------------------------- nominativo

  function parseCallsign(raw, customTelephony) {
    const cs = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!cs) return null;
    const m = cs.match(/^([A-Z]{3})(\d[A-Z0-9]{0,4})$/);
    const custom = customTelephony && customTelephony.trim();
    if (m) {
      const tel = custom || AIRLINES[m[1]];
      if (tel) {
        return {
          type: 'airline', code: cs, telephony: tel, flightId: m[2],
          display: `${tel} ${m[2]}`, spoken: `${tel} ${spellAlnum(m[2])}`,
        };
      }
      return {
        type: 'unknown', code: cs, telephony: null, flightId: m[2],
        display: cs, spoken: spellAlnum(cs),
      };
    }
    const display = String(raw).trim().toUpperCase();
    return {
      type: 'reg', code: cs, display,
      spoken: cs.split('').map((c) => (LETTER_WORD[c] || DIGIT_WORD[Number(c)])).join(' '),
      abbrev: cs.length > 3 ? cs[0] + cs.slice(-2) : null,
    };
  }

  // Trasmissione indirizzata a noi? true / false / 'maybe' / null (nessun nominativo impostato)
  function detectForUs(toks, cs) {
    if (!cs) return null;
    // compatta: lettere fonetiche -> lettere, e unisce gruppi di lettere/cifre
    const compact = [];
    for (const t of toks) {
      const v = PHONETIC[t] ? PHONETIC[t].toLowerCase() : t;
      const prev = compact[compact.length - 1];
      const short = /^[a-z]$/.test(v) || /^\d+$/.test(v);
      if (short && prev && prev.short) prev.v += v;
      else compact.push({ v, short });
    }
    const words = compact.map((x) => x.v);
    const flat = words.join('');
    if (cs.type === 'reg') {
      const code = cs.code.toLowerCase();
      const ab = cs.abbrev && cs.abbrev.toLowerCase();
      if (words.some((w) => w === code || w.endsWith(code.slice(1)) || (ab && w === ab))) return true;
      return false;
    }
    const id = cs.flightId.toLowerCase();
    const idFound = words.includes(id);
    const telFound = cs.telephony ? flat.includes(cs.telephony.toLowerCase().replace(/[^a-z]/g, '')) : false;
    if (idFound && (telFound || id.length >= 3 || !cs.telephony)) return true;
    if (telFound) {
      const telWords = cs.telephony.toLowerCase().split(/\s+/);
      const at = words.indexOf(telWords[telWords.length - 1]);
      const after = at >= 0 ? words[at + 1] : null;
      if (after && /^\d/.test(after) && after !== id) return false;
      return 'maybe';
    }
    return false;
  }

  // ------------------------------------------------------------ principale

  function generateReadback(text, opts) {
    opts = opts || {};
    const cs = opts.callsign && typeof opts.callsign === 'object' ? opts.callsign : parseCallsign(opts.callsign, opts.telephony);
    const toks = tokenize(text);
    const ctx = { warnings: [] };
    const parts = [];
    let wantsReport = false;
    let i = 0;
    while (i < toks.length) {
      let hit = null;
      for (const rule of RULES) {
        hit = rule(toks, i, ctx);
        if (hit) break;
      }
      if (hit) {
        parts.push(hit.part);
        i = Math.max(hit.next, i + 1);
      } else {
        if (toks[i] === 'report' || toks[i] === 'advise') wantsReport = true;
        i++;
      }
    }

    const noReadbackNeeded = parts.length === 0;
    if (noReadbackNeeded) {
      parts.push(wantsReport ? P('ack', 'Wilco', 'wilco') : P('ack', 'Roger', 'roger'));
    } else if (wantsReport) {
      parts.push(P('ack', 'Wilco', 'wilco'));
    }

    const forUs = detectForUs(toks, cs);
    // Il nostro nominativo va in fondo solo se la chiamata è (forse) per noi.
    const csDisplay = cs && forUs !== false ? cs.display : '';
    const csSpoken = cs && forUs !== false ? cs.spoken : '';
    // Dopo la prima voce, minuscola iniziale ("Descend FL80, left heading 270"), tranne sigle e nomi stazione.
    parts.forEach((p, k) => {
      if (k > 0 && p.type !== 'frequency' && /^[A-Z][a-z]/.test(p.display)) p.display = p.display.charAt(0).toLowerCase() + p.display.slice(1);
    });
    const readback = parts.map((p) => p.display).join(', ') + (csDisplay ? `, ${csDisplay}` : '');
    const spoken = parts.map((p) => p.spoken).join(', ') + (csSpoken ? `, ${csSpoken}` : '');

    return {
      input: text,
      normalized: toks.join(' '),
      parts,
      readback,
      spoken,
      forUs,
      noReadbackNeeded,
      warnings: ctx.warnings,
      callsign: cs,
      source: 'regole',
    };
  }

  const api = { generateReadback, parseCallsign, detectForUs, tokenize, spellDigits, spokenAltitude, spokenFL, spokenRunway, PHONETIC, LETTER_WORD };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Readback = api;
})(this);
