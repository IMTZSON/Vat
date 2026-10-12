/* Test end-to-end nel browser (Chromium via Playwright): l'app vera servita dal server locale,
   con Groq/VATSIM/GitHub simulati e un microfono finto che riproduce un WAV.
   Uso: npm run test:e2e   (CI: npx playwright install chromium; in locale PW_CHROMIUM=percorso opzionale) */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { chromium = null; }

const ROOT = path.join(__dirname, '..');
const server = require('../electron/server.js');
const { Store } = require('../electron/store.js');
const { encodeWav } = require('../js/audio.js');

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a1ff0000000049454e44ae426082', 'hex');

// "Voce" sintetica: 1,5 s di silenzio, 2 s di tono modulato, 2,5 s di silenzio (ripetuto dal browser)
async function fakeWav(dir) {
  const rate = 48000;
  const a = new Float32Array(rate * 6);
  for (let i = 0; i < a.length; i++) {
    const t = i / rate;
    a[i] = (Math.random() * 2 - 1) * 0.003 + (t > 1.5 && t < 3.5 ? 0.4 * Math.sin(2 * Math.PI * 440 * t) * (0.6 + 0.4 * Math.sin(2 * Math.PI * 3 * t)) : 0);
  }
  const file = path.join(dir, 'atc.wav');
  const wav = encodeWav(a, rate);
  fs.writeFileSync(file, Buffer.from(wav instanceof ArrayBuffer ? wav : await wav.arrayBuffer()));
  return file;
}

// TAF valido da adesso per 24 ore, con un temporale temporaneo tra 2 e 6 ore
function tafNow(icao) {
  const p2 = (n) => String(n).padStart(2, '0');
  const dh = (h) => { const d = new Date(Date.now() + h * 3600e3); return `${p2(d.getUTCDate())}${p2(d.getUTCHours())}`; };
  return `TAF ${icao} ${dh(0)}00Z ${dh(0)}/${dh(24)} 22008KT 9999 FEW030 TEMPO ${dh(2)}/${dh(6)} 3000 TSRA BKN015CB BECMG ${dh(8)}/${dh(10)} VRB03KT CAVOK=`;
}

// Groq, VATSIM, GitHub e mappe finti
async function mockNetwork(page, state) {
  await page.route('**/api/tile/**', (route) => route.fulfill({ body: PNG, contentType: 'image/png' }));
  await page.route('**/api/proxy**', async (route) => {
    const req = route.request();
    if (req.headers()['x-readback-copilot'] !== '1') return route.fulfill({ status: 403, body: 'missing header' });
    const u = new URL(req.url()).searchParams.get('url');
    if (u.endsWith('/models')) return route.fulfill({ json: { data: [{ id: 'whisper-large-v3-turbo' }, { id: 'openai/gpt-oss-120b' }] } });
    if (u.includes('/audio/transcriptions')) {
      // 1ª richiesta = l'ATC; poi: con nomi di stazioni nel prompt = l'ATC che risente (rumore), senza = il pilota (coach)
      const body = req.postDataBuffer().toString('latin1');
      const atc = /London (Control|Tower)/.test(body);
      const n = state.stt++;
      const text = n === 0 ? state.atc : (atc ? 'Thank you.' : state.pilot);
      return route.fulfill({ json: { text, segments: [{ avg_logprob: -0.2, no_speech_prob: 0.01, compression_ratio: 1.2 }] } });
    }
    if (u.includes('/chat/completions')) return route.fulfill({ json: { choices: [{ message: { content: JSON.stringify({ for_us: true, readback: state.ai, spoken: 'descend flight level eight zero', note: '' }) } }] } });
    if (u.includes('vatsim-data.json')) return route.fulfill({ json: { controllers: [{ callsign: 'LON_S_CTR', facility: 6, frequency: '127.100' }, { callsign: 'EGLL_TWR', facility: 4, frequency: '118.500' }], atis: [], pilots: [] } });
    if (u.includes('metar.vatsim.net')) return route.fulfill({ body: 'EGLL 121250Z 24008KT 9999 FEW030 18/10 Q1013 NOSIG', contentType: 'text/plain' });
    if (u.includes('api.github.com')) return route.fulfill({ json: [] });
    if (u.includes('api.ivao.aero')) return route.fulfill({ json: { clients: { pilots: [], atcs: [] } } });
    if (u.includes('aviationweather.gov')) return route.fulfill({ body: tafNow(u.match(/ids=(\w+)/)[1]), contentType: 'text/plain' });
    return route.fulfill({ status: 404, body: 'not mocked' });
  });
}

test('app nel browser: onboarding, lingua, ascolto, verifiche e coach', { skip: !chromium && 'playwright non installato', timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-e2e-'));
  const store = new Store(path.join(dir, 'data.json'));
  const { server: srv, port } = await server.start(ROOT, { version: 'e2e', ports: [0], store });
  const wav = await fakeWav(dir);
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
  });
  t.after(async () => { await browser.close(); srv.close(); });

  const ctx = await browser.newContext({ locale: 'it-IT', viewport: { width: 1280, height: 820 }, colorScheme: 'dark' });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const state = { stt: 0, atc: 'Speedbird 123, descend flight level 80, turn left heading 270, contact London Control 127.1', pilot: 'Descend flight level 80, left heading 270, Speedbird 123', ai: 'Descend FL80, left heading 270, London Control 127.1, Speedbird 123' };
  await mockNetwork(page, state);

  await page.goto(`http://127.0.0.1:${port}/`);
  // 1. Primo avvio: configurazione guidata in italiano
  await page.waitForSelector('#onboard[open]');
  assert.strictEqual(await page.textContent('#obTitle'), 'Il tuo copilota radio');
  assert.strictEqual(await page.evaluate(() => App.storage.backend), 'server', 'Chrome usa l\'archivio su file del programma');

  // 2. Passo all'inglese: la pagina si ricarica e riprende dal nominativo
  await page.click('#obLang [data-lang="en"]');
  await page.waitForSelector('#onboard[open] [data-step="callsign"]:not([hidden])');
  assert.strictEqual(await page.getAttribute('html', 'lang'), 'en');
  await page.fill('#obCallsign', 'BAW123');
  assert.strictEqual(await page.textContent('#obCsHint'), 'ATC calls you "Speedbird 123"');
  await page.click('#obNext');

  // 3. Groq: chiave verificata
  await page.fill('#obKey', 'gsk_e2e');
  await page.click('#obTest');
  await page.waitForSelector('#obSttMsg.good');
  await page.click('#obNext');

  // 4. Audio: la prova sente il microfono finto e lo trascrive
  await page.click('#obSource [data-source="device"]');
  state.stt = 0;
  await page.click('#obAudioTest');
  await page.waitForFunction(() => /I heard/.test(document.getElementById('obAudioMsg').textContent), null, { timeout: 15000 });
  await page.click('#obAudioTest');
  await page.click('#obNext');
  assert.match(await page.textContent('#obSummary'), /Speedbird 123/);
  await page.click('#obNext');
  await page.waitForFunction(() => !document.getElementById('onboard').open);

  // Impostazioni salvate nel file del programma
  await page.waitForTimeout(500);
  store.flush();
  const saved = JSON.parse(fs.readFileSync(path.join(dir, 'data.json'), 'utf8'))['readback-copilot-settings'];
  assert.strictEqual(saved.callsign, 'BAW123');
  assert.strictEqual(saved.groqKey, 'gsk_e2e');
  assert.strictEqual(saved.uiLang, 'en');
  assert.strictEqual(saved.onboarded, true);

  // 5. Ascolto reale (volo Heathrow → Fiumicino, coach attivo)
  await page.evaluate(() => { App.set('coach', true); App.setFlight({ source: 'manual', dep: 'EGLL', arr: 'LIRF', depName: 'London Heathrow', arrName: 'Rome Fiumicino' }); });
  // ATC dal cavo virtuale (un dispositivo specifico), coach dal microfono predefinito
  await page.evaluate(async () => {
    const d = (await navigator.mediaDevices.enumerateDevices()).find((x) => x.kind === 'audioinput' && x.deviceId && x.deviceId !== 'default');
    App.set('device', d.deviceId);
  });
  await page.waitForTimeout(600);
  state.stt = 0;
  await page.click('#toggle');
  await page.waitForFunction(() => /Speedbird 123/.test(document.getElementById('readback').textContent), null, { timeout: 15000 });
  await page.waitForFunction(() => /✅/.test(document.getElementById('verify').textContent), null, { timeout: 10000 });
  assert.strictEqual(await page.textContent('#readback'), state.ai);
  assert.strictEqual(await page.$$eval('#warnings li', (l) => l.length), 0, 'nessun falso avviso sulla frequenza di LON_S_CTR');
  // Coach: il pilota ha dimenticato la frequenza → 75%
  await page.waitForFunction(() => /75%/.test(document.getElementById('coachBadge').textContent), null, { timeout: 20000 });
  assert.match(await page.textContent('#coachOut'), /Frequency: London Control 127\.1/);
  await page.click('#toggle');

  // 6. Prova scritta, senza rete
  await page.fill('#tryText', 'Speedbird 123, squawk 4891');
  await page.click('#tryBtn');
  await page.waitForFunction(() => /not valid/.test(document.getElementById('warnings').textContent));

  // 7. Volo: dati mondiali e METAR in inglese
  await page.click('.tab[data-tab="flight"]');
  await page.click('#wxRefresh');
  await page.waitForFunction(() => /QNH: 1013 hPa/.test(document.getElementById('apDep').textContent), null, { timeout: 10000 });
  assert.match(await page.textContent('#apDep'), /London Heathrow/);
  assert.match(await page.textContent('#myCalls'), /London Delivery, Speedbird 123/);

  const real = errors.filter((e) => !/favicon/.test(e));
  assert.deepStrictEqual(real, [], 'errori nella console');
});

test('app nel browser: telefono, tema chiaro, utente della 3.x', { skip: !chromium && 'playwright non installato', timeout: 60000 }, async (t) => {
  const { server: srv, port } = await server.start(ROOT, { version: 'e2e', ports: [0] });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  t.after(async () => { await browser.close(); srv.close(); });
  // Windows in inglese, ma impostazioni salvate da una versione precedente (solo italiano): resta in italiano
  const ctx = await browser.newContext({ locale: 'en-US', viewport: { width: 390, height: 844 }, colorScheme: 'light' });
  await ctx.addInitScript(() => { if (!localStorage.getItem('readback-copilot-settings')) localStorage.setItem('readback-copilot-settings', JSON.stringify({ callsign: 'AZA123', mode: 'free' })); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockNetwork(page, { stt: 0 });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.App && App.settings.onboarded === true);
  assert.strictEqual(await page.getAttribute('html', 'lang'), 'it');
  assert.strictEqual(await page.evaluate(() => document.getElementById('onboard').open), false, 'già configurato: niente configurazione guidata');
  assert.match(await page.textContent('#csHint'), /Alitalia 123/);
  // Nessuno scroll orizzontale e tab bar visibile
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.strictEqual(overflow, false);
  assert.ok(await page.isVisible('.tabbar'));
  for (const tab of ['flight', 'cabin', 'cockpit', 'more']) {
    await page.click(`.tab[data-tab="${tab}"]`);
    await page.waitForTimeout(150);
  }
  assert.strictEqual(await page.textContent('#topTitle'), 'Altro');

  // Meteo con previsione TAF: striscia oraria, condizioni all'arrivo, TAF decodificato
  await page.evaluate(() => App.setFlight({ callsign: 'AZA123', dep: 'LIRF', arr: 'EGLL', source: 'test', out: Math.round(Date.now() / 1000) + 1800, ete: 3 * 3600 }));
  await page.click('.tab[data-tab="flight"]');
  await page.click('#wxRefresh');
  await page.waitForSelector('#apArr .fc-strip .fc-chip');
  const fc = await page.evaluate(() => ({
    chips: document.querySelectorAll('#apArr .fc-chip').length,
    ref: document.querySelectorAll('#apArr .fc-chip.ref').length,
    key: document.querySelector('#apArr .fc-key').textContent.replace(/\s+/g, ' '),
    tempoDot: document.querySelectorAll('#apDep .fc-chip .dot').length,
    lines: document.querySelectorAll('#apArr .fcLines li').length,
    overflow: document.documentElement.scrollWidth > window.innerWidth,
  }));
  assert.ok(fc.chips >= 6, `chip orari: ${fc.chips}`);
  assert.strictEqual(fc.ref, 1, "l'ora dell'arrivo è evidenziata");
  assert.match(fc.key, /All'arrivo/);
  assert.ok(fc.tempoDot >= 1, 'il temporale temporaneo è segnalato');
  assert.strictEqual(fc.lines, 3);
  assert.strictEqual(fc.overflow, false);
  assert.deepStrictEqual(errors, []);
});

test('programma per Windows (ponte simulato): coach col PTT, tasto PTT, aggiornamento in un clic', { skip: !chromium && 'playwright non installato', timeout: 120000 }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rc-e2e-'));
  const { server: srv, port } = await server.start(ROOT, { version: 'e2e', ports: [0] });
  const wav = await fakeWav(dir);
  const browser = await chromium.launch({
    executablePath: process.env.PW_CHROMIUM || undefined,
    args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream', `--use-file-for-fake-audio-capture=${wav}`, '--autoplay-policy=no-user-gesture-required'],
  });
  t.after(async () => { await browser.close(); srv.close(); });
  const ctx = await browser.newContext({ locale: 'en-GB', viewport: { width: 1280, height: 820 } });
  // Il ponte che electron/preload.js espone nel programma vero
  await ctx.addInitScript(() => {
    window.__store = {};
    window.desktop = {
      setOnTop() {}, setCompact() {}, openExternal() {}, saveText: async () => true, onHotkey() {},
      info: async () => ({ version: '4.0.5', build: 5, origin: location.origin }),
      store: {
        load: async () => ({ isNew: false, data: { 'readback-copilot-settings': { callsign: 'BAW123', groqKey: 'gsk_e2e', mode: 'groq', onboarded: true, uiLang: 'en', coach: true, audioSource: 'device', pttKey: { kind: 'key', code: 58, label: 'CapsLock' } } } }),
        set: (k, v) => { window.__store[k] = v; },
        merge: async () => 0,
      },
      ptt: {
        available: async () => true,
        set: async (b) => { window.__pttBinding = b; return b; },
        capture: async () => ({ kind: 'key', code: 29, label: 'Ctrl' }),
        onChange: (fn) => { window.__ptt = fn; },
      },
      updater: {
        state: async () => ({ state: 'idle', supported: true }),
        check: async () => {
          setTimeout(() => window.__upd({ state: 'downloading', version: '4.0.9', percent: 30 }), 50);
          setTimeout(() => window.__upd({ state: 'ready', version: '4.0.9', percent: 100 }), 300);
        },
        install: async () => { window.__installed = true; return true; },
        onState: (fn) => { window.__upd = fn; },
      },
    };
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('dialog', (d) => d.accept());
  const state = { stt: 0, atc: 'Speedbird 123, descend flight level 80, turn left heading 270, contact London Control 127.1', pilot: 'Descend flight level 80, left heading 270, London Control 127.1, Speedbird 123', ai: 'Descend FL80, left heading 270, London Control 127.1, Speedbird 123' };
  await mockNetwork(page, state);
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.App && App.pttAvailable === true);
  assert.strictEqual(await page.evaluate(() => App.storage.backend), 'file');
  assert.deepStrictEqual(await page.evaluate(() => window.__pttBinding), { kind: 'key', code: 58, label: 'CapsLock' }, 'il tasto salvato viene riattivato all\'avvio');

  // Impostazioni: il tasto PTT si cattura premendolo
  await page.click('.tab[data-tab="more"]');
  await page.click('[data-go="settings"]');
  assert.ok(await page.isVisible('#pttLabel'));
  assert.strictEqual(await page.textContent('#pttLabel'), 'CapsLock');
  await page.click('#pttSet');
  await page.waitForFunction(() => document.getElementById('pttLabel').textContent === 'Ctrl');
  await page.waitForFunction(() => window.__store['readback-copilot-settings'] && window.__store['readback-copilot-settings'].pttKey.label === 'Ctrl');

  // Ascolto: chiamata per me, il coach aspetta il PTT
  await page.click('.tab[data-tab="listen"]');
  await page.evaluate(async () => {
    App.setFlight({ source: 'manual', dep: 'EGLL', arr: 'LIRF', depName: 'London Heathrow', arrName: 'Rome Fiumicino' });
    const d = (await navigator.mediaDevices.enumerateDevices()).find((x) => x.kind === 'audioinput' && x.deviceId && x.deviceId !== 'default');
    App.set('device', d.deviceId);
  });
  await page.waitForTimeout(500);
  state.stt = 0;
  await page.click('#toggle');
  await page.waitForFunction(() => /Press PTT/.test(document.getElementById('coachBadge').textContent), null, { timeout: 20000 });
  // Trasmetto per 1,5 s
  await page.evaluate(() => window.__ptt(true));
  assert.ok(await page.isVisible('#txBadge'), 'indicatore TX acceso');
  await page.waitForTimeout(1500);
  await page.evaluate(() => window.__ptt(false));
  assert.ok(!(await page.isVisible('#txBadge')));
  await page.waitForFunction(() => /100%/.test(document.getElementById('coachBadge').textContent), null, { timeout: 15000 });
  assert.match(await page.textContent('#coachOut'), /Perfect/);

  // Aggiornamento: scarica in background, poi "Restart and update" (con conferma, perché sto ascoltando)
  await page.waitForFunction(() => /is ready/.test(document.getElementById('updateText').textContent), null, { timeout: 15000 });
  assert.strictEqual(await page.textContent('#updateGet'), 'Restart and update');
  await page.click('#updateGet');
  await page.waitForFunction(() => window.__installed === true);
  await page.click('#toggle');
  assert.deepStrictEqual(errors, []);
});

test('mappa radar: settori reali, traffico VATSIM e IVAO, filtri, ricerca e clic su un aereo', { skip: !chromium && 'playwright non installato', timeout: 90000 }, async (t) => {
  const { server: srv, port } = await server.start(ROOT, { version: 'e2e', ports: [0], cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rc-map-')), mapTimeout: 1 });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  t.after(async () => { await browser.close(); srv.close(); });
  const ctx = await browser.newContext({ locale: 'en-GB', viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => localStorage.setItem('readback-copilot-settings', JSON.stringify({ callsign: 'AZA123', onboarded: true, uiLang: 'en', mapView: { c: [47, 6], z: 5 } })));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const ctl = (callsign, frequency) => ({ callsign, frequency, facility: 6, name: 'ATC', text_atis: ['Hello'] });
  const pilot = (callsign, lat, lon, alt, gs) => ({ callsign, latitude: lat, longitude: lon, altitude: alt, groundspeed: gs, heading: 90, transponder: '2000', flight_plan: { departure: 'LIRF', arrival: 'EGLL', aircraft_short: 'A320', altitude: '36000' } });
  const vat = { pilots: [pilot('BAW1', 50.5, 0.5, 30000, 450), pilot('DLH2', 50.1, 8.6, 300, 10), pilot('AZA123', 45, 9, 36000, 450)], controllers: [ctl('LON_S_CTR', '129.425'), ctl('EGLL_N_APP', '119.725'), ctl('LIRF_TWR', '118.700'), ctl('LIRF_GND', '121.800'), ctl('LIRF_OBS', '199.998')], atis: [] };
  const iv = { clients: { pilots: [{ callsign: 'IVA9', lastTrack: { latitude: 46.2, longitude: 6.6, altitude: 20000, groundSpeed: 400, heading: 180 } }], atcs: [{ callsign: 'PAR_CTR', atcSession: { frequency: 128.1 } }] } };
  await page.route('**/api/tile/**', (r) => r.fulfill({ status: 404 }));
  await page.route('**/api/proxy**', (route) => {
    const u = new URL(route.request().url()).searchParams.get('url');
    if (u.includes('vatsim-data')) return route.fulfill({ json: vat });
    if (u.includes('ivao')) return route.fulfill({ json: iv });
    return route.fulfill({ json: [] });
  });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForFunction(() => window.App && App.sectors && App.radar && App.radar.visiblePilots().length === 3, null, { timeout: 20000 }).catch(async (e) => {
    console.log(await page.evaluate(() => ({ sectors: !!(window.App && App.sectors), pilots: window.App && App.radar && App.radar.visiblePilots().map((p) => p.callsign), nets: window.App && App.radar && Object.keys(App.radar.nets).map((k) => [k, !!App.radar.nets[k]]) })), errors);
    throw e;
  });
  // Il mio aereo (AZA123) lo disegna tracking.js: non è doppio
  assert.deepStrictEqual(await page.evaluate(() => App.radar.visiblePilots().map((p) => p.callsign).sort()), ['BAW1', 'DLH2', 'IVA9']);
  // Settori: FIR di Londra Sud, TRACON di Heathrow, Parigi (IVAO); Fiumicino come lettere T G, nessun cerchio
  const labels = await page.$$eval('.sector-label span', (els) => els.map((e) => e.textContent).sort());
  assert.deepStrictEqual(labels, ['EGLL_N', 'LON_S', 'PAR']);
  assert.match(await page.textContent('.apt-badge'), /LIRF.*G.*T/);
  // Filtri
  await page.click('#mapLayers');
  await page.click('.net-chip[data-net="ivao"]');
  await page.waitForFunction(() => App.radar.visiblePilots().length === 2);
  assert.deepStrictEqual(await page.$$eval('.sector-label span', (els) => els.map((e) => e.textContent).sort()), ['EGLL_N', 'LON_S']);
  await page.click('.net-chip[data-net="ivao"]');
  await page.click('#radarPhase + .segmented button[data-value="air"]');
  await page.waitForFunction(() => App.radar.visiblePilots().every((p) => p.gs >= 50));
  // Ricerca e "segui"
  await page.fill('#radarSearch', 'baw');
  await page.click('#radarResults li');
  await page.waitForSelector('.radar-popup .pop-title', { timeout: 5000 });
  assert.match(await page.textContent('.radar-popup .pop-title'), /BAW1/);
  // Clic diretto su un aereo
  await page.click('#radarClose');
  await page.evaluate(() => { App.map.closePopup(); App.map.setView([46.2, 7.6], 7, { animate: false }); });
  await page.waitForTimeout(300);
  const pt = await page.evaluate(() => { const p = App.radar.visiblePilots().find((x) => x.callsign === 'IVA9'); const c = App.map.latLngToContainerPoint([p.lat, p.lon]); return { x: c.x, y: c.y }; });
  await page.mouse.click(pt.x, pt.y);
  await page.waitForFunction(() => /IVA9/.test((document.querySelector('.radar-popup .pop-title') || {}).textContent || ''));
  // Impostazioni ricordate
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('readback-copilot-settings')).radar);
  assert.strictEqual(saved.phase, 'air');
  assert.deepStrictEqual(errors, []);
});
