// People: name-tag cards, search, and a hand-drawn filmography timeline per person.
import { html, useState } from '../../vendor/preact-htm.js';
import { Page, Btn, Input, Tabs, PosterCard, Spinner, Empty, ErrorNote, useAsync, loadCSS, cx } from '../ui/components.js';
import { hash, hatch, scribbleLoop } from '../ui/sketch.js';
import { search, meta } from '../core/meta.js';
import { navigate } from '../router.js';
import { PEOPLE } from '../lib/discover-lists.js';
import { pool } from '../lib/pool.js';

loadCSS('css/pages/people.css');

const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const initials = n => n.split(/\s+/).filter(Boolean).map(w => w[0]).slice(0, 2).join('').toUpperCase();
const TONES = ['var(--a1)', 'var(--a2)', 'var(--a3)', 'var(--a4)'];

export function Portrait({ name, size = 96 }) {
  const h = hash(name);
  return html`<svg class="pp-portrait" width=${size} height=${size} viewBox="0 0 100 100" aria-hidden="true">
    <clipPath id=${'pp' + h}><circle cx="50" cy="50" r="44"/></clipPath>
    <circle cx="50" cy="50" r="44" fill=${TONES[h % 4]} opacity=".55"/>
    <path d=${hatch(100, 100, h, { gap: 7, angle: -30 + (h % 60) })} stroke="var(--line)" stroke-width="1" opacity=".22" clip-path=${`url(#pp${h})`}/>
    <path d=${scribbleLoop(100, 100, h, { sw: 3.2, turns: 1.08 })} fill="var(--line)"/>
    <text x="50" y="63" text-anchor="middle" font-family="var(--font-display)" font-size="38" fill="var(--ink)">${initials(name)}</text>
  </svg>`;
}

async function filmography(name) {
  const who = norm(name);
  const hits = (await search(name, 'movie')).concat(await search(name, 'series'));
  const uniq = [...new Map(hits.filter(m => m.id.startsWith('tt')).map(m => [m.id, m])).values()].slice(0, 30);
  const metas = await pool(uniq, 6, m => meta(m.type, m.id));
  const has = (list, n) => [].concat(list || []).some(x => norm(x) === n);
  const directed = [], acted = [], maybe = [];
  metas.forEach((m, i) => {
    if (!m) return;
    if (has(m.director, who)) directed.push(m);
    else if (has(m.cast, who) || has(m.writer, who)) acted.push(m);
    else if (!norm(m.name).includes(who)) maybe.push(uniq[i]);
  });
  const byYear = a => a.sort((x, y) => (y.year || 0) - (x.year || 0));
  return { directed: byYear(directed), acted: byYear(acted), maybe };
}

function Timeline({ items }) {
  const years = [];
  for (const m of items) {
    const y = m.year || '—';
    const last = years[years.length - 1];
    if (last && last.y === y) last.items.push(m); else years.push({ y, items: [m] });
  }
  return html`<ol class="pp-timeline">
    ${years.map(g => html`<li class="pp-year">
      <span class="pp-year-label display">${g.y}</span>
      <div class="pp-year-items">${g.items.map(m => html`<${PosterCard} key=${m.id} item=${m} size="sm" />`)}</div>
    </li>`)}
  </ol>`;
}

function Person({ name }) {
  const f = useAsync(() => filmography(name), [name]);
  const [tab, setTab] = useState(null);
  const d = f.data;
  const tabs = d ? [d.directed.length && { id: 'directed', label: 'Directed', icon: 'camera', count: d.directed.length }, d.acted.length && { id: 'acted', label: 'On screen', icon: 'person', count: d.acted.length }].filter(Boolean) : [];
  const cur = tab && tabs.some(t => t.id === tab) ? tab : tabs[0] && tabs[0].id;
  return html`<${Page} class="pp-page">
    <header class="pp-head">
      <${Btn} variant="ghost" icon="back" href="#/people">people<//>
      <div class="pp-hero">
        <${Portrait} name=${name} size=${120} />
        <div><div class="kicker type">filmography</div><h1>${name}</h1>
          ${d && html`<div class="type muted">${d.directed.length + d.acted.length} titles found</div>`}</div>
      </div>
    </header>
    ${f.loading ? html`<${Spinner} label="flipping through the credits…" />`
      : f.error ? html`<${ErrorNote} error=${f.error} retry=${f.reload} />`
      : !tabs.length ? html`<${Empty} mood="binoculars" title="No confirmed credits" text=${`The catalog doesn't list ${name} in the cast or as director of anything it found.`}
          action=${d.maybe.length ? null : html`<${Btn} href="#/people" icon="search">Search someone else<//>`} />`
      : html`<${Tabs} tabs=${tabs} value=${cur} onChange=${setTab} /><${Timeline} items=${d[cur]} />`}
    ${d && d.maybe.length > 0 && html`<details class="pp-maybe"><summary class="type">other search matches (${d.maybe.length})</summary>
      <div class="pp-maybe-grid">${d.maybe.map(m => html`<${PosterCard} key=${m.id} item=${m} size="sm" />`)}</div></details>`}
  <//>`;
}

function Index() {
  const [q, setQ] = useState('');
  const go = e => { e.preventDefault(); if (q.trim()) navigate(`/person/${encodeURIComponent(q.trim())}`); };
  return html`<${Page} title="People" kicker="actors & directors" icon="person" class="pp-page">
    <form class="pp-search" onSubmit=${go} role="search">
      <${Input} value=${q} onInput=${e => setQ(e.currentTarget.value)} placeholder="Search a name… e.g. Greta Gerwig" aria-label="Person name" />
      <${Btn} variant="primary" icon="search" type="submit" disabled=${!q.trim()}>Find<//>
    </form>
    <div class="pp-tags">
      ${PEOPLE.map((p, i) => html`<a class="pp-tag" href=${`#/person/${encodeURIComponent(p.name)}`} style=${`--tilt:${((hash(p.name) % 7) - 3) * .7}deg;--band:${TONES[i % 4]}`}>
        <span class="pp-tag-band"><b>HELLO</b><small>my name is</small></span>
        <span class="pp-tag-body">
          <${Portrait} name=${p.name} size=${58} />
          <span class=${cx('pp-tag-name', p.name.length > 15 && 'long')}>${p.name}</span>
        </span>
        <span class="pp-tag-role type">${p.role}</span>
      </a>`)}
    </div>
  <//>`;
}

export default function People({ params }) {
  return params.name ? html`<${Person} key=${params.name} name=${params.name} />` : html`<${Index} />`;
}
