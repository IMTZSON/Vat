const test = require('node:test');
const assert = require('node:assert');

// Groq finto: il vecchio modello non esiste più (stesso errore visto dall'utente).
function fakeGroq({ models, jsonModeFails = false }) {
  const calls = [];
  global.fetch = async (url, init) => {
    const body = init && typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ url, model: body && body.model, json: !!(body && body.response_format) });
    const reply = (status, obj) => ({ ok: status < 400, status, json: async () => obj });
    if (url.endsWith('/models')) return reply(200, { data: models.map((id) => ({ id, active: true })) });
    if (url.endsWith('/chat/completions')) {
      if (!models.includes(body.model)) {
        return reply(404, { error: { message: `The model \`${body.model}\` does not exist or you do not have access to it.`, code: 'model_not_found' } });
      }
      if (jsonModeFails && body.response_format) return reply(400, { error: { message: 'response_format json_object is not supported' } });
      const content = jsonModeFails
        ? 'Here you go: {"for_us": true, "readback": "Descend FL80, Alitalia 123", "spoken": "descend flight level eight zero", "note": ""}'
        : JSON.stringify({ for_us: true, readback: 'Descend FL80, Alitalia 123', spoken: 'descend flight level eight zero', note: '' });
      return reply(200, { choices: [{ message: { content } }] });
    }
    return reply(500, {});
  };
  delete require.cache[require.resolve('../js/groq.js')];
  return { Groq: require('../js/groq.js').Groq, calls };
}

test('modello ritirato: ne sceglie un altro e lo comunica', async () => {
  const { Groq, calls } = fakeGroq({ models: ['whisper-large-v3-turbo', 'llama-guard-4-12b', 'openai/gpt-oss-120b', 'openai/gpt-oss-20b'] });
  const changes = [];
  Groq.onModelChange = (kind, m) => changes.push([kind, m]);
  const out = await Groq.readback('Alitalia 123 descend FL80', { key: 'k', model: 'llama-3.3-70b-versatile', callsign: 'Alitalia 123' });
  assert.strictEqual(out.readback, 'Descend FL80, Alitalia 123');
  assert.strictEqual(out.model, 'openai/gpt-oss-120b');
  assert.deepStrictEqual(changes, [['chat', 'openai/gpt-oss-120b']]);
  assert.deepStrictEqual(calls.map((c) => c.model || c.url.split('/').pop()), ['llama-3.3-70b-versatile', 'models', 'openai/gpt-oss-120b']);
});

test('modello vuoto = automatico, esclude guard/whisper', async () => {
  const { Groq } = fakeGroq({ models: ['whisper-large-v3', 'meta-llama/llama-guard-4-12b', 'qwen/qwen3-32b'] });
  const out = await Groq.readback('x', { key: 'k', model: '', callsign: '' });
  assert.strictEqual(out.model, 'qwen/qwen3-32b');
});

test('modello senza modalità JSON: riprova e legge il JSON dal testo', async () => {
  const { Groq } = fakeGroq({ models: ['openai/gpt-oss-120b'], jsonModeFails: true });
  const out = await Groq.readback('x', { key: 'k', model: 'openai/gpt-oss-120b', callsign: '' });
  assert.strictEqual(out.readback, 'Descend FL80, Alitalia 123');
});

test('mai "unknown" in fondo al readback', async () => {
  const { Groq } = fakeGroq({ models: ['openai/gpt-oss-120b'] });
  global.fetch = (orig => async (url, init) => {
    if (url.endsWith('/chat/completions')) {
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: JSON.stringify({ for_us: true, readback: 'Taxi holding point Alpha 2, runway 26L, via Papa, Alpha, Sierra, unknown', spoken: 'taxi … sierra, unknown', note: '' }) } }] }) };
    }
    return orig(url, init);
  })(global.fetch);
  const out = await Groq.readback('Taxi holding point Alpha 2', { key: 'k', model: 'openai/gpt-oss-120b', callsign: '' });
  assert.strictEqual(out.readback, 'Taxi holding point Alpha 2, runway 26L, via Papa, Alpha, Sierra');
  assert.strictEqual(out.spoken, 'taxi … sierra');
});
