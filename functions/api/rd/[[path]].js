// Cloudflare Pages Function: /api/rd/* -> api.real-debrid.com/rest/1.0/*
// The browser can't call Real-Debrid directly (no CORS). This relays the request as-is.
// The user's key arrives in the Authorization header and is never stored here.
export async function onRequest({ request, params }) {
  const url = new URL(request.url);
  const path = [].concat(params.path || []).map(encodeURIComponent).join('/');
  const headers = { Authorization: request.headers.get('Authorization') || '' };
  const init = { method: request.method, headers };
  if (!['GET', 'HEAD'].includes(request.method)) {
    init.body = await request.arrayBuffer();
    const ct = request.headers.get('Content-Type');
    if (ct) headers['Content-Type'] = ct;
  }
  const r = await fetch(`https://api.real-debrid.com/rest/1.0/${path}${url.search}`, init);
  const out = new Headers();
  out.set('Content-Type', r.headers.get('Content-Type') || 'application/json');
  out.set('Cache-Control', 'no-store');
  return new Response(r.body, { status: r.status, headers: out });
}
