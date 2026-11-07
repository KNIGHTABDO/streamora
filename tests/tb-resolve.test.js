import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { evaluate, source } from './helpers/source.js';

const hash = 'a'.repeat(40);
const file = { id: 0, path: 'Show.S01E02.mp4', bytes: 1e9, mime: 'video/mp4' };
const owned = { id: 7, kind: 'torrent', hash, status: 'downloaded', files: [file] };
const args = { infoHash: hash, filename: file.path, fileIdx: 0, season: 1, episode: 2, known: [owned] };
function fixture(handler = () => 'https://media.test/file') {
  const cache = new Map(), calls = []; let now = 100, key = 'mock-key';
  const api = evaluate(source('js/core/tb.js'), {
    Date: { now: () => now }, crypto: webcrypto, TextEncoder, URLSearchParams, FormData, DOMException, setTimeout, clearTimeout,
    canRemuxMkv: () => true, getTbKey: async () => key,
    ls: { get: (k, d) => cache.has(k) ? structuredClone(cache.get(k)) : d, set: (k, v) => cache.set(k, structuredClone(v)) },
    mockTb: async (path, opts = {}) => { if (opts.signal?.aborted) throw new DOMException('Aborted', 'AbortError'); calls.push({ path, opts }); return handler(path, opts, calls); },
  }, 'tb = mockTb; ({ resolveStream, prefetchOwned, ownedFile, webStreamingRefused, TBError })');
  return { api, cache, calls, advance: ms => { now += ms; }, setKey: value => { key = value; } };
}
test('an owned MP4 resolves with exactly one TorBox call: requestdl', async () => {
  const f = fixture();
  const stream = await f.api.resolveStream(args);
  assert.equal(stream.filesize, file.bytes); assert.equal(stream.filename, file.path);
  assert.equal(f.calls.length, 1);
  assert.match(f.calls[0].path, /^torrents\/requestdl\?torrent_id=7&file_id=0$/);
});
test('remembered torrent/file choices survive six hours and mint fresh links without listing the account', async () => {
  const f = fixture(); await f.api.resolveStream(args); f.calls.length = 0; f.advance(7 * 3600e3);
  await f.api.resolveStream({ ...args, known: [] });
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].path, /^torrents\/requestdl/);
});
test('a deleted remembered torrent clears the choice and retries the full add/list path once', async () => {
  let deleted = false;
  const f = fixture(path => {
    if (path.startsWith('torrents/requestdl')) {
      if (deleted && path.includes('torrent_id=7&')) throw Object.assign(Error('Not found'), { status: 404 });
      return 'https://media.test/file';
    }
    if (path.startsWith('torrents/mylist') && path.includes('id=8')) return { id: 8, hash, download_finished: true, files: [{ id: 0, name: file.path, size: file.bytes }] };
    if (path.startsWith('torrents/mylist')) return [];
    if (path === 'torrents/createtorrent') return { torrent_id: 8 };
    throw Error('Unexpected ' + path);
  });
  await f.api.resolveStream(args); f.calls.length = 0; deleted = true;
  const stream = await f.api.resolveStream(args);
  assert.equal(stream.torrentId, 8);
  assert.equal(f.calls.filter(c => c.path === 'torrents/createtorrent').length, 1);
  assert.equal(f.calls.filter(c => c.path.startsWith('torrents/requestdl')).length, 2);
});
test('network and auth failures do not clear choices or add duplicate torrents', async () => {
  let fail = false;
  const f = fixture(() => { if (fail) throw Object.assign(Error('Offline'), { code: 'network' }); return 'https://media.test/file'; });
  await f.api.resolveStream(args); f.calls.length = 0; fail = true;
  await assert.rejects(f.api.resolveStream(args), { code: 'network' });
  assert.equal(f.calls.length, 1);
});
test('strict owned-file selection rejects the largest-file fallback and unowned hashes', () => {
  const f = fixture();
  assert.equal(f.api.ownedFile(owned, { infoHash: hash, season: 1, episode: 3 }), null);
  assert.equal(f.api.ownedFile({ ...owned, hash: 'b'.repeat(40) }, args), null);
  assert.equal(f.api.ownedFile(owned, { infoHash: hash, season: 1, episode: 2 }).id, 0);
  assert.equal(f.api.ownedFile(owned, { infoHash: hash, season: 1, episode: 20 }), null);
});
test('next-episode prefetch is requestdl-only, and the matching resolve consumes its link', async () => {
  const f = fixture();
  assert.equal(await f.api.prefetchOwned({ ...args, known: [] }), null);
  assert.equal(await f.api.prefetchOwned({ ...args, filename: undefined, fileIdx: undefined, episode: 3 }), null);
  assert.equal(f.calls.length, 0);
  const warm = await f.api.prefetchOwned(args);
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].path, /^torrents\/requestdl/);
  const result = await f.api.resolveStream(args);
  assert.equal(result.direct, warm.direct); assert.equal(f.calls.length, 1);
});
test('MKV next prefetch requests only the owned file, retaining browser remux selection on resolve', async () => {
  const f = fixture(), mkv = { ...owned, files: [{ ...file, path: 'Show.S01E02.mkv' }] };
  const next = { ...args, filename: 'Show.S01E02.mkv', known: [mkv] };
  assert.ok(await f.api.prefetchOwned(next));
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].path, /^torrents\/requestdl/);
  const resolved = await f.api.resolveStream(next);
  assert.equal(resolved.remux, true);
  assert.equal(f.calls.filter(c => c.path.startsWith('torrents/requestdl')).length, 1);
  assert.ok(await f.api.prefetchOwned({ ...next, direct: true }));
  assert.equal(f.calls.at(-1).path.startsWith('torrents/requestdl'), true);
});
test('streaming refusal lasts a week per TorBox key, then TorBox is asked again', async () => {
  const f = fixture(path => {
    if (path.startsWith('stream/createstream')) throw Object.assign(Error('Upgrade: not allowed'), { code: 'PLAN_RESTRICTED_FEATURE' });
    if (path.startsWith('torrents/requestdl')) return 'https://media.test/file';
    throw Error(path);
  });
  const mkv = { ...args, filename: 'Show.S01E02.mkv', known: [{ ...owned, files: [{ ...file, path: 'Show.S01E02.mkv' }] }] };
  await f.api.resolveStream(mkv); f.advance(2 * 864e5); f.calls.length = 0;
  await f.api.resolveStream(mkv);
  assert.equal(f.calls.length, 1); assert.match(f.calls[0].path, /^torrents\/requestdl/);
  f.advance(6 * 864e5); f.calls.length = 0;
  await f.api.resolveStream(mkv);
  assert.equal(f.calls.filter(c => c.path.startsWith('stream/createstream')).length, 1, 'asked again after a week');
  f.setKey('different-key'); f.calls.length = 0;
  await f.api.resolveStream(mkv);
  assert.equal(f.calls.filter(c => c.path.startsWith('stream/createstream')).length, 1);
});
test('an already aborted resolve cannot call TorBox', async () => {
  const f = fixture(), ac = new AbortController(); ac.abort();
  await assert.rejects(f.api.resolveStream({ ...args, signal: ac.signal }), { name: 'AbortError' });
  assert.equal(f.calls.length, 0);
});

test('a missing episode cannot mint a link for a different episode or use an unrelated file ID', async () => {
  const f = fixture();
  await assert.rejects(f.api.resolveStream({ ...args, episode: 3, filename: undefined, fileIdx: 0 }), { code: 'content_mismatch' });
  assert.equal(f.calls.length, 0);
});

test('resolved filename identity is checked for owned, remembered and prefetched choices without extra calls', async () => {
  const f = fixture();
  const wrong = { ...args, identity: { id: 'tt2', name: 'Show', series: true, season: 1, episode: 3 } };
  await assert.rejects(f.api.resolveStream(wrong), { code: 'content_mismatch' });
  assert.equal(f.calls.length, 0);
  await f.api.resolveStream(args); f.calls.length = 0;
  await assert.rejects(f.api.resolveStream({ ...wrong, known: [] }), { code: 'content_mismatch' });
  assert.equal(f.calls.length, 0, 'remembered choices still validate without listing the account');
  await f.api.prefetchOwned(args); f.calls.length = 0;
  await assert.rejects(f.api.resolveStream(wrong), { code: 'content_mismatch' });
  assert.equal(f.calls.length, 0, 'a prefetched link cannot bypass identity validation');
});
