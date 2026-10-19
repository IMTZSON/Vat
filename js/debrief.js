/* Resoconto del volo: un'immagine 1080×1350 da salvare o condividere (Discord, Instagram) con rotta,
   tempi, atterraggio, radio e incasso di bordo. Si apre a fine volo e dal logbook. */
(function (root) {
  'use strict';

  const W = 1080;
  const H = 1350;
  const C = { bg1: '#0b1220', bg2: '#14305c', accent: '#60a5fa', text: '#f8fafc', dim: '#94a3b8', card: 'rgba(255,255,255,0.07)', ok: '#4ade80', warn: '#fbbf24', bad: '#f87171' };

  function hhmm(min) { return min === null || min === undefined ? '—' : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')}`; }

  // Rotta come punti [lat, lon]: la scia volata se c'è, altrimenti l'arco tra i due aeroporti
  function routeOf(entry, trail) {
    if (trail && trail.length > 1) return trail;
    const a = root.World.airport(entry.dep);
    const b = root.World.airport(entry.arr);
    if (a && b && typeof a.lat === 'number' && typeof b.lat === 'number') return root.Geo.greatCircle(a, b, 48);
    return [];
  }

  function distanceNm(pts) {
    let d = 0;
    for (let i = 1; i < pts.length; i++) d += root.Geo.distance({ lat: pts[i - 1][0], lon: pts[i - 1][1] }, { lat: pts[i][0], lon: pts[i][1] });
    return Math.round(d);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  /* entry: voce del logbook; trail: [[lat, lon]] (facoltativo); t: traduzioni -> canvas */
  function render(entry, trail, t) {
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const ctx = cv.getContext('2d');
    const font = (w, s) => `${w} ${s}px Inter, "Segoe UI", system-ui, sans-serif`;
    const g = ctx.createLinearGradient(0, 0, W * 0.4, H);
    g.addColorStop(0, C.bg1);
    g.addColorStop(1, C.bg2);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    // intestazione
    ctx.fillStyle = C.accent;
    ctx.font = font(800, 30);
    ctx.fillText('READBACK COPILOT', 72, 104);
    ctx.fillStyle = C.dim;
    ctx.font = font(600, 30);
    ctx.textAlign = 'right';
    ctx.fillText(root.I18n.date(entry.date || Date.now()), W - 72, 104);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.text;
    ctx.font = font(700, 40);
    ctx.fillText(`${entry.callsign || ''}${entry.aircraft ? `  ·  ${entry.aircraft}` : ''}`, 72, 170);
    ctx.font = font(850, 150);
    ctx.fillText(entry.dep || '—', 64, 330);
    ctx.textAlign = 'right';
    ctx.fillText(entry.arr || '—', W - 64, 330);
    ctx.textAlign = 'left';
    const city = (icao) => ((root.World.airport(icao) || {}).city || '');
    ctx.fillStyle = C.dim;
    ctx.font = font(600, 34);
    ctx.fillText(city(entry.dep), 72, 382);
    ctx.textAlign = 'right';
    ctx.fillText(city(entry.arr), W - 72, 382);
    ctx.textAlign = 'left';

    // mappa della rotta
    const pts = routeOf(entry, trail);
    const box = { x: 72, y: 420, w: W - 144, h: 330 };
    roundRect(ctx, box.x, box.y, box.w, box.h, 36);
    ctx.fillStyle = C.card;
    ctx.fill();
    if (pts.length > 1) {
      const lats = pts.map((p) => p[0]);
      const lons = pts.map((p) => p[1]);
      const k = Math.cos((((Math.min(...lats) + Math.max(...lats)) / 2) * Math.PI) / 180);
      const minX = Math.min(...lons) * k; const maxX = Math.max(...lons) * k;
      const minY = Math.min(...lats); const maxY = Math.max(...lats);
      const s = Math.min((box.w - 120) / Math.max(1e-6, maxX - minX), (box.h - 120) / Math.max(1e-6, maxY - minY));
      const ox = box.x + box.w / 2 - ((minX + maxX) / 2) * s;
      const oy = box.y + box.h / 2 + ((minY + maxY) / 2) * s;
      const xy = (p) => [ox + p[1] * k * s, oy - p[0] * s];
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.strokeStyle = 'rgba(96,165,250,0.25)';
      ctx.lineWidth = 22;
      ctx.beginPath();
      pts.forEach((p, i) => { const [x, y] = xy(p); if (i) ctx.lineTo(x, y); else ctx.moveTo(x, y); });
      ctx.stroke();
      ctx.strokeStyle = C.accent;
      ctx.lineWidth = 7;
      ctx.stroke();
      for (const [p, fill] of [[pts[0], C.accent], [pts[pts.length - 1], C.text]]) {
        const [x, y] = xy(p);
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.lineWidth = 6;
        ctx.strokeStyle = C.bg1;
        ctx.stroke();
      }
    }

    // riquadri dei dati
    const tiles = [];
    const dist = distanceNm(pts);
    tiles.push([t('debrief.block'), hhmm(entry.blockMin || entry.airMin), entry.airMin ? `${t('debrief.air')} ${hhmm(entry.airMin)}` : '']);
    tiles.push([t('debrief.distance'), dist ? `${dist} NM` : '—', '']);
    if (entry.touchdown) {
      const td = entry.touchdown;
      tiles.push([t('debrief.landing'), `${td.fpm} ft/min`, `${t(`landing.${td.id}`)} · ${td.g.toFixed(2)} G${td.bounces ? ` · ${t('debrief.bounces', { n: td.bounces })}` : ''}`, td.score >= 75 ? C.ok : td.score >= 45 ? C.warn : C.bad]);
    } else tiles.push([t('debrief.landing'), '—', t('debrief.noLanding')]);
    const r = entry.radio;
    if (r && r.calls) tiles.push([t('debrief.radio'), `${Math.round((r.verified / r.calls) * 100)}%`, `${t('debrief.calls', { n: r.calls })}${r.coach !== null ? ` · coach ${r.coach}%` : ''}`]);
    else tiles.push([t('debrief.radio'), '—', '']);
    tiles.push([t('debrief.revenue'), entry.revenue ? root.I18n.money(entry.revenue) : '—', entry.sold ? t('debrief.sold', { n: entry.sold }) : '']);
    tiles.push([t('debrief.times'), entry.offBlock ? `${root.I18n.time(entry.offBlock)} → ${entry.onBlock ? root.I18n.time(entry.onBlock) : '—'}` : '—', 'Off-block → On-block']);

    const tw = (W - 144 - 30) / 2;
    tiles.slice(0, 6).forEach(([label, value, sub, color], i) => {
      const x = 72 + (i % 2) * (tw + 30);
      const y = 780 + Math.floor(i / 2) * 166;
      roundRect(ctx, x, y, tw, 148, 28);
      ctx.fillStyle = C.card;
      ctx.fill();
      ctx.fillStyle = C.dim;
      ctx.font = font(700, 24);
      ctx.fillText(label.toUpperCase(), x + 30, y + 42);
      ctx.fillStyle = color || C.text;
      ctx.font = font(800, 46);
      ctx.fillText(value, x + 30, y + 94, tw - 60);
      if (sub) {
        ctx.fillStyle = C.dim;
        ctx.font = font(600, 23);
        ctx.fillText(sub, x + 30, y + 128, tw - 60);
      }
    });

    ctx.fillStyle = C.dim;
    ctx.font = font(600, 24);
    ctx.textAlign = 'center';
    ctx.fillText(`${t('debrief.footer')}${entry.rank ? `  ·  ${entry.rank}` : ''}`, W / 2, H - 40);
    return cv;
  }

  root.Debrief = { render, routeOf, distanceNm };

  root.App.register((App) => {
    const $ = App.$;
    const t = App.t;
    const dlg = $('debriefSheet');
    if (!dlg) return;
    let canvas = null;
    let entry = null;

    App.openDebrief = (e) => {
      entry = e;
      const trail = App.flight && App.flight.dep === e.dep && App.flight.arr === e.arr ? App.storage.get('readback-copilot-trail', []) : null;
      const rank = App.career ? t(`career.rank.${App.career.summary().rank}`) : '';
      canvas = render({ ...e, rank }, trail, t);
      $('debriefImg').src = canvas.toDataURL('image/png');
      if (!dlg.open) dlg.showModal();
    };
    $('debriefSave').addEventListener('click', async () => {
      if (!canvas) return;
      const ok = await App.desktop.saveImage(`volo-${entry.dep}-${entry.arr}-${entry.date || ''}.png`, canvas.toDataURL('image/png'));
      if (ok) App.toast(t('debrief.saved'));
    });
    $('debriefCopy').addEventListener('click', async () => {
      if (!canvas) return;
      try {
        const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
        await navigator.clipboard.write([new root.ClipboardItem({ 'image/png': blob })]);
        App.toast(t('debrief.copied'));
      } catch (e) { App.toast(t('debrief.copyFail')); }
    });
    $('debriefClose').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (ev) => { if (ev.target === dlg) dlg.close(); });
    // fine volo (on-block): il resoconto si apre da solo
    App.on('flight-finished', (e) => setTimeout(() => App.openDebrief(e), 1500));
  });
})(this);
