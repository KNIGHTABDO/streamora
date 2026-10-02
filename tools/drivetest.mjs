// End-to-end Drive sync test against a fake Google Drive (needs `node dev-server.mjs` on :5173).
//   CHROME=/usr/bin/google-chrome node tools/drivetest.mjs
// Device A = an old install with local data (must migrate); device B = a fresh device signing in to the same account.
import puppeteer from 'puppeteer-core';
import http from 'node:http';
import { gunzipSync } from 'node:zlib';
import { readFileSync, mkdirSync } from 'node:fs';
import assert from 'node:assert/strict';

const exe = process.env.CHROME || (process.platform === 'win32' ? 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe' : '/usr/bin/google-chrome');
const KEY = readFileSync(new URL('./.rdkey', import.meta.url), 'utf8').trim();
const base = 'http://localhost:5173';
mkdirSync(new URL('./shots/', import.meta.url), { recursive: true });

// ---- fake Drive (drive.file: only what the app made, found by appProperties)
const files = new Map(); const folders = []; let nextId = 1; const log = [];
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': '*' };
const fake = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = Buffer.concat(chunks);
  const send = (s, j) => { res.writeHead(s, { ...cors, 'Content-Type': 'application/json' }); res.end(JSON.stringify(j)); };
  log.push(`${req.method} ${u.pathname}${u.search.includes('alt=media') ? ' (media)' : ''}`);
  if (req.headers.authorization !== 'Bearer tok') return send(401, { error: 'auth' });
  let m;
  if (u.pathname === '/drive/v3/files' && req.method === 'GET') {
    const q = u.searchParams.get('q');
    if (/value='folder'/.test(q)) return send(200, { files: folders.map(id => ({ id })) });
    assert.match(q, /value='data'/);
    return send(200, { files: [...files.entries()].map(([id, f]) => ({ id, version: String(f.version) })) });
  }
  if (u.pathname === '/drive/v3/files' && req.method === 'POST') {
    const meta = JSON.parse(body); assert.equal(meta.mimeType, 'application/vnd.google-apps.folder');
    folders.push('d' + nextId++); return send(200, { id: folders.at(-1) });
  }
  if ((m = u.pathname.match(/^\/drive\/v3\/files\/(\w+)$/))) {
    const f = files.get(m[1]);
    if (!f) return send(404, {});
    if (req.method === 'DELETE') { files.delete(m[1]); res.writeHead(204, cors); return res.end(); }
    if (u.searchParams.get('alt') === 'media') { res.writeHead(200, { ...cors, 'Content-Type': 'application/octet-stream' }); return res.end(f.bytes); }
    return send(200, { id: m[1], version: String(f.version) });
  }
  if ((m = u.pathname.match(/^\/upload\/drive\/v3\/files\/(\w+)$/)) && req.method === 'PATCH') {
    const f = files.get(m[1]); f.bytes = body; f.version++;
    return send(200, { id: m[1], version: String(f.version) });
  }
  if (u.pathname === '/upload/drive/v3/files' && req.method === 'POST') {
    const b = req.headers['content-type'].split('boundary=')[1];
    const parts = body.toString('latin1').split('--' + b);
    const meta = JSON.parse(parts[1].split('\r\n\r\n')[1]);
    assert.deepEqual(meta.parents, [folders[0]]); assert.equal(meta.appProperties.streamora, 'data');
    const raw = parts[2].slice(parts[2].indexOf('\r\n\r\n') + 4, -2);
    const id = 'f' + nextId++; assert.equal(id, 'f2');
    files.set(id, { bytes: Buffer.from(raw, 'latin1'), version: 1 });
    return send(200, { id, version: '1' });
  }
  send(404, { error: 'unknown ' + u.pathname });
}).listen(5174);
const driveJson = () => { const f = [...files.values()][0]; const b = f.bytes[0] === 0x1f ? gunzipSync(f.bytes) : f.bytes; return JSON.parse(b.toString()); };

const browser = await puppeteer.launch({ executablePath: exe, headless: true });
async function device(name) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport({ width: 1280, height: 860 });
  const errors = [];
  page.on('pageerror', e => errors.push('[pageerror] ' + e.message));
  page.on('console', m => m.type() === 'error' && !/favicon|404/.test(m.text()) && errors.push('[console] ' + m.text()));
  await page.setRequestInterception(true);
  page.on('request', r => {
    const u = r.url();
    if (u.startsWith('https://www.googleapis.com/')) return r.continue({ url: u.replace('https://www.googleapis.com', 'http://localhost:5174') });
    r.continue();
  });
  const signIn = () => page.evaluate(async () => {
    const { idbSet } = await import('/js/core/idb.js');
    await idbSet('google', { refresh_token: 'r', client: 'web', access_token: 'tok', exp: Date.now() + 36e5 });
    const g = await import('/js/core/google.js');
    for (const k of ['gd-file', 'gd-ver', 'gd-clean', 'sync-base']) localStorage.removeItem('streamora:' + k);
    g.account.set({ sub: '1', email: 'test@example.com', name: 'Test Person', picture: '' });
  });
  const shot = n => page.screenshot({ path: new URL(`./shots/drive-${name}-${n}.png`, import.meta.url).pathname });
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const ls = k => page.evaluate(k => JSON.parse(localStorage.getItem('streamora:' + k)), k);
  return { page, errors, signIn, shot, wait, ls };
}

// ---- A: old install with local data
const A = await device('A');
await A.page.goto(base + '/#/welcome', { waitUntil: 'domcontentloaded' });
await A.page.evaluate(async KEY => {
  const s = await import('/js/core/store.js');
  s.profiles.set([{ id: 'pA', name: 'Anna', avatar: 'cat', theme: 'ink', ink: '#ff4f79', created: 1 }]);
  s.activeProfileId.set('pA');
  s.watchlist.set([{ id: 'tt0111161', type: 'movie', name: 'The Shawshank Redemption', added: 1 }]);
  await s.saveRdKey(KEY);
  localStorage.removeItem('streamora:rdkey-at'); // like a key saved before Drive existed
}, KEY);
await A.page.goto(base + '/#/', { waitUntil: 'networkidle2' }); await A.page.reload({ waitUntil: 'networkidle2' });
await A.wait(800);
const migrateText = await A.page.evaluate(() => document.body.innerText);
assert.match(migrateText, /moved into your Google Drive/, 'old install sees the migration page');
assert.ok(!/skip/i.test(migrateText), 'no way around it');
assert.equal(new URL(A.page.url()).hash, '#/welcome');
await A.shot('1-migrate');
await A.signIn();
await A.page.waitForFunction(() => location.hash.startsWith('#/profiles') || location.hash === '#/', { timeout: 15000 });
await A.wait(500);
let d = driveJson();
assert.equal(d.secrets.rd.v, KEY, 'key moved to Drive');
assert.equal(d.data['p:pA:watchlist'][0].id, 'tt0111161', 'watchlist moved to Drive');
assert.ok(!('activeProfile' in d.data) && !('rdkey' in d.data), 'device-only keys stay home');
console.log('A migrated:', log.join(', ')); log.length = 0;

// ---- B: fresh device, same Google account
const B = await device('B');
await B.page.goto(base + '/', { waitUntil: 'networkidle2' });
await B.wait(500);
assert.match(await B.page.evaluate(() => document.body.innerText), /Hi, I'm Reel/, 'new device sees the story');
await B.shot('1-story');
await B.page.evaluate(() => [...document.querySelectorAll('button')].find(b => /skip/.test(b.textContent)).click());
await B.wait(400);
assert.match(await B.page.evaluate(() => document.body.innerText), /Continue with Google/);
await B.shot('2-google');
await B.signIn();
await B.page.waitForFunction(() => location.hash.startsWith("#/profiles"), { timeout: 15000 }).catch(async e => { await B.shot("fail"); console.log(B.errors, await B.page.evaluate(() => document.body.innerText.slice(0, 400) + JSON.stringify(localStorage))); throw e; });
await B.wait(800);
await B.shot('3-profiles');
assert.equal((await B.ls('profiles'))[0].name, 'Anna', 'profiles came from Drive');
assert.ok(await B.page.evaluate(async () => !!(await (await import('/js/core/store.js')).getRdKey())), 'key came from Drive');
console.log('B restored:', log.join(', ')); log.length = 0;

// ---- live: B adds to the watchlist, A sees it; A removes the original, B sees that
await B.page.evaluate(async () => {
  const s = await import('/js/core/store.js');
  s.activeProfileId.set('pA');
  s.watchlist.update(w => [{ id: 'tt0068646', type: 'movie', name: 'The Godfather', added: Date.now() }, ...w]);
});
const t0 = Date.now();
await B.page.waitForFunction(() => !JSON.parse(localStorage.getItem('streamora:sync-status')).busy && +localStorage.getItem('streamora:gd-clean') >= +localStorage.getItem('streamora:sync-changed'), { timeout: 15000 });
console.log(`B pushed in ${Date.now() - t0} ms:`, log.join(', ')); log.length = 0;
assert.equal(driveJson().data['p:pA:watchlist'].length, 2);
await A.page.evaluate(async () => (await import('/js/core/sync.js')).syncNow());
assert.deepEqual((await A.ls('p:pA:watchlist')).map(x => x.id).sort(), ['tt0068646', 'tt0111161'], 'A pulled B\'s change');
await A.page.evaluate(async () => { const s = await import('/js/core/store.js'); s.watchlist.update(w => w.filter(x => x.id !== 'tt0111161')); await (await import('/js/core/sync.js')).syncNow(); });
await B.page.evaluate(async () => (await import('/js/core/sync.js')).syncNow());
assert.deepEqual((await B.ls('p:pA:watchlist')).map(x => x.id), ['tt0068646'], 'deletion synced, not resurrected');
console.log('live sync:', log.join(', ')); log.length = 0;

// ---- quiet check costs one tiny request
await A.page.evaluate(async () => (await import('/js/core/sync.js')).syncNow());
assert.ok(log.length && log.every(l => l === 'GET /drive/v3/files/f2'), 'nothing changed -> only tiny metadata calls: ' + log);
log.length = 0;

// ---- settings page shows the account
await B.page.goto(base + '/#/settings', { waitUntil: 'networkidle2' }); await B.wait(1200);
assert.match(await B.page.evaluate(() => document.body.innerText), /test@example\.com/);
await B.shot('4-settings');

const errs = [...A.errors, ...B.errors].filter(e => !/real-debrid|torrentio|cinemeta|metahub|kitsu|Failed to load resource/i.test(e));
console.log(errs.length ? errs.join('\n') : 'no page errors');
assert.equal(errs.length, 0);
console.log('drivetest: all passed', [...files.keys()].length, 'file(s) in Drive');
await browser.close(); fake.close();
