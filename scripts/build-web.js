/* Prepara www/ per l'app iOS/Android (Capacitor): copia l'app web, aggiunge Capacitor e i plugin
   (versioni IIFE, niente bundler) e la configurazione inclusa (indirizzo delle statistiche, versione).
   Uso: node scripts/build-web.js   (poi: npx cap sync) */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'www');
const pkg = require('../package.json');

// Plugin nell'ordine di caricamento: [file in node_modules, nome in www/js/cap/]
const CAP = [
  ['@capacitor/core/dist/capacitor.js', 'capacitor.js'],
  ['@capacitor/synapse/dist/synapse.js', 'synapse.js'],
  ['@capacitor/preferences/dist/plugin.js', 'preferences.js'],
  ['@capacitor/share/dist/plugin.js', 'share.js'],
  ['@capacitor/filesystem/dist/plugin.js', 'filesystem.js'],
  ['@capacitor/status-bar/dist/plugin.js', 'status-bar.js'],
  ['@capacitor/splash-screen/dist/plugin.js', 'splash-screen.js'],
  ['@capacitor/haptics/dist/plugin.js', 'haptics.js'],
  ['@capacitor-community/text-to-speech/dist/plugin.js', 'text-to-speech.js'],
  ['@capacitor-community/speech-recognition/dist/plugin.js', 'speech-recognition.js'],
  ['@capacitor-community/keep-awake/dist/plugin.js', 'keep-awake.js'],
  ['@capacitor-mlkit/barcode-scanning/dist/plugin.js', 'barcode-scanning.js'],
];

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) copyDir(a, b);
    else fs.copyFileSync(a, b);
  }
}

function build() {
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });
  for (const d of ['css', 'js', 'data']) copyDir(path.join(ROOT, d), path.join(OUT, d));
  fs.mkdirSync(path.join(OUT, 'js', 'cap'), { recursive: true });
  const tags = [];
  for (const [src, name] of CAP) {
    fs.copyFileSync(path.join(ROOT, 'node_modules', src), path.join(OUT, 'js', 'cap', name));
    tags.push(`  <script src="js/cap/${name}"></script>`);
    // il plugin Filesystem cerca la libreria "synapse" con questo nome
    if (name === 'synapse.js') {
      fs.writeFileSync(path.join(OUT, 'js', 'cap', 'synapse-name.js'), 'window.synapse = window.synapse || window.outsystemsSynapse;\n');
      tags.push('  <script src="js/cap/synapse-name.js"></script>');
    }
  }
  // Configurazione inclusa: niente Pro dentro l'app (regole degli store sugli acquisti), statistiche se configurate
  const config = { mobile: true, version: pkg.version, telemetry: pkg.telemetry || '' };
  fs.writeFileSync(path.join(OUT, 'js', 'config.js'), `window.RC_CONFIG = ${JSON.stringify(config)};\n`);
  let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const anchor = '  <script src="js/vendor/leaflet.js"></script>';
  if (!html.includes(anchor)) throw new Error('index.html: punto di inserimento non trovato');
  html = html.replace(anchor, `  <script src="js/config.js"></script>\n${tags.join('\n')}\n${anchor}`);
  // Nel telefono le richieste vanno dirette (Overpass, PC di casa in http, statistiche): connect-src aperto
  html = html.replace(/connect-src [^;]+;/, 'connect-src * data: blob:;');
  fs.writeFileSync(path.join(OUT, 'index.html'), html);
  return { files: CAP.length };
}

module.exports = { build, CAP };
if (require.main === module) {
  const r = build();
  console.log(`www/ pronto (${r.files} file di Capacitor)`);
}
