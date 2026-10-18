/* Client Groq (piano gratuito): Whisper per la trascrizione e un LLM per il readback.
   La chiave resta solo nel tuo browser (localStorage).
   Groq ritira i modelli nel tempo: se quello impostato non esiste più, ne sceglie
   automaticamente uno disponibile e lo comunica con Groq.onModelChange(tipo, modello). */
(function (root) {
  'use strict';

  const BASE = 'https://api.groq.com/openai/v1';

  // Ordine di preferenza per il readback (il primo disponibile vince).
  const CHAT_PREF = [/gpt-oss-120b/, /llama-4-maverick/, /llama-3\.3-70b/, /llama-4-scout/, /kimi-k2/, /qwen3?-.*32b/, /gpt-oss-20b/, /llama.*70b/, /llama/, /qwen/, /gemma/];
  const NOT_CHAT = /whisper|guard|tts|orpheus|playai|compound|distil|embed|vision|audio|prompt/i;
  const STT_PREF = [/whisper-large-v3-turbo/, /whisper-large-v3/, /whisper/];

  const Groq = { onModelChange: null };
  const picked = {};
  const tr = (k, v) => (root.I18n ? root.I18n.t(k, v) : k);

  // Indirizzo di un server compatibile OpenAI: "http://127.0.0.1:8080" -> "http://127.0.0.1:8080/v1"
  function normalizeBase(url) {
    let u = String(url || '').trim().replace(/\/+$/, '');
    if (!u) return '';
    if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
    u = u.replace(/\/audio\/transcriptions$/, '');
    if (!/\/v\d+$/.test(u)) u += '/v1';
    return u;
  }

  async function call(path, key, init, base) {
    let res;
    const url = (base || BASE) + path;
    const headers = { ...(init.headers || {}) };
    if (key) headers.Authorization = `Bearer ${key}`;
    const opts = { ...init, headers };
    try {
      res = root.Net ? await root.Net.fetch(url, opts) : await fetch(url, opts);
    } catch (e) {
      throw new Error(base ? tr('groq.localUnreachable', { url: base }) : tr('groq.unreachable'));
    }
    if (!res.ok) {
      let detail = '';
      let code = '';
      try { const j = await res.json(); detail = j.error.message || ''; code = j.error.code || ''; } catch (e) { /* risposta non JSON */ }
      let msg = `${res.status} ${detail}`.trim();
      // Server Pro: il suo messaggio (licenza scaduta, minuti finiti) è più utile di quello generico
      if (res.status === 401) msg = base && detail ? detail : tr('groq.badKey');
      if (res.status === 403 && base && detail) msg = detail;
      if (res.status === 429) msg = base && detail ? detail : tr('groq.rateLimit');
      const err = new Error(msg);
      err.status = res.status;
      err.modelMissing = res.status === 404 || code === 'model_not_found' || code === 'model_decommissioned' || /model.*(does not exist|decommissioned|not found|not supported)/i.test(detail);
      err.jsonUnsupported = res.status === 400 && /response_format|json/i.test(detail);
      throw err;
    }
    return res.json();
  }

  async function listModels(key, base) {
    const data = await call('/models', key, { method: 'GET' }, normalizeBase(base));
    return (data.data || []).filter((m) => m.active !== false).map((m) => m.id).sort();
  }

  async function pickModel(key, kind) {
    if (picked[kind]) return picked[kind];
    const ids = await listModels(key);
    const pool = kind === 'stt' ? ids.filter((m) => /whisper/i.test(m)) : ids.filter((m) => !NOT_CHAT.test(m));
    const prefs = kind === 'stt' ? STT_PREF : CHAT_PREF;
    let model = null;
    for (const re of prefs) { model = pool.find((m) => re.test(m)); if (model) break; }
    model = model || pool[0];
    if (!model) throw new Error(kind === 'stt' ? tr('groq.noWhisper') : tr('groq.noChat'));
    picked[kind] = model;
    if (Groq.onModelChange) Groq.onModelChange(kind, model);
    return model;
  }

  // Esegue fn(modello); se il modello non esiste più ne sceglie un altro e riprova una volta.
  async function withModel(key, kind, wanted, fn) {
    const model = wanted || picked[kind] || await pickModel(key, kind);
    try {
      return await fn(model);
    } catch (e) {
      if (!e.modelMissing) throw e;
      delete picked[kind];
      const other = await pickModel(key, kind);
      if (other === model) throw e;
      return fn(other);
    }
  }

  /* Prompt per Whisper: solo VOCABOLARIO (fraseologia, nominativo, nomi delle stazioni).
     Niente numeri: con audio disturbato Whisper tende a copiare il prompt, e un numero di esempio
     (es. "squawk 4521") finirebbe nella trascrizione come se l'avesse detto l'ATC.
     Le cifre restano solo nel nominativo, che le verifiche escludono comunque. */
  const VOCAB = 'ATC radio phraseology: climb, descend, maintain, flight level, altitude, feet, heading, turn left, turn right, '
    + 'squawk, QNH, altimeter, contact, monitor, decimal, runway, taxi, holding point, hold short, line up and wait, '
    + 'cleared for takeoff, cleared to land, cleared ILS approach, via, direct, reduce speed, knots, '
    + 'Alpha, Bravo, Charlie, Delta, Echo, Foxtrot, Golf, Hotel, India, Juliett, Kilo, Lima, Mike, November, '
    + 'Oscar, Papa, Quebec, Romeo, Sierra, Tango, Uniform, Victor, Whiskey, X-ray, Yankee, Zulu.';

  function buildPrompt(callsign, context) {
    const cs = String(callsign || '').trim();
    const keep = new Set(cs.split(/\s+/).filter(Boolean));
    // Toglie ogni parola con cifre dal contesto, tranne quelle del nominativo
    const ctx = String(context || '').split(/\s+/).filter((w) => w && (!/\d/.test(w) || keep.has(w.replace(/[.,;]$/, '')))).join(' ');
    return [cs ? `${cs}.` : '', ctx ? `${ctx.replace(/[.,;\s]+$/, '')}.` : '', VOCAB].filter(Boolean).join(' ').slice(0, 900);
  }

  // Restituisce { text, segments } (segments con avg_logprob ecc. per valutare la qualità).
  // context: nominativo e nomi delle stazioni del volo, per aiutare Whisper (mai numeri).
  // base: server Whisper locale (compatibile OpenAI). Lì non si interroga /models: si usa il modello
  // indicato o "whisper-1", che whisper.cpp ignora e gli altri server mappano sul loro predefinito.
  function transcribe(wavBlob, { key, model, callsign, context, base }) {
    const local = normalizeBase(base);
    const run = local ? (fn) => fn(model || 'whisper-1') : (fn) => withModel(key, 'stt', model, fn);
    return run(async (m) => {
      const send = async (format) => {
        const form = new FormData();
        form.append('file', wavBlob, 'atc.wav');
        form.append('model', m);
        form.append('language', 'en');
        form.append('temperature', '0');
        form.append('response_format', format);
        form.append('prompt', buildPrompt(callsign, context));
        return call('/audio/transcriptions', key, { method: 'POST', body: form }, local);
      };
      let data;
      try {
        data = await send('verbose_json');
      } catch (e) {
        if (e.status !== 400 || (e.modelMissing && !local)) throw e;
        data = await send('json');
      }
      return { text: (data.text || '').trim(), segments: Array.isArray(data.segments) ? data.segments : [] };
    });
  }

  const SYSTEM = `You are an expert airline pilot helping a student pilot on VATSIM.
Given an ATC radio transmission transcript (it may contain speech-recognition errors) and the pilot's callsign,
produce the correct ICAO readback the pilot must say.
Rules: read back clearances, levels/altitudes, headings, speeds, squawk codes, QNH/altimeter, frequencies,
runway instructions (land, takeoff, line up, hold short, cross), taxi routes and conditional clearances (keep the condition).
End with the callsign the controller used (normally the pilot's own callsign). If the transmission has no callsign,
use the pilot's own callsign; if that is not set either, omit the callsign. NEVER write "unknown" or placeholders.
for_us is false only if the transmission is clearly addressed to a different callsign.
If nothing needs reading back, answer "Roger" (or "Wilco" for a request to report).
Use compact written form like "Descend FL80, left heading 270, Roma 125.5, Alitalia 123".
Write taxiways and holding points with phonetic words and commas, e.g. "Taxi holding point Alpha 2, runway 26L, via Papa, Alpha, Sierra".
PRECISION IS CRITICAL: copy every number (levels, altitudes, headings, speeds, frequencies, squawks, QNH, runways) exactly
as it appears in the transcript. Never add, guess, round or "correct" a number. If something is unclear, keep it as heard
and explain the doubt in "note".
Answer ONLY with JSON: {"for_us": boolean, "readback": string, "spoken": string (same readback written as pronounced, ICAO digits e.g. "flight level eight zero", "niner"), "note": string (short note in Italian about doubtful parts, or empty)}.`;

  function parseJson(text) {
    try { return JSON.parse(text); } catch (e) { /* cerca il primo oggetto JSON nel testo */ }
    const m = String(text || '').match(/\{[\s\S]*\}/);
    if (!m) throw new Error(tr('groq.badAi'));
    return JSON.parse(m[0]);
  }

  function readback(transcript, { key, model, callsign, base }) {
    const server = normalizeBase(base);
    const run = server ? (fn) => fn(model || 'readback-pro') : (fn) => withModel(key, 'chat', model, fn);
    return run(async (m) => {
      const body = {
        model: m,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Pilot's own callsign: ${callsign || '(not set)'}\nATC transmission: "${transcript}"` },
        ],
      };
      const send = () => call('/chat/completions', key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, server);
      let data;
      try {
        data = await send();
      } catch (e) {
        if (!e.jsonUnsupported) throw e;
        delete body.response_format;
        data = await send();
      }
      const text = data.choices && data.choices[0] && data.choices[0].message.content;
      const out = parseJson(text);
      if (!out.readback) throw new Error(tr('groq.emptyAi'));
      const noPlaceholder = (x) => String(x || '').replace(/,?\s*\(?\b(unknown|not set|callsign)\b\)?\.?\s*$/i, '').trim();
      out.readback = noPlaceholder(out.readback);
      out.spoken = noPlaceholder(out.spoken);
      out.model = m;
      return out;
    });
  }

  Object.assign(Groq, { transcribe, readback, listModels, pickModel, buildPrompt, normalizeBase, VOCAB });
  root.Groq = Groq;
})(this);
