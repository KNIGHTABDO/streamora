// Watchlist: a corkboard of pinned polaroids. Drag to reorder (touch too), ← → buttons for TV/keyboard.
import { html, useState, useRef, useEffect } from '../../vendor/preact-htm.js';
import { Page, Btn, IconBtn, Chip, Tabs, Empty, Modal, Img, DoodlePoster, Icon, Select, Grid, PosterCard, loadCSS, cx, hrefTitle, shuffle, plural } from '../ui/components.js';
import { watchlist, useStore } from '../core/store.js';
import { meta, posterOf } from '../core/meta.js';
import { tiltOf, hash } from '../ui/sketch.js';

loadCSS('css/pages/watchlist.css');

const kind = x => (x.anime || String(x.id).startsWith('kitsu:') ? 'anime' : x.type === 'movie' ? 'movie' : 'series');

// fill in year / rating / genres for sorting (cached by meta.js)
function useEnriched(list) {
  const [extra, setExtra] = useState({});
  useEffect(() => {
    let alive = true;
    const todo = list.filter(x => !extra[x.id] && (x.year == null || x.imdbRating == null));
    (async () => {
      for (let i = 0; i < todo.length; i += 6) {
        const got = await Promise.all(todo.slice(i, i + 6).map(x => meta(x.type === 'movie' ? 'movie' : 'series', x.id).catch(() => null)));
        if (!alive) return;
        setExtra(e => { const n = { ...e }; got.forEach((m, j) => { n[todo[i + j].id] = m ? { year: m.year, imdbRating: m.imdbRating, anime: m.anime } : {}; }); return n; });
      }
    })();
    return () => { alive = false; };
  }, [list.map(x => x.id).join()]);
  return list.map(x => ({ ...(extra[x.id] || {}), ...x, year: x.year ?? (extra[x.id] || {}).year, imdbRating: x.imdbRating ?? (extra[x.id] || {}).imdbRating }));
}

function Pin({ seed }) {
  const colors = ['var(--a1)', 'var(--a2)', 'var(--a4)', 'var(--a3)'];
  return html`<svg class="wl-pin" viewBox="0 0 30 34" aria-hidden="true">
    <path d="M15 20 L14 33" stroke="var(--ink-2)" stroke-width="2" stroke-linecap="round"/>
    <ellipse cx="15" cy="12" rx="10" ry="9.5" fill=${colors[seed % 4]} stroke="var(--line)" stroke-width="2.2"/>
    <ellipse cx="11.5" cy="9" rx="3" ry="2.2" fill="#fff" opacity=".6"/>
  </svg>`;
}

function BoardCard({ item, i, total, onMove, onRemove, dragging, picked, dimmed, dragProps }) {
  const s = hash(String(item.id));
  return html`<div class=${cx('wl-card', dragging && 'dragging', picked && 'picked', dimmed && 'dimmed')} style=${`--tilt:${tiltOf(item.id, 3.4).toFixed(2)}deg`} data-idx=${i} ...${dragProps}>
    ${s % 3 ? html`<${Pin} seed=${s} />` : html`<span class=${cx('tape top', s % 2 && 'alt')}></span>`}
    <a class="wl-photo" href=${hrefTitle(item)} draggable="false" aria-label=${item.name}>
      <${Img} src=${posterOf(item)} alt="" draggable="false" fallback=${html`<${DoodlePoster} title=${item.name} />`} />
    </a>
    <div class="wl-cap"><span class="wl-name">${item.name}</span><span class="type faint">${[item.year, item.imdbRating && '★ ' + item.imdbRating].filter(Boolean).join(' · ')}</span></div>
    <div class="wl-tools">
      ${onMove && html`<button type="button" class="wl-tool" aria-label=${`Move ${item.name} earlier`} disabled=${i === 0} onClick=${() => onMove(i, i - 1)}><${Icon} name="back" size=${16} /></button>`}
      <button type="button" class="wl-tool" aria-label=${`Remove ${item.name}`} onClick=${() => onRemove(item)}><${Icon} name="close" size=${16} /></button>
      ${onMove && html`<button type="button" class="wl-tool" aria-label=${`Move ${item.name} later`} disabled=${i === total - 1} onClick=${() => onMove(i, i + 1)}><${Icon} name="next" size=${16} /></button>`}
    </div>
  </div>`;
}

export default function Watchlist() {
  const raw = useStore(watchlist);
  const list = useEnriched(raw);
  const [filter, setFilter] = useState('all');
  const [sort, setSort] = useState('mine');
  const [view, setView] = useState('board');
  const [drag, setDrag] = useState(null);       // { id }
  const [picking, setPicking] = useState(null); // id currently lit during the shuffle
  const [pick, setPick] = useState(null);
  const boardRef = useRef();

  const counts = { all: list.length, movie: 0, series: 0, anime: 0 };
  list.forEach(x => counts[kind(x)]++);
  let shown = list.filter(x => filter === 'all' || kind(x) === filter);
  const sorters = {
    added: (a, b) => (b.added || 0) - (a.added || 0),
    name: (a, b) => a.name.localeCompare(b.name),
    year: (a, b) => (b.year || 0) - (a.year || 0),
    rating: (a, b) => (+b.imdbRating || 0) - (+a.imdbRating || 0),
  };
  if (sorters[sort]) shown = shown.slice().sort(sorters[sort]);
  const canReorder = sort === 'mine' && filter === 'all';

  const move = (from, to) => watchlist.update(w => {
    if (to < 0 || to >= w.length) return w;
    const a = w.slice(); const [x] = a.splice(from, 1); a.splice(to, 0, x); return a;
  });
  const remove = item => watchlist.update(w => w.filter(x => x.id !== item.id));

  // pointer drag: works for mouse and touch (long-ish press on touch so rows still scroll)
  const dragProps = (item, i) => !canReorder ? {} : {
    onPointerDown: e => {
      if (e.button !== 0 || e.target.closest('.wl-tool')) return;
      const startX = e.clientX, startY = e.clientY, el = e.currentTarget;
      const touch = e.pointerType !== 'mouse';
      let started = false, timer = touch ? setTimeout(() => { started = true; setDrag({ id: item.id }); el.setPointerCapture(e.pointerId); }, 280) : null;
      const onMoveP = ev => {
        if (!started) {
          if (touch) { if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > 8) cleanup(); return; }
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return;
          started = true; setDrag({ id: item.id }); el.setPointerCapture(e.pointerId);
        }
        ev.preventDefault();
        el.style.translate = `${ev.clientX - startX}px ${ev.clientY - startY}px`;
        el.style.pointerEvents = 'none';
        const over = document.elementFromPoint(ev.clientX, ev.clientY);
        el.style.pointerEvents = '';
        const target = over && over.closest('.wl-card');
        if (target && target !== el) {
          const to = +target.dataset.idx, from = watchlist.get().findIndex(x => x.id === item.id);
          if (from !== to) { move(from, to); }
        }
      };
      const cleanup = () => {
        clearTimeout(timer);
        el.style.translate = '';
        removeEventListener('pointermove', onMoveP);
        removeEventListener('pointerup', onUp);
        removeEventListener('pointercancel', onUp);
        if (started) { setDrag(null); const swallow = ev => { ev.preventDefault(); ev.stopPropagation(); }; el.addEventListener('click', swallow, { capture: true, once: true }); setTimeout(() => el.removeEventListener('click', swallow, { capture: true }), 50); }
      };
      const onUp = () => cleanup();
      addEventListener('pointermove', onMoveP, { passive: false });
      addEventListener('pointerup', onUp);
      addEventListener('pointercancel', onUp);
    },
  };

  const pickOne = () => {
    if (!shown.length) return;
    const order = shuffle(shown);
    const winner = order[0];
    let n = 0; const steps = Math.min(14, 6 + shown.length);
    const tick = () => {
      n++;
      setPicking(n >= steps ? winner.id : order[n % order.length].id);
      if (n < steps) setTimeout(tick, 60 + n * n * 3.2);
      else setTimeout(() => { setPick(winner); setPicking(null); }, 600);
    };
    tick();
  };

  if (!raw.length) return html`<${Page} title="Watchlist" kicker="your pinboard" icon="heart">
    <${Empty} mood="popcorn" title="Nothing pinned yet" text="Tap the heart on any movie or show to pin it here for later."
      action=${html`<div class="cluster" style="justify-content:center"><${Btn} href="#/movies" icon="film">Browse movies<//><${Btn} href="#/mood" icon="wheel" variant="ghost">Spin the Mood Wheel<//></div>`} />
  <//>`;

  return html`<${Page} title="Watchlist" kicker=${plural(raw.length, 'thing') + ' pinned'} icon="heart"
      actions=${html`<${Btn} variant="primary" icon="dice" onClick=${pickOne} disabled=${!!picking || !shown.length}>Pick one for me<//>`}>
    <div class="wl-bar">
      <${Tabs} value=${filter} onChange=${setFilter} tabs=${[
        { id: 'all', label: 'All', count: counts.all }, { id: 'movie', label: 'Movies', icon: 'film', count: counts.movie },
        { id: 'series', label: 'Shows', icon: 'tv', count: counts.series }, { id: 'anime', label: 'Anime', icon: 'anime', count: counts.anime }]} />
      <div class="cluster wl-controls">
        <${Select} value=${sort} onChange=${setSort} options=${[{ value: 'mine', label: 'My order' }, { value: 'added', label: 'Recently added' }, { value: 'name', label: 'Name' }, { value: 'year', label: 'Year' }, { value: 'rating', label: 'Rating' }]} />
        <${IconBtn} icon="layers" label="Board view" active=${view === 'board'} onClick=${() => setView('board')} />
        <${IconBtn} icon="grid" label="Grid view" active=${view === 'grid'} onClick=${() => setView('grid')} />
      </div>
    </div>
    ${canReorder && view === 'board' && html`<p class="faint wl-hint">Drag the polaroids to rearrange (press and hold on touch). On a remote, use the arrows under each one.</p>`}
    ${!shown.length ? html`<${Empty} mood="confused" title="Nothing here in this drawer" text="Try another tab." />`
      : view === 'grid' ? html`<${Grid} items=${shown} done render=${it => html`<${PosterCard} key=${it.id} item=${it} onRemove=${remove} />`} />`
      : html`<div class="wl-board halftone" ref=${boardRef}>
          ${shown.map((it, i) => html`<${BoardCard} key=${it.id} item=${it} i=${i} total=${shown.length}
            onMove=${canReorder ? move : null} onRemove=${remove} dragging=${drag && drag.id === it.id}
            picked=${picking === it.id} dimmed=${picking && picking !== it.id} dragProps=${dragProps(it, i)} />`)}
        </div>`}
    <${Modal} open=${!!pick} onClose=${() => setPick(null)} title="Tonight you're watching…">
      ${pick && html`<div class="wl-pick">
        <div class="wl-pick-photo"><span class="tape top"></span><${Img} src=${posterOf(pick)} alt="" fallback=${html`<${DoodlePoster} title=${pick.name} />`} /></div>
        <h2 class="wl-pick-name">${pick.name}</h2>
        <div class="cluster" style="justify-content:center">
          ${pick.type === 'movie' && html`<${Btn} variant="primary" icon="play" href=${`#/watch/movie/${encodeURIComponent(pick.id)}`}>Play<//>`}
          <${Btn} icon="info" href=${hrefTitle(pick)}>Details<//>
          <${Btn} variant="ghost" icon="dice" onClick=${() => { setPick(null); setTimeout(pickOne, 250); }}>Again<//>
        </div>
      </div>`}
    <//>
  <//>`;
}
