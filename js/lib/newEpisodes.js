// New episodes of followed shows (follows, in progress, watchlist) that aired since you last watched them.
// Checked at most once a day per profile (cached in the 'newEps' pstore); drives the Calendar badge,
// the Home "New episodes" shelf and one system notification per batch.
import { follows, progress, watchlist, pstore } from '../core/store.js';
import { meta } from '../core/meta.js';
import { pool } from './pool.js';
import { dayKey } from './stats.js';

const DAY = 864e5;
export const newEps = pstore('newEps', { day: null, items: [], notified: [], badgeSeen: [] }); // items: [{ id, showId, name, poster, season, episode, title, at }]

/** Shows worth watching for new episodes: followed, started, or pinned. */
export function followedShows() {
  const m = new Map();
  for (const f of follows.get()) if (f.type !== 'movie') m.set(f.id, f);
  for (const p of Object.values(progress.get())) if (p.type !== 'movie' && !m.has(p.id)) m.set(p.id, p);
  for (const w of watchlist.get()) if (w.type !== 'movie' && !m.has(w.id)) m.set(w.id, w);
  return [...m.values()];
}

/** Every dated episode of the given shows, oldest first: [{ show, v, at }] */
export async function loadEpisodes(shows) {
  const metas = await pool(shows, 6, s => meta(s.type === 'movie' ? 'movie' : 'series', s.id));
  const out = [];
  for (const m of metas) {
    if (!m) continue;
    for (const v of m.videos || []) {
      if (!v.released || v.season === 0) continue;
      out.push({ show: m, v, at: new Date(v.released).getTime() });
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

// "last seen" = the latest time you touched the show (or pinned/followed it); only the last 2 weeks count as new
function lastSeen(id) {
  const p = progress.get()[id];
  const eps = p ? Object.values(p.eps || {}) : [];
  const touched = Math.max(0, ...eps.map(e => e.at || 0));
  const w = watchlist.get().find(x => x.id === id);
  return Math.max(touched, (w && w.added) || 0, Date.now() - 14 * DAY);
}

/** Unseen count for the Calendar badge. */
export const badgeCount = st => { const seen = new Set(st.badgeSeen || []); return (st.items || []).filter(i => !seen.has(i.id)).length; };
/** Opening the Calendar clears the badge. */
export function markNewEpisodesSeen() { const st = newEps.get(); newEps.set({ ...st, badgeSeen: (st.items || []).map(i => i.id) }); }

let running = null;
/** Recompute (once per day unless force). Resolves to the item list. */
export function checkNewEpisodes({ force } = {}) {
  const cur = newEps.get();
  if (!force && cur.day === dayKey(Date.now())) return Promise.resolve(cur.items);
  return running || (running = (async () => {
    const shows = followedShows();
    const now = Date.now(), done = progress.get();
    const eps = shows.length ? await loadEpisodes(shows) : [];
    const items = eps.filter(e => e.at <= now && e.at > lastSeen(e.show.id) && !((done[e.show.id] || {}).eps || {})[e.v.id]?.done)
      .reverse()
      .map(e => ({ id: e.v.id, showId: e.show.id, name: e.show.name, poster: e.show.poster, background: e.show.background, season: e.v.season, episode: e.v.episode, title: e.v.name || e.v.title || '', at: e.at }));
    newEps.set({ ...newEps.get(), day: dayKey(now), items });
    return items;
  })().finally(() => { running = null; }));
}

/** One notification for items not notified yet (only when permission is already granted). */
export async function notifyNewEpisodes() {
  if (!('Notification' in window) || Notification.permission !== 'granted' || !('serviceWorker' in navigator)) return;
  const items = await checkNewEpisodes();
  const st = newEps.get(), seen = new Set(st.notified || []);
  const fresh = items.filter(i => !seen.has(i.id));
  if (!fresh.length) return;
  const reg = await navigator.serviceWorker.getRegistration();
  if (!reg) return;
  const first = fresh[0];
  const body = fresh.length === 1 ? `${first.name} · S${first.season} E${first.episode}${first.title ? ` · ${first.title}` : ''}`
    : `${first.name} and ${fresh.length - 1} more ${fresh.length === 2 ? 'episode' : 'episodes'} are out.`;
  await reg.showNotification('New episodes on Streamora', { body, icon: 'art/icon-180.png', tag: 'streamora-new-eps', data: { url: '#/calendar' } });
  newEps.set({ ...newEps.get(), notified: [...(st.notified || []), ...fresh.map(i => i.id)].slice(-300) });
}

/** Called from Settings: asks for permission, then notifies right away. Resolves to the permission. */
export async function requestEpisodeNotifications() {
  if (!('Notification' in window)) return 'unsupported';
  const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
  if (p === 'granted') notifyNewEpisodes().catch(() => {});
  return p;
}
