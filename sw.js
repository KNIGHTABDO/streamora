// Streamora service worker: cache-first app shell, one complete cache per deploy, so a launch needs no network round trip.
// tools/build.mjs stamps __BUILD__ with a content hash and fills SHELL with every app file of that deploy. A new deploy
// installs in the background and takes over on the next launch (or right away when the "Reload" strip is tapped).
// API, video and addon traffic never touches the cache. In dev (unbuilt) the SW isn't registered at all.
const BUILD = '__BUILD__';
const VERSION = 'streamora-shell-' + BUILD;
const SHELL = ['./', './css/paper.css', './css/components.css', './css/app.css', './js/main.js', './vendor/preact-htm.js', './art/icon.svg', './manifest.webmanifest']; // __SHELL__
const RUNTIME = 'streamora-rt'; // other same-origin files (art, media), fonts
const KEEP = k => k === VERSION || k === RUNTIME || k.startsWith('streamora-json');
const shellPaths = new Set(SHELL.map(u => new URL(u, self.location).pathname));

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const legacy = !(await caches.keys()).some(k => k.startsWith('streamora-shell-')); // the old network-first worker is active
    const c = await caches.open(VERSION);
    await c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))); // all or nothing: a half-cached deploy never goes live
    // Coming from the old network-first worker, pages were loaded from the network anyway, so take over now (old behaviour).
    if (legacy) await self.skipWaiting();
  })());
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('streamora-') && !KEEP(k)).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

const sameOriginShell = url => url.origin === location.origin && !url.pathname.startsWith('/api/') && /\.(html|css|js|mjs|svg|png|webp|webmanifest|woff2?)$|\/$/.test(url.pathname);
const fonts = url => /^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);
const isAppPage = url => url.origin === location.origin && (url.pathname === '/' || url.pathname === '/index.html');

let skipAsked = 0;
async function navigation(req) {
  // A reload with only this one window open and a newer deploy waiting: switch to it and load again, so the page and
  // every module come from the same deploy. Guarded so a stuck worker can't cause a reload loop.
  const waiting = self.registration.waiting;
  if (waiting && Date.now() - skipAsked > 10000) {
    const wins = await self.clients.matchAll({ type: 'window' });
    if (wins.length <= 1) {
      skipAsked = Date.now();
      waiting.postMessage('skipWaiting');
      return new Response('', { headers: { Refresh: '0', 'Content-Type': 'text/html' } });
    }
  }
  // The page is cached as './' only: Pages answers /index.html with a 308 to /, and a redirected response handed to a
  // navigation fails the load (ERR_FAILED). plain() also covers a redirect cached by an older worker.
  const hit = await caches.match('./', { cacheName: VERSION });
  if (hit) return plain(hit);
  try { return await fetch(req); } catch { const old = await caches.match('./'); return old ? plain(old) : offline(); }
}

const plain = r => (r.redirected ? new Response(r.body, { status: r.status, statusText: r.statusText, headers: r.headers }) : r);

async function shellFile(req) {
  const hit = await caches.match(req, { cacheName: VERSION, ignoreSearch: true });
  if (hit) return hit;
  return fetch(req);
}

async function networkFirst(req) {
  try {
    const r = await fetch(req);
    if (r.ok) { const copy = r.clone(); caches.open(RUNTIME).then(c => c.put(req, copy)); }
    return r;
  } catch {
    return (await caches.match(req)) || Response.error();
  }
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    if (isAppPage(url)) e.respondWith(navigation(req));
    else e.respondWith(networkFirst(req)); // privacy.html and friends
    return;
  }
  if (url.origin === location.origin && shellPaths.has(url.pathname)) { e.respondWith(shellFile(req)); return; }
  if (sameOriginShell(url)) { e.respondWith(networkFirst(req)); return; }
  if (!fonts(url)) return; // video, m3u8, addon JSON: straight to network
  e.respondWith(caches.open(RUNTIME).then(async c => {
    const hit = await c.match(req);
    const net = fetch(req).then(r => { if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});

function offline() {
  return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Offline · Streamora</title>
<body style="margin:0;min-height:100vh;display:grid;place-items:center;background:#f3e6cf;color:#1e1630;font:20px 'Comic Sans MS',cursive;text-align:center;padding:24px">
<div>
<svg width="170" height="170" viewBox="0 0 120 124" fill="none" stroke="#1e1630" stroke-linecap="round" stroke-width="3">
<ellipse cx="60" cy="116" rx="30" ry="4.5" fill="#1e1630" opacity=".12" stroke="none"/>
<path d="M86 88C104 96 110 108 100 116 92 122 80 116 70 118" stroke-width="11" opacity=".9"/>
<path d="M86 88C104 96 110 108 100 116 92 122 80 116 70 118" stroke="#fff8ea" stroke-width="4" stroke-dasharray="3 5"/>
<circle cx="60" cy="60" r="34" fill="#fbe7a6" stroke-width="3.6"/>
<circle cx="60" cy="36" r="5.5" stroke-width="2"/><circle cx="38" cy="66" r="5" stroke-width="2" opacity=".5"/><circle cx="82" cy="66" r="5" stroke-width="2" opacity=".5"/>
<path d="M44 54q6 3 12 0M64 54q6 3 12 0" stroke-width="2.6"/><ellipse cx="60" cy="68" rx="2.6" ry="3" fill="#1e1630"/>
<path d="M52 94l-3 14M68 94l2 14"/>
<text x="92" y="30" font-size="18" fill="#1e1630" stroke="none" font-family="cursive">z</text><text x="102" y="18" font-size="13" fill="#1e1630" stroke="none" font-family="cursive">z</text>
</svg>
<h1 style="font-size:40px;margin:8px 0">You're offline</h1>
<p>Reel took a nap while the internet's away.<br>Reconnect and we'll pick up where you left off.</p>
<button onclick="location.reload()" style="font:inherit;padding:10px 22px;background:#ffd23f;border:2.5px solid #1e1630;border-radius:10px 14px 9px 13px;box-shadow:3px 4px 0 #1e1630;cursor:pointer">Try again</button>
</div></body>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || './#/calendar';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    const c = cs.find(c => 'focus' in c);
    return c ? c.navigate(url).then(w => (w || c).focus()) : self.clients.openWindow(url);
  }));
});
