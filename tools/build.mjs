// Copies only the app files into dist/ for Cloudflare Pages (functions/ is picked up from the project root).
//   node tools/build.mjs && npx wrangler pages deploy dist --project-name streamora
import { cpSync, rmSync, mkdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = root + 'dist';
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
for (const p of ['index.html', 'manifest.webmanifest', 'sw.js', 'offline.html', 'css', 'js', 'vendor', 'art']) {
  if (existsSync(root + p)) cpSync(root + p, `${dist}/${p}`, { recursive: true });
}
console.log('built', dist);
