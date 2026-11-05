// Streamora app shell: theme, gates (Google → key → profile), navigation chrome, lazy pages.
import './lib/diag.js'; // first, so its error hooks see the modules below too
import { html, render, Component, useState, useEffect, useRef, useErrorBoundary } from '../vendor/preact-htm.js';
import { installSketch } from './ui/sketch.js';
import { Icon, Spinner, Toasts, ErrorNote, Btn, cx, toast } from './ui/components.js';
import { Avatar } from './ui/avatars.js';
import { useRoute, navigate, parseHash, back, hasBack, settleScroll } from './router.js';
import { useStore, keyStore, profiles, activeProfileId, settings, Away } from './core/store.js';
import { account } from './core/google.js';
import { initSync } from './core/sync.js';
import { initFocus } from './ui/focus.js';
import { newEps, badgeCount, checkNewEpisodes, notifyNewEpisodes } from './lib/newEpisodes.js';
import { checkForUpdate } from './lib/update.js';
import { isIOS } from './player/engine.js';
import { isNative } from './player/native.js';

// WKWebView loads the live site: keep quick taps from zooming or selecting the app UI.
// Browser visitors keep pinch zoom for accessibility.
if (window.Capacitor?.isNativePlatform?.()) {
  const viewport = document.querySelector('meta[name="viewport"]');
  if (viewport) viewport.content += ', maximum-scale=1, user-scalable=no';
  document.addEventListener('gesturestart', e => e.preventDefault(), { passive: false });
  document.documentElement.classList.add('native-app');
}

installSketch();
initFocus();

// small CSS for the shell's own strips (offline, update notice), injected here so no page file owns them
document.head.append(Object.assign(document.createElement('style'), { textContent: `
.shell-offline { position: fixed; z-index: 48; left: 50%; top: calc(var(--nav-h) + var(--safe-t) + var(--appbar-h, 0px) + 8px);
  transform: translateX(-50%) rotate(-.5deg); max-width: calc(100vw - 32px); display: flex; align-items: center; gap: 8px; padding: 6px 16px;
  background: var(--paper-3); color: var(--ink); font: 17px/1.2 var(--font-hand); border: 2px solid var(--line);
  border-radius: 14px 6px 16px 5px / 6px 15px 5px 14px; box-shadow: var(--shadow); }
.shell-update { position: fixed; z-index: 200; left: 50%; transform: translateX(-50%); bottom: calc(var(--tab-h) + var(--safe-b) + 14px); max-width: calc(100vw - 32px); width: max-content; }
@media (min-width: 761px) { .shell-update { bottom: 28px; } }
.shell-update .toast a { display: inline-flex; align-items: center; min-height: 44px; color: var(--a1); font-weight: 600; }
.shell-update .toast button { display: grid; place-items: center; width: 44px; height: 44px; margin: -12px -14px -12px 0; background: none; border: 0; color: var(--ink-2); cursor: pointer; }
` }));

// "You're offline" strip: the app still works on what's saved, so say so
function Offline() {
  const [off, setOff] = useState(() => navigator.onLine === false);
  useEffect(() => {
    const on = () => setOff(false), down = () => setOff(true);
    addEventListener('online', on);
    addEventListener('offline', down);
    return () => { removeEventListener('online', on); removeEventListener('offline', down); };
  }, []);
  return off ? html`<div class="shell-offline" role="status"><${Icon} name="warn" size=${18} /><span>You're offline: showing what's saved</span></div>` : null;
}

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
  // the intro and the landing own the status-bar colour while they're up
  if (meta && el.dataset.surface !== 'landing' && !el.hasAttribute('data-intro')) meta.content = getComputedStyle(el).getPropertyValue('--paper').trim() || '#f3e6cf';
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
addEventListener('streamora:chrome', applyTheme);

// store.js fires this when localStorage is full
addEventListener('streamora:quota', () => toast('Storage is full, so that last change was not saved. Try clearing old history in Settings.', { kind: 'error', ms: 6000 }));

// ------------------------------------------------------------ nav model
export const MAIN_NAV = [
  { href: '#/', path: '/', label: 'Home', icon: 'home' },
  { href: '#/movies', path: '/movies', label: 'Movies', icon: 'film' },
  { href: '#/shows', path: '/shows', label: 'Shows', icon: 'tv' },
  { href: '#/anime', path: '/anime', label: 'Anime', icon: 'anime' },
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
    { href: '#/settings', label: 'Settings', icon: 'gear', note: 'account, player, look' },
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
  const showBack = hasBack(route.path);
  return html`<header class=${cx('topnav', scrolled && 'scrolled', showBack && 'has-back')}>
    ${showBack && html`<button type="button" class="icon-btn nav-back" onClick=${back} aria-label="Go back" title="Back"><${Icon} name="back" /></button>`}
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
// Home stays mounted (hidden and inert) while a title or player opened from it is on screen, so Back shows it
// instantly at the same place instead of rebuilding every shelf. Any other page lets it go.
const KEEP_HOME_FOR = ['/title/:type/:id', '/watch/:type/:id'];
class KeptHome extends Component {
  // The page element is made once per query, so hiding and showing it never re-renders the shelves, and store
  // changes while it is hidden (progress saves during playback) wait until it comes back.
  constructor() { super(); this.away = { hidden: false, later: new Map() }; }
  shouldComponentUpdate(next) { return next.away !== this.props.away || next.query !== this.props.query; }
  componentDidUpdate() {
    if (this.props.away || !this.away.later.size) return;
    const later = [...this.away.later]; this.away.later.clear();
    later.forEach(([set, s]) => set(s.get()));
  }
  render({ Comp, query, away }) {
    this.away.hidden = away;
    if (!this.page || this.query !== query) { this.query = query; this.page = html`<${Comp} params=${{}} query=${query} />`; }
    return html`<div class="page-enter" data-kept hidden=${away} inert=${away}><${Away.Provider} value=${this.away}>${this.page}<//></div>`;
  }
}
function PageHost({ route }) {
  const [, force] = useState(0);
  const [retry, setRetry] = useState(0);
  const [err, resetErr] = useErrorBoundary();
  const key = route.pattern;
  const entry = pageCache.get(key);
  useEffect(() => {
    if (!route.load || pageCache.get(key)) return;
    const e = { status: 'loading' };
    pageCache.set(key, e);
    route.load().then(m => { e.status = 'ok'; e.Comp = m.default; force(x => x + 1); },
      error => { e.status = 'error'; e.error = error; force(x => x + 1); });
  }, [key, retry]);
  const full = route.path + '?' + new URLSearchParams(route.query);
  useEffect(() => { if (err) resetErr(); }, [full]);

  const onHome = key === '/';
  const kept = useRef(null);     // { query } of the Home being kept
  const homeFocus = useRef(null); // what had focus on Home when it was hidden (TV remotes come back to it)
  const homeQs = new URLSearchParams(route.query).toString();
  if (err) kept.current = null;
  else if (onHome) { if (!kept.current || kept.current.qs !== homeQs) kept.current = { qs: homeQs, query: route.query }; }
  else if (!KEEP_HOME_FOR.includes(key)) kept.current = null;
  else if (kept.current && !kept.current.away) {
    kept.current.away = true;
    const a = document.activeElement;
    homeFocus.current = a && a !== document.body && a.closest && a.closest('[data-kept]') ? a : null;
  }
  if (kept.current && onHome) kept.current.away = false;
  const homeEntry = pageCache.get('/');
  const keep = kept.current && homeEntry && homeEntry.status === 'ok' ? kept.current : null;

  // after a path change, move focus to the new page (screen readers + TV remotes start at the top)
  const first = useRef(true);
  const shown = useRef(null);
  const ready = entry && entry.status;
  useEffect(() => {
    if (ready !== 'ok') return;
    if (first.current) { first.current = false; return; }
    const back = onHome && homeFocus.current;
    homeFocus.current = null;
    if (back && back.isConnected) { back.focus({ preventScroll: true }); return; }
    const box = shown.current || document;
    const main = box.querySelector('main');
    if (main && !main.contains(document.activeElement)) { if (!main.hasAttribute('tabindex')) main.tabIndex = -1; main.focus({ preventScroll: true }); }
  }, [route.path, ready]);

  let page;
  if (err) page = html`<main class="page"><${ErrorNote} error=${err} retry=${() => { resetErr(); }} /></main>`;
  else if (!route.load) page = html`<main class="page center-fill"><div class="empty"><h2>This page fell out of the sketchbook.</h2><${Btn} href="#/" icon="home">Go home<//></div></main>`;
  else if (!entry || entry.status === 'loading') page = html`<main class="page center-fill"><${Spinner} /></main>`;
  else if (entry.status === 'error') page = html`<main class="page"><${ErrorNote} error=${entry.error} retry=${() => { pageCache.delete(key); setRetry(x => x + 1); }} /></main>`;
  else if (!(onHome && keep)) { const Comp = entry.Comp; page = html`<${Comp} params=${route.params} query=${route.query} />`; }
  // Always the same two slots, so the kept Home is never remounted when the page next to it changes.
  return html`${keep ? html`<${KeptHome} key="home" Comp=${homeEntry.Comp} query=${keep.query} away=${!onHome} />` : null}${
    page ? html`<div class="page-enter" key=${route.path} ref=${shown}>${page}</div>` : null}`;
}

// ------------------------------------------------------------ first Drive round
// Drive sync starts before the first render. Signed in but missing the key or a profile on this device (fresh
// install, cleared storage, a key this browser can't decrypt), the app waits for Drive's copy behind one loading
// screen instead of flashing Welcome, then a spinner, then Home. Never longer than WAIT.
const WAIT = 8000;
const firstSync = initSync().catch(() => {});
const needsDrive = () => !!account.get() && !(keyStore.get().set && profiles.get().some(p => p.id === activeProfileId.get()));
function useDriveSettled() {
  const [settled, setSettled] = useState(() => !needsDrive());
  useEffect(() => {
    if (settled) return;
    const done = () => setSettled(true);
    const t = setTimeout(done, WAIT);
    firstSync.then(done);
    return () => clearTimeout(t);
  }, []);
  return settled;
}

// ------------------------------------------------------------ app
function App() {
  let route = useRoute();
  const key = useStore(keyStore);
  const google = useStore(account);
  const list = useStore(profiles);
  const activeId = useStore(activeProfileId);
  const [more, setMore] = useState(false);
  const profile = list.find(p => p.id === activeId);
  const settled = useDriveSettled();

  const q = new URLSearchParams(route.query).toString();
  const badge = badgeCount(useStore(newEps));
  useEffect(settleScroll, [route.path, q]);
  useEffect(() => { setMore(false); }, [route.path]);

  // gates: not signed in to Google (everything lives in Drive) or no key → welcome; no profile → profile picker
  const open = route.path === '/welcome';
  const ready = google && key.set;
  // redirect by rewriting the URL quietly and rendering the target now (navigating mid-render got lost on fresh loads)
  // signed out on a browser, the public landing page is the front door: it needs no page load, Back returns to it
  const boot = window.__streamora;
  const toLanding = !google && !open && !!boot && boot.mayLand();
  useEffect(() => { if (boot) toLanding ? boot.showLanding() : boot.showApp(); }, [toLanding]);
  // first launch on this device: hold one loading screen (keeping the URL) until Drive's key and profiles arrive
  const hold = !settled && google && !open;
  const gate = toLanding || hold ? null : !ready && !open ? '#/welcome' : ready && !profile && !open && route.path !== '/profiles' ? '#/profiles' : null;
  if (gate) { history.replaceState(history.state, '', gate); route = parseHash(gate); }
  else if (route.redirect) history.replaceState(history.state, '', route.redirect);

  // in the app, swipe in from the left edge to go back like any iOS app (Safari already does this itself)
  useEffect(() => {
    if (!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())) return;
    let from = null;
    const start = e => { const t = e.touches[0]; from = t.clientX < 24 ? { x: t.clientX, y: t.clientY } : null; };
    const end = e => {
      const t = e.changedTouches[0], s = from; from = null;
      if (!s || document.querySelector('.modal-scrim, .drawer-scrim.open')) return;
      const dx = t.clientX - s.x, dy = Math.abs(t.clientY - s.y), p = parseHash().path;
      if (dx > 70 && dx > dy * 1.5 && hasBack(p) && !p.startsWith('/watch/')) back();
    };
    addEventListener('touchstart', start, { passive: true });
    addEventListener('touchend', end, { passive: true });
    return () => { removeEventListener('touchstart', start); removeEventListener('touchend', end); };
  }, []);

  if (hold) return html`<main class="page center-fill shell-boot"><${Spinner} label="Getting your things from Drive…" /></main>`;
  const chromeless = route.path.startsWith('/watch/') || route.path === '/welcome' || (route.path === '/profiles' && !profile);
  if (toLanding) return html`<${Toasts} />`;
  return html`
    <${Offline} />
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
requestAnimationFrame(() => requestAnimationFrame(() => window.__streamora && window.__streamora.markMounted()));

if ('serviceWorker' in navigator && !['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}

// Trakt and the daily new-episode check start after first paint
setTimeout(() => {
  import('./core/trakt.js').then(m => m.initTrakt()).catch(() => {});
  checkForUpdate().catch(() => {});
  const episodes = () => { if (keyStore.get().set && activeProfileId.get()) checkNewEpisodes().then(notifyNewEpisodes).catch(() => {}); };
  episodes();
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && episodes());
  activeProfileId.subscribe(episodes);
}, 1500);
