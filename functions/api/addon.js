// Read-only relay for Stremio addons that don't send CORS headers. GET /api/addon?url=https://…
// Only manifest.json and /stream/<type>/<id>.json, https, public hosts, 10s, 2 MB. Never runs addon code: it's JSON.
// same-origin only (the Origin / Sec-Fetch-Site headers browsers send)
const sameOrigin = request => {
  const origin = request.headers.get('Origin'), site = request.headers.get('Sec-Fetch-Site');
  if (origin && origin !== new URL(request.url).origin) return false;
  return !site || site === 'same-origin' || site === 'none';
};

const MAX = 2 * 1024 * 1024;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export function allowedUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443')) return null;
  const h = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  // ponytail: blocks IP literals and local names; DNS names pointing at private IPs are left to the Workers runtime (it can't reach them).
  if (!h.includes('.') || /^(localhost|.*\.local|.*\.internal|.*\.localhost)$/.test(h)) return null;
  if (/^[\d.]+$/.test(h) || h.includes(':')) return null;
  const p = u.pathname;
  if (!(p.endsWith('/manifest.json') || /\/stream\/[^/]+\/[^/]+\.json$/.test(p))) return null;
  return u;
}

export async function onRequest({ request }) {
  if (request.method !== 'GET') return json({ error: 'method' }, 405);
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const u = allowedUrl(new URL(request.url).searchParams.get('url') || '');
  if (!u) return json({ error: 'url_not_allowed' }, 400);
  let r;
  try { r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(10000), headers: { Accept: 'application/json' } }); }
  catch { return json({ error: 'upstream_failed' }, 502); }
  if (r.status >= 300 && r.status < 400) return json({ error: 'redirect_not_allowed' }, 502);
  if (+r.headers.get('Content-Length') > MAX) return json({ error: 'too_large' }, 502);
  const reader = r.body.getReader(), parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if ((size += value.length) > MAX) { reader.cancel(); return json({ error: 'too_large' }, 502); }
    parts.push(value);
  }
  return new Response(new Blob(parts), { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'public, max-age=300' } });
}
