/* Scheda Cockpit: checklist (A320/B737), blocco note CRAFT con compilazione automatica, logbook (logbook.js). */
(function (root) {
  'use strict';

  root.App.register((App) => {
    const $ = App.$;
    const S = App.settings;
    const { CHECKLISTS } = root.ChecklistsData;
    const STATE_KEY = 'readback-copilot-checklists';
    const NOTES_KEY = 'readback-copilot-notes';
    let state = App.storage.get(STATE_KEY, {});
    let selected = null;
    let suggested = null;
    let manualAt = 0; // ultima scelta manuale: per 2 minuti il tracking non cambia checklist

    // ------------------------------------------------------------ sotto-schede
    document.querySelectorAll('#cockpitSeg button').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('#cockpitSeg button').forEach((x) => x.classList.toggle('active', x === b));
      document.querySelectorAll('[data-view="cockpit"] .subview').forEach((v) => { v.hidden = v.dataset.sub !== b.dataset.sub; });
    }));

    // ------------------------------------------------------------ checklist
    const lists = () => CHECKLISTS[S.aircraft] || CHECKLISTS.A320;
    const checks = (id) => {
      const ac = (state[S.aircraft] = state[S.aircraft] || {});
      const list = lists().find((x) => x.id === id);
      if (!ac[id] || ac[id].length !== list.items.length) ac[id] = list.items.map(() => false);
      return ac[id];
    };
    const save = () => App.storage.set(STATE_KEY, state);

    function renderPhases() {
      const box = $('clPhases');
      box.innerHTML = '';
      for (const cl of lists()) {
        const b = document.createElement('button');
        const done = checks(cl.id).every(Boolean);
        b.className = `chip${cl.id === selected ? ' active' : ''}${done ? ' done' : ''}`;
        b.textContent = `${done ? '✓ ' : ''}${cl.title}${cl.id === suggested && cl.id !== selected ? ' •' : ''}`;
        b.title = cl.id === suggested ? 'Suggerita per la fase del volo' : '';
        b.addEventListener('click', () => { selected = cl.id; manualAt = Date.now(); render(); });
        box.append(b);
      }
    }

    function renderItems() {
      const cl = lists().find((x) => x.id === selected) || lists()[0];
      selected = cl.id;
      const c = checks(cl.id);
      $('clTitle').textContent = cl.title;
      $('clCount').textContent = `${c.filter(Boolean).length}/${c.length}`;
      $('clCount').className = `badge ${c.every(Boolean) ? 'ok' : 'muted'}`;
      const ul = $('clItems');
      ul.innerHTML = '';
      cl.items.forEach(([label, value], k) => {
        const li = document.createElement('li');
        li.className = c[k] ? 'done' : '';
        li.innerHTML = '<span class="box"></span><span class="item-label"></span><span class="item-value"></span>';
        li.querySelector('.item-label').textContent = label;
        li.querySelector('.item-value').textContent = value;
        li.addEventListener('click', () => {
          c[k] = !c[k];
          save();
          render();
          if (c.every(Boolean)) App.toast(`Checklist "${cl.title}" completata ✓`);
        });
        ul.append(li);
      });
    }

    function render() { renderPhases(); renderItems(); }

    $('clReset').addEventListener('click', () => { const c = checks(selected); c.fill(false); save(); render(); });
    $('clNext').addEventListener('click', () => {
      const all = lists();
      const i = all.findIndex((x) => x.id === selected);
      selected = all[Math.min(all.length - 1, i + 1)].id;
      manualAt = Date.now();
      render();
    });
    App.on('setting:aircraft', () => { selected = null; render(); });

    // La fase del volo suggerisce la checklist giusta
    App.on('track', (e) => {
      const cand = lists().filter((x) => x.phase === e.phase);
      const next = cand.find((x) => !checks(x.id).every(Boolean)) || cand[0];
      if (next && next.id !== suggested) {
        suggested = next.id;
        if (!selected || checks(selected).every(Boolean) || Date.now() - manualAt > 120000) selected = next.id;
        render();
      }
    });

    // ------------------------------------------------------------ note CRAFT
    const fields = ['craftC', 'craftR', 'craftA', 'craftF', 'craftT', 'notes'];
    const notes = App.storage.get(NOTES_KEY, {});
    for (const id of fields) {
      $(id).value = notes[id] || '';
      $(id).addEventListener('input', () => { notes[id] = $(id).value; App.storage.set(NOTES_KEY, notes); });
    }
    const setField = (id, v) => { if (v) { $(id).value = v; notes[id] = v; } };

    function fillFrom(item) {
      const parts = (item && item.result && item.result.parts) || [];
      const clr = parts.find((p) => p.type === 'clearance');
      if (clr) {
        const m = clr.display.match(/^Cleared to ([^,]+)(?:, (.+))?$/i);
        if (m) { setField('craftC', m[1]); setField('craftR', m[2] || ''); }
      }
      const lvl = parts.find((p) => p.type === 'level' && /climb|maintain/i.test(p.display));
      if (lvl) setField('craftA', lvl.display);
      const fq = parts.find((p) => p.type === 'frequency');
      if (fq) setField('craftF', fq.display);
      const sq = parts.find((p) => p.type === 'squawk' && /\d{4}/.test(p.display));
      if (sq) setField('craftT', sq.display.match(/\d{4}/)[0]);
      App.storage.set(NOTES_KEY, notes);
      return !!(clr || lvl || fq || sq);
    }

    let lastClearance = null;
    App.on('readback', (item) => {
      if (!item.result || item.result.forUs === false) return;
      const isClr = (item.result.parts || []).some((p) => p.type === 'clearance');
      if (!isClr) return;
      lastClearance = item;
      // Compila da sola i campi ancora vuoti
      if (!$('craftC').value && !$('craftT').value) { fillFrom(item); App.toast('Autorizzazione copiata nelle note (Cockpit › Note).'); }
    });
    $('craftFill').addEventListener('click', () => {
      if (!lastClearance || !fillFrom(lastClearance)) App.toast('Nessuna autorizzazione sentita finora.');
    });
    $('notesClear').addEventListener('click', () => {
      if (!confirm('Pulire tutte le note e i campi CRAFT?')) return;
      for (const id of fields) { $(id).value = ''; notes[id] = ''; }
      App.storage.set(NOTES_KEY, notes);
    });

    render();
  });
})(this);
