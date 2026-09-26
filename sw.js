// Streamora service worker: network-first app shell (cache only as offline fallback), never caches API/video/addon data.
// tools/build.mjs stamps __BUILD__ with a content hash; in dev it stays as-is and the network always wins anyway.
const VERSION = 'streamora-__BUILD__';
const SHELL = ['./', './index.html', './css/paper.css', './css/components.css', './css/app.css', './js/main.js', './vendor/preact-htm.js', './art/icon.svg', './manifest.webmanifest'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL)).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('streamora-') && k !== VERSION && !k.startsWith('streamora-json')).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const sameOriginShell = url => url.origin === location.origin && !url.pathname.startsWith('/api/') && /\.(html|css|js|mjs|svg|png|webmanifest|woff2?)$|\/$/.test(url.pathname);
const fonts = url => /^(fonts\.googleapis\.com|fonts\.gstatic\.com)$/.test(url.hostname);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith('/api/')) return;
  if (req.mode === 'navigate') {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put('./index.html', copy)); } return r; })
      .catch(async () => (await caches.match('./index.html')) || offline()));
    return;
  }
  if (sameOriginShell(url)) {
    // network-first so a deploy shows up on the next load; cache is only the offline fallback
    e.respondWith(fetch(req).then(r => { if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put(req, copy)); } return r; })
      .catch(async () => (await caches.match(req)) || Response.error()));
    return;
  }
  if (!fonts(url)) return; // video, m3u8, addon JSON: straight to network
  e.respondWith(caches.open(VERSION).then(async c => {
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
