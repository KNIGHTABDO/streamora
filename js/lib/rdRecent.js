// "Played on your other devices": what this RD account unrestricted in the last 30 days (RD /downloads),
// matched to catalog titles. Works without sync. Cached 10 min per tab in sessionStorage.
import { downloads, VIDEO_RE } from '../core/rd.js';
import { resolveTitle } from '../core/meta.js';
import { parse } from '../core/parse.js';
import { pool } from './pool.js';
import { watchHref } from './play.js';

const KEY = 'rd-recent', TTL = 10 * 60e3, DAYS = 30;

/** Episode video id for a parsed release: Cinemeta `tt1:S:E`, Kitsu `kitsu:1:E`. */
export const videoIdOf = (meta, p) =>
  meta.type !== 'series' || p.episode == null ? null
    : String(meta.id).startsWith('kitsu:') ? `${meta.id}:${p.episode}`
    : p.season != null ? `${meta.id}:${p.season}:${p.episode}` : null;

async function load() {
  try { const c = JSON.parse(sessionStorage.getItem(KEY)); if (c && Date.now() - c.at < TTL) return c.items; } catch {}
  const since = Date.now() - DAYS * 864e5;
  const list = ((await downloads(1, 100)) || []).filter(d => VIDEO_RE.test(d.filename || '') && +new Date(d.generated) >= since);
  // newest first, one entry per title (the latest episode played)
  const byTitle = new Map();
  for (const d of list.sort((a, b) => new Date(b.generated) - new Date(a.generated))) {
    const p = parse(d.filename);
    const k = (p.anime ? 'anime' : p.type) + ':' + p.title.toLowerCase();
    if (p.title && !byTitle.has(k)) byTitle.set(k, { p, at: +new Date(d.generated) });
    if (byTitle.size >= 20) break;
  }
  const out = [];
  await pool([...byTitle.values()], 4, async ({ p, at }) => {
    const m = await resolveTitle(p.title, p.year, p.anime ? 'anime' : p.type).catch(() => null);
    if (!m) return;
    const v = videoIdOf(m, p);
    out.push({ id: m.id, type: m.type, name: m.name, poster: m.poster, background: m.background, at, v, season: p.season, episode: p.episode });
  });
  const seen = new Set();
  const items = out.sort((a, b) => b.at - a.at).filter(x => !seen.has(x.id) && seen.add(x.id));
  try { sessionStorage.setItem(KEY, JSON.stringify({ at: Date.now(), items })); } catch {}
  return items;
}

/** Items not already known locally with an equal/newer timestamp. progress = the progress store value. */
export async function rdRecent(progress) {
  return (await load()).filter(x => {
    const p = progress[x.id];
    return !p || (x.v ? ((p.eps || {})[x.v]?.at || 0) : (p.updated || 0)) < x.at;
  }).map(x => ({ ...x, href: x.v ? watchHref(x, { id: x.v }) : null }));
}
