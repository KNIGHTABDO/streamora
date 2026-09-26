// Continue Watching, resume points, up-next. Per profile (progress/history/hidden are pstores).
//
// progress = {
//   [metaId]: { id, type, name, poster, background, anime, updated,
//               last: videoId|null,                       // last episode touched (null for movies)
//               eps: { [videoId|'_']: { t, dur, done, at, season, episode, title } },
//               next: { id, season, episode, title } | null,   // up next once `last` is done
//               source: { infoHash, fileIdx, binge } }    // reuse the same release for the next episode
// }
import { progress, history, hidden } from './store.js';
import { nextVideo } from './meta.js';

export const DONE_AT = 0.92;
const keyOf = video => (video ? video.id : '_');

/** Called by the player every ~5s, on pause and on close. meta = full meta (with videos for series). */
export function saveProgress(meta, video, t, dur, source) {
  if (!meta || !dur || !isFinite(dur) || t < 5) return;
  const done = t / dur >= DONE_AT;
  let justFinished = false;
  progress.update(p => {
    const cur = p[meta.id] || { eps: {} };
    const k = keyOf(video);
    justFinished = done && !(cur.eps[k] && cur.eps[k].done);
    cur.eps[k] = { t: Math.floor(t), dur: Math.floor(dur), done, at: Date.now(), season: video && video.season, episode: video && video.episode, title: video && (video.name || video.title) };
    const nv = video ? nextVideo(meta, video.id) : null;
    Object.assign(cur, {
      id: meta.id, type: meta.type, name: meta.name, poster: meta.poster, background: meta.background, anime: !!meta.anime,
      updated: Date.now(), last: video ? video.id : null,
      next: nv ? { id: nv.id, season: nv.season, episode: nv.episode, title: nv.name || nv.title, released: nv.released } : null,
      source: source || cur.source || null,
    });
    p[meta.id] = cur;
    return p;
  });
  if (justFinished) {
    history.update(h => [{ id: meta.id, type: meta.type, name: meta.name, poster: meta.poster, videoId: video && video.id, season: video && video.season, episode: video && video.episode, at: Date.now() }, ...h].slice(0, 2000));
  }
  // any activity brings it back to the row
  hidden.update(h => h.filter(x => x !== meta.id));
}

/** Seconds to resume at, or 0. */
export function resumeAt(metaId, videoId) {
  const e = (progress.get()[metaId] || { eps: {} }).eps[videoId || '_'];
  return e && !e.done && e.t > 30 ? e.t : 0;
}

export const epState = (metaId, videoId) => ((progress.get()[metaId] || { eps: {} }).eps[videoId || '_']) || null;

/**
 * Items for the Continue Watching row, newest first.
 * Each: { ...entry, pct (0..1), label ('S4 · E5' | 'Up next · S4 E6' | ''), play: { videoId, t } }
 * Finished movies drop off; finished episodes turn into "up next" if there is a released next episode.
 */
export function continueWatching(p = progress.get(), hid = hidden.get()) {
  const out = [];
  for (const e of Object.values(p)) {
    if (hid.includes(e.id)) continue;
    const cur = e.eps[e.last || '_'];
    if (!cur) continue;
    if (!cur.done) {
      out.push({ ...e, pct: cur.t / cur.dur, label: e.last ? `S${cur.season} · E${cur.episode}` : '', play: { videoId: e.last, t: cur.t } });
    } else if (e.next && (!e.next.released || new Date(e.next.released) <= new Date())) {
      out.push({ ...e, pct: 0, upNext: true, label: `Up next · S${e.next.season} E${e.next.episode}`, play: { videoId: e.next.id, t: 0 } });
    }
  }
  return out.sort((a, b) => b.updated - a.updated);
}

export const hideFromContinue = id => hidden.update(h => (h.includes(id) ? h : [...h, id]));

export function markWatched(meta, video) {
  const dur = 100;
  saveProgress(meta, video, dur, dur);
}

export function clearProgress(metaId) {
  progress.update(p => { delete p[metaId]; return p; });
}
