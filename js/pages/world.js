// Around the World: a doodled map with pins; each pin opens that country's cinema shelf.
import { html } from '../../vendor/preact-htm.js';
import { Page, Grid, Btn, Chip, ErrorNote, Empty, Icon, useAsync, loadCSS, cx } from '../ui/components.js';
import { COUNTRIES, resolveList } from '../lib/discover-lists.js';
import { registerIcons, ICONS } from '../ui/icons.js';

registerIcons({ mapPin: { d: ICONS.pin.d, fill: 'M12 21.2s-6.4-6.2-6.4-11.1c0-3.6 2.9-6.4 6.4-6.4 3.6 0 6.5 2.8 6.5 6.4 0 4.9-6.5 11.1-6.5 11.1z' } });

loadCSS('css/pages/world.css');

// Charming, not cartography. viewBox 1000×520.
const LAND = [
  'M90 90C140 60 260 50 330 70C360 80 350 110 320 130C300 150 290 170 260 190C240 205 225 225 210 250C200 262 190 270 175 262C150 245 130 215 120 190C100 160 70 130 90 90Z',
  'M205 262C215 272 232 285 250 296C245 300 236 298 226 292C214 284 205 274 205 262Z',
  'M360 40C390 30 430 35 440 55C430 75 400 85 380 75C362 65 355 52 360 40Z',
  'M255 300C290 290 340 300 370 330C385 350 370 380 345 410C325 440 305 470 290 490C280 495 275 480 278 460C282 430 270 400 260 370C250 345 240 315 255 300Z',
  'M450 110C470 90 520 70 560 80C590 88 600 110 590 130C580 150 560 160 540 175C520 190 495 195 475 188C455 180 445 160 450 140C452 128 448 120 450 110Z',
  'M462 118C470 110 482 112 484 124C484 136 474 144 466 138C460 132 458 124 462 118Z',
  'M470 205C510 195 560 200 590 215C610 230 620 255 610 280C600 310 590 340 570 370C555 395 540 420 525 430C510 425 505 400 500 375C495 345 480 320 465 300C450 280 440 250 450 228C455 215 460 208 470 205Z',
  'M600 90C660 60 760 50 850 70C900 80 930 110 920 140C910 165 880 180 860 200C840 225 820 250 790 265C760 280 730 290 710 285C690 280 680 260 660 245C640 232 620 220 600 205C585 190 590 170 595 150C598 130 590 110 600 90Z',
  'M690 270C705 275 725 275 735 280C730 300 720 320 710 330C700 315 692 295 690 270Z',
  'M870 170C882 160 892 166 890 180C888 196 880 210 872 222C866 214 866 196 870 170Z',
  'M800 360C840 340 900 345 920 370C930 395 910 420 875 425C840 428 810 415 800 395C795 380 795 370 800 360Z',
  'M760 305C772 300 786 304 790 312C780 318 766 316 760 305ZM800 318C812 314 826 318 828 326C816 330 804 328 800 318Z',
];

export function Flag({ colors, size = 44 }) {
  const w = size, h = size * .68, n = colors.length;
  return html`<svg class="wd-flag" width=${w} height=${h} viewBox="0 0 60 40" aria-hidden="true">
    ${colors.map((c, i) => html`<path d=${`M${2 + i * 56 / n} ${3 + (i % 2)} L${2 + (i + 1) * 56 / n} ${2 + ((i + 1) % 2)} L${1 + (i + 1) * 56 / n} ${37 - (i % 2)} L${3 + i * 56 / n} ${38 - ((i + 1) % 2)}Z`} fill=${c}/>`)}
    <path d="M2 3 C20 1 40 4 58 2 L57 37 C40 39 20 36 3 38 Z" fill="none" stroke="var(--line)" stroke-width="2.6" stroke-linejoin="round"/>
    <path d="M2 3 L1 50" stroke="var(--line)" stroke-width="2.4" stroke-linecap="round"/>
  </svg>`;
}

function Map() {
  return html`<div class="wd-map">
    <svg viewBox="0 0 1000 520" aria-hidden="true">
      <defs><pattern id="wd-dots" width="8" height="8" patternUnits="userSpaceOnUse"><circle cx="2" cy="2" r="1.3" fill="var(--line)" opacity=".2"/></pattern></defs>
      ${[[120, 330], [420, 250], [700, 420], [950, 260], [60, 450], [620, 470], [960, 470]].map(([x, y]) => html`<path d=${`M${x} ${y}q8-7 16 0t16 0M${x + 10} ${y + 12}q8-7 16 0t16 0`} fill="none" stroke="var(--a2)" stroke-width="2.2" stroke-linecap="round" opacity=".55"/>`)}
      ${LAND.map(d => html`<path d=${d} fill="var(--fill-3)" opacity=".75"/><path d=${d} fill="url(#wd-dots)"/><path d=${d} fill="none" stroke="var(--line)" stroke-width="2.8" stroke-linejoin="round"/>`)}
      <g transform="translate(90 420)" class="wd-compass"><circle r="32" fill="var(--paper-3)" stroke="var(--line)" stroke-width="2.4"/><path d="M0-28 L7 0 0 28 -7 0Z" fill="var(--a1)" stroke="var(--line)" stroke-width="2"/><path d="M-28 0 L0 6 28 0 0-6Z" fill="var(--paper-2)" stroke="var(--line)" stroke-width="2"/><text y="-36" text-anchor="middle" font-family="var(--font-display)" font-size="20" fill="var(--ink)">N</text></g>
      <g transform="translate(410 330)"><g class="wd-boat"><path d="M0 0h44l-8 12H8z" fill="var(--a3)" stroke="var(--line)" stroke-width="2.4" stroke-linejoin="round"/><path d="M22 0V-30L40-6H22" fill="var(--paper-3)" stroke="var(--line)" stroke-width="2.4" stroke-linejoin="round"/></g></g>
    </svg>
    ${COUNTRIES.map((c, i) => html`<a class=${cx('wd-pin', i % 2 && 'alt')} href=${`#/world/${c.id}`} style=${`left:${c.x / 10}%;top:${c.y / 5.2}%`} aria-label=${c.name}>
      <${Icon} name="mapPin" size=${32} /><span class="wd-pin-label">${c.name}</span>
    </a>`)}
  </div>`;
}

function Country({ c }) {
  const list = useAsync(() => resolveList(c.titles), [c.id]);
  return html`<${Page} class="wd-page">
    <header class="wd-head">
      <${Btn} variant="ghost" icon="back" href="#/world">the map<//>
      <div class="wd-title">
        <${Flag} colors=${c.flag} size=${72} />
        <div><div class="kicker type">postcard from</div><h1>${c.name}</h1></div>
      </div>
      <p class="wd-blurb sticky-note">${c.blurb}</p>
    </header>
    ${list.error ? html`<${ErrorNote} error=${list.error} retry=${list.reload} />`
      : html`<${Grid} items=${list.data || []} loading=${list.loading} empty=${html`<${Empty} mood="binoculars" title="Couldn't find these films" text="The catalog may be busy. Try again in a bit." />`} />`}
    <div class="kicker type">next stop</div>
    <div class="chips scroll">${COUNTRIES.filter(x => x.id !== c.id).map(x => html`<${Chip} onClick=${() => { location.hash = `#/world/${x.id}`; }}>${x.name}<//>`)}</div>
  <//>`;
}

export default function World({ params }) {
  const c = params.country && COUNTRIES.find(x => x.id === params.country);
  if (params.country && !c) return html`<${Page}><${Empty} mood="confused" title="That place isn't on our map" action=${html`<${Btn} href="#/world" icon="globe">Back to the map<//>`} /><//>`;
  if (c) return html`<${Country} key=${c.id} c=${c} />`;
  return html`<${Page} title="Around the World" kicker="cinema by country" icon="globe" class="wd-page">
    <${Map} />
    <div class="wd-cards">
      ${COUNTRIES.map((x, i) => html`<a class="wd-card" href=${`#/world/${x.id}`} style=${`--tilt:${(i % 5 - 2) * .8}deg`}>
        <${Flag} colors=${x.flag} />
        <span><b>${x.name}</b><small class="muted">${x.blurb}</small></span>
      </a>`)}
    </div>
  <//>`;
}
