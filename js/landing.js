/* Atterraggio: rileva il contatto con la pista dai dati del simulatore (in volo -> a terra), conta i
   rimbalzi e dà un voto. Modulo puro, usato dal programma (electron/main.js) e dall'interfaccia. */
(function (root) {
  'use strict';

  // Fasce di razzo di discesa al contatto (ft/min, valore assoluto)
  const GRADES = [
    { max: 60, id: 'butter', score: 100 },
    { max: 180, id: 'smooth', score: 90 },
    { max: 300, id: 'firm', score: 75 },
    { max: 600, id: 'hard', score: 45 },
    { max: Infinity, id: 'veryHard', score: 15 },
  ];

  /* ev: { fpm, g, bounces } -> { id, score }  (G alto e rimbalzi peggiorano il voto) */
  function grade(ev) {
    const fpm = Math.abs(Number(ev.fpm) || 0);
    let i = GRADES.findIndex((x) => fpm < x.max);
    if (ev.g >= 1.8) i = Math.max(i, 3);
    else if (ev.g >= 1.5) i = Math.max(i, 2);
    if (ev.bounces >= 2) i = Math.min(GRADES.length - 1, Math.max(i, 2) + 1);
    else if (ev.bounces === 1) i = Math.max(i, 2);
    const g = GRADES[i];
    let score = g.score - Math.max(0, Math.round(((ev.g || 1) - 1.3) * 20));
    score = Math.max(0, Math.min(100, score - (ev.bounces || 0) * 5));
    return { id: g.id, score };
  }

  /* Rilevatore: feed({ t (ms), onGround, vs (ft/min), g, tdv? (ft/s, velocità al contatto di MSFS) })
     onTouchdown(ev) quando l'aereo è a terra da 3 s: { fpm, g, bounces, t } */
  function createDetector(onTouchdown) {
    let wasGround = null;
    let lastAirVs = null;
    let lastAirT = 0;
    let first = null; // primo contatto
    let peakG = 1;
    let airborneSince = null;
    return {
      feed(s) {
        if (!s || typeof s.onGround !== 'boolean') return;
        if (!s.onGround) {
          if (wasGround === true && first && s.t - first.t < 10000) first.bounces++;
          if (airborneSince === null) airborneSince = s.t;
          if (typeof s.vs === 'number') { lastAirVs = s.vs; lastAirT = s.t; }
        } else if (wasGround === false) {
          // contatto: conta solo dopo un volo vero (in aria da almeno 20 s, oppure un rimbalzo)
          if (!first && airborneSince !== null && s.t - airborneSince > 20000) {
            const tdv = typeof s.tdv === 'number' && s.tdv !== 0 ? Math.abs(s.tdv) * 60 : null;
            const vs = tdv !== null ? tdv : (lastAirVs !== null && s.t - lastAirT < 2000 ? Math.abs(lastAirVs) : Math.abs(s.vs || 0));
            first = { t: s.t, fpm: Math.round(vs), bounces: 0, done: false };
            peakG = 1;
          }
          airborneSince = null;
        }
        if (first && !first.done) {
          if (typeof s.g === 'number' && s.t - first.t < 3000) peakG = Math.max(peakG, s.g);
          if (s.onGround && s.t - first.t >= 3000) {
            first.done = true;
            const ev = { fpm: first.fpm, g: Math.round(peakG * 100) / 100, bounces: first.bounces, t: first.t };
            if (onTouchdown) onTouchdown({ ...ev, ...grade(ev) });
          }
        }
        // nuovo volo: si riarma
        if (first && first.done && !s.onGround && airborneSince !== null && s.t - airborneSince > 20000) first = null;
        wasGround = s.onGround;
      },
    };
  }

  const api = { GRADES, grade, createDetector };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Landing = api;
})(this);
