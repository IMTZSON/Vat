/* Coach in volo: confronta il readback che il pilota ha detto davvero (microfono) con quello
   corretto e tiene le statistiche, per sapere cosa si dimentica più spesso. Funzioni pure. */
(function (root) {
  'use strict';

  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const Sc = isNode ? require('./scenarios.js') : root.Scenarios;

  // Vale la pena valutare questa chiamata? Solo se c'è qualcosa da ripetere (non "Roger", non "standby").
  function worthScoring(result) {
    if (!result || result.forUs === false || result.special || result.noReadbackNeeded) return false;
    return (result.parts || []).some((p) => p.type !== 'ack');
  }

  // expected: risultato di Readback.generateReadback; said: trascrizione del pilota
  function evaluate(expected, said) {
    const res = Sc.score(expected, said || '');
    const missed = res.items.filter((x) => !x.ok);
    return { score: res.score, perfect: res.perfect, items: res.items, missed, said: String(said || '').trim() };
  }

  function emptyStats() {
    return { total: 0, sum: 0, perfect: 0, streak: 0, bestStreak: 0, byType: {} };
  }

  function record(stats, ev) {
    const s = stats || emptyStats();
    s.total++;
    s.sum += ev.score;
    if (ev.perfect) { s.perfect++; s.streak++; s.bestStreak = Math.max(s.bestStreak, s.streak); } else s.streak = 0;
    // Per tipo di voce (level, squawk, …): l'etichetta si traduce solo quando si mostra
    for (const it of ev.items) {
      const b = s.byType[it.type] || { n: 0, ok: 0 };
      b.n++;
      if (it.ok) b.ok++;
      s.byType[it.type] = b;
    }
    return s;
  }

  // Elementi dimenticati più spesso (almeno 2 occorrenze), dal peggiore
  function weakest(stats, n) {
    return Object.entries((stats && stats.byType) || {})
      .filter(([, b]) => b.n >= 2 && b.ok < b.n)
      .map(([type, b]) => ({ type, label: Sc.partLabel(type), n: b.n, ok: b.ok, rate: b.ok / b.n }))
      .sort((a, b) => a.rate - b.rate || b.n - a.n)
      .slice(0, n || 3);
  }

  const api = { worthScoring, evaluate, emptyStats, record, weakest };
  if (isNode && module.exports) module.exports = api;
  else root.Coach = api;
})(this);
