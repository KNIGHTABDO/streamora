// Hand-drawn profile avatars: 20 original characters, inked over a wobbly blob in the profile colour.
// Contract used across the app:
//   AVATARS: [{ id, name }]
//   <Avatar id="cat" size={48} ink="#ff4f79" />   ink = profile colour (background blob)
import { html } from '../../vendor/preact-htm.js';
import { rng, taper, hash } from './sketch.js';

export const INKS = ['#ff4f79', '#2b5fb8', '#ffd23f', '#1fb58f', '#c8473f', '#9b6bd6', '#ff8a3d', '#5ec8e5'];

const K = 'var(--line)';          // ink
const W = '#fff8ea';              // paper white (illustration colour, same in every theme)
const B = '#1e1630';              // pupils: always dark so faces read on any blob

// wobbly closed blob + pressure-tapered outline, seeded per avatar so it never "swims"
function blob(seed) {
  const r = rng(seed), pts = [], n = 28;
  const a0 = r() * Math.PI * 2;
  for (let i = 0; i <= n; i++) {
    const a = a0 + (i / n) * Math.PI * 2;
    const k = 43 + Math.sin(a * 3 + seed) * 1.6 + (r() - .5) * 1.2;
    pts.push([50 + Math.cos(a) * k, 50 + Math.sin(a) * k]);
  }
  const fill = 'M' + pts.map(([x, y]) => `${x.toFixed(1)} ${y.toFixed(1)}`).join('L') + 'Z';
  const line = taper(pts.concat([pts[1], pts[2]]), 3.6, { r, start: .05, end: .12 });
  return { fill, line };
}

// shared face bits
const eyes = (lx, rx, y, r = 3.6) => html`<circle cx=${lx} cy=${y} r=${r} fill=${B}/><circle cx=${rx} cy=${y} r=${r} fill=${B}/><circle cx=${lx + 1.2} cy=${y - 1.3} r=${r * .35} fill=${W}/><circle cx=${rx + 1.2} cy=${y - 1.3} r=${r * .35} fill=${W}/>`;
const blush = (lx, rx, y) => html`<ellipse cx=${lx} cy=${y} rx="4.5" ry="2.6" fill="#ff7a9a" opacity=".55"/><ellipse cx=${rx} cy=${y} rx="4.5" ry="2.6" fill="#ff7a9a" opacity=".55"/>`;
const smile = (x, y, w = 5) => html`<path d=${`M${x - w} ${y} Q${x} ${y + w * .9} ${x + w} ${y}`} fill="none" stroke=${B} stroke-width="2.4" stroke-linecap="round"/>`;

// Each drawing: 100×100 space, strokes use class "av-l" (ink line).
const DRAW = {
  cat: () => html`
    <path class="av-l" d="M27 46 24 19l17 12c6-2 12-2 18 0l17-12-3 27c4 16-6 31-24 31S23 62 27 46z" fill="#f4b860"/>
    <path d="M28 25l8 8M72 25l-8 8" stroke="#ff9aa9" stroke-width="3.5" stroke-linecap="round"/>
    <path d="M42 31c2 4 2 7 1 10M50 30v9M58 31c-2 4-2 7-1 10" stroke="#c98a30" stroke-width="2.2" stroke-linecap="round" fill="none"/>
    ${eyes(40, 60, 51)}
    <path d="M47.5 58.5h5l-2.5 3z" fill="#ff7a9a" stroke=${B} stroke-width="1.2" stroke-linejoin="round"/>
    <path d="M44 63.5q3 3.6 6 0q3 3.6 6 0" fill="none" stroke=${B} stroke-width="2" stroke-linecap="round"/>
    <path class="av-l" d="M22 56l13 2M22 63l13-1M78 56l-13 2M78 63l-13-1" fill="none"/>`,
  ghost: () => html`
    <path class="av-l" d="M28 80V45c0-14 9-24 22-24s22 10 22 24v35l-6-6-5.5 6-5.5-6-5 6-5.5-6-5.5 6-6-6z" fill=${W}/>
    <ellipse cx="41" cy="46" rx="4" ry="6" fill=${B}/><ellipse cx="59" cy="46" rx="4" ry="6" fill=${B}/>
    <ellipse cx="50" cy="59" rx="3.4" ry="4.4" fill=${B}/>
    ${blush(35, 65, 54)}
    <path d="M66 32c2 2 3 5 3 8" stroke="#b9c7ff" stroke-width="3" fill="none" stroke-linecap="round"/>`,
  robot: () => html`
    <path class="av-l" d="M50 23V15" fill="none"/><circle cx="50" cy="13" r="4" fill="#ff4f79" class="av-l"/>
    <path class="av-l" d="M26 31c0-3 2-5 5-5h38c3 0 5 2 5 5v33c0 3-2 5-5 5H31c-3 0-5-2-5-5z" fill="#c9d3dc"/>
    <path class="av-l" d="M20 42v14M80 42v14" fill="none"/>
    <path class="av-l" d="M33 35h34v18H33z" fill="#23304a"/>
    <path d="M38 44q3-4 6 0M56 44q3-4 6 0" stroke="#7fe7ff" stroke-width="2.6" fill="none" stroke-linecap="round"/>
    <path class="av-l" d="M37 60h26" fill="none"/><path d="M42 57v6M48 57v6M54 57v6M60 57v6" stroke=${K} stroke-width="1.6"/>
    <circle cx="31" cy="30" r="1.5" fill=${K}/><circle cx="69" cy="30" r="1.5" fill=${K}/>`,
  fox: () => html`
    <path class="av-l" d="M21 24l17 13c8-3 16-3 24 0l17-13-4 30c-3 14-13 24-25 24S28 68 25 54z" fill="#ff8a3d"/>
    <path d="M26 30l8 6M74 30l-8 6" stroke="#6b2f12" stroke-width="3" stroke-linecap="round"/>
    <path class="av-l" d="M30 55c7 1 13 5 20 12 7-7 13-11 20-12-3 13-11 22-20 22s-17-9-20-22z" fill=${W}/>
    ${eyes(40, 60, 49, 3.4)}
    <path d="M46 64h8l-4 4z" fill=${B}/>
    <path d="M50 68v3" stroke=${B} stroke-width="1.8"/>`,
  onion: () => html`
    <path class="av-l" d="M50 20c-3 6-10 10-17 17-9 9-10 24-2 33 5 6 12 9 19 9s14-3 19-9c8-9 7-24-2-33-7-7-14-11-17-17z" fill="#e0c3ee"/>
    <path d="M50 22c-8 14-14 30-8 55M50 22c8 14 14 30 8 55" stroke="#a974c4" stroke-width="1.8" fill="none"/>
    <path d="M50 21c-2-6-1-11 2-14M50 21c3-5 7-7 11-7" fill="none" stroke="#4d9a45" stroke-width="3"/>
    ${eyes(42, 58, 54, 3.2)}
    <path d="M44 63q6 4 12 0" fill="none" stroke=${B} stroke-width="2.2" stroke-linecap="round"/>
    <path d="M38 60q-1 4 0 6" stroke="#5ec8e5" stroke-width="2.4" fill="none" stroke-linecap="round"/>`,
  cassette: () => html`
    <path class="av-l" d="M18 32c0-2 2-4 4-4h56c2 0 4 2 4 4v38c0 2-2 4-4 4H22c-2 0-4-2-4-4z" fill="#3a3550"/>
    <path class="av-l" d="M25 34h50v22H25z" fill="#ffd23f"/>
    <circle cx="38" cy="46" r="6.5" fill=${W} class="av-l"/><circle cx="62" cy="46" r="6.5" fill=${W} class="av-l"/>
    <circle cx="39" cy="46" r="2.6" fill=${B}/><circle cx="63" cy="46" r="2.6" fill=${B}/>
    <path d="M28 38h18M54 38h18" stroke="#ff4f79" stroke-width="2"/>
    <path class="av-l" d="M32 74l4-10h28l4 10" fill="#5a5470"/>
    <path d="M44 67q6 4 12 0" fill="none" stroke=${W} stroke-width="2.2" stroke-linecap="round"/>`,
  frog: () => html`
    <circle cx="35" cy="33" r="10" fill="#7ccf6a" class="av-l"/><circle cx="65" cy="33" r="10" fill="#7ccf6a" class="av-l"/>
    <path class="av-l" d="M20 56c0-14 13-22 30-22s30 8 30 22-13 22-30 22-30-8-30-22z" fill="#7ccf6a"/>
    <circle cx="35" cy="32" r="5.5" fill=${W}/><circle cx="65" cy="32" r="5.5" fill=${W}/>
    <circle cx="36" cy="33" r="3" fill=${B}/><circle cx="66" cy="33" r="3" fill=${B}/>
    <path d="M30 58q20 14 40 0" fill="none" stroke=${B} stroke-width="2.6" stroke-linecap="round"/>
    ${blush(28, 72, 54)}
    <circle cx="44" cy="48" r="1.3" fill=${B}/><circle cx="56" cy="48" r="1.3" fill=${B}/>`,
  octopus: () => html`
    <path class="av-l" d="M26 50c0-17 10-28 24-28s24 11 24 28" fill="#ff8fb3"/>
    <path class="av-l" d="M26 50c-4 10-10 14-8 20 2 4 8 0 12-6M36 54c-2 10-4 18 0 22 4 3 6-6 7-14M50 56c0 10 0 18 4 20 4 1 4-9 3-17M64 54c2 10 4 18 8 18 4-1 1-10-2-16M74 50c4 8 10 12 8 18" fill="none" stroke-width="3"/>
    <path d="M26 50c4 5 44 5 48 0" fill="#ff8fb3"/>
    ${eyes(41, 59, 42)}
    ${smile(50, 50, 4)}
    <circle cx="40" cy="30" r="2" fill=${W} opacity=".8"/><circle cx="46" cy="27" r="1.3" fill=${W} opacity=".8"/>`,
  cactus: () => html`
    <path class="av-l" d="M40 72V32c0-6 4-10 10-10s10 4 10 10v40" fill="#5cb85c"/>
    <path class="av-l" d="M40 54H33c-4 0-6-3-6-6v-8c0-2 2-3 3-3s3 1 3 3v6h7M60 48h7v-9c0-2 1-3 3-3s3 1 3 3v9c0 4-3 7-6 7h-7" fill="#5cb85c"/>
    <path class="av-l" d="M30 70h40l-4 14H34z" fill="#d9774a"/>
    <path d="M28 70h44" stroke=${K} stroke-width="3.4" stroke-linecap="round"/>
    <circle cx="50" cy="20" r="4.5" fill="#ff4f79" class="av-l"/>
    ${eyes(45, 55, 40, 2.6)}
    ${smile(50, 47, 3.5)}
    <path d="M44 58l-2 1M56 60l2 1M47 64l-1 2" stroke=${K} stroke-width="1.4"/>`,
  toast: () => html`
    <path class="av-l" d="M24 42c-4-9 2-19 13-19 4 0 7 1 9 2 3-2 6-2 9-2 12 0 17 10 13 19v32c0 2-1 3-3 3H27c-2 0-3-1-3-3z" fill="#c68642"/>
    <path d="M30 44c-3-6 1-14 9-14 4 0 7 2 11 2s7-2 11-2c8 0 12 8 9 14v27H30z" fill="#f6d28b"/>
    <path class="av-l" d="M52 36l8-4 8 4-8 4z" fill="#ffe27a" stroke-width="2"/>
    ${eyes(42, 58, 52, 3.2)}
    ${smile(50, 58, 4)}
    ${blush(36, 64, 58)}`,
  mushroom: () => html`
    <path class="av-l" d="M40 56h20l2 18c0 3-3 5-6 5H44c-3 0-6-2-6-5z" fill=${W}/>
    <path class="av-l" d="M18 54c0-18 14-32 32-32s32 14 32 32c0 3-3 4-6 4H24c-3 0-6-1-6-4z" fill="#e8454f"/>
    <circle cx="36" cy="36" r="5" fill=${W}/><circle cx="58" cy="31" r="4" fill=${W}/><circle cx="70" cy="45" r="4.5" fill=${W}/><circle cx="29" cy="49" r="3" fill=${W}/><circle cx="50" cy="46" r="3" fill=${W}/>
    ${eyes(45, 55, 65, 2.6)}
    ${smile(50, 70, 3)}`,
  alien: () => html`
    <path class="av-l" d="M36 25l-6-10M64 25l6-10" fill="none"/><circle cx="30" cy="14" r="3.4" fill="#ffd23f" class="av-l"/><circle cx="70" cy="14" r="3.4" fill="#ffd23f" class="av-l"/>
    <path class="av-l" d="M50 22c17 0 28 11 28 25 0 16-14 32-28 32S22 63 22 47c0-14 11-25 28-25z" fill="#9be07a"/>
    <path d="M30 44c3-6 12-6 15 2-1 6-12 8-15-2zM70 44c-3-6-12-6-15 2 1 6 12 8 15-2z" fill=${B}/>
    <circle cx="37" cy="44" r="2" fill=${W}/><circle cx="63" cy="44" r="2" fill=${W}/>
    <ellipse cx="50" cy="64" rx="4" ry="2.4" fill=${B}/>`,
  bear: () => html`
    <circle cx="29" cy="29" r="10" fill="#a0673d" class="av-l"/><circle cx="71" cy="29" r="10" fill="#a0673d" class="av-l"/>
    <circle cx="29" cy="29" r="5" fill="#e3b187"/><circle cx="71" cy="29" r="5" fill="#e3b187"/>
    <path class="av-l" d="M50 24c16 0 27 12 27 27s-11 27-27 27-27-12-27-27 11-27 27-27z" fill="#a0673d"/>
    <ellipse class="av-l" cx="50" cy="60" rx="12" ry="9" fill="#e3b187"/>
    ${eyes(40, 60, 46, 3)}
    <path d="M46 56c0-2 8-2 8 0s-2 3-4 3-4-1-4-3z" fill=${B}/>
    <path d="M50 59v3M46 64q4 3 8 0" fill="none" stroke=${B} stroke-width="2" stroke-linecap="round"/>`,
  penguin: () => html`
    <path class="av-l" d="M50 18c15 0 24 14 24 32s-9 30-24 30-24-12-24-30 9-32 24-32z" fill="#2c2f45"/>
    <path d="M50 30c-9 0-14 6-14 12 0 10 5 30 14 30s14-20 14-30c0-6-5-12-14-12z" fill=${W}/>
    <path d="M40 34c4-4 8-4 10 0 2-4 6-4 10 0" fill=${W}/>
    ${eyes(43, 57, 42, 2.8)}
    <path class="av-l" d="M45 49l5 5 5-5z" fill="#ff9f1c" stroke-width="2"/>
    ${blush(38, 62, 51)}
    <path d="M40 80l-4 3M60 80l4 3" fill="none" stroke="#ff9f1c" stroke-width="3"/>`,
  dino: () => html`
    <path class="av-l" d="M34 26l4-9 5 8 6-9 5 9 6-8 3 10" fill="#ffd23f" stroke-linejoin="round"/>
    <path class="av-l" d="M22 52c0-17 12-27 28-27s28 10 28 25c0 6-2 9-6 11 3 4 2 12-6 15-7 3-26 3-34-2s-10-12-10-22z" fill="#5ec48f"/>
    ${eyes(38, 58, 44, 3.4)}
    <path d="M42 66q10 6 24-2" fill="none" stroke=${B} stroke-width="2.4" stroke-linecap="round"/>
    <path d="M48 66l2 4 2-3.6M56 65.6l2 3.8 2-4" fill=${W} stroke=${B} stroke-width="1.2" stroke-linejoin="round"/>
    <circle cx="68" cy="54" r="1.4" fill=${B}/><circle cx="72" cy="53" r="1.4" fill=${B}/>
    <circle cx="30" cy="40" r="3" fill="#3f9e6e"/><circle cx="36" cy="32" r="2" fill="#3f9e6e"/>`,
  moon: () => html`
    <path class="av-l" d="M62 20c-16 1-30 14-30 31s13 29 30 29c4 0 7 0 10-2-10-4-17-15-17-27 0-13 7-24 18-29-4-2-7-2-11-2z" fill="#ffe27a"/>
    <path d="M42 40q3 3 6 0" fill="none" stroke=${B} stroke-width="2.2" stroke-linecap="round"/>
    <path d="M44 56q4 4 8 0" fill="none" stroke=${B} stroke-width="2.2" stroke-linecap="round"/>
    <ellipse cx="42" cy="49" rx="4" ry="2.4" fill="#ff7a9a" opacity=".55"/>
    <path d="M74 32l1.6 3.4 3.4 1.6-3.4 1.6-1.6 3.4-1.6-3.4-3.4-1.6 3.4-1.6z" fill=${W} class="av-l" stroke-width="1.4"/>
    <circle cx="78" cy="58" r="1.8" fill=${W}/><circle cx="68" cy="70" r="1.4" fill=${W}/>`,
  strawberry: () => html`
    <path class="av-l" d="M50 80c-14-6-26-20-26-34 0-9 7-15 16-15 4 0 7 1 10 3 3-2 6-3 10-3 9 0 16 6 16 15 0 14-12 28-26 34z" fill="#ef3e4a"/>
    <path class="av-l" d="M36 30c4 2 8 2 14-2 6 4 10 4 14 2-2-4-6-6-9-6l-5-6-5 6c-3 0-7 2-9 6z" fill="#4d9a45"/>
    <g fill="#ffe27a"><ellipse cx="34" cy="46" rx="1.2" ry="2"/><ellipse cx="66" cy="46" rx="1.2" ry="2"/><ellipse cx="38" cy="60" rx="1.2" ry="2"/><ellipse cx="62" cy="60" rx="1.2" ry="2"/><ellipse cx="50" cy="72" rx="1.2" ry="2"/><ellipse cx="44" cy="68" rx="1.2" ry="2"/><ellipse cx="56" cy="68" rx="1.2" ry="2"/></g>
    ${eyes(43, 57, 48, 3)}
    ${smile(50, 55, 3.6)}`,
  owl: () => html`
    <path class="av-l" d="M26 28l8 8M74 28l-8 8" fill="none"/>
    <path class="av-l" d="M50 24c16 0 26 10 26 26 0 18-10 30-26 30S24 68 24 50c0-16 10-26 26-26z" fill="#8a5a44"/>
    <path d="M36 62c3 8 8 12 14 12s11-4 14-12c-4 3-9 4-14 4s-10-1-14-4z" fill="#d9b28a"/>
    <circle class="av-l" cx="39" cy="46" r="9" fill=${W}/><circle class="av-l" cx="61" cy="46" r="9" fill=${W}/>
    <circle cx="40" cy="47" r="4.4" fill=${B}/><circle cx="60" cy="47" r="4.4" fill=${B}/>
    <circle cx="41.5" cy="45.5" r="1.4" fill=${W}/><circle cx="61.5" cy="45.5" r="1.4" fill=${W}/>
    <path class="av-l" d="M46 55l4 6 4-6z" fill="#ff9f1c" stroke-width="2"/>
    <path d="M43 67l2 2 2-2M49 70l2 2 2-2M55 67l2 2 2-2" fill="none" stroke="#8a5a44" stroke-width="1.5"/>`,
  ramen: () => html`
    <path d="M36 30q-4-6 0-10M50 28q-4-6 0-10M64 30q-4-6 0-10" fill="none" stroke=${W} stroke-width="2.6" stroke-linecap="round" opacity=".85"/>
    <path d="M62 40l18-20M68 42l16-16" fill="none" stroke="#8a5a2b" stroke-width="3"/>
    <path class="av-l" d="M18 44h64c0 18-14 34-32 34S18 62 18 44z" fill="#e8f0ff"/>
    <path d="M22 44c4-4 12-6 28-6s24 2 28 6" fill="#f6d28b" stroke=${K} stroke-width="2.4"/>
    <circle cx="35" cy="42" r="5" fill=${W} stroke=${K} stroke-width="1.6"/><circle cx="35" cy="42" r="2.4" fill="#ffb627"/>
    <path d="M44 40q4 3 8 0t8 0" fill="none" stroke="#e2b54a" stroke-width="2"/>
    <path d="M20 52h60" stroke="#ef3e4a" stroke-width="2.4" stroke-dasharray="4 3"/>
    ${eyes(42, 58, 60, 2.8)}
    ${smile(50, 66, 3.4)}
    ${blush(34, 66, 64)}`,
  director: () => html`
    <path class="av-l" d="M28 36c2-10 12-15 24-14 12 1 20 8 20 14 0 2-2 3-4 3H32c-3 0-4-1-4-3z" fill="#c8473f"/>
    <path class="av-l" d="M50 22l2-5" fill="none"/>
    <path class="av-l" d="M32 38c0 18 7 30 18 30s18-12 18-30z" fill="#f2c9a0"/>
    <path class="av-l" d="M34 46h12v6H34zM54 46h12v6H54zM46 48h8" fill=${B}/>
    <path d="M40 60c3-2 7-2 10 0 3-2 7-2 10 0" fill="none" stroke=${B} stroke-width="2.6" stroke-linecap="round"/>
    <path class="av-l" d="M36 74h28l2 10H34z" fill="#2c2f45"/>
    <path class="av-l" d="M66 68l14-6 2 6-14 6z" fill=${W}/>
    <path d="M69 66.6l2 4.4M73 65l2 4.4M77 63.4l2 4.4" stroke=${B} stroke-width="1.6"/>`,
};

const NAMES = {
  cat: 'Cat', ghost: 'Ghost', robot: 'Robot', fox: 'Fox', onion: 'Onion', cassette: 'Cassette', frog: 'Frog', octopus: 'Octopus',
  cactus: 'Cactus', toast: 'Toast', mushroom: 'Mushroom', alien: 'Alien', bear: 'Bear', penguin: 'Penguin', dino: 'Dino', moon: 'Moon',
  strawberry: 'Strawberry', owl: 'Owl', ramen: 'Ramen', director: 'Director',
};
export const AVATARS = Object.keys(DRAW).map(id => ({ id, name: NAMES[id] }));

// line colour follows the theme ink; injected once so it works before any page CSS loads
try { const st = document.createElement('style'); st.textContent = '.av-l{stroke:var(--line)}'; document.head.appendChild(st); } catch {}

const blobs = new Map();
export function Avatar({ id = 'cat', size = 48, ink = INKS[0], class: cls = '' }) {
  const a = AVATARS.find(x => x.id === id) || AVATARS[0];
  if (!blobs.has(a.id)) blobs.set(a.id, blob(hash(a.id) % 997));
  const b = blobs.get(a.id);
  return html`<svg class=${'avatar ' + cls} width=${size} height=${size} viewBox="0 0 100 100" role="img" aria-label=${a.name}>
    <path d=${b.fill} fill=${ink}/>
    <path d=${b.fill} fill="url(#av-dots)" opacity=".35"/>
    <defs><pattern id="av-dots" width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1.5" cy="1.5" r=".9" fill="#1e1630" opacity=".35"/></pattern></defs>
    <g class="av-char" stroke="none" stroke-width="2.8" stroke-linecap="round" stroke-linejoin="round">${DRAW[a.id]()}</g>
    <path d=${b.line} fill=${K}/>
  </svg>`;
}
