// Picks the best subtitle of a language: loads every candidate, measures how well each one's timing lines up with a
// reference (a subtitle made for the exact release being played, else what the candidates agree on), and adds what this
// viewer taught us (sources, uploaders and release groups they kept or dropped). Pure: the player passes the loader and
// the taste object, and stores what learn() returns.

const STEP = 0.1, WINDOW = 12, HIT = 0.3;

const startsOf = cues => cues.map(c => c.start).filter(Number.isFinite).sort((a, b) => a - b);
const nearest = (arr, t) => {
  let lo = 0, hi = arr.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < t) lo = m + 1; else hi = m; }
  const a = arr[lo - 1], b = arr[lo];
  return a === undefined ? b : b === undefined ? a : (t - a <= b - t ? a : b);
};
const sample = (arr, n) => (arr.length <= n ? arr : Array.from({ length: n }, (_, i) => arr[Math.floor((i + 0.5) * arr.length / n)]));

/** How well `cand` lines up with `ref`: shift = seconds to add to cand's times, ratio = share of its lines that then
 *  start within 0.3 s of a reference line (1 = same timing). */
export function alignment(cand, ref) {
  const c = sample(startsOf(cand), 400), r = startsOf(ref);
  if (c.length < 10 || r.length < 10) return { shift: 0, ratio: 0 };
  const hist = new Map();
  for (const t of c) {
    // every reference line near t votes for an offset
    let lo = 0, hi = r.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (r[m] < t - WINDOW) lo = m + 1; else hi = m; }
    for (let i = lo; i < r.length && r[i] <= t + WINDOW; i++) { const k = Math.round((r[i] - t) / STEP); hist.set(k, (hist.get(k) || 0) + 1); }
  }
  let best = 0, bestN = -1;
  for (const k of hist.keys()) { const n = (hist.get(k - 1) || 0) + hist.get(k) + (hist.get(k + 1) || 0); if (n > bestN || (n === bestN && Math.abs(k) < Math.abs(best))) { best = k; bestN = n; } }
  // refine: mean difference of the lines that agree with that offset
  let sum = 0, n = 0;
  for (const t of c) { const d = nearest(r, t + best * STEP) - t; if (Math.abs(d - best * STEP) <= 0.25) { sum += d; n++; } }
  const shift = n ? +(sum / n).toFixed(2) : 0;
  const hits = c.filter(t => Math.abs(nearest(r, t + shift) - (t + shift)) <= HIT).length;
  return { shift: Math.abs(shift) < 0.15 ? 0 : shift, ratio: hits / c.length };
}

// ------------------------------------------------------------------ what this viewer taught us
const group = rel => { const m = /-([a-z0-9]{2,15})(?:\.[a-z0-9]{2,4})?$/i.exec(String(rel || '').trim()); return m ? m[1].toLowerCase() : ''; };
export const features = sub => [
  sub.source && `src:${sub.source.toLowerCase()}`,
  sub.author && `by:${String(sub.author).toLowerCase()}`,
  group(sub.release) && `grp:${group(sub.release)}`,
].filter(Boolean);
const WEIGHT = { src: 0.5, by: 1, grp: 0.6 };

/** Learned preference for this subtitle, about -1.5 … +1.5 (0 = nothing known). */
export function prior(taste, sub) {
  const f = (taste && taste.f) || {};
  return features(sub).reduce((sum, k) => {
    const x = f[k];
    return x ? sum + WEIGHT[k.split(':')[0]] * ((x[0] + 1) / (x[0] + x[1] + 2) - 0.5) * 2 * Math.min(1, (x[0] + x[1]) / 3) : sum;
  }, 0);
}

/** New taste after a signal: 'good' (watched a long while with it), 'bad' (switched away or fixed its timing).
 *  `delay` remembers a timing fix for this exact subtitle. Old counts fade so recent habits win. */
export function learn(taste, sub, kind, delay) {
  const t = { f: { ...((taste && taste.f) || {}) }, d: { ...((taste && taste.d) || {}) } };
  if (kind === 'good' || kind === 'bad') for (const k of features(sub)) {
    let [g, b] = t.f[k] || [0, 0];
    if (kind === 'good') g++; else b++;
    if (g + b > 40) { g /= 2; b /= 2; }
    t.f[k] = [+g.toFixed(2), +b.toFixed(2)];
  }
  if (delay !== undefined && sub.id) {
    if (delay) t.d[sub.id] = delay; else delete t.d[sub.id];
    const ids = Object.keys(t.d);
    if (ids.length > 150) for (const id of ids.slice(0, ids.length - 150)) delete t.d[id];
  }
  const keys = Object.keys(t.f);
  if (keys.length > 300) for (const k of keys.slice(0, keys.length - 300)) delete t.f[k];
  return t;
}

// ------------------------------------------------------------------ ranking
/** Scores loaded candidates [{sub, cues}] of one language. refs: [{sub, cues}] made for the playing release.
 *  -> [{ sub, cues, shift, ratio, score }] best first. */
export function rank(cands, { refs = [], taste, duration = 0 } = {}) {
  const out = cands.map(x => {
    let ratio = 0, shift = 0, synced = false;
    for (const r of refs) {
      if (r.sub.id === x.sub.id) { ratio = 1; shift = 0; synced = true; break; }
      const a = alignment(x.cues, r.cues);
      if (a.ratio > ratio) ({ ratio, shift } = a), synced = true;
    }
    if (ratio < 0.5) shift = 0;   // too little agreement to trust the offset
    if (!synced && cands.length > 2) {
      // no reference: the timing most candidates share is most likely the common web release's
      const agree = cands.filter(y => y !== x).map(y => alignment(x.cues, y.cues)).sort((a, b) => b.ratio - a.ratio);
      ratio = (agree[0].ratio + (agree[1] ? agree[1].ratio : 0)) / 2 * 0.6;
    }
    const learned = taste && taste.d && taste.d[x.sub.id];
    if (learned !== undefined && !(synced && ratio > 0.6)) shift = learned;
    const last = x.cues.length ? x.cues[x.cues.length - 1].end : 0;
    const tooLong = duration > 0 && last > duration + 90;
    const score = (x.sub.match ? 1.5 : 0) + ratio * 3 + prior(taste, x.sub)
      + Math.log10((x.sub.downloads || 0) + 1) * 0.15 + Math.max(-1, Math.min(1, (x.sub.rating || 0) / 10)) * 0.2
      - (x.sub.hi ? 0.15 : 0) - (shift ? 0.2 : 0) - (tooLong ? 2 : 0) - (x.cues.length < 30 ? 1 : 0);
    return { ...x, shift, ratio, score };
  });
  return out.sort((a, b) => b.score - a.score);
}

/** Loads up to `max` candidates of `lang` (+ reference subtitles of the playing release) and ranks them.
 *  load(sub) -> cues. Returns the ranked list (may be empty). */
export async function pickBest(list, lang, { load, taste, duration, max = 12, timeout = 12000 } = {}) {
  const cands = list.filter(x => x.lang === lang)
    .sort((a, b) => (b.match - a.match) || prior(taste, b) - prior(taste, a) || (b.downloads || 0) - (a.downloads || 0)).slice(0, max);
  if (!cands.length) return [];
  const refSubs = list.filter(x => x.match && x.lang !== lang).slice(0, 2);
  const get = sub => Promise.race([load(sub), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), timeout))])
    .then(cues => (cues && cues.length ? { sub, cues } : null), () => null);
  const [c, r] = await Promise.all([Promise.all(cands.map(get)), Promise.all(refSubs.map(get))]);
  const loaded = c.filter(Boolean);
  const refs = [...r.filter(Boolean), ...loaded.filter(x => x.sub.match)];
  return rank(loaded, { refs, taste, duration });
}

// Self-check: node js/player/subpick.js
if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('subpick.js')) {
  const assert = (await import('node:assert')).default;
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const ref = Array.from({ length: 300 }, (_, i) => { const s = i * 7 + rnd() * 3; return { start: s, end: s + 2, text: 'x' }; });
  const late = ref.map(c => ({ ...c, start: c.start + 1.3, end: c.end + 1.3 }));
  const a = alignment(late, ref);
  assert.ok(Math.abs(a.shift + 1.3) < 0.05 && a.ratio > 0.95, JSON.stringify(a));
  assert.deepEqual(alignment(ref, ref), { shift: 0, ratio: 1 });
  const other = Array.from({ length: 300 }, () => { const s = rnd() * 2100; return { start: s, end: s + 2, text: 'y' }; }).sort((x, y) => x.start - y.start);
  assert.ok(alignment(other, ref).ratio < 0.35);
  const S = (id, o = {}) => ({ id, lang: 'ara', source: 'SubDL', author: 'a' + id, release: 'Show.S01.WEB-GRP' + id, ...o });
  const ranked = rank([{ sub: S('1'), cues: other }, { sub: S('2'), cues: late }], { refs: [{ sub: S('r', { lang: 'eng', match: true }), cues: ref }] });
  assert.equal(ranked[0].sub.id, '2'); assert.ok(Math.abs(ranked[0].shift + 1.3) < 0.05);
  let t = learn({}, S('9', { author: 'Bob' }), 'bad'); t = learn(t, S('9', { author: 'Bob' }), 'bad'); t = learn(t, S('9', { author: 'Bob' }), 'bad', 0.75);
  assert.ok(prior(t, S('9', { author: 'bob' })) < -0.5); assert.equal(t.d['9'], 0.75);
  const same = rank([{ sub: S('3'), cues: ref }, { sub: S('4', { author: 'Bob', release: 'x-grp9' }), cues: ref }], { taste: t });
  assert.equal(same[0].sub.id, '3');
  console.log('subpick.js ok');
}
