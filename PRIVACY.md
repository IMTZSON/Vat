# Privacy — Readback Copilot

*Ultimo aggiornamento: 12 ottobre 2026 · [English below](#english)*

Readback Copilot non ha account, server propri né statistiche d'uso. Questa pagina elenca **tutto** ciò che esce dal tuo computer.

## Cosa resta sul tuo PC
Impostazioni (compresa la chiave Groq), storico delle chiamate, statistiche di allenamento e del coach, logbook, note, listino di bordo: in un file nella cartella dati utente (`%APPDATA%\Readback Copilot\readback-copilot-data.json`), con una copia nel browser integrato. Il server locale ascolta solo su `127.0.0.1` e rifiuta richieste di altri siti.

## Cosa viene inviato, e a chi
| Destinatario | Cosa | Quando |
|---|---|---|
| **Groq** (api.groq.com) | L'audio di ogni frase dell'ATC; col coach attivo, anche l'audio del tuo readback. Il testo trascritto, se è attiva l'AI per il readback. | Solo mentre l'ascolto è attivo e se scegli Groq. Si applicano i [termini di Groq](https://groq.com/privacy-policy/). |
| **Server Whisper locale** | Lo stesso audio, ma al server che indichi tu (di solito sul tuo PC). | Se scegli "Locale": nessun dato esce dalla tua rete. |
| **Chrome/Edge** | Con il riconoscimento di Chrome, l'audio va al servizio vocale del browser (Google/Microsoft). | Solo in modalità Chrome. |
| **VATSIM** (data.vatsim.net, metar.vatsim.net) | Nessun dato personale: si scaricano dati pubblici. Il tuo nominativo serve solo a cercarti nel feed, sul tuo PC. | Scheda Volo, tracking, verifiche. |
| **SimBrief** | Il tuo nome utente SimBrief. | Quando premi "Carica da SimBrief". |
| **OpenStreetMap / MapTiler** | Le coordinate delle porzioni di mappa visualizzate (e la tua chiave MapTiler, se la usi). | Mentre la mappa è visibile. |
| **GitHub** (api.github.com) | Nessun dato personale: si legge l'elenco delle versioni. | Al massimo ogni 6 ore; disattivabile in Impostazioni. |

Nient'altro. Non ci sono analytics, crash report o pubblicità.

## Cancellare i dati
*Impostazioni → Ripristina impostazioni* cancella le impostazioni e la chiave. Per cancellare tutto, chiudi il programma ed elimina la cartella `%APPDATA%\Readback Copilot`.

---

## English

Readback Copilot has no accounts, no servers of its own and no usage analytics. This is **everything** that leaves your computer.

**Stays on your PC**: settings (including your Groq key), call history, training and coach stats, logbook, notes, cabin menu — in a file in your user data folder (`%APPDATA%\Readback Copilot\readback-copilot-data.json`). The local server only listens on `127.0.0.1` and rejects requests from other websites.

**Sent out**
- **Groq**: the audio of each ATC transmission (and, with the coach on, of your readback); the transcript if the AI readback is on. Only while listening, only if you choose Groq. [Groq's terms](https://groq.com/privacy-policy/) apply.
- **Local Whisper server**: the same audio, to the server you configure (usually your own PC) — nothing leaves your network.
- **Chrome/Edge**: in Chrome mode the audio goes to the browser's speech service.
- **VATSIM**: public data is downloaded; nothing personal is sent.
- **SimBrief**: your SimBrief username, when you press "Load from SimBrief".
- **OpenStreetMap / MapTiler**: map tile coordinates (and your MapTiler key, if used).
- **GitHub**: the list of releases, at most every 6 hours (can be turned off).

No analytics, no crash reports, no ads. To delete everything, close the app and delete `%APPDATA%\Readback Copilot`.
