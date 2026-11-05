import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { evaluate, source, component, flush, deferred } from './helpers/source.js';
import { fetchT } from '../js/core/net.js';

function clock() {
  let now = 0, seq = 0; const tasks = new Map();
  const set = (fn, ms = 0) => { const id = ++seq; tasks.set(id, { at: now + ms, fn }); return id; };
  return {
    scope: { Date: { now: () => now }, setTimeout: set, clearTimeout: id => tasks.delete(id) },
    get now() { return now; },
    get pending() { return tasks.size; },
    async tick(ms) {
      const end = now + ms;
      for (;;) {
        const entry = [...tasks].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!entry) break;
        now = entry[1].at; tasks.delete(entry[0]); entry[1].fn(); await flush();
      }
      now = end; await flush();
    },
  };
}
const raw = h => ({ infoHash: h.repeat(40), name: '[TB+] 1080p', title: `${h}.mp4`, behaviorHints: { filename: `${h}.mp4` } });
function sourcesFixture(c, overrides = {}) {
  return evaluate(source('js/core/sources.js'), {
    ...c.scope, DOMException, AbortController, navigator: {},
    getTbKey: async () => 'mock-key', keyStore: { subscribe() {} },
    fetchT: async (url, opts, ms, who, read) => read({ ok: true, json: async () => ({ streams: [raw('a')] }) }),
    addonStreams: async () => [], checkCached: async hashes => new Set(hashes),
    ...overrides,
  }, '({ streams, peekStreams, prefetchStreams, speculateWhenIdle })');
}
test('streams checks Torrentio immediately, ranks at 1500ms, and publishes a six-second addon later', async () => {
  const c = clock(), checks = [], partials = [];
  const api = sourcesFixture(c, {
    checkCached: async hashes => { checks.push({ at: c.now, hashes: [...hashes] }); return new Set(hashes); },
    addonStreams: (type, id, key, { onPartial }) => new Promise(resolve => c.scope.setTimeout(() => { onPartial([raw('b')]); resolve([raw('b')]); }, 6000)),
  });
  let result;
  const first = api.streams('movie', 'tt1', { onPartial: list => partials.push(list) }).then(list => { result = list; return list; });
  await flush();
  assert.equal(checks[0].at, 0);
  await c.tick(1499); assert.equal(result, undefined);
  await c.tick(1); assert.equal((await first)[0].infoHash, 'a'.repeat(40));
  assert.equal(result[0].cached, true);
  await c.tick(4500);
  assert.deepEqual(Array.from(partials.at(-1), x => x.infoHash), ['a'.repeat(40), 'b'.repeat(40)]);
  assert.equal(result.length, 1, 'late addons do not mutate the initial automatic choice');
  assert.equal(c.pending, 0);
});
test('a fast addon does not start playback before a slow Torrentio has answered', async () => {
  const c = clock();
  let result;
  const api = sourcesFixture(c, {
    fetchT: (url, opts, ms, who, read) => new Promise(resolve => c.scope.setTimeout(() => resolve(read({ ok: true, json: async () => ({ streams: [raw('a')] }) })), 3000)),
    addonStreams: async () => [raw('b')],
  });
  const first = api.streams('movie', 'tt1').then(list => { result = list; return list; });
  await flush(); await c.tick(2999);
  assert.equal(result, undefined, 'only the other addons get the 1.5 s grace');
  await c.tick(1);
  assert.deepEqual(Array.from(await first, x => x.infoHash).sort(), ['a'.repeat(40), 'b'.repeat(40)]);
});
test('a late addon cache check cannot hold up an already checked source at the deadline', async () => {
  const c = clock(), slow = deferred();
  const api = sourcesFixture(c, {
    checkCached: hashes => hashes[0].startsWith('b') ? slow.promise : Promise.resolve(new Set(hashes)),
    addonStreams: (type, id, key, { onPartial }) => new Promise(resolve => c.scope.setTimeout(() => { onPartial([raw('b')]); resolve([]); }, 1400)),
  });
  const first = api.streams('movie', 'tt1'); await flush(); await c.tick(1500);
  assert.equal((await first).length, 1);
  slow.resolve(new Set(['b'.repeat(40)])); await flush();
});
test('a slow addon still works on its own when Torrentio fails', async () => {
  const c = clock();
  const api = sourcesFixture(c, {
    fetchT: async () => { throw Error('Torrentio down'); },
    addonStreams: (type, id, key, { onPartial }) => new Promise(resolve => c.scope.setTimeout(() => { onPartial([raw('b')]); resolve([raw('b')]); }, 6000)),
  });
  const first = api.streams('series', 'tt1:1:1'); await flush(); await c.tick(6000);
  const list = await first;
  assert.equal(list[0].infoHash, 'b'.repeat(40));
  assert.equal(list.failed[0], 'Torrentio');
});
test('streams aborts pending discovery and never publishes after cancellation', async () => {
  const c = clock(), signals = [], partials = [], ac = new AbortController();
  const wait = signal => new Promise((yes, no) => { signals.push(signal); signal.addEventListener('abort', () => no(new DOMException('Aborted', 'AbortError')), { once: true }); });
  const api = sourcesFixture(c, { fetchT: (_, { signal }) => wait(signal), addonStreams: (_, __, ___, { signal }) => wait(signal) });
  const first = api.streams('movie', 'tt1', { signal: ac.signal, onPartial: x => partials.push(x) });
  await flush(); ac.abort();
  await assert.rejects(first, { name: 'AbortError' }); await flush();
  assert.ok(signals.every(s => s.aborted)); assert.equal(partials.length, 0); assert.equal(c.pending, 0);
});
test('detail speculation is read-only, keyed by episode, expires at ten minutes, and respects saveData and cleanup', async () => {
  const c = clock(); let requests = 0;
  const api = sourcesFixture(c, { fetchT: async (url, opts, ms, who, read) => { requests++; return read({ ok: true, json: async () => ({ streams: [raw('a')] }) }); } });
  await api.prefetchStreams('series', 'tt1', 'tt1:1:2');
  assert.ok(api.peekStreams('series', 'tt1', 'tt1:1:2'));
  assert.equal(api.peekStreams('series', 'tt1', 'tt1:1:1'), null);
  await api.prefetchStreams('series', 'tt1', 'tt1:1:2'); assert.equal(requests, 1);
  await c.tick(600000); assert.equal(api.peekStreams('series', 'tt1', 'tt1:1:2'), null);
  const cleanup = api.speculateWhenIdle({ type: 'movie', id: 'tt2' }); cleanup();
  await c.tick(200); assert.equal(requests, 1);
  const saved = sourcesFixture(c, { navigator: { connection: { saveData: true } } });
  assert.equal(saved.speculateWhenIdle({ type: 'movie', id: 'tt2' }), undefined);
});
test('MediaFusion reuses the encrypted config across module reloads, indexed by key digest', async () => {
  const cache = new Map(); let posts = 0;
  const load = () => evaluate(source('js/core/addons.js'), {
    crypto: webcrypto, TextEncoder, AbortController, DOMException,
    store: () => ({ get: () => [] }), ls: { get: (k, d) => cache.get(k) ?? d, set: (k, v) => cache.set(k, v) },
    fetchT: async (url, init, ms, who, read) => { posts++; return read({ ok: true, json: async () => ({ encrypted_str: 'encrypted-config' }) }); },
  }, 'mediafusionCfg');
  assert.equal(await load()('mock-key'), 'encrypted-config');
  assert.equal(await load()('mock-key'), 'encrypted-config');
  assert.equal(posts, 1); assert.ok([...cache.keys()].every(k => !k.includes('mock-key')));
  await load()('another-key'); assert.equal(posts, 2);
});
test('metadata or 1500ms starts subtitles once, and unmount cancels the pending start', async () => {
  for (const event of ['metadata', 'timeout', 'unmount']) {
    const c = clock(), listeners = new Map(); let starts = 0;
    const video = { readyState: 0, addEventListener: (k, f) => listeners.set(k, f), removeEventListener: k => listeners.delete(k) };
    const afterMetadata = evaluate(component('js/player/player.js', 'afterMetadata'), c.scope, 'afterMetadata');
    const cleanup = afterMetadata(video, () => starts++);
    await c.tick(500); assert.equal(starts, 0);
    if (event === 'metadata') listeners.get('loadedmetadata')();
    if (event === 'unmount') cleanup();
    await c.tick(1000);
    assert.equal(starts, event === 'unmount' ? 0 : 1);
    assert.equal(listeners.size, 0); assert.equal(c.pending, 0);
  }
});
test('MP4 warm-up uses the last 256KiB and skips unknown sizes, HLS, remux and native playback', async () => {
  const calls = [];
  const api = evaluate(component('js/pages/watch.js', 'mp4TailRange') + '\n' + component('js/pages/watch.js', 'warmMp4Tail'), { fetch: async (...args) => { calls.push(args); } }, '({ mp4TailRange, warmMp4Tail })');
  const stream = { direct: 'https://media.test/file', filename: 'film.mp4', filesize: 1048576 };
  assert.equal(api.mp4TailRange(stream), 'bytes=786432-');
  assert.equal(api.mp4TailRange({ ...stream, filesize: 10 }), 'bytes=0-');
  for (const override of [{ filename: 'film.mkv' }, { filesize: 0 }, { hls: {} }, { remux: true }]) assert.equal(api.mp4TailRange({ ...stream, ...override }), null);
  api.warmMp4Tail(stream, { native: true }); assert.equal(calls.length, 0);
  api.warmMp4Tail(stream); await flush();
  assert.equal(calls.length, 1); assert.equal(calls[0][1].mode, 'no-cors'); assert.equal(calls[0][1].headers.Range, 'bytes=786432-');
});
test('fetchT keeps the caller signal connected while consuming the response body', async t => {
  let bodySignal;
  t.mock.method(globalThis, 'fetch', async (_, init) => { bodySignal = init.signal; return { json: () => new Promise((yes, no) => init.signal.addEventListener('abort', () => no(new DOMException('Aborted', 'AbortError')), { once: true })) }; });
  const ac = new AbortController();
  const work = fetchT('https://example.test', { signal: ac.signal }, 10000, 'test', r => r.json());
  await flush(); ac.abort(); await assert.rejects(work, { name: 'AbortError' }); assert.equal(bodySignal.aborted, true);
});

test('concurrent MediaFusion callers share encryption, and one cancellation does not abort another caller', async () => {
  const body = deferred(), cache = new Map(), a = new AbortController(), b = new AbortController();
  let posts = 0, physicalSignal;
  const mediafusionCfg = evaluate(source('js/core/addons.js'), {
    crypto: { subtle: { digest: async () => new Uint8Array([1, 2, 3]).buffer } }, TextEncoder, AbortController, DOMException,
    store: () => ({ get: () => [] }), ls: { get: (k, d) => cache.get(k) ?? d, set: (k, v) => cache.set(k, v) },
    fetchT: async (url, init, ms, who, read) => { posts++; physicalSignal = init.signal; return read({ ok: true, json: () => body.promise }); },
  }, 'mediafusionCfg');
  const first = mediafusionCfg('mock-key', a.signal), second = mediafusionCfg('mock-key', b.signal);
  await flush(); assert.equal(posts, 1);
  a.abort(); await assert.rejects(first, { name: 'AbortError' });
  assert.equal(physicalSignal.aborted, false);
  body.resolve({ encrypted_str: 'encrypted' });
  assert.equal(await second, 'encrypted'); assert.equal(posts, 1);
});
