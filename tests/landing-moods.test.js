import test from 'node:test';
import assert from 'node:assert/strict';
import { MOODS } from '../js/lib/discover-lists.js';
import { LANDING_MOODS } from '../js/landing/wheel.js';

test('the eight printed landing moods match the app IDs, labels and order', () => {
  assert.equal(LANDING_MOODS.length, 8);
  assert.deepEqual(LANDING_MOODS, MOODS.slice(0, 8).map(({ id, label }) => ({ id, label })));
  assert.equal(new Set(LANDING_MOODS.map(m => m.id)).size, 8);
});
