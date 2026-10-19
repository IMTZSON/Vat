# Readback Copilot Pro: come metterlo online

Il Pro include la trascrizione e l'AI, così chi lo compra **non deve creare una chiave Groq**.

Come funziona:
1. Il cliente compra il Pro su **Lemon Squeezy** e riceve via email una **chiave di licenza**.
2. Nel programma va in **Impostazioni → Riconoscimento vocale → Pro**, incolla la chiave e preme **Attiva**.
3. Il programma manda l'audio al tuo **server Pro** (un Cloudflare Worker). Il server:
   - controlla la licenza su Lemon Squeezy (con una cache di un'ora);
   - conta i minuti del mese;
   - inoltra l'audio a Groq con **la tua** chiave, che non lascia mai il server.

Il codice del server è in `server/pro/` ed è coperto dai test in `tests/pro-worker.test.js`.

## Costi
- **Cloudflare Workers**: piano gratuito fino a 100.000 richieste al giorno. Un volo fa circa 50–150 richieste.
- **Groq**: Whisper large-v3-turbo costa pochi centesimi per ora di audio. Un volo di 90 minuti ha 10–20 minuti di parlato ATC, quindi circa un centesimo a volo. Per l'uso commerciale serve un account Groq a pagamento (Developer).
- **Lemon Squeezy**: commissione sulle vendite. Fa da *merchant of record*, quindi IVA e fatture le gestisce lui.

## 1. Lemon Squeezy (pagamenti e licenze)
1. Crea un account su lemonsqueezy.com e un negozio.
2. Crea un prodotto **"Readback Copilot Pro"** in abbonamento, per esempio 3,99 €/mese e 29 €/anno come variante.
3. Nel prodotto attiva **"Generate license keys"**:
   - limite di attivazioni: 2 o 3 PC;
   - durata: legata all'abbonamento.
4. Annota:
   - lo **Store ID** (Settings → Stores);
   - l'**ID del prodotto** (nell'URL del prodotto);
   - il **link di acquisto** (Share → Checkout URL).

## 2. Groq
1. Su console.groq.com crea una chiave API dedicata al Pro.
2. Passa al piano a pagamento per avere limiti adatti a più utenti.

## 3. Cloudflare Worker
Ti servono Node.js e un account Cloudflare gratuito.
```
cd server/pro
npx wrangler login
npx wrangler kv namespace create PRO_KV        # copia l'id in wrangler.toml
npx wrangler secret put GROQ_API_KEY           # incolla la chiave Groq del Pro
```
In `wrangler.toml` compila `LS_STORE_ID`, `LS_PRODUCT_IDS` e l'`id` del namespace KV, poi pubblica:
```
npx wrangler deploy
```
Ottieni un indirizzo tipo `https://readback-copilot-pro.<tuo-account>.workers.dev`. Con un dominio tuo puoi usare per esempio `https://pro.readbackcopilot.app` (Workers → Settings → Domains & Routes).

## 4. Collegare il programma
In `package.json` compila:
```json
"pro": {
  "endpoint": "https://readback-copilot-pro.<tuo-account>.workers.dev",
  "checkout": "https://<tuo-negozio>.lemonsqueezy.com/buy/<id>"
}
```
Al prossimo push la build per Windows include il Pro:
- in Impostazioni compare **Pro**, con i pulsanti **Attiva** e **Acquista Pro**;
- finché `endpoint` è vuoto, l'opzione resta nascosta.

## Controlli fatti dal server
- Accetta solo licenze **attive** del **tuo negozio** e dei **tuoi prodotti**. Una chiave di un altro negozio Lemon Squeezy viene rifiutata.
- Ogni installazione usa un'attivazione: il limite lo decidi su Lemon Squeezy.
- **Limite mensile** di minuti per licenza (`MONTHLY_MINUTES`, predefinito 20 ore). Oltre il limite il programma mostra "Limite mensile di minuti del Pro raggiunto".
- Audio massimo di circa 2 minuti per richiesta. Per l'AI, richieste ripulite e risposte limitate: nessuno può usare il tuo server come Groq gratis.
- Se Groq ritira un modello, il server ne sceglie un altro da solo.

## Statistiche anonime (facoltative)
Lo stesso Worker riceve anche le statistiche anonime, solo dagli utenti che le attivano (rotta `/v1/t`).
1. Nel pannello Cloudflare attiva **Workers Analytics Engine**. Il dataset `readback_copilot` è già indicato in `wrangler.toml` (binding `TELEMETRY`).
2. `npx wrangler deploy`.
3. In `package.json` metti l'indirizzo del Worker nel campo `"telemetry"` (per esempio `"https://readback-copilot-pro.TUONOME.workers.dev"`): programma e app lo usano dalla build successiva.
4. Consulta i dati con le query SQL di Analytics Engine (*Workers → Analytics Engine*). Per esempio, utenti attivi al giorno:
   `SELECT blob2 AS giorno, count(DISTINCT index1) FROM readback_copilot WHERE blob1 = 'usage' GROUP BY giorno ORDER BY giorno`.

