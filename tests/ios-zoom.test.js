import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
const paper = read('css/paper.css');
const main = read('js/main.js');
test('pages disable double-tap zoom with low-specificity touch rules', () => {
  assert.match(paper, /html[^{]*\{[^}]*touch-action:\s*manipulation/);
  const rule = paper.match(/:where\(([^}]+)\)\s*\{[^}]*touch-action:\s*manipulation/);
  assert.ok(rule, 'interactive defaults must allow more specific gesture rules to win');
  for (const selector of ['a', 'button', 'input', 'select', 'textarea', 'label', '[role="button"]']) assert.ok(rule[1].split(',').map(x => x.trim()).includes(selector), selector);
});
test('only the native app locks viewport scaling and prevents native gestures', () => {
  assert.match(main, /user-scalable=no/);
  assert.match(main, /gesturestart/);
  assert.match(main, /window\.Capacitor\?\.isNativePlatform\?\.\(\)/);
  assert.match(main, /classList\.add\('native-app'\)/);
  assert.match(paper, /html\.native-app\s*\{[^}]*user-select:\s*none/);
  assert.match(paper, /html\.native-app input,\s*html\.native-app textarea\s*\{[^}]*user-select:\s*text/);
});
test('the player keeps its own double-tap seek gestures', () => {
  assert.match(read('css/player.css'), /\.pl-surface\s*\{[^}]*touch-action:\s*none/);
});
