/* Traduzioni (italiano / inglese).
   I testi stanno in strings.js come { chiave: [italiano, inglese] }: tenere le due lingue
   affiancate rende impossibile dimenticarne una (lo controlla anche tests/i18n.test.js).
   Nell'HTML: data-i18n="chiave" (testo), data-i18n-html (testo con markup fidato),
   data-i18n-title, data-i18n-placeholder, data-i18n-aria (attributi). */
(function (root) {
  'use strict';

  const STRINGS = (typeof require === 'function' && typeof module !== 'undefined')
    ? require('./strings.js').STRINGS
    : (root.Strings && root.Strings.STRINGS) || {};

  const LANGS = ['it', 'en'];
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

    // lang: 'auto' | 'it' | 'en'
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
      else s = entry[LANGS.indexOf(this.lang)] || entry[0];
      if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] === undefined || vars[k] === null ? '' : String(vars[k])));
      return s;
    },

    // Locale per date, ore e valute
    locale() { return this.lang === 'it' ? 'it-IT' : 'en-GB'; },

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
