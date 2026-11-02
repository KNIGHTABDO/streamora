// SubDL/SubSource relay helpers (functions/api/subs) and the subtitle ranking (js/player/subpick.js).
import test from 'node:test';
import assert from 'node:assert';
import { deflateRawSync } from 'node:zlib';
import { pickEntry, otherEpisode, zipEntries, zipRead, mergeProviders } from '../functions/api/subs/[[path]].js';
import { alignment, rank, learn, prior } from '../js/player/subpick.js';

// minimal zip writer: [name, text, deflate?]
function zip(files) {
  const parts = [], central = [];
  let off = 0;
  for (const [name, text, deflate] of files) {
    const raw = Buffer.from(text), data = deflate ? deflateRawSync(raw) : raw, n = Buffer.from(name);
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(data.length, 18); local.writeUInt32LE(raw.length, 22); local.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(deflate ? 8 : 0, 10);
    c.writeUInt32LE(data.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(off, 42);
    parts.push(local, n, data); central.push(c, n); off += 30 + n.length + data.length;
  }
  const cd = Buffer.concat(central), end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, end]);
}

test('season pack zip: the episode file is found and inflated', async () => {
  const z = zip([['Show.S01E01.WEB-GRP.srt', '1\n00:00:01,000 --> 00:00:02,000\none\n', true], ['Show.S01E02.WEB-GRP.srt', '1\n00:00:01,000 --> 00:00:02,000\ntwo\n', true], ['readme.txt', 'x', false]]);
  const entries = zipEntries(z);
  assert.equal(entries.length, 3);
  const e = pickEntry(entries, '1', '2');
  assert.equal(e.name, 'Show.S01E02.WEB-GRP.srt');
  assert.match(new TextDecoder().decode(await zipRead(z, e)), /two/);
  assert.equal(pickEntry(entries, '1', '5'), null);
  assert.equal(pickEntry(entries, null, null).name.endsWith('.srt'), true);
});

test('episode helpers', () => {
  assert.equal(otherEpisode('Show.S01E03.1080p', 1, 2), true);
  assert.equal(otherEpisode('Show.S01E02.1080p', 1, 2), false);
  assert.equal(otherEpisode('Show.S01.WEB-GRP', 1, 2), false);
  assert.equal(pickEntry([{ name: 'Show - 02.srt', size: 1 }, { name: 'Show - 03.srt', size: 1 }], '1', '2').name, 'Show - 02.srt');
});

test('one entry per subtitle id across SubDL and SubSource, SubDL download kept', () => {
  const a = [{ id: 'sx:1', src: 'subdl', source: 'SubDL', releases: ['A'], downloads: 0, author: '' }];
  const b = [{ id: 'sx:1', src: 'subsource', source: 'SubSource', releases: ['A', 'B'], downloads: 40, author: 'z' }, { id: 'sx:2', src: 'subsource', releases: [] }];
  const m = mergeProviders(a, b);
  assert.equal(m.length, 2);
  assert.deepEqual([m[0].src, m[0].releases, m[0].downloads, m[0].author], ['subdl', ['A', 'B'], 40, 'z']);
});

test('ranking prefers the subtitle timed like the release, and learns', () => {
  const ref = Array.from({ length: 200 }, (_, i) => ({ start: i * 6 + (i % 7) * 0.4, end: i * 6 + 2, text: 'r' }));
  const off = ref.map(c => ({ ...c, start: c.start + 2, end: c.end + 2 }));
  assert.ok(Math.abs(alignment(off, ref).shift + 2) < 0.05);
  const S = (id, o) => ({ id, lang: 'ara', source: 'SubDL', release: 'X-' + id, ...o });
  const r = rank([{ sub: S('a'), cues: off }, { sub: S('b'), cues: ref }], { refs: [{ sub: S('ref', { lang: 'eng', match: true }), cues: ref }] });
  assert.equal(r[0].sub.id, 'b');
  const t = learn(learn({}, S('a', { author: 'k' }), 'good'), S('a', { author: 'k' }), 'good');
  assert.ok(prior(t, S('z', { author: 'K' })) > 0);
});
