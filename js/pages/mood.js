// Mood Wheel: spin a hand-drawn wheel (or tap a chip) and get a "prescription" of titles.
import { html, useState, useMemo, useRef, useEffect } from '../../vendor/preact-htm.js';
import { Page, Grid, Chip, Icon, useAsync, loadCSS, ErrorNote, SectionTitle, cx } from '../ui/components.js';
import { rng, taper, hash, scribbleStroke } from '../ui/sketch.js';
import { pstore, useStore, activeProfile } from '../core/store.js';
import { catalog } from '../core/meta.js';
import { MOODS, resolveList } from '../lib/discover-lists.js';

loadCSS('css/pages/mood.css');

const lastMood = pstore('mood', null);
const N = MOODS.length, SEG = 360 / N, R = 190, C = 200;
const FILLS = ['var(--fill-1)', 'var(--fill-2)', 'var(--fill-3)', 'var(--fill-4)'];
const SHORT = { mind: 'Mind', cry: 'Cry', adrenaline: 'Rush', comfort: 'Comfort', date: 'Date', weird: '3AM', lol: 'LOL', edge: 'Tense', feelgood: 'Happy', epic: 'Epic' };
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches || document.documentElement.dataset.motion === 'reduce';

// a pen line from a to b with a slight bow
function handLine(ax, ay, bx, by, seed, w = 2.6) {
  const r = rng(seed), bow = (r() - .5) * 6, pts = [];
  const nx = -(by - ay), ny = bx - ax, d = Math.hypot(nx, ny) || 1;
  for (let i = 0; i <= 12; i++) {
    const t = i / 12, s = Math.sin(t * Math.PI) * bow + (r() - .5) * .8;
    pts.push([ax + (bx - ax) * t + nx / d * s, ay + (by - ay) * t + ny / d * s]);
  }
  return taper(pts, w, { r });
}
const polar = (deg, rad) => [C + Math.cos((deg - 90) * Math.PI / 180) * rad, C + Math.sin((deg - 90) * Math.PI / 180) * rad];

function Wheel({ rot, spinning, onSpin }) {
  const art = useMemo(() => {
    const wedges = MOODS.map((m, i) => {
      const a0 = i * SEG, a1 = a0 + SEG;
      const [x0, y0] = polar(a0, R), [x1, y1] = polar(a1, R);
      return `M${C} ${C}L${x0.toFixed(1)} ${y0.toFixed(1)}A${R} ${R} 0 0 1 ${x1.toFixed(1)} ${y1.toFixed(1)}Z`;
    });
    const spokes = MOODS.map((_, i) => { const [x, y] = polar(i * SEG, R + 2); return handLine(C, C, x, y, 40 + i); }).join('');
    return { wedges, spokes };
  }, []);
  return html`<div class="mood-wheel-wrap">
    <svg class="mood-pointer" viewBox="0 0 40 60" aria-hidden="true">
      <path d="M20 58 L6 14 Q20 2 34 14 Z" fill="var(--a1)" stroke="var(--line)" stroke-width="3" stroke-linejoin="round"/>
      <circle cx="20" cy="18" r="5" fill="var(--paper-3)" stroke="var(--line)" stroke-width="2.4"/>
    </svg>
    <svg class=${cx('mood-wheel', spinning && 'spinning')} viewBox="0 0 400 400" style=${`transform:rotate(${rot}deg)`} aria-hidden="true">
      <defs>
        <pattern id="mood-dots" width="7" height="7" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.1" fill="var(--line)" opacity=".18"/></pattern>
      </defs>
      <circle cx=${C} cy=${C} r=${R + 6} fill="var(--paper-3)"/>
      ${art.wedges.map((d, i) => html`<path d=${d} fill=${FILLS[i % 4]} opacity=".85"/><path d=${d} fill="url(#mood-dots)"/>`)}
      <path d=${art.spokes} fill="var(--line)"/>
      <path d=${scribbleStroke(400, 400, 7, 1.04)} fill="none" stroke="var(--line)" stroke-width="4" stroke-linecap="round" transform="translate(4 4) scale(.98)"/>
      ${MOODS.map((m, i) => {
        const mid = i * SEG + SEG / 2, [x, y] = polar(mid, R * .7);
        return html`<g transform=${`translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${mid})`}>
          <g transform="translate(-13 -30)"><${Icon} name=${m.icon} size=${26} /></g>
          <text y="16" text-anchor="middle" class="mood-seg-label">${SHORT[m.id] || m.label}</text>
        </g>`;
      })}
    </svg>
    <button type="button" class="mood-hub" onClick=${onSpin} disabled=${spinning} aria-label="Spin the mood wheel">
      <span class="display">${spinning ? '…' : 'spin!'}</span>
    </button>
  </div>`;
}

function Prescription({ mood, who }) {
  const today = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return html`<div class="mood-rx panel" key=${mood.id}>
    <span class="tape top"></span>
    <div class="spread mood-rx-head"><span class="mood-rx-sym display">℞</span><span class="type faint">Dr. Reel · ${today}</span></div>
    <div class="mood-rx-line"><span class="type faint">patient</span><span>${who}</span></div>
    <div class="mood-rx-line"><span class="type faint">feeling</span><span class="display mood-rx-mood" style=${`--mc:${mood.color}`}>${mood.label}</span></div>
    <div class="mood-rx-line"><span class="type faint">directions</span><span>${mood.rx}</span></div>
    <div class="mood-rx-line"><span class="type faint">dose</span><span>1 title, as needed. refills: unlimited</span></div>
    <svg class="mood-rx-sign" viewBox="0 0 160 40" aria-hidden="true"><path d="M6 28c10-20 18-22 16-6-1 9 8-14 14-12s-4 16 3 14 10-18 16-14-2 14 6 12c8-2 12-14 20-10s0 12 10 10 16-12 30-8" fill="none" stroke="var(--a2)" stroke-width="2.4" stroke-linecap="round"/></svg>
  </div>`;
}

function MoodResults({ mood }) {
  const curated = useAsync(() => resolveList(mood.titles), [mood.id]);
  const blend = useAsync(async () => {
    const lists = await Promise.allSettled(mood.genres.map(g => catalog('movie', 'imdbRating', { genre: g })));
    const all = lists.flatMap(r => (r.status === 'fulfilled' ? r.value.slice(0, 40) : []));
    const r = rng(hash(mood.id + new Date().toDateString()));
    return all.filter(m => r() > .4).slice(0, 36);
  }, [mood.id]);
  const seen = new Set((curated.data || []).map(m => m.id));
  const extra = (blend.data || []).filter(m => !seen.has(m.id));
  return html`
    <${SectionTitle} kicker="hand-picked" icon=${mood.icon}>${mood.label} picks<//>
    ${curated.error ? html`<${ErrorNote} error=${curated.error} retry=${curated.reload} />`
      : html`<${Grid} items=${curated.data || []} loading=${curated.loading} />`}
    ${(blend.loading || extra.length > 0) && html`<${SectionTitle} kicker="same vibe, more shelves" icon="layers">More ${mood.label.toLowerCase()}<//>
      <${Grid} items=${extra} loading=${blend.loading} size="sm" />`}
  `;
}

export default function Mood() {
  const saved = useStore(lastMood);
  const [rot, setRot] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [pick, setPick] = useState(saved);
  const mood = MOODS.find(m => m.id === pick);
  const timer = useRef();
  useEffect(() => () => clearTimeout(timer.current), []);

  const choose = id => { setPick(id); lastMood.set(id); };
  const spin = () => {
    const idx = Math.floor(Math.random() * N);
    const jitter = (Math.random() - .5) * SEG * .6;
    const target = rot - (rot % 360) + 360 * 6 + (360 - (idx * SEG + SEG / 2)) + jitter;
    if (reduced()) { setRot(target % 360); choose(MOODS[idx].id); return; }
    setSpinning(true); setRot(target);
    timer.current = setTimeout(() => { setSpinning(false); choose(MOODS[idx].id); }, 4300);
  };
  const who = (activeProfile() || {}).name || 'you';

  return html`<${Page} title="Mood Wheel" kicker="how are we feeling?" icon="wheel" class="mood-page">
    <div class="mood-top">
      <${Wheel} rot=${rot} spinning=${spinning} onSpin=${spin} />
      <div class="mood-side">
        ${mood ? html`<${Prescription} mood=${mood} who=${who} />`
          : html`<div class="sticky-note mood-hint"><p class="display" style="font-size:30px;margin:0">Spin it!</p><p>Or skip fate and pick a feeling below.</p></div>`}
        <div class="chips mood-chips" role="group" aria-label="Pick a mood">
          ${MOODS.map(m => html`<${Chip} active=${m.id === pick} icon=${m.icon} color=${m.color} onClick=${() => choose(m.id)}>${m.label}<//>`)}
        </div>
      </div>
    </div>
    ${mood && html`<${MoodResults} key=${mood.id} mood=${mood} />`}
  <//>`;
}
