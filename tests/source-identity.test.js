import test from 'node:test';
import assert from 'node:assert/strict';
import { expectedIdentity, sourceIssue, durationIssue, runtimeSeconds, episodeMatches, selectVideoFile, sourceFileKey } from '../js/lib/source-identity.js';
import { normalizeStream } from '../js/core/addons.js';
import { parseStream } from '../js/core/sources.js';
import { evaluate, source, component, flush } from './helpers/source.js';
import { hooks, nodes } from './helpers/hooks.js';

const movie = { id: 'tt33764258', name: 'The Odyssey', type: 'movie', year: 2026, runtime: '173 min' };
const target = expectedIdentity(movie);
const hash = 'a'.repeat(40);
const copy = (overrides = {}) => ({ infoHash: hash, filename: 'The.Odyssey.2026.1080p.mp4', ...overrides });

test('same title and year cannot hide the measured 86-minute film behind the 173-minute catalog entry', () => {
  for (const filename of ['The.Odyssey.2026.1080p.WEBRip.x264.YTS.mp4', 'The Odyssey (2026) (1080p AMZN WEB-DL x265 Celdra).mkv', 'The.Odyssey.2026.1080p.LAMA.mp4', 'The Odyssey 2026 1080p AMZN WEB-DL H264-Kitsune.mkv']) {
    assert.match(sourceIssue(copy({ filename }), target, 5163.456), /86 min.*173 min/);
    assert.equal(sourceIssue(copy({ filename }), target, 10356), null);
  }
});

test('duration evidence survives addon normalization and parsing, with provider provenance', () => {
  const stream = parseStream(normalizeStream({ infoHash: hash, imdbId: 'tt41605854', behaviorHints: { filename: copy().filename, duration: 5163 } }, 'Meteor'));
  assert.deepEqual(stream.durations, [5163]);
  assert.ok(stream.providers.includes('Meteor'));
  assert.deepEqual(stream.contentIds, ['tt41605854']);
  assert.match(sourceIssue(stream, target), /different title/);
  for (const duration of [null, '5163', 0, -1, Infinity, NaN]) {
    assert.deepEqual(parseStream(normalizeStream({ infoHash: hash, behaviorHints: { duration } }, 'Addon')).durations, []);
  }
});

test('rounded runtimes, PAL speed-up and explicit extended editions are accepted', () => {
  assert.equal(runtimeSeconds('2h 53m'), 10380);
  assert.equal(runtimeSeconds('173 min'), 10380);
  assert.equal(runtimeSeconds('unknown'), 0);
  assert.equal(durationIssue(10380, 10356), null);
  assert.equal(durationIssue(10380, 9965), null);
  const lotr = expectedIdentity({ id: 'tt0120737', name: 'The Fellowship of the Ring', type: 'movie', runtime: 178 });
  assert.equal(sourceIssue({ filename: 'Fellowship.2001.Extended.1080p.mp4' }, lotr, 228 * 60), null);
  assert.match(sourceIssue(copy({ filename: 'The.Odyssey.2026.Extended.mp4' }), target, 5163), /86 min/);
});

test('previews, old adaptations and contradictory IDs are rejected; numeric titles and localized aliases survive', () => {
  assert.match(sourceIssue(copy({ filename: 'The.Odyssey.Prologue.2025.mov' }), target), /preview/);
  assert.match(sourceIssue(copy({ filename: 'The.Odyssey.1997.mp4' }), target), /1997/);
  assert.match(sourceIssue(copy({ filename: 'The.Odyssey.2026.{imdb-tt41605854}.mp4' }), target), /different title/);
  assert.equal(sourceIssue(copy({ filename: 'La.Odisea.2026.1080p.mp4' }), target, 10356), null);
  const blade = expectedIdentity({ type: 'movie', name: 'Blade Runner 2049', year: 2017 });
  assert.equal(sourceIssue({ filename: 'Blade.Runner.2049.1080p.mp4' }, blade), null);
  assert.equal(sourceIssue({ filename: 'Blade.Runner.2049.2017.1080p.mp4' }, blade), null);
  assert.equal(sourceIssue({ filename: 'Trailer.Park.Boys.2006.mp4' }, expectedIdentity({ name: 'Trailer Park Boys', type: 'movie', year: 2006 })), null);
  assert.equal(sourceIssue({ filename: copy().filename, release: 'Movie.Collection.1950-2020' }, target), null);
});

test('episode runtimes are per episode, never the series average', () => {
  const show = { id: 'tt1', name: 'Show', type: 'series', runtime: '45 min' };
  const episode = { id: 'tt1:1:2', season: 1, episode: 2 };
  assert.equal(expectedIdentity(show, episode).duration, 0);
  assert.equal(sourceIssue({ filename: 'Show.S01E02.mp4' }, expectedIdentity(show, episode), 5100), null);
  assert.match(sourceIssue({ filename: 'Show.S01E02.mp4' }, expectedIdentity(show, { ...episode, runtime: 45 }), 5100), /85 min/);
  assert.match(sourceIssue({ filename: 'Show.S11E02.mp4' }, expectedIdentity(show, episode)), /different episode/);
  assert.equal(episodeMatches('[SubsPlease] Frieren - 05 (1080p).mkv', 1, 5, true), true);
  assert.equal(episodeMatches('Show.S01E20.mp4', 1, 2), false);
  assert.equal(episodeMatches('Show.S01E01E02.mp4', 1, 2), false, 'no offset mapping for the second part of a combined file');
});

test('missing movie/episode files never fall back to a different video or to a non-video', () => {
  const files = [{ id: 2, path: 'Show.S01E03.mp4', bytes: 9e9 }, { id: 4, path: 'Show.S01E04.mp4', bytes: 2e9 }];
  assert.equal(selectVideoFile(files, { season: 1, episode: 2, fileIdx: 2 }), null);
  assert.equal(selectVideoFile(files, { filename: 'Show.S01E03.mp4', season: 1, episode: 2 }), null);
  assert.equal(selectVideoFile(files, {}), null);
  assert.equal(selectVideoFile(files, { season: 1, episode: 4 }).id, 4);
  assert.equal(selectVideoFile([{ id: 0, path: 'Other.Movie.mp4' }], { filename: 'Expected.Movie.mp4' }), null);
  assert.equal(selectVideoFile([{ id: 0, path: 'README.txt' }, { id: 1, path: 'sample.mp4' }]), null);
  const kitsune = [{ id: 0, path: 'film.nfo' }, { id: 2, path: 'Folder/The.Odyssey.2026.mkv' }];
  assert.equal(selectVideoFile(kitsune, { fileIdx: 0, filename: 'The.Odyssey.2026.mkv' }).id, 2, 'resolve by path despite differing addon/TorBox indices');
  assert.ok(selectVideoFile([{ id: 1, path: 'Trailer.Park.Boys.2006.mp4' }], { identity: { name: 'Trailer Park Boys' } }));
});

function validationFixture() {
  const cache = new Map(), saved = {};
  const api = evaluate(source('js/lib/source-validation.js'), {
    ls: { get: (key, fallback) => cache.get(key) || fallback, set: (key, value) => cache.set(key, value) },
    progress: { get: () => saved, update: fn => fn(saved) },
  }, '({ watchIdentity, rejectSource, rejectedSource, assessSources, invalidateRememberedSource })');
  return { ...api, saved, cache };
}
class Media extends EventTarget {
  duration = NaN; readyState = 0; paused = false;
  pause() { this.paused = true; this.dispatchEvent(new Event('pause')); }
  metadata(seconds) { this.duration = seconds; this.readyState = 1; this.dispatchEvent(new Event('loadedmetadata')); }
}

test('actual playback rejects lying/missing hints before pause listeners can save or scrobble, once only', () => {
  const f = validationFixture(), media = new Media(), failures = []; let saves = 0;
  const gate = f.watchIdentity(media, { meta: movie, source: copy(), onMismatch: reason => failures.push(reason) });
  media.addEventListener('pause', () => { if (gate.allowed()) saves++; });
  assert.equal(gate.allowed(), false, 'wait for the existing metadata event, with no separate probe');
  media.metadata(5163.456);
  media.dispatchEvent(new Event('durationchange'));
  assert.equal(failures.length, 1); assert.equal(saves, 0); assert.equal(gate.allowed(), false);
  assert.equal(media.paused, true);
  gate.stop();
  assert.equal(gate.allowed(), false, 'unmount cleanup cannot save rejected playback');
  assert.match(f.rejectedSource(target, copy()), /86 min/);
});

test('healthy metadata check is constant-time after the first duration and does not prevent cleanup saves', () => {
  const f = validationFixture(), media = new Media(); let checks = 0;
  Object.defineProperty(media, 'duration', { get: () => { checks++; return 10356; } });
  const gate = f.watchIdentity(media, { meta: movie, source: copy(), onMismatch: () => assert.fail('matching film rejected') });
  media.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(gate.allowed(), true);
  for (let i = 0; i < 500; i++) { media.dispatchEvent(new Event('timeupdate')); assert.equal(gate.allowed(), true); }
  assert.equal(checks, 1, 'no identity work on timeupdate');
  gate.stop(); assert.equal(gate.allowed(), true);
});

test('rejections are scoped to title, episode, file and runtime; changing the catalog runtime rechecks a source', () => {
  const f = validationFixture();
  f.rejectSource(target, copy(), 'wrong film');
  assert.equal(f.rejectedSource(target, copy()), 'wrong film');
  assert.equal(f.rejectedSource({ ...target, id: 'tt41605854' }, copy()), null);
  assert.equal(f.rejectedSource({ ...target, videoId: 'tt1:1:3' }, copy()), null);
  assert.equal(f.rejectedSource(target, copy({ filename: 'Other.File.mp4' })), null);
  assert.equal(f.rejectedSource({ ...target, duration: 5163 }, copy()), null);
  assert.notEqual(sourceFileKey(copy()), sourceFileKey(copy({ filename: 'Other.File.mp4' })));
});

test('invalidating Resume preserves history and unrelated episodes, and clears only the matching binding', () => {
  const f = validationFixture();
  f.saved[movie.id] = { source: copy(), eps: { _: { t: 500, dur: 5163 }, other: { t: 100, dur: 1000 } }, last: null };
  f.invalidateRememberedSource(target, copy({ infoHash: 'different' }));
  assert.ok(f.saved[movie.id].source);
  f.invalidateRememberedSource(target, copy({ filename: 'Different.File.In.Same.Pack.mp4' }));
  assert.ok(f.saved[movie.id].source, 'a different file in the same torrent must not invalidate good progress');
  f.invalidateRememberedSource(target, copy());
  assert.equal(f.saved[movie.id].source, null);
  assert.equal(f.saved[movie.id].eps._.sourceMismatch, true);
  assert.equal(f.saved[movie.id].eps.other.t, 100);
});

function sessionFixture(initial, query = {}) {
  const host = hooks(), resolved = [], calls = [];
  const Player = () => {}, Loading = () => {}, SourcePicker = () => {};
  const Session = evaluate(component('js/pages/watch.js', 'Session'), {
    ...host.scope, MAX_AUTO: 4, AbortController, Player, AppPlayer: Player, Loading, SourcePicker,
    settings: { get: () => ({}) }, progress: { get: () => ({}) },
    getMeta: async () => movie, resumeAt: () => 0, rejectedSource: () => null, rejectSource() {}, invalidateRememberedSource() {},
    streams: async (_, __, options) => { calls.push(options); return initial; }, torrents: async () => [], rankStreams: rows => rows,
    isNative: () => false, isPhone: () => false, webPrefs: () => ({}), webStreamingRefused: () => false,
    backdropOf: () => '', backTo: () => () => {}, netFail: () => false,
    resolveStream: async args => { resolved.push(args); return { filename: args.filename, direct: 'mock-' + args.infoHash }; },
  }, 'Session');
  host.mount(Session, { params: { type: 'movie', id: movie.id }, query: { t: '0', ...query } });
  return { host, Player, Loading, SourcePicker, resolved, calls };
}

test('automatic selection skips all known mismatches without resolving them or consuming its retry budget', async () => {
  const bad = Array.from({ length: 10 }, (_, i) => copy({ infoHash: String(i), durations: [5163] }));
  const good = copy({ infoHash: 'correct', durations: [10356] });
  const f = sessionFixture([...bad, good]);
  const tree = await f.host.settle();
  assert.deepEqual(f.resolved.map(s => s.infoHash), ['correct']);
  assert.equal(f.resolved[0].identity.id, movie.id);
  assert.ok(nodes(tree, n => n.type === f.Player).length);
  f.host.unmount();
});

test('a pinned Resume URL cannot bypass source validation', async () => {
  const f = sessionFixture([copy({ durations: [5163] }), copy({ infoHash: 'correct', durations: [10356] })], { hash, fn: copy().filename });
  await f.host.settle();
  assert.deepEqual(f.resolved.map(s => s.infoHash), ['correct']);
  f.host.unmount();
});

test('late matching sources rescue an exhausted wrong-film list, without restarting healthy playback', async () => {
  const bad = copy({ durations: [5163], cached: true });
  const good = copy({ infoHash: 'correct', durations: [10356], cached: true });
  const f = sessionFixture([bad]);
  let tree = await f.host.settle();
  assert.equal(nodes(tree, n => n.type === f.Loading)[0].props.err.code, 'content_mismatch');
  f.calls[0].onPartial([bad, good]); tree = await f.host.settle();
  assert.deepEqual(f.resolved.map(s => s.infoHash), ['correct']);
  f.calls[0].onPartial([bad, good, copy({ infoHash: 'later', durations: [10356] })]); await f.host.settle();
  assert.deepEqual(f.resolved.map(s => s.infoHash), ['correct']);
  f.host.unmount(); await flush();
});

test('classic native rejects metadata before progress and ignores the subsequent closed callback', async () => {
  for (const event of ['metadata', 'progress']) {
    const host = hooks(), listeners = {}, failures = [], saves = [], playback = [];
    let closes = 0;
    const plugin = {
      addListener: async (name, fn) => { listeners[name] = fn; return { remove() { delete listeners[name]; } }; },
      play: async () => {},
      close: async () => { closes++; listeners.closed?.({ duration: 5163, position: 300 }); },
    };
    const NativePlayer = evaluate(component('js/player/native.js', 'NativePlayer'), {
      ...host.scope, AbortController, CustomEvent: class { constructor(type, data) { this.detail = data.detail; } },
      plugin: () => plugin, settings: {}, useStore: () => ({}), Reel() {},
      nextVideo: () => null, rejectSource() {},
      window: { dispatchEvent: e => playback.push(e.detail) },
      saveProgress: (...args) => saves.push(args),
    }, 'NativePlayer');
    host.mount(NativePlayer, { meta: movie, stream: { direct: 'mock', filename: copy().filename }, source: copy(), onFatal: e => failures.push(e) });
    await host.settle();
    listeners[event]({ duration: 5163.456, position: 300, paused: false });
    listeners.progress?.({ duration: 5163.456, position: 305, paused: false });
    await flush(); host.unmount();
    assert.equal(failures.length, 1, event); assert.equal(failures[0].code, 'content_mismatch');
    assert.equal(closes, 1); assert.equal(saves.length, 0); assert.equal(playback.length, 0);
  }
});

test('native user close or decode error before duration arrives still returns to the app', async () => {
  for (const error of [null, 'Cannot decode']) {
    const host = hooks(), listeners = {}, failures = []; let backs = 0;
    const plugin = { addListener: async (name, fn) => { listeners[name] = fn; return { remove() {} }; }, play: async () => {}, close: async () => {} };
    const NativePlayer = evaluate(component('js/player/native.js', 'NativePlayer'), {
      ...host.scope, AbortController, plugin: () => plugin, settings: {}, useStore: () => ({}), Reel() {},
      nextVideo: () => null, window: {}, saveProgress() { assert.fail('unvalidated progress saved'); },
    }, 'NativePlayer');
    host.mount(NativePlayer, { meta: movie, stream: { direct: 'mock' }, source: copy(), onFatal: e => failures.push(e), onBack: () => backs++ });
    await host.settle(); listeners.closed({ duration: 0, position: 0, error });
    assert.equal(error ? failures.length : backs, 1);
    host.unmount();
  }
});

test('a content mismatch in the native app never retries the same file on the VLC codec fallback', async () => {
  const host = hooks(), failures = [], Player = () => {};
  const AppPlayer = evaluate(component('js/player/native.js', 'AppPlayer'), {
    ...host.scope, Player, NativePlayer() {}, useStore: () => ({}), settings: {}, Reel() {},
    vlcEngineAvailable: async () => true,
  }, 'AppPlayer');
  host.mount(AppPlayer, { stream: { direct: 'mock', filename: 'film.mp4' }, onFatal: e => failures.push(e) });
  let tree = await host.settle();
  assert.equal(nodes(tree, x => x.type === Player)[0].props.engine, 'web');
  nodes(tree, x => x.type === Player)[0].props.onFatal({ code: 'content_mismatch' }, 0);
  tree = await host.settle();
  assert.equal(nodes(tree, x => x.type === Player)[0].props.engine, 'web');
  assert.equal(failures.length, 1);
  host.unmount();
});

test('invalid old episode progress cannot resume, disappear into Next, or remain in Continue Watching', () => {
  const episode = { id: 'tt1:1:2', season: 1, episode: 2 }, next = { id: 'tt1:1:3', season: 1, episode: 3 };
  const rows = { tt1: { id: 'tt1', last: episode.id, eps: { [episode.id]: { t: 5000, dur: 5163, done: true, sourceMismatch: true } }, source: null } };
  const progress = { get: () => rows };
  const api = evaluate(source('js/core/progress.js'), { progress, hidden: { get: () => [] }, nextVideo: () => next }, '({ resumeAt, continueWatching })');
  assert.equal(api.resumeAt('tt1', episode.id), 0);
  assert.equal(api.continueWatching().length, 0);
  const play = evaluate(source('js/lib/play.js'), { progress, isReleased: () => true }, 'nextUp');
  assert.equal(play({ id: 'tt1', videos: [episode, next] }).id, episode.id);
});
