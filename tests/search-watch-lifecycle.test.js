import test from 'node:test';
import assert from 'node:assert/strict';
import { hooks, nodes } from './helpers/hooks.js';
import { evaluate, source, component, flush } from './helpers/source.js';

function searchFixture(coarse) {
  let time = 0, seq = 0, query = {}; const tasks = new Map(), requests = [], host = hooks();
  let Search;
  const render = () => { const tree = host.mount(Search, { query }); host.commit(); return tree; };
  Search = evaluate(source('js/pages/search.js').replace('export default ', ''), {
    ...host.scope, AbortController, DOMException, document: {},
    matchMedia: q => ({ matches: q.includes('coarse') && coarse }), loadCSS() {},
    setTimeout: (fn, ms) => { const id = ++seq; tasks.set(id, { at: time + ms, fn }); return id; }, clearTimeout: id => tasks.delete(id),
    pstore: () => ({ get: () => [], update() {} }), useStore: () => [], useAsync: () => ({}),
    setQuery: values => { query = { ...query, ...values }; render(); },
    Page() {}, Grid() {}, Chip() {}, Row() {}, Empty() {}, ErrorNote() {}, IconBtn() {}, Icon() {}, toast() {}, cx() {},
    search: (q, type, partial, { signal }) => new Promise((yes, no) => {
      requests.push({ q, signal });
      signal.addEventListener('abort', () => no(new DOMException('Aborted', 'AbortError')), { once: true });
    }),
  }, 'Search');
  render();
  return {
    host, requests,
    type(value) { nodes(host.render(), n => n.type === 'input')[0].props.onInput({ currentTarget: { value } }); render(); },
    async tick(ms) {
      const end = time + ms;
      for (;;) {
        const next = [...tasks].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        tasks.delete(next[0]); time = next[1].at; next[1].fn(); await flush();
      }
      time = end; await flush();
    },
  };
}
test('touch typing breaking bad every 260ms sends one search round (four source requests)', async () => {
  const f = searchFixture(true), title = 'breaking bad';
  for (let n = 1; n <= title.length; n++) { f.type(title.slice(0, n)); await f.tick(260); }
  await f.tick(301);
  assert.equal(f.requests.length, 1); assert.equal(f.requests[0].q, title);
  f.host.unmount(); assert.equal(f.requests[0].signal.aborted, true);
});
test('desktop search requires two characters and aborts on the next keystroke before debounce', async () => {
  const f = searchFixture(false);
  f.type('b'); await f.tick(200); assert.equal(f.requests.length, 0);
  f.type('br'); await f.tick(200); assert.equal(f.requests.length, 1);
  f.type('bre'); assert.equal(f.requests[0].signal.aborted, true);
  await f.tick(200); assert.equal(f.requests.length, 2);
  f.host.unmount(); assert.ok(f.requests.every(r => r.signal.aborted));
});
test('watch late addons extend the picker without resolving again, and unmount aborts the session', async () => {
  const host = hooks(), resolved = [], calls = [];
  const Player = () => {}, SourcePicker = () => {};
  const a = { infoHash: 'a', filename: 'a.mp4', rank: 3, cached: true }, b = { infoHash: 'b', filename: 'b.mp4', rank: 4, cached: true };
  const Session = evaluate(component('js/pages/watch.js', 'Session'), {
    ...host.scope, AbortController, MAX_AUTO: 4, Player, AppPlayer: Player, Loading() {}, SourcePicker,
    settings: { get: () => ({}) }, progress: { get: () => ({}) },
    getMeta: async () => ({ id: 'tt1', name: 'Title', type: 'movie' }), resumeAt: () => 0,
    streams: async (type, id, opts) => { calls.push(opts); return [a]; }, torrents: async () => [], rankStreams: list => list,
    isNative: () => false, isPhone: () => false, webPrefs: () => ({}), webStreamingRefused: () => false,
    backdropOf: () => '', backTo: () => () => {}, netFail: () => false,
    resolveStream: async args => { resolved.push(args); return { filename: args.filename, direct: 'mock-file' }; },
  }, 'Session');
  host.mount(Session, { params: { type: 'movie', id: 'tt1' }, query: { t: '0' } });
  await host.settle(); assert.equal(resolved.length, 1);
  calls[0].onPartial([a, b]); const tree = await host.settle();
  assert.equal(resolved.length, 1);
  assert.equal(nodes(tree, n => n.type === SourcePicker)[0].props.list.length, 2);
  host.unmount(); assert.equal(calls[0].signal.aborted, true); assert.equal(resolved[0].signal.aborted, true);
  const before = host.updates; calls[0].onPartial([a, b]); assert.equal(host.updates, before);
});
