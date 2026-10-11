# Readback Copilot 🎧

Ascolta l'ATC mentre voli su **VATSIM** e ti mostra subito, in grande, **il readback corretto da ripetere**, con la pronuncia ICAO.

```
ATC:      "Alitalia 123, descend FL80, turn left heading 270, contact Roma Radar 125.5"
DA DIRE:   Descend FL80, left heading 270, Roma Radar 125.5, Alitalia 123
PRONUNCIA: descend flight level eight zero, left heading two seven zero, Roma Radar one two five decimal five, Alitalia one two three
```

- Riconosce se la chiamata è **per te**: le chiamate per altri aerei finiscono solo nello storico.
- Mette in evidenza **quota, prua, velocità, squawk, QNH, frequenza e pista**.
- Avvisa se un valore sembra sbagliato, per esempio uno squawk con 8 o 9 o un QNH strano.
- Con 🔊 **Ascolta** senti la pronuncia corretta.
- La sezione **Prova** ti fa allenare anche senza simulatore: scrivi una frase ATC e vedi il readback.

> L'app ti **suggerisce** cosa dire: in radio parli sempre tu. Non trasmette niente al posto tuo.

## Due modalità

| | **Gratis** | **Groq** (consigliata) |
|---|---|---|
| Costo | 0 €, nessuna chiave | 0 €, serve una chiave gratuita |
| Riconoscimento vocale | Chrome/Edge integrato | Whisper (molto più preciso coi numeri) |
| Readback | Regole ICAO integrate | AI (gestisce anche frasi complesse), con le regole come riserva |

### Ottenere la chiave gratuita Groq
1. Vai su **https://console.groq.com** e registrati (piano gratuito, con limiti d'uso).
2. Apri **API Keys → Create API Key** e copia la chiave (`gsk_...`).
3. Nell'app apri **Impostazioni** e incollala nel campo "Chiave API Groq". Resta salvata solo nel tuo browser.

> Gli abbonamenti Claude o ChatGPT **non** includono una chiave API: le API si pagano a parte. Per questo l'app usa Groq, che ha un piano gratuito.

## Collegare vPilot (Windows)

L'app deve "sentire" la radio di vPilot. Il modo più pulito è un cavo audio virtuale:

1. Installa **VB-Cable** (gratuito) da https://vb-audio.com/Cable/ e riavvia il PC.
2. In **vPilot → Settings → Audio**, imposta il dispositivo di uscita (*Speakers/Headphones*) su **CABLE Input (VB-Audio Virtual Cable)**. Il microfono resta il tuo headset.
3. Per continuare a sentire l'ATC in cuffia: *Impostazioni audio di Windows → Altre impostazioni audio → Registrazione → **CABLE Output** → Proprietà → Ascolto →* spunta **"Ascolta questo dispositivo"** e scegli le tue cuffie.
4. Nell'app:
   - **Modalità Gratis:** in Chrome apri `chrome://settings/content/microphone` e scegli **CABLE Output** come microfono. Se non funziona, imposta CABLE Output come dispositivo di registrazione predefinito di Windows (vPilot usa comunque il microfono che hai scelto nelle sue impostazioni).
   - **Modalità Groq:** in *Impostazioni → Dispositivo di ingresso* premi ↻ e scegli **CABLE Output**. In alternativa puoi usare "Audio di sistema", ma sentirà anche i suoni del simulatore.
5. Scrivi il tuo nominativo (es. `AZA123`), premi **Avvia ascolto** e connettiti.

In modalità Groq trovi un **indicatore di livello** con la **soglia**: regola la soglia (la linea gialla) appena sopra il rumore di fondo, così l'app capisce quando inizia e finisce ogni trasmissione.

## Come aprire l'app

- **Online (consigliato):** attiva GitHub Pages (*Settings → Pages → Branch: `main` / root*) e apri l'indirizzo che ti dà GitHub. Su un repository privato le Pages richiedono un piano GitHub a pagamento.
- **In locale:** scarica il progetto (*Code → Download ZIP*), estrailo e apri `index.html` con **Google Chrome** o **Edge**. Se il microfono o Groq non funzionano aprendo il file direttamente, usa la versione online.

## Nominativo

- Compagnie: scrivi il codice ICAO + numero (`AZA123`, `RYR45AB`, `DLH4AB`). Il nominativo radio viene riconosciuto in automatico per le compagnie più comuni (`js/callsigns.js`). Se la tua non c'è, scrivilo nel campo **Nominativo radio**.
- Aerei privati: scrivi la marca (`I-ABCD`). Viene riconosciuta anche la forma abbreviata (*India Charlie Delta*).

## Limiti da conoscere

- Tra la fine della frase dell'ATC e il readback sullo schermo passano circa 1–3 secondi.
- Con audio disturbato i numeri possono essere capiti male: controlla sempre la riga **ATC** (cosa ha sentito l'app) e, nel dubbio, chiedi *"say again"*.
- La modalità Gratis usa le regole integrate: copre le istruzioni standard (quote, prue, velocità, squawk, QNH, frequenze, piste, rullaggio, autorizzazioni, avvicinamenti). Le frasi insolite o condizionali vengono gestite meglio dalla modalità Groq con l'AI.

## Sviluppo

Pagina statica, senza build: `index.html`, `css/`, `js/`.

- `js/readback.js`: motore di readback (normalizzazione, regole ICAO, pronuncia, riconoscimento del nominativo)
- `js/audio.js`: cattura audio, rilevamento voce, WAV per Whisper
- `js/groq.js`: trascrizione Whisper e readback con AI
- `js/app.js`: interfaccia

Test del motore (Node 18+):

```
npm test
```
