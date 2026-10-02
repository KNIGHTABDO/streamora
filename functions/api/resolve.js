// Starts a source through Torrentio: GET /api/resolve?u=<torrentio.strem.fun/resolve/realdebrid/…>
// Torrentio's servers add the torrent to the user's Real-Debrid and unlock the file, then redirect either to the
// Real-Debrid file (-> { ok: true, url }) or to one of their explainer videos (-> { ok: false, reason: 'failed_infringement' … }).
// Real-Debrid refuses torrent adds from many addresses (its 2026 copyright filter answers "infringing_file" even
// for public-domain films), but accepts them from Torrentio, like in Stremio. Browsers can't read a cross-site
// redirect, hence this relay. The key is part of the Torrentio url (as in Stremio); nothing is stored or logged.
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

export function sameOrigin(request) {
  const site = request.headers.get('Sec-Fetch-Site');
  if (site) return site === 'same-origin' || site === 'none';
  const origin = request.headers.get('Origin');
  if (!origin) return true; // non-browser clients hold their own key anyway
  try { return new URL(origin).host === new URL(request.url).host; } catch { return false; }
}

export function torrentioUrl(raw) {
  let u;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.hostname !== 'torrentio.strem.fun' || !/^\/resolve\/realdebrid\/[^/]+\/[a-f0-9]{40}\//i.test(u.pathname)) return null;
  return u;
}

export async function onRequest({ request }) {
  if (request.method !== 'GET') return json({ error: 'method' }, 405);
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const u = torrentioUrl(new URL(request.url).searchParams.get('u') || '');
  if (!u) return json({ error: 'bad_url' }, 400);
  let r;
  try { r = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(60000), headers: { 'User-Agent': 'Streamora' } }); }
  catch { return json({ ok: false, reason: 'torrentio_unreachable' }, 502); }
  const loc = r.headers.get('Location') || '';
  if (r.status >= 300 && r.status < 400 && loc) {
    let to;
    try { to = new URL(loc, u); } catch { return json({ ok: false, reason: 'bad_redirect' }, 502); }
    if (to.hostname === 'torrentio.strem.fun') {
      // /videos/failed_infringement_v3.mp4 -> failed_infringement
      const reason = (to.pathname.split('/').pop() || '').replace(/(_v\d+)?\.\w+$/, '') || 'unknown';
      return json({ ok: false, reason });
    }
    return json({ ok: true, url: to.href });
  }
  return json({ ok: false, reason: `torrentio_${r.status}` }, 502);
}
