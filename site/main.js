/* Sito: lingua (italiano / inglese), link all'ultima versione su GitHub, prezzi e store da config.js. */
(function () {
  'use strict';

  const EN = {
    'nav.features': 'Features', 'nav.phone': 'Phone', 'nav.pricing': 'Pricing', 'nav.faq': 'FAQ', 'nav.download': 'Download',
    'hero.pill': 'For virtual pilots on VATSIM',
    'hero.title': 'Your radio copilot.<br>Always know what to say.',
    'hero.lead': 'Readback Copilot listens to ATC and instantly shows you, in big letters, what to read back, with ICAO pronunciation, checking every number. It trains you with simulated ATC and helps you from taxi to touchdown, on your PC and your phone.',
    'cta.windows': 'Download for Windows', 'cta.apk': 'Android (APK)',
    'hero.fine': 'Free · Italiano, English, Español, Deutsch, Français, Português · No account',
    'feat.title': 'Everything you need on the radio, and more',
    'f1.t': 'Real-time readbacks', 'f1.d': 'ATC speaks, you read the correct reply with ICAO pronunciation. Every number is checked against online controllers, runways and METAR.',
    'f2.t': 'Readback coach', 'f2.d': 'Listens to what you actually say on the radio (with your PTT key or joystick button too) and tells you what you missed.',
    'f3.t': 'Flight rehearsal', 'f3.d': 'Every call of your real flight, with real frequencies, QNH, fixes and taxiways, before you go online. With a final score.',
    'f4.t': 'Taxi and landing', 'f4.d': 'Your taxi route drawn on the airport map, and your landing scored in ft/min from the simulator.',
    'f5.t': 'Simulator link', 'f5.d': 'Reads transponder, radios, altimeter and autopilot from MSFS and X-Plane, and warns you when an instruction wasn\'t followed.',
    'f6.t': 'Live radar map', 'f6.d': 'VATSIM and IVAO traffic, controllers on their real sectors, weather with forecast, your flight tracked with Top of Descent.',
    'f7.t': 'Career and goals', 'f7.d': 'From Student pilot to Training Captain: XP, badges, daily challenges and weekly progress.',
    'f8.t': 'Emergency helper', 'f8.d': 'MAYDAY and PAN PAN pre-filled in ICAO order with position, level and endurance, plus the ATC replies.',
    'how.title': 'Ready in two minutes',
    's1.t': 'Install and enter your callsign', 's1.d': 'The guided setup walks you through it.',
    's2.t': 'Let it hear vPilot', 's2.d': 'PC audio or VB-Cable, with a live audio test.',
    's3.t': 'Fly', 's3.d': 'Load your SimBrief plan and press the mic when you\'re online.',
    'phone.title': 'Your phone becomes your second screen',
    'phone.lead': 'Scan the QR code in the PC app: your phone shows live readbacks, the next call and simulator data, and controls listening without taking your hands off the controls. Home network only, no external servers.',
    'phone.l1': 'Works on its own too: flight plan, weather, map, voice training, checklists, career',
    'phone.l2': 'Career and logbook synced between PC and phone',
    'phone.l3': 'The taxi route on your phone\'s map',
    'price.title': 'Simple pricing',
    'free.t': 'Free', 'free.l1': 'Verified readbacks, map, weather, checklists', 'free.l2': 'Training, rehearsal, coach, career', 'free.l3': 'Phone app and PC link', 'free.l4': 'With your free Groq key or Whisper on your PC', 'free.cta': 'Download',
    'pro.month': '/month', 'pro.or': 'or', 'pro.year': 'per year', 'pro.l1': 'Transcription included: no key to create', 'pro.l2': '20 hours of ATC audio per month', 'pro.l3': 'Everything in the free version', 'pro.cta': 'Go Pro',
    'faq.title': 'Frequently asked questions',
    'q1': 'Does it talk on the radio for me?', 'a1': 'No. It suggests what to say and checks the numbers: you always do the talking. It\'s a training tool for flight simulation, not for real-world flying.',
    'q2': 'Does it work with vPilot and MSFS/X-Plane?', 'a2': 'Yes: it listens to vPilot\'s audio (or any client) and, if you want, reads simulator data read-only.',
    'q3': 'Do I need a subscription?', 'a3': 'No. The free version is complete: you only need a free Groq key for transcription, or a Whisper server on your PC. Pro includes transcription and saves you that step.',
    'q4': 'What data does it collect?', 'a4': 'No account. Audio only goes to the transcription service you choose. Anonymous statistics are optional and off by default.',
    'q5': 'Windows says it "protected your PC"', 'a5': 'This happens with new apps that aren\'t signed yet: click "More info", then "Run anyway".',
    'foot.privacy': 'Privacy', 'foot.note': 'A training tool for flight simulation. Not affiliated with VATSIM, IVAO or simulator makers.',
  };

  const cfg = window.SITE_CONFIG || {};
  const it = {};
  document.querySelectorAll('[data-t]').forEach((el) => { it[el.dataset.t] = el.innerHTML; });

  function setLang(lang) {
    const l = lang === 'en' ? 'en' : 'it';
    document.documentElement.lang = l;
    document.querySelectorAll('[data-t]').forEach((el) => {
      const v = l === 'en' ? EN[el.dataset.t] : it[el.dataset.t];
      if (v !== undefined) el.innerHTML = v;
    });
    document.querySelectorAll('img[data-src]').forEach((img) => { img.src = `img/${l}-${img.dataset.src}.jpg`; });
    document.getElementById('lang').value = l;
    try { localStorage.setItem('rc-site-lang', l); } catch (e) { /* niente */ }
  }

  let start = new URLSearchParams(location.search).get('lang');
  try { start = start || localStorage.getItem('rc-site-lang'); } catch (e) { /* niente */ }
  start = start || ((navigator.language || 'it').startsWith('it') ? 'it' : 'en');
  setLang(start);
  document.getElementById('lang').addEventListener('change', (e) => setLang(e.target.value));

  // Store e prezzi
  const show = (id, url) => { const a = document.getElementById(id); if (url) { a.href = url; a.hidden = false; } };
  show('dlApple', cfg.appStore);
  show('dlGoogle', cfg.playStore);
  if (cfg.playStore) document.getElementById('dlApk').hidden = true;
  if (cfg.price) {
    document.getElementById('priceMonth').textContent = cfg.price.month;
    document.getElementById('priceYear').textContent = cfg.price.year;
  }
  if (cfg.checkout) document.getElementById('buyPro').href = cfg.checkout;

  // Ultima versione su GitHub: link diretto all'installer e all'APK
  if (cfg.repo) {
    fetch(`https://api.github.com/repos/${cfg.repo}/releases?per_page=5`)
      .then((r) => (r.ok ? r.json() : []))
      .then((list) => {
        const rel = list.find((x) => x.assets.some((a) => /Setup-.*\.exe$/.test(a.name)));
        if (!rel) return;
        const exe = rel.assets.find((a) => /Setup-.*\.exe$/.test(a.name));
        document.getElementById('dlWin').href = exe.browser_download_url;
        const v = (exe.name.match(/(\d+\.\d+\.\d+)/) || [])[1];
        if (v) document.getElementById('dlVer').textContent = `v${v}`;
        const apk = rel.assets.find((a) => /\.apk$/.test(a.name));
        if (apk) document.getElementById('dlApk').href = apk.browser_download_url;
      })
      .catch(() => {});
  }
})();
