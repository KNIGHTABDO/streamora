// Streamora app shell: theme, gates (key → profile), navigation chrome, lazy pages.
import { html, render, useState, useEffect, useErrorBoundary } from '../vendor/preact-htm.js';
import { installSketch } from './ui/sketch.js';
import { Icon, Spinner, Toasts, ErrorNote, Btn, cx } from './ui/components.js';
import { Avatar } from './ui/avatars.js';
import { useRoute, navigate, parseHash } from './router.js';
import { useStore, keyStore, profiles, activeProfileId, settings } from './core/store.js';
import { initFocus } from './ui/focus.js';

installSketch();
initFocus();

// ------------------------------------------------------------ theme
export function applyTheme() {
  const p = profiles.get().find(x => x.id === activeProfileId.get());
  const s = settings.get();
  const h = new Date().getHours();
  const night = s.nightAuto && (h >= 19 || h < 6);
  const theme = night ? 'blueprint' : (p && p.theme) || 'ink';
  const el = document.documentElement;
  el.dataset.theme = theme;
  el.dataset.motion = s.reduceMotion ? 'reduce' : '';
  if (p && p.ink) el.style.setProperty('--profile-ink', p.ink);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = getComputedStyle(el).getPropertyValue('--paper').trim() || '#f3e6cf';
}
profiles.subscribe(applyTheme);
activeProfileId.subscribe(applyTheme);
settings.subscribe(applyTheme);
setInterval(applyTheme, 5 * 60e3);
applyTheme();

// ------------------------------------------------------------ nav model
export const MAIN_NAV = [
  { href: '#/', path: '/', label: 'Home', icon: 'home' },
  { href: '#/movies', path: '/movies', label: 'Movies', icon: 'film' },
  { href: '#/shows', path: '/shows', label: 'Shows', icon: 'tv' },
  { href: '#/anime', path: '/anime', label: 'Anime', icon: 'anime' },
  { href: '#/myrd', path: '/myrd', label: 'My RD', icon: 'cloud' },
];
export const MORE_NAV = [
  { group: 'Discover', items: [
    { href: '#/mood', label: 'Mood Wheel', icon: 'wheel', note: 'spin for a feeling' },
    { href: '#/surprise', label: 'Surprise Me', icon: 'dice', note: 'scratch a random pick' },
    { href: '#/calendar', label: 'Calendar', icon: 'calendar', note: 'new episodes' },
    { href: '#/world', label: 'Around the World', icon: 'globe', note: 'cinema by country' },
    { href: '#/time', label: 'Time Machine', icon: 'hourglass', note: '1920s → now' },
    { href: '#/collections', label: 'Collections', icon: 'layers', note: 'franchises in order' },
    { href: '#/genres', label: 'Genres', icon: 'tag', note: 'every shelf' },
    { href: '#/people', label: 'People', icon: 'person', note: 'actors & directors' },
  ] },
  { group: 'You', items: [
    { href: '#/watchlist', label: 'Watchlist', icon: 'heart', note: 'your pinboard' },
    { href: '#/diary', label: 'Diary', icon: 'book', note: 'log, stars, stats' },
    { href: '#/wrapped', label: 'Year in Review', icon: 'trophy', note: 'your year, drawn' },
  ] },
  { group: 'Tools', items: [
    { href: '#/add', label: 'Add magnet / link', icon: 'magnet', note: 'paste & play' },
    { href: '#/profiles', label: 'Profiles', icon: 'users', note: 'switch who\'s watching' },
    { href: '#/settings', label: 'Settings', icon: 'gear', note: 'key, player, backup' },
  ] },
];

function Logo() {
  return html`<a class="logo" href="#/" aria-label="Streamora home">
    <svg class="logo-reel" viewBox="0 0 40 40" aria-hidden="true">
      <circle cx="20" cy="20" r="16" fill="var(--a3)" stroke="var(--line)" stroke-width="2.6"/>
      <circle cx="20" cy="11.5" r="3.4" fill="var(--line)"/><circle cx="12.5" cy="23.5" r="3.4" fill="var(--line)"/><circle cx="27.5" cy="23.5" r="3.4" fill="var(--line)"/>
      <circle cx="20" cy="20" r="1.8" fill="var(--line)"/>
    </svg>
    <span class="logo-word display">Streamora</span>
  </a>`;
}

function TopNav({ route, onMore, profile }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(scrollY > 30);
    addEventListener('scroll', on, { passive: true });
    return () => removeEventListener('scroll', on);
  }, []);
  return html`<header class=${cx('topnav', scrolled && 'scrolled')}>
    <${Logo} />
    <nav class="topnav-links" aria-label="Main">
      ${MAIN_NAV.map(n => html`<a href=${n.href} class=${cx('topnav-link', route.path === n.path && 'active')} aria-current=${route.path === n.path ? 'page' : null}>${n.label}</a>`)}
    </nav>
    <div class="topnav-tools">
      <a class="icon-btn" href="#/search" aria-label="Search" title="Search"><${Icon} name="search" /></a>
      <button type="button" class="icon-btn" onClick=${onMore} aria-label="More sections" title="More"><${Icon} name="menu" /></button>
      ${profile && html`<a class="nav-avatar" href="#/profiles" aria-label=${`Profile: ${profile.name}`} title=${profile.name}><${Avatar} id=${profile.avatar} ink=${profile.ink} size=${38} /></a>`}
    </div>
  </header>`;
}

function TabBar({ route, onMore }) {
  const items = [MAIN_NAV[0], MAIN_NAV[1], MAIN_NAV[2], MAIN_NAV[3], { href: '#/search', path: '/search', label: 'Search', icon: 'search' }];
  return html`<nav class="tabbar" aria-label="Main">
    ${items.map(n => html`<a href=${n.href} class=${cx('tabbar-item', route.path === n.path && 'active')} aria-current=${route.path === n.path ? 'page' : null}>
      <${Icon} name=${n.icon} size=${24} /><span>${n.label}</span>
    </a>`)}
    <button type="button" class="tabbar-item" onClick=${onMore}><${Icon} name="more" size=${24} /><span>More</span></button>
  </nav>`;
}

function MoreDrawer({ open, onClose }) {
  useEffect(() => {
    if (!open) return;
    const on = e => e.key === 'Escape' && onClose();
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [open]);
  return html`<div class=${cx('drawer-scrim', open && 'open')} onClick=${e => e.target === e.currentTarget && onClose()} aria-hidden=${!open}>
    <aside class="drawer" aria-label="All sections">
      <div class="spread"><h2>Everything</h2><button type="button" class="icon-btn" onClick=${onClose} aria-label="Close"><${Icon} name="close" /></button></div>
      <div class="drawer-main">
        ${MAIN_NAV.map(n => html`<a href=${n.href} onClick=${onClose} class="drawer-pill"><${Icon} name=${n.icon} size=${20} />${n.label}</a>`)}
      </div>
      ${MORE_NAV.map(g => html`<section class="drawer-group">
        <div class="kicker type">${g.group}</div>
        ${g.items.map(i => html`<a href=${i.href} onClick=${onClose} class="drawer-item has-scribble" tabindex=${open ? 0 : -1}>
          <span class="drawer-icon"><${Icon} name=${i.icon} size=${24} /></span>
          <span><b>${i.label}</b><small class="faint">${i.note}</small></span>
        </a>`)}
      </section>`)}
    </aside>
  </div>`;
}

// ------------------------------------------------------------ lazy page host
const pageCache = new Map();
function PageHost({ route }) {
  const [, force] = useState(0);
  const [err, resetErr] = useErrorBoundary();
  const key = route.pattern;
  const entry = pageCache.get(key);
  useEffect(() => {
    if (!route.load || pageCache.get(key)) return;
    const e = { status: 'loading' };
    pageCache.set(key, e);
    route.load().then(m => { e.status = 'ok'; e.Comp = m.default; force(x => x + 1); },
      error => { e.status = 'error'; e.error = error; force(x => x + 1); });
  }, [key]);
  useEffect(() => { if (err) resetErr(); }, [route.path]);
  if (err) return html`<main class="page"><${ErrorNote} error=${err} retry=${() => { resetErr(); }} /></main>`;
  if (!route.load) return html`<main class="page center-fill"><div class="empty"><h2>This page fell out of the sketchbook.</h2><${Btn} href="#/" icon="home">Go home<//></div></main>`;
  if (!entry || entry.status === 'loading') return html`<main class="page center-fill"><${Spinner} /></main>`;
  if (entry.status === 'error') return html`<main class="page"><${ErrorNote} error=${entry.error} retry=${() => { pageCache.delete(key); force(x => x + 1); }} /></main>`;
  const Comp = entry.Comp;
  return html`<div class="page-enter" key=${route.path}><${Comp} params=${route.params} query=${route.query} /></div>`;
}

// ------------------------------------------------------------ app
function App() {
  let route = useRoute();
  const key = useStore(keyStore);
  const list = useStore(profiles);
  const activeId = useStore(activeProfileId);
  const [more, setMore] = useState(false);
  const profile = list.find(p => p.id === activeId);

  useEffect(() => { scrollTo(0, 0); setMore(false); }, [route.path]);

  // gates: no key → welcome; no profile → profile picker
  const open = ['/welcome', '/import'].includes(route.path);
  // redirect by rewriting the URL quietly and rendering the target now (navigating mid-render got lost on fresh loads)
  const gate = !key.set && !open ? '#/welcome' : key.set && !profile && !open && route.path !== '/profiles' ? '#/profiles' : null;
  if (gate) { history.replaceState(null, '', gate); route = parseHash(gate); }

  const chromeless = ['/watch', '/welcome'].some(p => route.path.startsWith(p)) || (route.path === '/profiles' && !profile);
  return html`
    ${!chromeless && html`<${TopNav} route=${route} profile=${profile} onMore=${() => setMore(true)} />`}
    <${PageHost} route=${route} />
    ${!chromeless && html`<${TabBar} route=${route} onMore=${() => setMore(true)} />`}
    ${!chromeless && html`<${MoreDrawer} open=${more} onClose=${() => setMore(false)} />`}
    <${Toasts} />
  `;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && location.hostname !== 'localhost') {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
