# App per iPhone e Android: pubblicazione sugli store

L'app per telefono è la stessa app web di Readback Copilot, impacchettata con **Capacitor** (cartelle `android/` e `ios/`).

Ad ogni push, GitHub Actions compila:
- **Android**:
  - senza firma: un **APK di prova** da installare sul telefono;
  - con la firma: l'APK e l'**AAB** per Google Play.
- **iOS** (su un Mac di GitHub):
  - senza certificati verifica solo che compili;
  - con i certificati invia la build a **TestFlight**.

I file finiscono nella pagina **Releases**, insieme all'installer per Windows.

Bundle ID / applicationId: **`app.readbackcopilot.mobile`**.

---

## 1. Android: Google Play

### Keystore (la chiave di firma)
La chiave firma tutte le versioni dell'app. **Se la perdi non puoi più aggiornare l'app**: conservala con le password in un posto sicuro, per esempio un gestore di password.

```bash
keytool -genkeypair -v -keystore readback-release.jks -alias readback \
  -keyalg RSA -keysize 2048 -validity 10000
base64 -w0 readback-release.jks > keystore.txt   # su macOS: base64 -i readback-release.jks -o keystore.txt
```
(`keytool` è incluso in Java/Android Studio.)

### Secret su GitHub
Vai in *Settings → Secrets and variables → Actions → New repository secret* e crea:

| Secret | Valore |
|---|---|
| `ANDROID_KEYSTORE_BASE64` | il contenuto di `keystore.txt` |
| `ANDROID_KEYSTORE_PASSWORD` | la password del keystore |
| `ANDROID_KEY_ALIAS` | `readback` (l'alias scelto) |
| `ANDROID_KEY_PASSWORD` | la password della chiave (spesso uguale) |

Dal push successivo la release contiene `ReadbackCopilot-Android-1.0.N.aab`.

### Google Play Console
1. **Crea app**:
   - nome "Readback Copilot";
   - app gratuita;
   - lingua predefinita italiano.
2. **Configura la scheda**:
   - testi e immagini dalla sezione 4 qui sotto;
   - icona 512×512: `site/img/app-icon-512.png`;
   - grafica in evidenza 1024×500, anche uno screenshot ritagliato va bene.
3. **Contenuti dell'app**:
   - norme sulla privacy: link alla pagina privacy del sito;
   - accesso all'app: nessun login;
   - annunci: no;
   - classificazione dei contenuti: questionario, risultato "PEGI 3";
   - pubblico: maggiori di 13 anni;
   - sicurezza dei dati: vedi la sezione 5.
4. **Test → Test interno**: carica l'AAB e aggiungi la tua email come tester.
   - Gli account nuovi devono fare un **test chiuso con almeno 12 tester per 14 giorni** prima della produzione: è una regola di Google.
5. **Produzione**: promuovi la build quando il test è finito.

---

## 2. iOS: App Store (senza Mac, tutto da GitHub)

Servono l'account **Apple Developer** (99 $/anno) e queste cose dal sito [developer.apple.com](https://developer.apple.com/account):

1. **Identificatore**:
   - *Certificates, IDs & Profiles → Identifiers → +*;
   - App ID `app.readbackcopilot.mobile`;
   - nessuna capability speciale.
2. **Certificato di distribuzione**:
   - *Certificates → + → Apple Distribution*;
   - serve una richiesta CSR: senza Mac la crei con OpenSSL:
     ```bash
     openssl req -new -newkey rsa:2048 -nodes -keyout dist.key -out dist.csr -subj "/emailAddress=TUA@EMAIL/CN=Readback Copilot/C=IT"
     ```
   - carica `dist.csr`, scarica `distribution.cer`, poi crea il file .p12:
     ```bash
     openssl x509 -inform DER -in distribution.cer -out dist.pem
     openssl pkcs12 -export -legacy -inkey dist.key -in dist.pem -out dist.p12   # scegli una password
     base64 -w0 dist.p12 > cert.txt
     ```
3. **Profilo**:
   - *Profiles → + → App Store Connect*;
   - App ID `app.readbackcopilot.mobile` e il certificato appena creato;
   - scarica il file `.mobileprovision`, poi `base64 -w0 profilo.mobileprovision > profile.txt`.
4. **Chiave API di App Store Connect**:
   - [appstoreconnect.apple.com](https://appstoreconnect.apple.com) → *Users and Access → Integrations → App Store Connect API → +*, ruolo **App Manager**;
   - annota **Key ID** e **Issuer ID** e scarica il file `AuthKey_XXXX.p8` (si scarica una volta sola).
5. **App in App Store Connect**: *Apps → + → New App*:
   - piattaforma iOS;
   - nome "Readback Copilot";
   - bundle ID `app.readbackcopilot.mobile`;
   - SKU `readback-copilot`.

### Secret su GitHub

| Secret | Valore |
|---|---|
| `IOS_CERT_P12_BASE64` | il contenuto di `cert.txt` |
| `IOS_CERT_PASSWORD` | la password del .p12 |
| `IOS_PROFILE_BASE64` | il contenuto di `profile.txt` |
| `IOS_TEAM_ID` | il Team ID (10 caratteri, in *Membership details*) |
| `APPSTORE_KEY_ID` | Key ID della chiave API |
| `APPSTORE_ISSUER_ID` | Issuer ID |
| `APPSTORE_KEY_P8` | il contenuto del file `AuthKey_XXXX.p8`, comprese le righe BEGIN/END |

Dal push successivo la build arriva su **TestFlight** dopo 10-30 minuti di elaborazione da parte di Apple.
- Da lì la installi sul tuo iPhone con l'app TestFlight.
- Quando è pronta la invii alla revisione: *App Store → + versione → Build → Invia*.

**Revisione Apple: cose da sapere**
- Nelle "Note per la revisione" scrivi che l'app funziona anche senza PC e che il collegamento al PC è facoltativo, in rete locale.
- **Pro**: nell'app per telefono **non** si vende niente e non ci sono link all'acquisto (regola 3.1.1). Il Pro si attiverà con un acquisto in-app in una versione futura.
- "Sign in with Apple" non serve: l'app non ha account.

---

## 3. Versioni
- La versione dell'app è `1.0.N`, dove N è il numero di build di GitHub Actions (lo stesso delle release `build-N`), e cresce a ogni push.
- Per cambiare la versione "grande", modifica `1.0.` in `.github/workflows/build-windows.yml` (job `android` e `ios`).

## 4. Testi per gli store

**Nome**: Readback Copilot
**Sottotitolo (iOS, 30 caratteri)**: Copilota radio per VATSIM
**Descrizione breve (Google, 80 caratteri)**: Readback ATC corretti, allenamento radio e il tuo volo VATSIM sempre a portata.

**Descrizione (IT)**
> Readback Copilot è il copilota radio per chi vola su VATSIM e IVAO.
>
> • Readback in tempo reale: l'ATC parla, tu leggi la risposta corretta con la pronuncia ICAO, con i numeri verificati.
> • Collegato al PC: inquadra il QR del programma per Windows e sul telefono vedi readback, prossima chiamata e dati del simulatore, e comandi l'ascolto.
> • Allenamento a voce con ATC simulato e prova generale del tuo volo vero, con frequenze, QNH, fix e taxiway reali.
> • Carriera: da Allievo pilota a Training Captain, con badge e sfide del giorno.
> • Mappa con traffico dal vivo e controllori sui settori veri, meteo con previsione, piano da SimBrief.
> • Checklist A320 e 737, aiuto emergenze MAYDAY/PAN PAN, frasario ICAO, logbook.
> • In italiano, inglese, spagnolo, tedesco, francese e portoghese. Nessun account.
>
> Strumento di allenamento per la simulazione di volo: non per il volo reale. Non affiliato a VATSIM o IVAO.

**Description (EN)**
> Readback Copilot is the radio copilot for virtual pilots on VATSIM and IVAO.
>
> • Real-time readbacks: ATC speaks, you read the correct reply with ICAO pronunciation, with every number checked.
> • Connected to your PC: scan the QR code in the Windows app and your phone shows readbacks, the next call and simulator data, and controls listening.
> • Voice training with simulated ATC and a rehearsal of your real flight with real frequencies, QNH, fixes and taxiways.
> • Career: from Student pilot to Training Captain, with badges and daily challenges.
> • Live traffic map with controllers on their real sectors, weather with forecast, SimBrief flight plan.
> • A320 and 737 checklists, MAYDAY/PAN PAN emergency helper, ICAO phrasebook, logbook.
> • In English, Italian, Spanish, German, French and Portuguese. No account.
>
> A training tool for flight simulation, not for real-world flying. Not affiliated with VATSIM or IVAO.

**Parole chiave (iOS, 100 caratteri)**: vatsim,ivao,atc,readback,radio,pilot,flight simulator,msfs,x-plane,phraseology,icao

**Categoria**: Istruzione (secondaria: Viaggi)

**Screenshot**: già pronti in `docs/store/`, nelle misure richieste:

| Cartella | Uso | Pixel |
|---|---|---|
| `ios-6.9` | iPhone 6,9" | 1290×2796 |
| `ios-6.5` | iPhone 6,5" | 1242×2688 |
| `ipad-13` | iPad 13" | 2064×2752 |
| `android` | telefono Android | 1080×1920 |

Si rigenerano con `node scripts/screenshots.js --only store`.

## 5. Privacy per gli store (Apple "Privacy nutrition label", Google "Sicurezza dei dati")
- **Dati raccolti dallo sviluppatore**: nessuno per impostazione predefinita.
  - Con il consenso dell'utente: dati di utilizzo anonimi e diagnostica (errori), non collegati all'identità e non usati per il tracciamento.
  - Su Google: "Dati sull'app e sulle prestazioni → Log degli arresti anomali, Diagnostica", "Attività nell'app" (facoltativi).
- **Audio**:
  - con Groq/Pro l'audio viene inviato al servizio di trascrizione scelto dall'utente e non viene conservato;
  - il riconoscimento vocale nativo usa il servizio del telefono.
- **Crittografia**: solo HTTPS standard. L'app dichiara già `ITSAppUsesNonExemptEncryption = NO`.
- **Link alla privacy**: `https://<utente>.github.io/<repository>/privacy.html` (vedi sotto).

## 6. Il sito
Il sito è in `site/` e va online con GitHub Pages ad ogni push su `main`.
1. Attiva Pages una volta sola: *Settings → Pages → Source: GitHub Actions*.
2. In `site/config.js` inserisci i link agli store e alla pagina di acquisto del Pro quando li hai: i badge compaiono da soli.
