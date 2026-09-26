// Living style guide: every shared component on one page. Open #/kit. Agents: look here before building a page.
import { html, useState } from '../../vendor/preact-htm.js';
import { Page, Hero, Row, Btn, IconBtn, Chip, Tabs, Stars, Spinner, Empty, ErrorNote, Modal, toast, Field, Input, Toggle, Select, SectionTitle, PosterCard, useAsync, Icon } from '../ui/components.js';
import { ICONS } from '../ui/icons.js';
import { Reel } from '../ui/reel.js';
import { AVATARS, Avatar, INKS } from '../ui/avatars.js';
import { catalog } from '../core/meta.js';

export default function Kit() {
  const top = useAsync(() => catalog('movie', 'top'), []);
  const anime = useAsync(() => catalog('anime', 'kitsu-anime-trending'), []);
  const [tab, setTab] = useState('a');
  const [stars, setStars] = useState(3.5);
  const [open, setOpen] = useState(false);
  const [on, setOn] = useState(true);
  const hero = top.data && top.data[0];
  return html`<${Page} bleed>
    <${Hero} item=${hero} kicker="style guide" actions=${html`<${Btn} variant="primary" size="lg" icon="play">Play<//><${Btn} icon="plus">Watchlist<//><${Btn} variant="stamp">Cached<//>`} />
    <div style="padding:0 var(--gutter)">
      <${Row} title="Popular movies" kicker="cinemeta" icon="film" items=${top.data} loading=${top.loading} error=${top.error} href="#/movies" />
      <${Row} title="Continue watching" icon="clock" wide items=${(top.data || []).slice(3, 9)} loading=${top.loading}
        render=${(it, i) => html`<${PosterCard} item=${it} wide pct=${(i + 1) / 7} label=${`S1 · E${i + 1}`} onRemove=${() => toast('Removed')} />`} />
      <${Row} title="Top 10 anime" numbered icon="anime" items=${(anime.data || []).slice(0, 10)} loading=${anime.loading} />

      <${SectionTitle} kicker="buttons">Buttons & chips<//>
      <div class="cluster" style="margin:18px 0">
        <${Btn} variant="primary" icon="play">Primary<//><${Btn} icon="heart">Ink<//><${Btn} variant="ghost" icon="share">Ghost<//>
        <${Btn} variant="danger" icon="trash">Danger<//><${Btn} size="sm" icon="plus">Small<//><${Btn} variant="stamp">RD+ cached<//>
        <${IconBtn} icon="gear" label="Settings" /><${IconBtn} icon="heartFill" label="Loved" active />
      </div>
      <div class="chips" style="margin-bottom:24px">${['Action', 'Cozy', 'Horror', 'Sci-Fi', 'Romance'].map((g, i) => html`<${Chip} active=${i === 1}>${g}<//>`)}</div>
      <${Tabs} tabs=${[{ id: 'a', label: 'Episodes', icon: 'list', count: 10 }, { id: 'b', label: 'Sources' }, { id: 'c', label: 'Details' }]} value=${tab} onChange=${setTab} />
      <div class="panel" style="margin:0 0 24px;border-top-left-radius:0">Tab: ${tab} · <${Stars} value=${stars} onChange=${setStars} /></div>

      <${SectionTitle} kicker="forms">Forms<//>
      <div style="max-width:420px;margin:18px 0">
        <${Field} label="Name" hint="shown on the profile card"><${Input} placeholder="Type here" /><//>
        <${Field} label="Quality"><${Select} value="auto" onChange=${() => {}} options=${['auto', '1080p', '720p']} /><//>
        <${Toggle} checked=${on} onChange=${setOn} label="Auto-play next episode" />
      </div>

      <${SectionTitle} kicker="feedback">Feedback<//>
      <div class="cluster" style="margin:18px 0">
        <${Btn} onClick=${() => toast('Added to your watchlist', { icon: 'heart' })}>Toast<//>
        <${Btn} onClick=${() => setOpen(true)}>Modal<//>
      </div>
      <${ErrorNote} error=${new Error('Real-Debrid is too busy right now.')} retry=${() => {}} />
      <${Spinner} />
      <${Modal} open=${open} onClose=${() => setOpen(false)} title="Pick a source"><p>Sheet on phones, card on desktop.</p><${Btn} variant="primary" onClick=${() => setOpen(false)}>Okay<//><//>

      <${SectionTitle} kicker="characters">Reel's moods<//>
      <div class="cluster" style="margin:18px 0">${['happy', 'wave', 'sleep', 'yawn', 'search', 'binoculars', 'sad', 'confused', 'popcorn', 'party', 'love', 'think'].map(m => html`<div style="text-align:center"><${Reel} mood=${m} size=${110} /><div class="type">${m}</div></div>`)}</div>
      <${Empty} mood="popcorn" title="Your watchlist is empty" text="Tap the heart on anything to pin it here." action=${html`<${Btn} href="#/movies" icon="film">Browse movies<//>`} />

      <${SectionTitle} kicker="avatars">Avatars<//>
      <div class="cluster" style="margin:18px 0">${AVATARS.map((a, i) => html`<${Avatar} id=${a.id} ink=${INKS[i % INKS.length]} size=${72} />`)}</div>

      <${SectionTitle} kicker=${Object.keys(ICONS).length + ' icons'}>Icons<//>
      <div class="cluster" style="margin:18px 0 60px;gap:18px">${Object.keys(ICONS).map(n => html`<div title=${n} style="text-align:center;width:64px"><${Icon} name=${n} size=${32} /><div class="type faint" style="font-size:10px">${n}</div></div>`)}</div>
    </div>
  <//>`;
}
