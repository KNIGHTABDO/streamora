// Hash router. Routes are lazy page modules: each exports `default function Page({ params, query })`.
import { useState, useEffect } from '../vendor/preact-htm.js';

export const ROUTES = [
  ['/', () => import('./pages/home.js')],
  ['/movies', () => import('./pages/movies.js')],
  ['/shows', () => import('./pages/shows.js')],
  ['/anime', () => import('./pages/anime.js')],
  ['/myrd', () => import('./pages/home.js')],  // My TorBox is hidden (shared key): old links land on Home
  ['/title/:type/:id', () => import('./pages/detail.js')],
  ['/watch/:type/:id', () => import('./pages/watch.js')],            // ?v=videoId&t=seconds&hash=&file=
  ['/search', () => import('./pages/search.js')],                    // ?q=
  ['/genres', () => import('./pages/genres.js')],
  ['/genre/:type/:genre', () => import('./pages/genres.js')],
  ['/mood', () => import('./pages/mood.js')],
  ['/calendar', () => import('./pages/calendar.js')],
  ['/collections', () => import('./pages/collections.js')],
  ['/collection/:slug', () => import('./pages/collections.js')],
  ['/person/:name', () => import('./pages/people.js')],
  ['/people', () => import('./pages/people.js')],
  ['/watchlist', () => import('./pages/watchlist.js')],
  ['/diary', () => import('./pages/diary.js')],
  ['/add', () => import('./pages/add.js')],
  ['/profiles', () => import('./pages/profiles.js')],
  ['/settings', () => import('./pages/settings.js')],
  ['/welcome', () => import('./pages/welcome.js')],
];
const LOCAL = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
if (LOCAL) ROUTES.push(['/kit', () => import('./pages/kit.js')]);  // living style guide (dev only)

// Old sections that were merged into others: keep bookmarks working.
const decadeOf = x => { const n = parseInt(x, 10); return n >= 1900 ? String(Math.floor(n / 10) * 10) : ''; };
function redirectOf(path, query) {
  const [, a, b] = path.split('/');
  const q = o => { const s = new URLSearchParams(Object.entries(o).filter(([, v]) => v)).toString(); return s ? '?' + s : ''; };
  if (a === 'surprise') return '#/mood';
  if (a === 'time' || a === 'timemachine') return '#/genres' + q({ decade: decadeOf(b || query.d || query.decade), t: query.t });
  if (a === 'world') return '#/collections' + q({ country: b });
  if (a === 'wrapped') return '#/diary' + q({ wrapped: 1, year: query.year, demo: query.demo });
  return null;
}

const decode = x => { try { return decodeURIComponent(x); } catch { return x; } };

export function parseHash(h = location.hash) {
  const raw = h.replace(/^#/, '') || '/';
  const [p, qs = ''] = raw.split('?');
  const path = p.replace(/\/+$/, '') || '/';
  const query = Object.fromEntries(new URLSearchParams(qs));
  const redirect = redirectOf(path, query);
  if (redirect) return { ...parseHash(redirect), redirect };
  for (const [pattern, load] of ROUTES) {
    const pp = pattern.split('/'), xs = path.split('/');
    if (pp.length !== xs.length) continue;
    const params = {};
    if (pp.every((p, i) => (p.startsWith(':') ? ((params[p.slice(1)] = decode(xs[i])), true) : p === xs[i]))) {
      return { path, pattern, params, query, load };
    }
  }
  return { path, pattern: null, params: {}, query, load: null };
}

/** navigate('#/title/movie/tt123') or navigate('/search?q=x', { replace: true }) */
export function navigate(to, { replace } = {}) {
  const h = to.startsWith('#') ? to : '#' + to;
  if (replace) { replacing = true; history.replaceState(history.state, '', h); window.dispatchEvent(new HashChangeEvent('hashchange')); }
  else location.hash = h;
}

/** Update the query string of the current route without adding history entries. */
export function setQuery(patch) {
  const r = parseHash();
  const q = new URLSearchParams({ ...r.query, ...patch });
  for (const [k, v] of [...q]) if (v === '' || v == null || v === 'undefined') q.delete(k);
  const s = q.toString();
  replacing = true;
  history.replaceState(history.state, '', `#${r.path}${s ? '?' + s : ''}`);
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

// ---- going back. Every history entry gets a number, so we know whether an in-app page is behind this one
// (history.length can't tell: it also counts whatever was open before the app) and can tell Back from a new page.
let idx = Number.isInteger(history.state && history.state.idx) ? history.state.idx : 0;
let lastNav = 'push', restoreY = 0, replacing = false, stopRestore = null;
const scrolls = new Map();
if (!history.state || history.state.idx !== idx) history.replaceState({ idx }, '');
if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
addEventListener('hashchange', () => {
  // The page being left is still on screen here (pages re-render after this listener), so this is where it was.
  // Remembering it once, on the way out, replaces a write on every scroll event.
  scrolls.set(idx, scrollY);
  if (replacing) { replacing = false; lastNav = 'replace'; return; }
  const s = history.state;
  if (s && Number.isInteger(s.idx)) { idx = s.idx; lastNav = 'pop'; restoreY = scrolls.get(idx) || 0; return; }
  idx += 1; lastNav = 'push'; history.replaceState({ idx }, '');
});

const INPUT = ['touchstart', 'wheel', 'keydown', 'pointerdown'];
/** After a route change: a new page starts at the top; Back returns to where you were, waiting for the content to load. */
export function settleScroll() {
  if (stopRestore) stopRestore();
  const y = lastNav === 'pop' ? restoreY : 0;
  const go = () => scrollTo({ top: y, behavior: 'instant' });
  go();
  if (!y) return;
  const start = Date.now();
  // Scroll again whenever the page grows (rows and images arriving) until it is tall enough to hold the spot.
  const check = () => {
    if (!stopRestore) return;
    if (Math.abs(scrollY - y) > 1) go();
    const t = Date.now() - start;
    if (t > 4000 || (t > 1200 && Math.abs(scrollY - y) <= 1)) stopRestore();
  };
  const el = document.getElementById('app') || document.documentElement;
  const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(check) : null;
  const timer = ro ? setTimeout(() => stopRestore && stopRestore(), 4000) : setInterval(check, 80); // old TV browsers
  if (ro) ro.observe(el);
  stopRestore = () => {
    if (ro) { ro.disconnect(); clearTimeout(timer); } else clearInterval(timer);
    for (const e of INPUT) removeEventListener(e, stopRestore);
    stopRestore = null;
  };
  for (const e of INPUT) addEventListener(e, stopRestore, { passive: true }); // the user took over
}

// The main tabs are places you go to, not places you come back from
const ROOTS = ['/', '/movies', '/shows', '/anime', '/search'];
export const hasBack = path => !ROOTS.includes(path);

// Opened directly, with nothing to go back to: the section this page belongs to
function parentOf(path) {
  const [, a, type, id] = path.split('/');
  if (a === 'watch') return /^(tt|kitsu)/.test(id || '') ? `#/title/${type}/${id}` : '#/';
  if (a === 'title') return /^kitsu/.test(id || '') ? '#/anime' : type === 'series' ? '#/shows' : '#/movies';
  return { person: '#/people', genre: '#/genres', collection: '#/collections' }[a] || '#/';
}

export const back = () => (idx > 0 ? history.back() : navigate(parentOf(parseHash().path), { replace: true }));
