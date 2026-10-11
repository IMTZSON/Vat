/* Avvio dell'applicazione. */
(async function () {
  'use strict';
  await window.Net.init();
  const App = window.App;
  // Nel programma per Windows la modalità predefinita è Groq (il riconoscimento di Chrome non funziona lì).
  if (window.Net.desktop && !App.storedKeys.includes('mode')) App.settings.mode = 'groq';
  await App.start();
})();
