import { html, useState, useEffect, useRef, useMemo } from '../../vendor/preact-htm.js';
import { Page, Grid, Chip, Row, Empty, ErrorNote, IconBtn, Icon, loadCSS, useAsync, toast, cx } from '../ui/components.js';
import { pstore, useStore } from '../core/store.js';
import { search, catalog } from '../core/meta.js';
import { setQuery } from '../router.js';

loadCSS('css/pages/search.css');

const searches = pstore('searches', []);
const remember = q => searches.update(l => [q, ...l.filter(x => x.toLowerCase() !== q.toLowerCase())].slice(0, 12));
const Speech = typeof window !== 'undefined' && (window.SpeechRecognition || window.webkitSpeechRecognition);
const isPhone = () => matchMedia('(max-width: 760px)').matches;

const TYPE_FILTERS = [
  { id: 'all', label: 'All', icon: 'sparkle' },
  { id: 'movie', label: 'Movies', icon: 'film' },
  { id: 'series', label: 'Shows', icon: 'tv' },
  { id: 'anime', label: 'Anime', icon: 'anime' },
];

const DECADE_FILTERS = [
  { id: '', label: 'Any year' },
  { id: '2020', label: '2020s' },
  { id: '2010', label: '2010s' },
  { id: '2000', label: '2000s' },
  { id: '1990', label: '1990s' },
  { id: '1980', label: '1980s' },
  { id: 'classic', label: 'Pre-1980' },
];

export default function Search({ query }) {
  const q = (query.q || '').trim();
  const [text, setText] = useState(query.q || '');
  const typeFilter = query.t || 'all';
  const yearFilter = query.y || '';
  const [listening, setListening] = useState(false);
  const input = useRef();
  const recent = useStore(searches);

  useEffect(() => { if (!isPhone() && input.current) input.current.focus(); }, []);
  useEffect(() => { if ((query.q || '') !== text && document.activeElement !== input.current) setText(query.q || ''); }, [query.q]);
  // debounce typing → URL (?q=) → results
  useEffect(() => {
    const t = setTimeout(() => { if (text.trim() !== q) setQuery({ q: text.trim() }); }, 180);
    return () => clearTimeout(t);
  }, [text]);
  useEffect(() => {
    if (!q) return;
    const t = setTimeout(() => remember(q), 1500); // only keep searches the user settled on
    return () => clearTimeout(t);
  }, [q]);

  // results stream in per source; old results stay on screen until new ones land (no skeleton flash while typing)
  const [res, setRes] = useState({ data: [], loading: false, error: null });
  const [again, setAgain] = useState(0);
  useEffect(() => {
    if (!q) return;
    let live = true;
    setRes(r => ({ ...r, loading: true, error: null }));
    search(q, 'all', part => live && setRes({ data: part, loading: true, error: null }))
      .then(data => live && setRes({ data, loading: false, error: null }), error => live && setRes({ data: [], loading: false, error }));
    return () => { live = false; };
  }, [q, again]);
  res.reload = () => setAgain(k => k + 1);
  const trending = useAsync(() => Promise.all([catalog('movie', 'top'), catalog('series', 'top')]).then(([m, s]) => ({ m: m.slice(0, 12), s: s.slice(0, 12) })), []);

  const all = res.data || [];
  const counts = useMemo(() => ({
    all: all.length,
    movie: all.filter(m => m.type === 'movie' && !m.anime).length,
    series: all.filter(m => m.type === 'series' && !m.anime).length,
    anime: all.filter(m => m.anime).length,
  }), [all]);

  const filtered = useMemo(() => {
    return all.filter(m => {
      if (typeFilter === 'movie' && (m.type !== 'movie' || m.anime)) return false;
      if (typeFilter === 'series' && (m.type !== 'series' || m.anime)) return false;
      if (typeFilter === 'anime' && !m.anime) return false;
      if (yearFilter) {
        const yr = m.year ? parseInt(m.year, 10) : null;
        if (!yr) return false;
        if (yearFilter === 'classic') {
          if (yr >= 1980) return false;
        } else {
          const dec = parseInt(yearFilter, 10);
          if (yr < dec || yr > dec + 9) return false;
        }
      }
      return true;
    });
  }, [all, typeFilter, yearFilter]);

  const setType = id => setQuery({ t: id === 'all' ? '' : id });
  const setYear = id => setQuery({ y: id === yearFilter ? '' : id });

  const listen = () => {
    const r = new Speech();
    r.lang = navigator.language || 'en-US';
    r.interimResults = true;
    r.onresult = e => setText([...e.results].map(x => x[0].transcript).join(''));
    r.onerror = e => { setListening(false); if (e.error !== 'aborted') toast('Could not hear that. Try again?', { kind: 'warn', icon: 'mic' }); };
    r.onend = () => setListening(false);
    setListening(true);
    r.start();
  };

  return html`<${Page} class="search">
    <form class="search-box" role="search" onSubmit=${e => { e.preventDefault(); setQuery({ q: text.trim() }); input.current && input.current.blur(); }}>
      <span class="search-field ink-edge wide boil">
        <${Icon} name="search" size=${30} class="search-lens" />
        <input ref=${input} type="search" value=${text} onInput=${e => setText(e.currentTarget.value)}
          placeholder="Find a movie, show or anime…" aria-label="Search" enterkeyhint="search" autocomplete="off" autocapitalize="off" spellcheck="false" />
        ${text && html`<${IconBtn} icon="close" label="Clear" onClick=${() => { setText(''); input.current.focus(); }} />`}
        ${Speech && html`<${IconBtn} icon="mic" label="Voice search" class=${cx('search-mic', listening && 'listening')} onClick=${listen} />`}
      </span>
    </form>

    ${!q ? html`
      ${recent.length > 0 && html`<section class="search-recent">
        <div class="spread"><div class="kicker type">recent searches</div><button type="button" class="search-clear type" onClick=${() => searches.set([])}>clear</button></div>
        <div class="chips">${recent.map(r => html`<${Chip} icon="clock" onClick=${() => { setText(r); setQuery({ q: r }); }}>${r}<//>`)}</div>
      </section>`}
      <${Row} title="Trending movies" kicker="people are searching" icon="film" items=${trending.data && trending.data.m} loading=${trending.loading} error=${trending.error} />
      <${Row} title="Trending shows" icon="tv" items=${trending.data && trending.data.s} loading=${trending.loading} error=${trending.error} />
    ` : html`
      <div class="spread search-head">
        <h2 class="search-for">Results for <span class="mark">${q}</span></h2>
        <a class="search-people" href=${`#/person/${encodeURIComponent(q)}`}><${Icon} name="person" size=${20} /> People named “${q}”</a>
      </div>
      <div class="search-filters">
        <div class="chips search-chips search-type-chips" role="group" aria-label="Filter by type">
          ${TYPE_FILTERS.map(t => html`<${Chip} key=${t.id} icon=${t.icon} active=${typeFilter === t.id} onClick=${() => setType(t.id)}>${t.label} <small class="type faint">(${counts[t.id] || 0})</small><//>`)}
        </div>
        <div class="chips scroll search-chips search-year-chips" role="group" aria-label="Filter by year">
          ${DECADE_FILTERS.map(d => html`<${Chip} key=${d.id} active=${yearFilter === d.id} onClick=${() => setYear(d.id)}>${d.label}<//>`)}
        </div>
      </div>
      ${res.error ? html`<${ErrorNote} error=${res.error} retry=${res.reload} />` : html`
        <${Grid} items=${filtered} loading=${res.loading && !filtered.length}
          empty=${html`<${Empty} mood="binoculars" title=${`No luck with “${q}”`} text=${yearFilter || typeFilter !== 'all' ? 'Try clearing your filters.' : 'Check the spelling, try the original title, or search a person instead.'} action=${html`<a class="btn btn-ink btn-md ink-edge wide" href=${`#/person/${encodeURIComponent(q)}`}><${Icon} name="person" size=${20} /><span>Search people</span></a>`} />`} />`}
    `}
  <//>`;
}
