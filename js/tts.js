/* Sintesi vocale (voci di Windows / del browser) in inglese. */
(function (root) {
  'use strict';

  const TTS = {
    voiceName: '',
    rate: 1,

    voices() {
      if (!('speechSynthesis' in root)) return [];
      return speechSynthesis.getVoices().filter((v) => /^en/i.test(v.lang));
    },

    speak(text, opts) {
      if (!text || !('speechSynthesis' in root)) return Promise.resolve();
      opts = opts || {};
      return new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        const list = this.voices();
        const wanted = opts.voiceName || this.voiceName;
        const v = list.find((x) => x.name === wanted) || list.find((x) => /en-GB/i.test(x.lang)) || list[0];
        if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = 'en-GB'; }
        u.rate = opts.rate || this.rate || 1;
        u.onend = resolve;
        u.onerror = resolve;
        speechSynthesis.cancel();
        speechSynthesis.speak(u);
      });
    },

    stop() {
      if ('speechSynthesis' in root) speechSynthesis.cancel();
    },
  };

  root.TTS = TTS;
})(this);
