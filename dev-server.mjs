// Local dev server: static files + the same /api/rd relay as functions/api/rd/[[path]].js.
// Run: node dev-server.mjs   (listens on all interfaces so your phone on the same Wi-Fi can open it)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { networkInterfaces } from 'node:os';

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PORT = +process.env.PORT || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

async function relay(req, res, path, search) {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const headers = { Authorization: req.headers.authorization || '' };
  if (req.headers['content-type']) headers['Content-Type'] = req.headers['content-type'];
  const init = { method: req.method, headers };
  if (!['GET', 'HEAD'].includes(req.method)) init.body = Buffer.concat(chunks);
  try {
    const r = await fetch(`https://api.real-debrid.com/rest/1.0/${path}${search}`, init);
    res.writeHead(r.status, { 'Content-Type': r.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'relay_failed', detail: String(e) }));
  }
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname.startsWith('/api/rd/')) return relay(req, res, u.pathname.slice(8), u.search);
  let p = normalize(join(ROOT, decodeURIComponent(u.pathname)));
  if (!p.startsWith(normalize(ROOT))) { res.writeHead(403); return res.end(); }
  try { if ((await stat(p)).isDirectory()) p = join(p, 'index.html'); }
  catch { p = join(ROOT, 'index.html'); }
  try {
    const body = await readFile(p);
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`Streamora dev: http://localhost:${PORT}` + ips.map(ip => `  |  http://${ip}:${PORT}`).join(''));
});
