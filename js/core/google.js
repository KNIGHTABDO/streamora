// The Google account is where Streamora keeps everything (sync.js saves it all in a Streamora folder in the user's Drive).
// Sign-in: redirect + PKCE on the web; "enter a code at google.com/device" on TVs and in the iPhone app's web view
// (Google blocks its sign-in page inside apps). The calls that need the client secret go through /api/google.
// Tokens live in IndexedDB on this device only. `account` (name, email, picture) is the reactive "signed in" flag.
import { store, ls } from './store.js';
import { idbGet, idbSet, idbDel } from './idb.js';

export const account = store('google', null); // { sub, email, name, picture } | null
const SLOT = 'google';
const DRIVE = 'https://www.googleapis.com/auth/drive.file';

let cfg = null;
export async function googleConfig() {
  cfg = cfg || fetch('/api/google/config').then(r => (r.ok ? r.json() : Promise.reject(new Error(`Sign-in server said ${r.status}`))));
  try { return await cfg; } catch (e) { cfg = null; throw e; }
}
const relay = (path, body) => fetch(`/api/google/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
const redirectUri = () => location.origin + '/';

const b64u = bytes => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const rand = n => b64u(crypto.getRandomValues(new Uint8Array(n)));
function claims(idToken) {
  try { return JSON.parse(decodeURIComponent(escape(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))))); } catch { return {}; }
}

/** Fresh sign-in on this device: keep the tokens, show who it is, start sync.js from a clean slate. */
async function saveTokens(t, client) {
  if (!String(t.scope || '').split(' ').includes(DRIVE)) {
    throw new Error('Streamora needs the Google Drive box ticked (it only sees files it made itself). Try again and leave it on.');
  }
  if (!t.refresh_token) throw new Error('Google did not hand over a sign-in that lasts. Try again.');
  const c = claims(t.id_token);
  await idbSet(SLOT, { refresh_token: t.refresh_token, client, access_token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 });
  mem = { token: t.access_token, exp: Date.now() + (t.expires_in || 3600) * 1000 };
  for (const k of ['gd-file', 'gd-ver', 'gd-clean', 'sync-base']) ls.del(k);
  account.set({ sub: c.sub || '', email: c.email || '', name: c.name || c.given_name || '', picture: c.picture || '' });
}

// ------------------------------------------------------------ web: redirect + PKCE
export async function signInWithRedirect() {
  const c = await googleConfig();
  if (!c.web) throw new Error("Google sign-in isn't set up on this server yet (see DEPLOY.md).");
  const verifier = rand(48), state = rand(18);
  const challenge = b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  ls.set('oauth-pending', { state, verifier, back: location.hash || '#/', at: Date.now() });
  location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
    client_id: c.web, redirect_uri: redirectUri(), response_type: 'code', scope: c.scope,
    access_type: 'offline', prompt: 'select_account consent', state, code_challenge: challenge, code_challenge_method: 'S256',
  }));
}

async function finishRedirect(q) {
  const p = ls.get('oauth-pending', null);
  ls.del('oauth-pending');
  history.replaceState(null, '', location.pathname + ((p && p.back) || '#/'));
  if (q.get('error')) throw new Error(q.get('error') === 'access_denied' ? 'Google sign-in was cancelled.' : `Google said ${q.get('error')}`);
  if (!p || p.state !== q.get('state') || Date.now() - p.at > 30 * 60e3) throw new Error('That sign-in expired. Try again.');
  const r = await relay('token', { code: q.get('code'), redirect_uri: redirectUri(), code_verifier: p.verifier });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `Google said ${r.status}`);
  await saveTokens(j, 'web');
}
// Back from Google (?code=…&state=… on the site root): finish signing in. null when this load isn't a sign-in return.
const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
export const returning = q.has('state') && (q.has('code') || q.has('error')) ? finishRedirect(q) : null;
if (returning) returning.catch(() => {});

// ------------------------------------------------------------ TV / iPhone app: device code
/** Step 1: { user_code, verification_url, device_code, interval, expires_in } to show. */
export async function startDeviceSignIn() {
  const c = await googleConfig();
  if (!c.tv) throw new Error("Code sign-in isn't set up on this server yet (see DEPLOY.md).");
  const r = await relay('device/code');
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error_description || j.error || `Google said ${r.status}`);
  return j;
}
/** Step 2: polls until the code is approved. Pass an AbortSignal to stop. */
export async function finishDeviceSignIn(dc, signal) {
  let wait = (dc.interval || 5) * 1000;
  const until = Date.now() + (dc.expires_in || 1800) * 1000;
  while (Date.now() < until) {
    await new Promise(res => setTimeout(res, wait));
    if (signal && signal.aborted) throw new Error('Cancelled');
    const r = await relay('device/token', { device_code: dc.device_code });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return saveTokens(j, 'tv');
    if (j.error === 'authorization_pending') continue;
    if (j.error === 'slow_down') { wait += 5000; continue; }
    throw new Error({ access_denied: 'You said no on Google.', expired_token: 'That code expired. Try again.' }[j.error] || j.error_description || `Google said ${r.status}`);
  }
  throw new Error('That code expired. Try again.');
}

// ------------------------------------------------------------ access tokens
let mem = null, refreshing = null;
export class SignedOut extends Error {}
/** A valid Drive access token (refreshed through the relay when needed). Throws SignedOut when Google revoked us. */
export async function accessToken(force = false) {
  if (!force && mem && mem.exp - 60e3 > Date.now()) return mem.token;
  const t = await idbGet(SLOT);
  if (!t) { if (account.get()) account.set(null); throw new SignedOut('Signed out of Google.'); }
  if (!force && t.access_token && t.exp - 60e3 > Date.now()) { mem = { token: t.access_token, exp: t.exp }; return mem.token; }
  refreshing = refreshing || (async () => {
    const r = await relay('refresh', { refresh_token: t.refresh_token, client: t.client });
    const j = await r.json().catch(() => ({}));
    if (r.status === 400 || r.status === 401) {
      // revoked or expired for good: sign in again (local data stays and merges back in)
      await idbDel(SLOT); mem = null; account.set(null);
      throw new SignedOut('Google signed Streamora out. Sign in again.');
    }
    if (!r.ok) throw new Error(j.error_description || j.error || `Google said ${r.status}`);
    const exp = Date.now() + (j.expires_in || 3600) * 1000;
    await idbSet(SLOT, { ...t, access_token: j.access_token, exp });
    mem = { token: j.access_token, exp };
    return j.access_token;
  })().finally(() => { refreshing = null; });
  return refreshing;
}

/** Forget Google on this device. No revoke: that would drop the grant for every device. Callers wipe local data. */
export async function signOut() {
  await idbDel(SLOT);
  mem = null;
  account.set(null);
}

/** Drops Streamora's access to the Google account for every device (Settings → Privacy → delete from Drive). */
export async function revokeAccess() {
  const t = await idbGet(SLOT);
  if (t) await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'token=' + encodeURIComponent(t.refresh_token) }).catch(() => {});
  await signOut();
}
