// node tests/integrations.test.mjs  — Drive sync merge logic, the Google sign-in relay, trakt/addon helpers.
import assert from 'node:assert/strict';
import { merge, mergeSecrets, syncable } from '../js/core/sync.js';
import { foldWatched, scrobbleBody } from '../js/core/trakt.js';
import { normalizeStream, checkManifest, manifestUrl } from '../js/core/addons.js';
import { onRequest as googleFn } from '../functions/api/google/[[path]].js';
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

assert.ok(syncable('profiles') && syncable('addons') && syncable('p:a:mood'), 'profiles, addons, per-profile buckets sync');
for (const k of ['rdkey', 'rdkey-at', 'google', 'gd-ver', 'sync-base', 'rt', 'resolved', 'app-banner-off', 'oauth-pending']) assert.ok(!syncable(k), k + ' stays on the device');

// ---- secrets: newest wins per entry, ties go to Drive's copy
let sm = mergeSecrets({ rd: { v: 'A', at: 5 }, trakt: { p1: { access_token: 'x', at: 1 } } }, { rd: { v: 'B', at: 3 }, trakt: { p1: { off: true, at: 2 }, p2: { access_token: 'y', at: 1 } } });
assert.equal(sm.rd.v, 'A', 'newer local key wins');
assert.ok(sm.trakt.p1.off && sm.trakt.p2.access_token === 'y', 'newer disconnect wins, remote-only kept');
sm = mergeSecrets({ rd: { v: 'A', at: 1 } }, { rd: { v: 'B', at: 1 } });
assert.equal(sm.rd.v, 'B', 'tie -> Drive');
sm = mergeSecrets({ rd: { v: 'A', at: 1 } }, undefined);
assert.equal(sm.rd.v, 'A', 'empty Drive takes the local key');
sm = mergeSecrets({ rd: { v: null, at: 9 } }, { rd: { v: 'B', at: 3 } });
assert.equal(sm.rd.v, null, 'a newer removal sticks');

// ---- Google relay (Google mocked)
const realFetch = globalThis.fetch;
const seen = [];
globalThis.fetch = async (u, init) => {
  const form = Object.fromEntries(new URLSearchParams(init.body));
  seen.push([String(u), form]);
  if (form.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') return new Response('{"error":"authorization_pending"}', { status: 428 });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
};
const genv = { GOOGLE_CLIENT_ID: 'web-id', GOOGLE_CLIENT_SECRET: 'web-s', GOOGLE_TV_CLIENT_ID: 'tv-id', GOOGLE_TV_CLIENT_SECRET: 'tv-s' };
const gcall = (path, body, { env = genv, origin, method = body ? 'POST' : 'GET' } = {}) => googleFn({ env, params: { path: path.split('/') },
  request: new Request('https://s.test/api/google/' + path, { method, body: body && JSON.stringify(body), headers: origin ? { Origin: origin } : {} }) });
let gr = await (await gcall('config')).json();
assert.deepEqual([gr.web, gr.tv], ['web-id', 'tv-id']);
assert.match(gr.scope, /drive\.file/);
assert.deepEqual(await (await gcall('config', null, { env: {} })).json().then(j => [j.web, j.tv]), [null, null], 'no secrets -> not configured');
assert.equal((await gcall('config', null, { origin: 'https://evil.test' })).status, 403);
assert.equal((await gcall('token', { code: 'c', redirect_uri: 'https://evil.test/' })).status, 400, 'code only comes back to this site');
assert.equal((await gcall('token', { code: 'c', redirect_uri: 'https://s.test/', code_verifier: 'v' })).status, 200);
assert.deepEqual(seen.at(-1)[1], { grant_type: 'authorization_code', code: 'c', redirect_uri: 'https://s.test/', code_verifier: 'v', client_id: 'web-id', client_secret: 'web-s' });
await gcall('refresh', { refresh_token: 'r', client: 'tv' });
assert.equal(seen.at(-1)[1].client_id, 'tv-id', 'tv tokens refresh with the tv client');
await gcall('device/code', {});
assert.equal(seen.at(-1)[0], 'https://oauth2.googleapis.com/device/code');
assert.equal((await gcall('device/token', { device_code: 'd' })).status, 428, 'pending passes through');
assert.equal((await gcall('refresh', { refresh_token: 'r' }, { env: {} })).status, 501);
assert.equal((await gcall('nope', {})).status, 404);
globalThis.fetch = realFetch;


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
