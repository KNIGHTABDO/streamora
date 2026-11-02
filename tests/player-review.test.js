import test from 'node:test';
import assert from 'node:assert/strict';
import { source, evaluate, deferred, flush } from './helpers/source.js';
import { createSubtitleLoader } from '../js/player/subtitle-choice.js';
import { hooks, nodes } from './helpers/hooks.js';

const text = node => node == null || typeof node === 'boolean' ? '' : Array.isArray(node) ? node.map(text).join('') : typeof node === 'object' ? text(node.props?.children) : String(node);
function fixture(hls = null, options = {}) {
  const host = hooks(), a = deferred(), b = deferred(), prefs = { quality: 'auto', subsLang: options.subsLang || 'off' }, downloads = [];
  const items = [{ id: 'a', url: 'a', label: 'English', lang: 'eng', release: 'A' }, { id: 'b', url: 'b', label: 'English', lang: 'eng', release: 'B' }];
  const engine = evaluate(source('js/player/engine.js'), { navigator: { userAgent: 'Chrome', platform: '' } }, '({ QUALITIES, autoQuality })');
  const Player = evaluate(source('js/player/player.js'), {
    ...host.scope, ...engine, createSubtitleLoader, window: {}, Icon: () => {}, Reel: () => {}, Img: () => {},
    registerIcons() {}, hash: () => 1, roughRect: () => '', isPhone: () => false, isIOS: false, isSafari: false,
    settings: { update: fn => Object.assign(prefs, fn(prefs)) }, useStore: () => prefs,
    showPrefs: () => ({}), epState: () => null, nextVideo: () => null, isReleased: () => true,
    cx: (...x) => x.filter(Boolean).join(' '), fmtTime: String, langName: () => 'English', toast() {},
    subTaste: { get: () => ({}), set() {} }, learn: t => t, pickBest: async (list, lang) => list.filter(x => x.lang === lang).slice(0, 1).map(sub => ({ sub, cues: null, shift: 0 })),
    openSubs: async () => options.list || items, loadSubFile: url => { downloads.push(url); return ({ a, b })[url].promise; },
  }, 'Player');
  host.mount(Player, { meta: { id: 'test', type: 'movie', name: 'Test' }, stream: { filename: 'test.mkv', remux: true, direct: 'mock-file', hls }, info: null });
  const button = (tree, label) => nodes(tree, n => n.props?.['aria-label'] === label)[0];
  const item = (tree, label) => nodes(tree, n => n.type?.name === 'Item' && text(n) === label)[0];
  return {
    host, a, b, item, items, downloads,
    async subtitles() {
      // Only commit the subtitle effects; media and DOM lifecycles are tested in the browser harness.
      host.commit(fn => /openSubs|subtitleLoader\.dispose/.test(String(fn)));
      await flush(); let tree = host.render(); button(tree, 'Subtitles').props.onClick(); return host.render();
    },
    settings() { const tree = host.render(); button(tree, 'Settings').props.onClick(); return host.render(); },
  };
}
test('Player ignores an old subtitle completion after a newer choice', async () => {
  const f = fixture(), tree = await f.subtitles();
  const a = f.item(tree, 'A').props.onClick(), b = f.item(tree, 'B').props.onClick();
  f.b.resolve([{ start: 0, end: 1, text: 'B' }]); await b; await flush();
  f.a.resolve([{ start: 0, end: 1, text: 'A' }]); await a; await flush();
  assert.equal(f.item(f.host.render(), 'B').props.on, true);
  assert.equal(f.item(f.host.render(), 'A').props.on, false);
});
test('Player Off and unmount invalidate pending subtitle downloads', async () => {
  for (const action of ['off', 'unmount']) {
    const f = fixture(), tree = await f.subtitles();
    const a = f.item(tree, 'A').props.onClick();
    if (action === 'off') f.item(tree, 'Off').props.onClick(); else f.host.unmount();
    const before = f.host.updates;
    f.a.resolve([{ start: 0, end: 1, text: 'A' }]); await a; await flush();
    assert.equal(f.host.updates, before, action);
  }
});
test('Player omits empty quality sections while keeping real HLS choices', () => {
  for (const hls of [null, { original: 'mock-hls' }]) {
    const tree = fixture(hls).settings();
    const headings = nodes(tree, n => n.props?.class === 'pl-menu-kicker kicker type' && text(n) === 'quality');
    assert.equal(headings.length, hls ? 1 : 0);
  }
});

test('a late subtitle list cannot undo Off or schedule work after unmount', async () => {
  for (const action of ['off', 'unmount']) {
    const list = deferred(), f = fixture(null, { list: list.promise, subsLang: 'eng' });
    const tree = await f.subtitles();
    if (action === 'off') f.item(tree, 'Off').props.onClick(); else f.host.unmount();
    const before = f.host.updates;
    list.resolve(f.items); await flush();
    assert.equal(f.downloads.length, 0, action);
    if (action === 'unmount') assert.equal(f.host.updates, before);
  }
});
