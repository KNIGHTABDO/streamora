// Read-only title lookup for films Cinemeta doesn't list. GET /api/imdb?q=<title or tt id>. IMDb's suggestion API sends no CORS headers.
const json = (body, status = 200, cache = 'no-store') => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': cache } });
const sameOrigin = request => {
  const origin = request.headers.get('Origin'), site = request.headers.get('Sec-Fetch-Site');
  if (origin && origin !== new URL(request.url).origin) return false;
  return !site || site === 'same-origin' || site === 'none';
};

export async function onRequest({ request }) {
  if (request.method !== 'GET') return json({ error: 'method' }, 405);
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const q = (new URL(request.url).searchParams.get('q') || '').trim().toLowerCase().slice(0, 100);
  if (!q) return json({ d: [] });
  const first = /^[a-z0-9]/.test(q) ? q[0] : 'x';
  try {
    const r = await fetch(`https://v3.sg.media-imdb.com/suggestion/${first}/${encodeURIComponent(q)}.json`, { signal: AbortSignal.timeout(8000), redirect: 'manual' });
    if (!r.ok) return json({ d: [] });
    return json(await r.text(), 200, 'public, max-age=3600');
  } catch { return json({ d: [] }, 502); }
}
