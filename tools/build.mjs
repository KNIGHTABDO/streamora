// Copies only the app files into dist/ for Cloudflare Pages (functions/ is picked up from the project root),
// then stamps sw.js with a hash of everything copied so each deploy gets a fresh cache.
//   node tools/build.mjs && npx wrangler pages deploy dist --project-name streamora
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, relative, sep } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = root + 'dist';
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const p of ['index.html', 'privacy.html', '_headers', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'vendor', 'art', 'media']) {
  if (existsSync(root + p)) cpSync(root + p, `${dist}/${p}`, { recursive: true });
}
const files = readdirSync(dist, { recursive: true, withFileTypes: true }).filter(d => d.isFile())
  .map(d => relative(dist, `${d.parentPath || d.path}/${d.name}`).split(sep).join('/')).sort();

// Static import graph from an entry module: every module the browser would otherwise discover one level at a time.
const deps = f => [...readFileSync(f, 'utf8').matchAll(/(?:^|\n)\s*(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|(?:^|\n)\s*import\s*['"]([^'"]+)['"]/g)]
  .map(m => m[1] || m[2]).filter(x => x.startsWith('.')).map(x => resolve(dirname(f), x));
function graph(entry) {
  const seen = new Set(), q = [resolve(dist, entry)];
  while (q.length) { const f = q.shift(); if (seen.has(f) || !existsSync(f)) continue; seen.add(f); q.push(...deps(f)); }
  return [...seen].map(f => relative(dist, f).split(sep).join('/'));
}
const boot = graph('js/main.js'), home = graph('js/pages/home.js').filter(f => !boot.includes(f));
// The boot gate preloads these when it opens the app (not on the landing, which doesn't need them).
const html = `${dist}/index.html`;
const page = readFileSync(html, 'utf8');
if (!page.includes('// __PRELOAD__')) throw new Error('index.html: __PRELOAD__ marker missing');
writeFileSync(html, page.replace(/^.*\/\/ __PRELOAD__$/m, `      var PRELOAD = ${JSON.stringify({ boot: boot.filter(f => f !== 'js/main.js'), home })}; // __PRELOAD__`));

const hash = createHash('sha256');
for (const f of readdirSync(dist, { recursive: true, withFileTypes: true }).filter(d => d.isFile()).map(d => `${d.parentPath || d.path}/${d.name}`).sort()) {
  hash.update(f.slice(dist.length)).update(readFileSync(f));
}
const build = hash.digest('hex').slice(0, 12);
const sw = `${dist}/sw.js`;
// Every app file of this deploy goes into the SW's shell cache, so a launch never waits on the network.
// index.html stays out: Pages redirects it to /, which './' already caches.
// The big player libraries (hls, mediabunny) stay out: they load only when a video plays.
const shell = ['./', ...files.filter(f => /^(manifest\.webmanifest|art\/icon\.svg|vendor\/(preact-htm|qrcode)\.js|(css|js)\/.+\.(css|js|mjs))$/.test(f))].map(f => f === './' ? f : './' + f);
let swText = readFileSync(sw, 'utf8').replaceAll('__BUILD__', build);
if (!/^const SHELL = .*\/\/ __SHELL__$/m.test(swText)) throw new Error('sw.js: __SHELL__ marker missing');
swText = swText.replace(/^const SHELL = .*\/\/ __SHELL__$/m, `const SHELL = ${JSON.stringify(shell)};`);
writeFileSync(sw, swText);
console.log('shell', shell.length, 'files; preload', boot.length - 1, '+', home.length);
console.log('built', dist, build);
