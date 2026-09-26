// Trakt: device-code sign-in, scrobbling from the player, and importing watched history / watchlist.
// Only the OAuth calls go through /api/trakt (they need the client secret); the rest goes straight to api.trakt.tv.
// Tokens live per profile in IndexedDB (not localStorage), so they never end up in backups or sync.
import { activeProfileId, progress, history, watchlist, store } from './store.js';
import { idbGet, idbSet, idbDel } from './sync.js';

const API = 'https://api.trakt.tv';
export const traktRev = store('trakt-rev', 0); // bumped on connect/disconnect so the UI re-reads
const slot = () => `trakt:${activeProfileId.get()}`;
const bump = () => traktRev.set(traktRev.get() + 1);

let cfg = null;
async function clientId() {
  cfg = cfg || fetch('/api/trakt/config').then(r => (r.ok ? r.json() : {})).then(j => j.client_id || Promise.reject(new Error("Trakt isn't set up on this server yet (see DEPLOY.md).")));
  try { return await cfg; } catch (e) { cfg = null; throw e; }
}
export const traktAvailable = () => clientId().then(() => true, () => false);

const relay = (path, body) => fetch(`/api/trakt/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });

export const traktAccount = () => idbGet(slot());

async function fresh() {
  const key = slot();
  let t = await idbGet(key);
  if (!t) return null;
  if ((t.created_at + t.expires_in - 86400) * 1000 < Date.now()) {
    const r = await relay('oauth/token', { refresh_token: t.refresh_token });
    if (!r.ok) { if (r.status === 400 || r.status === 401) { await idbDel(key); bump(); } throw new Error('Trakt sign-in expired. Connect again.'); }
    t = { ...t, ...(await r.json()) };
    await idbSet(key, t);
  }
  return t;
}

export async function api(path, opts = {}) {
  const t = await fresh();
  if (!t) throw new Error('Not connected to Trakt.');
  const r = await fetch(API + path, {
    ...opts,
    headers: { 'Content-Type': 'application/json', 'trakt-api-version': '2', 'trakt-api-key': await clientId(), Authorization: `Bearer ${t.access_token}`, ...opts.headers },
  });
  if (!r.ok) throw new Error(`Trakt said ${r.status}`);
  return r.status === 204 ? null : r.json();
}

/** Step 1: returns { user_code, verification_url, device_code, interval, expires_in } to show the user. */
export async function startConnect() {
  await clientId();
  const r = await relay('oauth/device/code');
  if (!r.ok) throw new Error(`Trakt said ${r.status}`);
  return r.json();
}
/** Step 2: polls until the user approves on trakt.tv. Resolves with the username. Pass an AbortSignal to stop. */
export async function finishConnect(dc, signal) {
  const key = slot();
  let wait = (dc.interval || 5) * 1000;
  const until = Date.now() + (dc.expires_in || 600) * 1000;
  while (Date.now() < until) {
    await new Promise(res => setTimeout(res, wait));
    if (signal && signal.aborted) throw new Error('Cancelled');
    const r = await relay('oauth/device/token', { code: dc.device_code });
    if (r.status === 200) {
      await idbSet(key, await r.json());
      let name = '';
      try { name = (await api('/users/settings')).user.username; } catch {}
      await idbSet(key, { ...(await idbGet(key)), username: name });
      bump();
      return name;
    }
    if (r.status === 429) wait += 1000;
    else if (r.status !== 400) throw new Error({ 404: 'Code not found', 409: 'Code already used', 410: 'Code expired', 418: 'You denied access' }[r.status] || `Trakt said ${r.status}`);
  }
  throw new Error('Code expired. Try again.');
}
export async function disconnect() { await idbDel(slot()); bump(); }

// ------------------------------------------------------------ scrobbling
const imdbOf = meta => [meta && meta.id, meta && meta.imdb_id, meta && meta.imdb].find(x => /^tt\d+$/.test(x || '')) || null;
export function scrobbleBody(meta, video) {
  const imdb = imdbOf(meta);
  if (!imdb) return null; // Kitsu-only anime: Trakt can't match it
  if (meta.type === 'movie') return { movie: { ids: { imdb } } };
  const number = video && (video.episode ?? video.number);
  if (!video || video.season == null || number == null) return null;
  return { show: { ids: { imdb } }, episode: { season: +video.season, number: +number } };
}
function onPlayback(e) {
  const { state, meta, video, progress: pct } = e.detail || {};
  if (!['start', 'pause', 'stop'].includes(state)) return;
  const body = scrobbleBody(meta, video);
  if (body) api(`/scrobble/${state}`, { method: 'POST', body: JSON.stringify({ ...body, progress: Math.max(0, Math.min(100, +pct || 0)) }) }).catch(() => {});
}

// ------------------------------------------------------------ imports
const poster = id => `https://images.metahub.space/poster/medium/${id}/img`;
const when = s => Date.parse(s) || Date.now();

/** Pure: folds Trakt /sync/watched movies + shows into a progress object. Returns { p, hist, n }. Never overwrites local entries. */
export function foldWatched(p, movies, shows) {
  const hist = [];
  let n = 0;
  for (const m of movies || []) {
    const id = m.movie && m.movie.ids && m.movie.ids.imdb;
    if (!id) continue;
    const cur = p[id] || { id, type: 'movie', name: m.movie.title, poster: poster(id), anime: false, eps: {}, last: null, next: null, source: null, updated: 0 };
    if (cur.eps._ && cur.eps._.done) continue;
    const at = when(m.last_watched_at);
    cur.eps._ = { t: 100, dur: 100, done: true, at };
    cur.updated = Math.max(cur.updated || 0, at);
    p[id] = cur; n++;
    hist.push({ id, type: 'movie', name: cur.name, poster: cur.poster, at });
  }
  for (const s of shows || []) {
    const id = s.show && s.show.ids && s.show.ids.imdb;
    if (!id) continue;
    const isNew = !p[id];
    const cur = p[id] || { id, type: 'series', name: s.show.title, poster: poster(id), anime: false, eps: {}, last: null, next: null, source: null, updated: 0 };
    let latest = 0;
    for (const season of s.seasons || []) for (const ep of season.episodes || []) {
      const vid = `${id}:${season.number}:${ep.number}`;
      if (cur.eps[vid] && cur.eps[vid].done) continue;
      const at = when(ep.last_watched_at);
      cur.eps[vid] = { t: 100, dur: 100, done: true, at, season: season.number, episode: ep.number };
      if (isNew && at >= latest) { latest = at; cur.last = vid; }
      cur.updated = Math.max(cur.updated || 0, at);
      n++;
      hist.push({ id, type: 'series', name: cur.name, poster: cur.poster, videoId: vid, season: season.number, episode: ep.number, at });
    }
    if (Object.keys(cur.eps).length) p[id] = cur;
  }
  return { p, hist, n };
}

/** Imports watched movies and episodes. Returns how many were new here. */
export async function importHistory() {
  const [movies, shows] = await Promise.all([api('/sync/watched/movies'), api('/sync/watched/shows')]);
  let res;
  progress.update(p => { res = foldWatched(p, movies, shows); return res.p; });
  if (res.hist.length) {
    history.update(h => {
      const seen = new Set(h.map(x => `${x.id}|${x.videoId || ''}`));
      return [...h, ...res.hist.filter(x => !seen.has(`${x.id}|${x.videoId || ''}`))].sort((a, b) => b.at - a.at).slice(0, 2000);
    });
  }
  return res.n;
}

/** Adds Trakt watchlist movies/shows that aren't saved yet. Returns how many. */
export async function importWatchlist() {
  const items = await api('/sync/watchlist');
  const have = new Set(watchlist.get().map(x => x.id));
  const add = [];
  for (const it of items || []) {
    const m = it.movie || it.show;
    const id = m && m.ids && m.ids.imdb;
    if (!id || have.has(id)) continue;
    have.add(id);
    add.push({ id, type: it.movie ? 'movie' : 'series', name: m.title, poster: poster(id), added: when(it.listed_at) });
  }
  if (add.length) watchlist.update(w => [...add, ...w]);
  return add.length;
}

let started = false;
export function initTrakt() {
  if (started) return;
  started = true;
  addEventListener('streamora:playback', onPlayback);
}
