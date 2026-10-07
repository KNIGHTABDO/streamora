// Watching stats computed from the per-profile stores (progress, history, diary). Pure functions,
// shared by the Diary stats tab and Year in Review. Self-check: node js/lib/stats.js
//
// progress = { [metaId]: { id, type, name, poster, eps: { [videoId|'_']: { t, dur, done, at, season, episode } } } }
// history  = [{ id, type, name, poster, videoId, season, episode, at }]   (one entry per finished movie/episode)
// diary    = [{ key, id, type, name, poster, rating, note, at }]

const DAY = 864e5;
export const yearOf = ts => new Date(ts).getFullYear();
const inYear = (ts, year) => year == null || yearOf(ts) === year;
export const dayKey = ts => { const d = new Date(ts); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const byCount = m => [...m.entries()].sort((a, b) => b[1] - a[1]);
const bump = (m, k, n = 1) => m.set(k, (m.get(k) || 0) + n);

/** Seconds actually watched (resume position, capped at duration) for entries touched in `year`. */
export function watchSeconds(progress, year) {
  let s = 0;
  for (const e of Object.values(progress || {}))
    for (const ep of Object.values(e.eps || {}))
      if (ep.at && inYear(ep.at, year)) s += Math.min(ep.t || 0, ep.dur || ep.t || 0);
  return s;
}

/** Every watch event (finished items + progress touches) as { id, name, at }. */
export function events(progress, history, year) {
  const out = [];
  for (const h of history || []) if (inYear(h.at, year)) out.push({ id: h.id, name: h.name, at: h.at });
  for (const e of Object.values(progress || {}))
    for (const ep of Object.values(e.eps || {}))
      if (ep.at && inYear(ep.at, year)) out.push({ id: e.id, name: e.name, at: ep.at });
  return out;
}

export function counts(history, year) {
  const h = (history || []).filter(x => inYear(x.at, year));
  return {
    movies: h.filter(x => x.type === 'movie').length,
    episodes: h.filter(x => x.type !== 'movie').length,
    titles: new Set(h.map(x => x.id)).size,
  };
}

/** [{ id, name, poster, type, count }] most finished items first. */
export function topTitles(history, year, n = 5) {
  const m = new Map(), info = {};
  for (const x of history || []) if (inYear(x.at, year)) { bump(m, x.id); info[x.id] = x; }
  return byCount(m).slice(0, n).map(([id, count]) => ({ id, name: info[id].name, poster: info[id].poster, type: info[id].type, count }));
}

/** genreMap: { [metaId]: ['Drama', ...] }  ->  [['Drama', weight], ...] weighted by finished items */
export function topGenres(history, genreMap, year, n = 6) {
  const m = new Map();
  for (const x of history || []) if (inYear(x.at, year)) for (const g of (genreMap || {})[x.id] || []) bump(m, g);
  return byCount(m).slice(0, n);
}

/** Weighted genre taste computed from history and diary.
 * Returns [['Drama', weight], ['Comedy', weight], ...] top n genres. */
export function genreTaste(history = [], diary = [], genreMap = {}, n = 2) {
  let hist = history;
  let dia = diary;
  let gm = genreMap;
  let count = n;
  if (!Array.isArray(history) && history && typeof history === 'object') {
    hist = history.history || [];
    dia = history.diary || [];
    gm = diary && typeof diary === 'object' && !Array.isArray(diary) ? diary : {};
    count = typeof genreMap === 'number' ? genreMap : n;
  }
  const m = new Map();
  for (const x of hist || []) {
    for (const g of (gm || {})[x.id] || []) bump(m, g, 1);
  }
  for (const d of dia || []) {
    const w = d.rating && d.rating > 0 ? d.rating : 1;
    for (const g of (gm || {})[d.id] || []) bump(m, g, w);
  }
  return byCount(m).slice(0, count);
}

/** { longest, current } consecutive days with any watching. */
export function streak(evts, now = Date.now()) {
  const days = [...new Set(evts.map(e => dayKey(e.at)))].sort();
  let longest = 0, run = 0, prev = null;
  for (const d of days) {
    const t = new Date(d + 'T12:00:00').getTime();
    run = prev != null && Math.round((t - prev) / DAY) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run); prev = t;
  }
  const set = new Set(days);
  let current = 0;
  for (let t = now; set.has(dayKey(t)); t -= DAY) current++;
  if (!current && set.has(dayKey(now - DAY))) for (let t = now - DAY; set.has(dayKey(t)); t -= DAY) current++;
  return { longest, current };
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const PARTS = [[12, 'morning'], [17, 'afternoon'], [21, 'evening'], [24, 'night']]; // [ends before hour, name]; 0-5h is 'late night'
/** favourite weekday + part of day */
export function favTime(evts) {
  if (!evts.length) return null;
  const d = new Map(), p = new Map();
  for (const e of evts) {
    const t = new Date(e.at), h = t.getHours();
    bump(d, t.getDay());
    bump(p, h < 5 ? 'late night' : PARTS.find(([end]) => h < end)[1]);
  }
  return { day: DAYS[byCount(d)[0][0]], part: byCount(p)[0][0] };
}

/** Most episodes of one show finished on a single day. */
export function longestBinge(history, year) {
  const m = new Map(), info = {};
  for (const x of history || []) {
    if (x.type === 'movie' || !inYear(x.at, year)) continue;
    const k = x.id + '|' + dayKey(x.at);
    bump(m, k); info[k] = x;
  }
  const top = byCount(m)[0];
  return top ? { id: info[top[0]].id, name: info[top[0]].name, poster: info[top[0]].poster, count: top[1], day: top[0].split('|')[1] } : null;
}

/** Shows whose first finished episode falls in `year`. */
export function newShows(history, year) {
  const first = new Map();
  for (const x of history || []) if (x.type !== 'movie' && (!first.has(x.id) || x.at < first.get(x.id).at)) first.set(x.id, x);
  return [...first.values()].filter(x => inYear(x.at, year));
}

export const topRated = (diary, year) =>
  (diary || []).filter(d => d.rating && inYear(d.at, year)).sort((a, b) => b.rating - a.rating || b.at - a.at)[0] || null;

export function years(progress, history, diary) {
  const ys = new Set([new Date().getFullYear()]);
  for (const e of events(progress, history)) ys.add(yearOf(e.at));
  for (const d of diary || []) ys.add(yearOf(d.at));
  return [...ys].sort((a, b) => b - a);
}

/** Everything at once. */
export function summary({ progress, history, diary }, year, genreMap = {}) {
  const evts = events(progress, history, year);
  const byShow = new Map();
  for (const x of history || []) if (x.type !== 'movie' && inYear(x.at, year)) bump(byShow, x.id);
  const mostShowId = byCount(byShow)[0];
  const mostShow = mostShowId && (history.find(x => x.id === mostShowId[0]));
  return {
    year,
    seconds: watchSeconds(progress, year),
    ...counts(history, year),
    top: topTitles(history, year),
    genres: topGenres(history, genreMap, year),
    streak: streak(evts),
    fav: favTime(evts),
    binge: longestBinge(history, year),
    newShows: newShows(history, year),
    best: topRated(diary, year),
    mostShow: mostShow ? { id: mostShow.id, name: mostShow.name, poster: mostShow.poster, count: mostShowId[1] } : null,
    active: evts.length,
  };
}

/** Genres for the given ids via the metadata catalog (cached by meta.js). */
export async function loadGenres(items, limit = 40) {
  const { meta } = await import('../core/meta.js');
  const seen = new Map();
  for (const x of items) if (!seen.has(x.id)) seen.set(x.id, x.type === 'movie' ? 'movie' : 'series');
  const ids = [...seen].slice(0, limit), out = {};
  for (let i = 0; i < ids.length; i += 6) {
    await Promise.all(ids.slice(i, i + 6).map(([id, type]) => meta(type, id).then(m => { out[id] = (m && m.genres) || []; }, () => {})));
  }
  return out;
}

/** summary() with genres loaded for that year's finished items (shared by Diary stats and Year in Review). */
export async function yearSummary(data, year, genreMap) {
  return summary(data, year, genreMap || await loadGenres((data.history || []).filter(h => inYear(h.at, year))));
}

/** Sample data for demo mode (not saved anywhere). */
export function demoData(year = new Date().getFullYear()) {
  const shows = [
    { id: 'tt0903747', name: 'Breaking Bad', type: 'series' }, { id: 'tt2560140', name: 'Attack on Titan', type: 'series' },
    { id: 'tt11280740', name: 'Severance', type: 'series' }, { id: 'tt0386676', name: 'The Office', type: 'series' },
  ];
  const films = [
    { id: 'tt1392214', name: 'Prisoners', type: 'movie' }, { id: 'tt0816692', name: 'Interstellar', type: 'movie' },
    { id: 'tt0245429', name: 'Spirited Away', type: 'movie' }, { id: 'tt1375666', name: 'Inception', type: 'movie' },
    { id: 'tt6751668', name: 'Parasite', type: 'movie' },
  ];
  const poster = id => `https://images.metahub.space/poster/medium/${id}/img`;
  const history = [], progress = {}, diary = [];
  let seed = 7; const r = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const base = new Date(year, 0, 8, 20).getTime();
  for (let d = 0; d < 300; d += 1 + Math.floor(r() * 4)) {
    const at0 = base + d * DAY + Math.floor(r() * 5) * 3600e3;
    if (r() < .35) {
      const f = films[Math.floor(r() * films.length)];
      history.push({ ...f, poster: poster(f.id), at: at0 });
      progress[f.id] = { ...f, poster: poster(f.id), eps: { _: { t: 7400, dur: 7600, done: true, at: at0 } } };
    } else {
      const s = shows[Math.floor(r() * shows.length)];
      const n = 1 + Math.floor(r() * 5);
      const p = progress[s.id] || (progress[s.id] = { ...s, poster: poster(s.id), eps: {} });
      for (let k = 0; k < n; k++) {
        const ep = Object.keys(p.eps).length + 1, at = at0 + k * 50 * 60e3;
        history.push({ ...s, poster: poster(s.id), videoId: `${s.id}:1:${ep}`, season: 1, episode: ep, at });
        p.eps[`${s.id}:1:${ep}`] = { t: 2800, dur: 2900, done: true, at, season: 1, episode: ep };
      }
    }
  }
  films.forEach((f, i) => diary.push({ key: 'demo' + i, ...f, poster: poster(f.id), rating: [4.5, 5, 4, 3.5, 5][i], note: i === 1 ? 'Cried at the docking scene. Again.' : '', at: base + (i * 40 + 5) * DAY }));
  const genreMap = {
    tt0903747: ['Crime', 'Drama', 'Thriller'], tt2560140: ['Animation', 'Action'], tt11280740: ['Drama', 'Mystery', 'Sci-Fi'],
    tt0386676: ['Comedy'], tt1392214: ['Crime', 'Drama', 'Mystery'], tt0816692: ['Adventure', 'Drama', 'Sci-Fi'],
    tt0245429: ['Animation', 'Family', 'Fantasy'], tt1375666: ['Action', 'Sci-Fi'], tt6751668: ['Drama', 'Thriller'],
  };
  return { progress, history, diary, genreMap };
}

// ---- self-check: node js/lib/stats.js
if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('stats.js')) {
  const assert = (await import('node:assert')).default;
  const t0 = new Date(2025, 2, 3, 21).getTime();
  const history = [
    { id: 'a', type: 'series', name: 'A', at: t0 }, { id: 'a', type: 'series', name: 'A', at: t0 + 3600e3 },
    { id: 'a', type: 'series', name: 'A', at: t0 + 7200e3 }, { id: 'm', type: 'movie', name: 'M', at: t0 + DAY },
    { id: 'b', type: 'series', name: 'B', at: t0 + 3 * DAY }, { id: 'old', type: 'movie', name: 'Old', at: new Date(2024, 5, 1).getTime() },
  ];
  const progress = { m: { id: 'm', name: 'M', eps: { _: { t: 5000, dur: 6000, at: t0 + DAY } } }, a: { id: 'a', name: 'A', eps: { x: { t: 9999, dur: 1000, at: t0 } } } };
  const diary = [{ id: 'm', rating: 4, at: t0 }, { id: 'b', rating: 5, at: t0 }, { id: 'old', rating: 5, at: new Date(2024, 1, 1).getTime() }];
  assert.equal(watchSeconds(progress, 2025), 6000);
  assert.deepEqual(counts(history, 2025), { movies: 1, episodes: 4, titles: 3 });
  assert.equal(topTitles(history, 2025)[0].id, 'a');
  assert.deepEqual(topGenres(history, { a: ['Drama'], m: ['Drama', 'Comedy'] }, 2025)[0], ['Drama', 4]);
  assert.equal(genreTaste(history, diary, { a: ['Drama'], m: ['Drama', 'Comedy'] }, 2)[0][0], 'Drama');
  assert.equal(streak(events(progress, history, 2025), t0 + DAY).longest, 2);
  assert.equal(streak(events(progress, history, 2025), t0 + DAY).current, 2);
  assert.deepEqual([longestBinge(history, 2025).id, longestBinge(history, 2025).count], ['a', 3]);
  assert.deepEqual(newShows(history, 2025).map(x => x.id).sort(), ['a', 'b']);
  assert.equal(topRated(diary, 2025).id, 'b');
  assert.equal(favTime(events(progress, history, 2025)).part, 'night');
  const s = summary(demoData(2025), 2025, demoData(2025).genreMap);
  assert.ok(s.seconds > 0 && s.episodes > 10 && s.movies > 3 && s.genres.length && s.best && s.binge);
  console.log('stats.js ok');
}
