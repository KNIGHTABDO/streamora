// One-time: asks for the two Google OAuth client secrets (Google Cloud → Google Auth Platform → Clients),
// writes them to .dev.vars for `node dev-server.mjs`, and stores them as Cloudflare Pages secrets.
//   node tools/google-secrets.mjs            (needs `npx wrangler login` once)
// Client ids are public and live in wrangler.toml [vars].
import { createInterface } from 'node:readline/promises';
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = async (q) => (await rl.question(q)).trim();
const secrets = {
  GOOGLE_CLIENT_SECRET: await ask('Secret of the "Streamora web" client (GOCSPX-…): '),
  GOOGLE_TV_CLIENT_SECRET: await ask('Secret of the "Streamora TV and iPhone app" client (GOCSPX-…): '),
};
rl.close();
for (const [k, v] of Object.entries(secrets)) if (!/^GOCSPX-[\w-]{10,}$/.test(v)) { console.error(`${k} doesn't look like a Google client secret.`); process.exit(1); }

let dev = '';
try { dev = readFileSync(root + '.dev.vars', 'utf8'); } catch {}
for (const [k, v] of Object.entries(secrets)) dev = dev.replace(new RegExp(`^${k}=.*\\n?`, 'm'), '') + `${k}=${v}\n`;
writeFileSync(root + '.dev.vars', dev);
console.log('wrote .dev.vars');

for (const [k, v] of Object.entries(secrets)) {
  const r = spawnSync('npx', ['-y', 'wrangler', 'pages', 'secret', 'put', k, '--project-name', 'streamora'], { cwd: root, input: v, stdio: ['pipe', 'inherit', 'inherit'], shell: process.platform === 'win32' });
  if (r.status !== 0) { console.error(`wrangler failed for ${k}`); process.exit(1); }
}
console.log('Cloudflare secrets set. Next deploy picks them up.');
