import test from 'node:test';
import assert from 'node:assert/strict';
import { source, evaluate } from './helpers/source.js';

// A tiny browser: hash history with states, a scroll position and event listeners.
function browser() {
  const listeners = {};
  const entries = [{ hash: '#/', state: null }];
  let at = 0, now = 0;
  const observers = [];
  const w = {
    scrollY: 0,
    scrolledTo: [],
    location: { hostname: 'example.com', get hash() { return entries[at].hash; }, set hash(h) { entries.splice(at + 1); entries.push({ hash: h, state: null }); at++; w.fire('hashchange'); } },
    history: {
      get state() { return entries[at].state; },
      get length() { return entries.length; },
      replaceState(state, _t, h) { entries[at] = { hash: h || entries[at].hash, state }; },
      back() { at--; w.fire('hashchange'); },
      scrollRestoration: 'auto',
    },
    addEventListener(type, fn) { (listeners[type] ||= new Set()).add(fn); },
    removeEventListener(type, fn) { listeners[type] && listeners[type].delete(fn); },
    fire(type) { for (const fn of [...(listeners[type] || [])]) fn({ type }); },
    count: type => (listeners[type] ? listeners[type].size : 0),
    scrollTo({ top }) { w.scrollY = Math.min(top, w.maxY); w.scrolledTo.push(top); },
    maxY: 0,
    document: { getElementById: () => ({}), documentElement: {} },
    ResizeObserver: class { constructor(fn) { this.fn = fn; observers.push(this); } observe() {} disconnect() { this.off = true; } },
    resize() { for (const o of observers) if (!o.off) o.fn(); },
    Date: { now: () => now },
    tick(ms) { now += ms; },
    setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    HashChangeEvent: class { constructor(type) { this.type = type; } },
    dispatchEvent(e) { w.fire(e.type); },
    URLSearchParams,
  };
  w.window = w;
  return w;
}

const load = w => evaluate(source('js/router.js'), w, '({ navigate, settleScroll, back })');

test('Back returns to where the page was when it was left, even after the next page scrolled to the top', () => {
  const w = browser();
  const r = load(w);
  w.maxY = 5000;
  w.scrollY = 1800;
  r.navigate('#/title/movie/tt1');      // leave Home at 1800
  r.settleScroll();                     // the new page starts at the top
  assert.equal(w.scrollY, 0);
  w.scrollY = 600;                      // read a bit of the detail page
  w.history.back();
  w.maxY = 900;                         // Home is still loading: too short to hold 1800
  r.settleScroll();
  assert.equal(w.scrollY, 900);
  w.tick(300); w.maxY = 5000; w.resize(); // rows arrive
  assert.equal(w.scrollY, 1800);
});

test('the restore stops when the user scrolls, types or presses a key', () => {
  const w = browser();
  const r = load(w);
  w.maxY = 5000; w.scrollY = 1200;
  r.navigate('#/title/movie/tt1');
  r.settleScroll();
  w.history.back();
  w.maxY = 300;
  r.settleScroll();
  assert.equal(w.count('keydown'), 1);
  w.fire('keydown');
  assert.equal(w.count('keydown'), 0);
  assert.equal(w.count('wheel'), 0);
  w.maxY = 5000; w.resize();
  assert.equal(w.scrollY, 300, 'no jump after the user took over');
});

test('replacing the query keeps the same history entry and its place', () => {
  const w = browser();
  const r = load(w);
  w.maxY = 5000; w.scrollY = 700;
  r.navigate('/search?q=x', { replace: true });
  r.settleScroll();
  assert.equal(w.scrollY, 0); // a replace is a new view of the page, like before
  assert.equal(w.history.length, 1);
});
