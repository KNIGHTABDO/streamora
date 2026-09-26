// Time Machine: pick a decade on a hand-drawn timeline; older decades turn the sketchbook sepia.
import { html, useEffect } from '../../vendor/preact-htm.js';
import { Page, Grid, Row, Tabs, Chip, Btn, Empty, ErrorNote, useAsync, loadCSS, cx } from '../ui/components.js';
import { catalog } from '../core/meta.js';
import { setQuery } from '../router.js';

loadCSS('css/pages/timemachine.css');

const NOW = new Date().getFullYear();
const DECADES = Array.from({ length: (Math.floor(NOW / 10) * 10 - 1920) / 10 + 1 }, (_, i) => 1920 + i * 10);
const BLURBS = {
  1920: 'silent stars & jazz', 1930: 'talkies & screwballs', 1940: 'noir shadows', 1950: 'technicolor dreams', 1960: 'new waves',
  1970: 'new hollywood', 1980: 'neon & synths', 1990: 'indie boom', 2000: 'franchise dawn', 2010: 'streaming era', 2020: 'right now',
};
const yearsOf = d => Array.from({ length: 10 }, (_, i) => d + i).filter(y => y <= NOW);

async function decadeTop(type, decade) {
  const res = await Promise.allSettled(yearsOf(decade).map(y => catalog(type, 'year', { genre: y })));
  const all = res.flatMap(r => (r.status === 'fulfilled' ? r.value.slice(0, 14) : []));
  // popular within each year first, then the best rated of those
  return all.filter(m => m.poster).sort((a, b) => (parseFloat(b.imdbRating) || 0) - (parseFloat(a.imdbRating) || 0));
}

function Timeline({ decade, onPick }) {
  return html`<nav class="tm-line" aria-label="Pick a decade">
    <svg class="tm-rule" viewBox="0 0 1000 20" preserveAspectRatio="none" aria-hidden="true">
      <path d="M4 11 C200 7 400 14 600 9 S880 12 996 10" fill="none" stroke="var(--line)" stroke-width="3" stroke-linecap="round"/>
    </svg>
    ${DECADES.map(d => html`<button type="button" class=${cx('tm-stop', d === decade && 'on')} aria-pressed=${d === decade} onClick=${() => onPick(d)}>
      <span class="tm-dot"></span>
      <span class="tm-year display">${d}s</span>
      <span class="tm-blurb type">${BLURBS[d] || ''}</span>
    </button>`)}
  </nav>`;
}

export default function TimeMachine({ query }) {
  const decade = +query.d || 1990;
  const type = query.t === 'series' ? 'series' : 'movie';
  const year = +query.y && +query.y >= decade && +query.y < decade + 10 ? +query.y : Math.min(decade + 4, NOW);
  const list = useAsync(() => decadeTop(type, decade), [type, decade]);
  const nutshell = useAsync(() => catalog(type, 'year', { genre: year }), [type, year]);

  useEffect(() => {
    const el = document.documentElement;
    if (decade < 1970) el.dataset.era = 'old'; else delete el.dataset.era;
  }, [decade]);
  useEffect(() => () => { delete document.documentElement.dataset.era; }, []);

  const i = DECADES.indexOf(decade);
  const go = d => setQuery({ d, y: '' });
  return html`<${Page} title="Time Machine" kicker="set the dial, hold on tight" icon="hourglass" class="tm-page">
    <div class="tm-dial panel">
      <span class="tape tl"></span>
      <div class="spread tm-dial-head">
        <${Btn} variant="ghost" icon="back" disabled=${i <= 0} onClick=${() => go(DECADES[i - 1])}>earlier<//>
        <div class="tm-now"><span class="type faint">now arriving</span><span class="display tm-big">${decade}s</span></div>
        <${Btn} variant="ghost" iconRight="next" disabled=${i >= DECADES.length - 1} onClick=${() => go(DECADES[i + 1])}>later<//>
      </div>
      <${Timeline} decade=${decade} onPick=${go} />
    </div>

    <${Tabs} tabs=${[{ id: 'movie', label: 'Movies', icon: 'film' }, { id: 'series', label: 'Shows', icon: 'tv' }]} value=${type} onChange=${t => setQuery({ t })} class="tm-tabs" />

    <section class="tm-nutshell">
      <div class="kicker type">year in a nutshell</div>
      <div class="chips scroll">${yearsOf(decade).map(y => html`<${Chip} active=${y === year} onClick=${() => setQuery({ y })}>${y}<//>`)}</div>
      <${Row} title=${`${year}, the year of…`} icon="calendar" items=${(nutshell.data || []).slice(0, 20)} loading=${nutshell.loading} error=${nutshell.error}
        empty=${html`<p class="muted">Nothing on the shelf for ${year}.</p>`} numbered />
    </section>

    <section>
      <h2 class="tm-best">Best of the ${decade}s</h2>
      ${list.error ? html`<${ErrorNote} error=${list.error} retry=${list.reload} />`
        : html`<${Grid} items=${list.data || []} loading=${list.loading}
            empty=${html`<${Empty} mood="sleep" title="The archive is quiet" text=${`No ${type === 'series' ? 'shows' : 'movies'} from the ${decade}s on the shelf.`} />`} />`}
    </section>
  <//>`;
}
