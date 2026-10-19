/* Screenshot dell'app per il sito (site/img) e per le schede degli store (docs/store), con dati di esempio.
   Uso: node scripts/screenshots.js [--lang it,en] [--only site|store]
   Serve Playwright con Chromium (npx playwright install chromium, oppure PW_CHROMIUM=percorso). */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const server = require('../electron/server.js');

const ROOT = path.join(__dirname, '..');
const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const LANGS = arg('lang', 'it,en').split(',');
const ONLY = arg('only', '');

// Schermi: sito (desktop e telefono) e misure richieste dagli store
const SITE = [
  { id: 'desktop', w: 1440, h: 900, scale: 1, scenes: ['map'] },
  { id: 'phone', w: 390, h: 844, scale: 2, scenes: ['atc', 'career', 'emergency', 'pc'] },
];
const STORE = [
  { id: 'ios-6.9', w: 430, h: 932, scale: 3 },   // 1290 × 2796
  { id: 'ios-6.5', w: 414, h: 896, scale: 3 },   // 1242 × 2688
  { id: 'ipad-13', w: 1032, h: 1376, scale: 2 }, // 2064 × 2752
  { id: 'android', w: 360, h: 640, scale: 3 },   // 1080 × 1920
].map((s) => ({ ...s, scenes: ['atc', 'career', 'emergency', 'pc'] }));

const ctl = (callsign, frequency, facility) => ({ callsign, frequency, facility, name: 'ATC', text_atis: [] });
const pilot = (callsign, lat, lon, alt, gs, hdg, dep, arr) => ({ callsign, latitude: lat, longitude: lon, altitude: alt, groundspeed: gs, heading: hdg, transponder: '2000', flight_plan: { departure: dep, arrival: arr, aircraft_short: 'A320', altitude: '36000' } });
const VATSIM = {
  pilots: [
    pilot('AZA123', 44.6, 10.9, 36000, 452, 318, 'LIRF', 'LIMC'), pilot('DLH4AB', 46.2, 11.8, 37000, 470, 20, 'LIRF', 'EDDM'),
    pilot('RYR82KP', 43.1, 12.6, 24000, 410, 140, 'LIMC', 'LIBD'), pilot('EZY51GV', 45.4, 8.9, 9000, 280, 200, 'LIMC', 'LEBL'),
    pilot('BAW561', 45.9, 7.2, 38000, 480, 300, 'LIRF', 'EGLL'), pilot('ITY321', 41.9, 12.3, 3000, 180, 160, 'LIMC', 'LIRF'),
  ],
  controllers: [ctl('LIRR_CTR', '125.500', 6), ctl('LIMM_CTR', '134.250', 6), ctl('LIMC_APP', '126.750', 5), ctl('LIMC_TWR', '119.000', 4), ctl('LIRF_TWR', '118.700', 4)],
  atis: [],
};

async function setup(page, lang) {
  await page.route('**/api/tile/**', (r) => r.fulfill({ status: 404 }));
  await page.route('**/api/proxy**', (route) => {
    const u = new URL(route.request().url()).searchParams.get('url') || '';
    if (u.includes('vatsim-data')) return route.fulfill({ json: VATSIM });
    if (u.includes('metar.vatsim.net')) return route.fulfill({ body: u.includes('LIMC') ? 'LIMC 191150Z 35006KT 9999 FEW040 16/08 Q1018 NOSIG' : 'LIRF 191150Z 24010KT CAVOK 21/11 Q1016 NOSIG', contentType: 'text/plain' });
    if (u.includes('api.ivao.aero')) return route.fulfill({ json: { clients: { pilots: [], atcs: [] } } });
    return route.fulfill({ status: 404, body: '' });
  });
  await page.addInitScript((l) => {
    localStorage.setItem('readback-copilot-settings', JSON.stringify({ callsign: 'AZA123', mode: 'free', onboarded: true, uiLang: l, beep: false, mapView: { c: [44.4, 10.6], z: 6 } }));
    localStorage.setItem('readback-copilot-flight', JSON.stringify({ source: 'manual', dep: 'LIRF', arr: 'LIMC', depName: 'Roma Fiumicino', arrName: 'Milano Malpensa', aircraft: 'A320', cruise: 360, pax: 162 }));
  }, lang);
}

async function scene(page, name, phone) {
  const go = async (tab) => { await page.evaluate((t) => { App.switchTab(t); if (App.setDetent) App.setDetent('full'); }, tab); await page.waitForTimeout(500); };
  if (name === 'map' || name === 'atc') {
    await go('listen');
    await page.evaluate(() => {
      const item = (text, ts) => ({ heard: text, origin: 'vpilot', ts, result: Readback.generateReadback(text, { callsign: App.callsignInfo() }), verify: { status: 'ok', reasons: [] } });
      App.showRemoteReadback(item('Alitalia 123, descend flight level 240, contact Milano Radar 134.25', Date.now() - 60000));
      App.showRemoteReadback(item('Alitalia 123, Milano Radar, radar contact, descend flight level 120, QNH 1018, direct TORLI', Date.now()));
    });
    if (phone) await page.evaluate(() => App.setDetent('half'));
    await page.waitForTimeout(800);
  }
  if (name === 'career') {
    await page.evaluate(() => {
      const now = Date.now(); const D = 86400000;
      let s = Career.empty();
      const aps = ['LIRF', 'LIMC', 'EGLL', 'EDDF', 'LFPG', 'LEMD', 'LIPZ', 'LICC', 'EHAM', 'LSZH', 'LOWW'];
      for (let d = 34; d >= 0; d--) {
        const t = now - d * D;
        if (d % 2 === 0) s = Career.add(s, { type: 'flight', id: `h${d}`, t, v: { min: 75 + (d % 5) * 20, dep: aps[d % aps.length], arr: aps[(d + 3) % aps.length] } }, t).state;
        for (let i = 0; i < 3; i++) s = Career.add(s, { type: 'train', t: t + i, v: { score: Math.min(100, 62 + (34 - d) + i * 4) } }, t).state;
        for (let i = 0; i < 6; i++) s = Career.add(s, { type: 'radio', t: t + 10 + i, v: { verified: (i + d) % 7 !== 0 } }, t).state;
        if (d % 3 === 0) s = Career.add(s, { type: 'landing', t: t + 99, v: { fpm: 50 + (d % 4) * 40, score: 88 } }, t).state;
      }
      App.career.merge(s);
    });
    await go('career');
  }
  if (name === 'emergency') {
    await go('listen');
    await page.evaluate(() => {
      App.setFlight({ source: 'manual', dep: 'LIRF', arr: 'LIMC', aircraft: 'A320', cruise: 360, pax: 162, altn: 'LIML', fuelPlan: { flow: 2400, takeoff: 9000, landing: 3500 } });
      App.track = { pos: { lat: 43.95, lon: 11.55 }, alt: 23960, vs: -1800, heading: 318, phase: 'descent', gs: 420, remaining: 120 };
      App.openEmergency();
    });
    await page.fill('#emStation', 'Roma Radar');
    await page.selectOption('#emIntent', 'divert');
    await page.waitForTimeout(500);
  }
  if (name === 'pc') {
    // pagina "Collega al PC" con il PC collegato (dati simulati)
    await page.evaluate(() => {
      App.set('linkHost', '192.168.1.20:47810'); App.set('linkToken', 'DEMO');
      document.getElementById('pcPair').hidden = true; document.getElementById('pcLive').hidden = false;
      const st = document.getElementById('pcState'); st.className = 'badge ok'; st.textContent = App.t('link.on', { name: 'PC-SIM' });
      document.getElementById('pcNext').hidden = false;
      document.getElementById('pcNextText').textContent = 'Milano Radar, Alitalia 123, FL120, information Kilo';
      document.getElementById('pcNextFreq').textContent = 'Milano Radar 134.25';
      document.getElementById('pcListen').classList.add('on');
      document.getElementById('pcListen').querySelector('span').textContent = App.t('link.stopListen');
    });
    await go('pc');
  }
}

async function main() {
  const { server: srv, port } = await server.start(ROOT, { version: 'shots', ports: [0], cacheDir: fs.mkdtempSync(path.join(os.tmpdir(), 'rc-shots-')) });
  const browser = await chromium.launch({ executablePath: process.env.PW_CHROMIUM || undefined });
  const jobs = [];
  if (ONLY !== 'store') for (const s of SITE) jobs.push({ ...s, dir: path.join(ROOT, 'site', 'img') });
  if (ONLY !== 'site') for (const s of STORE) jobs.push({ ...s, dir: path.join(ROOT, 'docs', 'store', s.id) });
  for (const lang of LANGS) {
    for (const job of jobs) {
      fs.mkdirSync(job.dir, { recursive: true });
      for (const [i, name] of job.scenes.entries()) {
        const ctx = await browser.newContext({ locale: lang, viewport: { width: job.w, height: job.h }, deviceScaleFactor: job.scale, colorScheme: i % 2 ? 'light' : 'dark', isMobile: job.w < 900, hasTouch: job.w < 900 });
        const page = await ctx.newPage();
        await setup(page, lang);
        await page.goto(`http://127.0.0.1:${port}/`);
        await page.waitForFunction(() => window.App && App.career && App.showRemoteReadback);
        await page.waitForTimeout(1200);
        await scene(page, name, job.w < 900);
        const file = job.id === 'desktop' || job.id === 'phone' ? `${lang}-${job.id}-${name}.jpg` : `${lang}-${i + 1}-${name}.jpg`;
        await page.screenshot({ path: path.join(job.dir, file), type: 'jpeg', quality: 86 });
        await ctx.close();
        console.log(`${job.id}/${file}`);
      }
    }
  }
  await browser.close();
  srv.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
