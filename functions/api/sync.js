// Sync blob store keyed by the caller's Real-Debrid account (KV namespace bound as SYNC, see DEPLOY.md).
// Auth: Authorization: Bearer <RD key>. We ask RD /user who that is and key the blob by its numeric id.
// GET  /api/sync                               -> { ver, data } | 404
// PUT  /api/sync  If-Match: <ver, 0 for new>   body { data }  -> { ver } | 409 { ver, data }
// With SYNC_SECRET set, `data` is AES-GCM encrypted at rest (key = HKDF(SYNC_SECRET, user id)); without it, stored as-is.
// Tokens are never logged or stored; only an in-memory token-hash -> id map lives for 5 min per isolate.
// ponytail: KV has no compare-and-swap, so two PUTs in the same instant can both win; fine for one person's devices.
const MAX = 512 * 1024;
const TTL = 5 * 60e3;
const RD_USER = 'https://api.real-debrid.com/rest/1.0/user';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const enc = s => new TextEncoder().encode(s);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const sha = async s => hex(await crypto.subtle.digest('SHA-256', enc(s)));
const b64 = buf => { let s = ''; new Uint8Array(buf).forEach(b => (s += String.fromCharCode(b))); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if (origin && origin !== new URL(request.url).origin) return false;
  return !site || site === 'same-origin' || site === 'none';
}

const ids = new Map(); // sha(token) -> { id, exp }
export async function rdUserId(token) {
  const k = await sha(token), hit = ids.get(k);
  if (hit && hit.exp > Date.now()) return hit.id;
  const r = await fetch(RD_USER, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) return null;
  const u = await r.json().catch(() => null);
  if (!u || u.id == null) return null;
  if (ids.size > 1000) ids.clear();
  ids.set(k, { id: String(u.id), exp: Date.now() + TTL });
  return String(u.id);
}

async function aesKey(secret, id) {
  const km = await crypto.subtle.importKey('raw', enc(secret), 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: enc('streamora-sync-v2'), info: enc(id) }, km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}
async function sealAt(env, id, data) {
  if (!env.SYNC_SECRET) return { data };
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv: b64(iv), ct: b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(env.SYNC_SECRET, id), enc(JSON.stringify(data)))) };
}
async function openAt(env, id, rec) {
  if (!rec.ct) return rec.data;
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, await aesKey(env.SYNC_SECRET || '', id), unb64(rec.ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

export async function onRequest({ request, env }) {
  if (!env.SYNC) return json({ error: 'sync_not_configured' }, 501);
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const token = (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '').trim();
  if (!token) return json({ error: 'unauthorized' }, 401);
  let id;
  try { id = await rdUserId(token); } catch { return json({ error: 'rd_unreachable' }, 502); }
  if (!id) return json({ error: 'unauthorized' }, 401);
  const key = 'u:' + await sha(id + (env.SYNC_SALT || ''));
  const raw = await env.SYNC.get(key);
  const cur = raw ? JSON.parse(raw) : null;
  const current = async () => ({ ver: cur.ver, data: await openAt(env, id, cur) });
  if (request.method === 'GET') {
    if (!cur) return json({ error: 'not_found' }, 404);
    try { return json(await current()); } catch { return json({ error: 'undecryptable' }, 500); }
  }
  if (request.method !== 'PUT') return json({ error: 'method' }, 405);

  const text = await request.text();
  if (text.length > MAX) return json({ error: 'too_large' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'bad_json' }, 400); }
  if (!body || typeof body.data !== 'object' || body.data === null) return json({ error: 'bad_body' }, 400);
  const want = parseInt(request.headers.get('If-Match') || '', 10);
  if (!Number.isFinite(want)) return json({ error: 'if_match_required' }, 428);
  if ((cur ? cur.ver : 0) !== want) return cur ? json(await current().catch(() => ({ ver: cur.ver })), 409) : json({ ver: 0 }, 409);
  const ver = want + 1;
  await env.SYNC.put(key, JSON.stringify({ ver, ...(await sealAt(env, id, body.data)), at: Date.now() }));
  return json({ ver });
}
