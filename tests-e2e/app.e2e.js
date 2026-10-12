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

test('app nel browser: telefono, tema chiaro, italiano', { skip: !chromium && 'playwright non installato', timeout: 60000 }, async (t) => {
  const { server: srv, port } = await server.start(ROOT, { version: 'e2e', ports: [0] });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  t.after(async () => { await browser.close(); srv.close(); });
  const page = await (await browser.newContext({ locale: 'it-IT', viewport: { width: 390, height: 844 }, colorScheme: 'light' })).newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await mockNetwork(page, { stt: 0 });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('#onboard[open]');
  await page.click('#obClose');
  await page.waitForFunction(() => !document.getElementById('onboard').open);
  // Nessuno scroll orizzontale e tab bar visibile
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  assert.strictEqual(overflow, false);
  assert.ok(await page.isVisible('.tabbar'));
  for (const tab of ['flight', 'cabin', 'cockpit', 'more']) {
    await page.click(`.tab[data-tab="${tab}"]`);
    await page.waitForTimeout(150);
  }
  assert.strictEqual(await page.textContent('#topTitle'), 'Altro');
  assert.deepStrictEqual(errors, []);
});
