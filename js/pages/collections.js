// Collections: franchises in watch order, drawn as film strips with progress ticks.
import { html } from '../../vendor/preact-htm.js';
import { Page, Btn, Img, DoodlePoster, Icon, ErrorNote, Empty, Spinner, useAsync, loadCSS, hrefTitle, cx } from '../ui/components.js';
import { posterOf } from '../core/meta.js';
import { progress, useStore } from '../core/store.js';
import { COLLECTIONS, resolveList } from '../lib/discover-lists.js';

loadCSS('css/pages/collections.css');

const seen = (p, id) => {
  const e = p[id];
  if (!e) return 0;
  const eps = Object.values(e.eps || {});
  if (e.type === 'movie' || e.eps._) return e.eps._ && e.eps._.done ? 1 : .5;
  return eps.some(x => x.done) ? .5 : 0;
};

function Strip({ color, children, class: cls }) {
  return html`<div class=${cx('col-strip', cls)} style=${`--sc:${color}`}>${children}</div>`;
}

function Index() {
  return html`<${Page} title="Collections" kicker="franchises in the right order" icon="layers" class="col-page">
    <div class="col-grid">
      ${COLLECTIONS.map((c, i) => html`<a class="col-card" href=${`#/collection/${c.slug}`} style=${`--sc:${c.color};--tilt:${(i % 5 - 2) * .7}deg`}>
        <${Strip} color=${c.color}>
          ${Array.from({ length: 5 }, (_, k) => html`<span class="col-frame" style=${`--k:${k}`}>${k === 0 ? html`<b class="display">${c.titles.length}</b>` : ''}</span>`)}
        <//>
        <span class="col-card-name">${c.name}</span>
        <span class="type faint">${c.note} · ${c.titles.length} ${c.titles.length === 1 ? 'title' : 'titles'}</span>
      </a>`)}
    </div>
  <//>`;
}

function Collection({ c }) {
  const list = useAsync(() => resolveList(c.titles), [c.slug]);
  const p = useStore(progress);
  const items = list.data || [];
  const next = items.find(m => seen(p, m.id) < 1);
  const done = items.filter(m => seen(p, m.id) >= 1).length;
  const nextHref = next && (next.type === 'movie' ? `#/watch/movie/${encodeURIComponent(next.id)}` : hrefTitle(next));
  return html`<${Page} class="col-page">
    <header class="col-head">
      <${Btn} variant="ghost" icon="back" href="#/collections">all collections<//>
      <div class="kicker type">${c.note}</div>
      <h1>${c.name}</h1>
      ${items.length > 0 && html`<div class="cluster col-actions">
        ${next ? html`<${Btn} variant="primary" size="lg" icon="play" href=${nextHref}>${done ? 'Play next' : 'Start'}: ${next.name}<//>`
          : html`<span class="btn-stamp btn">all watched!</span>`}
        <span class="type muted">${done} / ${items.length} watched</span>
      </div>`}
    </header>
    ${list.loading ? html`<${Spinner} label="threading the film…" />`
      : list.error ? html`<${ErrorNote} error=${list.error} retry=${list.reload} />`
      : !items.length ? html`<${Empty} mood="confused" title="The reel came up empty" text="The catalog didn't answer. Try again in a moment." action=${html`<${Btn} icon="refresh" onClick=${list.reload}>Retry<//>`} />`
      : html`<${Strip} color=${c.color} class="col-timeline">
          ${items.map((m, i) => {
            const s = seen(p, m.id);
            return html`<a class=${cx('col-item', s >= 1 && 'done', next && next.id === m.id && 'next')} href=${hrefTitle(m)}>
              <span class="col-num display">${i + 1}</span>
              <span class="col-thumb"><${Img} src=${posterOf(m)} alt="" fallback=${html`<${DoodlePoster} title=${m.name} />`} /></span>
              <span class="col-info">
                <span class="col-name">${m.name}</span>
                <span class="type faint">${m.year || m.releaseInfo || ''}${m.type === 'series' ? ' · series' : ''}${m.imdbRating ? ` · ★ ${m.imdbRating}` : ''}</span>
                ${next && next.id === m.id && html`<span class="col-up type">up next</span>`}
              </span>
              <span class=${cx('col-check', s >= 1 ? 'full' : s > 0 && 'half')} aria-label=${s >= 1 ? 'watched' : s > 0 ? 'started' : 'not watched'}>
                ${s > 0 && html`<${Icon} name="check" size=${22} />`}
              </span>
            </a>`;
          })}
        <//>`}
  <//>`;
}

export default function Collections({ params }) {
  if (!params.slug) return html`<${Index} />`;
  const c = COLLECTIONS.find(x => x.slug === params.slug);
  if (!c) return html`<${Page}><${Empty} mood="confused" title="No such collection" action=${html`<${Btn} href="#/collections" icon="layers">All collections<//>`} /><//>`;
  return html`<${Collection} key=${c.slug} c=${c} />`;
}
