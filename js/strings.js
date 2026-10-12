/* Testi dell'interfaccia: { chiave: [italiano, inglese] }. Segnaposto: {nome}. */
(function (root) {
  'use strict';

  const STRINGS = {
    // ------------------------------------------------------------------ motore readback
    'rb.badSquawk': ['Lo squawk {code} contiene 8 o 9: non è valido, chiedi "say again squawk".', 'Squawk {code} contains an 8 or 9: it is not valid, ask "say again squawk".'],
    'rb.oddQnh': ['QNH {qnh} sembra strano: verifica.', 'QNH {qnh} looks odd: double-check it.'],
    'rb.badFreq': ['Frequenza "{freq}" non valida: chiedi "say again frequency".', 'Frequency "{freq}" is not valid: ask "say again frequency".'],
    'rb.badRunway': ['Pista "{rwy}" non valida: chiedi "say again runway".', 'Runway "{rwy}" is not valid: ask "say again runway".'],
    'rb.standby': ['— nessuna risposta (standby)', '— no reply (standby)'],
    'rb.standbyNote': ['Standby: non rispondere, aspetta che l\'ATC ti richiami.', 'Standby: don\'t reply, wait for ATC to call you back.'],
    'rb.sayAgain': ['Ripeti la tua ultima chiamata', 'Repeat your last transmission'],
    'rb.sayAgainNote': ['L\'ATC non ti ha capito: ripeti la tua ultima chiamata.', 'ATC didn\'t get you: repeat your last transmission.'],
    'rb.report.level': ['Riporta il tuo livello', 'Report your level'],
    'rb.report.altitude': ['Riporta la tua quota', 'Report your altitude'],
    'rb.report.heading': ['Riporta la tua prua', 'Report your heading'],
    'rb.report.speed': ['Riporta la tua velocità', 'Report your speed'],
    'rb.report.position': ['Riporta la tua posizione', 'Report your position'],
    'rb.reportWhat.level': ['il tuo livello (es. "Level 240")', 'your level (e.g. "Level 240")'],
    'rb.reportWhat.altitude': ['la tua quota (es. "Passing 5000 feet")', 'your altitude (e.g. "Passing 5000 feet")'],
    'rb.reportWhat.heading': ['la tua prua (es. "Heading 270")', 'your heading (e.g. "Heading 270")'],
    'rb.reportWhat.speed': ['la tua velocità (es. "Speed 250 knots")', 'your speed (e.g. "Speed 250 knots")'],
    'rb.reportWhat.position': ['la tua posizione', 'your position'],
    'rb.reportNote': ['L\'ATC ti chiede {what}, seguito dal nominativo.', 'ATC wants {what}, followed by your callsign.'],

    // ------------------------------------------------------------------ verifiche
    'verify.echo': ['Whisper ha ripetuto il suo prompt invece di trascrivere: l\'audio non era chiaro. Chiedi "say again".', 'Whisper echoed its prompt instead of transcribing: the audio wasn\'t clear. Ask "say again".'],
    'verify.audioBad': ['Audio poco chiaro: i numeri potrebbero essere sbagliati. Chiedi "say again".', 'Unclear audio: the numbers may be wrong. Ask "say again".'],
    'verify.audioWarn': ['Audio non perfetto: controlla bene i numeri.', 'Audio not perfect: double-check the numbers.'],
    'verify.aiInvented': ['L\'AI ha scritto {nums}, che non c\'è in quello che ha detto l\'ATC: mostro il readback a regole.', 'The AI wrote {nums}, which ATC never said: showing the rule-based readback.'],
    'verify.aiMissing': ['L\'AI non ha ripetuto {nums}: controlla. Versione a regole: "{rules}"', 'The AI left out {nums}: check it. Rule-based version: "{rules}"'],
    'verify.freqMaybe': ['La frequenza {freq} non risulta tra gli ATC online: forse {near} ({cs})?', 'Frequency {freq} isn\'t used by any online ATC: maybe {near} ({cs})?'],
    'verify.freqUnknown': ['La frequenza {freq} non corrisponde a nessun ATC online in zona: controlla.', 'Frequency {freq} doesn\'t match any online ATC nearby: check it.'],
    'verify.rwyUnknown': ['La pista {rwy} non risulta tra quelle degli aeroporti del volo ({list}): controlla.', 'Runway {rwy} isn\'t at your departure or arrival airport ({list}): check it.'],
    'verify.qnhDiff': ['QNH {qnh} diverso da quello del METAR ({metar}): controlla.', 'QNH {qnh} differs from the METAR ({metar}): check it.'],

    // ------------------------------------------------------------------ ascolto
    'listen.transcribing': ['Trascrivo…', 'Transcribing…'],
    'listen.ignoredNoise': ['Ignorato (rumore, non una chiamata): "{text}"', 'Ignored (noise, not a call): "{text}"'],
    'status.listening': ['In ascolto', 'Listening'],

    // ------------------------------------------------------------------ impostazioni
    'settings.resetConfirm': ['Ripristinare tutte le impostazioni? (la chiave Groq verrà cancellata)', 'Reset all settings? (your Groq key will be deleted)'],

    // ------------------------------------------------------------------ audio
    'audio.noSystemAudio': ['Nessun audio condiviso: scegli "Schermo intero" e spunta "Condividi audio di sistema".', 'No audio shared: pick "Entire screen" and tick "Share system audio".'],
  };

  const api = { STRINGS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Strings = api;
})(this);
