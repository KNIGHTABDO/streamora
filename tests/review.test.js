import test from 'node:test';
import assert from 'node:assert/strict';
import { source } from './helpers/source.js';

test('detail does not eagerly import the native player, and both pages use neutral webPrefs directly', () => {
  const detail = source('js/pages/detail.js');
  assert.doesNotMatch(detail, /import[^\n]*from ['"][^'"]*player\/native\.js/);
  for (const path of ['js/pages/detail.js', 'js/pages/watch.js']) assert.ok(source(path).includes('...webPrefs(webStreamingRefused())'), path);
});

import { component, evaluate } from './helpers/source.js';
import { hooks, nodes } from './helpers/hooks.js';
const Player = () => {}, Loading = () => {}, ErrorNote = () => {};
function watch(query = {}, sources = [{ infoHash: 'abc', filename: 'addon.mkv', fileIdx: 7, rank: 3 }]) {
  const host = hooks(), resolved = [];
  const Session = evaluate(component('js/pages/watch.js', 'Session'), {
    ...host.scope, MAX_AUTO: 4, Player, AppPlayer: Player, Loading, SourcePicker: () => {},
    settings: { get: () => ({}) }, progress: { get: () => ({}) },
    getMeta: async () => ({ id: 'test', type: 'movie', name: 'Test' }), resumeAt: () => 0,
    streams: async () => sources, torrents: async () => [], rankStreams: list => list,
    isNative: () => false, isPhone: () => false, webPrefs: () => ({}), webStreamingRefused: () => false,
    backdropOf: () => '', backTo: () => () => {}, netFail: () => false,
    resolveStream: async args => { resolved.push(args); return { filename: args.filename, remux: true, direct: 'mock-file' }; },
  }, 'Session');
  host.mount(Session, { params: { type: 'movie', id: 'test' }, query: { t: '120', ...query } });
  return { host, resolved };
}
test('the final resolved source failure unmounts Player and presents working retry actions', async () => {
  const { host, resolved } = watch();
  let tree = await host.settle();
  const error = Object.assign(new Error('Unsupported audio'), { code: 'mkvaudio' });
  nodes(tree, x => x.type === Player)[0].props.onFatal(error, 123);
  tree = await host.settle();
  assert.equal(nodes(tree, x => x.type === Player).length, 0);
  const loading = nodes(tree, x => x.type === Loading)[0];
  assert.equal(loading.props.err, error);
  assert.equal(typeof loading.props.onPick, 'function');
  loading.props.onRetry();
  tree = await host.settle();
  assert.equal(nodes(tree, x => x.type === Player).length, 1);
  assert.equal(resolved.length, 2);
});
test('Retry after a failed page import invokes the loader again and renders the module', async () => {
  const host = hooks();
  let loads = 0;
  const Comp = () => {};
  const route = { pattern: '/test', path: '/test', query: {}, load: async () => { if (++loads === 1) throw Error('offline'); return { default: Comp }; } };
  const PageHost = evaluate(component('js/main.js', 'PageHost'), {
    ...host.scope, pageCache: new Map(), URLSearchParams, ErrorNote, Spinner: () => {}, Btn: () => {}, KEEP_HOME_FOR: [], KeptHome: () => {},
    document: { getElementById: () => null, querySelector: () => null },
  }, 'PageHost');
  host.mount(PageHost, { route });
  let tree = await host.settle();
  nodes(tree, x => x.type === ErrorNote)[0].props.retry();
  tree = await host.settle();
  assert.equal(loads, 2);
  assert.equal(nodes(tree, x => x.type === Comp).length, 1);
});
test('watch-link file and filename override a matched source, preserving other candidate fields', async () => {
  const { host, resolved } = watch({ hash: 'abc', file: '0', fn: 'explicit.mkv' });
  const tree = await host.settle();
  assert.equal(resolved[0].fileIdx, 0);
  assert.equal(resolved[0].filename, 'explicit.mkv');
  assert.equal(nodes(tree, x => x.type === Player)[0].props.source.rank, 3);
  const defaults = watch({ hash: 'abc' }); await defaults.host.settle();
  assert.equal(defaults.resolved[0].fileIdx, 7);
  assert.equal(defaults.resolved[0].filename, 'addon.mkv');
});
