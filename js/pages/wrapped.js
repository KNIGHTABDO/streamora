// Year in Review: a full-screen story of cards, each printed in a different look, ending with a shareable PNG.
import { html, useState, useEffect, useMemo, useRef } from '../../vendor/preact-htm.js';
import { Btn, IconBtn, Icon, Img, DoodlePoster, Stars, Spinner, Reel, Select, useAsync, loadCSS, cx, toast, plural } from '../ui/components.js';
import { diary, history, progress, useStore } from '../core/store.js';
import { posterOf } from '../core/meta.js';
import { summary, loadGenres, years, demoData } from '../lib/stats.js';
import { roughRect, underlinePath, hash } from '../ui/sketch.js';
import { back } from '../router.js';

loadCSS('css/pages/wrapped.css');

const CARD_MS = 6500;
const fmtH = h => (h >= 10 ? Math.round(h).toLocaleString() : h.toFixed(1));

function cards(s) {
  const hours = s.seconds / 3600;
  const list = [
    { id: 'intro', theme: 'ink', mood: 'wave', body: html`
      <div class="wr-kicker type">Streamora presents</div>
      <h1 class="wr-huge">Your <span class="mark">${s.year}</span>,<br/>drawn.</h1>
      <p class="wr-sub">${plural(s.titles, 'title')} finished. Let's flip through it.</p>` },
    { id: 'hours', theme: 'riso', mood: 'popcorn', body: html`
      <div class="wr-kicker type">time on the couch</div>
      <div class="wr-num display">${fmtH(hours)}</div>
      <h2>hours watched</h2>
      <p class="wr-sub">That's about ${Math.max(1, Math.round(hours / 2))} movie nights, or ${Math.max(1, Math.round(hours / 24))} ${Math.round(hours / 24) === 1 ? 'full day' : 'full days'} without blinking.</p>
      <p class="wr-sub type">${s.movies} movies · ${s.episodes} episodes</p>` },
  ];
  if (s.top[0]) list.push({ id: 'top', theme: 'doodle', mood: 'love', body: html`
      <div class="wr-kicker type">your number one</div>
      <div class="wr-polaroid"><span class="tape top"></span><${Img} src=${posterOf(s.top[0])} alt="" fallback=${html`<${DoodlePoster} title=${s.top[0].name} />`} /></div>
      <h2 class="wr-title">${s.top[0].name}</h2>
      <p class="wr-sub">${s.top[0].type === 'movie' ? `Watched ${s.top[0].count === 1 ? 'once, and it stuck' : s.top[0].count + ' times'}.` : `${plural(s.top[0].count, 'episode')} finished.`}</p>` });
  if (s.genres[0]) list.push({ id: 'genre', theme: 'pencil', mood: 'think', body: html`
      <div class="wr-kicker type">you kept coming back to</div>
      <h1 class="wr-huge wr-genre">${s.genres[0][0]}</h1>
      <ol class="wr-bars">${s.genres.slice(0, 4).map(([g, n], i) => html`<li style=${`--w:${(n / s.genres[0][1]) * 100}%`}><span>${i + 1}. ${g}</span><i></i></li>`)}</ol>` });
  if (s.fav) list.push({ id: 'time', theme: 'blueprint', mood: /night/.test(s.fav.part) ? 'sleep' : 'happy', body: html`
      <div class="wr-kicker type">your favourite slot</div>
      <h1 class="wr-huge">${s.fav.day}<br/><span class="mark">${s.fav.part}s</span></h1>
      <p class="wr-sub">${/night/.test(s.fav.part) ? 'The best stories come out after dark.' : 'A well-planned viewer.'}</p>
      ${s.streak.longest > 1 && html`<p class="wr-sub type">longest streak: ${s.streak.longest} days in a row</p>`}` });
  if (s.binge && s.binge.count > 1) list.push({ id: 'binge', theme: 'riso', mood: 'yawn', body: html`
      <div class="wr-kicker type">the big binge</div>
      <div class="wr-num display">${s.binge.count}</div>
      <h2>episodes of ${s.binge.name}</h2>
      <p class="wr-sub">…in a single day (${new Date(s.binge.day + 'T12:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric' })}). Respect.</p>` });
  if (s.newShows.length) list.push({ id: 'new', theme: 'ink', mood: 'binoculars', body: html`
      <div class="wr-kicker type">fresh starts</div>
      <div class="wr-num display">${s.newShows.length}</div>
      <h2>new ${s.newShows.length === 1 ? 'show' : 'shows'} started</h2>
      <div class="wr-collage">${s.newShows.slice(0, 6).map((x, i) => html`<span style=${`--r:${(hash(x.id) % 13) - 6}deg`}><${Img} src=${posterOf(x)} alt=${x.name} fallback=${html`<${DoodlePoster} title=${x.name} />`} /></span>`)}</div>` });
  list.push(s.best ? { id: 'best', theme: 'doodle', mood: 'party', body: html`
      <div class="wr-kicker type">top of your diary</div>
      <div class="wr-polaroid small"><span class="tape top alt"></span><${Img} src=${posterOf(s.best)} alt="" fallback=${html`<${DoodlePoster} title=${s.best.name} />`} /></div>
      <h2 class="wr-title">${s.best.name}</h2>
      <${Stars} value=${s.best.rating} size=${34} />
      ${s.best.note && html`<p class="wr-sub wr-quote">“${s.best.note}”</p>`}` }
    : { id: 'best', theme: 'pencil', mood: 'confused', body: html`
      <div class="wr-kicker type">top of your diary</div>
      <h2>No stars handed out yet</h2>
      <p class="wr-sub">Rate what you watch in the Diary and next year's card writes itself.</p>` });
  list.push({ id: 'sum', theme: 'ink', mood: 'party', summary: true });
  return list;
}

// ---- the shareable PNG, drawn by hand on a canvas
function tokens() {
  const cs = getComputedStyle(document.querySelector('.wr-card.sum') || document.documentElement);
  const g = n => cs.getPropertyValue('--' + n).trim();
  return { paper: g('paper') || '#f3e6cf', paper3: g('paper-3') || '#fff8ea', ink: g('ink') || '#1e1630', ink2: g('ink-2') || '#4a3d52', a1: g('a1'), a2: g('a2'), a3: g('a3'), a4: g('a4') };
}
function svgToImage(svg) {
  const cs = getComputedStyle(svg);
  const src = new XMLSerializer().serializeToString(svg).replace(/var\(--([a-z0-9-]+)\)/g, (_, n) => cs.getPropertyValue('--' + n).trim() || '#000');
  return new Promise(res => { const im = new Image(); im.onload = () => res(im); im.onerror = () => res(null); im.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(src); });
}
export async function drawSummary(s) {
  await document.fonts.ready;
  const W = 1080, H = 1350, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d'), t = tokens();
  x.fillStyle = t.paper; x.fillRect(0, 0, W, H);
  x.fillStyle = t.ink + '22';
  for (let yy = 0; yy < H; yy += 14) for (let xx = (yy / 14) % 2 ? 7 : 0; xx < W; xx += 14) { x.beginPath(); x.arc(xx, yy, 1.8, 0, 7); x.fill(); }
  x.fillStyle = t.paper3; x.fillRect(60, 60, W - 120, H - 120);
  x.fillStyle = t.ink; x.fill(new Path2D(roughRect(W, H, 7, { inset: 60, sw: 7, amp: 3, over: 14 })));
  const mark = (tx, y, w, h, col) => { x.save(); x.fillStyle = col; x.globalAlpha = .55; x.translate(tx, y); x.rotate(-.015); x.fillRect(-8, -h * .55, w + 16, h * .6); x.restore(); };
  x.textBaseline = 'alphabetic';
  x.font = '38px "Special Elite", monospace'; x.fillStyle = t.ink2; x.fillText('✎ year in review', 120, 180);
  x.font = '120px "Caveat Brush", cursive'; x.fillStyle = t.ink;
  const title = `My ${s.year}`; mark(120, 300, x.measureText(title).width, 110, t.a3); x.fillText(title, 120, 300);
  x.font = '64px "Caveat Brush", cursive'; x.fillText('in Streamora', 120, 380);
  x.save(); x.translate(120, 392); x.scale((x.measureText('in Streamora').width) / 300, 2); x.fillStyle = t.a1; x.fill(new Path2D(underlinePath(300, 3))); x.restore();
  const rows = [
    [fmtH(s.seconds / 3600), 'hours watched', t.a3], [String(s.movies), 'movies', t.a1], [String(s.episodes), 'episodes', t.a2],
    [s.top[0] ? s.top[0].name : '—', 'number one', t.a4], [s.genres[0] ? s.genres[0][0] : '—', 'top genre', t.a3],
    [s.fav ? `${s.fav.day} ${s.fav.part}s` : '—', 'favourite slot', t.a1],
  ];
  let y = 500;
  for (const [big, label, col] of rows) {
    x.font = '76px "Caveat Brush", cursive';
    let b = big; while (x.measureText(b).width > 620 && b.length > 4) b = b.slice(0, -2);
    if (b !== big) b = b.trimEnd() + '…';
    mark(120, y, Math.min(620, x.measureText(b).width), 70, col);
    x.fillStyle = t.ink; x.fillText(b, 120, y);
    x.font = '34px "Patrick Hand", cursive'; x.fillStyle = t.ink2; x.fillText(label, 120, y + 44);
    y += 118;
  }
  const reel = document.querySelector('.wr-card.sum .reel');
  if (reel) { const im = await svgToImage(reel); if (im) x.drawImage(im, W - 420, H - 470, 330, 340); }
  x.font = '30px "Special Elite", monospace'; x.fillStyle = t.ink2; x.fillText('streamora · drawn by hand', 120, H - 110);
  return new Promise(res => c.toBlob(res, 'image/png'));
}

async function sharePNG(s) {
  const blob = await drawSummary(s);
  if (!blob) return toast('Could not draw the card', { kind: 'error' });
  const file = new File([blob], `streamora-${s.year}.png`, { type: 'image/png' });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: `My ${s.year} in Streamora` }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: file.name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 3000);
  toast('Saved your year card', { icon: 'download' });
}

function Summary({ s }) {
  const [busy, setBusy] = useState(false);
  return html`<div class="wr-kicker type">that's a wrap</div>
    <h1 class="wr-huge">My ${s.year}</h1>
    <ul class="wr-sum">
      <li><b class="display">${fmtH(s.seconds / 3600)}</b> hours</li>
      <li><b class="display">${s.movies}</b> movies</li>
      <li><b class="display">${s.episodes}</b> episodes</li>
      ${s.top[0] && html`<li class="wide"><b class="display">${s.top[0].name}</b> number one</li>`}
      ${s.genres[0] && html`<li class="wide"><b class="display">${s.genres[0][0]}</b> top genre</li>`}
    </ul>
    <div class="cluster wr-actions" onClick=${e => e.stopPropagation()} onPointerDown=${e => e.stopPropagation()}>
      <${Btn} variant="primary" icon="share" disabled=${busy} onClick=${async () => { setBusy(true); try { await sharePNG(s); } finally { setBusy(false); } }}>${busy ? 'Drawing…' : 'Share my year'}<//>
    </div>`;
}

function Story({ s, onClose, onYear, yearsList }) {
  const list = useMemo(() => cards(s), [s]);
  const [i, setI] = useState(0);
  const [paused, setPaused] = useState(false);
  const down = useRef(null);
  const go = d => setI(v => Math.max(0, Math.min(list.length - 1, v + d)));
  useEffect(() => setI(0), [s.year, s.demo]);
  useEffect(() => {
    const on = e => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); go(1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(-1); }
      else if (e.key === 'Escape') onClose();
    };
    addEventListener('keydown', on);
    return () => removeEventListener('keydown', on);
  }, [list.length]);
  const card = list[i];
  const last = i === list.length - 1;
  return html`<div class="wr-stage" data-own-arrows data-focus-scope>
    <div class="wr-top">
      <div class="wr-bars-prog" aria-hidden="true">
        ${list.map((c, k) => html`<span class=${cx('wr-seg', k < i && 'done', k === i && 'now', paused && 'paused')} key=${k === i ? `now${i}` : k}>
          <i style=${k === i ? `animation-duration:${CARD_MS}ms` : ''} onAnimationEnd=${() => !last && go(1)}></i>
        </span>`)}
      </div>
      <div class="spread">
        <${Select} value=${String(s.demo ? 'demo' : s.year)} onChange=${onYear} options=${[...yearsList.map(y => ({ value: String(y), label: String(y) })), ...(s.demo ? [{ value: 'demo', label: 'Demo' }] : [])]} />
        <div class="cluster">
          <${IconBtn} icon=${paused ? 'play' : 'pause'} label=${paused ? 'Resume' : 'Pause'} onClick=${() => setPaused(p => !p)} />
          <${IconBtn} icon="close" label="Close" onClick=${onClose} />
        </div>
      </div>
    </div>
    <section class=${cx('wr-card', card.id)} data-theme=${card.theme} key=${card.id + s.year}
      onPointerDown=${e => { down.current = { x: e.clientX, y: e.clientY, t: Date.now() }; setPaused(true); }}
      onPointerUp=${e => {
        const d = down.current; down.current = null; setPaused(false);
        if (!d || e.target.closest('button, a, select')) return;
        const dx = e.clientX - d.x;
        if (Math.abs(dx) > 50) return go(dx < 0 ? 1 : -1);
        if (Date.now() - d.t < 350) { const r = e.currentTarget.getBoundingClientRect(); go(e.clientX - r.left < r.width / 3 ? -1 : 1); }
      }}
      onPointerCancel=${() => { down.current = null; setPaused(false); }}>
      <div class="wr-card-inner halftone">
        <div class="wr-body">${card.summary ? html`<${Summary} s=${s} />` : card.body}</div>
        <div class="wr-reel"><${Reel} mood=${card.mood} size=${130} /></div>
        <span class="wr-count type">${i + 1} / ${list.length}</span>
      </div>
    </section>
    <button type="button" class="wr-nav prev" aria-label="Previous card" onClick=${() => go(-1)} disabled=${i === 0}><${Icon} name="back" size=${28} /></button>
    <button type="button" class="wr-nav next" aria-label="Next card" onClick=${() => go(1)} disabled=${last}><${Icon} name="next" size=${28} /></button>
  </div>`;
}

export default function Wrapped({ query }) {
  const prog = useStore(progress), hist = useStore(history), dia = useStore(diary);
  const yearsList = years(prog, hist, dia);
  const [pick, setPick] = useState(query.demo ? 'demo' : String(query.year || yearsList[0]));
  const demo = pick === 'demo';
  const year = demo ? new Date().getFullYear() : +pick;
  const data = useMemo(() => (demo ? demoData(year) : { progress: prog, history: hist, diary: dia }), [demo, year, prog, hist, dia]);
  const genres = useAsync(() => (demo ? data.genreMap : loadGenres(data.history.filter(h => new Date(h.at).getFullYear() === year))), [demo, year, hist.length]);
  const s = useMemo(() => ({ ...summary(data, year, genres.data || {}), demo }), [data, year, genres.data]);
  const close = () => back('#/diary');

  useEffect(() => { document.documentElement.classList.add('wr-open'); return () => document.documentElement.classList.remove('wr-open'); }, []);

  if (genres.loading) return html`<div class="wr-stage wr-center"><${Spinner} label="gathering your year…" /></div>`;
  if (s.active < 3 && !demo) return html`<div class="wr-stage wr-center" data-theme="pencil">
    <div class="wr-empty panel">
      <span class="tape top"></span>
      <${Reel} mood="sleep" size=${150} />
      <h2>Come back after a few movies</h2>
      <p class="muted">Your ${year} in review draws itself from what you watch. There isn't enough ink on the page yet.</p>
      <div class="cluster" style="justify-content:center">
        <${Btn} variant="primary" icon="sparkle" onClick=${() => setPick('demo')}>Show me a demo<//>
        <${Btn} variant="ghost" icon="back" onClick=${close}>Back<//>
      </div>
      ${yearsList.length > 1 && html`<div class="cluster" style="justify-content:center">${yearsList.filter(y => y !== year).map(y => html`<${Btn} size="sm" onClick=${() => setPick(String(y))}>${y}<//>`)}</div>`}
    </div>
  </div>`;
  return html`<${Story} s=${s} onClose=${close} onYear=${setPick} yearsList=${yearsList} />`;
}
