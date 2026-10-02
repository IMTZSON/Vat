# Decisioni prese in autonomia

Ogni ambiguità è stata risolta con l'opzione più sensata, annotata qui. ID stabili per poterle citare.

## Progetto e ambiente

**D-001 — Nome app.** Il prompt conteneva il segnaposto `[NOME APP]`. Scelto **Contrail** (la scia di
condensazione: richiama il tracking delle tracce). Per rinominare: `INFOPLIST_KEY_CFBundleDisplayName`
nei target e le stringhe "Contrail" in `Localizable.xcstrings`. Bundle id base: `info.everyapp.contrail`.

**D-002 — Compilazione senza macOS.** La sessione di sviluppo gira su un container **Linux** senza Xcode,
quindi `xcodebuild` non è eseguibile qui. Strategia adottata:
- tutta la logica (parsing, rete, geometria, ETA, previsioni, badge, time machine) vive nel package
  `ContrailKit/VatCore`, Foundation-only, **compilato e testato a ogni modulo** con Swift 6 su Linux
  (`docker run swift:6.x swift test`);
- il codice UI (SwiftUI, MapKit, WidgetKit, ActivityKit, CloudKit, FoundationModels) non può essere
  compilato qui: è stato scritto per Xcode 26 / iOS 26 SDK e rivisto con passaggi di revisione dedicati.
  La prima `xcodebuild` reale va fatta sul Mac (istruzioni in TESTING.md); eventuali errori residui
  saranno di natura superficiale (firma di API) e localizzati.

**D-003 — Progetto Xcode.** Scritto a mano con *file system synchronized groups* (Xcode 16+,
`objectVersion = 77`): ogni target punta a una cartella, i file nuovi vengono inclusi automaticamente.
È incluso anche `project.yml` per XcodeGen come alternativa se il `.pbxproj` desse problemi.

**D-004 — Toolchain minima.** Xcode 26 (Swift 6.2) perché servono le API iOS 26 (Foundation Models,
`glassEffect`) dietro `#available`. Deployment target iOS 18.0, watchOS 11.0. I target app usano
`SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` e `SWIFT_APPROACHABLE_CONCURRENCY = YES`.

## Fonti dati e verifica endpoint

**D-010 — Verifica della documentazione.** Dal container, `vatsim.dev`, `status.vatsim.net`,
`rainviewer.com` e `aviationweather.gov` sono bloccati dal proxy di rete. La verifica è stata fatta
tramite ricerca web sulle pagine ufficiali (vatsim.dev "Get live network data", "List online audio
clients", "Get a member's statistics", "List events", atc-bookings.vatsim.net/api-doc, Navigraph
"Fetching a User's Latest OFP Data", RainViewer "Weather Maps API" + "API Transition FAQ",
aviationweather.gov "Data API") e sui tipi open source della libreria `MorpheusXAUT/vatsim-api`.
Risultati:
- Feed v3 rigenerato ogni **15 s**; URL da `status.json` (`data.v3[]`, `data.transceivers[]`). Polling
  minimo 15 s, mai più frequente, `If-Modified-Since`.
- Transceivers: `[{callsign, transceivers:[{id, frequency(Hz), latDeg, lonDeg, heightMslM, heightAglM}]}]`.
- Eventi: `https://my.vatsim.net/api/v2/events/latest` (pubblico).
- Stats: `https://api.vatsim.net/v2/members/{cid}/stats` (pubblico, anonimo).
- Booking: `GET https://atc-bookings.vatsim.net/api/booking` con filtri `date`, `type`, `division`, `subdivision`.
- RainViewer: dal **1° gennaio 2026** zoom massimo **7**, limite **100 richieste/IP/min**, niente nowcast
  né satellite. → `MKTileOverlay` personalizzato che sopra z7 ritaglia e scala il tile padre.
- aviationweather.gov: max **100 richieste/min**, non più di 1 richiesta/min per prodotto. → cache 10 min.
- SimBrief: `xml.fetcher.php?username=…&json=v2` (consigliato rispetto a `json=1`), 400 se utente errato.

**D-011 — Decoder tolleranti.** Ogni campo del feed è opzionale nella decodifica (property wrapper
`@Lenient`/`decodeIfPresent` con default): un campo mancante o di tipo inatteso non scarta il record e
non causa crash. Record invalidi vengono saltati singolarmente (`LossyArray`).

**D-012 — Confini settori.** Bundle: VATSpy.dat + FIR `Boundaries.geojson` (VATSpy Data Project) e
`TRACONBoundaries.geojson` compilato dalle cartelle `Boundaries/` di SimAware (stesso algoritmo dello
script ufficiale `compile.ts`), coordinate arrotondate a 5 decimali (~1 m). All'avvio (max 1×/giorno)
l'app chiede `https://api.vatsim.net/api/map_data/` per gli URL VATSpy aggiornati e scarica
`releases/latest/download/TRACONBoundaries.geojson` di SimAware; fallback silenzioso al bundle.

**D-013 — Settori TWR/GND/DEL.** Né VATSpy né SimAware forniscono poligoni per TWR/GND/DEL/ATIS: sono
disegnati come anelli concentrici attorno all'aeroporto (DEL < GND < TWR), stile VATSIM Radar.
APP/DEP senza poligono SimAware → cerchio di 40 NM attorno all'aeroporto.

**D-014 — Aerovie e waypoint.** I dati AIRAC (fix, aerovie, SID/STAR) sono soggetti a licenza
(Navigraph/Jeppesen). Inclusi solo dati open: **navaid (VOR/NDB/DME) da OurAirports, pubblico dominio**.
Il layer "Aerovie" ha interfaccia e modello pronti (`AirwayProvider` protocollo) ma nessun fornitore
attivo: attivabile collegando un provider con licenza. La rotta del piano di volo viene risolta usando
aeroporti, navaid open, coordinate esplicite (`4530N01015E`, `45N010E`) e i waypoint del piano SimBrief
importato (che includono le coordinate); i fix non risolti vengono saltati.

**D-015 — Venti in quota.** aviationweather.gov espone solo la tabella FD (`windtemp`) per gli USA.
Usata per le stazioni USA (coordinate ricavate dagli aeroporti VATSpy `K`+ID). Per il resto del mondo
si usa **Open-Meteo** (gratuito, senza chiave, CC BY 4.0) con una griglia di punti nella regione
visibile a 250 hPa (~FL340). Attribuzione in Info.

**D-016 — Storico voli per i badge.** I badge si calcolano dai voli del proprio CID **osservati
dall'app** (ogni volta che il CID appare nel feed il volo viene registrato in SwiftData con
partenza/arrivo/esito) più, se disponibile, lo storico piani di volo dall'API VATSIM
(`/v2/members/{cid}/flightplans`, decodifica tollerante). Un volo conta come "atterrato" a un aeroporto
se l'aereo è stato visto a terra entro 5 NM dall'arrivo con GS < 40 kt.

**D-017 — METAR.** `metar.vatsim.net` restituisce testo semplice; decodifica in linguaggio naturale
fatta localmente (vento, visibilità, fenomeni, nubi, temperatura, QNH, categoria VFR/MVFR/IFR/LIFR).

## Privacy e policy VATSIM

**D-020 — Policy dati VATSIM.** Attribuzione "Data provided by VATSIM" in Info e nella mappa; nessun uso
commerciale; i nomi reali vengono mostrati solo come forniti dal feed e **non** vengono salvati negli
snapshot della macchina del tempo (solo CID, callsign, posizione, quota, velocità, heading, piano
ridotto). Snapshot locali con retention configurabile (default 7 giorni, max 30). Nessun polling più
frequente della rigenerazione del feed.

**D-021 — CloudKit.** Database **privato** per amici seguiti/preferiti (sync tra dispositivi via
SwiftData+CloudKit); database **pubblico** solo per le classifiche settimanali (record
`LeaderboardEntry`: CID, punteggio, settimana ISO, nome visualizzato scelto dall'utente — opzionale).
Senza account iCloud l'app funziona in locale e nasconde le classifiche.

## UX

**D-030 — Notifiche amici in background.** iOS non garantisce frequenza del Background App Refresh
(tipicamente 15–60 min). Le notifiche "amico online"/"ATC aperto" sono quindi best-effort; in
foreground sono istantanee (dal diff del feed). Documentato in TESTING.md.

**D-031 — Globo 3D.** MapKit mostra il globo con `MapStyle.imagery/hybrid(elevation: .realistic)` a
zoom lontano. La mappa passa automaticamente a satellite/ibrida sotto ~30 km di distanza camera
(rullaggio e gate visibili) e torna allo stile scuro "notturno" (standard, `.muted`, dark) sopra.

**D-032 — Clustering.** Con migliaia di aerei si usa `MKMapView` (UIViewRepresentable) invece della
`Map` SwiftUI: annotazioni riciclate, `clusteringIdentifier` a zoom basso, aggiornamento differenziale
delle coordinate (KVO `coordinate` animato) → 60 fps. La `Map` SwiftUI è usata nelle viste secondarie.
