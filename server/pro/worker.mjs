/* Readback Copilot Pro: server di trascrizione (Cloudflare Worker).
   - L'utente compra il Pro su Lemon Squeezy e riceve una chiave di licenza.
   - Il programma attiva la chiave (/v1/license/activate) e poi usa questo server come un servizio
     compatibile OpenAI (/v1/audio/transcriptions, /v1/chat/completions): niente chiave Groq da creare.
   - Il server controlla la licenza (con cache), applica un limite mensile di minuti di audio e
     inoltra a Groq con la propria chiave.
   Variabili (wrangler.toml / segreti): GROQ_API_KEY, LS_STORE_ID, LS_PRODUCT_IDS (facoltativo),
   MONTHLY_MINUTES, STT_MODEL, CHAT_MODEL; KV: PRO_KV. Guida: docs/PRO-SETUP.md */

const GROQ = 'https://api.groq.com/openai/v1';
const LS = 'https://api.lemonsqueezy.com/v1/licenses';
const MAX_AUDIO_BYTES = 4 * 1024 * 1024; // ~2 minuti di WAV 16 kHz mono: le trasmissioni ATC durano pochi secondi
const MAX_CHAT_BYTES = 16 * 1024;
const CHAT_PREF = [/gpt-oss-120b/, /llama-4-maverick/, /llama-3\.3-70b/, /llama-4-scout/, /kimi-k2/, /gpt-oss-20b/, /llama/];

const json = (data, status, extra) => new Response(JSON.stringify(data), { status: status || 200, headers: { 'Content-Type': 'application/json', ...(extra || {}) } });
const fail = (status, message, code) => json({ error: { message, code: code || null } }, status);

async function sha(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

const period = (now) => new Date(now).toISOString().slice(0, 7); // "2026-10"

// Durata di un WAV dalla sua intestazione (altrimenti stima da 16 kHz mono 16 bit)
export function audioSeconds(bytes) {
  const b = new Uint8Array(bytes);
  const str = (o, n) => String.fromCharCode(...b.slice(o, o + n));
  if (b.length > 44 && str(0, 4) === 'RIFF' && str(8, 4) === 'WAVE') {
    const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
    const byteRate = v.getUint32(28, true);
    if (byteRate > 0) return (b.length - 44) / byteRate;
  }
  return b.length / 32000;
}

async function lemon(deps, path, fields) {
  const r = await deps.fetch(`${LS}/${path}`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(fields).toString(),
  });
  let data = {};
  try { data = await r.json(); } catch (e) { /* risposta non JSON */ }
  return { status: r.status, data };
}

// La chiave appartiene al nostro negozio (e al prodotto Pro, se indicato)?
function ourProduct(env, meta) {
  if (!meta || String(meta.store_id) !== String(env.LS_STORE_ID)) return false;
  const ids = String(env.LS_PRODUCT_IDS || '').split(',').map((x) => x.trim()).filter(Boolean);
  return !ids.length || ids.includes(String(meta.product_id));
}

// Token del programma: "<chiave di licenza>::<id dell'installazione>"
async function authorize(request, env, deps) {
  const m = (request.headers.get('Authorization') || '').match(/^Bearer\s+(.+)::([\w-]+)$/);
  if (!m) return { error: fail(401, 'Licenza Pro mancante', 'no_license') };
  const [, key, instance] = m;
  const id = await sha(`${key}::${instance}`);
  const cacheKey = `v:${id}`;
  const cached = await env.PRO_KV.get(cacheKey, 'json');
  if (cached && cached.ok) return { key, instance, user: await sha(key) };
  if (cached && !cached.ok) return { error: fail(403, cached.reason || 'Licenza non valida', 'invalid_license') };
  const { data } = await lemon(deps, 'validate', { license_key: key, instance_id: instance });
  const status = data.license_key && data.license_key.status;
  const ok = !!data.valid && (status === 'active') && ourProduct(env, data.meta);
  const reason = !data.valid ? 'Licenza non valida o installazione non attivata' : status !== 'active' ? `Licenza ${status}` : 'Licenza di un altro prodotto';
  // risultato positivo in cache per un'ora, negativo per 5 minuti
  await env.PRO_KV.put(cacheKey, JSON.stringify({ ok, reason }), { expirationTtl: ok ? 3600 : 300 });
  if (!ok) return { error: fail(403, reason, 'invalid_license') };
  return { key, instance, user: await sha(key) };
}

async function usage(env, user, now) {
  const k = `u:${user}:${period(now)}`;
  const used = Number(await env.PRO_KV.get(k)) || 0;
  const limit = (Number(env.MONTHLY_MINUTES) || 1200) * 60;
  return { k, used, limit };
}

async function chatModel(env, deps) {
  if (env.CHAT_MODEL) return env.CHAT_MODEL;
  const cached = await env.PRO_KV.get('m:chat');
  if (cached) return cached;
  const r = await deps.fetch(`${GROQ}/models`, { headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` } });
  const ids = ((await r.json()).data || []).map((m) => m.id);
  let model = null;
  for (const re of CHAT_PREF) { model = ids.find((x) => re.test(x)); if (model) break; }
  model = model || 'llama-3.3-70b-versatile';
  await env.PRO_KV.put('m:chat', model, { expirationTtl: 86400 });
  return model;
}

export async function handle(request, env, deps) {
  deps = { fetch: (...a) => fetch(...a), now: () => Date.now(), ...(deps || {}) };
  const url = new URL(request.url);
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
  const res = await route(request, env, deps, url);
  for (const [k, v] of Object.entries(cors)) res.headers.set(k, v);
  return res;
}

async function route(request, env, deps, url) {
  const p = url.pathname;

  if (p === '/v1/license/activate' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const key = String(body.license_key || '').trim();
    if (!key) return fail(400, 'Chiave di licenza mancante');
    const { data } = await lemon(deps, 'activate', { license_key: key, instance_name: String(body.instance_name || 'Readback Copilot').slice(0, 80) });
    if (!data.activated) return fail(403, data.error || 'Attivazione non riuscita', 'activation_failed');
    if (!ourProduct(env, data.meta)) return fail(403, 'Questa chiave non è una licenza Readback Copilot Pro', 'wrong_product');
    return json({ ok: true, instance_id: data.instance.id, status: data.license_key.status, expires_at: data.license_key.expires_at || null, activations: { used: data.license_key.activation_usage, limit: data.license_key.activation_limit } });
  }

  if (p === '/v1/license/deactivate' && request.method === 'POST') {
    const body = await request.json().catch(() => ({}));
    const { data } = await lemon(deps, 'deactivate', { license_key: String(body.license_key || ''), instance_id: String(body.instance_id || '') });
    return json({ ok: !!data.deactivated });
  }

  const auth = await authorize(request, env, deps);
  if (auth.error) return auth.error;

  if (p === '/v1/license/status' && request.method === 'GET') {
    const u = await usage(env, auth.user, deps.now());
    return json({ ok: true, period: period(deps.now()), used_seconds: Math.round(u.used), limit_seconds: u.limit });
  }

  if (p === '/v1/models' && request.method === 'GET') {
    return json({ object: 'list', data: [{ id: env.STT_MODEL || 'whisper-large-v3-turbo', object: 'model' }, { id: 'readback-pro', object: 'model' }] });
  }

  if (p === '/v1/audio/transcriptions' && request.method === 'POST') {
    const form = await request.formData().catch(() => null);
    const file = form && form.get('file');
    if (!file || typeof file === 'string') return fail(400, 'File audio mancante');
    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > MAX_AUDIO_BYTES) return fail(413, 'Audio troppo lungo');
    const secs = audioSeconds(bytes);
    const u = await usage(env, auth.user, deps.now());
    if (u.used + secs > u.limit) return fail(429, 'Limite mensile di minuti del Pro raggiunto', 'quota_exceeded');
    const out = new FormData();
    out.append('file', new Blob([bytes], { type: file.type || 'audio/wav' }), 'audio.wav');
    out.append('model', env.STT_MODEL || 'whisper-large-v3-turbo');
    for (const k of ['prompt', 'language', 'response_format', 'temperature']) if (form.get(k) !== null) out.append(k, form.get(k));
    const r = await deps.fetch(`${GROQ}/audio/transcriptions`, { method: 'POST', headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` }, body: out });
    if (r.ok) await env.PRO_KV.put(u.k, String(u.used + secs), { expirationTtl: 40 * 86400 });
    return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/json' } });
  }

  if (p === '/v1/chat/completions' && request.method === 'POST') {
    const text = await request.text();
    if (text.length > MAX_CHAT_BYTES) return fail(413, 'Richiesta troppo grande');
    let body;
    try { body = JSON.parse(text); } catch (e) { return fail(400, 'JSON non valido'); }
    const clean = {
      model: await chatModel(env, deps),
      messages: Array.isArray(body.messages) ? body.messages.slice(0, 4).map((m) => ({ role: m.role === 'system' ? 'system' : 'user', content: String(m.content || '').slice(0, 4000) })) : [],
      temperature: 0,
      max_tokens: 400,
    };
    if (body.response_format && body.response_format.type === 'json_object') clean.response_format = { type: 'json_object' };
    let r = await deps.fetch(`${GROQ}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(clean) });
    if (r.status === 404) {
      // modello ritirato da Groq: se ne sceglie un altro e si riprova
      await env.PRO_KV.delete('m:chat');
      if (!env.CHAT_MODEL) {
        clean.model = await chatModel(env, deps);
        r = await deps.fetch(`${GROQ}/chat/completions`, { method: 'POST', headers: { Authorization: `Bearer ${env.GROQ_API_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(clean) });
      }
    }
    return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  }

  return fail(404, 'Non trovato');
}

export default { fetch: (request, env) => handle(request, env) };
