import test from 'node:test';
import assert from 'node:assert/strict';
import { rankStreams } from '../js/core/sources.js';

const s = o => ({ cached: false, cam: false, pack: false, rank: 3, size: 2e9, seeders: 10, ...o });

test('cached beats uncached, cached pack still beats a cam', () => {
  const out = rankStreams([s({ n: 'pack', cached: true, pack: true }), s({ n: 'plain' }), s({ n: 'cached', cached: true }), s({ n: 'cam', cam: true })]);
  assert.deepEqual(out.map(x => x.n), ['cached', 'plain', 'pack', 'cam']);
});
test('cachedOnly filters, maxQuality penalises above the cap', () => {
  assert.equal(rankStreams([s({}), s({ cached: true })], { cachedOnly: true }).length, 1);
  const out = rankStreams([s({ n: '4k', rank: 4 }), s({ n: '1080', rank: 3 })], { maxQuality: '1080p' });
  assert.equal(out[0].n, '1080');
});
