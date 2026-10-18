# Privacy — Readback Copilot

*Ultimo aggiornamento: 12 ottobre 2026 · [English below](#english)*

Readback Copilot non ha account, server propri né statistiche d'uso. Questa pagina elenca **tutto** ciò che esce dal tuo computer.

## Cosa resta sul tuo PC
Impostazioni (compresa la chiave Groq), storico delle chiamate, statistiche di allenamento e del coach, logbook, note, listino di bordo: in un file nella cartella dati utente (`%APPDATA%\Readback Copilot\readback-copilot-data.json`), con una copia nel browser integrato. Il server locale ascolta solo su `127.0.0.1` e rifiuta richieste di altri siti.

## Cosa viene inviato, e a chi
| Destinatario | Cosa | Quando |
|---|---|---|
| **Groq** (api.groq.com) | L'audio di ogni frase dell'ATC; col coach attivo, anche l'audio del tuo readback. Il testo trascritto, se è attiva l'AI per il readback. | Solo mentre l'ascolto è attivo e se scegli Groq. Si applicano i [termini di Groq](https://groq.com/privacy-policy/). |
| **Server Pro** (se configurato) | Lo stesso audio e testo di Groq, più la tua chiave di licenza. Il server controlla la licenza su Lemon Squeezy, conta i minuti del mese e inoltra a Groq: l'audio non viene salvato. | Solo se scegli "Pro". |
| **Simulatore** (MSFS / X-Plane) | Niente esce dal PC: il programma legge radio, transponder, altimetro e autopilota dal simulatore sul tuo computer, solo in lettura. | Se "Collega al simulatore" è attivo (Impostazioni → Simulatore). |
| **Server Whisper locale** | Lo stesso audio, ma al server che indichi tu (di solito sul tuo PC). | Se scegli "Locale": nessun dato esce dalla tua rete. |
| **Chrome/Edge** | Con il riconoscimento di Chrome, l'audio va al servizio vocale del browser (Google/Microsoft). | Solo in modalità Chrome. |
| **VATSIM** (data.vatsim.net, metar.vatsim.net) | Nessun dato personale: si scaricano dati pubblici. Il tuo nominativo serve solo a cercarti nel feed, sul tuo PC. | Scheda Volo, tracking, verifiche, mappa radar. |
| **IVAO** (api.ivao.aero) | Nessun dato personale: si scarica l'elenco pubblico di piloti e controllori online. | Mentre la mappa radar mostra IVAO (disattivabile dal pannello dei livelli). |
| **NOAA aviationweather.gov** | Il codice ICAO dell'aeroporto di cui chiedi la previsione (TAF). | Scheda Volo e popup degli aeroporti sulla mappa. |
| **GitHub** (raw.githubusercontent.com, github.com) | Nessun dato personale: si scaricano i confini dei settori di controllo (VATSpy, SimAware), al massimo una volta al giorno. | All'avvio della mappa; se non c'è rete si usa la copia inclusa. |
| **SimBrief** | Il tuo nome utente SimBrief. | Quando premi "Carica da SimBrief". |
| **OpenStreetMap / MapTiler** | Le coordinate delle porzioni di mappa visualizzate (e la tua chiave MapTiler, se la usi). | Solo con la mappa **dettagliata**: la mappa di base è inclusa nel programma e non scarica nulla. |
| **GitHub** (api.github.com) | Nessun dato personale: si legge l'elenco delle versioni. | Al massimo ogni 6 ore; disattivabile in Impostazioni. |

Nient'altro. Non ci sono analytics, crash report o pubblicità.

## Tasto PTT
Se imposti il tasto PTT di vPilot (coach readback), il programma osserva tastiera e pulsanti del mouse a livello di sistema **solo per riconoscere quel tasto**: non registra, non salva e non invia nessun altro tasto. Senza tasto impostato l'osservazione è spenta. Il tasto non viene bloccato: vPilot lo riceve normalmente.

## Aggiornamenti
Il programma installato controlla su GitHub se c'è una versione nuova (al massimo ogni 6 ore, disattivabile), la scarica in background e la installa solo quando premi "Riavvia e aggiorna" o quando chiudi il programma.

## Cancellare i dati
*Impostazioni → Ripristina impostazioni* cancella le impostazioni e la chiave. Per cancellare tutto, chiudi il programma ed elimina la cartella `%APPDATA%\Readback Copilot`.

---

## English

Readback Copilot has no accounts, no servers of its own and no usage analytics. This is **everything** that leaves your computer.

**Stays on your PC**: settings (including your Groq key), call history, training and coach stats, logbook, notes, cabin menu — in a file in your user data folder (`%APPDATA%\Readback Copilot\readback-copilot-data.json`). The local server only listens on `127.0.0.1` and rejects requests from other websites.

**Sent out**
- **Groq**: the audio of each ATC transmission (and, with the coach on, of your readback); the transcript if the AI readback is on. Only while listening, only if you choose Groq. [Groq's terms](https://groq.com/privacy-policy/) apply.
- **Pro server** (if configured): the same audio and text as Groq plus your license key; it checks the license with Lemon Squeezy, counts monthly minutes and forwards to Groq without storing audio. Only if you choose "Pro".
- **Simulator** (MSFS / X-Plane): nothing leaves your PC; radios, transponder, altimeter and autopilot are read locally, read only.
- **Local Whisper server**: the same audio, to the server you configure (usually your own PC) — nothing leaves your network.
- **Chrome/Edge**: in Chrome mode the audio goes to the browser's speech service.
- **VATSIM**: public data is downloaded; nothing personal is sent.
- **IVAO**: the public list of online pilots and controllers, while the radar map shows IVAO (can be turned off).
- **NOAA aviationweather.gov**: the ICAO code of the airport whose forecast (TAF) you look at.
- **GitHub (map data)**: control sector boundaries (VATSpy, SimAware), at most once a day; the bundled copy is used offline.
- **SimBrief**: your SimBrief username, when you press "Load from SimBrief".
- **OpenStreetMap / MapTiler**: map tile coordinates (and your MapTiler key, if used) — only with the **detailed** map; the base map is built in and downloads nothing.
- **GitHub**: the list of releases and, for the installed app, the update itself — at most every 6 hours (can be turned off). Updates install only when you press "Restart and update" or quit.

**PTT key**: if you set your vPilot PTT key (readback coach), the app observes the keyboard and mouse buttons system-wide **only to recognise that key**; no other key is recorded, stored or sent, and the key still reaches vPilot. With no key set, nothing is observed.

No analytics, no crash reports, no ads. To delete everything, close the app and delete `%APPDATA%\Readback Copilot`.
