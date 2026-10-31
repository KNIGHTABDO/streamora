// Cloudflare Pages Function: /api/tb/* -> api.torbox.app/v1/api/*
// The browser can't call TorBox directly (no CORS). This relays the request as-is.
// The user's key arrives in the Authorization header and is never stored here.
const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

// Only our own pages may use the relay (stops other sites from driving it with a visitor's key).
export function sameOrigin(request) {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = request.headers.get('Origin');
  if (!origin) return true; // ponytail: non-browser clients (curl) send neither header; they hold their own key anyway
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

export async function onRequest({ request, params }) {
  if (!sameOrigin(request)) return json(403, { error: 'forbidden' });
  const url = new URL(request.url);
  const segs = [].concat(params.path || []);
  if (segs.some(s => s === '..' || s === '.' || /[\\/]/.test(s))) return json(400, { error: 'bad_path' });
  const path = segs.map(encodeURIComponent).join('/');
  const auth = request.headers.get('Authorization') || '';
  // requestdl takes the key in the query. Adding it here keeps it out of the browser's request URL, and user_ip
  // makes TorBox pick a CDN near the viewer rather than near this relay.
  if (segs[segs.length - 1] === 'requestdl') {
    url.searchParams.set('token', auth.replace(/^Bearer\s+/i, ''));
    const ip = request.headers.get('CF-Connecting-IP');
    if (ip) url.searchParams.set('user_ip', ip);
  }
  const headers = { Authorization: auth };
  const init = { method: request.method, headers };
  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = await request.arrayBuffer();
    const ct = request.headers.get('Content-Type');
    if (ct) headers['Content-Type'] = ct; // multipart boundary included
  }
  let r;
  try { r = await fetch(`https://api.torbox.app/v1/api/${path}${url.search}`, init); }
  catch { return json(502, { success: false, error: 'relay_failed' }); }
  const out = new Headers();
  out.set('Content-Type', r.headers.get('Content-Type') || 'application/json');
  out.set('Cache-Control', 'no-store');
  const ra = r.headers.get('Retry-After'); if (ra) out.set('Retry-After', ra);
  return new Response(r.body, { status: r.status, headers: out });
}
