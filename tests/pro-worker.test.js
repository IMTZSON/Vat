const test = require('node:test');
const assert = require('node:assert');
const { encodeWav } = require('../js/audio.js');

const KEY = '38b1460a-5104-4067-a91d-77b872934d51';
const STORE = 12345;

// KV finto (come Cloudflare KV: get/put/delete con TTL ignorato)
function kv() {
  const m = new Map();
  return { m, get: async (k, type) => (m.has(k) ? (type === 'json' ? JSON.parse(m.get(k)) : m.get(k)) : null), put: async (k, v) => { m.set(k, v); }, delete: async (k) => { m.delete(k); } };
}

function fakeFetch(log, opts) {
  const o = { store: STORE, status: 'active', ...(opts || {}) };
  return async (url, init) => {
    const u = String(url);
    log.push({ url: u, init });
    const form = init && typeof init.body === 'string' ? Object.fromEntries(new URLSearchParams(init.body)) : {};
    if (u.endsWith('/licenses/activate')) {
      if (form.license_key !== KEY) return Response.json({ activated: false, error: 'license_key not found.' }, { status: 404 });
      return Response.json({ activated: true, license_key: { status: 'active', activation_limit: 3, activation_usage: 1, expires_at: null }, instance: { id: 'inst-1' }, meta: { store_id: o.store, product_id: 99 } });
    }
    if (u.endsWith('/licenses/validate')) {
      const valid = form.license_key === KEY && form.instance_id === 'inst-1';
      return Response.json({ valid, license_key: { status: o.status }, meta: { store_id: o.store, product_id: 99 } });
    }
    if (u.endsWith('/models')) return Response.json({ data: [{ id: 'whisper-large-v3-turbo' }, { id: 'llama-3.3-70b-versatile' }, { id: 'openai/gpt-oss-120b' }] });
    if (u.endsWith('/audio/transcriptions')) {
      const f = init.body;
      return Response.json({ text: 'Alitalia 123 climb flight level 240', model: f.get('model'), prompt: f.get('prompt'), auth: init.headers.Authorization });
    }
    if (u.endsWith('/chat/completions')) return Response.json({ choices: [{ message: { content: '{"readback":"Climb FL240, Alitalia 123"}' } }], model: JSON.parse(init.body).model, max: JSON.parse(init.body).max_tokens });
    return new Response('nope', { status: 500 });
  };
}

const env = (extra) => ({ GROQ_API_KEY: 'gsk_server', LS_STORE_ID: String(STORE), MONTHLY_MINUTES: '1', PRO_KV: kv(), ...(extra || {}) });
const req = (path, init) => new Request(`https://pro.example.com${path}`, init);
const auth = { Authorization: `Bearer ${KEY}::inst-1` };
function audioForm(seconds) {
  const wav = encodeWav(new Float32Array(16000 * seconds), 16000);
  const f = new FormData();
  f.append('file', wav, 'a.wav');
  f.append('model', 'whisper-1');
  f.append('prompt', 'ATC radio phraseology');
  f.append('response_format', 'verbose_json');
  return f;
}

test('Pro: attivazione della licenza (solo chiavi del nostro negozio)', async () => {
  const { handle } = await import('../server/pro/worker.mjs');
  const log = [];
  let r = await handle(req('/v1/license/activate', { method: 'POST', body: JSON.stringify({ license_key: KEY, instance_name: 'PC di casa' }) }), env(), { fetch: fakeFetch(log) });
  let j = await r.json();
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual([j.ok, j.instance_id, j.activations.limit], [true, 'inst-1', 3]);
  assert.strictEqual(r.headers.get('Access-Control-Allow-Origin'), '*');
  r = await handle(req('/v1/license/activate', { method: 'POST', body: JSON.stringify({ license_key: 'sbagliata' }) }), env(), { fetch: fakeFetch(log) });
  assert.strictEqual(r.status, 403);
  r = await handle(req('/v1/license/activate', { method: 'POST', body: JSON.stringify({ license_key: KEY }) }), env(), { fetch: fakeFetch(log, { store: 777 }) });
  j = await r.json();
  assert.strictEqual(j.error.code, 'wrong_product');
});

test('Pro: trascrizione con la chiave del server, licenza in cache, limite mensile', async () => {
  const { handle } = await import('../server/pro/worker.mjs');
  const log = [];
  const e = env();
  const now = Date.UTC(2026, 9, 18);
  const deps = { fetch: fakeFetch(log), now: () => now };
  let r = await handle(req('/v1/audio/transcriptions', { method: 'POST', headers: auth, body: audioForm(20) }), e, deps);
  let j = await r.json();
  assert.strictEqual(r.status, 200);
  assert.strictEqual(j.text, 'Alitalia 123 climb flight level 240');
  assert.strictEqual(j.model, 'whisper-large-v3-turbo', 'il modello lo sceglie il server');
  assert.strictEqual(j.auth, 'Bearer gsk_server', 'a Groq va la chiave del server, mai quella dell\'utente');
  assert.strictEqual(j.prompt, 'ATC radio phraseology');
  // seconda richiesta: la licenza arriva dalla cache (nessuna nuova chiamata a Lemon Squeezy)
  const before = log.filter((x) => x.url.includes('validate')).length;
  r = await handle(req('/v1/audio/transcriptions', { method: 'POST', headers: auth, body: audioForm(20) }), e, deps);
  assert.strictEqual(r.status, 200);
  assert.strictEqual(log.filter((x) => x.url.includes('validate')).length, before);
  // limite di 1 minuto: 40 s usati, altri 30 s sforano
  r = await handle(req('/v1/audio/transcriptions', { method: 'POST', headers: auth, body: audioForm(30) }), e, deps);
  assert.strictEqual(r.status, 429);
  r = await handle(req('/v1/license/status', { headers: auth }), e, deps);
  j = await r.json();
  assert.deepStrictEqual([j.used_seconds, j.limit_seconds, j.period], [40, 60, '2026-10']);
});

test('Pro: senza licenza o con licenza scaduta niente servizio', async () => {
  const { handle } = await import('../server/pro/worker.mjs');
  const log = [];
  let r = await handle(req('/v1/audio/transcriptions', { method: 'POST', body: audioForm(2) }), env(), { fetch: fakeFetch(log) });
  assert.strictEqual(r.status, 401);
  r = await handle(req('/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${KEY}::altro-pc` }, body: audioForm(2) }), env(), { fetch: fakeFetch(log) });
  assert.strictEqual(r.status, 403);
  r = await handle(req('/v1/models', { headers: auth }), env(), { fetch: fakeFetch(log, { status: 'expired' }) });
  assert.strictEqual(r.status, 403);
  assert.match((await r.json()).error.message, /expired/);
  assert.ok(!log.some((x) => x.url.includes('groq.com/openai/v1/audio')), 'Groq mai chiamato senza licenza valida');
});

test('Pro: readback AI con modello scelto dal server e richiesta ripulita', async () => {
  const { handle, audioSeconds } = await import('../server/pro/worker.mjs');
  const log = [];
  const body = { model: 'gpt-qualsiasi', max_tokens: 99999, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'ATC: climb FL240' }], response_format: { type: 'json_object' } };
  const r = await handle(req('/v1/chat/completions', { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }), env(), { fetch: fakeFetch(log) });
  const j = await r.json();
  assert.strictEqual(j.model, 'openai/gpt-oss-120b');
  assert.strictEqual(j.max, 400);
  const wav = encodeWav(new Float32Array(16000 * 3), 16000);
  assert.ok(Math.abs(audioSeconds(await wav.arrayBuffer()) - 3) < 0.01);
});
