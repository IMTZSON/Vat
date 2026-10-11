/* Client Groq (piano gratuito): Whisper per la trascrizione e un LLM per il readback.
   La chiave resta solo nel tuo browser (localStorage). */
(function (root) {
  'use strict';

  const BASE = 'https://api.groq.com/openai/v1';

  async function call(path, key, init) {
    let res;
    const opts = { ...init, headers: { Authorization: `Bearer ${key}`, ...(init.headers || {}) } };
    try {
      res = root.Net ? await root.Net.fetch(BASE + path, opts) : await fetch(BASE + path, opts);
    } catch (e) {
      throw new Error('Impossibile contattare Groq (connessione assente o bloccata).');
    }
    if (!res.ok) {
      let msg = `${res.status}`;
      try { msg += ` ${(await res.json()).error.message}`; } catch (e) { /* risposta non JSON */ }
      if (res.status === 401) msg = 'Chiave Groq non valida (401).';
      if (res.status === 429) msg = 'Limite gratuito Groq raggiunto (429): aspetta un minuto.';
      throw new Error(msg);
    }
    return res.json();
  }

  async function transcribe(wavBlob, { key, model, callsign }) {
    const form = new FormData();
    form.append('file', wavBlob, 'atc.wav');
    form.append('model', model || 'whisper-large-v3-turbo');
    form.append('language', 'en');
    form.append('temperature', '0');
    form.append('response_format', 'json');
    // Il prompt aiuta Whisper con il gergo aeronautico e il nostro nominativo.
    form.append('prompt', `ATC radio. ${callsign ? `${callsign}, ` : ''}descend FL80, turn left heading 270, squawk 4521, QNH 1013, contact Roma Radar 125.5, cleared to land runway 16L.`);
    const data = await call('/audio/transcriptions', key, { method: 'POST', body: form });
    return (data.text || '').trim();
  }

  const SYSTEM = `You are an expert airline pilot helping a student pilot on VATSIM.
Given an ATC radio transmission transcript (it may contain speech-recognition errors) and the pilot's callsign,
produce the correct ICAO readback the pilot must say.
Rules: read back clearances, levels/altitudes, headings, speeds, squawk codes, QNH/altimeter, frequencies,
runway instructions (land, takeoff, line up, hold short, cross), taxi routes and conditional clearances (keep the condition).
Put the callsign at the end. If nothing needs reading back, answer "Roger" (or "Wilco" for a request to report).
Use compact written form like "Descend FL80, left heading 270, Roma 125.5, Alitalia 123".
Answer ONLY with JSON: {"for_us": boolean, "readback": string, "spoken": string (same readback written as pronounced, ICAO digits e.g. "flight level eight zero", "niner"), "note": string (short note in Italian about doubtful parts, or empty)}.`;

  async function readback(transcript, { key, model, callsign }) {
    const data = await call('/chat/completions', key, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'llama-3.3-70b-versatile',
        temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: `Pilot callsign: ${callsign || 'unknown'}\nATC transmission: "${transcript}"` },
        ],
      }),
    });
    const text = data.choices && data.choices[0] && data.choices[0].message.content;
    const out = JSON.parse(text || '{}');
    if (!out.readback) throw new Error('Risposta AI vuota.');
    return out;
  }

  async function listModels(key) {
    const data = await call('/models', key, { method: 'GET' });
    return (data.data || []).map((m) => m.id).sort();
  }

  root.Groq = { transcribe, readback, listModels };
})(this);
