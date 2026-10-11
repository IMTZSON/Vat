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

  async function call(path, key, init) {
    let res;
    const opts = { ...init, headers: { Authorization: `Bearer ${key}`, ...(init.headers || {}) } };
    try {
      res = root.Net ? await root.Net.fetch(BASE + path, opts) : await fetch(BASE + path, opts);
    } catch (e) {
      throw new Error('Impossibile contattare Groq (connessione assente o bloccata).');
    }
    if (!res.ok) {
      let detail = '';
      let code = '';
      try { const j = await res.json(); detail = j.error.message || ''; code = j.error.code || ''; } catch (e) { /* risposta non JSON */ }
      let msg = `${res.status} ${detail}`.trim();
      if (res.status === 401) msg = 'Chiave Groq non valida (401).';
      if (res.status === 429) msg = 'Limite gratuito Groq raggiunto (429): aspetta un minuto.';
      const err = new Error(msg);
      err.status = res.status;
      err.modelMissing = res.status === 404 || code === 'model_not_found' || code === 'model_decommissioned' || /model.*(does not exist|decommissioned|not found|not supported)/i.test(detail);
      err.jsonUnsupported = res.status === 400 && /response_format|json/i.test(detail);
      throw err;
    }
    return res.json();
  }

  async function listModels(key) {
    const data = await call('/models', key, { method: 'GET' });
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
    if (!model) throw new Error(kind === 'stt' ? 'Nessun modello Whisper disponibile sul tuo account Groq.' : 'Nessun modello AI disponibile sul tuo account Groq.');
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

  function transcribe(wavBlob, { key, model, callsign }) {
    return withModel(key, 'stt', model, async (m) => {
      const form = new FormData();
      form.append('file', wavBlob, 'atc.wav');
      form.append('model', m);
      form.append('language', 'en');
      form.append('temperature', '0');
      form.append('response_format', 'json');
      // Il prompt aiuta Whisper con il gergo aeronautico e il nostro nominativo.
      form.append('prompt', `ATC radio. ${callsign ? `${callsign}, ` : ''}descend FL80, turn left heading 270, squawk 4521, QNH 1013, contact Roma Radar 125.5, cleared to land runway 16L.`);
      const data = await call('/audio/transcriptions', key, { method: 'POST', body: form });
      return (data.text || '').trim();
    });
  }

  const SYSTEM = `You are an expert airline pilot helping a student pilot on VATSIM.
Given an ATC radio transmission transcript (it may contain speech-recognition errors) and the pilot's callsign,
produce the correct ICAO readback the pilot must say.
Rules: read back clearances, levels/altitudes, headings, speeds, squawk codes, QNH/altimeter, frequencies,
runway instructions (land, takeoff, line up, hold short, cross), taxi routes and conditional clearances (keep the condition).
Put the callsign at the end. If nothing needs reading back, answer "Roger" (or "Wilco" for a request to report).
Use compact written form like "Descend FL80, left heading 270, Roma 125.5, Alitalia 123".
Answer ONLY with JSON: {"for_us": boolean, "readback": string, "spoken": string (same readback written as pronounced, ICAO digits e.g. "flight level eight zero", "niner"), "note": string (short note in Italian about doubtful parts, or empty)}.`;

  function parseJson(text) {
    try { return JSON.parse(text); } catch (e) { /* cerca il primo oggetto JSON nel testo */ }
    const m = String(text || '').match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Risposta AI non valida.');
    return JSON.parse(m[0]);
  }

  function readback(transcript, { key, model, callsign }) {
    return withModel(key, 'chat', model, async (m) => {
      const body = {
        model: m,
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Pilot callsign: ${callsign || 'unknown'}\nATC transmission: "${transcript}"` },
        ],
      };
      const send = () => call('/chat/completions', key, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
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
      if (!out.readback) throw new Error('Risposta AI vuota.');
      out.model = m;
      return out;
    });
  }

  Object.assign(Groq, { transcribe, readback, listModels, pickModel });
  root.Groq = Groq;
})(this);
