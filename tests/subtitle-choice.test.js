import test from 'node:test';
import assert from 'node:assert/strict';
import { createSubtitleLoader } from '../js/player/subtitle-choice.js';
import { deferred } from './helpers/source.js';

function fixture() {
  const a = deferred(), b = deferred(), cues = [], errors = [], loading = [], off = [];
  const loader = createSubtitleLoader({
    load: it => ({ a, b })[it.id].promise,
    onLoading: it => loading.push(it.id), onCues: it => cues.push(it.id),
    onOff: () => off.push(true), onError: e => errors.push(e.message),
  });
  return { a, b, cues, errors, loading, off, loader };
}
test('a slow old subtitle cannot replace the newer selected subtitle', async () => {
  const f = fixture();
  const a = f.loader.choose({ id: 'a' }), b = f.loader.choose({ id: 'b' });
  f.b.resolve(['B']); await b; f.a.resolve(['A']); await a;
  assert.deepEqual(f.cues, ['b']);
});
test('Off invalidates every in-flight subtitle choice', async () => {
  const f = fixture(); const a = f.loader.choose({ id: 'a' });
  await f.loader.choose(null); f.a.resolve(['A']); await a;
  assert.deepEqual(f.cues, []); assert.equal(f.off.length, 1);
});
test('unmount suppresses pending completions and subsequent selections', async () => {
  const f = fixture(); const a = f.loader.choose({ id: 'a' });
  f.loader.dispose(); f.a.resolve(['A']); await a; await f.loader.choose({ id: 'b' });
  assert.deepEqual(f.cues, []); assert.deepEqual(f.loading, ['a']); assert.deepEqual(f.errors, []);
});
test('a stale download failure cannot clear a newer subtitle or show an obsolete warning', async () => {
  const f = fixture(); const a = f.loader.choose({ id: 'a' }), b = f.loader.choose({ id: 'b' });
  f.a.reject(Error('old failure')); await a; f.b.resolve(['B']); await b;
  assert.deepEqual(f.errors, []); assert.deepEqual(f.cues, ['b']);
});
test('the current download failure is still reported and invalidates pending auto-selection snapshots', async () => {
  const f = fixture(), before = f.loader.version;
  const a = f.loader.choose({ id: 'a' }); f.a.reject(Error('current failure')); await a;
  assert.deepEqual(f.errors, ['current failure']); assert.equal(f.loader.isCurrent(before), false);
});
