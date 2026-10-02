# TESTING — Contrail

Checklist per la prima prova su Mac. Le sezioni marcate 📱 richiedono un **dispositivo reale**.

## 0. Cosa è già verificato e cosa no
- ✅ `ContrailKit/VatCore` (parsing del feed, rete, METAR, settori, ETA, fasi, previsioni, badge, time machine,
  recorder) compila con Swift 6.2 e passa **148 test** su Linux (`Tools/swift-docker.sh test`), incluso un test
  sui dati reali del bundle.
- ⚠️ Il codice delle interfacce (SwiftUI, MapKit, WidgetKit, ActivityKit, CloudKit, FoundationModels) è stato
  scritto e rivisto senza un compilatore Apple: la sessione di sviluppo girava su Linux (DECISIONS D-002).
  **La prima `xcodebuild` va fatta sul Mac**; eventuali errori saranno puntuali (firme di API) e localizzati.

```bash
# Test del core (macOS)
cd ContrailKit && swift test
# Build dell'app da riga di comando
xcodebuild -project Contrail.xcodeproj -scheme Contrail \
  -destination 'platform=iOS Simulator,name=iPhone 17' build
```

## 1. Firme, capability e account
Requisiti: Xcode 26+, account Apple Developer (le capability iCloud/CloudKit, App Groups, Push e Live
Activity richiedono un team a pagamento; con un Personal Team funziona tutto tranne CloudKit/push).

1. Apri `Contrail.xcodeproj`, seleziona il progetto → per **ognuno** dei 4 target (`Contrail`,
   `ContrailWidgets`, `ContrailWatch`, `ContrailWatchWidgets`) → *Signing & Capabilities* → scegli il tuo Team.
2. Se il bundle id `info.everyapp.contrail` non è disponibile, cambialo con un prefisso tuo in tutti i target
   (gli id figli devono restare `…​.widgets`, `…​.watchkitapp`, `…​.watchkitapp.widgets`) e aggiorna di
   conseguenza:
   - App Group `group.info.everyapp.contrail` (app + widget) e `group.info.everyapp.contrail.watch` (watch +
     complicazioni) in `Config/*.entitlements` e in `ContrailShared/SharedStore.swift`;
   - container iCloud `iCloud.info.everyapp.contrail` in `Config/Contrail.entitlements`,
     `App/Persistence/Models.swift` e nel servizio classifiche.
3. Capability già dichiarate negli entitlements (Xcode le registra con *Automatically manage signing*):
   App Groups, iCloud (CloudKit + Key-value storage), Push Notifications (per le subscription CloudKit),
   Background Modes (fetch, processing, remote-notification — in `Config/Contrail-Info.plist`).
4. **CloudKit Dashboard** (icloud.developer.apple.com) → container `iCloud.info.everyapp.contrail`:
   - Il database privato (SwiftData: preferiti, amici, voli, badge) si crea da solo al primo avvio in Development.
   - Database **pubblico**: record type `LeaderboardEntry` con campi `cid` (Int64), `displayName` (String),
     `week` (String), `score` (Int64), `flights` (Int64), `distanceNM` (Int64), `updatedAt` (Date/Time).
     Indici: `week` **Queryable**, `score` **Sortable**, `recordName` **Queryable**. Security role
     *World*: Read; *Authenticated*: Create/Write.
   - Prima di distribuire: *Deploy Schema Changes* verso Production.
5. Nessuna chiave API necessaria: VATSIM, RainViewer, aviationweather.gov, Open-Meteo e SimBrief (per username)
   sono pubblici.

## 2. Checklist funzionale

### Avvio e onboarding
- [ ] Primo avvio: onboarding in 3 passi (CID, aeroporti preferiti, notifiche); "Salta" funziona.
- [ ] Icona app (chiara, scura, tinted) e nome "Contrail".
- [ ] Lingua: imposta il sistema in italiano e in inglese → testi tradotti; Dynamic Type (dimensioni
      accessibilità) senza testo tagliato; VoiceOver legge aerei, settori e controlli.
- [ ] Tema chiaro e scuro.

### Mappa
- [ ] Entro ~2 s compaiono gli aerei (prima dalla cache se presente, poi live); il badge "Live" mostra conteggi.
- [ ] Zoom out: cluster e globo 3D; zoom in sotto ~30 km: satellite/ibrida, aerei al gate e in rullaggio.
- [ ] Icone ruotate secondo la prua e colorate per quota; selezione → ambra + traccia percorsa + rotta pianificata.
- [ ] Settori: FIR verdi se online, ambra se prenotati; TRACON/APP; anelli TWR/GND/DEL; tap → controllore,
      frequenza, ATIS completo.
- [ ] Layer: radar (anche sopra z7, tile scalati), SIGMET, venti in quota, navaid; "Aerovie" mostra il
      messaggio sulla licenza (D-014).
- [ ] Ricerca per callsign, CID, nome, ICAO/IATA; filtri compagnia, tipo, partenza/arrivo, quota, solo amici.
- [ ] Modalità aereo: banner "offline", ultimi dati in cache; al ritorno della rete riprende da solo.
- [ ] Fluidità: scorrere su Europa/USA in orario di punta (1500+ piloti) senza scatti (Instruments → Animation Hitches).

### Dettaglio volo
- [ ] Rotta, traccia, grafici quota/velocità (scrubbing), ETA con affidabilità, ATC attuale e successivo.
- [ ] "Segui" avvia la Live Activity 📱 (Dynamic Island su iPhone 14 Pro+).

### Aeroporti
- [ ] METAR decodificato in linguaggio chiaro (it/en), categoria VFR/MVFR/IFR/LIFR, ATIS, controllori,
      prenotazioni, tabellone arrivi/partenze con stati ed ETA.

### Piloti e controllori
- [ ] SimBrief: inserisci username → import con un tap; username errato → messaggio dedicato.
- [ ] Copertura ATC lungo la rotta (barra verde/ambra/grigia + elenco settori con orari).
- [ ] "Dove volare stasera": classifica aeroporti e rotte con motivazioni.
- [ ] Calendario prenotazioni filtrabile per regione/divisione; previsione carico di settore.

### Eventi, profilo, social
- [ ] Eventi con banner, aeroporti coinvolti, "Mostra sulla mappa".
- [ ] Profilo da CID: ore per rating, pilota/ATC, grafici.
- [ ] Amici per CID; notifica quando un amico si collega (foreground immediata; background best-effort, D-030).
- [ ] Notifica quando apre l'ATC in un aeroporto preferito.
- [ ] Badge/sfide calcolati dai voli del proprio CID (serve volare su VATSIM con l'app aperta o con il refresh
      in background attivo); classifica settimanale (richiede iCloud + schema pubblico, §1.4).
- [ ] Card del volo condivisibile come immagine.

### Macchina del tempo
- [ ] Con la registrazione attiva, dopo qualche minuto lo slider permette il replay; "Live" torna al tempo reale.
- [ ] Server opzionale: vedi `Server/README.md`, poi imposta l'URL in Impostazioni.

### Esperienza Apple
- [ ] Widget: amici online, ATC in un aeroporto preferito (configurabile), prossimo evento, volo seguito.
- [ ] Live Activity e Dynamic Island 📱.
- [ ] App Watch 📱 (o simulatore accoppiato): voli seguiti, amici online, complicazioni.
- [ ] Assistente AI 📱: richiede iOS 26 + Apple Intelligence attiva su dispositivo compatibile; altrimenti la
      schermata spiega perché non è disponibile. Prova: "Dov'è attivo l'ATC in Italia adesso?".
- [ ] Mac (Designed for iPad): avvio, mappa, finestre ridimensionabili.

## 3. Cosa richiede un dispositivo reale
| Funzione | Motivo |
|---|---|
| Live Activity / Dynamic Island | il simulatore le mostra, ma aggiornamenti e Dynamic Island vanno verificati su iPhone |
| Background App Refresh e notifiche in background | il simulatore non pianifica BGTask in modo realistico (usa *Debug → Simulate Background Fetch*) |
| CloudKit (sync, classifiche) | serve un account iCloud reale; nel simulatore funziona solo con login iCloud |
| Apple Foundation Models | solo dispositivi con Apple Intelligence, iOS 26 |
| WatchConnectivity | coppia iPhone + Watch reale (o simulatori accoppiati) |
| Prestazioni 60 fps | misurare su device con Instruments |

## 4. Debug utili
- Simulare il background refresh: in Xcode, con l'app in pausa nel debugger:
  `e -l objc -- (void)[[BGTaskScheduler sharedScheduler] _simulateLaunchForTaskWithIdentifier:@"info.everyapp.contrail.refresh"]`
- Svuotare la cache: Impostazioni → Macchina del tempo → Elimina; oppure reinstallare l'app.
