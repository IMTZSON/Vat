/* Pagina Altro › Carriera: grado con avanzamento, sfide del giorno, numeri, badge e progressi
   settimanali. Raccoglie gli eventi dell'app (voli, atterraggi, radio, coach, allenamento, emergenze). */
(function (root) {
  'use strict';

  const BADGE_ICON = {
    firstFlight: 'plane-takeoff', flights10: 'plane', flights50: 'plane', flights100: 'trophy', hours10: 'clock', hours100: 'trophy',
    longhaul: 'globe', butter: 'plane-landing', butter5: 'star', smooth10: 'plane-landing', verified100: 'radio', verified1000: 'radio-tower',
    coach10: 'mic', train100: 'graduation-cap', trainPerfect50: 'star', rehearsal: 'route', rehearsalPerfect: 'award', airports10: 'map-pin',
    airports25: 'map', streak7: 'flame', streak30: 'flame', emergency: 'siren', challenges10: 'target',
  };

  root.App.register((App) => {
    const $ = App.$;
    const t = App.t;
    const C = root.Career;
    const KEY = 'readback-copilot-career';
    if (!C || !$('careerView')) return;
    let state = { ...C.empty(), ...App.storage.get(KEY, {}) };
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const ico = (n) => root.Icons.svg(n);

    // Nuovo evento: XP, salita di grado, badge e sfide completate (con un avviso)
    function record(ev) {
      const r = C.add(state, ev, Date.now());
      if (r.state === state) return;
      state = r.state;
      App.storage.set(KEY, state);
      const notes = [];
      if (r.rankUp) notes.push(t('career.rankUp', { rank: t(`career.rank.${r.rankUp}`) }));
      for (const b of r.badges) notes.push(t('career.badgeNew', { badge: t(`career.b.${b}`) }));
      for (const c of r.challenges) notes.push(t('career.challengeDone', { c: t(`career.c.${c}`, { n: C.CHALLENGES[c].goal }) }));
      if (notes.length) App.toast(`🏆 ${notes.join(' · ')}`, 6000);
      App.emit('career', C.summary(state, Date.now()));
      if (isOpen()) render();
    }
    const day = () => new Date().toISOString().slice(0, 10);

    App.on('flight-finished', (e) => record({ type: 'flight', id: `fl-${e.id}`, v: { min: e.blockMin || e.airMin || 0, dep: e.dep, arr: e.arr } }));
    App.on('landing', (e) => record({ type: 'landing', id: `ld-${e.t || Date.now()}`, v: { fpm: Math.abs(e.fpm), score: e.score } }));
    App.on('readback', (item) => {
      if (!item || !item.result || item.result.forUs !== true || item.origin === 'prova' || !item.ts) return;
      record({ type: 'radio', id: `rb-${item.ts}`, v: { verified: !!(item.verify && item.verify.status === 'ok') } });
    });
    App.on('coach-score', (ev) => record({ type: 'coach', v: { score: ev.score } }));
    App.on('train-answer', (ev) => record({ type: 'train', v: { score: ev.score, phase: ev.phase } }));
    App.on('rehearsal-done', (ev) => record({ type: 'rehearsal', v: { avg: ev.avg, n: ev.n } }));
    App.on('emergency-open', () => record({ type: 'emergency', id: `em-${day()}`, v: {} }));

    // Per il collegamento col telefono e il resoconto
    App.career = {
      state: () => state,
      summary: () => C.summary(state, Date.now()),
      merge(other) { state = C.merge(state, other); App.storage.set(KEY, state); if (isOpen()) render(); },
    };

    const isOpen = () => !$('careerView').hidden;

    // Barre settimanali in SVG (valori null = nessun dato)
    function bars(values, opts) {
      const w = 260;
      const h = 70;
      const max = Math.max(1, ...values.filter((v) => v !== null));
      const bw = w / values.length;
      const rects = values.map((v, i) => {
        if (v === null) return `<rect x="${i * bw + 4}" y="${h - 3}" width="${bw - 8}" height="3" rx="1.5" class="bar-empty"/>`;
        const bh = Math.max(3, Math.round((v / max) * (h - 16)));
        return `<rect x="${i * bw + 4}" y="${h - bh}" width="${bw - 8}" height="${bh}" rx="4" class="${i === values.length - 1 ? 'bar-now' : 'bar'}"><title>${esc(opts.fmt(v))}</title></rect>`;
      }).join('');
      const last = [...values].reverse().find((v) => v !== null);
      return `<div class="week-chart"><div class="week-head"><span>${esc(opts.label)}</span><b>${last === undefined ? '—' : esc(opts.fmt(last))}</b></div><svg viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="${esc(opts.label)}">${rects}</svg></div>`;
    }

    function render() {
      const s = C.summary(state, Date.now());
      const T = s.totals;
      const rank = t(`career.rank.${s.rank}`);
      const hours = (m) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}`;
      $('careerHero').innerHTML = `
        <div class="rank-badge lvl${s.level}">${ico('award')}<span>${s.level}</span></div>
        <div class="rank-text">
          <span class="eyebrow">${esc(t('career.level', { n: s.level, total: C.RANKS.length }))}</span>
          <b>${esc(rank)}</b>
          <div class="rank-bar"><div style="width:${Math.round(s.progress * 100)}%"></div></div>
          <span class="hint">${s.next ? esc(t('career.toNext', { xp: s.nextXp - s.xp, rank: t(`career.rank.${s.next}`) })) : esc(t('career.maxRank'))} · ${s.xp} XP</span>
        </div>`;
      $('careerDaily').innerHTML = s.daily.map((c) => `
        <li class="${c.done ? 'done' : ''}">
          <span class="ch-icon">${ico(c.done ? 'circle-check' : 'target')}</span>
          <span class="ch-text">${esc(t(`career.c.${c.id}`, { n: c.goal }))}<span class="ch-bar"><span style="width:${Math.round((c.value / c.goal) * 100)}%"></span></span></span>
          <b>${c.value}/${c.goal}</b>
        </li>`).join('');
      const pct = T.calls ? `${Math.round((T.verified / T.calls) * 100)}%` : '—';
      $('careerKpis').innerHTML = [
        [T.flights, t('career.k.flights')], [hours(T.minutes), t('career.k.hours')], [T.avgFpm !== null ? `${T.avgFpm}` : '—', t('career.k.fpm')],
        [pct, t('career.k.radio')], [`${T.streak} 🔥`, t('career.k.streak')], [`${Object.keys(s.badges).length}/${C.BADGES.length}`, t('career.k.badges')],
      ].map(([v, l]) => `<div><b>${esc(v)}</b><span>${esc(l)}</span></div>`).join('');
      $('careerBadges').innerHTML = C.BADGES.map((b) => {
        const got = s.badges[b.id];
        return `<li class="${got ? 'got' : 'locked'}" title="${esc(t(`career.bd.${b.id}`))}">
          <span class="b-icon">${ico(got ? BADGE_ICON[b.id] || 'award' : 'lock')}</span>
          <b>${esc(t(`career.b.${b.id}`))}</b><span>${esc(got ? root.I18n.date(got) : t(`career.bd.${b.id}`))}</span></li>`;
      }).join('');
      const W = s.weeks;
      $('careerWeeks').innerHTML = [
        bars(W.map((w) => w.xp || null), { label: t('career.w.xp'), fmt: (v) => `${v} XP` }),
        bars(W.map((w) => w.minutes || null), { label: t('career.w.hours'), fmt: hours }),
        bars(W.map((w) => w.radio), { label: t('career.w.radio'), fmt: (v) => `${v}%` }),
        bars(W.map((w) => w.train), { label: t('career.w.train'), fmt: (v) => `${v}%` }),
      ].join('');
    }

    App.on('tab', (id) => { if (id === 'career') render(); });
    if (isOpen()) render();
  });
})(this);
