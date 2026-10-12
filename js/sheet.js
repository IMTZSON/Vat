/* Pannello: laterale sugli schermi larghi (si può nascondere per vedere solo la mappa),
   bottom sheet trascinabile con 3 posizioni sugli schermi stretti. Indicatore animato della tab bar. */
(function (root) {
  'use strict';

  root.App.register((App) => {
    const $ = App.$;
    const panel = $('panel');
    const narrow = () => root.matchMedia('(max-width: 899px)').matches;
    const DETENTS = ['peek', 'half', 'full'];

    // ------------------------------------------------------------ indicatore della tab bar
    function moveIndicator() {
      const active = document.querySelector('.tab.active');
      const ind = $('tabIndicator');
      if (!active || !ind) return;
      ind.style.left = `${active.offsetLeft}px`;
      ind.style.width = `${active.offsetWidth}px`;
    }
    App.on('tab', () => requestAnimationFrame(moveIndicator));
    root.addEventListener('resize', () => { moveIndicator(); App.emit('layout'); });

    // ------------------------------------------------------------ desktop: nascondi / mostra pannello
    function setHidden(on) {
      document.body.classList.toggle('panel-hidden', on);
      $('panelOpen').hidden = !on;
      App.set('panelHidden', on);
      setTimeout(() => App.emit('layout'), 460);
    }
    $('panelHide').addEventListener('click', () => setHidden(true));
    $('panelOpen').addEventListener('click', () => setHidden(false));
    if (App.settings.panelHidden && !narrow()) setHidden(true);

    // ------------------------------------------------------------ mobile: bottom sheet
    function setDetent(d) {
      panel.dataset.detent = d;
      panel.style.transform = '';
      setTimeout(() => App.emit('layout'), 400);
    }
    App.setDetent = setDetent;
    App.on('tab', () => { if (narrow() && panel.dataset.detent === 'peek') setDetent('half'); });

    let drag = null;
    function down(e) {
      if (!narrow() || e.target.closest('button, input, select')) return;
      drag = { y: e.clientY, start: panel.getBoundingClientRect().top, moved: false };
      panel.classList.add('dragging');
      e.target.setPointerCapture && e.target.setPointerCapture(e.pointerId);
    }
    function move(e) {
      if (!drag) return;
      const dy = e.clientY - drag.y;
      if (Math.abs(dy) > 4) drag.moved = true;
      const top = Math.max(64, drag.start + dy) - (root.innerHeight - panel.offsetHeight);
      panel.style.transform = `translateY(${Math.max(0, top)}px)`;
    }
    function up(e) {
      if (!drag) return;
      panel.classList.remove('dragging');
      const wasMoved = drag.moved;
      const top = panel.getBoundingClientRect().top;
      drag = null;
      if (!wasMoved) {
        // tocco sulla maniglia: posizione successiva
        if (e.target.closest('#sheetHandle')) setDetent(DETENTS[(DETENTS.indexOf(panel.dataset.detent) + 1) % 3]);
        else panel.style.transform = '';
        return;
      }
      const h = root.innerHeight;
      const frac = top / h;
      setDetent(frac > 0.62 ? 'peek' : frac > 0.25 ? 'half' : 'full');
    }
    for (const el of [$('sheetHandle'), panel.querySelector('.panel-head')]) {
      el.addEventListener('pointerdown', down);
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    }

    // Spazio libero sulla mappa (per centrare rotta e aereo senza finire sotto al pannello)
    App.mapPadding = () => {
      if (narrow()) {
        const sheetTop = panel.getBoundingClientRect().top;
        return { paddingTopLeft: [24, 190], paddingBottomRight: [70, Math.max(80, root.innerHeight - sheetTop + 20)] };
      }
      const left = document.body.classList.contains('panel-hidden') ? 80 : panel.getBoundingClientRect().right + 30;
      return { paddingTopLeft: [left, 150], paddingBottomRight: [90, 250] };
    };

    setTimeout(moveIndicator, 0);
  });
})(this);
