import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../js/core/parse.js';

const cases = [
  ['Reacher.S04E05.Bridge.1080p.HEVC.x265-MeGusta[EZTVx.to].mkv', { title: 'Reacher', season: 4, episode: 5, quality: '1080p', type: 'series' }],
  ['Prisoners.2013.1080p.BluRay.DDP5.1.x265.10bit-GalaxyRG265.mkv', { title: 'Prisoners', year: 2013, type: 'movie' }],
  ['Blade.Runner.2049.2017.1080p.BluRay.x264-SPARKS.mkv', { title: 'Blade Runner 2049', year: 2017, type: 'movie' }],
  ['Spider-Man - 2002 1080p.mkv', { title: 'Spider-Man', year: 2002, type: 'movie', episode: null }],
  ['[SubsPlease] Frieren - 05 (1080p) [ABCD1234].mkv', { title: 'Frieren', episode: 5, anime: true }],
  ['2012.2009.720p.mkv', { title: '2012', year: 2009 }],
];
for (const [name, want] of cases) test(name, () => {
  const got = parse(name);
  for (const [k, v] of Object.entries(want)) assert.equal(got[k], v, k);
});
