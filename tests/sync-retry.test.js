import test from 'node:test';
import assert from 'node:assert/strict';
import { source, evaluate, flush } from './helpers/source.js';

function fixture(httpStatus = 0) {
  let now = 100000, nextId = 1, signedIn = false, failing = true, failUploads = false, calls = 0;
  const uploads = [];
  const timers = new Map(), values = new Map([['sync-changed', 10], ['gd-clean', 0], ['gd-file', 'file'], ['gd-ver', '1']]);
  const events = new EventTarget(), document = new EventTarget(), navigator = { onLine: true };
  document.visibilityState = 'visible';
  const setTimeout = (fn, delay) => { const id = nextId++; timers.set(id, { fn, at: now + delay }); return id; };
  const ls = { get: (k, d) => values.has(k) ? values.get(k) : d, set: (k, v) => values.set(k, v), del: k => values.delete(k) };
  const sync = evaluate(source('js/core/sync.js'), {
    document, navigator, Date: class extends Date { static now() { return now; } },
    setTimeout, clearTimeout: id => timers.delete(id), setInterval() {},
    addEventListener: events.addEventListener.bind(events),
    store: (_, initial) => { let v = initial; return { get: () => v, set: x => { v = x; } }; },
    ls, account: { get: () => signedIn, subscribe() {} }, accessToken: async () => 'mock', SignedOut: class extends Error {},
    exportAll: () => ({ data: {} }), profiles: { get: () => [] }, getTbKey: async () => null,
    idbGet: async () => null, TextEncoder, Response, Blob, structuredClone,
    fetch: async (_, opts) => {
      calls++;
      if (opts.method === 'PATCH') uploads.push({ visibility: document.visibilityState, at: now });
      if (failUploads && opts.method === 'PATCH') throw new Error('upload unavailable');
      if (failing) {
        if (httpStatus) return Response.json({}, { status: httpStatus });
        throw new Error('network unavailable');
      }
      return Response.json({ id: 'file', version: opts.method ? '2' : '1' });
    },
  }, '({ syncNow, initSync, syncPending })');
  return {
    ...sync, document, navigator, ls, uploads,
    async start() { await sync.initSync(); signedIn = true; },
    get calls() { return calls; },
    get delay() { return timers.size ? Math.min(...[...timers.values()].map(x => x.at)) - now : null; },
    succeed() { failing = false; failUploads = false; },
    failUpload() { failing = false; failUploads = true; }, fail() { failing = true; },
    event: (name, detail) => events.dispatchEvent(Object.assign(new Event(name), { detail })),
    visibility(value) { document.visibilityState = value; document.dispatchEvent(new Event('visibilitychange')); },
    async tick(ms) {
      const end = now + ms;
      await flush();
      for (;;) {
        const due = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
        if (!due || due[1].at > end) break;
        now = due[1].at; timers.delete(due[0]); due[1].fn(); await flush();
      }
      now = end; await flush();
    },
  };
}
test('Drive failures retry at 5s with exponential backoff capped at five minutes', async () => {
  const f = fixture(); await f.start(); await f.syncNow();
  assert.equal(f.calls, 1, 'a failed request starts one retry deadline');
  for (const delay of [5000, 10000, 20000, 40000, 80000, 160000, 300000, 300000]) {
    assert.equal(f.delay, delay);
    const before = f.calls;
    await f.tick(delay - 1); assert.equal(f.calls, before);
    await f.tick(1); assert.equal(f.calls, before + 1);
    assert.equal(f.ls.get('gd-clean'), 0, 'failed uploads never clear dirty data');
  }
});
test('local edits and polling cannot bypass an outstanding retry deadline', async () => {
  const f = fixture(); await f.start(); await f.syncNow();
  await f.tick(1000); f.event('streamora:changed', 'p:test:progress');
  await f.syncNow();
  assert.equal(f.calls, 1);
  assert.equal(f.delay, 4000);
  await f.tick(3999); assert.equal(f.calls, 1);
  await f.tick(1); assert.equal(f.calls, 2);
});
test('Drive retries wait while offline or hidden and online resets backoff', async () => {
  const f = fixture(); await f.start(); await f.syncNow();
  f.navigator.onLine = false; f.event('offline');
  await f.tick(300000); await f.syncNow();
  assert.equal(f.calls, 1);
  assert.equal(f.delay, null);
  assert.equal(f.syncPending(), true);
  f.visibility('hidden'); f.navigator.onLine = true; f.event('online'); await flush();
  assert.equal(f.calls, 1);
  f.visibility('visible'); await flush();
  assert.equal(f.calls, 2);
  assert.equal(f.delay, 5000);
  f.visibility('hidden'); await f.tick(300000); await f.syncNow();
  assert.equal(f.calls, 2);
  assert.equal(f.ls.get('gd-clean'), 0);
});
test('successful sync resets backoff and only then marks the saved data clean', async () => {
  const f = fixture(); await f.start(); await f.syncNow();
  await f.tick(5000); assert.equal(f.delay, 10000);
  f.succeed(); await f.tick(10000);
  assert.equal(f.ls.get('gd-clean'), 10);
  assert.equal(f.delay, null);
  f.fail(); f.event('streamora:changed', 'p:test:progress');
  await f.tick(1500);
  assert.equal(f.delay, 5000);
  assert.ok(f.ls.get('sync-changed') > f.ls.get('gd-clean'));
});
test('a short background visit restores the pending retry without waiting for the polling interval', async () => {
  const f = fixture(); await f.start(); f.event('online'); await flush();
  assert.equal(f.calls, 1);
  f.visibility('hidden'); await f.tick(1000); f.visibility('visible'); await flush();
  assert.equal(f.delay, 4000);
});

test('HTTP 429 and 500 failures use the same five-second retry delay', async () => {
  for (const status of [429, 500]) {
    const f = fixture(status); await f.start(); await f.syncNow();
    assert.equal(f.calls, 1); assert.equal(f.delay, 5000);
    await f.tick(4999); assert.equal(f.calls, 1);
    await f.tick(1); assert.equal(f.calls, 2); assert.equal(f.delay, 10000);
  }
});

test('a pending edit flushes exactly one upload on hide while online and signed in', async () => {
  const f = fixture(); await f.start(); f.succeed();
  f.event('streamora:changed', 'p:test:progress');
  assert.equal(f.delay, 1500);
  f.visibility('hidden'); await flush();
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0].visibility, 'hidden');
  assert.equal(f.ls.get('gd-clean'), f.ls.get('sync-changed'));
  assert.equal(f.delay, null);
  const before = f.calls;
  f.visibility('hidden'); await f.syncNow(); await f.tick(300000);
  assert.equal(f.calls, before, 'ordinary sync and repeated hides do not bypass visibility');
});
test('a pending edit hidden during backoff uploads only after visibility and the retry deadline', async () => {
  const f = fixture(); await f.start(); await f.syncNow();
  f.succeed(); f.event('streamora:changed', 'p:test:progress');
  assert.equal(f.delay, 5000);
  f.visibility('hidden'); await flush();
  assert.equal(f.uploads.length, 0); assert.equal(f.calls, 1);
  await f.tick(1000); f.visibility('visible'); await flush();
  assert.equal(f.delay, 4000);
  await f.tick(3999); assert.equal(f.uploads.length, 0);
  await f.tick(1);
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0].visibility, 'visible');
  assert.equal(f.uploads[0].at, 105000);
});
test('a failed hide flush records backoff without attempting retries while hidden', async () => {
  const f = fixture(); await f.start(); f.failUpload();
  f.event('streamora:changed', 'p:test:progress');
  f.visibility('hidden'); await flush();
  assert.equal(f.uploads.length, 1);
  assert.equal(f.uploads[0].visibility, 'hidden');
  assert.equal(f.ls.get('gd-clean'), 0); assert.equal(f.syncPending(), true);
  assert.equal(f.delay, null);
  await f.tick(1000); f.visibility('visible'); await flush();
  assert.equal(f.delay, 4000, 'the failed flush recorded the five-second backoff');
  f.visibility('hidden'); await f.tick(300000); await f.syncNow();
  assert.equal(f.uploads.length, 1); assert.equal(f.calls, 2);
  assert.equal(f.delay, null);
  f.visibility('visible'); await flush();
  assert.equal(f.uploads.length, 2);
  assert.equal(f.uploads[1].visibility, 'visible');
  assert.equal(f.delay, 10000, 'only a visible retry advances the backoff');
});
