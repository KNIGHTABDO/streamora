// Calendar: new episodes of the shows you follow or are watching, drawn as a planner.
// Week spread + month grid on desktop, a vertical agenda on phones.
import { html, useState, useMemo } from '../../vendor/preact-htm.js';
import { Page, Btn, IconBtn, Row, PosterCard, Empty, ErrorNote, Spinner, Img, useAsync, loadCSS, cx, hrefTitle } from '../ui/components.js';
import { follows, progress, useStore } from '../core/store.js';
import { meta, catalog } from '../core/meta.js';
import { epState } from '../core/progress.js';
import { scribbleStroke, tiltOf, hash } from '../ui/sketch.js';
import { dayKey } from '../lib/stats.js';

loadCSS('css/pages/calendar.css');

const DAY = 864e5;
const WD = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const startOfDay = t => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d; };
const mondayOf = t => { const d = startOfDay(t); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d; };
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const fmtDay = d => `${d.getDate()} ${MONTHS[d.getMonth()].slice(0, 3)}`;

async function loadEpisodes(shows) {
  const out = [];
  for (let i = 0; i < shows.length; i += 6) {
    const metas = await Promise.all(shows.slice(i, i + 6).map(s => meta(s.type === 'movie' ? 'movie' : 'series', s.id).catch(() => null)));
    for (const m of metas) {
      if (!m) continue;
      for (const v of m.videos || []) {
        if (!v.released || v.season === 0) continue;
        out.push({ show: m, v, at: new Date(v.released).getTime() });
      }
    }
  }
  return out.sort((a, b) => a.at - b.at);
}

function Sticker({ ep, compact }) {
  const aired = ep.at <= Date.now();
  const st = epState(ep.show.id, ep.v.id);
  const fresh = aired && Date.now() - ep.at < 30 * DAY && !(st && st.done);
  const href = aired ? `#/watch/series/${encodeURIComponent(ep.show.id)}?v=${encodeURIComponent(ep.v.id)}` : hrefTitle(ep.show);
  const title = ep.v.name || ep.v.title || `Episode ${ep.v.episode}`;
  return html`<a class=${cx('cal-sticker', compact && 'compact', st && st.done && 'seen')} href=${href} style=${`--tilt:${tiltOf(ep.v.id, 2.5).toFixed(2)}deg`}
      aria-label=${`${ep.show.name} S${ep.v.season} E${ep.v.episode}: ${title}${aired ? '' : ' (upcoming)'}`}>
    <span class="cal-thumb"><${Img} src=${(aired && ep.v.thumbnail) || ep.show.background || ep.show.poster} alt="" fallback=${html`<span class="cal-thumb-fb display">${ep.show.name[0]}</span>`} /></span>
    <span class="cal-st-text">
      <b>${ep.show.name}</b>
      <span class="type">S${ep.v.season} · E${ep.v.episode}</span>
      ${!compact && html`<span class="cal-ep-title">${title}</span>`}
    </span>
    ${fresh && html`<span class="cal-stamp">new</span>`}
    ${st && st.done && html`<span class="cal-check" aria-hidden="true">✓</span>`}
  </a>`;
}

function TodayCircle() {
  return html`<svg class="cal-today" viewBox="0 0 100 70" preserveAspectRatio="none" aria-hidden="true">
    <path d=${scribbleStroke(100, 70, 11, 1.2)} fill="none" stroke="var(--a1)" stroke-width="3" stroke-linecap="round" pathLength="1"/>
  </svg>`;
}

function Week({ start, byDay }) {
  const today = dayKey(Date.now());
  return html`<div class="cal-week">
    ${WD.map((w, i) => {
      const d = addDays(start, i), k = dayKey(d), eps = byDay.get(k) || [];
      return html`<section class=${cx('cal-day', k === today && 'is-today', eps.length === 0 && 'cal-none')}>
        <header class="cal-day-h">
          <span class="type">${w}</span>
          <span class="cal-day-n display">${d.getDate()}${k === today && html`<${TodayCircle} />`}</span>
        </header>
        <div class="cal-day-body">${eps.map(ep => html`<${Sticker} key=${ep.v.id} ep=${ep} />`)}</div>
      </section>`;
    })}
  </div>`;
}

function Month({ anchor, byDay }) {
  const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
  const start = mondayOf(first);
  const today = dayKey(Date.now());
  const cells = Array.from({ length: 42 }, (_, i) => addDays(start, i));
  return html`<div class="cal-month">
    ${WD.map(w => html`<div class="cal-m-wd type">${w}</div>`)}
    ${cells.map(d => {
      const k = dayKey(d), eps = byDay.get(k) || [];
      return html`<div class=${cx('cal-m-cell', d.getMonth() !== anchor.getMonth() && 'out', k === today && 'is-today')}>
        <span class="cal-m-n">${d.getDate()}${k === today && html`<${TodayCircle} />`}</span>
        ${eps.slice(0, 3).map(ep => html`<a class="cal-m-ep" href=${hrefTitle(ep.show)} title=${`${ep.show.name} S${ep.v.season}E${ep.v.episode}`}
            style=${`--c:var(--${['a1', 'a2', 'a4', 'a3'][hash(ep.show.id) % 4]})`}>${ep.show.name}</a>`)}
        ${eps.length > 3 && html`<span class="type faint cal-m-more">+${eps.length - 3}</span>`}
      </div>`;
    })}
  </div>`;
}

function Agenda({ eps }) {
  const now = Date.now();
  const list = eps.filter(e => e.at >= now - 10 * DAY && e.at <= now + 45 * DAY);
  if (!list.length) return html`<p class="faint cal-agenda">Nothing airing in the next few weeks.</p>`;
  const groups = [];
  for (const e of list) {
    const k = dayKey(e.at);
    if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, d: new Date(e.at), items: [] });
    groups[groups.length - 1].items.push(e);
  }
  const today = dayKey(now);
  return html`<div class="cal-agenda">
    ${groups.map(g => html`<section class=${cx('cal-ag-day', g.k === today && 'is-today', g.d < startOfDay(now) && 'past')}>
      <h3 class="cal-ag-h"><span class="display">${g.k === today ? 'Today' : WD[(g.d.getDay() + 6) % 7]}</span> <span class="type faint">${fmtDay(g.d)}</span></h3>
      <div class="stack">${g.items.map(ep => html`<${Sticker} key=${ep.v.id} ep=${ep} />`)}</div>
    </section>`)}
  </div>`;
}

export default function Calendar() {
  const fol = useStore(follows);
  const prog = useStore(progress);
  const shows = useMemo(() => {
    const m = new Map();
    for (const f of fol) if (f.type !== 'movie') m.set(f.id, f);
    for (const p of Object.values(prog)) if (p.type !== 'movie' && !m.has(p.id)) m.set(p.id, p);
    return [...m.values()];
  }, [fol, prog]);
  const key = shows.map(s => s.id).sort().join();
  const data = useAsync(() => loadEpisodes(shows), [key]);
  const fresh = useAsync(() => catalog('series', 'year', { genre: String(new Date().getFullYear()) }), []);
  const [week, setWeek] = useState(0);
  const [month, setMonth] = useState(0);

  const eps = data.data || [];
  const byDay = useMemo(() => {
    const m = new Map();
    for (const e of eps) { const k = dayKey(e.at); if (!m.has(k)) m.set(k, []); m.get(k).push(e); }
    return m;
  }, [eps]);
  const start = addDays(mondayOf(Date.now()), week * 7);
  const anchor = (() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + month); return d; })();
  const now = Date.now();
  const premieres = [];
  const seenShow = new Set();
  for (const e of eps) if (e.at > now && e.v.episode === 1 && !seenShow.has(e.show.id)) { seenShow.add(e.show.id); premieres.push(e); }

  if (!shows.length) return html`<${Page} title="Calendar" kicker="new episodes" icon="calendar">
    <${Empty} mood="binoculars" title="No shows to keep an eye on" text="Follow a show (or start watching one) and its new episodes show up here like planner stickers."
      action=${html`<${Btn} href="#/shows" icon="tv">Find shows to follow<//>`} />
    <${Row} title="New this year" kicker="fresh ink" icon="sparkle" items=${fresh.data} loading=${fresh.loading} error=${fresh.error} />
  <//>`;

  return html`<${Page} title="Calendar" kicker=${`${shows.length} shows on the fridge`} icon="calendar">
    ${data.loading ? html`<div class="center-fill"><${Spinner} label="flipping through the planner…" /></div>`
      : data.error ? html`<${ErrorNote} error=${data.error} retry=${data.reload} />`
      : html`
        <section class="cal-spread">
          <div class="spread cal-nav">
            <h2 class="cal-range">${fmtDay(start)} – ${fmtDay(addDays(start, 6))}</h2>
            <div class="cluster">
              <${IconBtn} icon="back" label="Previous week" onClick=${() => setWeek(w => w - 1)} />
              <${Btn} size="sm" variant=${week === 0 ? 'primary' : 'ink'} onClick=${() => setWeek(0)}>This week<//>
              <${IconBtn} icon="next" label="Next week" onClick=${() => setWeek(w => w + 1)} />
            </div>
          </div>
          <${Week} start=${start} byDay=${byDay} />
          <${Agenda} eps=${eps} />
        </section>
        ${premieres.length ? html`<${Row} title="Upcoming premieres" kicker="circle the date" icon="sparkle" items=${premieres}
            render=${e => html`<${PosterCard} key=${e.show.id} item=${e.show} label=${`S${e.v.season} · ${fmtDay(new Date(e.at))}`} />`} />`
          : html`<${Row} title="New this year" kicker="fresh ink" icon="sparkle" items=${fresh.data} loading=${fresh.loading} />`}
        <section class="cal-month-wrap">
          <div class="spread cal-nav">
            <h2>${MONTHS[anchor.getMonth()]} <span class="faint">${anchor.getFullYear()}</span></h2>
            <div class="cluster">
              <${IconBtn} icon="back" label="Previous month" onClick=${() => setMonth(m => m - 1)} />
              <${IconBtn} icon="next" label="Next month" onClick=${() => setMonth(m => m + 1)} />
            </div>
          </div>
          <${Month} anchor=${anchor} byDay=${byDay} />
        </section>`}
  <//>`;
}
