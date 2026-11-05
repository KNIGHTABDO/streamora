import test from 'node:test';
import assert from 'node:assert/strict';
import { onRequest } from '../functions/api/catalog/[[path]].js';
import { evaluate, source, flush, deferred } from './helpers/source.js';

const json = data => new Response(JSON.stringify(data), { headers: { 'Content-Type': 'application/json' } });
test('catalog proxy strips episodes and unused fields, retaining hero and browse fields and edge headers', async t => {
  const item = { id: 'tt1', type: 'series', name: 'Show', poster: 'poster', background: 'bg', logo: 'logo', description: 'Story', year: 2025, releaseInfo: '2025–', imdbRating: '8.2', genres: ['Drama'], runtime: '45 min' };
  let upstream;
  t.mock.method(globalThis, 'fetch', async url => { upstream = url; return json({ metas: [{ ...item, videos: [{ id: 'episode' }], cast: ['actor'], director: ['director'], trailers: [], links: [], behaviorHints: {} }], cacheMaxAge: 1 }); });
  const r = await onRequest({ request: new Request('https://example.test/api/catalog/series/top/genre=Drama&skip=100.json') });
  assert.equal(upstream, 'https://v3-cinemeta.strem.io/catalog/series/top/genre=Drama&skip=100.json');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('Cache-Control'), /max-age=300, s-maxage=21600/);
  assert.match(r.headers.get('Content-Type'), /application\/json/);
  assert.deepEqual(await r.json(), { metas: [item] });
});
test('catalog proxy rejects other resources and does not cache upstream failures', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('unavailable', { status: 503 }); });
  for (const path of ['meta/movie/tt1.json', 'anime/top.json']) {
    assert.equal((await onRequest({ request: new Request('https://example.test/api/catalog/' + path) })).status, 400);
  }
  assert.equal(calls, 0);
  const r = await onRequest({ request: new Request('https://example.test/api/catalog/movie/top.json') });
  assert.equal(r.status, 502);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});

function metadata(fetcher) {
  return evaluate(source('js/core/meta.js'), {
    activeProfile: () => null, ls: { get: (_, d) => d, keys: () => [] },
    DOMException, Response, setTimeout, clearTimeout,
    fetchT: async (url, opts, ms, who, read = r => r) => read(await fetcher(url, opts)),
  }, '({ search, catalog, meta })');
}
test('catalog uses proxy, direct catalog host, then v3; meta and Kitsu hosts stay unchanged', async () => {
  const calls = [];
  const m = metadata(async url => {
    calls.push(url);
    if (url.startsWith('/api/catalog/')) throw Error('down');
    return json(url.includes('/meta/') ? { meta: { id: 'tt1', name: 'Title' } } : { metas: [] });
  });
  await m.catalog('movie', 'top');
  assert.deepEqual(calls.splice(0), ['/api/catalog/movie/top.json', 'https://v3-cinemeta.strem.io/catalog/movie/top.json']);
  await m.meta('movie', 'tt1');
  await m.catalog('anime', 'kitsu-anime-trending');
  assert.deepEqual(calls, ['https://v3-cinemeta.strem.io/meta/movie/tt1.json', 'https://anime-kitsu.strem.fun/catalog/anime/kitsu-anime-trending.json']);
});
test('search abort reaches every source and prevents fallback requests and stale partial results', async () => {
  const calls = [], parts = [], ac = new AbortController();
  const m = metadata((url, { signal }) => new Promise((yes, no) => {
    calls.push({ url, signal }); signal.addEventListener('abort', () => no(new DOMException('Aborted', 'AbortError')), { once: true });
  }));
  assert.equal((await m.search('b')).length, 0);
  const work = m.search('breaking bad', 'all', list => parts.push(list), { signal: ac.signal });
  await flush(); ac.abort();
  await assert.rejects(work, { name: 'AbortError' });
  assert.equal(calls.length, 4);
  assert.ok(calls.every(c => c.signal.aborted));
  assert.equal(parts.length, 0);
});
test('an aborted response is not added to the catalog memory cache', async () => {
  const body = deferred(); let calls = 0;
  const m = metadata(async () => { calls++; return calls === 1 ? { ok: true, status: 200, json: () => body.promise } : json({ metas: [] }); });
  const ac = new AbortController(), work = m.catalog('movie', 'top', {}, { signal: ac.signal });
  await flush(); ac.abort(); body.resolve({ metas: [] });
  await assert.rejects(work, { name: 'AbortError' });
  await m.catalog('movie', 'top');
  assert.equal(calls, 2);
});
