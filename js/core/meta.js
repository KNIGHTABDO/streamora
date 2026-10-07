// Catalog + metadata. Cinemeta (movies/series, IMDb ids) and Kitsu (anime, kitsu:ids). Both are free with CORS.
// Every item is a Stremio "meta" object: {id, type:'movie'|'series', name, poster, background, logo,
//   description, releaseInfo, year, imdbRating, genres[], runtime, cast[], director[], videos[] (series)}
// Anime items additionally get `anime: true`.

import { activeProfile, ls } from './store.js';
import { fetchT } from './net.js';

export const CINEMETA = 'https://v3-cinemeta.strem.io';
export const KITSU = 'https://anime-kitsu.strem.fun';

const mem = new Map();
const TTL = 6 * 3600e3;

// Persistent stale-while-revalidate: anything fetched before shows instantly (even after an app restart),
// and is refreshed in the background once older than ttl. Only a first-ever request waits on the network.
const CACHE = 'streamora-json-v1';
const CACHE_MAX = 300;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const net = async (url, retry = true) => {
  const r = await fetchT(url, {}, 10000, 'The catalog');
  if (r.status === 429 && retry) { await sleep(Math.min(10, +r.headers.get('Retry-After') || 2) * 1000); return net(url, false); }
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r;
};
let puts = 0;
async function prune(c) {
  // Cache Storage keys() come back in insertion order and put() re-inserts, so the front is the oldest
  const keys = await c.keys();
  await Promise.all(keys.slice(0, Math.max(0, keys.length - CACHE_MAX)).map(k => c.delete(k)));
}
function getJSON(url, { ttl = TTL } = {}) {
  const now = Date.now();
  const m = mem.get(url);
  if (m && now - m.at < ttl) return m.p;
  const fresh = () => {
    const p = net(url).then(async r => {
      try { const c = await caches.open(CACHE); await c.put(url, new Response(r.clone().body, { headers: { 'x-at': String(Date.now()) } })); if (++puts % 25 === 0) prune(c).catch(() => {}); } catch {}
      return r.json();
    });
    mem.set(url, { at: now, p }); p.catch(() => mem.delete(url));
    return p;
  };
  // stored before the first await, so parallel callers share one request
  const p = (async () => {
    let hit;
    try { hit = typeof caches !== 'undefined' && await (await caches.open(CACHE)).match(url); } catch {}
    if (!hit) return fresh();
    if (now - +(hit.headers.get('x-at') || 0) > ttl) fresh().catch(() => {}); // refresh quietly
    return hit.json();
  })();
  mem.set(url, { at: now, p }); p.catch(() => mem.get(url)?.p === p && mem.delete(url));
  return p;
}

const extra = obj => {
  const parts = Object.entries(obj || {}).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(v)}`);
  return parts.length ? '/' + parts.join('&') : '';
};

const norm = (m, anime) => m && ({
  ...m,
  year: m.year || parseInt(m.releaseInfo, 10) || undefined,
  poster: m.poster || null,
  background: m.background || m.poster || null,
  anime: anime || m.anime || String(m.id).startsWith('kitsu:'),
});

// Kids profiles only ever see family-friendly things, wherever a list comes from.
// ponytail: genre-based filter (Family/Animation/Kids), not an age rating; add a certification source if it matters.
const KID_GENRES = /^(family|animation|kids)$/i;
export const kidSafe = m => (m.genres || []).some(g => KID_GENRES.test(g));
const forProfile = list => (activeProfile() && activeProfile().kids ? list.filter(kidSafe) : list);

export const MOVIE_GENRES = ['Action', 'Adventure', 'Animation', 'Biography', 'Comedy', 'Crime', 'Documentary', 'Drama', 'Family', 'Fantasy', 'History', 'Horror', 'Mystery', 'Romance', 'Sci-Fi', 'Sport', 'Thriller', 'War', 'Western'];
export const SERIES_GENRES = [...MOVIE_GENRES, 'Reality-TV', 'Talk-Show', 'Game-Show'];
export const ANIME_GENRES = ['Action', 'Adventure', 'Comedy', 'Drama', 'Sci-Fi', 'Mystery', 'Magic', 'Supernatural', 'Fantasy', 'Sports', 'Romance', 'Slice of Life', 'Horror', 'Psychological', 'Thriller', 'Mecha', 'Music', 'School', 'Historical', 'Military', 'Samurai', 'Cooking', 'Family', 'Friendship'];

/**
 * Cinemeta catalogs: id 'top' (popular, genre filter), 'imdbRating' (genre filter), 'year' (genre = a year like 1994).
 * catalog('movie','top',{genre:'Horror', skip:0})
 * Kitsu anime catalogs: 'kitsu-anime-trending' | 'kitsu-anime-airing' | 'kitsu-anime-popular' | 'kitsu-anime-rating'
 * catalog('anime','kitsu-anime-airing',{genre:'Action'})
 */
export async function catalog(type, id, opts = {}) {
  const anime = type === 'anime';
  const base = anime ? KITSU : CINEMETA;
  const j = await getJSON(`${base}/catalog/${type}/${id}${extra(opts)}.json`);
  return forProfile((j.metas || []).map(m => norm(m, anime)));
}

export async function meta(type, id) {
  const anime = String(id).startsWith('kitsu:');
  const j = await getJSON(`${anime ? KITSU : CINEMETA}/meta/${type}/${encodeURIComponent(id)}.json`);
  const m = norm(j.meta, anime);
  if (m && m.videos) m.videos = m.videos.slice().sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
  return m;
}

// Title match quality: exact > starts with > every word of the query is a word of the title > the rest. Ties keep the source's own (popularity) order.
const fold = t => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9Ѐ-ӿ぀-鿿]+/g, ' ').trim();
function rankSearch(list, q) {
  const nq = fold(q), words = nq.split(' ').filter(Boolean);
  const tier = m => {
    const t = fold(m.name);
    if (!nq || !t) return 3;
    if (t === nq) return 0;
    if (t.startsWith(nq)) return 1;
    const tw = new Set(t.split(' '));
    return words.every(w => tw.has(w)) ? 2 : 3;
  };
  return list.map((m, i) => [tier(m), i, m]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
}

/** search('dune', 'movie' | 'series' | 'anime' | 'all') */
/** onPart(results so far) fires as each source lands, so the fastest one shows right away. */
export async function search(q, type = 'all', onPart) {
  if (!q || !q.trim()) return [];
  const jobs = [];
  if (type === 'all' || type === 'movie') jobs.push(catalog('movie', 'top', { search: q }));
  if (type === 'all' || type === 'series') jobs.push(catalog('series', 'top', { search: q }));
  if (type === 'all' || type === 'anime') jobs.push(getJSON(`${KITSU}/catalog/anime/kitsu-anime-list/search=${encodeURIComponent(q)}.json`).then(j => (j.metas || []).map(m => norm(m, true))));
  const got = jobs.map(() => []);
  jobs.forEach((j, i) => j.then(v => { got[i] = v; onPart && onPart(rankSearch(forProfile(got.flat()), q)); }, () => {}));
  const res = await Promise.allSettled(jobs);
  return rankSearch(forProfile(res.flatMap(r => (r.status === 'fulfilled' ? r.value : []))), q);
}

/**
 * Curated lists store {name, year, type}; this finds the real item.
 * Use this instead of hardcoding ids from memory.
 */
// Resolved titles live in one capped map (ls 'rt', newest last). Old builds kept one 'rt:*' key each: fold those in once.
const RT_MAX = 500;
let rt = null;
function rtMap() {
  if (rt) return rt;
  rt = ls.get('rt', {});
  const old = ls.keys().filter(k => k.startsWith('rt:'));
  if (old.length) { for (const k of old) { rt[k.slice(3)] ??= ls.get(k); ls.del(k); } rtSave(); }
  return rt;
}
function rtSave() {
  const keys = Object.keys(rt);
  for (const k of keys.slice(0, Math.max(0, keys.length - RT_MAX))) delete rt[k];
  ls.set('rt', rt);
}

export async function resolveTitle(name, year, type = 'movie') {
  const key = `${type}:${name}:${year || ''}`;
  const c = rtMap()[key];
  if (c) { delete rt[key]; rt[key] = c; return c; } // LRU touch (saved with the next write)
  const res = type === 'anime' ? await search(name, 'anime') : await catalog(type, 'top', { search: name });
  const clean = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const hit = res.find(m => clean(m.name) === clean(name) && (!year || Math.abs((m.year || 0) - year) <= 1))
    || res.find(m => !year || Math.abs((m.year || 0) - year) <= 1)
    || res[0] || null;
  if (hit) { rtMap()[key] = hit; rtSave(); }
  return hit;
}

// Cinemeta drops requests when ~20 searches fire at once, so resolve 4 at a time with one retry, keeping order.
export async function resolveTitles(list, n = 4) {
  const out = new Array(list.length).fill(null);
  let next = 0;
  const one = t => resolveTitle(t.name, t.year, t.type || 'movie');
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      try { out[i] = await one(list[i]); }
      catch { try { out[i] = await one(list[i]); } catch {} }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
  return out.filter(Boolean);
}

// Episodes grouped by season (season 0 = specials, moved last)
export function seasonsOf(m) {
  const by = new Map();
  for (const v of m.videos || []) {
    const s = v.season ?? 1;
    if (!by.has(s)) by.set(s, []);
    by.get(s).push(v);
  }
  return [...by.entries()].sort((a, b) => (a[0] === 0) - (b[0] === 0) || a[0] - b[0]);
}

export function nextVideo(m, videoId) {
  const vids = (m.videos || []).filter(v => v.season !== 0);
  const i = vids.findIndex(v => v.id === videoId);
  return i >= 0 ? vids[i + 1] || null : null;
}

export const isReleased = v => !v.released || new Date(v.released) <= new Date();

// Poster/background helpers: metahub serves stable art for IMDb ids
export const posterOf = m => m.poster || (String(m.id).startsWith('tt') ? `https://images.metahub.space/poster/medium/${m.id}/img` : null);
export const backdropOf = m => m.background || (String(m.id).startsWith('tt') ? `https://images.metahub.space/background/large/${m.id}/img` : m.poster);
export const logoOf = m => m.logo || (String(m.id).startsWith('tt') ? `https://images.metahub.space/logo/medium/${m.id}/img` : null);

/** {name: photoUrl} from Wikipedia lead images (free, CORS). Names without a page/photo are simply missing. */
// ponytail: matches by exact article title, so a namesake's photo can slip in; use TMDB (needs a key) if that bites.
export async function castPhotos(names) {
  if (!names.length) return {};
  const q = names.map(encodeURIComponent).join('|');
  const j = await getJSON(`https://en.wikipedia.org/w/api.php?action=query&format=json&origin=*&redirects=1&prop=pageimages&piprop=thumbnail&pithumbsize=240&titles=${q}`, { ttl: 7 * 864e5 }).catch(() => null);
  const qr = j && j.query; if (!qr) return {};
  const back = {}; for (const r of [...(qr.normalized || []), ...(qr.redirects || [])]) back[r.to] = back[r.from] || r.from;
  const out = {};
  for (const p of Object.values(qr.pages || {})) if (p.thumbnail) out[back[p.title] || p.title] = p.thumbnail.source;
  return out;
}
