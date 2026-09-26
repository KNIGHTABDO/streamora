// node tests/integrations.test.mjs  — merge logic, RD-keyed sync function on a Map KV, trakt/addon helpers.
import assert from 'node:assert/strict';
import { merge } from '../js/core/sync.js';
import { foldWatched, scrobbleBody } from '../js/core/trakt.js';
import { normalizeStream, checkManifest, manifestUrl } from '../js/core/addons.js';
import { onRequest as syncFn } from '../functions/api/sync.js';
import { allowedUrl } from '../functions/api/addon.js';

// ---- merge
const P = 'p:a:';
const local = { at: 100, data: {
  [P + 'progress']: { tt1: { id: 'tt1', updated: 5, eps: { e1: { t: 10, at: 5 }, e2: { t: 50, at: 9 } } }, tt9: { id: 'tt9', updated: 1, eps: {} } },
  [P + 'watchlist']: [{ id: 'tt1' }, { id: 'tt2' }],
  [P + 'settings']: { quality: 'high' },
  activeProfile: 'a', 'sync-base': 1,
} };
const remote = { at: 200, data: {
  [P + 'progress']: { tt1: { id: 'tt1', updated: 8, eps: { e1: { t: 99, at: 8 }, e2: { t: 1, at: 2 } } }, tt3: { id: 'tt3', updated: 3, eps: {} } },
  [P + 'watchlist']: [{ id: 'tt1' }, { id: 'tt4' }],
  [P + 'settings']: { quality: 'low' },
} };
const base = { [P + 'watchlist']: ['tt1', 'tt2'], [P + 'progress']: ['tt1', 'tt9'] };
const m = merge(local, remote, base);
assert.equal(m[P + 'progress'].tt1.eps.e1.t, 99, 'newer episode wins');
assert.equal(m[P + 'progress'].tt1.eps.e2.t, 50, 'newer episode wins (other side)');
assert.ok(m[P + 'progress'].tt3, 'remote-only added');
assert.ok(!m[P + 'progress'].tt9, 'deleted remotely since base -> gone');
assert.deepEqual(m[P + 'watchlist'].map(x => x.id).sort(), ['tt1', 'tt4'], 'tt2 deleted remotely, tt4 added');
assert.equal(m[P + 'settings'].quality, 'low', 'newer bundle wins settings');
assert.ok(!('activeProfile' in m) && !('sync-base' in m), 'device-only keys skipped');
const m2 = merge(local, remote, null);
assert.deepEqual(m2[P + 'watchlist'].map(x => x.id).sort(), ['tt1', 'tt2', 'tt4'], 'no base -> union');
const h = merge({ at: 1, data: { [P + 'history']: [{ id: 'a', at: 1 }, { id: 'b', at: 3 }] } }, { at: 2, data: { [P + 'history']: [{ id: 'a', at: 1 }, { id: 'c', at: 2 }] } });
assert.deepEqual(h[P + 'history'].map(x => x.id), ['b', 'c', 'a'], 'history union sorted newest first');

// ---- sync function on a Map-backed KV, RD /user mocked
let rdCalls = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  if (String(u) !== 'https://api.real-debrid.com/rest/1.0/user') return realFetch(u, init);
  rdCalls++;
  const tok = init.headers.Authorization.slice(7);
  return tok.startsWith('good') ? new Response(JSON.stringify({ id: tok === 'good2' ? 2 : 1 })) : new Response('{"error":"bad_token"}', { status: 401 });
};
for (const secret of [undefined, 's3cret']) {
  const kv = new Map();
  const env = { SYNC: { get: async k => kv.get(k) ?? null, put: async (k, v) => void kv.set(k, v) }, SYNC_SECRET: secret };
  const call = (method, { body, ifMatch, origin, tok = 'good1' } = {}) => syncFn({ env,
    request: new Request('https://s.test/api/sync', { method, body, headers: { ...(tok && { Authorization: 'Bearer ' + tok }), ...(ifMatch != null && { 'If-Match': String(ifMatch) }), ...(origin && { Origin: origin }) } }) });
  const blob = JSON.stringify({ data: { at: 5, data: { k: 'hello' } } });
  assert.equal((await call('GET', { tok: null })).status, 401);
  assert.equal((await call('GET', { tok: 'bad' })).status, 401);
  assert.equal((await call('GET')).status, 404);
  assert.equal((await call('GET', { origin: 'https://evil.test' })).status, 403);
  assert.equal((await call('PUT', { body: blob })).status, 428);
  let r = await call('PUT', { body: blob, ifMatch: 0 });
  assert.equal(r.status, 200); assert.equal((await r.json()).ver, 1);
  r = await call('PUT', { body: blob, ifMatch: 0 });
  assert.equal(r.status, 409); assert.deepEqual(await r.json(), { ver: 1, data: { at: 5, data: { k: 'hello' } } }, '409 returns current');
  assert.equal((await call('PUT', { body: blob, ifMatch: 1 })).status, 200);
  const g = await (await call('GET')).json();
  assert.equal(g.ver, 2); assert.equal(g.data.data.k, 'hello');
  assert.equal((await call('GET', { tok: 'good2' })).status, 404, 'other account sees nothing');
  assert.equal((await call('PUT', { body: 'x'.repeat(600 * 1024), ifMatch: 2 })).status, 413);
  const [key] = kv.keys();
  assert.match(key, /^u:[0-9a-f]{64}$/);
  assert.equal(kv.get(key).includes('hello'), !secret, secret ? 'encrypted at rest' : 'plaintext without secret');
}
assert.ok(rdCalls <= 4, 'token -> id cached (' + rdCalls + ' RD calls)');
globalThis.fetch = realFetch;
assert.equal((await syncFn({ env: {}, request: new Request('https://s.test/') })).status, 501);

// ---- trakt
const fw = foldWatched({ tt5: { id: 'tt5', eps: { 'tt5:1:1': { done: true, at: 1 } }, last: 'tt5:1:1', updated: 1 } },
  [{ movie: { title: 'M', ids: { imdb: 'tt7' } }, last_watched_at: '2024-01-01T00:00:00Z' }, { movie: { title: 'NoImdb', ids: {} } }],
  [{ show: { title: 'S', ids: { imdb: 'tt5' } }, seasons: [{ number: 1, episodes: [{ number: 1, last_watched_at: '2024-01-01' }, { number: 2, last_watched_at: '2024-01-02' }] }] }]);
assert.equal(fw.n, 2, 'one movie + one new episode');
assert.equal(fw.p.tt7.eps._.done, true);
assert.equal(fw.p.tt5.last, 'tt5:1:1', 'existing entry keeps its last');
assert.equal(scrobbleBody({ id: 'kitsu:1', type: 'series' }, { season: 1, episode: 1 }), null);
assert.deepEqual(scrobbleBody({ id: 'tt5', type: 'series' }, { season: 2, episode: 3 }), { show: { ids: { imdb: 'tt5' } }, episode: { season: 2, number: 3 } });

// ---- addons
const hash = 'a'.repeat(40);
assert.deepEqual(normalizeStream({ name: '4k', title: 'x\n💾 1 GB', infoHash: hash.toUpperCase(), fileIdx: 2, behaviorHints: { bingeGroup: 'g', evil: 1 } }, 'Ad'),
  { name: '[Ad] 4k', title: 'x\n💾 1 GB', infoHash: hash, fileIdx: 2, behaviorHints: { filename: undefined, bingeGroup: 'g' } });
assert.equal(normalizeStream({ url: 'https://x/y.mp4' }, 'Ad'), null);
assert.throws(() => checkManifest({ id: 'a', name: 'A', resources: ['catalog'], types: ['movie'] }, 'u'));
assert.deepEqual(checkManifest({ id: 'a', name: 'A', resources: [{ name: 'stream', types: ['series'], idPrefixes: ['tt'] }], types: ['movie'] }, 'u').types, ['series']);
assert.equal(manifestUrl('stremio://x.io/cfg/'), 'https://x.io/cfg/manifest.json');
assert.throws(() => manifestUrl('http://x.io'));
assert.ok(allowedUrl('https://torrentio.strem.fun/stream/movie/tt1.json'));
for (const bad of ['http://a.com/manifest.json', 'https://localhost/manifest.json', 'https://127.0.0.1/manifest.json', 'https://[::1]/manifest.json', 'https://a.com/other.json', 'https://x.internal/manifest.json'])
  assert.equal(allowedUrl(bad), null, bad);

console.log('integrations: all passed');
