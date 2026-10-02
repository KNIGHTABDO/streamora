// Google sign-in relay: the token calls need the OAuth client secret, so only they go through here. Nothing is stored.
// Two OAuth clients: GOOGLE_CLIENT_ID/_SECRET (web, redirect + PKCE) and GOOGLE_TV_CLIENT_ID/_SECRET ("enter a code at
// google.com/device", for TVs and the iPhone app's web view, where Google blocks its sign-in page). See DEPLOY.md.
// GET  /api/google/config                                         -> { web: client_id|null, tv: client_id|null, scope }
// POST /api/google/token         { code, redirect_uri, code_verifier }   web: code -> tokens
// POST /api/google/refresh       { refresh_token, client: 'web'|'tv' }  -> fresh access token
// POST /api/google/device/code                                     -> { device_code, user_code, verification_url, … }
// POST /api/google/device/token  { device_code }                   -> tokens | 428 authorization_pending | …
// Google's answers are passed through as-is (status + JSON).
// drive.file: only files Streamora itself created (the hidden appdata folder isn't allowed in the device-code flow)
export const SCOPE = 'openid email profile https://www.googleapis.com/auth/drive.file';
const TOKEN = 'https://oauth2.googleapis.com/token';
const DEVICE = 'https://oauth2.googleapis.com/device/code';

const sameOrigin = request => {
  const origin = request.headers.get('Origin'), site = request.headers.get('Sec-Fetch-Site');
  if (origin && origin !== new URL(request.url).origin) return false;
  return !site || site === 'same-origin' || site === 'none';
};
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

const clients = env => ({
  web: env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET ? { id: env.GOOGLE_CLIENT_ID, secret: env.GOOGLE_CLIENT_SECRET } : null,
  tv: env.GOOGLE_TV_CLIENT_ID && env.GOOGLE_TV_CLIENT_SECRET ? { id: env.GOOGLE_TV_CLIENT_ID, secret: env.GOOGLE_TV_CLIENT_SECRET } : null,
});

async function google(url, form) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams(form) });
  return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });
}

export async function onRequest({ request, params, env }) {
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const path = [].concat(params.path || []).join('/');
  const c = clients(env);
  if (path === 'config' && request.method === 'GET') return json({ web: c.web && c.web.id, tv: c.tv && c.tv.id, scope: SCOPE });
  if (request.method !== 'POST') return json({ error: 'method' }, 405);
  let body = {};
  try { body = await request.json(); } catch {}
  const str = v => String(v == null ? '' : v);

  if (path === 'token') {
    if (!c.web) return json({ error: 'google_not_configured' }, 501);
    // the code can only come back to this site's own root
    const redirect = new URL(request.url).origin + '/';
    if (body.redirect_uri !== redirect) return json({ error: 'bad_redirect_uri' }, 400);
    return google(TOKEN, { grant_type: 'authorization_code', code: str(body.code), redirect_uri: redirect, code_verifier: str(body.code_verifier), client_id: c.web.id, client_secret: c.web.secret });
  }
  if (path === 'refresh') {
    const k = c[body.client === 'tv' ? 'tv' : 'web'];
    if (!k) return json({ error: 'google_not_configured' }, 501);
    return google(TOKEN, { grant_type: 'refresh_token', refresh_token: str(body.refresh_token), client_id: k.id, client_secret: k.secret });
  }
  if (path === 'device/code') {
    if (!c.tv) return json({ error: 'google_not_configured' }, 501);
    return google(DEVICE, { client_id: c.tv.id, scope: SCOPE });
  }
  if (path === 'device/token') {
    if (!c.tv) return json({ error: 'google_not_configured' }, 501);
    return google(TOKEN, { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: str(body.device_code), client_id: c.tv.id, client_secret: c.tv.secret });
  }
  return json({ error: 'not_found' }, 404);
}
