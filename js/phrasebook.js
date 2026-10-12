/* Scheda Frasario: frasi standard con ascolto, alfabeto, numeri e glossario. */
(function (root) {
  'use strict';

  const NUMBER_TIPS = [
    ['0', 'zero', 'ZI-ro'], ['1', 'one', 'UAN'], ['2', 'two', 'TU'], ['3', 'three', 'TRI'], ['4', 'four', 'FO-er'],
    ['5', 'five', 'FAIF'], ['6', 'six', 'SIKS'], ['7', 'seven', 'SE-ven'], ['8', 'eight', 'EIT'], ['9', 'niner', 'NAI-ner'],
    ['.', 'decimal', 'DE-si-mal'], ['100', 'hundred', 'HAN-dred'], ['1000', 'thousand', 'TAU-sand'],
  ];

  // Rende leggibili alla sintesi vocale numeri, piste e quote ("6000 feet" -> "six thousand feet").
  function speakable(text) {
    const R = root.Readback;
    return String(text)
      .replace(/\b(\d{4,5}) feet\b/g, (m, n) => `${R.spokenAltitude(n)} feet`)
      .replace(/\bflight level (\d{2,3})\b/gi, (m, n) => R.spokenFL(n))
      .replace(/\b(\d{2})([LRC])\b/g, (m, n, s) => R.spokenRunway(n + s))
      .replace(/\d+(\.\d+)?/g, (m) => R.spellDigits(m));
  }

  root.App.register((App) => {
    const $ = App.$;
    const { SECTIONS, GLOSSARY } = root.PhrasebookData;
    const t = App.t;
    const L = (x) => root.I18n.pick(x);
    const cs = () => App.callsignInfo();

    const personalize = (s) => {
      const c = cs();
      return c && c.type !== 'unknown' ? s.replace(/Alitalia 123/g, c.display) : s;
    };

    function speakBtn(text) {
      const b = document.createElement('button');
      b.className = 'icon-btn';
      b.innerHTML = root.Icons.svg('volume-2');
      b.title = t('common.listen');
      b.addEventListener('click', () => root.TTS.speak(speakable(text.replace(/^\(.*?\)\s*/, ''))));
      return b;
    }

    function render(filter) {
      const q = (filter || '').toLowerCase().trim();
      const box = $('phrasebook');
      box.innerHTML = '';
      for (const sec of SECTIONS) {
        const items = sec.items.filter((it) => !q || [L(it.when), it.atc, L(it.pilot), L(it.note)].join(' ').toLowerCase().includes(q));
        if (!items.length) continue;
        const panel = document.createElement('details');
        panel.className = 'disclosure';
        panel.open = !!q || sec === SECTIONS[0];
        const sum = document.createElement('summary');
        sum.textContent = `${L(sec.title)} (${items.length})`;
        panel.append(sum);
        const ul = document.createElement('ul');
        ul.className = 'phrases';
        for (const it of items) {
          const li = document.createElement('li');
          const h = document.createElement('div');
          h.className = 'phWhen';
          h.textContent = L(it.when);
          li.append(h);
          const line = (who, text, cls) => {
            const row = document.createElement('div');
            row.className = `phLine ${cls}`;
            const tag = document.createElement('span');
            tag.className = 'phWho';
            tag.textContent = who;
            const t = document.createElement('span');
            t.className = 'phText';
            t.textContent = personalize(text);
            row.append(tag, t, speakBtn(personalize(text)));
            li.append(row);
          };
          if (it.atc) line('ATC', it.atc, 'atc');
          line(t('phrases.you'), L(it.pilot), 'pilot');
          if (it.note) {
            const n = document.createElement('div');
            n.className = 'hint';
            n.textContent = `💡 ${L(it.note)}`;
            li.append(n);
          }
          ul.append(li);
        }
        panel.append(ul);
        box.append(panel);
      }
      if (!box.children.length) { const d = document.createElement('div'); d.className = 'card glass hint'; d.textContent = t('phrases.none'); box.append(d); }
    }

    $('phraseSearch').addEventListener('input', (e) => render(e.target.value));
    App.on('setting:callsign', () => render($('phraseSearch').value));

    const alpha = $('alphabet');
    for (const [L, word] of Object.entries(root.Readback.LETTER_WORD)) {
      const b = document.createElement('button');
      b.className = 'alpha';
      b.innerHTML = `<b>${L}</b><span>${word}</span>`;
      b.addEventListener('click', () => root.TTS.speak(word));
      alpha.append(b);
    }
    const nums = $('numbers');
    for (const [n, word, tip] of NUMBER_TIPS) {
      const b = document.createElement('button');
      b.className = 'alpha';
      // La pronuncia "all'italiana" aiuta solo chi parla italiano
      b.innerHTML = `<b>${n}</b><span>${word}</span>${root.I18n.lang === 'it' ? `<small>${tip}</small>` : ''}`;
      b.addEventListener('click', () => root.TTS.speak(word));
      nums.append(b);
    }
    const dl = $('glossary');
    for (const [term, def] of GLOSSARY) {
      const dt = document.createElement('dt');
      dt.textContent = L(term);
      const dd = document.createElement('dd');
      dd.textContent = L(def);
      dl.append(dt, dd);
    }
    render('');
  });

  root.speakable = speakable;
})(this);
