/* Scheda Bordo: listino modificabile e simulazione delle vendite durante il volo
   (segue il tracking VATSIM oppure un timer). */
(function (root) {
  'use strict';

  const euro = (v) => (Number(v) || 0).toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });

  root.App.register((App) => {
    const $ = App.$;
    const S = App.settings;
    const C = root.CabinSim;
    const CAT_KEY = 'readback-copilot-catalog';
    const SIM_KEY = 'readback-copilot-cabin';
    let catalogs = App.storage.get(CAT_KEY, null) || JSON.parse(JSON.stringify(C.DEFAULT_CATALOG));
    let run = App.storage.get(SIM_KEY, null); // { sim, startedAt, lastT, source, done }
    let timer = null;

    const catalog = () => (catalogs[S.aircraft] = catalogs[S.aircraft] || JSON.parse(JSON.stringify(C.DEFAULT_CATALOG[S.aircraft] || C.DEFAULT_CATALOG.A320)));
    const saveCatalog = () => App.storage.set(CAT_KEY, catalogs);
    const saveRun = () => App.storage.set(SIM_KEY, run);

    function paxDefault() {
      const v = Number($('cabPax').value);
      if (v > 0) return v;
      if (App.flight && App.flight.pax) return App.flight.pax;
      return Math.round((C.SEATS[S.aircraft] || 180) * 0.85);
    }
    function durationMin() {
      if (S.cabSource === 'timer') return Math.max(5, Number(S.cabMinutes) || 90);
      const f = App.flight;
      if (f && f.ete) return Math.round(f.ete / 60);
      if (App.track && App.track.progress && App.track.gs > 100) return Math.round((App.track.progress.total / App.track.gs) * 60 + 20);
      return 90;
    }

    // ------------------------------------------------------------ listino
    function renderCatalog() {
      const box = $('cabCatalog');
      box.innerHTML = '';
      const head = document.createElement('div');
      head.className = 'item head';
      head.innerHTML = '<span>Prodotto</span><span style="text-align:right">Prezzo €</span><span style="text-align:right">Scorta</span><span></span>';
      box.append(head);
      catalog().forEach((it, k) => {
        const row = document.createElement('div');
        row.className = 'item';
        row.innerHTML = `<div><input class="name" aria-label="Nome prodotto"><div class="cat">${C.CATS[it.cat] || ''}</div></div>
          <input class="num price" inputmode="decimal" aria-label="Prezzo"><input class="num stock" inputmode="numeric" aria-label="Scorta">
          <button class="icon-btn" title="Elimina">${root.Icons.svg('trash-2')}</button>`;
        const [name, price, stock] = [row.querySelector('.name'), row.querySelector('.price'), row.querySelector('.stock')];
        name.value = it.name;
        price.value = String(it.price).replace('.', ',');
        stock.value = it.stock;
        name.addEventListener('change', () => { it.name = name.value; saveCatalog(); });
        price.addEventListener('change', () => { it.price = Math.max(0, Number(price.value.replace(',', '.')) || 0); saveCatalog(); });
        stock.addEventListener('change', () => { it.stock = Math.max(0, Math.round(Number(stock.value) || 0)); saveCatalog(); });
        row.querySelector('button').addEventListener('click', () => { catalog().splice(k, 1); saveCatalog(); renderCatalog(); });
        box.append(row);
      });
    }
    $('cabAddItem').addEventListener('click', () => {
      const name = prompt('Nome del prodotto:');
      if (!name) return;
      const cat = (prompt('Categoria: bevande, snack, pasti o duty free?', 'snack') || 'snack').toLowerCase();
      const map = { bevande: 'drink', bevanda: 'drink', snack: 'snack', pasti: 'meal', pasto: 'meal', 'duty free': 'duty', duty: 'duty' };
      const price = Number((prompt('Prezzo in €:', '3,00') || '0').replace(',', '.')) || 0;
      catalog().push({ id: `x${Date.now()}`, name, cat: map[cat] || 'snack', price, stock: 20, pop: 0.6 });
      saveCatalog();
      renderCatalog();
    });
    $('cabResetCatalog').addEventListener('click', () => {
      if (!confirm('Ripristinare il listino predefinito?')) return;
      catalogs[S.aircraft] = JSON.parse(JSON.stringify(C.DEFAULT_CATALOG[S.aircraft]));
      saveCatalog();
      renderCatalog();
    });
    App.on('setting:aircraft', () => { renderCatalog(); renderStats(); });

    // ------------------------------------------------------------ simulazione
    function stateLabel() {
      if (!run) return 'Non iniziato';
      if (run.done) return 'Terminato';
      const p = run.progress || 0;
      if (p < C.WINDOW[0] || run.closed) return S.cabSource === 'timer' || p < C.WINDOW[0] ? 'In attesa (salita)' : 'Chiuso';
      if (p > C.WINDOW[1]) return 'Chiuso (discesa)';
      return 'In corso';
    }

    function renderStats() {
      const sim = run && run.sim;
      $('cabRevenue').textContent = euro(sim ? sim.revenue : 0);
      $('cabSold').textContent = sim ? sim.sold : 0;
      $('cabPaxView').textContent = sim ? sim.pax : paxDefault();
      $('cabState').textContent = stateLabel();
      $('cabProgress').style.width = `${Math.round(((run && run.progress) || 0) * 100)}%`;
      $('cabHint').textContent = !run
        ? (S.cabSource === 'auto' ? 'Con "Volo VATSIM" il servizio segue il tuo volo reale: attiva "Segui il volo" nella scheda Volo.' : `Timer: il servizio dura ${durationMin()} minuti in tempo reale.`)
        : (run.done ? `Volo chiuso. Incasso medio ${euro(sim.pax ? sim.revenue / sim.pax : 0)} a passeggero.` : '');
      const btn = $('cabStart');
      if (run && !run.done) { btn.innerHTML = `${root.Icons.svg('square')} Ferma simulazione`; btn.classList.add('stop'); }
      else { btn.innerHTML = `${root.Icons.svg('play')} Inizia simulazione`; btn.classList.remove('stop'); }

      const feed = $('cabFeed');
      const sales = sim ? sim.sales.slice(-40).reverse() : [];
      feed.innerHTML = sales.length ? '' : '<li class="empty">Le vendite compariranno qui durante il servizio.</li>';
      for (const s of sales) {
        const li = document.createElement('li');
        li.innerHTML = '<span class="t"></span><span class="what"></span><span class="amt"></span>';
        li.querySelector('.t').textContent = `+${s.minute}′`;
        li.querySelector('.what').textContent = `${s.qty > 1 ? `${s.qty}× ` : ''}${s.name}`;
        li.querySelector('.amt').textContent = euro(s.amount);
        feed.append(li);
      }
      const top = sim ? C.summary(sim).top.slice(0, 6) : [];
      const tl = $('cabTop');
      tl.innerHTML = top.length ? '' : '<li class="empty">—</li>';
      for (const t of top) {
        const li = document.createElement('li');
        li.className = 'row-between';
        li.innerHTML = '<span></span><b></b>';
        li.querySelector('span').textContent = `${t.qty}× ${t.name}`;
        li.querySelector('b').textContent = euro(t.amount);
        tl.append(li);
      }
    }

    function advance(dtMin, progress, open) {
      if (!run || run.done || dtMin <= 0) return;
      run.progress = Math.max(run.progress || 0, Math.min(1, progress));
      run.closed = open === false;
      C.step(run.sim, { dtMin, progress: run.progress, open });
      saveRun();
      renderStats();
    }

    function tickTimer() {
      if (!run || run.done || run.source !== 'timer') return;
      const now = Date.now();
      const dt = (now - run.lastT) / 60000;
      run.lastT = now;
      advance(dt, (now - run.startedAt) / 60000 / run.sim.durationMin);
      if (run.progress >= 1) finish();
    }

    App.on('track', (e) => {
      if (!run || run.done || run.source !== 'auto') return;
      const dt = run.lastT ? (e.t - run.lastT) / 60000 : 0;
      run.lastT = e.t;
      const open = e.phase === 'cruise' || (e.phase === 'climb' && e.alt > 10000) || (e.phase === 'descent' && e.alt > 15000);
      const progress = e.progress ? e.progress.pct : Math.min(1, (e.t - run.startedAt) / 60000 / run.sim.durationMin);
      advance(Math.min(dt, 5), progress, open);
      if (e.phase === 'arrived' || e.phase === 'landed') finish();
    });

    function start() {
      run = {
        sim: C.create({ catalog: catalog(), pax: paxDefault(), durationMin: durationMin() }),
        startedAt: Date.now(), lastT: Date.now(), source: S.cabSource, progress: 0, done: false,
      };
      if (run.source === 'auto' && !(App.isTracking && App.isTracking())) App.toast('Attiva "Segui il volo" nella scheda Volo: il servizio partirà dopo la salita.', 6000);
      saveRun();
      if (run.source === 'timer') timer = setInterval(tickTimer, 3000);
      renderStats();
    }

    function finish() {
      if (!run || run.done) return;
      run.done = true;
      clearInterval(timer);
      timer = null;
      const s = C.summary(run.sim);
      // Il magazzino del listino scende con le vendite
      for (const it of run.sim.items) { const c = catalog().find((x) => x.id === it.id); if (c) c.stock = it.stock; }
      saveCatalog();
      saveRun();
      renderCatalog();
      renderStats();
      App.emit('cabin-summary', s);
      App.toast(`Servizio chiuso: ${s.sold} prodotti venduti, incasso ${euro(s.revenue)}.`, 6000);
    }

    $('cabStart').addEventListener('click', () => {
      if (run && !run.done) { if (confirm('Fermare la simulazione e chiudere il servizio?')) finish(); return; }
      start();
    });
    $('cabEnd').addEventListener('click', () => {
      if (run && !run.done) { finish(); return; }
      if (run && run.done && confirm('Iniziare un nuovo volo? Le vendite di questo volo verranno azzerate (il riepilogo resta nel logbook).')) { run = null; saveRun(); renderStats(); }
    });
    $('cabPax').addEventListener('input', renderStats);
    App.on('flight', (f) => { if (f && f.pax && !$('cabPax').value) $('cabPax').placeholder = `${f.pax} (SimBrief)`; renderStats(); });

    if (run && !run.done && run.source === 'timer') { timer = setInterval(tickTimer, 3000); }
    if (App.flight && App.flight.pax) $('cabPax').placeholder = `${App.flight.pax} (SimBrief)`;
    renderCatalog();
    renderStats();
  });
})(this);
