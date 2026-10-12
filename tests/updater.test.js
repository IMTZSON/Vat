const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('events');
const { createUpdater } = require('../electron/updater.js');

function fakeAutoUpdater() {
  const au = new EventEmitter();
  au.checks = 0;
  au.installed = null;
  au.checkForUpdates = async () => { au.checks++; au.emit('checking-for-update'); };
  au.quitAndInstall = (silent, run) => { au.installed = { silent, run }; };
  return au;
}

test('aggiornamento: scarica in background, installa solo quando l\'utente lo chiede', async () => {
  const au = fakeAutoUpdater();
  const states = [];
  const u = createUpdater({ autoUpdater: au, supported: true, send: (s) => states.push(s.state) });
  assert.strictEqual(au.autoDownload, true);
  assert.strictEqual(au.autoInstallOnAppQuit, true);
  assert.strictEqual(u.install(), false, 'niente da installare');
  await u.check();
  au.emit('update-available', { version: '4.0.20' });
  au.emit('download-progress', { percent: 41.6 });
  assert.deepStrictEqual(u.state, { state: 'downloading', version: '4.0.20', percent: 42 });
  await u.check();
  assert.strictEqual(au.checks, 1, 'nessun nuovo controllo mentre scarica');
  au.emit('update-downloaded', { version: '4.0.20' });
  assert.strictEqual(u.state.state, 'ready');
  assert.strictEqual(au.installed, null, 'mai un riavvio a sorpresa');
  assert.strictEqual(u.install(), true);
  assert.deepStrictEqual(au.installed, { silent: true, run: true });
  assert.deepStrictEqual(states, ['checking', 'downloading', 'downloading', 'ready']);
});

test('aggiornamento: errori riportati, versione portatile non supportata', async () => {
  const au = fakeAutoUpdater();
  au.checkForUpdates = async () => { throw new Error('net::ERR_INTERNET_DISCONNECTED'); };
  const u = createUpdater({ autoUpdater: au, supported: true, send: () => {} });
  await u.check();
  assert.strictEqual(u.state.state, 'error');
  assert.match(u.state.message, /DISCONNECTED/);
  const p = createUpdater({ autoUpdater: null, supported: false, send: () => {} });
  assert.strictEqual(p.supported, false);
  assert.strictEqual(p.state.state, 'unsupported');
  assert.strictEqual(p.install(), false);
});
