// Reel: the Streamora mascot. A little film reel with stick arms, a film-strip tail and a lot of feelings.
// Two slightly different drawings alternate (boil) so it feels hand-animated.
// moods: wave | happy | sleep | search | binoculars | sad | confused | popcorn | party | yawn | love | think
import { html } from '../../vendor/preact-htm.js';
import { rng, taper } from './sketch.js';

// pen-stroked closed loop (circle-ish) with a gap, like drawn in one go
function loop(cx, cy, r, seed, sw = 3.2, turns = 1.06) {
  const R = rng(seed);
  const a0 = -Math.PI / 2 + (R() - .5) * .6, pts = [];
  for (let i = 0; i <= 40; i++) {
    const t = i / 40, a = a0 + t * Math.PI * 2 * turns, k = 1 + (R() - .5) * .035;
    pts.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k]);
  }
  return taper(pts, sw, { r: R, start: .06, end: .2 });
}
// hand line through points
function line(pts, seed, sw = 3) {
  const R = rng(seed);
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    for (let j = 0; j < 6; j++) { const t = j / 6; out.push([ax + (bx - ax) * t + (R() - .5) * .8, ay + (by - ay) * t + (R() - .5) * .8]); }
  }
  out.push(pts[pts.length - 1]);
  return taper(out, sw, { r: R, start: .15, end: .25 });
}

const MOODS = {
  //        eyes            mouth         left arm pts                     right arm pts
  happy:    { eyes: 'open', mouth: 'smile', la: [[34, 70], [20, 78], [14, 90]], ra: [[86, 70], [100, 78], [106, 90]] },
  wave:     { eyes: 'open', mouth: 'grin',  la: [[34, 70], [20, 78], [14, 90]], ra: [[86, 66], [102, 52], [104, 34]], wave: true },
  sleep:    { eyes: 'closed', mouth: 'o-small', la: [[34, 72], [24, 84], [26, 96]], ra: [[86, 72], [96, 84], [94, 96]], zzz: true },
  yawn:     { eyes: 'closed', mouth: 'o-big', la: [[34, 70], [22, 60], [24, 46]], ra: [[86, 70], [98, 60], [96, 46]] },
  search:   { eyes: 'look', mouth: 'flat', la: [[34, 70], [20, 78], [14, 90]], ra: [[86, 70], [100, 64], [108, 56]], glass: true },
  binoculars:{ eyes: 'none', mouth: 'flat', la: [[34, 66], [40, 50], [48, 44]], ra: [[86, 66], [80, 50], [72, 44]], bino: true },
  sad:      { eyes: 'sad', mouth: 'frown', la: [[34, 72], [26, 86], [28, 98]], ra: [[86, 72], [94, 86], [92, 98]], tear: true },
  confused: { eyes: 'odd', mouth: 'squiggle', la: [[34, 70], [20, 78], [14, 90]], ra: [[86, 66], [96, 50], [88, 40]], q: true },
  popcorn:  { eyes: 'happy', mouth: 'smile', la: [[34, 72], [36, 86], [46, 92]], ra: [[86, 72], [84, 86], [74, 92]], pop: true },
  party:    { eyes: 'happy', mouth: 'grin', la: [[34, 66], [20, 50], [16, 32]], ra: [[86, 66], [100, 50], [104, 32]], confetti: true },
  love:     { eyes: 'heart', mouth: 'smile', la: [[34, 70], [24, 62], [30, 52]], ra: [[86, 70], [96, 62], [90, 52]] },
  think:    { eyes: 'up', mouth: 'flat', la: [[34, 70], [20, 78], [14, 90]], ra: [[86, 70], [80, 82], [66, 80]], dots: true },
};

function Drawing({ mood, v }) {
  const m = MOODS[mood] || MOODS.happy;
  const s = v * 1000;
  const ink = 'var(--line)';
  const eyes = {
    open: html`<ellipse cx="50" cy="52" rx="4.5" ry="6" fill=${ink}/><ellipse cx="70" cy="52" rx="4.5" ry="6" fill=${ink}/><circle cx="51.5" cy="50" r="1.5" fill="var(--paper-3)"/><circle cx="71.5" cy="50" r="1.5" fill="var(--paper-3)"/>`,
    look: html`<ellipse cx="53" cy="51" rx="4.5" ry="6" fill=${ink}/><ellipse cx="73" cy="51" rx="4.5" ry="6" fill=${ink}/>`,
    up: html`<ellipse cx="51" cy="48" rx="4.2" ry="5.5" fill=${ink}/><ellipse cx="71" cy="48" rx="4.2" ry="5.5" fill=${ink}/>`,
    closed: html`<path d=${line([[44, 54], [50, 57], [56, 54]], s + 1, 2.6)} fill=${ink}/><path d=${line([[64, 54], [70, 57], [76, 54]], s + 2, 2.6)} fill=${ink}/>`,
    happy: html`<path d=${line([[44, 55], [50, 49], [56, 55]], s + 1, 2.8)} fill=${ink}/><path d=${line([[64, 55], [70, 49], [76, 55]], s + 2, 2.8)} fill=${ink}/>`,
    sad: html`<ellipse cx="50" cy="54" rx="4" ry="5" fill=${ink}/><ellipse cx="70" cy="54" rx="4" ry="5" fill=${ink}/><path d=${line([[43, 45], [54, 48]], s + 3, 2)} fill=${ink}/><path d=${line([[77, 45], [66, 48]], s + 4, 2)} fill=${ink}/>`,
    odd: html`<ellipse cx="50" cy="52" rx="4.5" ry="6" fill=${ink}/><circle cx="70" cy="53" r="3" fill=${ink}/><path d=${line([[64, 44], [76, 42]], s + 5, 2)} fill=${ink}/>`,
    heart: html`<path d="M50 58c-5-3.5-7-6-6.6-8.6.4-2 2.8-2.9 4.6-1.2l2 1.8 2-1.8c1.8-1.7 4.2-.8 4.6 1.2.4 2.6-1.6 5.1-6.6 8.6z" fill="var(--a1)" stroke=${ink} stroke-width="1.4"/><path d="M70 58c-5-3.5-7-6-6.6-8.6.4-2 2.8-2.9 4.6-1.2l2 1.8 2-1.8c1.8-1.7 4.2-.8 4.6 1.2.4 2.6-1.6 5.1-6.6 8.6z" fill="var(--a1)" stroke=${ink} stroke-width="1.4"/>`,
    none: null,
  }[m.eyes];
  const mouth = {
    smile: line([[52, 66], [60, 71], [68, 66]], s + 6, 2.6),
    grin: 'M50 64 Q60 76 70 64 Q60 69 50 64Z',
    flat: line([[54, 68], [66, 67]], s + 7, 2.4),
    frown: line([[52, 70], [60, 65], [68, 70]], s + 8, 2.6),
    squiggle: line([[52, 68], [56, 66], [60, 69], [64, 66], [68, 68]], s + 9, 2.2),
    'o-small': null, 'o-big': null,
  }[m.mouth];
  const R = rng(s + 40);
  // shading hatch on the lower-right of the body, clipped to the circle
  let hatchD = '';
  for (let k = 0; k < 9; k++) {
    const o = 30 + k * 5 + (R() - .5) * 1.5;
    hatchD += `M${o + 22} ${96 - k * .6}L${o + 50} ${58 + k * 1.8}`;
  }
  return html`<g>
    <!-- ground shadow -->
    <ellipse cx="60" cy="116" rx="30" ry="4.5" fill=${ink} opacity=".12"/>
    <!-- film strip tail -->
    <path d="M86 88 C104 96 110 108 100 116 C92 122 80 116 70 118" fill="none" stroke=${ink} stroke-width="11" stroke-linecap="round" opacity=".92"/>
    <path d="M86 88 C104 96 110 108 100 116 C92 122 80 116 70 118" fill="none" stroke="var(--paper-3)" stroke-width="4" stroke-dasharray="3 5" stroke-linecap="butt"/>
    <!-- legs + sneakers -->
    <path d=${line([[52, 92], [49, 106], [46, 110]], s + 10, 3)} fill=${ink}/>
    <path d=${line([[68, 92], [70, 106], [73, 110]], s + 11, 3)} fill=${ink}/>
    <path d="M36 112c0-3 4-5 9-5s7 2 7 4-3 3-8 3-8 0-8-2z" fill="var(--a1)" stroke=${ink} stroke-width="2"/>
    <path d="M68 111c0-2 3-4 7-4 5 0 9 2 9 5 0 2-3 2-8 2s-8-1-8-3z" fill="var(--a1)" stroke=${ink} stroke-width="2"/>
    <!-- body -->
    <clipPath id=${'rb' + v}><circle cx="60" cy="60" r="33"/></clipPath>
    <circle cx="60" cy="60" r="34" fill="var(--paper-3)"/>
    <circle cx="60" cy="60" r="34" fill="var(--a3)" opacity=".38"/>
    <path d=${hatchD} stroke=${ink} stroke-width="1.1" opacity=".22" clip-path=${`url(#rb${v})`} fill="none"/>
    <path d="M38 40 q6-10 18-12" fill="none" stroke="var(--paper-3)" stroke-width="4" stroke-linecap="round" opacity=".9"/>
    <path d=${loop(60, 60, 34, s + 12, 3.6)} fill=${ink}/>
    <path d=${loop(60, 60, 27.5, s + 13, 1.4, .8)} fill=${ink} opacity=".35"/>
    <path d="M60 42v-4M60 82v-4M42 60h-4M82 60h-4" stroke=${ink} stroke-width="1.6" opacity=".35" stroke-linecap="round"/>
    <!-- reel holes (the "cheeks" and forehead) -->
    <path d=${loop(60, 36, 5.5, s + 14, 2)} fill=${ink} opacity=".75"/>
    <path d=${loop(38, 66, 5, s + 15, 2)} fill=${ink} opacity=".5"/>
    <path d=${loop(82, 66, 5, s + 16, 2)} fill=${ink} opacity=".5"/>
    <ellipse cx="42" cy="64" rx="5" ry="3" fill="var(--a1)" opacity=".45"/>
    <ellipse cx="78" cy="64" rx="5" ry="3" fill="var(--a1)" opacity=".45"/>
    ${eyes}
    ${mouth && html`<path d=${mouth} fill=${ink}/>`}
    ${m.mouth === 'o-small' && html`<ellipse cx="60" cy="68" rx="2.6" ry="3" fill=${ink}/>`}
    ${m.mouth === 'o-big' && html`<ellipse cx="60" cy="69" rx="5" ry="6.5" fill=${ink}/>`}
    <!-- arms -->
    <g class=${m.wave ? 'reel-wave' : ''}><path d=${line(m.ra, s + 17, 3)} fill=${ink}/></g>
    <path d=${line(m.la, s + 18, 3)} fill=${ink}/>
    <!-- props -->
    ${m.zzz && html`<text x="92" y="30" class="reel-z" font-family="var(--font-display)" font-size="18" fill=${ink}>z</text><text x="102" y="18" class="reel-z z2" font-family="var(--font-display)" font-size="13" fill=${ink}>z</text>`}
    ${m.glass && html`<path d=${loop(110, 50, 8, s + 19, 2.6)} fill=${ink}/><circle cx="110" cy="50" r="7" fill="var(--a2)" opacity=".18"/>`}
    ${m.bino && html`<g><rect x="42" y="42" width="15" height="17" rx="5" fill=${ink}/><rect x="63" y="42" width="15" height="17" rx="5" fill=${ink}/><rect x="55" y="46" width="10" height="6" fill=${ink}/><circle cx="49.5" cy="56" r="4" fill="var(--a2)"/><circle cx="70.5" cy="56" r="4" fill="var(--a2)"/></g>`}
    ${m.tear && html`<path d="M47 62 q-2.5 5 0 7 q2.5-2 0-7z" fill="var(--a2)"/>`}
    ${m.q && html`<text x="94" y="36" font-family="var(--font-display)" font-size="26" fill="var(--a1)">?</text>`}
    ${m.dots && html`<g fill=${ink}><circle cx="92" cy="26" r="2"/><circle cx="100" cy="18" r="2.8"/><circle cx="110" cy="9" r="3.6"/></g>`}
    ${m.pop && html`<g><path d="M44 86 l32 0 -4 26 -24 0z" fill="var(--paper-3)" stroke=${ink} stroke-width="2.4" stroke-linejoin="round"/><path d="M52 86 l2 26 M68 86 l-2 26" stroke="var(--a1)" stroke-width="4"/><circle cx="50" cy="83" r="5" fill="var(--paper-3)" stroke=${ink} stroke-width="1.8"/><circle cx="59" cy="80" r="6" fill="var(--paper-3)" stroke=${ink} stroke-width="1.8"/><circle cx="69" cy="83" r="5" fill="var(--paper-3)" stroke=${ink} stroke-width="1.8"/></g>`}
    ${m.confetti && html`<g class="reel-confetti"><rect x="14" y="14" width="5" height="9" fill="var(--a1)" transform="rotate(20 16 18)"/><rect x="96" y="10" width="5" height="9" fill="var(--a2)" transform="rotate(-30 98 14)"/><rect x="30" y="4" width="4" height="8" fill="var(--a4)" transform="rotate(50 32 8)"/><rect x="84" y="28" width="4" height="8" fill="var(--a3)" transform="rotate(10 86 32)"/><circle cx="8" cy="40" r="3" fill="var(--a3)"/><circle cx="110" cy="44" r="3" fill="var(--a1)"/></g>`}
  </g>`;
}

export function Reel({ mood = 'happy', size = 120, class: cls = '', label }) {
  return html`<svg class=${'reel ' + cls} width=${size} height=${size} viewBox="0 0 120 124" role="img" aria-label=${label || `Reel looks ${mood}`}>
    <g class="reel-v1"><${Drawing} mood=${mood} v=${1} /></g>
    <g class="reel-v2"><${Drawing} mood=${mood} v=${2} /></g>
  </svg>`;
}
