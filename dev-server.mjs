// Local dev server: the app's static files + the Cloudflare Pages Functions under functions/api/*.
// Run: node dev-server.mjs   (listens on all interfaces so your phone on the same Wi-Fi can open it)
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';

const ROOT = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const PORT = +process.env.PORT || 5173;
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const FILES = new Set(['index.html', 'manifest.webmanifest', 'sw.js']);
const DIRS = new Set(['css', 'js', 'vendor', 'art']);

// [url prefix, function file, param name, catch-all?]
const FUNCS = [
  ['/api/rd/', 'functions/api/rd/[[path]].js', 'path', true],
  ['/api/sync', 'functions/api/sync.js', 'x', false],
  ['/api/trakt/', 'functions/api/trakt/[[path]].js', 'path', true],
  ['/api/addon', 'functions/api/addon.js', 'x', false],
];
const kv = new Map(); // in-memory stand-in for the SYNC KV namespace
const env = {
  ...process.env,
  SYNC: { get: async k => (kv.has(k) ? kv.get(k) : null), put: async (k, v) => { kv.set(k, String(v)); }, delete: async k => { kv.delete(k); } },
};

async function runFunction(req, res, [prefix, file, name, all], u) {
  let mod;
  try { mod = await import(pathToFileURL(join(ROOT, file)).href); }
  catch { res.writeHead(404, { 'Content-Type': 'application/json' }); return res.end('{"error":"no_function"}'); }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const rest = u.pathname.slice(prefix.length).split('/').filter(Boolean).map(decodeURIComponent);
  const request = new Request(`http://${req.headers.host}${req.url}`, {
    method: req.method, headers: Object.entries(req.headers).flatMap(([k, v]) => [].concat(v).map(x => [k, x])),
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : Buffer.concat(chunks),
  });
  try {
    const r = await mod.onRequest({ request, params: { [name]: all ? rest : rest[0] }, env });
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'function_failed', detail: String(e) }));
  }
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const fn = FUNCS.find(f => u.pathname.startsWith(f[0]));
  if (fn) return runFunction(req, res, fn, u);
  let rel;
  try { rel = decodeURIComponent(u.pathname).replace(/^\/+/, ''); } catch { res.writeHead(400); return res.end(); }
  const parts = rel.split(/[\\/]/);
  const allowed = FILES.has(rel) || (DIRS.has(parts[0]) && parts.length > 1);
  if (rel && !allowed) {
    // SPA fallback only for extension-less, non-dotfile paths
    if (extname(rel) || parts.some(x => x.startsWith('.')) || ['tools', 'dist', 'functions', 'node_modules', 'tests'].includes(parts[0])) { res.writeHead(403); return res.end('forbidden'); }
    rel = 'index.html';
  }
  if (parts.some(x => x.startsWith('.'))) { res.writeHead(403); return res.end('forbidden'); }
  const p = normalize(join(ROOT, rel || 'index.html'));
  if (!p.startsWith(normalize(ROOT + sep))) { res.writeHead(403); return res.end(); }
  try {
    if (!(await stat(p)).isFile()) throw 0;
    const body = await readFile(p);
    res.writeHead(200, { 'Content-Type': TYPES[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(body);
  } catch { res.writeHead(404); res.end('not found'); }
}).listen(PORT, '0.0.0.0', () => {
  const ips = Object.values(networkInterfaces()).flat().filter(i => i && i.family === 'IPv4' && !i.internal).map(i => i.address);
  console.log(`Streamora dev: http://localhost:${PORT}` + ips.map(ip => `  |  http://${ip}:${PORT}`).join(''));
});
