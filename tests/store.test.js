import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeValue, mergeData } from '../js/core/store.js';

test('arrays merge by id, newer timestamp wins, local order first', () => {
  const out = mergeValue([{ id: 'a', at: 5, n: 'old' }, { id: 'b' }], [{ id: 'a', at: 9, n: 'new' }, { id: 'c' }]);
  assert.deepEqual(out.map(x => x.id), ['a', 'b', 'c']);
  assert.equal(out[0].n, 'new');
  assert.equal(mergeValue([{ id: 'a', at: 9, n: 'local' }], [{ id: 'a', at: 1, n: 'stale' }])[0].n, 'local');
  assert.deepEqual(mergeValue(['x', 'y'], ['y', 'z']), ['x', 'y', 'z']);
});
test('objects merge key-wise, newer entry wins', () => {
  const out = mergeValue({ m1: { updated: 10, v: 'l' }, m2: { updated: 1 } }, { m1: { updated: 5, v: 'r' }, m3: { updated: 2 } });
  assert.deepEqual(Object.keys(out), ['m1', 'm2', 'm3']);
  assert.equal(out.m1.v, 'l');
  assert.deepEqual(mergeValue({ a: 1, b: 2 }, { b: 3 }), { a: 1, b: 3 });
});
test('mergeData skips key material, type mismatches and keeps the active profile', () => {
  const out = mergeData(
    { activeProfile: 'p1', 'p:p1:watchlist': [{ id: 'a' }], profiles: [{ id: 'p1' }] },
    { rdkey: { v: 1 }, 'rdkey-state': { set: true }, activeProfile: 'p2', 'p:p1:watchlist': { bad: 1 }, 'p:p2:history': 'nope', profiles: [{ id: 'p2' }] },
  );
  assert.deepEqual(Object.keys(out), ['profiles']);
  assert.deepEqual(out.profiles.map(p => p.id), ['p1', 'p2']);
  assert.equal(mergeData({ x: 1 }, { x: 2 }, false).x, 2);
});
