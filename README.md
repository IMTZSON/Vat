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

### 🎧 Ascolto (in volo)
- Ascolta la radio di vPilot, trascrive l'ATC e ti mostra il **readback corretto** con la **pronuncia ICAO**.
  ```
  ATC:       "Alitalia 123, descend FL80, turn left heading 270, contact Roma Radar 125.5"
  DA DIRE:    Descend FL80, left heading 270, Roma Radar 125.5, Alitalia 123
  PRONUNCIA:  descend flight level eight zero, left heading two seven zero, Roma Radar one two five decimal five…
  ```
- Riconosce le chiamate **per te**: quelle per altri aerei vanno solo nello storico. Fa un **bip** quando l'ATC chiama te.
- Avvisa sui valori sospetti, per esempio uno squawk con 8 o 9 o un QNH strano.
- **Modalità compatta** sempre in primo piano sopra il simulatore.
- **Storico** esportabile in un file di testo.

### 🎓 Allenamento
- Un ATC simulato ti parla a voce, tu rispondi **a voce** (o scrivendo) e l'app ti **corregge elemento per elemento**: quota, prua, frequenza, squawk, pista, nominativo.
- Fasi: Delivery, Ground, Tower, Partenza, Crociera, Avvicinamento, Misto, oppure **Volo completo** in 18 passi dal clearance al parcheggio.
- Tre livelli di difficoltà e statistiche dei progressi per fase.
- Se hai caricato un volo nella scheda Volo, l'allenamento usa i tuoi aeroporti, le tue piste e la tua SID.

### ✈️ Volo (briefing)
- **SimBrief**: carica l'ultimo piano di volo con il tuo nome utente. Imposta da solo il nominativo e mostra rotta, livello, piste, SID/STAR e carburante.
- **Meteo**: METAR di partenza e arrivo spiegato in italiano (vento, visibilità, nubi, QNH, categoria VFR/IFR).
- **ATC online su VATSIM** negli aeroporti del volo, con frequenze, lettera ATIS e testo ATIS.
- **Le tue chiamate**: cosa dire tu per primo in ogni fase, già compilato con i dati del volo (stand, lettera ATIS, piste).
- **Tu su VATSIM**: controlla se sei connesso e se lo squawk impostato è quello assegnato.

### 📖 Frasario
- 40 frasi standard ICAO divise per fase, con la risposta corretta, una spiegazione in italiano e il tasto 🔊 per ascoltarle.
- Ci sono anche emergenze, alfabeto fonetico, numeri con la pronuncia e un glossario.

### ⌨️ Scorciatoie (funzionano anche col simulatore in primo piano)
| Tasti | Azione |
|---|---|
| `Ctrl+Shift+L` | Avvia o ferma l'ascolto |
| `Ctrl+Shift+R` | Ripete a voce l'ultimo readback |
| `Ctrl+Shift+O` | Modalità compatta sopra il simulatore |

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
| `js/scenarios.js` | Generatore di istruzioni ATC per l'allenamento e valutazione delle risposte |
| `js/metar.js`, `js/simbrief.js` | Decodifica METAR e lettura OFP SimBrief |
| `js/audio.js`, `js/stt.js`, `js/tts.js`, `js/groq.js` | Audio, riconoscimento vocale, sintesi vocale, Groq |
| `js/app.js`, `js/listen.js`, `js/trainer.js`, `js/flight.js`, `js/phrasebook.js` | Interfaccia |
| `electron/main.js`, `electron/preload.js` | Programma Windows: finestra, audio del PC, scorciatoie, modalità compatta |
| `electron/server.js` | Server locale su `127.0.0.1:47800` con proxy verso Groq/SimBrief/VATSIM |

```
npm install      # dipendenze (Electron)
npm test         # test del motore
npm start        # avvia il programma
npm run serve    # solo server: apri http://127.0.0.1:47800 in Chrome
npm run dist     # crea gli .exe (su Windows)
```
