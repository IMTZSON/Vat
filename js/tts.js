/* Sintesi vocale (voci di Windows / del browser) in inglese. */
(function (root) {
  'use strict';

  const TTS = {
    voiceName: '',
    rate: 1,

    voices(lang) {
      if (!('speechSynthesis' in root)) return [];
      const re = new RegExp(`^${lang || 'en'}`, 'i');
      return speechSynthesis.getVoices().filter((v) => re.test(v.lang));
    },

    speak(text, opts) {
      if (!text || !('speechSynthesis' in root)) return Promise.resolve();
      opts = opts || {};
      return new Promise((resolve) => {
        const u = new SpeechSynthesisUtterance(text);
        // opts.lang: 'it' per gli annunci in italiano, altrimenti inglese (voce scelta nelle impostazioni)
        const it = opts.lang === 'it';
        const list = this.voices(it ? 'it' : 'en');
        const wanted = it ? opts.voiceName : (opts.voiceName || this.voiceName);
        const v = list.find((x) => x.name === wanted) || list.find((x) => (it ? /it-IT/i : /en-GB/i).test(x.lang)) || list[0];
        if (v) { u.voice = v; u.lang = v.lang; } else { u.lang = it ? 'it-IT' : 'en-GB'; }
        u.rate = opts.rate || this.rate || 1;
        u.onend = resolve;
        u.onerror = resolve;
        if (!opts.queue) speechSynthesis.cancel();
        speechSynthesis.speak(u);
      });
    },

    // "Din-don" di cabina (due note che sfumano), prima degli annunci
    chime() {
      const Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return Promise.resolve();
      return new Promise((resolve) => {
        try {
          const ctx = new Ctx();
          const t0 = ctx.currentTime + 0.05;
          [[659.25, 0], [523.25, 0.55]].forEach(([f, dt]) => {
            for (const [mult, vol] of [[1, 0.22], [2, 0.05], [3, 0.02]]) {
              const o = ctx.createOscillator();
              const g = ctx.createGain();
              o.type = 'sine';
              o.frequency.value = f * mult;
              g.gain.setValueAtTime(0, t0 + dt);
              g.gain.linearRampToValueAtTime(vol, t0 + dt + 0.01);
              g.gain.exponentialRampToValueAtTime(0.0001, t0 + dt + 1.6);
              o.connect(g).connect(ctx.destination);
              o.start(t0 + dt);
              o.stop(t0 + dt + 1.7);
            }
          });
          setTimeout(() => { ctx.close(); resolve(); }, 1900);
        } catch (e) { resolve(); }
      });
    },

    // Doppio bip di avviso (es. Top of Descent)
    ping() {
      const Ctx = root.AudioContext || root.webkitAudioContext;
      if (!Ctx) return;
      try {
        const ctx = new Ctx();
        [0, 0.2].forEach((dt) => {
          const o = ctx.createOscillator();
          const g = ctx.createGain();
          o.frequency.value = 988;
          g.gain.setValueAtTime(0.09, ctx.currentTime + dt);
          g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dt + 0.14);
          o.connect(g).connect(ctx.destination);
          o.start(ctx.currentTime + dt);
          o.stop(ctx.currentTime + dt + 0.15);
        });
        setTimeout(() => ctx.close(), 600);
      } catch (e) { /* audio non disponibile */ }
    },

    stop() {
      if ('speechSynthesis' in root) speechSynthesis.cancel();
    },
  };

  root.TTS = TTS;
})(this);
