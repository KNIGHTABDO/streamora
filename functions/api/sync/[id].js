// Encrypted sync blob store. The browser encrypts everything before it gets here; this only
// keeps one opaque blob per id in the KV namespace bound as SYNC (optional, see DEPLOY.md).
// GET  /api/sync/<64 hex>          -> { ver, iv, ct } | 404
// PUT  /api/sync/<64 hex>  If-Match: <ver the client last saw, 0 for new>  body { iv, ct }
//      -> { ver } | 409 { ver, iv, ct } (someone else pushed first: pull, merge, push again)
// ponytail: KV has no compare-and-swap, so two PUTs in the same instant can both win; fine for one person's devices.
const MAX = 512 * 1024;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export function sameOrigin(request) {
  const origin = request.headers.get('Origin');
  const site = request.headers.get('Sec-Fetch-Site');
  if (origin && origin !== new URL(request.url).origin) return false;
  return !site || site === 'same-origin' || site === 'none';
}

export async function onRequest({ request, params, env }) {
  if (!env.SYNC) return json({ error: 'sync_not_configured' }, 501);
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const id = String(params.id || '');
  if (!/^[0-9a-f]{64}$/.test(id)) return json({ error: 'bad_id' }, 400);
  const key = 'v1:' + id;
  const cur = await env.SYNC.get(key);
  if (request.method === 'GET') return cur ? new Response(cur, { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } }) : json({ error: 'not_found' }, 404);
  if (request.method !== 'PUT') return json({ error: 'method' }, 405);

  const text = await request.text();
  if (text.length > MAX) return json({ error: 'too_large' }, 413);
  let body;
  try { body = JSON.parse(text); } catch { return json({ error: 'bad_json' }, 400); }
  if (!body || typeof body.iv !== 'string' || typeof body.ct !== 'string') return json({ error: 'bad_body' }, 400);
  const curObj = cur ? JSON.parse(cur) : null;
  const want = parseInt(request.headers.get('If-Match') || '', 10);
  if (!Number.isFinite(want)) return json({ error: 'if_match_required' }, 428);
  if ((curObj ? curObj.ver : 0) !== want) return curObj ? json(curObj, 409) : json({ ver: 0 }, 409);
  const ver = want + 1;
  await env.SYNC.put(key, JSON.stringify({ ver, iv: body.iv, ct: body.ct, at: Date.now() }));
  return json({ ver });
}
