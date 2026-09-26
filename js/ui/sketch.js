// Hand-drawn geometry. Seeded, so a drawing is the same every time it's shown ("a held drawing holds its marks").
// - installSketch(): puts the boiling border masks + paper texture into CSS variables (called once at startup)
// - roughRect / scribbleLoop / underlinePath / taper: SVG path strings for inline drawings
import { html } from '../../vendor/preact-htm.js';

export function rng(seed) {
  let a = typeof seed === 'string' ? hash(seed) : seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function hash(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
/** deterministic tilt in degrees for an id, e.g. poster cards */
export const tiltOf = (id, max = 2.2) => ((hash(String(id)) % 1000) / 1000 * 2 - 1) * max;

const f = n => Math.round(n * 10) / 10;

/**
 * Pressure-tapered stroke: points [[x,y],...] -> closed filled outline.
 * width(t) peaks mid-stroke and thins at both ends like a pen line.
 */
export function taper(pts, w = 3, { start = .25, end = .15, r = Math.random } = {}) {
  if (pts.length < 2) return '';
  const L = [], R = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    const [x, y] = pts[i];
    const [px, py] = pts[Math.max(0, i - 1)], [nx, ny] = pts[Math.min(n - 1, i + 1)];
    let dx = nx - px, dy = ny - py; const d = Math.hypot(dx, dy) || 1; dx /= d; dy /= d;
    const pressure = Math.min(1, t / start, (1 - t) / end) ** .6;
    const ww = (w / 2) * (.25 + .75 * pressure) * (.85 + r() * .3);
    L.push([x - dy * ww, y + dx * ww]); R.push([x + dy * ww, y - dx * ww]);
  }
  const all = [...L, ...R.reverse()];
  return 'M' + all.map(([x, y]) => `${f(x)} ${f(y)}`).join('L') + 'Z';
}

// a slightly bowed line from a to b, sampled into points
function wobblyLine(ax, ay, bx, by, r, amp = 1.4, steps = 10) {
  const bow = (r() - .5) * amp * 2;
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s = Math.sin(t * Math.PI);
    const nx = -(by - ay), ny = bx - ax, d = Math.hypot(nx, ny) || 1;
    const j = (r() - .5) * amp * .5;
    pts.push([ax + (bx - ax) * t + (nx / d) * (bow * s + j), ay + (by - ay) * t + (ny / d) * (bow * s + j)]);
  }
  return pts;
}

/**
 * A box drawn as four separate pen strokes that overshoot the corners a little.
 * Returns a filled path (use fill="currentColor").
 */
export function roughRect(w, h, seed = 1, { inset = 4, sw = 3, over = 5, amp = 1.6 } = {}) {
  const r = rng(seed);
  const x0 = inset, y0 = inset, x1 = w - inset, y1 = h - inset;
  const o = () => (r() - .3) * over;
  const sides = [
    [x0 - o(), y0 + (r() - .5) * 2, x1 + o(), y0 + (r() - .5) * 2],
    [x1 + (r() - .5) * 2, y0 - o(), x1 + (r() - .5) * 2, y1 + o()],
    [x1 + o(), y1 + (r() - .5) * 2, x0 - o(), y1 + (r() - .5) * 2],
    [x0 + (r() - .5) * 2, y1 + o(), x0 + (r() - .5) * 2, y0 - o()],
  ];
  return sides.map(([a, b, c, d]) => taper(wobblyLine(a, b, c, d, r, amp, 14), sw * (.8 + r() * .4), { r })).join('');
}

/** loose circle scribbled around a w×h box (1.15 turns, doesn't close cleanly) */
export function scribbleLoop(w, h, seed = 1, { sw = 3.4, turns = 1.18 } = {}) {
  const r = rng(seed);
  const cx = w / 2, cy = h / 2, rx = w / 2 - 6, ry = h / 2 - 6;
  const a0 = -Math.PI * (.55 + r() * .3), pts = [], steps = 64;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps, a = a0 + t * Math.PI * 2 * turns;
    const k = 1 + (r() - .5) * .03 + t * .04;
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return taper(pts, sw, { r, start: .08, end: .3 });
}

/** single stroke path (for stroke-dasharray draw-on animations). Memoized by args: cards re-render often. */
const strokeMemo = new Map();
export function scribbleStroke(w, h, seed = 1, turns = 1.15) {
  const k = `${w}|${h}|${seed}|${turns}`;
  let d = strokeMemo.get(k);
  if (d == null) { if (strokeMemo.size > 2000) strokeMemo.clear(); strokeMemo.set(k, d = drawStroke(w, h, seed, turns)); }
  return d;
}
function drawStroke(w, h, seed, turns) {
  const r = rng(seed);
  const cx = w / 2, cy = h / 2, rx = w / 2 - 5, ry = h / 2 - 5;
  const a0 = -Math.PI * (.6 + r() * .2);
  let d = '';
  for (let i = 0; i <= 48; i++) {
    const t = i / 48, a = a0 + t * Math.PI * 2 * turns, k = 1 + (r() - .5) * .04 + t * .05;
    d += `${i ? 'L' : 'M'}${f(cx + Math.cos(a) * rx * k)} ${f(cy + Math.sin(a) * ry * k)}`;
  }
  return d;
}

/** marker underline under text, width w */
export function underlinePath(w, seed = 1, { sw = 4, h = 10 } = {}) {
  const r = rng(seed);
  const pts = wobblyLine(2, h * .55 + r() * 2, w - 2, h * .35 + r() * 3, r, 2.2, 18);
  return taper(pts, sw, { r, start: .05, end: .35 });
}

/** zig-zag scribble fill (hatch) inside w×h, used for skeletons and "coloured-in" marks */
export function hatch(w, h, seed = 1, { gap = 7, angle = -35 } = {}) {
  const r = rng(seed);
  const rad = angle * Math.PI / 180, cos = Math.cos(rad), sin = Math.sin(rad);
  const diag = Math.hypot(w, h);
  let d = '';
  for (let s = -diag; s < diag; s += gap) {
    const j = (r() - .5) * 2;
    const x1 = w / 2 + cos * -diag - sin * (s + j), y1 = h / 2 + sin * -diag + cos * (s + j);
    const x2 = w / 2 + cos * diag - sin * (s + j), y2 = h / 2 + sin * diag + cos * (s + j);
    d += `M${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}`;
  }
  return d;
}

const svgURL = (w, h, body) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 ${w} ${h}' preserveAspectRatio='none'>${body}</svg>`)}")`;

export function installSketch() {
  const root = document.documentElement.style;
  // three drawings per shape = the boil cycle
  const shapes = { edge: [200, 240, 3.2], wedge: [400, 96, 4.4], tedge: [140, 320, 3.4] };
  for (const [name, [w, h, sw]] of Object.entries(shapes)) {
    ['a', 'b', 'c'].forEach((v, i) => {
      root.setProperty(`--${name}-${v}`, svgURL(w, h, `<path fill='black' d='${roughRect(w, h, hash(name) + i * 97, { inset: 4, sw, amp: name === 'wedge' ? 1.1 : 1.6 })}'/>`));
    });
  }
  // paper: fractal noise + a few fibres, multiplied over the page colour
  const tex = `<filter id='n'><feTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3' seed='7'/><feColorMatrix values='0 0 0 0 .45 0 0 0 0 .38 0 0 0 0 .3 0 0 0 .55 0'/></filter>` +
    `<filter id='m'><feTurbulence type='fractalNoise' baseFrequency='.012' numOctaves='2' seed='3'/><feColorMatrix values='0 0 0 0 .6 0 0 0 0 .5 0 0 0 0 .38 0 0 0 .22 0'/></filter>` +
    `<rect width='360' height='360' filter='url(#m)'/><rect width='360' height='360' filter='url(#n)' opacity='.5'/>`;
  root.setProperty('--paper-tex', svgURL(360, 360, tex));
}

// ---------- small inline drawing components ----------

/** Scribbled loop around its parent on hover/focus. Parent needs position:relative + class "has-scribble". */
export function Scribble({ seed = 1, color = 'var(--a1)' }) {
  return html`<svg class="scribble" viewBox="0 0 200 120" preserveAspectRatio="none" aria-hidden="true">
    <path d=${scribbleStroke(200, 120, seed)} fill="none" stroke=${color} stroke-width="3.2" stroke-linecap="round" pathLength="1"/>
  </svg>`;
}

/** Marker underline that can show progress (0..1). */
export function Underline({ seed = 1, pct = 1, color = 'var(--a1)', track = true, class: cls = '' }) {
  const d = underlinePath(300, seed);
  return html`<svg class=${'underline ' + cls} viewBox="0 0 300 10" preserveAspectRatio="none" aria-hidden="true">
    ${track && html`<path d=${d} fill="var(--ink-3)" opacity=".35"/>`}
    <clipPath id=${'u' + seed}><rect width=${300 * Math.max(0, Math.min(1, pct))} height="10"/></clipPath>
    <path d=${d} fill=${color} clip-path=${`url(#u${seed})`}/>
  </svg>`;
}
