// Streamora app shell: theme, gates (key → profile), navigation chrome, lazy pages.
import { html, render, useState, useEffect, useRef, useErrorBoundary } from '../vendor/preact-htm.js';
import { installSketch } from './ui/sketch.js';
import { Icon, Spinner, Toasts, ErrorNote, Btn, cx, toast } from './ui/components.js';
import { Avatar } from './ui/avatars.js';
import { useRoute, navigate, parseHash } from './router.js';
import { useStore, keyStore, profiles, activeProfileId, settings } from './core/store.js';
import { initFocus } from './ui/focus.js';
import { newEps, badgeCount, checkNewEpisodes, notifyNewEpisodes } from './lib/newEpisodes.js';
import { isIOS } from './player/engine.js';
import { isNative } from './player/native.js';

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
// the night-mode clock only ticks while night mode is on
let themeTimer = null;
function syncTheme() {
  applyTheme();
  const on = !!settings.get().nightAuto;
  if (on && !themeTimer) themeTimer = setInterval(applyTheme, 5 * 60e3);
  if (!on && themeTimer) { clearInterval(themeTimer); themeTimer = null; }
}
profiles.subscribe(syncTheme);
activeProfileId.subscribe(syncTheme);
settings.subscribe(syncTheme);
syncTheme();

// store.js fires this when localStorage is full
addEventListener('streamora:quota', () => toast('Storage is full, so that last change was not saved. Try clearing old history in Settings.', { kind: 'error', ms: 6000 }));

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
    { href: '#/mood', label: 'Mood Wheel', icon: 'wheel', note: 'spin a feeling, or let it pick' },
    { href: '#/calendar', label: 'Calendar', icon: 'calendar', note: 'new episodes', badge: 'newEps' },
    { href: '#/collections', label: 'Collections', icon: 'layers', note: 'franchises & world cinema' },
    { href: '#/genres', label: 'Genres', icon: 'tag', note: 'every shelf, every decade' },
  ] },
  { group: 'You', items: [
    { href: '#/watchlist', label: 'Watchlist', icon: 'heart', note: 'your pinboard' },
    { href: '#/diary', label: 'Diary', icon: 'book', note: 'log, stats, your year wrapped' },
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

function TopNav({ route, onMore, profile, moreOpen, badge }) {
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
      <button type="button" class="icon-btn nav-more" onClick=${onMore} aria-label=${badge ? `More sections, ${badge} new episodes` : 'More sections'} aria-expanded=${moreOpen} aria-controls="more-drawer" title="More"><${Icon} name="menu" />${badge > 0 && html`<span class="nav-badge" aria-hidden="true">${badge}</span>`}</button>
      ${profile && html`<a class="nav-avatar" href="#/profiles" aria-label=${`Profile: ${profile.name}`} title=${profile.name}><${Avatar} id=${profile.avatar} ink=${profile.ink} size=${38} /></a>`}
    </div>
  </header>`;
}

function TabBar({ route, onMore, moreOpen, badge }) {
  const items = [MAIN_NAV[0], MAIN_NAV[1], MAIN_NAV[2], MAIN_NAV[3], { href: '#/search', path: '/search', label: 'Search', icon: 'search' }];
  return html`<nav class="tabbar" aria-label="Main">
    ${items.map(n => html`<a href=${n.href} class=${cx('tabbar-item', route.path === n.path && 'active')} aria-current=${route.path === n.path ? 'page' : null}>
      <${Icon} name=${n.icon} size=${24} /><span>${n.label}</span>
    </a>`)}
    <button type="button" class="tabbar-item" onClick=${onMore} aria-expanded=${moreOpen} aria-controls="more-drawer"><${Icon} name="more" size=${24} /><span>More</span>${badge > 0 && html`<span class="nav-badge" aria-hidden="true">${badge}</span>`}</button>
  </nav>`;
}

function MoreDrawer({ open, onClose, badge }) {
  const ref = useRef();
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const on = e => e.key === 'Escape' && onClose();
    addEventListener('keydown', on);
    const f = ref.current && ref.current.querySelector('a[href], button');
    f && f.focus({ preventScroll: true });
    return () => { removeEventListener('keydown', on); prev && prev.isConnected && prev.focus && prev.focus({ preventScroll: true }); };
  }, [open]);
  // closed: inert keeps every link out of the tab order and away from screen readers
  return html`<div class=${cx('drawer-scrim', open && 'open')} onClick=${e => e.target === e.currentTarget && onClose()} aria-hidden=${!open} inert=${!open}>
    <aside class="drawer" id="more-drawer" aria-label="All sections" ref=${ref}>
      <div class="spread"><h2>Everything</h2><button type="button" class="icon-btn" onClick=${onClose} aria-label="Close" tabindex=${open ? 0 : -1}><${Icon} name="close" /></button></div>
      <div class="drawer-main">
        ${MAIN_NAV.map(n => html`<a href=${n.href} onClick=${onClose} class="drawer-pill" tabindex=${open ? 0 : -1}><${Icon} name=${n.icon} size=${20} />${n.label}</a>`)}
      </div>
      ${MORE_NAV.map(g => html`<section class="drawer-group">
        <div class="kicker type">${g.group}</div>
        ${g.items.map(i => { const n = i.badge === 'newEps' ? badge : 0; return html`<a href=${i.href} onClick=${onClose} class="drawer-item has-scribble" tabindex=${open ? 0 : -1}>
          <span class="drawer-icon"><${Icon} name=${i.icon} size=${24} />${n > 0 && html`<span class="nav-badge" aria-label=${`${n} new`}>${n}</span>`}</span>
          <span><b>${i.label}</b><small class="faint">${i.note}</small></span>
        </a>`; })}
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
  const full = route.path + '?' + new URLSearchParams(route.query);
  useEffect(() => { if (err) resetErr(); }, [full]);
  // after a path change, move focus to the new page (screen readers + TV remotes start at the top)
  const first = useRef(true);
  const ready = entry && entry.status;
  useEffect(() => {
    if (ready !== 'ok') return;
    if (first.current) { first.current = false; return; }
    const main = document.getElementById('main') || document.querySelector('main');
    if (main && !main.contains(document.activeElement)) { if (!main.hasAttribute('tabindex')) main.tabIndex = -1; main.focus({ preventScroll: true }); }
  }, [route.path, ready]);
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

  const q = new URLSearchParams(route.query).toString();
  const badge = badgeCount(useStore(newEps));
  useEffect(() => { scrollTo(0, 0); }, [route.path, q]);
  useEffect(() => { setMore(false); }, [route.path]);

  // gates: no key → welcome; no profile → profile picker
  const open = ['/welcome', '/import'].includes(route.path);
  // redirect by rewriting the URL quietly and rendering the target now (navigating mid-render got lost on fresh loads)
  const gate = !key.set && !open ? '#/welcome' : key.set && !profile && !open && route.path !== '/profiles' ? '#/profiles' : null;
  if (gate) { history.replaceState(null, '', gate); route = parseHash(gate); }
  else if (route.redirect) history.replaceState(null, '', route.redirect);

  const chromeless = ['/watch', '/welcome'].some(p => route.path.startsWith(p)) || (route.path === '/profiles' && !profile);
  return html`
    ${!chromeless && html`<${TopNav} route=${route} profile=${profile} onMore=${() => setMore(true)} moreOpen=${more} badge=${badge} />`}
    ${!chromeless && html`<${AppBanner} />`}
    <${PageHost} route=${route} />
    ${!chromeless && html`<${TabBar} route=${route} onMore=${() => setMore(true)} moreOpen=${more} badge=${badge} />`}
    ${!chromeless && html`<${MoreDrawer} open=${more} onClose=${() => setMore(false)} badge=${badge} />`}
    <${Toasts} />
  `;
}

// iPhone/iPad Safari can't play mkv, so point those users at the app (plays original files). Dismissed for good.
function AppBanner() {
  const [gone, setGone] = useState(() => { try { return !!localStorage.getItem('streamora:app-banner-off'); } catch { return false; } });
  const show = !gone && isIOS && !isNative();
  useEffect(() => { document.documentElement.classList.toggle('has-appbar', show); }, [show]);
  if (!show) return null;
  return html`<div class="appbar" role="status">
    <span>Better on iPhone & iPad: <a href="https://github.com/KNIGHTABDO/streamora/releases/latest" target="_blank" rel="noopener">install the Streamora app (.ipa)</a></span>
    <button type="button" aria-label="Dismiss" onClick=${() => { try { localStorage.setItem('streamora:app-banner-off', '1'); } catch {} setGone(true); }}><${Icon} name="close" size=${16} /></button>
  </div>`;
}

render(html`<${App} />`, document.getElementById('app'));

if ('serviceWorker' in navigator && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// after first paint: sync/Trakt bootstrapping, then the daily new-episode check (+ one notification if allowed)
setTimeout(() => {
  import('./core/integrations.js').catch(() => {});
  const episodes = () => { if (keyStore.get().set && activeProfileId.get()) checkNewEpisodes().then(notifyNewEpisodes).catch(() => {}); };
  episodes();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && episodes());
  activeProfileId.subscribe(episodes);
}, 1500);
