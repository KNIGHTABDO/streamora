// Home: rotating riso hero, greeting, Continue Watching, and the shelves.
import { html, useState, useEffect, useMemo, useRef } from '../../vendor/preact-htm.js';
import { Page, Hero, Row, PosterCard, Btn, IconBtn, Icon, Reel, toast, useAsync, loadCSS, cx, hrefTitle, shuffle } from '../ui/components.js';
import { useStore, progress, hidden, history, watchlist, profiles, activeProfileId } from '../core/store.js';
import { continueWatching, hideFromContinue } from '../core/progress.js';
import { catalog, meta as getMeta, resolveTitle } from '../core/meta.js';
import { torrents } from '../core/rd.js';
import { parse } from '../core/parse.js';
import { navigate } from '../router.js';
import { playAction, inWatchlist, toggleWatchlist } from '../lib/play.js';

loadCSS('css/pages/home.css');

const YEAR = new Date().getFullYear();

function greeting(name) {
  const h = new Date().getHours();
  const n = name ? `, ${name}` : '';
  if (h < 5) return { hi: `Still up${n}?`, ask: 'Something 3AM-weird?', mood: 'yawn' };
  if (h < 12) return { hi: `Good morning${n}.`, ask: 'Coffee and a comedy?', mood: 'wave' };
  if (h < 17) return { hi: `Good afternoon${n}.`, ask: 'An adventure for the afternoon?', mood: 'happy' };
  if (h < 21) return { hi: `Good evening${n}.`, ask: 'Something cozy?', mood: 'popcorn' };
  return { hi: `Late night${n}.`, ask: 'One more episode?', mood: 'think' };
}

const SHORTCUTS = [
  { href: '#/mood', label: 'Mood Wheel', icon: 'wheel', color: 'var(--a1)' },
  { href: '#/surprise', label: 'Surprise Me', icon: 'dice', color: 'var(--a3)' },
  { href: '#/calendar', label: 'Calendar', icon: 'calendar', color: 'var(--a4)' },
  { href: '#/world', label: 'Around the World', icon: 'globe', color: 'var(--a2)' },
];

// ---------------------------------------------------------------- hero
function HeroCarousel({ items }) {
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const wl = useStore(watchlist);
  const n = items.length;
  useEffect(() => {
    if (paused || n < 2) return;
    const t = setTimeout(() => setI(x => (x + 1) % n), 8000);
    return () => clearTimeout(t);
  }, [i, paused, n]);
  const item = items[i % n];
  if (!item) return html`<${Hero} />`;
  const loved = inWatchlist(wl, item.id);
  const play = async () => {
    if (item.type !== 'series') return navigate(playAction(item).href);
    try { navigate(playAction(await getMeta(item.type, item.id)).href); }
    catch { navigate(hrefTitle(item)); }
  };
  return html`<div class="home-hero" onMouseEnter=${() => setPaused(true)} onMouseLeave=${() => setPaused(false)} onFocusIn=${() => setPaused(true)}>
    <div class="home-hero-slide" key=${item.id}>
      <${Hero} item=${item} kicker=${item.anime ? 'trending anime' : item.type === 'series' ? 'trending show' : 'trending now'} tall actions=${html`
        <${Btn} variant="primary" size="lg" icon="play" onClick=${play}>Play<//>
        <${Btn} size="lg" icon="info" href=${hrefTitle(item)}>More info<//>
        <${IconBtn} class="home-heart" icon=${loved ? 'heartFill' : 'heart'} label=${loved ? 'Remove from watchlist' : 'Add to watchlist'}
          onClick=${() => toast(toggleWatchlist(item) ? `Pinned “${item.name}” to your watchlist` : 'Removed from watchlist', { icon: 'heart' })} />`} />
    </div>
    ${n > 1 && html`<div class="home-dots" role="tablist" aria-label="Featured titles">
      ${items.map((it, k) => html`<button type="button" role="tab" aria-selected=${k === i} aria-label=${it.name} class=${cx('home-dot', k === i && 'on')} onClick=${() => setI(k)}>
        <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 2.6c4.3-.1 7.4 3.2 7.4 7.3 0 4.2-3.3 7.5-7.5 7.5C5.8 17.4 2.6 14 2.7 9.9 2.8 5.8 5.9 2.7 10 2.6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle class="home-dot-fill" cx="10" cy="10" r="5"/></svg>
      </button>`)}
    </div>`}
  </div>`;
}

// ---------------------------------------------------------------- continue watching
function ContinueRow() {
  const p = useStore(progress);
  const hid = useStore(hidden);
  const items = useMemo(() => continueWatching(p, hid), [p, hid]);
  if (!items.length) return null;
  const remove = it => {
    hideFromContinue(it.id);
    toast(html`Removed “${it.name}”. <button type="button" class="home-undo" onClick=${() => hidden.update(h => h.filter(x => x !== it.id))}>Undo</button>`, { icon: 'close', ms: 5000 });
  };
  const href = it => {
    const q = new URLSearchParams();
    if (it.play.videoId) q.set('v', it.play.videoId);
    if (it.play.t) q.set('t', Math.floor(it.play.t));
    const s = q.toString();
    return `#/watch/${it.type}/${encodeURIComponent(it.id)}${s ? '?' + s : ''}`;
  };
  return html`<${Row} title="Continue watching" kicker="right where you left off" icon="clock" wide items=${items}
    render=${it => html`<div class="home-cw" key=${it.id}>
      <${PosterCard} item=${it} wide href=${href(it)} pct=${it.upNext ? null : it.pct} label=${it.label || (it.pct ? `${Math.round(it.pct * 100)}% watched` : '')} onRemove=${remove} />
      <span class=${cx('home-pill type', it.upNext && 'next')}>${it.upNext ? 'up next' : 'resume'}</span>
    </div>`} />`;
}

// ---------------------------------------------------------------- because you watched
function BecauseRow({ kids }) {
  const h = useStore(history);
  const p = useStore(progress);
  const seed = useMemo(() => {
    const recent = Object.values(p).sort((a, b) => b.updated - a.updated)[0];
    return recent || h[0] || null;
  }, [p, h]);
  const q = useAsync(async () => {
    if (!seed || kids) return null;
    const m = await getMeta(seed.type, seed.id);
    const g = (m.genres || [])[0];
    if (!g) return null;
    const seen = new Set([...Object.keys(p), ...h.map(x => x.id)]);
    const list = m.anime ? await catalog('anime', 'kitsu-anime-popular', { genre: g }) : await catalog(m.type, 'top', { genre: g });
    return { name: seed.name, genre: g, items: list.filter(x => !seen.has(x.id)).slice(0, 20) };
  }, [seed && seed.id]);
  if (!q.data || !q.data.items.length) return null;
  return html`<${Row} title=${`Because you watched ${q.data.name}`} kicker=${`more ${q.data.genre.toLowerCase()}`} icon="sparkle" items=${q.data.items} />`;
}

// ---------------------------------------------------------------- your real-debrid (lightweight)
function RDRow() {
  const q = useAsync(async () => {
    const list = ((await torrents(1, 30)) || []).filter(t => t.status === 'downloaded');
    const seen = new Set(), picks = [];
    for (const t of list) {
      const info = parse(t.filename);
      const k = info.title.toLowerCase();
      if (!info.title || seen.has(k)) continue;
      seen.add(k); picks.push(info);
      if (picks.length >= 10) break;
    }
    const res = await Promise.allSettled(picks.map(i => resolveTitle(i.title, i.year, i.anime ? 'anime' : i.type)));
    const out = [], ids = new Set();
    for (const r of res) if (r.status === 'fulfilled' && r.value && !ids.has(r.value.id)) { ids.add(r.value.id); out.push(r.value); }
    return out;
  }, []);
  if (q.error || (q.data && !q.data.length)) return null;
  return html`<${Row} title="In your Real-Debrid" kicker="already unlocked" icon="cloud" items=${q.data} loading=${q.loading} href="#/myrd" />`;
}

function WatchlistRow() {
  const wl = useStore(watchlist);
  if (!wl.length) return null;
  return html`<${Row} title="From your watchlist" kicker="pinned for later" icon="heart" items=${wl.slice(0, 20)} href="#/watchlist" />`;
}

// ---------------------------------------------------------------- simple catalog row
function CatRow({ title, kicker, icon, type, id, opts, href, numbered, limit = 24, filter }) {
  const q = useAsync(() => catalog(type, id, opts), [type, id, JSON.stringify(opts)]);
  let items = q.data;
  if (items && filter) items = items.filter(filter);
  if (items) items = items.slice(0, numbered ? 10 : limit);
  return html`<${Row} title=${title} kicker=${kicker} icon=${icon} items=${items} loading=${q.loading} error=${q.error} href=${href} numbered=${numbered} />`;
}

// ---------------------------------------------------------------- page
export default function Home() {
  const list = useStore(profiles);
  const pid = useStore(activeProfileId);
  const profile = list.find(p => p.id === pid);
  const kids = !!(profile && profile.kids);
  const g = greeting(profile && profile.name);

  const heroQ = useAsync(async () => {
    if (kids) {
      const [a, b] = await Promise.allSettled([catalog('movie', 'top', { genre: 'Animation' }), catalog('movie', 'top', { genre: 'Family' })]);
      return shuffle([...(a.value || []).slice(0, 5), ...(b.value || []).slice(0, 3)]).filter(m => m.background).slice(0, 6);
    }
    const [m, s, a] = await Promise.allSettled([catalog('movie', 'top'), catalog('series', 'top'), catalog('anime', 'kitsu-anime-trending')]);
    const pick = (r, n) => (r.value || []).filter(x => x.background && x.description).slice(0, n);
    return shuffle([...pick(m, 3), ...pick(s, 2), ...pick(a, 1)]);
  }, [kids]);

  return html`<${Page} bleed class="home">
    <${HeroCarousel} items=${heroQ.data || []} />
    <div class="home-body">
      <section class="home-greet">
        <${Reel} mood=${g.mood} size=${92} />
        <div>
          <h2 class="home-hi">${g.hi}</h2>
          <p class="home-ask"><span class="mark">${g.ask}</span></p>
        </div>
        <nav class="home-stickers" aria-label="Discover">
          ${SHORTCUTS.map((s, k) => html`<a href=${s.href} class="home-sticker has-scribble" style=${`--st:${s.color};--rot:${[-4, 3, -2, 5][k]}deg`}>
            <${Icon} name=${s.icon} size=${26} /><span>${s.label}</span>
          </a>`)}
        </nav>
      </section>

      <${ContinueRow} />
      ${kids ? html`
        <${CatRow} title="Cartoons & animation" kicker="for small humans" icon="sparkle" type="movie" id="top" opts=${{ genre: 'Animation' }} href="#/genre/movie/Animation" />
        <${CatRow} title="Family movie night" icon="popcorn" type="movie" id="top" opts=${{ genre: 'Family' }} href="#/genre/movie/Family" />
        <${CatRow} title="Animated shows" icon="tv" type="series" id="top" opts=${{ genre: 'Animation' }} />
        <${CatRow} title="Family shows" icon="users" type="series" id="top" opts=${{ genre: 'Family' }} />
        <${CatRow} title="Anime for everyone" icon="anime" type="anime" id="kitsu-anime-popular" opts=${{ genre: 'Kids' }} />
        <${WatchlistRow} />
      ` : html`
        <${BecauseRow} kids=${kids} />
        <${CatRow} title="Top 10 today" kicker="the most watched" icon="trophy" type="movie" id="top" numbered />
        <${CatRow} title="Trending movies" kicker="the big screen" icon="film" type="movie" id="top" opts=${{ skip: 10 }} href="#/movies" />
        <${CatRow} title="Trending shows" kicker="binge material" icon="tv" type="series" id="top" href="#/shows" />
        <${CatRow} title="Top airing anime" kicker="this season" icon="anime" type="anime" id="kitsu-anime-airing" href="#/anime" />
        <${WatchlistRow} />
        <${CatRow} title=${`New in ${YEAR}`} kicker="fresh ink" icon="sparkle" type="movie" id="year" opts=${{ genre: YEAR }} />
        <${CatRow} title="Highest rated" kicker="critics & crowds agree" icon="starFill" type="movie" id="imdbRating" />
        <${RDRow} />
        <${CatRow} title="Edge-of-your-seat thrillers" icon="eye" type="movie" id="top" opts=${{ genre: 'Thriller' }} href="#/genre/movie/Thriller" />
        <${CatRow} title="Laugh out loud" icon="mask" type="series" id="top" opts=${{ genre: 'Comedy' }} href="#/genre/series/Comedy" />
        <${CatRow} title="Best-rated shows of all time" icon="crown" type="series" id="imdbRating" />
      `}
    </div>
  <//>`;
}
