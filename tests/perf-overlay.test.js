import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { evaluate, source } from './helpers/source.js';

const { gate, playStages, inpSummary } = evaluate(source('js/lib/perf.js'), {}, '({ gate, playStages, inpSummary })');
const plain = value => JSON.parse(JSON.stringify(value));

test('perf gate accepts exact search and hash query flags without persisting them', () => {
  assert.equal(gate({ search: '?perf=1' }), true);
  assert.equal(gate({ hash: '#/watch/movie/tt123?v=ep&perf=1' }), true);
  assert.equal(gate({ search: '?x=1&perf=1&y=2' }), true);
  for (const args of [{}, { search: '?notperf=1' }, { search: '?perf=10' }, { hash: '#/perf=1' }, { stored: 1 }])
    assert.equal(gate(args), false);
});

test('perf gate accepts the stored flag and URL perf=0 overrides every opt-in', () => {
  assert.equal(gate({ stored: '1' }), true);
  assert.equal(gate({ stored: '0' }), false);
  assert.equal(gate({ search: '?perf=0', stored: '1' }), false);
  assert.equal(gate({ hash: '#/?perf=0', stored: '1' }), false);
  assert.equal(gate({ search: '?perf=1', hash: '#/?perf=0', stored: '1' }), false);
  assert.equal(gate({ search: '?perf=0&perf=1' }), false);
});

test('inline boot gate matches the pure gate, clears storage only for perf=0, and defers imports', () => {
  const boot = source('index.html');
  const snippet = boot.slice(boot.indexOf('      var perfFlags ='), boot.indexOf('\n      window.__streamora ='));
  for (const args of [{}, { search: '?perf=1' }, { hash: '#/?perf=1' }, { stored: '1' },
    { stored: '1.0' }, { search: '?perf=0', stored: '1' }, { hash: '#/?perf=0', search: '?perf=1' }]) {
    let removed = false, mounted = false;
    const actual = runInNewContext(snippet + '\nperfOn', {
      location: { search: args.search || '', hash: args.hash || '' },
      localStorage: { getItem: () => args.stored, removeItem: () => { removed = true; } },
      performance: { mark: name => assert.equal(name, 'boot:gate') },
      mounted: { then: () => { mounted = true; } },
    });
    assert.equal(actual, gate(args));
    assert.equal(mounted, actual);
    assert.equal(removed, !!((args.search || '') + (args.hash || '')).includes('perf=0'));
  }
  assert.equal(runInNewContext(snippet + '\nperfOn', {
    location: { search: '', hash: '' },
    localStorage: { getItem() { throw new Error('disabled storage'); } },
    performance: {},
  }), false);
});

test('play stages isolate the latest tap and compute relative times and gaps', () => {
  const marks = [
    { name: 'play:tap', startTime: 10 }, { name: 'play:firstframe', startTime: 500 },
    { name: 'home:hero', startTime: 800 }, { name: 'play:tap', startTime: 1000 },
    { name: 'play:meta', startTime: 1025 }, { name: 'play:checkcached', startTime: 1100 },
    { name: 'play:checkcached', startTime: 1150 }, { name: 'seek:start', startTime: 1160 },
    { name: 'play:firstframe', startTime: 1400 },
  ];
  assert.deepEqual(plain(playStages(marks)), [
    { name: 'play:tap', at: 0, dur: 0 }, { name: 'play:meta', at: 25, dur: 25 },
    { name: 'play:checkcached', at: 100, dur: 75 }, { name: 'play:firstframe', at: 400, dur: 300 },
  ]);
  assert.equal(marks.length, 9);
  assert.deepEqual(plain(playStages([])), []);
  assert.deepEqual(plain(playStages([{ name: 'play:meta', startTime: 1 }])), []);
});

test('INP uses nearest-rank p75 and the five worst durations without mutating input', () => {
  const durations = [80, 40, 200, 120, 64, 56, 300, 160];
  assert.deepEqual(plain(inpSummary(durations)), { p75: 160, worst: [300, 200, 160, 120, 80] });
  assert.deepEqual(durations, [80, 40, 200, 120, 64, 56, 300, 160]);
  assert.deepEqual(plain(inpSummary([])), { p75: 0, worst: [] });
  assert.deepEqual(plain(inpSummary([NaN, -1, Infinity, 42])), { p75: 42, worst: [42] });
});

function overlay(types = ['largest-contentful-paint', 'layout-shift', 'longtask', 'event']) {
  class Element {
    constructor(tag) { this.tag = tag; this.children = []; this.style = {}; this.attrs = {}; }
    append(...nodes) { for (const n of nodes) { n.parent = this; this.children.push(n); } }
    replaceChildren(...nodes) { this.children = []; this.append(...nodes); }
    setAttribute(k, v) { this.attrs[k] = v; }
    remove() { this.parent.children = this.parent.children.filter(n => n !== this); }
    querySelector(selector) { return this.children.find(n => '.' + n.className === selector) || this.children.map(n => n.querySelector(selector)).find(Boolean); }
  }
  const document = { head: new Element('head'), body: new Element('body'), createElement: tag => new Element(tag) };
  const intervals = new Map(), observed = [], copied = [];
  let marks = [], now = 0, redacted = false;
  const window = { __streamora: { perf: false } };
  class PerformanceObserver {
    static supportedEntryTypes = types;
    constructor(callback) { this.callback = callback; observed.push(this); }
    observe(options) { this.options = options; }
    disconnect() { this.off = true; }
    takeRecords() { this.drained = true; return []; }
    send(entries) { this.callback({ getEntries: () => entries }); }
  }
  const api = evaluate(source('js/lib/perf.js'), {
    document, window, PerformanceObserver,
    navigator: { serviceWorker: { controller: {} } },
    performance: {
      getEntriesByType: type => type === 'mark' ? marks : [{ transferSize: 0, deliveryType: 'cache' }],
      clearMarks: () => { marks = []; }, now: () => now,
    },
    setInterval: fn => { intervals.set(1, fn); return 1; }, clearInterval: id => intervals.delete(id),
    redact: value => { redacted = true; return value.replace('secret', '[redacted]'); },
    copyText: async value => { assert.ok(redacted); copied.push(JSON.parse(value)); return true; },
  }, '({ start, stop })');
  return { ...api, document, window, intervals, observed, copied,
    marks: value => { marks = value; }, now: value => { now = value; },
    refresh: () => intervals.get(1)(),
    get card() { return document.body.children[0]; },
    observer: type => observed.find(o => o.options.type === type),
  };
}

test('overlay start/stop are idempotent and observe only advertised types', () => {
  const f = overlay();
  f.start(); f.start();
  assert.equal(f.document.body.children.length, 1);
  assert.equal(f.document.head.children.length, 1);
  assert.equal(f.observed.length, 4);
  assert.equal(f.observer('event').options.durationThreshold, 40);
  assert.equal(f.window.__streamora.perf, true);
  f.stop(); f.stop();
  assert.equal(f.document.body.children.length, 0);
  assert.equal(f.document.head.children.length, 0);
  assert.equal(f.intervals.size, 0);
  assert.ok(f.observed.every(o => o.off));
  const unsupported = overlay([]);
  unsupported.start();
  assert.equal(unsupported.observed.length, 0);
  unsupported.stop();
});

test('overlay collects interactions once, excludes input layout shifts, redacts copies, and resets', async () => {
  const f = overlay();
  f.marks([{ name: 'boot:gate', startTime: 5 }, { name: 'play:tap', startTime: 10 }, { name: 'play:firstframe', startTime: 400 }]);
  f.start();
  const entry = (name, startTime, duration, extra = {}) => ({ name, startTime, duration, ...extra });
  f.observer('largest-contentful-paint').send([entry('', 120, 0)]);
  f.observer('layout-shift').send([entry('', 20, 0, { value: .1, hadRecentInput: false }), entry('', 30, 0, { value: .8, hadRecentInput: true })]);
  f.observer('longtask').send([entry('self', 20, 60)]);
  f.observer('event').send([
    entry('pointerup', 100, 48, { interactionId: 1 }),
    entry('click', 104, 80, { interactionId: 1, target: { tagName: 'BUTTON', id: 'secret', classList: ['play'] } }),
    entry('click', 200, 120, { interactionId: 2 }),
  ]);
  f.refresh();
  const [copy, reset] = f.card.querySelector('.perf-actions').children;
  await copy.onclick();
  const report = f.copied[0];
  assert.equal(report.lcp, 120);
  assert.equal(report.cls, .1);
  assert.equal(report.longtask, 60);
  assert.deepEqual(report.inp.worst, [120, 80]);
  assert.equal(report.inp.targets[1].target, 'button#[redacted].play');
  assert.equal(report.sw.controlled, true);
  assert.equal(report.sw.zeroTransfer, true);
  assert.equal(report.play[1].at, 390);
  f.card.querySelector('.perf-head').children[0].onclick();
  assert.equal(f.card.querySelector('.perf-waterfall').children.length, 2);
  f.now(500); reset.onclick();
  assert.ok(f.observed.every(o => o.drained));
  f.observer('longtask').send([entry('self', 20, 60)]); // queued/buffered records from before reset
  await copy.onclick();
  assert.equal(f.copied[1].longtask, 0);
  assert.equal(f.copied[1].lcp, null);
  assert.equal(f.copied[1].cls, 0);
  assert.deepEqual(f.copied[1].play, []);
  assert.deepEqual(f.copied[1].inp.worst, []);
  f.stop();
});
