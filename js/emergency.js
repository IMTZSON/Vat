/* Aiuto emergenze: compone il messaggio MAYDAY o PAN PAN nell'ordine ICAO (stazione, nominativo, natura
   dell'emergenza, intenzioni, posizione, livello, prua, autonomia, persone a bordo) con la pronuncia
   radio, più le risposte tipiche dell'ATC. Modulo puro: build() -> { parts, display, spoken, squawk, replies }. */
(function (root) {
  'use strict';

  const R = (typeof require === 'function' && typeof module !== 'undefined') ? require('./readback.js') : root.Readback;
  const say = (n) => R.spellDigits(String(n));

  // Natura dell'emergenza (in inglese radio) e tipo consigliato
  const NATURES = {
    engine: { text: 'engine failure', kind: 'mayday' },
    fire: { text: 'engine fire', kind: 'mayday' },
    smoke: { text: 'smoke in the cockpit', kind: 'mayday' },
    decompression: { text: 'rapid decompression', kind: 'mayday' },
    fuel: { text: 'fuel emergency', kind: 'mayday' },
    hydraulic: { text: 'hydraulic failure', kind: 'panpan' },
    bird: { text: 'bird strike', kind: 'panpan' },
    medical: { text: 'passenger medical emergency', kind: 'panpan' },
  };
  const INTENTS = ['nearest', 'divert', 'return', 'continue', 'descend', 'hold'];
  const COMPASS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];

  function level(alt, vs) {
    if (typeof alt !== 'number') return null;
    const high = alt >= 10000;
    const v = high ? Math.round(alt / 1000) * 10 : Math.round(alt / 100) * 100;
    const d = high ? `FL${v}` : `${v} feet`;
    const s = high ? R.spokenFL(v) : `${R.spokenAltitude(v)} feet`;
    const verb = vs <= -500 ? 'passing' : vs >= 500 ? 'passing' : '';
    const dir = vs <= -500 ? ' descending' : vs >= 500 ? ' climbing' : '';
    return { d: `${verb ? `${verb} ` : ''}${d}${dir}`, s: `${verb ? `${verb} ` : ''}${s}${dir}` };
  }

  /* o: { kind: 'mayday'|'panpan', station, cs: { display, spoken }, nature, intent, place: { name, dist, bearing },
         alt, vs, hdg, fuelMin, pob, depName, arrName, divertName, descendTo, onGround } */
  function build(o) {
    const kind = o.kind === 'panpan' ? 'panpan' : 'mayday';
    const nat = NATURES[o.nature] || NATURES.engine;
    const cs = o.cs || { display: 'Alitalia 123', spoken: 'Alitalia one two three' };
    const parts = [];
    const add = (key, d, s) => parts.push({ key, d, s: s || d });

    const opening = kind === 'mayday' ? 'MAYDAY MAYDAY MAYDAY' : 'PAN PAN, PAN PAN, PAN PAN';
    add('opening', o.nature === 'fuel' && kind === 'mayday' ? `${opening} FUEL` : opening, kind === 'mayday' ? `Mayday Mayday Mayday${o.nature === 'fuel' ? ' fuel' : ''}` : 'Pan pan, pan pan, pan pan');
    if (o.station) add('station', o.station);
    add('callsign', cs.display, cs.spoken);
    add('nature', kind === 'panpan' && o.nature === 'fuel' ? 'minimum fuel' : nat.text);

    const lv = o.descendTo ? (o.descendTo >= 10000 ? { d: `FL${Math.round(o.descendTo / 100)}`, s: R.spokenFL(Math.round(o.descendTo / 100)) } : { d: `${o.descendTo} feet`, s: `${R.spokenAltitude(o.descendTo)} feet` }) : null;
    const intents = {
      nearest: ['request vectors to the nearest suitable airport'],
      divert: o.divertName ? [`request diversion to ${o.divertName}`] : ['request vectors to the nearest suitable airport'],
      return: o.depName ? [`request return to ${o.depName}`] : ['request immediate return'],
      continue: o.arrName ? [`continuing to ${o.arrName}, request priority landing`] : ['request priority landing'],
      descend: lv ? [`emergency descent to ${lv.d}`, `emergency descent to ${lv.s}`] : ['emergency descent'],
      hold: ['request holding to troubleshoot'],
    };
    const it = intents[INTENTS.includes(o.intent) ? o.intent : 'nearest'];
    add('intent', it[0], it[1]);

    if (!o.onGround && o.place && o.place.name && typeof o.place.dist === 'number') {
      const n = Math.max(1, Math.round(o.place.dist));
      const dir = COMPASS[Math.round((((o.place.bearing % 360) + 360) % 360) / 45) % 8];
      add('position', `${n} miles ${dir} of ${o.place.name}`, `${say(n)} miles ${dir} of ${o.place.name}`);
    }
    const l = !o.onGround && level(o.alt, o.vs || 0);
    if (l && o.intent !== 'descend') add('level', l.d, l.s);
    if (!o.onGround && typeof o.hdg === 'number') {
      const h = String(Math.round(o.hdg) % 360 || 360).padStart(3, '0');
      add('heading', `heading ${h}`, `heading ${say(h)}`);
    }
    if (o.fuelMin > 0) {
      const hh = Math.floor(o.fuelMin / 60);
      const mm = Math.round(o.fuelMin % 60);
      const d = `${hh ? `${hh} hour${hh > 1 ? 's' : ''} ` : ''}${mm ? `${mm} minutes` : ''}`.trim();
      const s = `${hh ? `${say(hh)} hour${hh > 1 ? 's' : ''} ` : ''}${mm ? `${say(mm)} minutes` : ''}`.trim();
      add('fuel', `fuel endurance ${d}`, `fuel endurance ${s}`);
    }
    if (o.pob > 0) add('pob', `${o.pob} persons on board`, `${say(o.pob)} persons on board`);

    const squawk = kind === 'mayday' ? '7700' : null;
    const word = kind === 'mayday' ? 'MAYDAY' : 'PAN PAN';
    const replies = [
      { atc: `${cs.display}, roger ${word}${squawk ? ', squawk 7700' : ''}`, pilot: squawk ? `Squawk 7700, ${cs.display}` : `Roger, ${cs.display}` },
      { atc: `${cs.display}, say persons on board and fuel endurance`, pilot: `${o.pob > 0 ? `${o.pob} persons on board` : '[POB] persons on board'}, fuel endurance ${o.fuelMin > 0 ? parts.find((p) => p.key === 'fuel').d.replace('fuel endurance ', '') : '[time]'}, ${cs.display}` },
      { atc: `${cs.display}, turn left heading 090, descend to 5000 feet, QNH 1013, vectors for ILS approach`, pilot: `Left heading 090, descend to 5000 feet, QNH 1013, vectors ILS, ${cs.display}` },
      { atc: `${cs.display}, emergency services are standing by, cleared ILS approach, runway of your choice`, pilot: `Cleared ILS approach, ${cs.display}` },
    ];
    if (kind === 'mayday') replies.splice(1, 0, { atc: `All stations, stop transmitting, MAYDAY in progress`, pilot: null });

    return {
      kind, parts, squawk, replies,
      display: parts.map((p) => p.d).join(', '),
      spoken: parts.map((p) => p.s).join(', '),
      cancel: `${o.station ? `${o.station}, ` : ''}${cs.display}, cancel ${word}`,
    };
  }

  const api = { build, NATURES, INTENTS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Emergency = api;
})(this);
