// Trakt OAuth relay: only the three calls that need the client secret. Everything else
// (scrobble, history, watchlist) goes from the browser straight to api.trakt.tv.
// GET /api/trakt/config -> { client_id }   ·   POST /api/trakt/oauth/device/code | oauth/device/token | oauth/token
// same-origin only (the Origin / Sec-Fetch-Site headers browsers send)
const sameOrigin = request => {
  const origin = request.headers.get('Origin'), site = request.headers.get('Sec-Fetch-Site');
  if (origin && origin !== new URL(request.url).origin) return false;
  return !site || site === 'same-origin' || site === 'none';
};

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
const ALLOWED = new Set(['oauth/device/code', 'oauth/device/token', 'oauth/token']);

export async function onRequest({ request, params, env }) {
  const id = env.TRAKT_CLIENT_ID, secret = env.TRAKT_CLIENT_SECRET;
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const path = [].concat(params.path || []).join('/');
  if (path === 'config' && request.method === 'GET') return json({ client_id: (id && secret) ? id : null }); // null = not set up
  if (!id || !secret) return json({ error: 'trakt_not_configured' }, 501);
  if (!ALLOWED.has(path) || request.method !== 'POST') return json({ error: 'not_allowed' }, 404);

  let body = {};
  try { body = await request.json(); } catch {}
  const out = { client_id: id };
  if (path !== 'oauth/device/code') out.client_secret = secret;
  if (path === 'oauth/device/token') out.code = String(body.code || '');
  if (path === 'oauth/token') Object.assign(out, { refresh_token: String(body.refresh_token || ''), grant_type: 'refresh_token', redirect_uri: 'urn:ietf:wg:oauth:2.0:oob' });
  const r = await fetch(`https://api.trakt.tv/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'User-Agent': 'Streamora' }, body: JSON.stringify(out) });
  return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}
