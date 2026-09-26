// Copies only the app files into dist/ for Cloudflare Pages (functions/ is picked up from the project root),
// then stamps sw.js with a hash of everything copied so each deploy gets a fresh cache.
//   node tools/build.mjs && npx wrangler pages deploy dist --project-name streamora
import { cpSync, rmSync, mkdirSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = root + 'dist';
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const p of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'vendor', 'art']) {
  if (existsSync(root + p)) cpSync(root + p, `${dist}/${p}`, { recursive: true });
}
const hash = createHash('sha256');
for (const f of readdirSync(dist, { recursive: true, withFileTypes: true }).filter(d => d.isFile()).map(d => `${d.parentPath || d.path}/${d.name}`).sort()) {
  hash.update(f.slice(dist.length)).update(readFileSync(f));
}
const build = hash.digest('hex').slice(0, 12);
const sw = `${dist}/sw.js`;
writeFileSync(sw, readFileSync(sw, 'utf8').replaceAll('__BUILD__', build));
console.log('built', dist, build);
