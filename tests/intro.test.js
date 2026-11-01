import test from 'node:test';
import assert from 'node:assert/strict';
import { filmAllowed, filmSource, welcomeLines } from '../js/intro.js';

test('the film respects reduced motion, Save-Data and very slow links', () => {
  assert.equal(filmAllowed({ effectiveType: '4g' }), true);
  assert.equal(filmAllowed({ reducedMotion: true }), false);
  assert.equal(filmAllowed({ saveData: true }), false);
  assert.equal(filmAllowed({ effectiveType: '2g' }), false);
});

test('phones and slow links get 480p, larger screens 720p', () => {
  assert.match(filmSource({ width: 390, height: 844 }), /480/);
  assert.match(filmSource({ width: 1440, height: 900 }), /720/);
  assert.match(filmSource({ width: 1440, height: 900, downlink: 1.5 }), /480/);
  assert.match(filmSource({ width: 1440, height: 900, effectiveType: '3g' }), /480/);
  assert.match(filmSource({ width: 1440, height: 900, downlink: 0 }), /720/);
});

test('the welcome speaks to who is watching', () => {
  assert.equal(welcomeLines({ signedIn: false })[0], 'Welcome to Streamora.');
  assert.equal(welcomeLines({ signedIn: true, name: 'Ana', seenBefore: true })[0], 'Welcome back, Ana.');
  assert.equal(welcomeLines({ signedIn: true, name: 'Ana', seenBefore: false })[0], 'Welcome, Ana.');
  assert.equal(welcomeLines({ signedIn: true, name: '', seenBefore: true })[0], 'Welcome back.');
});

test('contain geometry preserves the final composition on wide and portrait screens', async () => {
  const { letterboxRect, markRect } = await import('../js/intro.js');
  assert.deepEqual(letterboxRect(1280, 720), { left: 0, top: 0, width: 1280, height: 720 });
  assert.deepEqual(markRect(letterboxRect(1280, 720)), { left: 556, top: 138, width: 168, height: 200 });
  const portrait = letterboxRect(390, 844);
  assert.equal(portrait.left, 0);
  assert.equal(portrait.width, 390);
  assert.equal(portrait.top, (844 - 390 * 9 / 16) / 2);
  const mark = markRect(portrait);
  assert.equal(mark.left + mark.width / 2, 195);
  assert.equal(mark.height / mark.width, 200 / 168);
  const wide = letterboxRect(1600, 720);
  assert.equal(wide.left, 160);
  assert.equal(markRect(wide).left, 716);
  const odd = letterboxRect(333, 777, 854, 480);
  assert.ok(Math.abs(odd.width / odd.height - 854 / 480) < 1e-12);
});

test('fold clips run corner to corner and reflection fixes the fold line', async () => {
  const { foldGeometry } = await import('../js/intro.js');
  for (const [w, h] of [[1280, 720], [390, 844], [1920, 400]]) {
    const start = foldGeometry(w, h, 0), end = foldGeometry(w, h, 1);
    assert.ok(start.distance > start.nx * w + start.ny * h);
    assert.ok(end.distance < 0);
    for (const progress of [0, .25, .5, .8, 1]) {
      const g = foldGeometry(w, h, progress);
      const [a, b, c, d, e, f] = g.reflection;
      const reflect = (x, y) => [a * x + c * y + e, b * x + d * y + f];
      const x = g.nx * g.distance - g.ny * 75, y = g.ny * g.distance + g.nx * 75;
      const fixed = reflect(x, y);
      assert.ok(Math.abs(fixed[0] - x) < 1e-9 && Math.abs(fixed[1] - y) < 1e-9);
      const mirrored = reflect(w, h), twice = reflect(...mirrored);
      assert.ok(Math.abs(twice[0] - w) < 1e-9 && Math.abs(twice[1] - h) < 1e-9);
      assert.ok(Math.abs((g.nx * mirrored[0] + g.ny * mirrored[1]) - (2 * g.distance - g.nx * w - g.ny * h)) < 1e-9);
      // The rotated clip's right edge lies on the fold, independent of aspect ratio.
      assert.ok(Math.abs(g.nx * g.x + g.ny * g.y + g.size - g.distance) < 1e-9);
    }
    assert.deepEqual(foldGeometry(w, h, -1), start);
    assert.deepEqual(foldGeometry(w, h, 2), end);
  }
});

test('slow-device fallback includes measured frame rate without penalizing a single late frame', async () => {
  const { slowDevice } = await import('../js/intro.js');
  assert.equal(slowDevice({}), false);
  for (const hint of [{ saveData: true }, { hardwareConcurrency: 2 }, { deviceMemory: 2 }]) assert.equal(slowDevice(hint), true);
  assert.equal(slowDevice({ frameTimes: Array(20).fill(40) }), true);
  assert.equal(slowDevice({ frameTimes: [100, ...Array(20).fill(16.7)] }), false);
  assert.equal(slowDevice({ frameTimes: [100] }), false);
});
