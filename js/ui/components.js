// Shared UI kit. Every page builds from these so the whole app reads as one sketchbook.
import { html, useState, useEffect, useRef, useCallback } from '../../vendor/preact-htm.js';
import { Icon } from './icons.js';
import { tiltOf, hash, hatch, Underline, scribbleStroke } from './sketch.js';
import { posterOf } from '../core/meta.js';
import { Reel } from './reel.js';

export { html, Icon, Underline, Reel };

export const cx = (...a) => a.filter(Boolean).join(' ');
export const hrefTitle = m => `#/title/${m.type}/${encodeURIComponent(m.id)}`;

// ------------------------------------------------------------------ data hook
/** const { data, error, loading, reload } = useAsync(() => catalog(...), [deps]) */
export function useAsync(fn, deps = []) {
  const [st, set] = useState({ data: undefined, error: null, loading: true });
  const alive = useRef(0);
  const run = useCallback(() => {
    const me = ++alive.current;
    set(s => ({ ...s, loading: true, error: null }));
    Promise.resolve().then(fn).then(
      data => me === alive.current && set({ data, error: null, loading: false }),
      error => me === alive.current && set({ data: undefined, error, loading: false }),
    );
  }, deps);
  useEffect(() => { run(); return () => { alive.current++; }; }, [run]);
  return { ...st, reload: run };
}

// ------------------------------------------------------------------ buttons
/**
 * <Btn icon="play" variant="primary|ink|ghost|stamp|danger" size="sm|md|lg" href|onClick>Play</Btn>
 */
export function Btn({ icon, iconRight, variant = 'ink', size = 'md', href, children, class: cls, ...rest }) {
  const c = cx('btn', `btn-${variant}`, `btn-${size}`, variant !== 'ghost' && variant !== 'stamp' && 'ink-edge wide', cls);
  const inner = html`${icon && html`<${Icon} name=${icon} size=${size === 'lg' ? 24 : size === 'sm' ? 16 : 20} />`}${children && html`<span>${children}</span>`}${iconRight && html`<${Icon} name=${iconRight} size=${18} />`}`;
  return href ? html`<a class=${c} href=${href} ...${rest}>${inner}</a>` : html`<button type="button" class=${c} ...${rest}>${inner}</button>`;
}

export function IconBtn({ icon, label, size = 22, class: cls, active, ...rest }) {
  return html`<button type="button" class=${cx('icon-btn', active && 'active', cls)} aria-label=${label} title=${label} ...${rest}>
    <${Icon} name=${icon} size=${size} />
  </button>`;
}

/** Sticker-like pill. <Chip active onClick>Horror</Chip> */
export function Chip({ active, children, icon, color, class: cls, ...rest }) {
  return html`<button type="button" class=${cx('chip', active && 'active', cls)} style=${color ? `--chip:${color}` : ''} aria-pressed=${!!active} ...${rest}>
    ${icon && html`<${Icon} name=${icon} size=${16} />`}${children}
  </button>`;
}

// ------------------------------------------------------------------ images
/** Lazy image that fades in; shows a doodle poster if it fails. */
export function Img({ src, alt = '', class: cls, fallback, eager, ...rest }) {
  // state is keyed by src so a new src resets it synchronously (an effect reset raced cached images: loaded, then reset to invisible)
  const [st, setSt] = useState({});
  const state = !src ? 'error' : st.src === src ? st.v : 'loading';
  const setState = v => setSt({ src, v });
  if (state === 'error') return fallback || null;
  return html`<img class=${cx('img', state === 'loaded' && 'loaded', cls)} src=${src} alt=${alt} loading=${eager ? 'eager' : 'lazy'} fetchpriority=${eager ? 'high' : 'auto'} decoding="async"
    ref=${el => { if (el && state === 'loading' && el.complete && el.naturalWidth) setState('loaded'); }} onLoad=${() => setState('loaded')} onError=${() => setState('error')} ...${rest} />`;
}

/** Generated poster when there is no art: hand-lettered title on a hatched card. */
export function DoodlePoster({ title = '?', seed }) {
  const s = seed ?? hash(title);
  const fills = ['var(--fill-1)', 'var(--fill-2)', 'var(--fill-3)', 'var(--fill-4)'];
  return html`<div class="doodle-poster" style=${`--dp:${fills[s % 4]}`}>
    <svg viewBox="0 0 200 300" preserveAspectRatio="none" aria-hidden="true"><path d=${hatch(200, 300, s, { gap: 9 })} stroke="currentColor" stroke-width="1.2" opacity=".25"/></svg>
    <span>${title}</span>
  </div>`;
}

// ------------------------------------------------------------------ poster card
/**
 * Polaroid taped to the page.
 * <PosterCard item=${meta} pct=${.4} label="S2 · E3" onClick? href? size="sm|md|lg" wide? />
 * wide=true shows the backdrop (16:9) instead of the poster (used by Continue Watching).
 */
export function PosterCard({ item, pct, label, href, onClick, size = 'md', wide, badge, onRemove, rank, eager }) {
  const tilt = tiltOf(item.id);
  const src = wide ? (item.background || item.poster) : posterOf(item);
  const t = hash(String(item.id));
  const link = href || (onClick ? null : hrefTitle(item));
  const body = html`
    <div class="pc-photo ${wide ? 'wide' : ''}">
      <${Img} src=${src} eager=${eager} alt="" fallback=${html`<${DoodlePoster} title=${item.name} />`} />
      ${badge && html`<span class="pc-badge">${badge}</span>`}
      ${rank && html`<span class="pc-rank display">${rank}</span>`}
      ${wide && html`<span class="pc-play"><${Icon} name="play" size=${26} /></span>`}
    </div>
    <div class="pc-caption">
      <span class="pc-title">${item.name}</span>
      ${label ? html`<span class="pc-meta type">${label}</span>` : item.year && html`<span class="pc-meta type">${item.year}${item.imdbRating ? ` · ★ ${item.imdbRating}` : ''}</span>`}
      ${pct != null && html`<${Underline} seed=${t} pct=${pct} class="pc-progress" />`}
    </div>
    <span class=${cx('tape', t % 3 === 0 ? 'tl' : t % 3 === 1 ? 'top' : 'tr', t % 2 && 'alt')}></span>
    <svg class="scribble" viewBox="0 0 200 120" preserveAspectRatio="none" aria-hidden="true">
      <path d=${scribbleStroke(200, 120, t)} fill="none" stroke="var(--a1)" stroke-width="3" stroke-linecap="round" pathLength="1"/>
    </svg>`;
  const c = cx('poster-card', `pc-${size}`, wide && 'pc-wide');
  const style = `--tilt:${tilt.toFixed(2)}deg`;
  return html`<div class="pc-wrap">
    ${link ? html`<a class=${c} style=${style} href=${link} aria-label=${item.name}>${body}</a>`
      : html`<button type="button" class=${c} style=${style} onClick=${onClick} aria-label=${item.name}>${body}</button>`}
    ${onRemove && html`<button type="button" class="pc-remove" aria-label="Remove" title="Remove" onClick=${e => { e.preventDefault(); onRemove(item); }}><${Icon} name="close" size=${14} /></button>`}
  </div>`;
}

export function SkeletonCard({ wide, size = 'md' }) {
  return html`<div class="pc-wrap"><div class=${cx('poster-card skeleton', `pc-${size}`, wide && 'pc-wide')}>
    <div class="pc-photo ${wide ? 'wide' : ''}"><svg viewBox="0 0 200 300" preserveAspectRatio="none"><path d=${hatch(200, 300, 3, { gap: 10 })} stroke="currentColor" stroke-width="1.4"/></svg></div>
    <div class="pc-caption"><span class="sk-line"></span><span class="sk-line short"></span></div>
  </div></div>`;
}

// ------------------------------------------------------------------ rows & grids
/**
 * Horizontal shelf.
 * <Row title="Trending" kicker="this week" icon="sparkle" items=${list} loading? error? retry? href="#/movies" wide? render=${item => ...} />
 * eager: only for the first shelf on a page (its first posters load at high priority).
 */
export function Row({ title, kicker, icon, items, loading, error, retry, href, wide, size, render, empty, numbered, eager }) {
  const ref = useRef();
  const scroll = dir => ref.current && ref.current.scrollBy({ left: dir * ref.current.clientWidth * .85, behavior: 'smooth' });
  if (!loading && !error && items && !items.length && !empty) return null;
  return html`<section class="row">
    <${SectionTitle} kicker=${kicker} icon=${icon} action=${href && html`<a class="row-more" href=${href}>see all <${Icon} name="next" size=${16} /></a>`}>${title}<//>
    <div class="row-wrap">
      <button type="button" class="row-arrow left" aria-label="Scroll left" tabindex="-1" onClick=${() => scroll(-1)}><${Icon} name="back" /></button>
      <div class="row-track" ref=${ref}>
        ${loading ? Array.from({ length: 8 }, (_, i) => html`<${SkeletonCard} key=${'sk' + i} wide=${wide} size=${size} />`)
          : error ? html`<${ErrorNote} error=${error} retry=${retry} compact />`
          : !items.length ? empty
          : items.map((it, i) => render ? render(it, i) : html`<${PosterCard} key=${it.id} item=${it} wide=${wide} size=${size} rank=${numbered ? i + 1 : null} eager=${eager && i < 6} />`)}
      </div>
      <button type="button" class="row-arrow right" aria-label="Scroll right" tabindex="-1" onClick=${() => scroll(1)}><${Icon} name="next" /></button>
    </div>
  </section>`;
}

/**
 * Poster grid with infinite scroll.
 * <Grid items=${list} loading=${bool} onMore=${() => loadNextPage()} done=${bool} />
 */
export function Grid({ items = [], loading, onMore, done, render, size, empty }) {
  const sentinel = useRef();
  useEffect(() => {
    if (!onMore || done || !sentinel.current) return;
    const io = new IntersectionObserver(es => es[0].isIntersecting && !loading && onMore(), { rootMargin: '800px' });
    io.observe(sentinel.current);
    return () => io.disconnect();
  }, [onMore, done, loading, items.length]);
  if (!loading && !items.length && empty) return empty;
  return html`<div class=${cx('grid', size && `grid-${size}`)}>
    ${items.map((it, i) => render ? render(it, i) : html`<${PosterCard} key=${it.id + ':' + i} item=${it} size=${size} />`)}
    ${loading && Array.from({ length: 12 }, (_, i) => html`<${SkeletonCard} key=${'sk' + i} size=${size} />`)}
    <div ref=${sentinel} class="grid-sentinel"></div>
  </div>`;
}

/** Paginated catalog loader for Grid: const g = usePaged(skip => catalog('movie','top',{genre, skip}), [genre]) */
export function usePaged(fetchPage, deps = [], pageSize = 100) {
  const [st, set] = useState({ items: [], loading: true, done: false, error: null });
  const gen = useRef(0);
  const load = useCallback((reset) => {
    const me = reset ? ++gen.current : gen.current;
    set(s => ({ ...(reset ? { items: [], done: false } : s), loading: true, error: null }));
    const skip = reset ? 0 : st.items.length;
    fetchPage(skip).then(list => {
      if (me !== gen.current) return;
      set(s => {
        const seen = new Set(reset ? [] : s.items.map(i => i.id));
        const fresh = list.filter(i => !seen.has(i.id));
        return { items: [...(reset ? [] : s.items), ...fresh], loading: false, done: !list.length || !fresh.length || list.length < Math.min(pageSize, 20), error: null };
      });
    }, error => me === gen.current && set(s => ({ ...s, loading: false, error })));
  }, [st.items.length, ...deps]);
  useEffect(() => { load(true); }, deps);
  return { ...st, more: () => load(false), reload: () => load(true) };
}

// ------------------------------------------------------------------ headings & layout
export function SectionTitle({ children, kicker, icon, action, as = 'h2' }) {
  const text = typeof children === 'string' ? children : '';
  return html`<div class="section-title">
    <div>
      ${kicker && html`<div class="kicker type">${kicker}</div>`}
      <${as} class="st-h">${icon && html`<${Icon} name=${icon} size=${26} class="st-icon" />`}<span class="st-text">${children}<${Underline} seed=${hash(text || 'x')} track=${false} class="st-underline" /></span><//>
    </div>
    ${action}
  </div>`;
}

/** Standard page wrapper: <Page title="Movies" kicker="the big screen" icon="film" actions=${...}>...</Page> */
export function Page({ title, kicker, icon, actions, children, class: cls, bleed }) {
  return html`<main class=${cx('page', bleed && 'bleed', cls)} id="main" tabindex="-1">
    ${title && html`<header class="page-head">
      <${SectionTitle} as="h1" kicker=${kicker} icon=${icon} action=${actions}>${title}<//>
    </header>`}
    ${children}
  </main>`;
}

/** Big riso-printed banner. actions = buttons. One image decode: the grey riso layer is the same URL as a CSS background. */
export function Hero({ item, kicker, actions, children, tall }) {
  if (!item) return html`<div class="hero skeleton-hero"></div>`;
  const bg = item.background || item.poster;
  return html`<section class=${cx('hero', tall && 'tall')}>
    <div class="hero-art riso hero-mono" style=${bg ? `background-image:url(${JSON.stringify(bg)})` : ''}></div>
    <div class="hero-art print hero-color"><${Img} src=${bg} alt="" eager /></div>
    <div class="hero-fade"></div>
    <div class="hero-body">
      ${kicker && html`<div class="kicker type hero-kicker">${kicker}</div>`}
      ${item.logo ? html`<${Img} class="hero-logo" src=${item.logo} alt=${item.name} fallback=${html`<h1 class="hero-title">${item.name}</h1>`} />` : html`<h1 class="hero-title">${item.name}</h1>`}
      <div class="hero-meta type">
        ${[item.year || item.releaseInfo, item.runtime, item.imdbRating && `★ ${item.imdbRating}`, (item.genres || []).slice(0, 3).join(' / ')].filter(Boolean).join('  ·  ')}
      </div>
      ${item.description && html`<p class="hero-desc">${item.description}</p>`}
      ${actions && html`<div class="hero-actions">${actions}</div>`}
      ${children}
    </div>
  </section>`;
}

/** Notebook divider tabs. <Tabs tabs=${[{id:'all',label:'All'}]} value=${v} onChange=${setV} /> */
export function Tabs({ tabs, value, onChange, class: cls }) {
  return html`<div class=${cx('tabs', cls)} role="tablist">
    ${tabs.map(t => html`<button type="button" role="tab" aria-selected=${t.id === value} class=${cx('tab', t.id === value && 'active')} onClick=${() => onChange(t.id)}>
      ${t.icon && html`<${Icon} name=${t.icon} size=${18} />`}${t.label}${t.count != null && html`<span class="tab-count type">${t.count}</span>`}
    </button>`)}
  </div>`;
}

/** Ink stars. <Stars value=${3.5} onChange=${v => ...} /> (half stars on click position) */
export function Stars({ value = 0, onChange, size = 22 }) {
  return html`<div class=${cx('stars', onChange && 'editable')} role=${onChange ? 'slider' : 'img'} aria-label=${`${value} of 5 stars`}
      aria-valuemin="0" aria-valuemax="5" aria-valuenow=${value} tabindex=${onChange ? 0 : null}
      onKeyDown=${onChange && (e => { if (e.key === 'ArrowRight') onChange(Math.min(5, value + .5)); if (e.key === 'ArrowLeft') onChange(Math.max(0, value - .5)); })}>
    ${[1, 2, 3, 4, 5].map(n => {
      const fill = value >= n ? 1 : value >= n - .5 ? .5 : 0;
      return html`<button type="button" tabindex="-1" class="star" disabled=${!onChange} style=${`--f:${fill * 100}%`}
        onClick=${onChange && (e => { const r = e.currentTarget.getBoundingClientRect(); onChange(e.clientX - r.left < r.width / 2 ? n - .5 : n); })}>
        <${Icon} name="star" size=${size} /><span class="star-fill"><${Icon} name="starFill" size=${size} /></span>
      </button>`;
    })}
  </div>`;
}

// ------------------------------------------------------------------ feedback
/** Pencil sketching a film reel, over and over. */
export function Spinner({ label = 'sketching…', size = 64 }) {
  return html`<div class="spinner" role="status">
    <svg width=${size} height=${size} viewBox="0 0 64 64" aria-hidden="true">
      <g class="sp-reel" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round">
        <circle cx="32" cy="32" r="22" pathLength="1" class="sp-draw" />
        <circle cx="32" cy="32" r="4" />
        <circle cx="32" cy="19" r="5" /><circle cx="44" cy="36" r="5" /><circle cx="20" cy="36" r="5" />
      </g>
      <g class="sp-pencil"><path d="M50 8l6 6-18 18-8 2 2-8z" fill="var(--a3)" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M32 26l6 6" stroke="currentColor" stroke-width="2"/></g>
    </svg>
    ${label && html`<span class="type">${label}</span>`}
  </div>`;
}

// Raw technical errors become plain words; the raw text stays one click away under "details".
const rawError = error => (error && (error.message || String(error))) || 'Something smudged.';
function friendlyError(error) {
  const raw = rawError(error), name = error && error.name;
  if (name === 'AbortError' || name === 'TimeoutError' || /timeout|timed out/i.test(raw)) return 'That took too long. Try again.';
  if (/failed to fetch|networkerror|load failed/i.test(raw) || (name === 'TypeError' && /fetch/i.test(raw))) return "Couldn't reach the server. Check your connection and try again.";
  return raw;
}

export function ErrorNote({ error, retry, compact }) {
  const raw = rawError(error), msg = friendlyError(error);
  return html`<div class=${cx('error-note', compact && 'compact')}>
    <${Icon} name="warn" size=${22} />
    <div class="error-msg">${msg}
      ${msg !== raw && html`<details class="error-details"><summary tabindex="0">details</summary><code>${raw}</code></details>`}
    </div>
    ${retry && html`<${Btn} size="sm" icon="refresh" onClick=${retry}>Try again<//>`}
  </div>`;
}

/**
 * Empty state with Reel. mood: see Reel moods (sleep, search, sad, wave, confused, popcorn, party, binoculars)
 * <Empty mood="popcorn" title="Nothing saved yet" text="Tap the heart on anything." action=${html`<${Btn} ...>`} />
 */
export function Empty({ mood = 'confused', title, text, action }) {
  return html`<div class="empty">
    <${Reel} mood=${mood} size=${150} />
    ${title && html`<h3>${title}</h3>`}
    ${text && html`<p class="muted">${text}</p>`}
    ${action}
  </div>`;
}

// ------------------------------------------------------------------ modal / sheet
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])';
/** Centered card on desktop, bottom sheet on phones. */
export function Modal({ open, onClose, title, children, wide, class: cls }) {
  const ref = useRef();
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    if (!open) return;
    const prev = document.activeElement;
    const inside = () => [...ref.current.querySelectorAll(FOCUSABLE)].filter(el => el.getClientRects().length);
    const onKey = e => {
      if (e.key === 'Escape') return close.current && close.current();
      if (e.key !== 'Tab' || !ref.current) return;
      // Tab and Shift+Tab cycle inside the dialog (arrow keys are left to focus.js)
      const f = inside(), first = f[0], last = f[f.length - 1], cur = document.activeElement;
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey ? (cur === first || !ref.current.contains(cur)) : (cur === last || !ref.current.contains(cur))) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      }
    };
    document.addEventListener('keydown', onKey);
    document.documentElement.classList.add('modal-open');
    const t = setTimeout(() => { const f = ref.current && inside()[0]; f && f.focus(); }, 30);
    return () => { clearTimeout(t); document.removeEventListener('keydown', onKey); document.documentElement.classList.remove('modal-open'); prev && prev.focus && prev.focus(); };
  }, [open]);
  if (!open) return null;
  return html`<div class="modal-scrim" onClick=${e => e.target === e.currentTarget && onClose && onClose()}>
    <div class=${cx('modal', wide && 'wide', cls)} role="dialog" aria-modal="true" aria-label=${title} ref=${ref}>
      <span class="tape top"></span>
      <div class="modal-head">
        ${title && html`<h2>${title}</h2>`}
        ${onClose && html`<${IconBtn} icon="close" label="Close" onClick=${onClose} />`}
      </div>
      <div class="modal-body">${children}</div>
    </div>
  </div>`;
}

// ------------------------------------------------------------------ toasts
const toastSubs = new Set();
let toastList = [];
/** toast('Added to watchlist', { icon: 'heart', kind: 'ok'|'warn'|'error', ms }) */
export function toast(text, { icon = 'sparkle', kind = 'ok', ms = 3200 } = {}) {
  const t = { id: Math.random(), text, icon, kind };
  toastList = [...toastList, t].slice(-4);
  toastSubs.forEach(f => f(toastList));
  setTimeout(() => { toastList = toastList.filter(x => x !== t); toastSubs.forEach(f => f(toastList)); }, ms);
}
export function Toasts() {
  const [list, set] = useState(toastList);
  useEffect(() => { toastSubs.add(set); return () => toastSubs.delete(set); }, []);
  return html`<div class="toasts" aria-live="polite">
    ${list.map(t => html`<div key=${t.id} class=${cx('toast ink-edge wide', t.kind)}><${Icon} name=${t.kind === 'error' ? 'warn' : t.icon} size=${20} /><span>${t.text}</span></div>`)}
  </div>`;
}

// ------------------------------------------------------------------ form bits
export function Field({ label, hint, children }) {
  return html`<label class="field"><span class="field-label">${label}</span>${children}${hint && html`<span class="field-hint faint">${hint}</span>`}</label>`;
}
export function Input(props) {
  return html`<span class="input ink-edge wide"><input ...${props} /></span>`;
}
export function Toggle({ checked, onChange, label }) {
  return html`<label class="toggle">
    <input type="checkbox" checked=${checked} onChange=${e => onChange(e.currentTarget.checked)} />
    <span class="toggle-track" aria-hidden="true"><span class="toggle-knob"></span></span>
    <span>${label}</span>
  </label>`;
}
export function Select({ value, onChange, options }) {
  return html`<span class="input select ink-edge wide"><select value=${value} onChange=${e => onChange(e.currentTarget.value)}>
    ${options.map(o => typeof o === 'string' ? html`<option value=${o}>${o}</option>` : html`<option value=${o.value}>${o.label}</option>`)}
  </select><${Icon} name="down" size=${16} /></span>`;
}

// ------------------------------------------------------------------ misc
/** Each page owns its stylesheet: call loadCSS('css/pages/home.css') at the top of the page module. */
export function loadCSS(href) {
  if (document.querySelector(`link[data-css="${href}"]`)) return;
  const l = document.createElement('link');
  l.rel = 'stylesheet'; l.href = href; l.dataset.css = href;
  document.head.appendChild(l);
}
export const fmtTime = s => {
  s = Math.max(0, Math.floor(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
};
export const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
export const shuffle = (a, r = Math.random) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
