// Shared "where does Play go" helpers for home + detail.
import { progress, watchlist } from '../core/store.js';
import { isReleased } from '../core/meta.js';
import { resumeAt } from '../core/progress.js';

/** #/watch URL. video = episode object (series) or null. */
export function watchHref(meta, video, t, src) {
  const q = new URLSearchParams();
  if (video) q.set('v', video.id);
  if (t) q.set('t', Math.floor(t));
  if (src) {
    q.set('hash', src.infoHash);
    if (src.fileIdx != null) q.set('file', src.fileIdx);
    if (src.filename) q.set('fn', src.filename);
  }
  const s = q.toString();
  return `#/watch/${meta.type}/${encodeURIComponent(meta.id)}${s ? '?' + s : ''}`;
}

/** The episode Play should start: last unfinished, else the one after the last finished, else S1E1. */
export function nextUp(meta) {
  const vids = (meta.videos || []).filter(v => v.season !== 0);
  if (!vids.length) return null;
  const p = progress.get()[meta.id];
  if (p && p.last) {
    const cur = p.eps[p.last];
    const i = vids.findIndex(v => v.id === p.last);
    if (cur && !cur.done && i >= 0) return vids[i];
    if (i >= 0 && vids[i + 1] && isReleased(vids[i + 1])) return vids[i + 1];
    if (i >= 0) return vids[i];
  }
  return vids.find(isReleased) || vids[0];
}

/** The release last played for this title, tried first. Other episodes only keep the hash (file index differs). */
export function rememberedSource(metaId, sameFile) {
  const src = (progress.get()[metaId] || {}).source;
  if (!src || !src.infoHash) return null;
  return sameFile ? src : { infoHash: src.infoHash };
}

/** { href, label, t } for the main Play button: straight to the player (remembered release first, else the top-ranked cached one). */
export function playAction(meta) {
  if (meta.type === 'series' || (meta.videos && meta.videos.length > 1)) {
    const v = nextUp(meta);
    if (!v) return { href: watchHref(meta, null), label: 'Play', t: 0 };
    const t = resumeAt(meta.id, v.id);
    const p = progress.get()[meta.id];
    return { href: watchHref(meta, v, t, rememberedSource(meta.id, p && p.last === v.id)), label: `${t ? 'Resume' : 'Play'} S${v.season} · E${v.episode}`, t };
  }
  const t = resumeAt(meta.id, null);
  return { href: watchHref(meta, null, t, rememberedSource(meta.id, true)), label: t ? 'Resume' : 'Play', t };
}

export const inWatchlist = (list, id) => list.some(w => w.id === id);
export function toggleWatchlist(meta) {
  let added = false;
  watchlist.update(l => {
    if (l.some(w => w.id === meta.id)) return l.filter(w => w.id !== meta.id);
    added = true;
    return [{ id: meta.id, type: meta.type, name: meta.name, poster: meta.poster, background: meta.background, year: meta.year, anime: !!meta.anime, added: Date.now() }, ...l];
  });
  return added;
}
