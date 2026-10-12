# Readback Copilot 🎧✈️

Il tuo **copilota radio per VATSIM**. Ascolta l'ATC e ti mostra subito, in grande, **cosa ripetere**. Ti fa allenare con un ATC simulato, prepara il volo con SimBrief, meteo e controllori online, e contiene un frasario completo.

Disponibile come **programma per Windows (.exe)** e come pagina web.

---

## 📥 Scaricare il programma per Windows

1. Vai alla pagina **Releases** del repository e apri la build più recente.
2. Scarica uno dei due file:
   - **`ReadbackCopilot-Setup-x.y.z.exe`**: installer, crea l'icona sul desktop.
   - **`ReadbackCopilot-Portable-x.y.z.exe`**: si avvia subito, senza installare niente.
3. Il programma non è firmato digitalmente. Se Windows mostra **"Windows ha protetto il PC"**, clicca **Ulteriori informazioni → Esegui comunque**.

> Le build vengono create in automatico da GitHub Actions (scheda **Actions → Build Windows**) a ogni aggiornamento del codice.

---

## Cosa fa

L'interfaccia è in stile iOS (vetro sfocato, tab bar in basso) e il tema chiaro/scuro segue Windows. Ci sono 5 schede.

### 🎧 ATC (in volo)
- Ascolta la radio di vPilot, trascrive l'ATC e mostra il **readback corretto** con la **pronuncia ICAO**.
- **Verifica ogni readback** con un badge:
  - ✅ **Verificato**: i controlli non hanno trovato nulla di strano;
  - ⚠️ **Controlla**: qualcosa non torna e l'app spiega cosa;
  - ⛔ **Audio non chiaro**: chiedi *say again*.
- I controlli fatti:
  - qualità dell'audio (confidenza di Whisper);
  - l'AI non deve aggiungere numeri che l'ATC non ha detto (in quel caso vince il readback a regole);
  - frequenza confrontata con i **controllori online su VATSIM** ("forse 125.500?");
  - pista confrontata con quelle degli aeroporti del volo;
  - QNH confrontato con il **METAR**;
  - squawk valido.
- Riconosce le chiamate per te, fa un bip, ha la **modalità compatta** sopra il simulatore e lo storico esportabile.

### ✈️ Volo
- **Mappa con tracking live** dal feed VATSIM (ogni 15 s): rotta pianificata, aereo, scia, **fase del volo**, livello, GS, NM rimanenti, ETA e %.
- Piano di volo da **SimBrief**, oppure inserito a mano.
- **METAR** spiegato in italiano, **ATC online** con frequenze e ATIS, e **le tue chiamate** già compilate.

### 🛒 Bordo
- **Simulazione realistica del servizio di bordo**:
  - le vendite arrivano in diretta in base a passeggeri, durata del volo e momento del servizio (bevande e pasti all'inizio, duty free alla fine);
  - mostra incasso, prodotti più venduti e scorte che calano.
- Segue il volo reale su VATSIM, oppure un timer.
- **Listino modificabile** (prezzi, scorte, prodotti) per A320 e 737. Il riepilogo finisce nel logbook.

### 📋 Cockpit
- **Checklist A320 family e Boeing 737** da spuntare. La fase del volo propone quella giusta.
- **Note CRAFT** (Clearance, Route, Altitude, Frequency, Transponder) **compilate da sole** dall'autorizzazione sentita, più le note libere.
- **Logbook automatico**: off-block, decollo, atterraggio, on-block, ore di volo e incasso di bordo. Esportabile in CSV.

### ⋯ Altro
- **Allenamento** con ATC simulato a voce e correzione elemento per elemento (anche un volo completo in 18 passi).
- **Frasario** con 40 frasi ICAO, alfabeto, numeri e glossario.
- **Impostazioni**.

### ⌨️ Scorciatoie (funzionano anche col simulatore in primo piano)
| Tasti | Azione |
|---|---|
| `Ctrl+Shift+L` | Avvia o ferma l'ascolto |
| `Ctrl+Shift+R` | Ripete a voce l'ultimo readback |
| `Ctrl+Shift+O` | Modalità compatta sopra il simulatore |

> **Precisione**: nessun riconoscimento vocale è perfetto al 100%. Per questo l'app non mostra mai in silenzio un valore dubbio: quando qualcosa non torna te lo dice. Nel dubbio, in radio si chiede sempre *"say again"*.

---

## ⚙️ Configurazione (5 minuti)

### 1. Chiave gratuita Groq (consigliata)
Groq fornisce gratis Whisper, il riconoscimento vocale preciso coi numeri, e l'AI per i readback complessi.
1. Vai su **https://console.groq.com** e registrati.
2. **API Keys → Create API Key** e copia la chiave (`gsk_...`).
3. Nel programma: **Impostazioni → Chiave API Groq**, incollala e premi **Verifica chiave**.

> Attenzione: si scrive **Groq** con la Q. Grok con la K è un'altra cosa.
> Gli abbonamenti Claude o ChatGPT non includono chiavi API.

### 2. Far sentire vPilot al programma
**Opzione A, la più semplice:** in *Impostazioni → Da dove ascoltare* scegli **Audio del PC**. Non devi installare niente, ma il programma sente anche i suoni del simulatore.

**Opzione B, la più precisa (VB-Cable):**
1. Installa **VB-Cable** (gratuito) da https://vb-audio.com/Cable/ e riavvia.
2. In **vPilot → Settings → Audio** imposta l'uscita su **CABLE Input**. Il microfono resta il tuo headset.
3. Per sentire ancora l'ATC: `Win+R` → `mmsys.cpl` → *Registrazione* → **CABLE Output** → *Proprietà → Ascolto* → spunta **Ascolta questo dispositivo** e scegli le tue cuffie.
4. Nel programma: *Impostazioni → Da dove ascoltare: Dispositivo* e *Dispositivo radio:* **CABLE Output** (premi ↻ per aggiornare l'elenco).

Poi regola la **soglia** (la linea gialla nella scheda Ascolto) appena sopra il rumore di fondo.

### 3. Nominativo
Scrivilo nella scheda Ascolto (es. `AZA123`, `RYR45AB`, `I-ABCD`), oppure caricalo da SimBrief. Se la tua compagnia non è riconosciuta, scrivi il nominativo radio nel campo accanto (es. "Alitalia").

---

## Modalità senza chiave
- **Gratis (Chrome):** usa il riconoscimento vocale di Chrome o Edge. Dentro il programma per Windows non funziona: premi **"Apri l'app in Chrome"**: l'app si apre nel browser (la prima volta reinserisci lì nominativo e impostazioni, perché Chrome le salva per conto suo).
- La scheda **Prova**, il **Frasario**, il **Volo** e l'allenamento con risposte **scritte** funzionano senza nessuna chiave.

## Limiti da conoscere
- Il readback arriva circa 1–3 secondi dopo la fine della frase dell'ATC.
- Con audio disturbato i numeri possono essere capiti male: controlla sempre la riga **ATC** e, nel dubbio, chiedi *"say again"*.
- Le procedure dell'allenamento (SID, waypoint, frequenze) sono di fantasia: servono per imparare la fraseologia, non per volare quelle procedure.
- L'app ti **suggerisce** cosa dire: in radio parli sempre tu.

---

## Per sviluppatori

Pagina statica (`index.html`, `css/`, `js/`) dentro una shell Electron (`electron/`).

| File | Ruolo |
|---|---|
| `js/readback.js` | Motore di readback: normalizzazione, regole ICAO, pronuncia, riconoscimento nominativo |
| `js/precision.js`, `js/vatsim.js` | Verifiche dei readback (audio, AI vs regole, dati live VATSIM/METAR) |
| `js/geo.js`, `js/tracking.js`, `js/logbook.js` | Tracking su mappa (Leaflet), fasi del volo, logbook automatico |
| `js/cabin-sim.js`, `js/cabin.js` | Simulazione del servizio di bordo |
| `js/checklists-data.js`, `js/cockpit.js` | Checklist e note CRAFT |
| `js/scenarios.js` | Generatore di istruzioni ATC per l'allenamento e valutazione delle risposte |
| `js/metar.js`, `js/simbrief.js` | Decodifica METAR e lettura OFP SimBrief |
| `js/audio.js`, `js/stt.js`, `js/tts.js`, `js/groq.js` | Audio, riconoscimento vocale, sintesi vocale, Groq |
| `js/app.js`, `js/listen.js`, `js/trainer.js`, `js/flight.js`, `js/phrasebook.js` | Interfaccia |
| `electron/main.js`, `electron/preload.js` | Programma Windows: finestra, audio del PC, scorciatoie, modalità compatta |
| `electron/server.js` | Server locale su `127.0.0.1:47800` con proxy verso Groq/SimBrief/VATSIM |

```
npm install      # dipendenze (Electron)
npm test         # oltre 300 test (corpus ATC, verifiche, geo, bordo, SimBrief)
npm start        # avvia il programma
npm run serve    # solo server: apri http://127.0.0.1:47800 in Chrome
npm run dist     # crea gli .exe (su Windows)
```


### Licenze di terze parti
- Font Inter: SIL Open Font License (`css/fonts/LICENSE-Inter-OFL.txt`)
- Leaflet: BSD-2 (`js/vendor/LICENSE-leaflet.txt`)
- Icone Lucide: ISC (`js/vendor/LICENSE-lucide.txt`)
- Mappe © OpenStreetMap contributors, © CARTO
