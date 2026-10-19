# Readback Copilot — piano prodotto e business (COO)

*12 ottobre 2026 · versione 4.0*

## 1. Dove siamo

| Area | Prima (3.0) | Ora (4.0) |
|---|---|---|
| Precisione | Prompt di Whisper con numeri di esempio (rischio di numeri "copiati"); trascrizioni fuori ordine; soglia manuale | Prompt senza numeri, filtro frasi fantasma ed eco, ordine garantito, soglia automatica, AudioWorklet |
| Copertura | 14 aeroporti italiani, ~45 compagnie | 13.850 aeroporti con piste, 860 compagnie, centri VATSIM di tutto il mondo |
| Lingue | Solo italiano | Italiano, inglese, spagnolo e tedesco, verificati da test |
| Primo avvio | 3 card statiche, VB-Cable spiegato a parole | Configurazione guidata con prova audio dal vivo e trascrizione |
| Dati | `localStorage` legato alla porta (impostazioni perse se cambiava) | File nella cartella utente, condiviso con Chrome |
| Differenziazione | Readback suggerito | + **Coach**: valuta il readback che dici davvero e cosa dimentichi più spesso |
| Privacy | Solo cloud | + **Whisper locale**: l'audio non esce dal PC |
| Qualità | 316 test unitari | 356 unitari + end-to-end nel browser su ogni PR, harness di precisione su audio reali |
| Distribuzione | Exe non firmato, nessun avviso di aggiornamento | Avviso in-app, firma pronta (manca solo il certificato) |

## 2. Decisioni che spettano a te (in ordine di urgenza)

1. **Unire su `main`**: la PR è pronta. Finché `main` contiene solo `# Vat`, chi apre il repository non vede il prodotto.
2. **Focus**: Readback Copilot ha trazione (7 build in 2 giorni); l'app iOS **Contrail** (PR #1) è ferma dal 2 ottobre. Consiglio: Readback Copilot come prodotto principale, Contrail in pausa (la PR resta aperta e non si perde nulla).
3. **Certificato di firma del codice**: è la singola leva più forte sui download (l'avviso "Windows ha protetto il PC" fa abbandonare molti utenti). Opzioni: certificato OV da un rivenditore (~70–200 €/anno) o Azure Trusted Signing (abbonamento mensile, verificare i requisiti per i privati). Poi basta inserire due secret nel repository (`WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`).
4. **Licenza**: oggi `UNLICENSED` (tutti i diritti riservati). Se vuoi contributi della community, valuta MIT o GPL; se vuoi vendere il piano Pro, il "source available" va bene così.
5. **Nome e dominio**: "Readback Copilot" è chiaro e cercabile; registra il dominio e gli handle social prima del lancio.

## 3. Posizionamento

**Per** i piloti virtuali che volano (o vogliono iniziare a volare) online su VATSIM e hanno paura della radio,
**Readback Copilot** è il copilota che ascolta l'ATC e ti dice cosa ripetere, verificando ogni numero,
**a differenza** di trainer offline (solo esercizi) o di servizi di ATC con AI (un mondo chiuso, non la rete reale),
**perché** funziona sulla rete vera, con i controllori veri, e ti fa migliorare a ogni volo (coach + allenamento).

Messaggio in una riga: *"Vola su VATSIM senza paura della radio."*

Segmenti, in ordine:
1. **Nuovi piloti VATSIM** (il blocco principale all'ingresso è la fraseologia): bisogno forte, alta disponibilità a provare.
2. **Piloti non madrelingua inglese**: Italia (già coperta), poi Spagna, Germania, Francia, Brasile. Interfaccia già in spagnolo e tedesco; francese e portoghese sono i prossimi (basta un file di traduzione).
3. **Scuole e vACC training departments**: il coach e l'harness di precisione sono strumenti didattici misurabili.

## 4. Modello di ricavo

**Gratis per sempre** (crescita e passaparola): readback, verifiche, mappa, checklist, frasario, allenamento, coach. Si usa con la propria chiave Groq gratuita o con Whisper locale.

**Pro** (proposta: 3,99 €/mese o 29 €/anno), cosa giustifica il prezzo:
- **Trascrizione inclusa, senza chiave**: elimina il passo più difficile dell'onboarding (registrarsi su Groq). È anche il miglior strumento di conversione.
- Storico illimitato e sincronizzato, report del coach per volo (PDF), piani di allenamento personalizzati sui punti deboli.
- Voci TTS neurali per l'allenamento.

**Costi unitari (stime da verificare con i listini aggiornati)**: con Whisper large-v3-turbo su Groq a pochi centesimi per ora di audio, e ~10–20 minuti di parlato ATC in un volo di 90 minuti, il costo è dell'ordine di **un centesimo per volo**. Anche con 30 voli al mese il margine lordo del Pro resta sopra il 90%. Il costo vero è il supporto: l'onboarding guidato serve anche a ridurlo.

Serve un piccolo backend (proxy di trascrizione con autenticazione e limiti, pagamenti tramite un merchant of record come Paddle o Lemon Squeezy che gestisce IVA e fatture). È il prossimo passo tecnico dopo il lancio, non prima: prima va misurata la retention del prodotto gratuito.

## 5. Lancio (prime 6 settimane)

1. **Settimana 1**: merge su `main`, certificato, release 4.0 stabile, landing page (screenshot + video di 60 secondi con un volo reale).
2. **Settimana 2**: post su forum VATSIM, subreddit r/flightsim e r/VATSIM, gruppi Facebook e Discord italiani (es. comunità vACC Italia). Messaggio: "gratis, in italiano, inglese, spagnolo e tedesco, non parla al posto tuo".
3. **Settimane 3–4**: 5–10 creator YouTube/Twitch di flight sim (volo in diretta con l'overlay compatto: è l'immagine più forte del prodotto).
4. **Settimane 5–6**: contatto con i training department dei vACC (Italia, Spagna, Germania): coach e allenamento come materiale per gli studenti.

## 6. Metriche (telemetria **opt-in** e anonima: pronta in 4.4, si attiva con l'indirizzo in `package.json` → `telemetry`)

| Metrica | Definizione | Obiettivo iniziale |
|---|---|---|
| Attivazione | Configurazione completata **e** primo readback "Verificato" entro 24 h | > 50% delle installazioni |
| Precisione percepita | % di readback con stato Verificato | > 85% |
| Precisione misurata | `scripts/eval-audio.js` su 100 registrazioni reali: numeri corretti | > 97%, "sbagliato ma Verificato" = 0 |
| Retention | Utenti che volano di nuovo dopo 7 / 30 giorni | 35% / 20% |
| Coach | % di utenti attivi che lo accendono; miglioramento medio del punteggio dopo 10 voli | 25%; +15 punti |

Il dato sulla precisione misurata è il più importante: raccogliere un set di 100–200 registrazioni ATC reali (con il permesso dei controllori) e farlo girare a ogni modifica del prompt o del modello.

## 7. Rischi

- **Regole VATSIM**: l'app non trasmette mai e non parla al posto del pilota, suggerisce soltanto. Conviene comunque una verifica con il Code of Conduct aggiornato e un parere informale dei vACC prima del lancio pubblico, per poterlo scrivere sulla landing page.
- **Dipendenza da Groq** (modelli ritirati, limiti gratuiti): mitigata dalla scelta automatica del modello, dal Whisper locale e, in futuro, dal proxy Pro con più fornitori.
- **Precisione su audio difficile** (accenti, rumore): mitigata da verifiche e "say again", ma va misurata (vedi metriche).
- **Exe non firmato**: vedi decisione 3.

## 8. Roadmap tecnica successiva

1. ~~Spagnolo e tedesco~~ — fatto in 4.x (interfaccia e METAR/TAF; checklist, frasario e annunci restano in inglese/italiano). Prossime: francese e portoghese (Brasile), un file `js/strings-xx.js` ciascuna.
2. Telemetria opt-in e anonima per le metriche sopra.
3. ~~Rilevamento del PTT di vPilot~~ — fatto in 4.0 (tastiera e pulsanti del mouse); pulsanti del joystick in 4.3.
4. Proxy di trascrizione Pro (backend minimo) e pagamenti: vedi punto 9.
5. Build per macOS (Electron è già multipiattaforma; serve la cattura audio di sistema su macOS).
6. ~~Aggiornamento automatico in un clic~~ — fatto in 4.0 (dalle release stabili di `main`; con la firma del codice sparirà anche l'avviso di SmartScreen al primo download).
7. ~~Riascolto della radio rallentato e "Prossima chiamata"~~: fatto in 4.2.
8. ~~Collegamento al simulatore con controllo dell'esecuzione delle istruzioni~~: fatto in 4.2 (MSFS via SimConnect, X-Plane via UDP).
   - In 4.3: selettori del FlyByWire A32NX; per Fenix e PMDG il controllo guarda la tendenza reale di livello e prua.
9. ~~Proxy di trascrizione Pro e licenze~~: il codice è pronto in 4.2 (`server/pro/`, Lemon Squeezy).
   - Da fare: pubblicazione (account Cloudflare, Lemon Squeezy, Groq a pagamento), poi compilare `pro` in `package.json`. Guida in `docs/PRO-SETUP.md`.
10. ~~Rullaggio sulla mappa, voto dell'atterraggio e resoconto del volo, prova generale, profili add-on e PTT sul joystick, aiuto emergenze, francese e portoghese~~: fatto in 4.3.
11. ~~App per iPhone e Android collegata al PC in Wi-Fi, carriera e obiettivi, sito di vendita, statistiche anonime opt-in~~: fatto in 4.4.
   - Da fare: account sviluppatore e certificati (guida in `docs/MOBILE-SETUP.md`), attivare GitHub Pages, abbonamento Pro in-app per iOS/Android.
