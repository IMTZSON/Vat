/* Riconoscimento della voce del pilota (allenamento): Groq Whisper se c'è la chiave,
   altrimenti il riconoscimento di Chrome. Uso: const s = await STT.start(); const testo = await s.stop(); */
(function (root) {
  'use strict';

  const hasWebSpeech = () => !!(root.SpeechRecognition || root.webkitSpeechRecognition);

  const STT = {
    available(settings) {
      if (settings.sttProvider === 'local' ? settings.localSttUrl : settings.groqKey) return 'groq';
      if (hasWebSpeech() && !(root.Net && root.Net.desktop)) return 'chrome';
      return null;
    },

    async start(settings, onInterim) {
      const kind = this.available(settings);
      if (kind === 'groq') {
        const rec = new root.AudioCapture.ClipRecorder();
        await rec.start(settings.micDevice);
        return {
          kind,
          async stop() {
            const wav = rec.stop();
            if (!wav) return '';
            const cs = root.Readback.parseCallsign(settings.callsign, settings.telephony);
            const local = settings.sttProvider === 'local';
            const r = await root.Groq.transcribe(wav, { key: local ? '' : settings.groqKey, base: local ? settings.localSttUrl : '', model: settings.whisperModel, callsign: cs ? cs.display : '' });
            return r.text;
          },
          cancel() { rec.stop(); },
        };
      }
      if (kind === 'chrome') {
        const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
        const rec = new SR();
        rec.lang = settings.lang || 'en-US';
        rec.continuous = true;
        rec.interimResults = true;
        let finalText = '';
        let done;
        const ended = new Promise((res) => { done = res; });
        rec.onresult = (e) => {
          let interim = '';
          for (let i = e.resultIndex; i < e.results.length; i++) {
            if (e.results[i].isFinal) finalText += ` ${e.results[i][0].transcript}`;
            else interim += e.results[i][0].transcript;
          }
          if (onInterim) onInterim((finalText + ' ' + interim).trim());
        };
        rec.onerror = () => done();
        rec.onend = () => done();
        rec.start();
        return {
          kind,
          async stop() { rec.stop(); await ended; return finalText.trim(); },
          cancel() { rec.abort(); },
        };
      }
      throw new Error(root.I18n.t('train.needStt'));
    },
  };

  root.STT = STT;
})(this);
