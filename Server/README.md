# Contrail Recorder (opzionale)

Piccolo servizio che registra la rete VATSIM 24/7 per la **macchina del tempo** di Contrail.

L'app registra già da sola mentre è aperta (snapshot locali, retention configurabile). Il recorder serve
solo a chi vuole uno storico **continuo**, anche quando l'iPhone è in tasca: gira su qualsiasi macchina
Linux/macOS con Docker (un mini PC, un NAS, una VPS da pochi euro) e pubblica gli snapshot via HTTP
statico; nell'app basta indicare l'URL del server nelle impostazioni della macchina del tempo.

## Cosa fa

1. Legge `https://status.vatsim.net/status.json` (ogni 6 h) e prende l'URL del feed da `data.v3[0]`
   (fallback: `https://data.vatsim.net/v3/vatsim-data.json`).
2. Scarica il feed **ogni 15 s, mai più spesso** (il feed viene rigenerato ogni 15 s); se il feed non è
   cambiato non scrive nulla. In caso di errore riprova con backoff esponenziale (30 s → 5 min).
3. Converte il feed in uno snapshot binario compatto (`CompactSnapshot` + `SnapshotCodec`, formato `CTRL`
   v1, ~38 byte per pilota) e lo salva come `AAAA/MM/GG/HH/<unix>.ctrl` (UTC).
4. Aggiorna `index.json` nella radice (`from`, `to`, `count`, `hours`) e `index.json` di ogni cartella
   oraria (elenco dei timestamp), così un server statico basta per servire tutto all'app.
5. Ogni ora cancella gli snapshot più vecchi della retention (default **7 giorni**, massimo **30**).
6. Su `SIGINT`/`SIGTERM` termina in modo pulito (completa la scrittura in corso).

## Avvio rapido

```bash
cd Server
docker compose up -d --build        # recorder + Caddy sulla porta 8080
curl http://localhost:8080/index.json
```

Retention diversa (1…30 giorni):

```bash
RETENTION_DAYS=14 docker compose up -d
```

Solo il binario, senza Docker (Swift 6.2):

```bash
cd ContrailKit
swift build -c release --product contrail-recorder
.build/release/contrail-recorder --output /var/lib/contrail --interval 15 --retention-days 7
# --once        scarica e salva un solo snapshot (utile per cron/test)
# --feed-url    salta status.json e usa direttamente un URL del feed
```

Immagine Docker a mano (dalla radice del repository):

```bash
docker build -f Server/Dockerfile -t contrail-recorder .
docker run -d --name contrail-recorder -v contrail-snapshots:/data contrail-recorder --retention-days 7
```

Il container gira come utente non privilegiato (uid 10001). Con un bind mount al posto del volume
(`-v ./data:/data`) assegnare prima la cartella: `sudo chown 10001 ./data`.

## Server HTTP

`docker-compose.yml` affianca al recorder **Caddy 2** (`Caddyfile`), che serve la cartella degli snapshot
in sola lettura sulla porta **8080** con:

- intestazioni **CORS** (`Access-Control-Allow-Origin: *`), metodi `GET/HEAD/OPTIONS`;
- compressione `zstd`/`gzip` al volo;
- `Cache-Control: no-cache` per gli `index.json` e `immutable` per i file `.ctrl` (non cambiano mai).

Per esporlo su Internet mettere davanti un reverse proxy con HTTPS (Caddy lo fa da solo con un dominio:
sostituire `:8080` con `recorder.example.org`) o usare una VPN (Tailscale/WireGuard). Non serve altro:
nessun database, nessuna API dinamica.

Struttura servita:

```
index.json                         {"count":5760,"from":"…","hours":["2026/10/02/09",…],"retentionDays":7,"to":"…"}
2026/10/02/09/index.json           {"hour":"2026/10/02/09","timestamps":[1790932500,1790932515,…]}
2026/10/02/09/1790932500.ctrl      snapshot binario (SnapshotCodec v1)
```

## Spazio su disco

Misurato con il codec: **1500 piloti + 150 controllori ≈ 57 KB** per snapshot (circa 38 byte per pilota
più la tabella delle stringhe). Con uno snapshot ogni 15 s si hanno **5760 snapshot al giorno**:

| Retention | Calcolo | Spazio |
|-----------|---------|--------|
| 1 giorno  | 5760 × 57 KB | ≈ **330 MB** |
| 7 giorni (default) | 7 × 330 MB | ≈ **2,3 GB** |
| 30 giorni (max) | 30 × 330 MB | ≈ **9,9 GB** |

Con la stima prudente di 50 KB per snapshot: 50 KB × 5760 ≈ 288 MB/giorno (≈ 2 GB a settimana).
Nei picchi (eventi con 2500+ piloti) uno snapshot arriva a ~95 KB: conviene prevedere un margine del 50 %.
La CPU è trascurabile (una decodifica JSON ogni 15 s); in ingresso si scarica il feed JSON completo ogni
15 s, esattamente come qualsiasi client che segue la rete in tempo reale.

## Privacy e policy VATSIM

- **Nessun nome**: gli snapshot contengono solo CID, nominativo, posizione, quota, velocità, prua,
  partenza/arrivo e tipo di aeromobile per i piloti; CID, nominativo, frequenza e tipo di posizione per i
  controllori (DECISIONS **D-020**). I nomi reali presenti nel feed non vengono mai scritti su disco.
- **Nessun uso commerciale**: i dati sono forniti da VATSIM ("Data provided by VATSIM") e restano soggetti
  alla [VATSIM Data Access Policy](https://vatsim.net/docs/policy/data-access-policy); non rivendere né
  ripubblicare in massa lo storico, e rispettare le richieste di rimozione dei membri.
- **Frequenza**: mai più di una richiesta ogni 15 s al feed e una ogni 6 h a `status.json`.
- **Retention**: default 7 giorni, massimo 30 (oltre il recorder taglia comunque a 30). Lo storico è
  pensato per uso personale o di una piccola community; se lo esponete pubblicamente valutate
  un'autenticazione (es. `basicauth` di Caddy) per non diventare un mirror non ufficiale dei dati VATSIM.

## Sviluppo

Il codice è in `ContrailKit/Sources/ContrailRecorder` (CLI) e usa `VatCore` (`VatsimFeed`,
`CompactSnapshot`, `SnapshotCodec`, `SnapshotStore`). I test della logica girano su Linux con
`Tools/swift-docker.sh test`.
