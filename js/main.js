/* Avvio dell'applicazione. */
(async function () {
  'use strict';
  const App = window.App;
  await Promise.all([window.Net.init(), window.World.load(), App.load()]);
  // Nel programma per Windows la modalità predefinita è Groq (il riconoscimento di Chrome non funziona lì).
  if (window.Net.desktop && !App.storedKeys.includes('mode')) App.settings.mode = 'groq';
  await App.start();
})();
