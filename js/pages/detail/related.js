// Helper for More Like This recommendations:
// Uses Trakt /movies/{id}/related or /shows/{id}/related when connected,
// resolves items to full metas, and falls back to a scored top-genres overlap
// local mix when Trakt isn't connected or fails.
import { related } from '../../core/trakt.js';
import { meta as getMeta, catalog, resolveTitle } from '../../core/meta.js';
import { pool } from '../../lib/pool.js';

const imdbOf = m => [m && m.id, m && m.imdb_id, m && m.imdb].find(x => /^tt\d+$/.test(x || '')) || null;

/**
 * Returns { items: meta[], source: 'trakt' | 'local' }
 */
export async function getMoreLikeThis(m) {
  if (!m) return { items: [], source: 'local' };
  const imdb = !m.anime ? imdbOf(m) : null;

  // 1. If IMDb id exists and not anime, try Trakt related first
  if (imdb) {
    try {
      const relatedItems = await related(m.type, imdb);
      if (Array.isArray(relatedItems) && relatedItems.length > 0) {
        // Resolve to full metas via pool
        const metas = await pool(relatedItems.slice(0, 18), 4, async item => {
          const itemImdb = item.ids && item.ids.imdb;
          if (itemImdb) {
            try {
              const res = await getMeta(m.type, itemImdb);
              if (res) return res;
            } catch {}
          }
          if (item.title) {
            try {
              return await resolveTitle(item.title, item.year, m.type);
            } catch {}
          }
          return null;
        });
        const valid = metas.filter(Boolean).filter(x => x.id !== m.id);
        if (valid.length > 0) {
          return { items: valid.slice(0, 20), source: 'trakt' };
        }
      }
    } catch {}
  }

  // 2. Local fallback mix: query top genres, score candidates by genre overlap, exclude current title
  const genres = (m.genres || []).slice(0, 3);
  if (!genres.length) return { items: [], source: 'local' };

  try {
    const lists = await Promise.all(genres.map(g => {
      return m.anime
        ? catalog('anime', 'kitsu-anime-popular', { genre: g }).catch(() => [])
        : catalog(m.type, 'top', { genre: g }).catch(() => []);
    }));

    const targetGenres = new Set((m.genres || []).map(g => g.toLowerCase()));
    const seen = new Map();

    for (const list of lists) {
      for (const item of (list || [])) {
        if (!item || item.id === m.id) continue;
        if (!seen.has(item.id)) {
          const itemGenres = (item.genres || []).map(g => g.toLowerCase());
          const overlap = itemGenres.filter(g => targetGenres.has(g)).length;
          // score: overlap count is primary weight; IMDb rating is tie-breaker
          const score = overlap * 10 + (parseFloat(item.imdbRating) || 0);
          seen.set(item.id, { item, score });
        }
      }
    }

    const sorted = [...seen.values()]
      .sort((a, b) => b.score - a.score)
      .map(x => x.item)
      .slice(0, 20);

    return { items: sorted, source: 'local' };
  } catch {
    return { items: [], source: 'local' };
  }
}
