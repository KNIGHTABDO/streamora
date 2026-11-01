import test from 'node:test';
import assert from 'node:assert/strict';
import { planAudio, canRemuxMkv, hevcInMse } from '../js/player/mkv-plan.js';

test('MKV audio chooses a playable track before language, and never silently drops unsupported audio', () => {
  const aac = { id: 1, codec: 'aac', languageCode: 'eng', canDecode: true, mseOk: true };
  const eac3 = { id: 2, codec: 'eac3', languageCode: 'ara', canDecode: true, mseOk: false };
  const dts = { id: 3, codec: 'dts', languageCode: 'eng', canDecode: false, mseOk: false };
  assert.deepEqual(planAudio([aac, eac3], 'eng', 'opus'), { id: 1, mode: 'copy' });
  assert.deepEqual(planAudio([aac, eac3], 'ara', 'opus'), { id: 2, mode: 'transcode', codec: 'opus' });
  assert.deepEqual(planAudio([dts, eac3], 'eng', 'opus'), { id: 2, mode: 'transcode', codec: 'opus' });
  assert.equal(planAudio([dts], 'eng', 'opus'), null);
  assert.equal(planAudio([eac3], 'ara', null), null);
  assert.deepEqual(planAudio([], 'eng', 'opus'), { id: null, mode: 'none' });
  assert.deepEqual(planAudio([aac, eac3], 'fre', 'opus'), { id: 1, mode: 'copy' });
});
test('MKV capabilities are false outside a browser', () => {
  assert.equal(canRemuxMkv(), false);
  assert.equal(hevcInMse(), false);
});

import { rankStreams } from '../js/core/sources.js';
const source = filename => ({ filename, release: filename, cached: true, rank: 3, size: 2e9, seeders: 10 });
const first = (a, b, prefs) => rankStreams([source(a), source(b)], prefs)[0].filename;
test('browser remux prefers AC3 over DTS and TrueHD', () => {
  for (const codec of ['DTS-HD', 'TrueHD']) assert.equal(first(`Movie.1080p.${codec}.mkv`, 'Movie.1080p.x264.AC3.mkv', { remux: true }), 'Movie.1080p.x264.AC3.mkv');
});
test('HEVC penalty follows MSE support', () => {
  assert.equal(first('Movie.1080p.x265.mkv', 'Movie.1080p.x264.mkv', { remux: true, avoidHevc: true }), 'Movie.1080p.x264.mkv');
  const ranked = rankStreams([source('Movie.1080p.x265.mkv'), source('Movie.1080p.x264.mkv')], { remux: true, avoidHevc: false });
  assert.equal(ranked[0].score, ranked[1].score);
});
test('remuxable MKV beats MP4 with browser-unsupported Dolby audio', () => {
  assert.equal(first('Movie.1080p.x264.EAC3.mp4', 'Movie.1080p.x264.AC3.mkv', { remux: true }), 'Movie.1080p.x264.AC3.mkv');
});
test('mp4First still puts MP4 ahead when remux is unavailable', () => {
  assert.equal(first('Movie.1080p.x264.AC3.mkv', 'Movie.1080p.x264.EAC3.mp4', { mp4First: true }), 'Movie.1080p.x264.EAC3.mp4');
  assert.equal(first('Movie.1080p.x264.EAC3.mp4', 'Movie.1080p.x264.AAC.mp4', { mp4First: true }), 'Movie.1080p.x264.AAC.mp4');
});

import { webPrefs } from '../js/core/sources.js';
test('web preferences retain MP4-first only when browser remux is unavailable', () => {
  const previous = ['window', 'document'].map(k => [k, Object.getOwnPropertyDescriptor(globalThis, k)]);
  try {
    globalThis.document = { createElement: () => ({ canPlayType: () => '' }) };
    globalThis.window = {};
    assert.deepEqual(webPrefs(true), { preferMp4: true, mp4First: true, remux: false, avoidHevc: false });
    window.MediaSource = Object.assign(function () {}, { isTypeSupported: () => false });
    assert.deepEqual(webPrefs(true), { preferMp4: true, mp4First: false, remux: true, avoidHevc: true });
    window = { ManagedMediaSource: Object.assign(function () {}, { isTypeSupported: () => true }) };
    assert.equal(canRemuxMkv(), true);
    assert.equal(hevcInMse(), true);
    assert.equal(webPrefs(true).avoidHevc, false);
    window.Capacitor = { isNativePlatform: () => true };
    assert.deepEqual(webPrefs(true), { preferMp4: false, mp4First: false, remux: false, avoidHevc: false });
  } finally {
    for (const [k, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, k, descriptor); else delete globalThis[k];
  }
});
