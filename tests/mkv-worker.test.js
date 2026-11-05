import test from 'node:test';
import assert from 'node:assert/strict';
import { workerState, ac3WorkerSource } from '../js/player/mkv-worker.js';
import { source, evaluate, flush } from './helpers/source.js';

test('worker protocol commits only after the handle and first media append', () => {
  assert.equal(workerState('starting', { type: 'ready' }), 'starting');
  assert.equal(workerState('starting', { type: 'started' }), 'starting');
  assert.equal(workerState('starting', { type: 'handle' }), 'attached');
  assert.equal(workerState('attached', { type: 'handle' }), 'attached');
  assert.equal(workerState('attached', { type: 'opened' }), 'attached');
  assert.equal(workerState('attached', { type: 'ready' }), 'running');
  assert.equal(workerState('starting', { type: 'error' }), 'fallback');
  assert.equal(workerState('attached', { type: 'error' }), 'fallback');
  assert.equal(workerState('running', { type: 'error' }), 'failed');
  for (const state of ['starting', 'attached', 'running']) assert.equal(workerState(state, { type: 'stop' }), 'stopped');
  for (const state of ['fallback', 'failed', 'stopped']) {
    for (const type of ['ready', 'handle', 'error', 'stop']) assert.equal(workerState(state, { type }), state);
  }
});

test('the AC3 module resolves its own bare imports to the same worker Mediabunny instance', () => {
  const url = 'https://streamora.test/vendor/mediabunny.min.mjs';
  const vendor = source('vendor/mediabunny-ac3.min.mjs');
  const imports = [...vendor.matchAll(/\bfrom\s*(['"])mediabunny\1/g)];
  assert.equal(imports.length, 3, 'check the loader when upgrading this vendor module');
  const resolved = ac3WorkerSource(vendor, url);
  assert.doesNotMatch(resolved, /\bfrom\s*(['"])mediabunny\1/);
  assert.equal(resolved.split(JSON.stringify(url)).length - 1, 3);
});

function setup({ disabled = false, supported = true, storageThrows = false, constructorThrows = false } = {}) {
  const workers = [], fatals = [], retries = [], timers = new Set();
  class Worker {
    messages = []; terminated = 0;
    constructor(url, options) {
      if (constructorThrows) throw Error('blocked');
      assert.equal(url.pathname, '/js/player/mkv-worker.js');
      assert.equal(options.type, 'module');
      workers.push(this);
    }
    postMessage(message) { this.messages.push(message); }
    terminate() { this.terminated++; }
    send(data) { this.onmessage?.({ data }); }
  }
  const video = new EventTarget();
  Object.assign(video, { currentTime: 0, srcObject: null, ownerDocument: { baseURI: 'https://streamora.test/' }, removeAttribute() {}, load() {} });
  const controller = new AbortController();
  let body = source('js/player/mkv.js').replace('import.meta.url', "'https://streamora.test/js/player/mkv.js'");
  // Isolate the orchestration from the separately exercised real buffering loop.
  body = body.slice(0, body.indexOf('// The same buffering loop'));
  const attach = evaluate(body, {
    window: { MediaSource: { canConstructInDedicatedWorker: supported }, get localStorage() {
      if (storageThrows) throw Error('denied');
      return { getItem: () => disabled ? '0' : null };
    } }, Worker, URL, workerState,
    setTimeout(fn) { timers.add(fn); return fn; }, clearTimeout(fn) { timers.delete(fn); },
    attachMkvMain: async (v, url, options) => { retries.push({ v, url, options }); return () => {}; },
  }, 'attachMkv');
  const open = (options = {}) => attach(video, 'signed-fixture', { signal: controller.signal, audioLang: 'ara', start: 120, onFatal: (...args) => fatals.push(args), ...options });
  return { open, workers, video, controller, fatals, retries, timers };
}

test('worker attachment transfers playback, seek epochs and language, and releases ten sessions', async () => {
  const s = setup();
  for (let i = 0; i < 10; i++) {
    const pending = s.open();
    const w = s.workers[i];
    assert.deepEqual(JSON.parse(JSON.stringify(w.messages[0])), { type: 'start', url: 'https://streamora.test/signed-fixture', start: 120, audioLang: 'ara', time: s.video.currentTime });
    w.send({ type: 'started' });
    assert.equal(s.timers.size, 0);
    const handle = {};
    w.send({ type: 'handle', handle });
    assert.equal(s.video.srcObject, handle);
    w.send({ type: 'opened' });
    assert.equal(s.timers.size, 0);
    s.video.currentTime = 300;
    s.video.dispatchEvent(new Event('seeking'));
    s.video.dispatchEvent(new Event('timeupdate'));
    assert.equal(w.messages.at(-1).time, 300);
    assert.equal(w.messages.at(-1).epoch, 1);
    w.send({ type: 'position', time: 120, epoch: 0 });
    assert.equal(s.video.currentTime, 300, 'stale positioning cannot undo a seek');
    w.send({ type: 'position', time: 300, epoch: 1 });
    assert.equal(s.video.currentTime, 300);
    w.send({ type: 'ready' });
    const destroy = await pending;
    destroy(); destroy();
    assert.equal(w.terminated, 1);
    assert.equal(w.messages.at(-1).type, 'stop');
    assert.equal(s.video.srcObject, null);
    const count = w.messages.length;
    s.video.dispatchEvent(new Event('seeking'));
    assert.equal(w.messages.length, count);
    assert.equal(s.timers.size, 0);
  }
  assert.equal(s.retries.length, 0);
  assert.equal(s.fatals.length, 0);
});

test('a worker position cannot overwrite a newer pre-metadata currentTime write', async () => {
  const s = setup();
  const pending = s.open();
  const w = s.workers[0];
  w.send({ type: 'handle', handle: {} });
  s.video.currentTime = 90; // readyState=0 does not guarantee a seeking event
  w.send({ type: 'position', time: 120, epoch: 0 });
  assert.equal(s.video.currentTime, 90);
  assert.equal(w.messages.at(-1).event, 'seeking');
  assert.equal(w.messages.at(-1).time, 90);
  w.send({ type: 'ready' });
  (await pending)();
});

test('startup failures clean up and retry the main thread at the latest position', async () => {
  for (const cause of ['error', 'messageerror', 'video', 'timeout', 'assignment', 'before-handle']) {
    const s = setup();
    const pending = s.open();
    const w = s.workers[0];
    if (cause === 'assignment') Object.defineProperty(s.video, 'srcObject', { get: () => null, set: value => { if (value) throw Error('unsupported'); } });
    if (cause !== 'before-handle') w.send({ type: 'handle', handle: {} });
    s.video.currentTime = 250;
    if (cause === 'error') w.send({ type: 'error', code: 'mkvaudio' });
    if (cause === 'messageerror') w.onmessageerror();
    if (cause === 'video') s.video.dispatchEvent(new Event('error'));
    if (cause === 'timeout') [...s.timers][0]();
    if (cause === 'before-handle') w.onerror({ preventDefault() {} });
    const destroy = await pending;
    assert.equal(typeof destroy, 'function');
    assert.equal(w.terminated, 1);
    assert.equal(s.retries.length, 1);
    assert.equal(s.retries[0].options.start, cause === 'assignment' ? 120 : 250);
    assert.equal(s.retries[0].options.audioLang, 'ara');
    assert.equal(s.fatals.length, 0);
    assert.equal(s.timers.size, 0);
  }
});

test('runtime failure reports a sanitized fatal once without restarting playback', async () => {
  const s = setup();
  const pending = s.open();
  const w = s.workers[0];
  w.send({ type: 'handle', handle: {} }); w.send({ type: 'ready' });
  const destroy = await pending;
  const lateMessage = w.onmessage;
  w.send({ type: 'error', code: 'mkvaudio', message: 'secret signed URL' });
  lateMessage({ data: { type: 'error' } });
  lateMessage({ data: { type: 'position', time: 900, epoch: 0 } });
  assert.equal(s.video.currentTime, 0);
  assert.equal(s.fatals.length, 1);
  assert.equal(s.fatals[0][0].code, 'mkvaudio');
  assert.doesNotMatch(s.fatals[0][0].message, /secret/);
  assert.equal(s.retries.length, 0);
  destroy();
  assert.equal(w.terminated, 1);
});

test('abort during startup and a source change terminate the old worker without fallback', async () => {
  const s = setup();
  const first = s.open();
  s.controller.abort();
  (await first)();
  assert.equal(s.workers[0].terminated, 1);
  assert.equal(s.retries.length, 0);
  const secondController = new AbortController();
  const second = s.open({ signal: secondController.signal, audioLang: 'eng' });
  const w = s.workers[1];
  w.send({ type: 'handle', handle: {} }); w.send({ type: 'ready' });
  const destroy = await second;
  secondController.abort(); destroy();
  assert.equal(w.terminated, 1);
  assert.equal(w.messages[0].audioLang, 'eng');
  await flush();
  assert.equal(s.fatals.length, 0);
});

test('capability gate, local override and blocked constructors retain the original path', async () => {
  for (const options of [{ supported: false }, { disabled: true }, { constructorThrows: true }]) {
    const s = setup(options);
    await s.open();
    assert.equal(s.workers.length, 0);
    assert.equal(s.retries.length, 1);
    assert.equal(s.timers.size, 0);
  }
  const s = setup({ storageThrows: true });
  const pending = s.open();
  s.controller.abort();
  await pending;
  assert.equal(s.workers.length, 1);
  assert.equal(s.retries.length, 0);
});
