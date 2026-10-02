# Contrail

Client VATSIM per iPhone, iPad, Mac (Designed for iPad) e Apple Watch: tracking live, pianificazione del
volo e funzioni social in un'unica app, con una mappa a tutto schermo in stile "notte in cabina".

- **Mappa live** con migliaia di aerei (MapKit, clustering, globo 3D, satellite a zoom vicino), settori ATC
  colorati (FIR/UIR, TRACON, TWR/GND/DEL), radar meteo, SIGMET, venti in quota, navaid open.
- **Dettaglio volo**: rotta, traccia, grafici quota/velocità, ETA dalla posizione reale, ATC attuale e successivo.
- **Aeroporti**: METAR in linguaggio chiaro, ATIS, controllori, tabellone arrivi/partenze.
- **Piloti e controllori**: import SimBrief, previsione copertura ATC lungo la rotta, "dove volare stasera",
  calendario prenotazioni, previsione del carico di traffico di settore.
- **Social**: amici per CID con notifiche, badge e sfide, classifiche settimanali CloudKit, card condivisibili.
- **Macchina del tempo** locale (+ server opzionale 24/7 in `Server/`).
- **Apple**: Live Activity e Dynamic Island, widget, app Watch con complicazioni, assistente AI on-device
  (Foundation Models, iOS 26+), italiano e inglese.

## Struttura
Vedi [PLAN.md](PLAN.md) (architettura), [DECISIONS.md](DECISIONS.md) (scelte prese in autonomia) e
[TESTING.md](TESTING.md) (come configurare firme/capability e cosa provare).

```
Contrail.xcodeproj   App/  Widgets/  Watch/  WatchWidgets/  Config/
ContrailKit/         Swift Package: VatCore (logica, testata su Linux) + ContrailShared + recorder
Server/              recorder opzionale (Docker)
Tools/               script dati, icona, progetto Xcode, string catalog
```

## Avvio rapido
1. Xcode 26 su macOS 15.6+ → apri `Contrail.xcodeproj`.
2. Imposta il tuo Team su tutti e quattro i target (vedi TESTING.md §1).
3. Scheme **Contrail** → Run su simulatore iPhone 17 / iPad, o "My Mac (Designed for iPad)".
4. Test del core: `cd ContrailKit && swift test` (oppure `Tools/swift-docker.sh test` su Linux).

Dati forniti da VATSIM. Non usare per la navigazione reale.
