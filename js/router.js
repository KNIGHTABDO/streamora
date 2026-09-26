// Hash router. Routes are lazy page modules: each exports `default function Page({ params, query })`.
import { useState, useEffect } from '../vendor/preact-htm.js';

export const ROUTES = [
  ['/', () => import('./pages/home.js')],
  ['/movies', () => import('./pages/movies.js')],
  ['/shows', () => import('./pages/shows.js')],
  ['/anime', () => import('./pages/anime.js')],
  ['/myrd', () => import('./pages/myrd.js')],
  ['/title/:type/:id', () => import('./pages/detail.js')],
  ['/watch/:type/:id', () => import('./pages/watch.js')],            // ?v=videoId&t=seconds&hash=&file=
  ['/search', () => import('./pages/search.js')],                    // ?q=
  ['/genres', () => import('./pages/genres.js')],
  ['/genre/:type/:genre', () => import('./pages/genres.js')],
  ['/mood', () => import('./pages/mood.js')],
  ['/surprise', () => import('./pages/surprise.js')],
  ['/calendar', () => import('./pages/calendar.js')],
  ['/world', () => import('./pages/world.js')],
  ['/world/:country', () => import('./pages/world.js')],
  ['/time', () => import('./pages/timemachine.js')],
  ['/collections', () => import('./pages/collections.js')],
  ['/collection/:slug', () => import('./pages/collections.js')],
  ['/person/:name', () => import('./pages/people.js')],
  ['/people', () => import('./pages/people.js')],
  ['/watchlist', () => import('./pages/watchlist.js')],
  ['/diary', () => import('./pages/diary.js')],
  ['/wrapped', () => import('./pages/wrapped.js')],
  ['/add', () => import('./pages/add.js')],
  ['/profiles', () => import('./pages/profiles.js')],
  ['/settings', () => import('./pages/settings.js')],
  ['/welcome', () => import('./pages/welcome.js')],
  ['/import', () => import('./pages/settings.js')],                  // #/import?d=<backup> (from a QR code)
  ['/kit', () => import('./pages/kit.js')],                          // living style guide
];

export function parseHash(h = location.hash) {
  const raw = h.replace(/^#/, '') || '/';
  const [path, qs = ''] = raw.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs));
  for (const [pattern, load] of ROUTES) {
    const pp = pattern.split('/'), xs = path.split('/');
    if (pp.length !== xs.length) continue;
    const params = {};
    if (pp.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decodeURIComponent(xs[i])), true) : p === xs[i]))) {
      return { path, pattern, params, query, load };
    }
  }
  return { path, pattern: null, params: {}, query, load: null };
}

/** navigate('#/title/movie/tt123') or navigate('/search?q=x', { replace: true }) */
export function navigate(to, { replace } = {}) {
  const h = to.startsWith('#') ? to : '#' + to;
  if (replace) { history.replaceState(null, '', h); window.dispatchEvent(new HashChangeEvent('hashchange')); }
  else location.hash = h;
}

/** Update the query string of the current route without adding history entries. */
export function setQuery(patch) {
  const r = parseHash();
  const q = new URLSearchParams({ ...r.query, ...patch });
  for (const [k, v] of [...q]) if (v === '' || v == null || v === 'undefined') q.delete(k);
  const s = q.toString();
  history.replaceState(null, '', `#${r.path}${s ? '?' + s : ''}`);
  window.dispatchEvent(new HashChangeEvent('hashchange'));
}

export function useRoute() {
  const [r, set] = useState(parseHash);
  useEffect(() => {
    const on = () => set(parseHash());
    addEventListener('hashchange', on);
    return () => removeEventListener('hashchange', on);
  }, []);
  return r;
}

export const back = (fallback = '#/') => (history.length > 1 ? history.back() : navigate(fallback));
