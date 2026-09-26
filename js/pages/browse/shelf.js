// Shared browse page for Movies / Shows / Anime: themed header, sort tabs, genre chips, infinite grid.
import { html, useRef } from '../../../vendor/preact-htm.js';
import { Grid, usePaged, Tabs, Chip, Btn, Empty, ErrorNote, loadCSS, hrefTitle, cx } from '../../ui/components.js';
import { catalog, MOVIE_GENRES, SERIES_GENRES, ANIME_GENRES } from '../../core/meta.js';
import { activeProfile } from '../../core/store.js';
import { setQuery, navigate } from '../../router.js';

loadCSS('css/pages/browse.css');

const YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: 8 }, (_, i) => String(YEAR - i));

export const SHELVES = {
  movie: {
    title: 'Movies', kicker: 'the big screen', genres: MOVIE_GENRES, kids: ['Family', 'Animation'],
    sorts: [{ id: 'top', label: 'Popular', icon: 'sparkle' }, { id: 'imdbRating', label: 'Top rated', icon: 'star' }, { id: 'year', label: 'New', icon: 'calendar' }],
  },
  series: {
    title: 'Shows', kicker: 'one more episode', genres: SERIES_GENRES, kids: ['Family', 'Animation'],
    sorts: [{ id: 'top', label: 'Popular', icon: 'sparkle' }, { id: 'imdbRating', label: 'Top rated', icon: 'star' }, { id: 'year', label: 'New', icon: 'calendar' }],
  },
  anime: {
    title: 'Anime', kicker: 'sakuga & feelings', genres: ANIME_GENRES, kids: ['Family', 'Friendship', 'Comedy'],
    sorts: [{ id: 'kitsu-anime-trending', label: 'Trending', icon: 'sparkle' }, { id: 'kitsu-anime-airing', label: 'Airing', icon: 'tv' }, { id: 'kitsu-anime-popular', label: 'Popular', icon: 'heart' }, { id: 'kitsu-anime-rating', label: 'Top rated', icon: 'star' }],
  },
};

/** fetch one page of a shelf; shared with the genre pages */
export function fetchShelf(type, sort, genre, skip) {
  if (type === 'anime' && sort === 'kitsu-anime-trending') {
    // trending has no genre/skip support: fall back to popular when a genre is picked
    if (genre) return catalog('anime', 'kitsu-anime-popular', { genre, skip: skip || undefined });
    return skip ? Promise.resolve([]) : catalog('anime', sort);
  }
  return catalog(type, sort, { genre, skip: skip || undefined });
}

export function BrowsePage({ type, query, header }) {
  const cfg = SHELVES[type];
  const kids = !!(activeProfile() || {}).kids;
  const sort = cfg.sorts.some(s => s.id === query.sort) ? query.sort : cfg.sorts[0].id;
  const byYear = sort === 'year';
  const options = byYear ? YEARS : kids ? cfg.kids : cfg.genres;
  const genre = options.includes(query.genre) ? query.genre : byYear ? String(YEAR) : kids ? cfg.kids[0] : '';
  const paged = usePaged(skip => fetchShelf(type, sort, genre || undefined, skip), [type, sort, genre]);
  const top = useRef();

  const surprise = () => {
    const pool = paged.items;
    if (pool.length) navigate(hrefTitle(pool[Math.floor(Math.random() * pool.length)]));
  };

  return html`<main class=${cx('page', 'browse', `browse-${type}`)} id="main" ref=${top}>
    <header class="browse-head">
      <div class="browse-head-art" aria-hidden="true">${header}</div>
      <div class="browse-head-text">
        <div class="kicker type">${cfg.kicker}</div>
        <h1 class="browse-title">${cfg.title}</h1>
        <div class="browse-surprise"><${Btn} icon="dice" size="sm" onClick=${surprise} disabled=${!paged.items.length}>Surprise me from this shelf<//></div>
      </div>
    </header>

    <${Tabs} class="browse-tabs" tabs=${cfg.sorts} value=${sort} onChange=${id => setQuery({ sort: id, genre: '' })} />

    <div class="chips scroll browse-chips" role="group" aria-label=${byYear ? 'Year' : 'Genre'}>
      ${!byYear && !kids && html`<${Chip} active=${!genre} onClick=${() => setQuery({ genre: '' })}>Everything<//>`}
      ${options.map(g => html`<${Chip} key=${g} active=${g === genre} onClick=${() => setQuery({ genre: g })}>${g}<//>`)}
    </div>

    ${kids && html`<p class="browse-kids type">✎ kids profile: only family-friendly shelves</p>`}
    ${paged.error && !paged.items.length ? html`<${ErrorNote} error=${paged.error} retry=${paged.reload} />` : html`
      <${Grid} items=${paged.items} loading=${paged.loading} done=${paged.done} onMore=${paged.more}
        empty=${html`<${Empty} mood="binoculars" title="Nothing on this shelf" text="Try another genre, or spin the mood wheel." action=${html`<${Btn} href="#/mood" icon="wheel">Mood wheel<//>`} />`} />`}
  </main>`;
}

// ---------- header doodles (inline SVG, drawn with theme tokens) ----------
const S = 'var(--line)';
export const MovieArt = html`<svg viewBox="0 0 260 150" class="browse-doodle">
  <g fill="none" stroke=${S} stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M40 62 L196 58 L198 138 L42 140 Z" fill="var(--paper-3)"/>
    <path d="M38 60 L192 22 L200 50 L44 88 Z" fill="var(--ink)" />
    <path d="M70 52 L84 30 M106 43 L120 21 M142 35 L156 13 M178 26 L186 17" stroke="var(--paper-3)" stroke-width="7"/>
    <path d="M58 92 L182 90 M58 112 L150 111" stroke-width="2" opacity=".6"/>
    <path d="M160 110 c8 -2 18 -2 24 4" opacity=".5"/>
  </g>
  <g transform="translate(206 20) rotate(12)">
    <rect x="0" y="0" width="34" height="116" rx="3" fill="var(--a1)" stroke=${S} stroke-width="2.5"/>
    ${[8, 30, 52, 74, 96].map(y => html`<rect x="9" y=${y} width="16" height="13" fill="var(--paper-3)" stroke=${S} stroke-width="1.5"/>`)}
  </g>
  <text x="62" y="128" font-family="var(--font-display)" font-size="22" fill=${S}>take 1</text>
</svg>`;

export const ShowArt = html`<svg viewBox="0 0 260 150" class="browse-doodle">
  <g fill="none" stroke=${S} stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
    <path d="M110 34 L78 6 M130 34 L170 4" />
    <circle cx="78" cy="6" r="4" fill="var(--a1)"/><circle cx="170" cy="4" r="4" fill="var(--a2)"/>
    <path d="M40 36 C90 30 170 30 222 36 C228 70 228 100 222 132 C170 138 90 138 40 132 C34 100 34 70 40 36 Z" fill="var(--fill-2)"/>
    <path d="M56 50 C100 46 150 46 186 50 C190 74 190 96 186 120 C150 124 100 124 56 120 C52 96 52 74 56 50 Z" fill="var(--paper-3)"/>
    <path d="M70 70 l30 -4 M70 86 l52 -3 M70 102 l40 -2" stroke-width="2" opacity=".5"/>
    <circle cx="206" cy="66" r="8" fill="var(--a3)"/><circle cx="206" cy="94" r="8" fill="var(--a4)"/>
    <path d="M70 134 l-8 12 M190 134 l8 12"/>
  </g>
  <g fill=${S}><circle cx="150" cy="84" r="3"/><circle cx="162" cy="84" r="3"/><path d="M146 96 q10 8 20 0" fill="none" stroke=${S} stroke-width="2.5" stroke-linecap="round"/></g>
</svg>`;

export const AnimeArt = html`<svg viewBox="0 0 260 150" class="browse-doodle">
  <g stroke=${S} stroke-linecap="round">
    ${Array.from({ length: 28 }, (_, i) => {
      const a = (i / 28) * Math.PI * 2, r1 = 30 + (i % 3) * 6, r2 = 120;
      return html`<path d=${`M${130 + Math.cos(a) * r1} ${75 + Math.sin(a) * r1 * .6}L${130 + Math.cos(a) * r2} ${75 + Math.sin(a) * r2 * .6}`} stroke-width=${i % 2 ? 1.2 : 2.4} opacity=".55"/>`;
    })}
  </g>
  <path d="M130 30 l10 26 28 2 -22 18 8 27 -24 -15 -24 15 8 -27 -22 -18 28 -2 z" fill="var(--a3)" stroke=${S} stroke-width="3" stroke-linejoin="round"/>
  <g fill="none" stroke=${S} stroke-width="3"><path d="M6 6 L96 10 L90 60 L4 56 Z" fill="var(--paper-3)"/><path d="M168 96 L254 92 L256 144 L172 146 Z" fill="var(--paper-3)"/></g>
  <text x="16" y="44" font-family="var(--font-display)" font-size="26" fill="var(--a1)">ドン!</text>
  <text x="186" y="130" font-family="var(--font-display)" font-size="24" fill=${S}>!!</text>
</svg>`;
