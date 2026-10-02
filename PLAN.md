# Contrail — Piano di sviluppo

> Nome di lavoro dell'app: **Contrail** (il prompt conteneva il segnaposto `[NOME APP]`, vedi DECISIONS.md D-001).
> Client VATSIM per iPhone, iPad, Mac (Designed for iPad), Apple Watch: tracking live, pianificazione, social.

## 1. Architettura

```
Vat/
├── PLAN.md · DECISIONS.md · TESTING.md · README.md
├── Contrail.xcodeproj            ← progetto Xcode 26 (cartelle sincronizzate, objectVersion 77)
├── project.yml                   ← alternativa XcodeGen (stesso layout)
├── ContrailKit/                  ← Swift Package locale (SPM, nessuna dipendenza esterna)
│   ├── Package.swift
│   ├── Sources/VatCore/          ← logica pura Foundation-only, compila anche su Linux
│   │   ├── Models/               DTO feed v3, transceivers, eventi, booking, stats, SimBrief, meteo
│   │   ├── Networking/           HTTPClient, endpoint, discovery status.json, cache, rate-limit
│   │   ├── Parsing/              METAR decoder, VATSpy.dat, GeoJSON, route string
│   │   ├── Geo/                  great-circle, bearing, point-in-polygon, bbox, simplify
│   │   ├── Sectors/              SectorIndex: callsign controllore → FIR/UIR/TRACON/aeroporto
│   │   ├── Flight/               fase volo, ETA, progresso, traccia
│   │   ├── Planning/             copertura ATC lungo la rotta, carico traffico, "dove volare stasera"
│   │   ├── Social/               motore badge e sfide, classifiche (logica pura)
│   │   └── TimeMachine/          codec snapshot compatto + interpolazione replay
│   ├── Sources/ContrailShared/   ← Apple-only: design tokens, ActivityAttributes, App Group store
│   ├── Sources/ContrailRecorder/ ← eseguibile Linux/macOS: server opzionale di registrazione 24/7
│   └── Tests/VatCoreTests/       ← XCTest: parsing feed, ETA, geometria settori, badge, METAR…
├── App/                          ← target iOS (iPhone/iPad/Mac)
│   ├── ContrailApp.swift, AppModel.swift (root @Observable)
│   ├── Services/                 FeedStore, DataRepository, Persistence (SwiftData), CloudKit,
│   │                             Notifications, BackgroundRefresh, LiveActivityController
│   ├── DesignSystem/             componenti vetro, skeleton, stati vuoti/errore, haptics
│   ├── Features/
│   │   ├── Map/                  mappa live, annotazioni, settori, layer meteo, ricerca, filtri
│   │   ├── FlightDetail/         rotta, traccia, grafici quota/velocità, ETA, ATC lungo rotta
│   │   ├── Airports/             METAR decodificato, ATIS, controllori, tabellone
│   │   ├── Pilot/                SimBrief, previsione copertura ATC, "dove volare stasera"
│   │   ├── Controller/           calendario booking, previsione carico settore
│   │   ├── Events/               lista eventi, dettaglio, scorciatoia mappa
│   │   ├── Friends/              amici, badge, sfide, classifiche, card condivisibile
│   │   ├── Profile/              statistiche CID, grafici, impostazioni, Info/attribuzioni
│   │   ├── TimeMachine/          registrazione locale e replay con slider
│   │   ├── Assistant/            AI on-device (Foundation Models, iOS 26+)
│   │   └── Onboarding/           3 passi: CID, aeroporti preferiti, notifiche
│   └── Resources/                Assets (icona originale, colori), Localizable.xcstrings (it/en),
│                                 Data/ (VATSpy.dat, FIR/TRACON GeoJSON, navaid open)
├── Widgets/                      ← Widget Extension: widget + Live Activity/Dynamic Island
├── Watch/                        ← app watchOS (voli seguiti, amici online)
├── WatchWidgets/                 ← complicazioni watchOS (WidgetKit)
├── Server/                       ← Dockerfile + docker-compose per il recorder opzionale
└── Tools/                        ← script dati (build_data.py) e icona (make_icon.py)
```

### Pattern
- **MVVM con `@Observable`**: ogni feature ha un ViewModel `@Observable @MainActor`; le View sono sottili.
- **Swift 6** con concorrenza stretta. Il package `VatCore` è nonisolated e tutto `Sendable`; i target
  app/widget/watch usano `SWIFT_DEFAULT_ACTOR_ISOLATION = MainActor` (Xcode 26).
- **Dati**: `FeedService` (actor) scarica il feed ogni 15 s rispettando `ETag/Last-Modified`, decodifica
  in background, produce uno `NetworkSnapshot` immutabile e un **diff** (aggiunti/rimossi/aggiornati) che
  la mappa applica alle annotazioni senza ricrearle.
- **Cache**: ultimo feed su disco (offline), SwiftData per preferiti/amici/voli seguiti/badge/storico.
- **Dipendenze esterne**: nessuna.

## 2. Moduli e ordine di sviluppo

| # | Modulo | Contenuto | Chi |
|---|--------|-----------|-----|
| 0 | Scaffolding | repo, PLAN/DECISIONS, Package, dati bundle, progetto Xcode, shell app, design system | main |
| 1 | Core dati/rete | modelli, decoder feed tollerante, endpoint, cache, METAR, VATSpy/GeoJSON, settori | subagent A |
| 2 | Core logica | ETA, fasi, rotta, copertura ATC, carico traffico, stasera, badge, time machine + test | subagent B |
| 3 | Mappa | MapKit, annotazioni diff, clustering, settori, layer meteo, ricerca/filtri, sheet vetro | subagent C |
| 4 | Dettaglio volo · Aeroporti · Pilota · Controllore | Swift Charts, METAR chiaro, tabellone, SimBrief | subagent D |
| 5 | Widget · Live Activity · Watch | WidgetKit, ActivityKit, app watchOS + complicazione | subagent E |
| 6 | Social · Eventi · Profilo | CloudKit, amici, notifiche, background refresh, badge, classifiche, card | subagent F |
| 7 | Time machine · AI · Onboarding · Info · Localizzazione | replay, Foundation Models, it/en | subagent G |
| 8 | Integrazione e revisione | review di compilazione cross-modulo, test, TESTING.md | main |

Ogni modulo: build (`swift build`/`swift test` del package in Docker su Linux; `xcodebuild` sul Mac — vedi
DECISIONS D-002) → correzioni → **un commit per modulo**.

## 3. Navigazione e design
- `TabView` con 5 tab: **Mappa, Aeroporti, Eventi, Amici, Profilo** (iOS 18 `Tab` API, sidebar adattiva su iPad/Mac).
- Mappa a tutto schermo; bottom sheet `.presentationDetents` con `.ultraThinMaterial` (e `glassEffect` su iOS 26).
- Palette notturna: fondo `#0A1020`, ciano `#3FD8F2`, ambra `#FFB547`; stati: verde = ATC online,
  ambra = prenotato, grigio = offline. Numeri in SF Pro Rounded (`.fontDesign(.rounded)`, `monospacedDigit`).
- Animazioni spring, `matchedGeometryEffect` (sheet volo ↔ card), haptics leggeri (`sensoryFeedback`),
  skeleton (`redacted(.placeholder)` + shimmer), stati vuoti (`ContentUnavailableView`) ed errori curati.

## 4. Dati e frequenze
| Fonte | Endpoint | Frequenza |
|-------|----------|-----------|
| Status | `https://status.vatsim.net/status.json` | all'avvio, poi ogni 6 h |
| Feed v3 | da status.json `data.v3[]` | 15 s (mai meno), solo in foreground |
| Transceivers | da status.json `data.transceivers[]` | 60 s, solo se servono frequenze |
| METAR | `https://metar.vatsim.net/{ICAO}` | on demand, cache 5 min |
| Booking ATC | `https://atc-bookings.vatsim.net/api/booking` | cache 10 min |
| Eventi | `https://my.vatsim.net/api/v2/events/latest` | cache 30 min |
| Stats membro | `https://api.vatsim.net/v2/members/{cid}/stats` | cache 1 h |
| Confini | api.vatsim.net/api/map_data + GitHub release SimAware | 1×/giorno, fallback bundle |
| Radar | RainViewer `weather-maps.json` | 10 min, tile ≤ z7 |
| SIGMET | aviationweather.gov `isigmet`/`airsigmet` GeoJSON | 10 min |
| Venti in quota | aviationweather.gov `windtemp` (USA) + Open-Meteo (globale) | 1 h |
| SimBrief | `https://www.simbrief.com/api/xml.fetcher.php?username=…&json=v2` | on demand |
