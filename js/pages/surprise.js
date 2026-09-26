// Surprise Me: filters → a scratch card hiding a random pick → Play / Details / Again.
import { html, useState, useRef, useEffect } from '../../vendor/preact-htm.js';
import { Page, Btn, Chip, Img, DoodlePoster, Reel, ErrorNote, loadCSS, hrefTitle, cx } from '../ui/components.js';
import { catalog, posterOf, MOVIE_GENRES, SERIES_GENRES, ANIME_GENRES } from '../core/meta.js';

loadCSS('css/pages/surprise.css');

const TYPES = [{ id: 'movie', label: 'Movie' }, { id: 'series', label: 'Show' }, { id: 'anime', label: 'Anime' }];
const DECADES = [null, 1960, 1970, 1980, 1990, 2000, 2010, 2020];
const RATINGS = [0, 6, 7, 8];
const pick = a => a[Math.floor(Math.random() * a.length)];

async function draw({ type, genre, decade, minRating }) {
  let pool = [];
  if (type === 'anime') {
    const cat = pick(['kitsu-anime-popular', 'kitsu-anime-rating', 'kitsu-anime-airing']);
    pool = await catalog('anime', cat, { genre, skip: pick([0, 0, 20, 40]) });
  } else if (decade) {
    const years = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map(i => decade + i).filter(y => y <= new Date().getFullYear()).sort(() => Math.random() - .5).slice(0, 4);
    const res = await Promise.allSettled(years.map(y => catalog(type, 'year', { genre: y })));
    pool = res.flatMap(r => (r.status === 'fulfilled' ? r.value : []));
    if (genre) pool = pool.filter(m => (m.genres || []).includes(genre));
  } else {
    pool = await catalog(type, pick(['top', 'imdbRating']), { genre, skip: pick([0, 0, 100, 200]) });
  }
  if (minRating) pool = pool.filter(m => parseFloat(m.imdbRating) >= minRating);
  pool = pool.filter(m => m.poster);
  if (!pool.length) throw new Error('Nothing matches all of that. Loosen a filter and try again.');
  return pick(pool);
}

// ---------------------------------------------------------------- the scratch card
function ScratchCard({ item, onReveal, revealed }) {
  const canvas = useRef();
  useEffect(() => {
    const cv = canvas.current;
    if (!cv) return;
    const box = cv.getBoundingClientRect();
    const dpr = Math.min(2, devicePixelRatio || 1);
    cv.width = box.width * dpr; cv.height = box.height * dpr;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement);
    const v = n => css.getPropertyValue(n).trim();
    const W = box.width, H = box.height;
    // foil: accent base + pencil hatching + stars + label
    c.fillStyle = v('--a3'); c.fillRect(0, 0, W, H);
    c.strokeStyle = v('--line'); c.globalAlpha = .18; c.lineWidth = 1.4;
    for (let s = -H; s < W; s += 9) { c.beginPath(); c.moveTo(s, H); c.lineTo(s + H * .7, 0); c.stroke(); }
    c.globalAlpha = 1; c.fillStyle = v('--a1');
    for (let i = 0; i < 14; i++) { c.font = `${16 + (i % 3) * 8}px ${v('--font-display')}`; c.fillText('★', (i * 67) % W, 30 + ((i * 97) % (H - 40))); }
    c.fillStyle = v('--ink'); c.textAlign = 'center';
    c.font = `${Math.round(W / 6)}px ${v('--font-display')}`; c.fillText('scratch', W / 2, H / 2 - 6);
    c.font = `${Math.round(W / 10)}px ${v('--font-hand')}`; c.fillText('me! ✎', W / 2, H / 2 + W / 9);
    c.globalCompositeOperation = 'destination-out';

    let down = false, last = null, moves = 0;
    const at = e => { const r = cv.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    const scratch = (x, y) => {
      c.lineWidth = 42; c.lineCap = 'round';
      c.beginPath(); c.moveTo(...(last || [x, y])); c.lineTo(x, y); c.stroke();
      last = [x, y];
      if (++moves % 12 === 0 && cleared() > .5) onReveal();
    };
    const cleared = () => {
      const d = c.getImageData(0, 0, cv.width, cv.height).data;
      let clear = 0, n = 0;
      for (let i = 3; i < d.length; i += 4 * 97) { n++; if (d[i] < 40) clear++; }
      return clear / n;
    };
    const pd = e => { down = true; last = null; cv.setPointerCapture(e.pointerId); scratch(...at(e)); };
    const pm = e => down && scratch(...at(e));
    const pu = () => { down = false; last = null; };
    cv.addEventListener('pointerdown', pd); cv.addEventListener('pointermove', pm);
    cv.addEventListener('pointerup', pu); cv.addEventListener('pointercancel', pu);
    return () => { cv.removeEventListener('pointerdown', pd); cv.removeEventListener('pointermove', pm); cv.removeEventListener('pointerup', pu); cv.removeEventListener('pointercancel', pu); };
  }, [item && item.id]);

  return html`<div class="sur-card">
    <span class="tape tl"></span><span class="tape tr alt"></span>
    <div class="sur-photo">
      ${item ? html`<${Img} src=${posterOf(item)} alt=${revealed ? item.name : 'hidden pick'} fallback=${html`<${DoodlePoster} title=${item.name} />`} />` : null}
    </div>
    ${item && html`<canvas ref=${canvas} class=${cx('sur-foil', revealed && 'gone')} aria-hidden="true"></canvas>`}
  </div>`;
}

export default function Surprise() {
  const [f, setF] = useState({ type: 'movie', genre: '', decade: null, minRating: 7 });
  const [item, setItem] = useState(null);
  const [revealed, setRevealed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const set = patch => setF(x => ({ ...x, ...patch }));
  const genres = f.type === 'anime' ? ANIME_GENRES : f.type === 'series' ? SERIES_GENRES : MOVIE_GENRES;

  const roll = async () => {
    setBusy(true); setErr(null); setRevealed(false);
    try { setItem(await draw({ ...f, genre: f.genre || undefined })); }
    catch (e) { setErr(e); setItem(null); }
    finally { setBusy(false); }
  };

  const playHref = item && (item.type === 'movie' ? `#/watch/movie/${encodeURIComponent(item.id)}` : hrefTitle(item));
  return html`<${Page} title="Surprise Me" kicker="let the paper decide" icon="dice" class="sur-page">
    <div class="sur-layout">
      <section class="sur-filters panel">
        <span class="tape top alt"></span>
        <h3>Tonight I want…</h3>
        <div class="chips">${TYPES.map(t => html`<${Chip} active=${f.type === t.id} onClick=${() => set({ type: t.id, genre: '' })}>${t.label}<//>`)}</div>
        <div class="kicker type">genre</div>
        <div class="chips sur-genres">
          <${Chip} active=${!f.genre} onClick=${() => set({ genre: '' })}>anything<//>
          ${genres.map(g => html`<${Chip} active=${f.genre === g} onClick=${() => set({ genre: g })}>${g}<//>`)}
        </div>
        ${f.type !== 'anime' && html`<div class="kicker type">decade</div>
          <div class="chips">${DECADES.map(d => html`<${Chip} active=${f.decade === d} onClick=${() => set({ decade: d })}>${d ? `${d}s` : 'any'}<//>`)}</div>`}
        <div class="kicker type">at least</div>
        <div class="chips">${RATINGS.map(r => html`<${Chip} active=${f.minRating === r} onClick=${() => set({ minRating: r })}>${r ? `★ ${r}+` : 'any rating'}<//>`)}</div>
        <${Btn} variant="primary" size="lg" icon="dice" onClick=${roll} disabled=${busy} class="sur-roll">${busy ? 'Shuffling…' : item ? 'Deal another' : 'Deal me a card'}<//>
      </section>

      <section class="sur-stage" aria-live="polite">
        ${err ? html`<div class="stack"><${Reel} mood="confused" size=${130} /><${ErrorNote} error=${err} retry=${roll} /></div>`
          : !item ? html`<div class="sur-empty"><${Reel} mood=${busy ? 'think' : 'popcorn'} size=${150} /><p class="muted">${busy ? 'shuffling the deck…' : 'Pick your filters, then deal a card.'}</p></div>`
          : html`
            <${ScratchCard} item=${item} revealed=${revealed} onReveal=${() => setRevealed(true)} />
            ${!revealed ? html`<div class="cluster sur-actions"><span class="muted">Scratch the card, or</span><${Btn} icon="eye" onClick=${() => setRevealed(true)}>Reveal<//></div>`
              : html`<div class="sur-result">
                <h2>${item.name}</h2>
                <div class="type muted">${[item.year || item.releaseInfo, item.imdbRating && `★ ${item.imdbRating}`, (item.genres || []).slice(0, 3).join(' / ')].filter(Boolean).join('  ·  ')}</div>
                ${item.description && html`<p class="sur-desc">${item.description}</p>`}
                <div class="cluster">
                  <${Btn} variant="primary" icon="play" href=${playHref}>${item.type === 'movie' ? 'Play' : 'Start watching'}<//>
                  <${Btn} icon="info" href=${hrefTitle(item)}>Details<//>
                  <${Btn} variant="ghost" icon="refresh" onClick=${roll}>Again<//>
                </div>
              </div>`}`}
      </section>
    </div>
  <//>`;
}
