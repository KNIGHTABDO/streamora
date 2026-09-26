// Diary: a journal of everything finished (history) plus ratings/notes (diary), grouped by month. And a Stats tab.
import { html, useState, useMemo } from '../../vendor/preact-htm.js';
import { Page, Btn, IconBtn, Tabs, Stars, Empty, Modal, Img, DoodlePoster, Field, Spinner, useAsync, loadCSS, cx, hrefTitle, plural, Icon, Reel } from '../ui/components.js';
import { diary, history, progress, useStore, uid } from '../core/store.js';
import { posterOf } from '../core/meta.js';
import { summary, loadGenres, dayKey, years } from '../lib/stats.js';
import { hatch, hash, taper, rng } from '../ui/sketch.js';

loadCSS('css/pages/diary.css');

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const kOf = d => d.key || 'd' + d.id + d.at;   // diary entries written elsewhere may lack a key

// history + diary merged: a diary entry for the same title on the same day absorbs the history entry(ies)
function timeline(hist, dia) {
  const out = [], byDay = new Map();
  for (const d of dia) {
    const e = { ...d, key: kOf(d), kind: 'diary', eps: [] };
    out.push(e); byDay.set(d.id + '|' + dayKey(d.at), e);
  }
  for (const h of hist) {
    const k = h.id + '|' + dayKey(h.at);
    const hit = byDay.get(k);
    if (hit) { if (h.episode != null) hit.eps.push(h); hit.hist = (hit.hist || []).concat(h); continue; }
    const e = { ...h, key: 'h' + h.at + h.id, kind: 'history', eps: h.episode != null ? [h] : [], hist: [h] };
    out.push(e); byDay.set(k, e);
  }
  return out.sort((a, b) => b.at - a.at);
}

function EntryEditor({ entry, onClose }) {
  const [rating, setRating] = useState(entry.rating || 0);
  const [note, setNote] = useState(entry.note || '');
  const [date, setDate] = useState(dayKey(entry.at));
  const save = () => {
    const [y, m, d] = date.split('-').map(Number);
    const old = new Date(entry.at);
    const at = new Date(y, m - 1, d, old.getHours(), old.getMinutes()).getTime();
    const rec = { key: entry.kind === 'diary' ? entry.key : uid(), id: entry.id, type: entry.type, name: entry.name, poster: entry.poster, rating, note: note.trim(), at };
    diary.update(list => entry.kind === 'diary' ? list.map(x => (kOf(x) === entry.key ? rec : x)) : [rec, ...list]);
    onClose();
  };
  const del = () => {
    if (!confirm(`Remove "${entry.name}" from your diary?`)) return;
    if (entry.kind === 'diary') diary.update(list => list.filter(x => kOf(x) !== entry.key));
    if (entry.hist) { const ats = new Set(entry.hist.map(h => h.at + h.id)); history.update(list => list.filter(h => !ats.has(h.at + h.id))); }
    onClose();
  };
  return html`<${Modal} open onClose=${onClose} title=${entry.name}>
    <div class="dy-edit">
      <${Field} label="Your rating"><${Stars} value=${rating} onChange=${setRating} size=${34} /><//>
      <${Field} label="Watched on"><span class="input ink-edge wide"><input type="date" value=${date} onInput=${e => setDate(e.currentTarget.value)} /></span><//>
      <${Field} label="A few words" hint="only you can see this">
        <textarea class="dy-note" rows="4" value=${note} onInput=${e => setNote(e.currentTarget.value)} placeholder="The twist got me…"></textarea>
      <//>
      <div class="spread">
        <${Btn} variant="ghost" icon="trash" onClick=${del}>Remove<//>
        <${Btn} variant="primary" icon="check" onClick=${save}>Save<//>
      </div>
    </div>
  <//>`;
}

function Entry({ e, onEdit }) {
  const d = new Date(e.at);
  const epLabel = e.eps.length === 1 ? `S${e.eps[0].season} · E${e.eps[0].episode}` : e.eps.length > 1 ? `${e.eps.length} episodes` : e.type === 'movie' ? 'movie' : '';
  return html`<li class=${cx('dy-entry', e.kind)}>
    <div class="dy-date"><span class="dy-day display">${d.getDate()}</span><span class="type">${WD[d.getDay()]}</span></div>
    <a class="dy-thumb" href=${hrefTitle(e)} aria-label=${e.name} style=${`--tilt:${((hash(e.key || e.id) % 7) - 3) * .7}deg`}>
      <${Img} src=${posterOf(e)} alt="" fallback=${html`<${DoodlePoster} title=${e.name} />`} />
    </a>
    <div class="dy-body">
      <a class="dy-name" href=${hrefTitle(e)}>${e.name}</a>
      <div class="type faint">${epLabel}</div>
      ${e.rating ? html`<${Stars} value=${e.rating} size=${18} />` : null}
      ${e.note && html`<p class="dy-note-text">“${e.note}”</p>`}
    </div>
    <${IconBtn} icon=${e.kind === 'diary' ? 'pencil' : 'star'} label=${e.kind === 'diary' ? 'Edit entry' : 'Rate & write'} onClick=${() => onEdit(e)} />
  </li>`;
}

function Journal({ entries, onEdit }) {
  const groups = [];
  for (const e of entries) {
    const d = new Date(e.at), k = `${d.getFullYear()}-${d.getMonth()}`;
    if (!groups.length || groups[groups.length - 1].k !== k) groups.push({ k, label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`, items: [] });
    groups[groups.length - 1].items.push(e);
  }
  const [limit, setLimit] = useState(6);
  return html`<div class="dy-journal">
    ${groups.slice(0, limit).map(g => html`<section class="dy-month">
      <h2 class="dy-month-h"><span class="mark">${g.label}</span> <small class="type faint">${g.items.length} ${g.items.length === 1 ? 'entry' : 'entries'}</small></h2>
      <ol class="dy-list">${g.items.map(e => html`<${Entry} key=${e.key} e=${e} onEdit=${onEdit} />`)}</ol>
    </section>`)}
    ${groups.length > limit && html`<div class="center-fill" style="min-height:0;padding:20px"><${Btn} icon="down" onClick=${() => setLimit(l => l + 6)}>Older pages<//></div>`}
  </div>`;
}

// ---------- stats tab
function GenreBars({ genres }) {
  const max = Math.max(...genres.map(g => g[1]), 1);
  const fills = ['var(--a1)', 'var(--a2)', 'var(--a4)', 'var(--a3)', 'var(--fill-1)', 'var(--fill-2)'];
  return html`<svg class="dy-bars" viewBox=${`0 0 320 ${genres.length * 38 + 6}`} role="img" aria-label="Top genres">
    ${genres.map(([g, n], i) => {
      const w = 40 + (n / max) * 180, y = i * 38 + 4, r = rng(hash(g));
      const outline = taper([[118, y + 2 + r()], [118 + w, y + 1 + r() * 2], [118 + w + r() * 2, y + 28], [117, y + 29], [118, y + 2]], 2.4, { r, start: .02, end: .02 });
      return html`<g>
        <text x="110" y=${y + 21} text-anchor="end" font-family="var(--font-hand)" font-size="17" fill="var(--ink)">${g}</text>
        <clipPath id=${'gb' + i}><rect x="119" y=${y + 3} width=${w - 2} height="25"/></clipPath>
        <rect x="119" y=${y + 3} width=${w - 2} height="25" fill=${fills[i % fills.length]} opacity=".35"/>
        <g clip-path=${`url(#gb${i})`}><path d=${hatch(w, 28, hash(g), { gap: 5, angle: -50 })} transform=${`translate(119 ${y + 2})`} stroke=${fills[i % fills.length]} stroke-width="1.6"/></g>
        <path d=${outline} fill="var(--line)"/>
        <text x=${126 + w} y=${y + 21} font-family="var(--font-type)" font-size="13" fill="var(--ink-2)">${n}</text>
      </g>`;
    })}
  </svg>`;
}

function Stat({ big, label, icon, tone = 'a3' }) {
  return html`<div class="dy-stat" style=${`--tone:var(--${tone})`}>
    <${Icon} name=${icon} size=${26} /><span class="dy-stat-big display">${big}</span><span class="dy-stat-label">${label}</span>
  </div>`;
}

function Stats({ prog, hist, dia }) {
  const ys = years(prog, hist, dia);
  const [year, setYear] = useState('all');
  const y = year === 'all' ? null : +year;
  const g = useAsync(() => loadGenres(hist.filter(h => y == null || new Date(h.at).getFullYear() === y)), [hist.length, year]);
  const s = useMemo(() => summary({ progress: prog, history: hist, diary: dia }, y, g.data || {}), [prog, hist, dia, y, g.data]);
  const hours = s.seconds / 3600;
  return html`<div class="dy-stats">
    <div class="chips" style="margin-bottom:18px">
      <button type="button" class=${cx('chip', year === 'all' && 'active')} onClick=${() => setYear('all')}>All time</button>
      ${ys.map(v => html`<button type="button" class=${cx('chip', +year === v && 'active')} onClick=${() => setYear(String(v))}>${v}</button>`)}
    </div>
    <div class="dy-stat-grid">
      <${Stat} icon="clock" big=${hours >= 10 ? Math.round(hours) : hours.toFixed(1)} label="hours watched" tone="a3" />
      <${Stat} icon="film" big=${s.movies} label=${s.movies === 1 ? 'movie' : 'movies'} tone="a1" />
      <${Stat} icon="tv" big=${s.episodes} label=${s.episodes === 1 ? 'episode' : 'episodes'} tone="a2" />
      <${Stat} icon="sparkle" big=${s.streak.longest} label=${`day streak (now ${s.streak.current})`} tone="a4" />
    </div>
    <div class="dy-stat-row">
      <section class="panel dy-panel">
        <span class="tape tl"></span>
        <h3>Top genres</h3>
        ${g.loading ? html`<${Spinner} label="counting…" size=${48} />` : s.genres.length ? html`<${GenreBars} genres=${s.genres} />` : html`<p class="faint">Finish a few things to see your genres.</p>`}
      </section>
      <section class="panel dy-panel">
        <span class="tape tr alt"></span>
        <h3>Most watched show</h3>
        ${s.mostShow ? html`<a class="dy-most" href=${hrefTitle({ ...s.mostShow, type: 'series' })}>
            <${Img} src=${posterOf(s.mostShow)} alt="" fallback=${html`<${DoodlePoster} title=${s.mostShow.name} />`} />
            <span><b class="display">${s.mostShow.name}</b><span class="type">${plural(s.mostShow.count, 'episode')}</span></span>
          </a>` : html`<p class="faint">No shows yet.</p>`}
        ${s.fav && html`<p class="dy-fav">You watch most on <span class="mark">${s.fav.day} ${s.fav.part}s</span>.</p>`}
        ${s.binge && s.binge.count > 1 && html`<p class="dy-fav">Biggest binge: <b>${s.binge.count} episodes</b> of ${s.binge.name} in one day.</p>`}
      </section>
    </div>
  </div>`;
}

function csvCell(v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v; }
function exportCSV(entries) {
  const rows = [['Date', 'Title', 'Type', 'Season', 'Episode', 'Rating', 'Note', 'Id']];
  for (const e of entries) {
    const eps = e.eps.length ? e.eps : [{}];
    for (const ep of eps) rows.push([dayKey(ep.at || e.at), e.name, e.type, ep.season ?? '', ep.episode ?? '', e.rating || '', e.note || '', e.id]);
  }
  const blob = new Blob(['﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `streamora-diary-${dayKey(Date.now())}.csv` });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export default function Diary({ query }) {
  const dia = useStore(diary), hist = useStore(history), prog = useStore(progress);
  const [tab, setTab] = useState(query.tab === 'stats' ? 'stats' : 'log');
  const [editing, setEditing] = useState(null);
  const entries = useMemo(() => timeline(hist, dia), [hist, dia]);

  return html`<${Page} title="Diary" kicker="everything you finished" icon="book"
      actions=${entries.length ? html`<${Btn} icon="download" variant="ghost" onClick=${() => exportCSV(entries)}>Export CSV<//>` : null}>
    <${Tabs} value=${tab} onChange=${setTab} tabs=${[{ id: 'log', label: 'Journal', icon: 'book', count: entries.length }, { id: 'stats', label: 'Stats', icon: 'trophy' }]} />
    <div class="dy-page">
      ${!entries.length ? html`<${Empty} mood="sleep" title="The diary is still blank" text="Finish a movie or an episode and it gets written in here. You can rate it and add a note."
          action=${html`<${Btn} href="#/" icon="home">Find something to watch<//>`} />`
        : tab === 'log' ? html`<${Journal} entries=${entries} onEdit=${setEditing} />`
        : html`<${Stats} prog=${prog} hist=${hist} dia=${dia} />`}
    </div>
    ${editing && html`<${EntryEditor} entry=${editing} onClose=${() => setEditing(null)} />`}
  <//>`;
}
