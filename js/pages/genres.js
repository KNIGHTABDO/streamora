// #/genres: a wall of die-cut genre stickers, plus a decade dial (?decade=1990&t=series, the old Time Machine).  #/genre/{type}/{genre}: that shelf as a grid.
import { html, useRef, useMemo, useEffect } from '../../vendor/preact-htm.js';
import { Page, Grid, usePaged, useAsync, Tabs, Chip, Toggle, Empty, Btn, ErrorNote, SectionTitle, loadCSS, Icon, cx } from '../ui/components.js';
import { registerIcons } from '../ui/icons.js';
import { tiltOf, hash } from '../ui/sketch.js';
import { catalog, search, MOVIE_GENRES, SERIES_GENRES, ANIME_GENRES } from '../core/meta.js';
import { useStore, history, progress, diary } from '../core/store.js';
import { fetchShelf } from './browse/shelf.js';
import { setQuery } from '../router.js';

loadCSS('css/pages/genres.css');

registerIcons({
  rocket: { d: 'M12.1 3.1c3.6 2.4 5.2 6.4 4.6 11.3l-2.2 2.3H9.6l-2.2-2.3C6.8 9.5 8.4 5.5 12.1 3.1zM12 8.1c1 0 1.8.8 1.8 1.8 0 1-.8 1.8-1.8 1.8-1 0-1.8-.8-1.8-1.8 0-1 .8-1.8 1.8-1.8zM7.4 14.3l-3 2.9 3.6.4M16.7 14.4l2.9 2.8-3.5.5M10.3 17.2l-.6 3.9 2.3-1.6 2.4 1.6-.7-3.9', fill: 'M9.6 16.7h4.9l-.4 1.6H10z' },
  note: { d: 'M9.1 17.6c0 1.6-1.4 2.9-3.1 2.9-1.6 0-2.8-1.1-2.8-2.5 0-1.6 1.4-2.9 3.1-2.9 1.6 0 2.8 1.1 2.8 2.5zM9.1 17.6V5.4l11.4-2.2v11.9M20.5 15.1c0 1.6-1.4 2.9-3.1 2.9-1.6 0-2.8-1.1-2.8-2.5 0-1.6 1.4-2.9 3.1-2.9 1.6 0 2.8 1.1 2.8 2.5zM9.1 9.1l11.4-2.2', fill: 'M3.3 17.9c0-1.5 1.3-2.8 2.9-2.8 1.5 0 2.8 1.1 2.8 2.6z' },
  skull: { d: 'M12 3.2c4.6 0 8 3.2 7.9 7.6 0 2.6-1.2 4.3-2.8 5.2l.1 3.9H6.8l.1-3.9C5.2 15.1 4 13.4 4.1 10.8 4.1 6.4 7.5 3.2 12 3.2zM8.8 10.4c1 0 1.8.8 1.8 1.8s-.8 1.8-1.8 1.8S7 13.2 7 12.2s.8-1.8 1.8-1.8zM15.2 10.4c1 0 1.8.8 1.8 1.8s-.8 1.8-1.8 1.8-1.8-.8-1.8-1.8.8-1.8 1.8-1.8zM10.1 17.2v2.8M13.9 17.2v2.8M11.3 15.2l.7-1.3.8 1.3' },
  laugh: { d: 'M12 3.2c4.9 0 8.9 4 8.8 8.9 0 4.9-4 8.8-8.9 8.8-4.8 0-8.8-4-8.7-8.9C3.3 7.1 7.2 3.2 12 3.2zM7.4 9.9l2.2 1.1-2.2 1.2M16.6 9.9l-2.2 1.1 2.2 1.2M7.3 14.4c2.8 3.6 6.6 3.6 9.4 0z', fill: 'M7.3 14.4c2.8 3.6 6.6 3.6 9.4 0z', fillColor: 'var(--a1)' },
  sword: { d: 'M19.9 4.1l-.4 3.6-9.8 9.8-3.2-3.2 9.8-9.8zM5.3 12.9l5.8 5.8M7.6 16.4l-3.4 3.4M3.5 19.2l1.3 1.3' },
  ball: { d: 'M12 3.2c4.9 0 8.9 4 8.8 8.9 0 4.9-4 8.8-8.9 8.8-4.8 0-8.8-4-8.7-8.9C3.3 7.1 7.2 3.2 12 3.2zM12 7.9l3.4 2.5-1.3 4h-4.2l-1.3-4zM12 3.3v4.6M15.4 10.4l4.7-1.6M14.1 14.4l2.9 4.1M9.9 14.4l-2.9 4.1M8.6 10.4 3.9 8.8', fill: 'M12 7.9l3.4 2.5-1.3 4h-4.2l-1.3-4z', fillColor: 'var(--line)' },
  ghostie: { d: 'M5.6 20.2V10.6c0-3.9 2.8-6.9 6.4-6.9s6.4 3 6.4 6.9v9.6l-2.1-1.7-2.1 1.7-2.2-1.7-2.1 1.7-2.2-1.7zM9.6 10.2v1.4M14.4 10.2v1.4M10.6 14.6c.9.6 1.9.6 2.8 0' },
  cowboy: { d: 'M3.3 14.6c2.9 1.8 14.5 1.8 17.4 0M6.9 14.5l.8-7.2c.2-1.6 1.4-2.4 2.6-1.8l1.7.9 1.7-.9c1.2-.6 2.4.2 2.6 1.8l.8 7.2M7.4 11.6c3 .9 6.2.9 9.2 0', fill: 'M7.4 11.6c3 .9 6.2.9 9.2 0l.3 2.9c-3.3.7-6.5.7-9.8 0z', fillColor: 'var(--a1)' },
  heartbeat: { d: 'M2.9 12.3h4.2l1.9-4.6 3.2 9.4 2.4-7.1 1.6 2.3h4.9' },
});

const years = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));

// Special shelves: title, type, icon and a list of page fetchers (called in order by the grid).
const chunk = (arr, n) => arr.reduce((o, x, i) => (i % n ? o[o.length - 1].push(x) : o.push([x]), o), []);
const yearPages = (type, ys, filter) => chunk(ys, 3).map(g => () =>
  Promise.all(g.map(y => catalog(type, 'year', { genre: y }).catch(() => [])))
    .then(ls => ls.flat().filter(filter || (() => true)).sort((a, b) => (+b.imdbRating || 0) - (+a.imdbRating || 0))));
const searchPages = (type, ...qs) => qs.map(q => () => search(q, type));

export const SPECIALS = {
  'stand-up': { label: 'Stand-up', type: 'movie', icon: 'mic', pages: searchPages('movie', 'stand-up', 'comedy special', 'live at') },
  musicals: { label: 'Musicals', type: 'movie', icon: 'note', pages: searchPages('movie', 'musical', 'the musical', 'broadway') },
  shorts: { label: 'Short films', type: 'movie', icon: 'clock', pages: searchPages('movie', 'short film', 'pixar short', 'short') },
  classics: { label: 'Classics', type: 'movie', icon: 'hourglass', pages: yearPages('movie', years(1950, 1979)) },
  noir: { label: 'Film noir', type: 'movie', icon: 'moon', pages: yearPages('movie', years(1940, 1958), m => (m.genres || []).some(g => /crime|mystery|thriller|film-noir/i.test(g))) },
};

const ICON_FOR = {
  Action: 'sword', Adventure: 'globe', Animation: 'pencil', Biography: 'person', Comedy: 'laugh', Crime: 'mask', Documentary: 'camera',
  Drama: 'mask', Family: 'users', Fantasy: 'wand', History: 'book', Horror: 'skull', Mystery: 'search', Romance: 'heart', 'Sci-Fi': 'rocket',
  Sport: 'ball', Sports: 'ball', Thriller: 'heartbeat', War: 'warn', Western: 'cowboy', 'Reality-TV': 'camera', 'Talk-Show': 'mic', 'Game-Show': 'dice',
  Magic: 'wand', Supernatural: 'ghostie', 'Slice of Life': 'sun', Psychological: 'eye', Mecha: 'gear', Music: 'note', School: 'book', Historical: 'hourglass',
  Military: 'warn', Samurai: 'sword', Cooking: 'popcorn', Friendship: 'users',
};

const GROUPS = [
  { title: 'Movies', kicker: 'the big screen', type: 'movie', items: [...MOVIE_GENRES.map(g => ({ id: g, label: g })), ...Object.entries(SPECIALS).map(([id, s]) => ({ id, label: s.label, icon: s.icon, special: true }))] },
  { title: 'Shows', kicker: 'binge-able', type: 'series', items: SERIES_GENRES.map(g => ({ id: g, label: g })) },
  { title: 'Anime', kicker: 'from the other side of the world', type: 'anime', items: ANIME_GENRES.map(g => ({ id: g, label: g })) },
];

const FILLS = ['var(--a3)', 'var(--a4)', 'var(--a1)', 'var(--fill-2)', 'var(--a2)', 'var(--fill-1)', 'var(--fill-3)', 'var(--fill-4)'];

function Sticker({ type, item }) {
  const h = hash(type + item.id);
  const style = `--tilt:${tiltOf(type + item.id, 5).toFixed(1)}deg;--st:${FILLS[h % FILLS.length]};--sz:${[1, 1.12, .94, 1.05][h % 4]}`;
  return html`<a class=${cx('sticker', item.special && 'special', `shape-${h % 3}`)} style=${style} href=${`#/genre/${type}/${encodeURIComponent(item.id)}`}>
    <span class="sticker-icon"><${Icon} name=${item.icon || ICON_FOR[item.id] || 'tag'} size=${30} /></span>
    <span class="sticker-label">${item.label}</span>
    ${item.special && html`<span class="sticker-star type">special</span>`}
  </a>`;
}

// ---- decades (was the Time Machine)
const NOW = new Date().getFullYear();
const DECADES = Array.from({ length: (Math.floor(NOW / 10) * 10 - 1920) / 10 + 1 }, (_, i) => 1920 + i * 10);
const BLURBS = {
  1920: 'silent stars', 1930: 'talkies', 1940: 'noir shadows', 1950: 'technicolor', 1960: 'new waves',
  1970: 'new hollywood', 1980: 'neon & synths', 1990: 'indie boom', 2000: 'franchise dawn', 2010: 'streaming era', 2020: 'right now',
};
async function decadeTop(type, decade) {
  const ys = Array.from({ length: 10 }, (_, i) => decade + i).filter(y => y <= NOW);
  const res = await Promise.allSettled(ys.map(y => catalog(type, 'year', { genre: y })));
  return res.flatMap(r => (r.status === 'fulfilled' ? r.value.slice(0, 14) : []))
    .filter(m => m.poster).sort((a, b) => (parseFloat(b.imdbRating) || 0) - (parseFloat(a.imdbRating) || 0));
}

function Decades({ decade, type }) {
  const list = useAsync(() => (decade ? decadeTop(type, decade) : Promise.resolve([])), [type, decade]);
  return html`<section class="genres-group genres-decades">
    <div class="genres-group-head"><h2>Decades</h2><span class="kicker type">set the dial, hold on tight</span></div>
    <div class="chips scroll" role="group" aria-label="Pick a decade">
      ${DECADES.map(d => html`<${Chip} active=${d === decade} onClick=${() => setQuery({ decade: d === decade ? '' : d })} title=${BLURBS[d]}>${d}s<//>`)}
    </div>
    ${decade && html`<div class="genres-decade">
      <${SectionTitle} kicker=${BLURBS[decade] || 'now arriving'} icon="hourglass"
        action=${html`<${Tabs} tabs=${[{ id: 'movie', label: 'Movies', icon: 'film' }, { id: 'series', label: 'Shows', icon: 'tv' }]} value=${type} onChange=${t => setQuery({ t })} />`}>Best of the ${decade}s<//>
      ${list.error ? html`<${ErrorNote} error=${list.error} retry=${list.reload} />`
        : html`<${Grid} items=${list.data || []} loading=${list.loading}
            empty=${html`<${Empty} mood="sleep" title="The archive is quiet" text=${`No ${type === 'series' ? 'shows' : 'movies'} from the ${decade}s on the shelf.`} />`} />`}
    </div>`}
  </section>`;
}

function Wall({ query }) {
  const decade = DECADES.includes(+query.decade) ? +query.decade : null;
  const type = query.t === 'series' ? 'series' : 'movie';
  return html`<${Page} title="Genres" kicker="every shelf in the house" icon="tag" class="genres">
    <${Decades} decade=${decade} type=${type} />
    ${GROUPS.map(g => html`<section class="genres-group">
      <div class="genres-group-head"><h2>${g.title}</h2><span class="kicker type">${g.kicker}</span></div>
      <div class="genres-wall">${g.items.map(it => html`<${Sticker} key=${it.id} type=${g.type} item=${it} />`)}</div>
    </section>`)}
  <//>`;
}

const RATINGS = [
  { id: '', label: 'Any rating' },
  { id: '6', label: '6+' },
  { id: '7', label: '7+' },
  { id: '8', label: '8+' },
];

function Shelf({ type, genre, query }) {
  const special = SPECIALS[genre];
  const label = special ? special.label : genre;
  const sorts = type === 'anime'
    ? [{ id: 'kitsu-anime-popular', label: 'Popular', icon: 'heart' }, { id: 'kitsu-anime-rating', label: 'Top rated', icon: 'star' }, { id: 'kitsu-anime-airing', label: 'Airing', icon: 'tv' }]
    : [{ id: 'top', label: 'Popular', icon: 'sparkle' }, { id: 'imdbRating', label: 'Top rated', icon: 'star' }];
  const sort = sorts.some(s => s.id === query.sort) ? query.sort : sorts[0].id;
  const page = useRef(0);
  const paged = usePaged(skip => {
    if (!special) return fetchShelf(type, sort, genre, skip);
    if (!skip) page.current = 0;
    const f = special.pages[page.current++];
    return f ? f() : Promise.resolve([]);
  }, [type, genre, sort]);

  // Multi-genre selection (AND)
  const genreList = useMemo(() => {
    const all = type === 'anime' ? ANIME_GENRES : type === 'series' ? SERIES_GENRES : MOVIE_GENRES;
    return all.filter(g => g.toLowerCase() !== genre.toLowerCase());
  }, [type, genre]);

  const extraGenres = useMemo(() => {
    const raw = (query.with || query.genres || '').split(',').map(s => s.trim()).filter(Boolean);
    return raw.filter(g => genreList.some(gl => gl.toLowerCase() === g.toLowerCase()));
  }, [query.with, query.genres, genreList]);

  // Hide watched toggle
  const hideWatched = query.hideWatched === '1' || query.hideWatched === 'true';
  const hist = useStore(history);
  const prog = useStore(progress);
  const dia = useStore(diary);
  const watchedIds = useMemo(() => {
    const ids = new Set((hist || []).map(x => x.id));
    for (const e of Object.values(prog || {})) {
      if (Object.values(e.eps || {}).some(ep => ep.done)) ids.add(e.id);
    }
    for (const d of dia || []) ids.add(d.id);
    return ids;
  }, [hist, prog, dia]);

  // Minimum rating filter
  const minRating = parseFloat(query.minRating) || 0;

  // Apply filters client-side on loaded items
  const filteredItems = useMemo(() => {
    return paged.items.filter(item => {
      if (hideWatched && watchedIds.has(item.id)) return false;
      if (minRating > 0) {
        const r = parseFloat(item.imdbRating);
        if (!r || r < minRating) return false;
      }
      if (extraGenres.length > 0) {
        const itGenres = item.genres || [];
        if (!extraGenres.every(g => itGenres.some(ig => ig.toLowerCase() === g.toLowerCase()))) return false;
      }
      return true;
    });
  }, [paged.items, hideWatched, minRating, extraGenres, watchedIds]);

  // Keep paging working (load more when filtered list is short)
  useEffect(() => {
    if (filteredItems.length < 18 && !paged.done && !paged.loading && paged.items.length > 0 && !paged.error) {
      paged.more();
    }
  }, [filteredItems.length, paged.done, paged.loading, paged.items.length]);

  const toggleExtra = g => {
    const exists = extraGenres.some(eg => eg.toLowerCase() === g.toLowerCase());
    const next = exists ? extraGenres.filter(eg => eg.toLowerCase() !== g.toLowerCase()) : [...extraGenres, g];
    setQuery({ with: next.join(',') });
  };

  const noun = type === 'series' ? 'shows' : type === 'anime' ? 'anime' : 'movies';
  return html`<${Page} title=${label} kicker=${`${noun} · genre`} icon=${(special && special.icon) || ICON_FOR[genre] || 'tag'}
      actions=${html`<${Btn} href="#/genres" icon="back" size="sm" variant="ghost">All genres<//>`}>
    ${!special && html`<${Tabs} tabs=${sorts} value=${sort} onChange=${id => setQuery({ sort: id })} />`}

    <div class="browse-filter-bar genres-filter-bar">
      <${Toggle} checked=${hideWatched} onChange=${v => setQuery({ hideWatched: v ? '1' : '' })} label="Hide watched" />
      <div class="chips browse-ratings" role="group" aria-label="Minimum rating">
        ${RATINGS.map(r => html`<${Chip} key=${r.id} active=${(query.minRating || '') === r.id} onClick=${() => setQuery({ minRating: (query.minRating || '') === r.id ? '' : r.id })}>${r.label}<//>`)}
      </div>
    </div>

    ${!special && genreList.length > 0 && html`
      <div class="chips scroll genres-extra-chips" role="group" aria-label="Combine genres">
        <span class="genres-extra-label type faint">+ combine:</span>
        ${genreList.map(g => html`<${Chip} key=${g} active=${extraGenres.some(eg => eg.toLowerCase() === g.toLowerCase())} onClick=${() => toggleExtra(g)}>${g}<//>`)}
      </div>
    `}

    ${paged.error && !paged.items.length ? html`<${ErrorNote} error=${paged.error} retry=${paged.reload} />` : html`
      <${Grid} items=${filteredItems} loading=${paged.loading && !filteredItems.length} done=${paged.done} onMore=${paged.more}
        empty=${html`<${Empty} mood="confused" title="This shelf is bare" text="Nothing turned up here. Try another genre or clearing your filters." action=${html`<${Btn} href="#/genres" icon="tag">All genres<//>`} />`} />`}
  <//>`;
}

export default function Genres({ params, query }) {
  return params.genre ? html`<${Shelf} type=${params.type} genre=${params.genre} query=${query} />` : html`<${Wall} query=${query} />`;
}
