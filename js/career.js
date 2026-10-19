/* Carriera e obiettivi: punti esperienza (XP), gradi da pilota, badge, sfide del giorno e progressi nel
   tempo, calcolati da quello che fai (voli, atterraggi, readback, coach, allenamento, prova generale).
   Modulo puro. Stato: { events: [{ id, t, type, v }], badges: { id: t }, archive: { xp, totals } }.
   Gli id degli eventi sono unici: così lo stato del telefono e del PC si possono unire. */
(function (root) {
  'use strict';

  const DAY = 86400000;
  const MAX_EVENTS = 4000;
  const ARCHIVE_AFTER = 180 * DAY;

  const RANKS = [
    { id: 'student', xp: 0 }, { id: 'ppl', xp: 300 }, { id: 'jfo', xp: 1000 }, { id: 'fo', xp: 2500 },
    { id: 'sfo', xp: 5000 }, { id: 'capt', xp: 9000 }, { id: 'scapt', xp: 15000 }, { id: 'tri', xp: 25000 },
  ];

  const emptyTotals = () => ({
    flights: 0, minutes: 0, longhaul: 0, landings: 0, fpmSum: 0, butters: 0, smooth: 0, calls: 0, verified: 0,
    coach: 0, coachPerfect: 0, train: 0, trainPerfect: 0, rehearsals: 0, rehearsalPerfect: 0, emergencies: 0, challenges: 0, airports: [],
  });
  const empty = () => ({ events: [], badges: {}, archive: { xp: 0, totals: emptyTotals() } });

  // XP di un evento
  function xpOf(e) {
    const v = e.v || {};
    switch (e.type) {
      case 'flight': return 50 + Math.min(600, Math.max(0, v.min || 0));
      case 'landing': return Math.round((v.score || 0) / 2) + (v.fpm < 60 ? 25 : 0);
      case 'radio': return v.verified ? 2 : 1;
      case 'coach': return v.score === 100 ? 10 : Math.round((v.score || 0) / 20);
      case 'train': return v.score === 100 ? 8 : Math.round((v.score || 0) / 20);
      case 'rehearsal': return 100 + Math.round(v.avg || 0);
      case 'emergency': return 15;
      case 'challenge': return 50;
      default: return 0;
    }
  }

  // Somma un evento nei totali
  function tally(T, e) {
    const v = e.v || {};
    if (e.type === 'flight') {
      T.flights++;
      T.minutes += Math.max(0, v.min || 0);
      if (v.min >= 300) T.longhaul++;
      for (const ap of [v.dep, v.arr]) if (ap && !T.airports.includes(ap)) T.airports.push(ap);
    } else if (e.type === 'landing') {
      T.landings++;
      T.fpmSum += Math.abs(v.fpm || 0);
      if (v.fpm < 60) T.butters++;
      if (v.fpm < 180) T.smooth++;
    } else if (e.type === 'radio') {
      T.calls++;
      if (v.verified) T.verified++;
    } else if (e.type === 'coach') {
      T.coach++;
      if (v.score === 100) T.coachPerfect++;
    } else if (e.type === 'train') {
      T.train++;
      if (v.score === 100) T.trainPerfect++;
    } else if (e.type === 'rehearsal') {
      T.rehearsals++;
      if (v.avg === 100) T.rehearsalPerfect++;
    } else if (e.type === 'emergency') T.emergencies++;
    else if (e.type === 'challenge') T.challenges++;
    return T;
  }

  const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

  // Giorni di fila con almeno un'attività (fino a oggi o ieri) e record
  function streaks(events, now) {
    const days = new Set(events.map((e) => dayKey(e.t)));
    let cur = 0;
    let d = now;
    if (!days.has(dayKey(d))) d -= DAY;
    while (days.has(dayKey(d))) { cur++; d -= DAY; }
    const sorted = [...days].sort();
    let best = 0;
    let run = 0;
    let prev = null;
    for (const k of sorted) {
      run = prev && Date.parse(k) - Date.parse(prev) === DAY ? run + 1 : 1;
      best = Math.max(best, run);
      prev = k;
    }
    return { streak: cur, bestStreak: Math.max(best, cur) };
  }

  const BADGES = [
    { id: 'firstFlight', test: (T) => T.flights >= 1 },
    { id: 'flights10', test: (T) => T.flights >= 10 },
    { id: 'flights50', test: (T) => T.flights >= 50 },
    { id: 'flights100', test: (T) => T.flights >= 100 },
    { id: 'hours10', test: (T) => T.minutes >= 600 },
    { id: 'hours100', test: (T) => T.minutes >= 6000 },
    { id: 'longhaul', test: (T) => T.longhaul >= 1 },
    { id: 'butter', test: (T) => T.butters >= 1 },
    { id: 'butter5', test: (T) => T.butters >= 5 },
    { id: 'smooth10', test: (T) => T.smooth >= 10 },
    { id: 'verified100', test: (T) => T.verified >= 100 },
    { id: 'verified1000', test: (T) => T.verified >= 1000 },
    { id: 'coach10', test: (T) => T.coachPerfect >= 10 },
    { id: 'train100', test: (T) => T.train >= 100 },
    { id: 'trainPerfect50', test: (T) => T.trainPerfect >= 50 },
    { id: 'rehearsal', test: (T) => T.rehearsals >= 1 },
    { id: 'rehearsalPerfect', test: (T) => T.rehearsalPerfect >= 1 },
    { id: 'airports10', test: (T) => T.airports.length >= 10 },
    { id: 'airports25', test: (T) => T.airports.length >= 25 },
    { id: 'streak7', test: (T) => T.bestStreak >= 7 },
    { id: 'streak30', test: (T) => T.bestStreak >= 30 },
    { id: 'emergency', test: (T) => T.emergencies >= 1 },
    { id: 'challenges10', test: (T) => T.challenges >= 10 },
  ];

  // Sfide del giorno: una per gruppo, scelte dalla data (uguali su PC e telefono)
  const CHALLENGES = {
    train5: { goal: 5, count: (ev) => ev.filter((e) => e.type === 'train' && e.v.score >= 80).length },
    perfect3: { goal: 3, count: (ev) => ev.filter((e) => (e.type === 'train' || e.type === 'coach') && e.v.score === 100).length },
    rehearsal: { goal: 1, count: (ev) => ev.filter((e) => e.type === 'rehearsal').length },
    flight: { goal: 1, count: (ev) => ev.filter((e) => e.type === 'flight').length },
    fly60: { goal: 60, count: (ev) => ev.filter((e) => e.type === 'flight').reduce((n, e) => n + (e.v.min || 0), 0) },
    verified10: { goal: 10, count: (ev) => ev.filter((e) => e.type === 'radio' && e.v.verified).length },
    coach3: { goal: 3, count: (ev) => ev.filter((e) => e.type === 'coach' && e.v.score >= 80).length },
    land150: { goal: 1, count: (ev) => ev.filter((e) => e.type === 'landing' && e.v.fpm < 150).length },
    butter: { goal: 1, count: (ev) => ev.filter((e) => e.type === 'landing' && e.v.fpm < 60).length },
    emergency: { goal: 1, count: (ev) => ev.filter((e) => e.type === 'emergency').length },
  };
  const GROUPS = [['train5', 'perfect3', 'rehearsal'], ['flight', 'fly60', 'verified10', 'coach3'], ['land150', 'butter', 'emergency', 'train5']];

  function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }

  function dailyIds(date) {
    const out = [];
    GROUPS.forEach((g, i) => {
      const opts = g.filter((x) => !out.includes(x));
      out.push(opts[hash(`${date}#${i}`) % opts.length]);
    });
    return out;
  }

  // Sfide di una giornata con avanzamento: [{ id, goal, value, done }]
  function daily(state, now) {
    const date = dayKey(now);
    const ev = state.events.filter((e) => dayKey(e.t) === date);
    return dailyIds(date).map((id) => {
      const c = CHALLENGES[id];
      const value = Math.min(c.goal, c.count(ev));
      return { id, goal: c.goal, value, done: value >= c.goal };
    });
  }

  function rankOf(xp) {
    let i = 0;
    while (i + 1 < RANKS.length && xp >= RANKS[i + 1].xp) i++;
    const r = RANKS[i];
    const next = RANKS[i + 1] || null;
    return { rank: r.id, level: i + 1, next: next ? next.id : null, nextXp: next ? next.xp : null, progress: next ? (xp - r.xp) / (next.xp - r.xp) : 1 };
  }

  // Settimane (lunedì) dalla più vecchia alla corrente: XP, minuti di volo, % readback verificati, ft/min medi, media allenamento
  function weeks(events, now, n) {
    const monday = (t) => { const d = new Date(t); d.setUTCHours(0, 0, 0, 0); return d.getTime() - (((d.getUTCDay() + 6) % 7) * DAY); };
    const start = monday(now) - (n - 1) * 7 * DAY;
    const out = Array.from({ length: n }, (_, i) => ({ from: start + i * 7 * DAY, xp: 0, minutes: 0, calls: 0, verified: 0, fpm: [], train: [] }));
    for (const e of events) {
      const i = Math.floor((e.t - start) / (7 * DAY));
      if (i < 0 || i >= n) continue;
      const w = out[i];
      w.xp += xpOf(e);
      if (e.type === 'flight') w.minutes += e.v.min || 0;
      if (e.type === 'radio') { w.calls++; if (e.v.verified) w.verified++; }
      if (e.type === 'landing') w.fpm.push(Math.abs(e.v.fpm || 0));
      if (e.type === 'train' || e.type === 'coach') w.train.push(e.v.score || 0);
    }
    const avg = (a) => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : null);
    return out.map((w) => ({ from: w.from, xp: w.xp, minutes: w.minutes, radio: w.calls ? Math.round((w.verified / w.calls) * 100) : null, fpm: avg(w.fpm), train: avg(w.train) }));
  }

  function summary(state, now) {
    const s = state || empty();
    const T = s.events.reduce(tally, JSON.parse(JSON.stringify(s.archive.totals)));
    Object.assign(T, streaks(s.events, now));
    T.avgFpm = T.landings ? Math.round(T.fpmSum / T.landings) : null;
    const xp = s.archive.xp + s.events.reduce((n, e) => n + xpOf(e), 0);
    return { xp, ...rankOf(xp), totals: T, badges: s.badges, daily: daily(s, now), weeks: weeks(s.events, now, 8) };
  }

  // Eventi vecchi riassunti nell'archivio (XP e totali restano)
  function compact(s, now) {
    const sorted = [...s.events].sort((a, b) => a.t - b.t);
    const cut = Math.max(sorted.filter((e) => now - e.t > ARCHIVE_AFTER).length, sorted.length - MAX_EVENTS);
    if (cut <= 0) return s;
    const gone = sorted.slice(0, cut);
    const totals = gone.reduce(tally, JSON.parse(JSON.stringify(s.archive.totals)));
    return { ...s, events: sorted.slice(cut), archive: { xp: s.archive.xp + gone.reduce((n, e) => n + xpOf(e), 0), totals } };
  }

  /* Aggiunge un evento { type, v, id?, t? } -> { state, xp, rankUp, badges: [nuovi], challenges: [completate] } */
  function add(state, ev, now) {
    const t = ev.t || now;
    let s = { ...empty(), ...(state || {}) };
    const id = ev.id || `${ev.type}-${t}-${Math.random().toString(36).slice(2, 7)}`;
    if (s.events.some((e) => e.id === id)) return { state: s, xp: 0, rankUp: null, badges: [], challenges: [] };
    const before = summary(s, now);
    s = { ...s, events: [...s.events, { id, t, type: ev.type, v: ev.v || {} }] };
    // sfide completate con questo evento -> evento "challenge" (una volta sola al giorno)
    const date = dayKey(now);
    const done = daily(s, now).filter((c) => c.done && !s.events.some((e) => e.id === `ch-${date}-${c.id}`));
    for (const c of done) s.events.push({ id: `ch-${date}-${c.id}`, t: now, type: 'challenge', v: { c: c.id } });
    const after = summary(s, now);
    const fresh = BADGES.filter((b) => !s.badges[b.id] && b.test(after.totals)).map((b) => b.id);
    if (fresh.length) s = { ...s, badges: { ...s.badges, ...Object.fromEntries(fresh.map((b) => [b, now])) } };
    s = compact(s, now);
    return { state: s, xp: after.xp - before.xp, rankUp: after.rank !== before.rank ? after.rank : null, badges: fresh, challenges: done.map((c) => c.id) };
  }

  // Unione di due stati (telefono + PC): eventi per id, badge con la data più vecchia, archivio più grande
  function merge(a, b) {
    const A = { ...empty(), ...(a || {}) };
    const B = { ...empty(), ...(b || {}) };
    const seen = new Map();
    for (const e of [...A.events, ...B.events]) if (!seen.has(e.id)) seen.set(e.id, e);
    const badges = { ...B.badges };
    for (const [k, t] of Object.entries(A.badges)) badges[k] = badges[k] ? Math.min(badges[k], t) : t;
    return { events: [...seen.values()].sort((x, y) => x.t - y.t), badges, archive: A.archive.xp >= B.archive.xp ? A.archive : B.archive };
  }

  const api = { empty, add, merge, summary, daily, dailyIds, rankOf, xpOf, RANKS, BADGES, CHALLENGES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Career = api;
})(this);
