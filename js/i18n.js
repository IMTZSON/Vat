/* Traduzioni: italiano, inglese, spagnolo, tedesco, francese, portoghese (Brasile).
   I testi stanno in strings.js come { chiave: [italiano, inglese] }: tenere le due lingue
   affiancate rende impossibile dimenticarne una (lo controlla anche tests/i18n.test.js).
   Le altre lingue stanno in strings-es.js, -de, -fr e -pt ({ chiave: testo }); una chiave
   mancante, e i contenuti bilingui ["italiano", "inglese"] (checklist, frasario…), usano l'inglese.
   Nell'HTML: data-i18n="chiave" (testo), data-i18n-html (testo con markup fidato),
   data-i18n-title, data-i18n-placeholder, data-i18n-aria (attributi). */
(function (root) {
  'use strict';

  const isNode = typeof require === 'function' && typeof module !== 'undefined';
  const STRINGS = isNode ? require('./strings.js').STRINGS : (root.Strings && root.Strings.STRINGS) || {};
  const extra = (file, name) => {
    if (isNode) { try { return require(file).STRINGS; } catch (e) { return {}; } }
    return (root[name] && root[name].STRINGS) || {};
  };
  const EXTRA = {
    es: extra('./strings-es.js', 'StringsEs'), de: extra('./strings-de.js', 'StringsDe'),
    fr: extra('./strings-fr.js', 'StringsFr'), pt: extra('./strings-pt.js', 'StringsPt'),
  };

  const LANGS = ['it', 'en', 'es', 'de', 'fr', 'pt'];
  const LOCALES = { it: 'it-IT', en: 'en-GB', es: 'es-ES', de: 'de-DE', fr: 'fr-FR', pt: 'pt-BR' };
  const listeners = [];

  function detect() {
    const nav = (root.navigator && (root.navigator.languages || [root.navigator.language])) || [];
    for (const l of nav) {
      const code = String(l || '').slice(0, 2).toLowerCase();
      if (LANGS.includes(code)) return code;
    }
    return root.navigator ? 'en' : 'it';
  }

  const I18n = {
    LANGS,
    lang: 'it',

    // lang: 'auto' | 'it' | 'en' | 'es' | 'de' | 'fr' | 'pt'
    setLang(lang) {
      const next = LANGS.includes(lang) ? lang : detect();
      const changed = next !== this.lang;
      this.lang = next;
      if (root.document) {
        root.document.documentElement.lang = next;
        this.apply(root.document);
      }
      if (changed) listeners.forEach((fn) => { try { fn(next); } catch (e) { console.error(e); } });
      return next;
    },

    onChange(fn) { listeners.push(fn); },

    has(key) { return Object.prototype.hasOwnProperty.call(STRINGS, key); },

    t(key, vars) {
      const entry = STRINGS[key];
      let s;
      if (!entry) s = key;
      else if (EXTRA[this.lang]) s = EXTRA[this.lang][key] || entry[1] || entry[0];
      else s = entry[LANGS.indexOf(this.lang)] || entry[0];
      if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
      return s;
    },

    // Testo di contenuto: "testo" oppure ["italiano", "inglese"(, "español", "deutsch")]; senza la lingua, l'inglese
    pick(x) {
      if (!Array.isArray(x)) return x;
      return x[LANGS.indexOf(this.lang)] || x[1] || x[0];
    },

    // Locale per date, ore e valute
    locale() { return LOCALES[this.lang] || 'en-GB'; },

    // Separatore decimale della lingua ("," in tutte tranne l'inglese)
    decimal() { return (1.5).toLocaleString(this.locale()).charAt(1); },

    time(d, withSeconds) {
      const opts = { hour: '2-digit', minute: '2-digit' };
      if (withSeconds) opts.second = '2-digit';
      return new Date(d).toLocaleTimeString(this.locale(), opts);
    },

    date(d) { return new Date(d).toLocaleDateString(this.locale()); },

    money(v) { return (Number(v) || 0).toLocaleString(this.locale(), { style: 'currency', currency: 'EUR' }); },

    apply(scope) {
      if (!scope || !scope.querySelectorAll) return;
      scope.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = this.t(el.dataset.i18n); });
      scope.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = this.t(el.dataset.i18nHtml); });
      for (const [attr, data] of [['title', 'i18nTitle'], ['placeholder', 'i18nPlaceholder'], ['aria-label', 'i18nAria']]) {
        scope.querySelectorAll(`[data-${data.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}]`).forEach((el) => el.setAttribute(attr, this.t(el.dataset[data])));
      }
    },
  };

  I18n.lang = detect();
  const api = I18n;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.I18n = api;
})(this);
