# Readback Copilot 🎧✈️

**Il tuo copilota radio per VATSIM.** Ascolta l'ATC e ti mostra subito, in grande, **cosa ripetere**, verificando ogni numero. Ti allena con un ATC simulato, valuta i readback che dici davvero, prepara il volo con SimBrief, meteo e controllori online, e contiene un frasario completo.

Programma per **Windows (.exe)** e pagina web · Interfaccia in **italiano e inglese** · [English below](#english)

---

## 📥 Scaricare il programma

1. Apri la pagina **Releases** del repository e scegli la build più recente.
2. Scarica:
   - **`ReadbackCopilot-Setup-x.y.z.exe`**: installer con icona sul desktop;
   - **`ReadbackCopilot-Portable-x.y.z.exe`**: si avvia senza installare niente.
3. Se Windows mostra **"Windows ha protetto il PC"**: **Ulteriori informazioni → Esegui comunque** (vale finché il programma non è firmato digitalmente).

Al primo avvio parte la **configurazione guidata** (2 minuti): lingua, nominativo, riconoscimento vocale con verifica della chiave e **prova dell'audio dal vivo**.

**Aggiornamenti in un clic**: la versione installata scarica da sola le nuove versioni stabili e ti propone **"Riavvia e aggiorna"** (non si riavvia mai a sorpresa durante un volo; se rimandi, si aggiorna alla chiusura). La versione portatile e le build di prova ti avvisano con un link.

---

## Cosa fa

Il centro è la **mappa** con il tuo volo; sopra, in vetro, il pannello con 5 schede, la **Live Activity ATC** con l'ultimo readback e l'HUD del volo.

### 🎧 ATC
- Ascolta vPilot, trascrive l'ATC con Whisper e mostra il **readback corretto** con la pronuncia ICAO.
- **Ogni readback è verificato**: ✅ Verificato · ⚠️ Controlla (e spiega cosa) · ⛔ Audio non chiaro (chiedi *say again*). Controlli:
  - qualità dell'audio, frasi "fantasma" di Whisper e trascrizioni che ripetono il prompt;
  - l'AI non può aggiungere numeri che l'ATC non ha detto (vince il readback a regole);
  - frequenza contro i **controllori online** (anche centri come `LON_S_CTR` per Heathrow), pista contro gli **aeroporti del volo**, QNH contro il **METAR**, squawk valido.
- **Precisione**: il prompt dato a Whisper non contiene mai numeri (con audio sporco Whisper tende a copiarli); le chiamate si mostrano nell'ordine in cui l'ATC ha parlato; la **soglia del microfono si regola da sola** sul rumore di fondo.
- **Coach readback** (opzionale): dopo una chiamata per te ascolta il tuo microfono e ti dice cosa hai dimenticato, con le statistiche di ciò che sbagli più spesso. Con il **tasto PTT di vPilot** impostato (*Impostazioni → Coach readback*) registra esattamente la tua trasmissione, dalla pressione al rilascio; mentre trasmetti compare l'indicatore **TX**.
- Bip per le chiamate per te, modalità compatta sopra il simulatore, storico esportabile.

### ✈️ Volo
- Mappa con **tracking live** dal feed VATSIM: rotta, scia, fase del volo, livello, GS, NM rimanenti, ETA.
- Piano da **SimBrief** o a mano, **13.850 aeroporti** con piste in tutto il mondo.
- **METAR** spiegato in chiaro, **ATC online** con frequenze e ATIS, **le tue chiamate** già compilate con i nomi radio giusti.

### 🛒 Bordo · 📋 Cockpit · ⋯ Altro
- Simulazione del **servizio di bordo** con listino modificabile.
- **Checklist** A320 e 737 suggerite dalla fase del volo, **note CRAFT** compilate da sole, **logbook** automatico (CSV).
- **Allenamento** con ATC simulato a voce (anche un volo completo in 18 passi), **frasario** ICAO, impostazioni, privacy.

### ⌨️ Scorciatoie (anche col simulatore in primo piano)
| Tasti | Azione |
|---|---|
| `Ctrl+Shift+L` | Avvia o ferma l'ascolto |
| `Ctrl+Shift+R` | Ripete a voce l'ultimo readback |
| `Ctrl+Shift+O` | Modalità compatta sopra il simulatore |

---

## ⚙️ Configurazione

La configurazione guidata fa tutto; qui i dettagli.

### Riconoscimento vocale
- **Groq (consigliato, gratis)**: crea una chiave su **https://console.groq.com/keys** (si scrive *Groq* con la Q) e incollala.
- **Server Whisper locale (gratis, l'audio non esce dal PC)**: qualunque server compatibile con l'API OpenAI (`/v1/audio/transcriptions`), ad esempio [faster-whisper-server](https://github.com/fedirz/faster-whisper-server) o `whisper.cpp` avviato con `--inference-path /v1/audio/transcriptions`. In *Impostazioni → Servizio: Locale* scrivi l'indirizzo, es. `http://127.0.0.1:8080`.
- **Chrome (senza chiave)**: il riconoscimento di Chrome/Edge, meno preciso coi numeri. Dal programma premi **"Apri in Chrome"**: nominativo e impostazioni sono già lì.

### Far sentire vPilot al programma
- **Audio del PC**: niente da installare, ma sente anche il simulatore.
- **VB-Cable (più preciso)**: installa VB-Cable, in vPilot imposta l'uscita su **CABLE Input**, poi `Win+R → mmsys.cpl → Registrazione → CABLE Output → Ascolto → Ascolta questo dispositivo`. Nel programma scegli **CABLE Output** (la configurazione guidata lo trova da sola).

---

## Limiti da conoscere
- Il readback arriva 1–3 secondi dopo la fine della frase dell'ATC.
- Con audio disturbato i numeri possono essere capiti male: l'app lo segnala, ma controlla sempre la riga **ATC** e nel dubbio chiedi *"say again"*.
- Le procedure dell'allenamento (SID, frequenze) sono di fantasia; le piste e i centri sono reali.
- L'app **suggerisce** cosa dire: in radio parli sempre tu. È uno strumento di allenamento per la simulazione, non per il volo reale.

Dati e privacy: vedi [PRIVACY.md](PRIVACY.md).

---

## Per sviluppatori

Pagina statica (`index.html`, `css/`, `js/`, `data/`) dentro una shell Electron (`electron/`).

| File | Ruolo |
|---|---|
| `js/readback.js` | Motore di readback: normalizzazione, regole ICAO, pronuncia, nominativi |
| `js/precision.js`, `js/vatsim.js`, `js/world.js` | Verifiche (audio, eco/fantasmi, AI vs regole, dati live), FIR e aeroporti mondiali |
| `js/audio.js`, `js/audio-worklet.js` | Cattura (AudioWorklet) e rilevamento voce con soglia adattiva (`createVad`, funzione pura) |
| `js/groq.js`, `js/stt.js`, `js/tts.js` | Whisper (Groq o server locale), LLM, riconoscimento e sintesi vocale |
| `js/coach.js`, `js/scenarios.js` | Valutazione dei readback (coach in volo e allenamento) |
| `js/i18n.js`, `js/strings.js` | Traduzioni: `{ chiave: [italiano, inglese] }`, `data-i18n` nell'HTML |
| `js/onboarding.js`, `js/updates.js` | Configurazione guidata, aggiornamenti (automatici o avviso) |
| `electron/ptt.js`, `electron/updater.js` | Tasto PTT di sistema (uiohook-napi, solo osservazione), aggiornamento automatico (electron-updater) |
| `js/app.js`, `js/listen.js`, `js/flight.js`, `js/tracking.js`, … | Interfaccia |
| `electron/main.js`, `electron/store.js`, `electron/server.js` | Finestra, archivio dati su file, server locale (proxy, mappe, archivio per Chrome) |
| `scripts/build-data.js` | Rigenera `data/world.json` da OurAirports, OpenFlights e VATSpy |
| `scripts/eval-audio.js` | Misura la precisione sui numeri con registrazioni ATC reali |

```
npm install          # dipendenze (Electron, Playwright per i test e2e)
npm test             # 350+ test unitari (corpus ATC, verifiche, VAD, dati, server, traduzioni)
npm run test:e2e     # l'app vera in Chromium (npx playwright install chromium la prima volta)
npm start            # avvia il programma
npm run serve        # solo server: http://127.0.0.1:47800 in Chrome
npm run build:data   # aggiorna il database mondiale
npm run dist         # crea gli .exe (su Windows)
node scripts/eval-audio.js cartella   # precisione su audio reali (GROQ_API_KEY o --local URL)
```

**Traduzioni**: ogni testo sta in `js/strings.js` con italiano e inglese affiancati; `tests/i18n.test.js` fallisce se manca una lingua, una chiave o un segnaposto.

**Firma del codice**: aggiungi ai secret del repository `WIN_CSC_LINK` (certificato `.pfx` in base64) e `WIN_CSC_KEY_PASSWORD`: la CI firma gli .exe da sola.

### Licenze di terze parti
- Aeroporti e piste: [OurAirports](https://ourairports.com/data/) (pubblico dominio)
- Nominativi radio delle compagnie: [OpenFlights](https://openflights.org/data) (ODbL 1.0) — `data/world.json` → `airlines`
- Centri di controllo e FIR: [VATSpy Data Project](https://github.com/vatsimnetwork/vatspy-data-project) (CC BY-SA 4.0) — `data/world.json` → `firs`, `firIds`
- Font Inter (SIL OFL), Leaflet (BSD-2), icone Lucide (ISC): vedi `css/fonts/` e `js/vendor/`
- Mappe © OpenStreetMap contributors (opzionale: © MapTiler con chiave personale)

---

## English

**Your radio copilot for VATSIM.** It listens to ATC and instantly shows you, in big letters, **what to read back**, checking every number. It trains you with simulated ATC, scores the readbacks you actually say, prepares your flight with SimBrief, weather and online controllers, and includes a full phrasebook. Windows app and web page; the interface is in **English and Italian** (Settings → Language, or the first-run setup).

**Download** the latest build from **Releases** (`Setup` installer or `Portable`). If Windows says "Windows protected your PC", click **More info → Run anyway**. On first launch a **guided setup** walks you through language, callsign, speech recognition (with a key test) and a **live audio test**.

**Highlights**
- Every readback is **verified**: audio quality, Whisper phantom phrases and prompt echoes, AI vs rules (the AI can never add a number ATC didn't say), frequency vs **online controllers** (centres like `LON_S_CTR` included), runway vs your **airports**, QNH vs **METAR**, valid squawk.
- **Accuracy by design**: no numbers ever go into the Whisper prompt, calls are shown in the order ATC spoke, the **microphone threshold adapts** to background noise.
- **Readback coach** (opt-in): after a call for you it listens to your mic and tells you what you missed, with stats on what you miss most. Set your **vPilot PTT key** and it records exactly your transmission, with a **TX** indicator.
- **One-click updates**: the installed app downloads new stable versions in the background and offers **"Restart and update"** — never a surprise restart mid-flight.
- **Speech recognition**: Groq (free key at console.groq.com), a **local Whisper server** (OpenAI-compatible, audio never leaves your PC) or Chrome.
- **Worldwide data**: 13,850 airports with runways, 860 airline callsigns, VATSIM centre names.
- Live map tracking, SimBrief, decoded METAR, pre-filled calls, cabin service simulation, A320/737 checklists, CRAFT notes, automatic logbook, training with voice ATC, ICAO phrasebook.
- Data stays on your PC; see [PRIVACY.md](PRIVACY.md).

**Shortcuts** (work with the simulator in front): `Ctrl+Shift+L` start/stop listening · `Ctrl+Shift+R` repeat the readback · `Ctrl+Shift+O` compact overlay.

**Developers**: see the table and commands above (`npm test`, `npm run test:e2e`, `npm run build:data`, `scripts/eval-audio.js`). Translations live in `js/strings.js` as `[italian, english]` pairs.

> A training tool for flight simulation, not for real-world flying. You always do the talking on the radio; when in doubt, ask "say again".
