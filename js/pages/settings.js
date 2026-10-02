// Settings (notebook tabs). Everything here is saved to the Google Drive file by js/core/sync.js.
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { Page, Btn, IconBtn, Tabs, Field, Input, Toggle, Select, Icon, Reel, Modal, ErrorNote, Spinner, Empty, useAsync, toast, loadCSS, cx } from '../ui/components.js';
import {
  useStore, settings, profiles, activeProfileId, activeProfile, history, progress, hidden,
  saveRdKey, forgetRdKey, ls,
} from '../core/store.js';
import { account, signOut, revokeAccess } from '../core/google.js';
import { idbWipe } from '../core/idb.js';
import { user } from '../core/rd.js';
import { navigate, setQuery } from '../router.js';
import { THEMES, ThemeSwatch } from './profiles.js';
import { syncState, syncNow, syncPending, deleteDriveData } from '../core/sync.js';
import { traktRev, traktAvailable, traktAccount, startConnect, finishConnect, disconnect as traktDisconnect, importHistory, importWatchlist } from '../core/trakt.js';
import { addons, addAddon, removeAddon } from '../core/addons.js';

loadCSS('css/pages/settings.css');

export const VERSION = '1.0.0';

// ------------------------------------------------------------ tabs
const ago = t => { const m = Math.round((Date.now() - t) / 6e4); return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : new Date(t).toLocaleDateString(); };

/** Wipes this device (Drive keeps everything) and goes back to the welcome page. */
export async function eraseDevice() {
  forgetRdKey();
  for (const k of ls.keys()) ls.del(k);
  try { sessionStorage.clear(); } catch {}
  await idbWipe();
  try { for (const n of await caches.keys()) await caches.delete(n); } catch {}
  location.hash = '#/welcome'; location.reload();
}

function GoogleCard() {
  const a = useStore(account);
  const st = useStore(syncState);
  const [out, setOut] = useState(false);
  const [busy, setBusy] = useState(false);
  const [, tick] = useState(0);
  useEffect(() => { const t = setInterval(() => tick(x => x + 1), 30e3); return () => clearInterval(t); }, []);
  const leave = async () => {
    setBusy(true);
    try { if (syncPending()) await syncNow(); } catch {}
    if (syncPending()) { setBusy(false); return toast('Some changes are not in Drive yet. Get online, then try again.', { kind: 'error', ms: 5000 }); }
    await signOut();
    await eraseDevice();
  };
  if (!a) return null;
  return html`<div class="panel stack st-google">
    <div class="st-account-row">
      ${a.picture ? html`<img class="st-gpic" src=${a.picture} alt="" referrerpolicy="no-referrer" />` : html`<${Reel} mood="love" size=${90} />`}
      <div>
        <div class="kicker type">saved in google drive</div>
        <h2>${a.name || a.email}</h2>
        <div class="type muted">${a.email}</div>
      </div>
    </div>
    <p class="type st-sync-status" role="status">${st.busy ? 'saving…' : st.error ? 'not saved yet' : st.last ? `in step with Drive · ${ago(st.last)}` : 'connecting…'}</p>
    ${st.error && html`<${ErrorNote} error=${st.error} compact />`}
    <div class="cluster">
      <${Btn} icon="refresh" disabled=${st.busy} onClick=${() => syncNow()}>Sync now<//>
      <${Btn} variant="ghost" icon="logout" onClick=${() => setOut(true)}>Sign out of this device<//>
    </div>
    <${Modal} open=${out} onClose=${() => setOut(false)} title="Sign out here?">
      <p>This device forgets everything. Your profiles, history and key stay safe in your Drive: sign in again (here or anywhere) to get them back.</p>
      <div class="cluster"><${Btn} variant="danger" icon="logout" disabled=${busy} onClick=${leave}>${busy ? 'Saving first…' : 'Sign out'}<//><${Btn} variant="ghost" onClick=${() => setOut(false)}>Stay<//></div>
    <//>
  </div>`;
}

function Account() {
  const me = useAsync(() => user(), []);
  const [replacing, setReplacing] = useState(false);
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [confirm, setConfirm] = useState(false);
  const u = me.data;
  const days = u ? Math.max(0, Math.round((new Date(u.expiration) - Date.now()) / 864e5)) : 0;
  const replace = async e => {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const nu = await user(key.trim());
      if (nu.type !== 'premium') throw new Error('That account is not premium.');
      await saveRdKey(key.trim()); setReplacing(false); setKey(''); me.reload(); toast('Key replaced', { icon: 'key' });
    } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return html`<div class="stack">
    <${GoogleCard} />
    <div class="panel st-account">
      ${me.loading ? html`<${Spinner} label="asking Real-Debrid…" />` : me.error ? html`<${ErrorNote} error=${me.error} retry=${me.reload} />` : html`
        <div class="st-account-row">
          <${Reel} mood="happy" size=${90} />
          <div>
            <div class="kicker type">real-debrid account</div>
            <h2>${u.username}</h2>
            <div class="type muted">${u.email} · ${u.points} fidelity points</div>
          </div>
          <div class=${cx('st-stamp', days < 7 && 'warn')}><span>${u.type}</span><b>${days}</b><small>days left</small></div>
        </div>`}
    </div>
    ${replacing ? html`<form class="panel stack" onSubmit=${replace}>
      <${Field} label="New API key" hint="real-debrid.com/apitoken"><${Input} value=${key} onInput=${e => setKey(e.currentTarget.value)} autocomplete="off" spellcheck="false" /><//>
      ${err && html`<${ErrorNote} error=${err} compact />`}
      <div class="cluster"><${Btn} variant="primary" icon="key" type="submit" disabled=${busy || key.trim().length < 20}>${busy ? 'Checking…' : 'Save key'}<//><${Btn} variant="ghost" onClick=${() => setReplacing(false)}>Cancel<//></div>
    </form>` : html`<div class="cluster">
      <${Btn} icon="key" onClick=${() => setReplacing(true)}>Replace key<//>
      <${Btn} variant="danger" icon="logout" onClick=${() => setConfirm(true)}>Remove key<//>
    </div>`}
    <${Modal} open=${confirm} onClose=${() => setConfirm(false)} title="Remove the key?">
      <p>It's removed from your Drive too, so every device asks for a key again. Profiles and history stay.</p>
      <div class="cluster"><${Btn} variant="danger" icon="logout" onClick=${() => { forgetRdKey(true); navigate('/welcome', { replace: true }); }}>Remove it<//><${Btn} variant="ghost" onClick=${() => setConfirm(false)}>Keep<//></div>
    <//>
  </div>`;
}

const QUALITIES = [
  { value: 'auto', label: 'Auto (best for this device)' }, { value: 'original', label: 'Original' },
  { value: 'high', label: '1080p high (8 Mbps)' }, { value: 'high_low', label: '1080p (4 Mbps)' },
  { value: 'medium', label: '720p high (4 Mbps)' }, { value: 'medium_low', label: '720p (2 Mbps)' },
  { value: 'low', label: '480p high (2 Mbps)' }, { value: 'low_low', label: '480p (1 Mbps)' },
];
const LANGS = [['eng', 'English'], ['spa', 'Spanish'], ['fre', 'French'], ['ger', 'German'], ['ita', 'Italian'], ['por', 'Portuguese'], ['ara', 'Arabic'], ['jpn', 'Japanese'], ['kor', 'Korean'], ['chi', 'Chinese'], ['hin', 'Hindi'], ['rus', 'Russian'], ['tur', 'Turkish'], ['dut', 'Dutch'], ['pol', 'Polish'], ['swe', 'Swedish']].map(([value, label]) => ({ value, label }));
const SUB_COLORS = ['#fffbe8', '#ffe27a', '#7fe7ff', '#8dffc4', '#ffb3d1'];

function Player() {
  const s = useStore(settings);
  const up = patch => settings.update(x => ({ ...x, ...patch }));
  return html`<div class="st-grid">
    <div class="panel stack">
      <h3>Playback</h3>
      <${Field} label="Default quality"><${Select} value=${s.quality} onChange=${v => up({ quality: v })} options=${QUALITIES} /><//>
      <${Field} label="Preferred audio"><${Select} value=${s.audioLang} onChange=${v => up({ audioLang: v })} options=${LANGS} /><//>
      <${Toggle} checked=${s.autoPlay !== false} onChange=${v => up({ autoPlay: v })} label="Start playing automatically" />
      <${Toggle} checked=${s.autoNext} onChange=${v => up({ autoNext: v })} label="Auto-play the next episode" />
      <${Toggle} checked=${s.cachedOnly} onChange=${v => up({ cachedOnly: v })} label="Only show sources cached on Real-Debrid" />
      <${Field} label=${`Skip intro jumps ${s.skipIntroSec}s`}>
        <input type="range" class="st-range" min="30" max="180" step="5" value=${s.skipIntroSec} onInput=${e => up({ skipIntroSec: +e.currentTarget.value })} data-own-arrows />
      <//>
    </div>
    <div class="panel stack">
      <h3>Subtitles</h3>
      <div class="st-subs-preview" style=${`--sub-size:${s.subsSize / 100};--sub-color:${s.subsColor};--sub-bg:rgba(0,0,0,${s.subsBg})`}>
        <span>I'm going to make him an offer he can't refuse.</span>
      </div>
      <${Field} label="Language"><${Select} value=${s.subsLang} onChange=${v => up({ subsLang: v })} options=${[{ value: 'off', label: 'Off' }, ...LANGS]} /><//>
      <${Field} label=${`Size ${s.subsSize}%`}><input type="range" class="st-range" min="60" max="180" step="10" value=${s.subsSize} onInput=${e => up({ subsSize: +e.currentTarget.value })} data-own-arrows /><//>
      <div class="field"><span class="field-label">Colour</span><div class="pf-inks">
        ${SUB_COLORS.map(c => html`<button type="button" class=${cx('pf-ink', s.subsColor === c && 'active')} style=${`--c:${c}`} aria-label=${c} onClick=${() => up({ subsColor: c })}></button>`)}
      </div></div>
      <${Field} label=${`Background ${Math.round(s.subsBg * 100)}%`}><input type="range" class="st-range" min="0" max="0.9" step="0.05" value=${s.subsBg} onInput=${e => up({ subsBg: +e.currentTarget.value })} data-own-arrows /><//>
    </div>
  </div>`;
}

function Look() {
  const s = useStore(settings);
  const list = useStore(profiles);
  const me = list.find(p => p.id === activeProfileId.get());
  const up = patch => settings.update(x => ({ ...x, ...patch }));
  const setTheme = theme => profiles.set(list.map(p => (p.id === me.id ? { ...p, theme } : p)));
  return html`<div class="stack">
    <div class="panel stack">
      <h3>Theme for ${me ? me.name : 'this profile'}</h3>
      <div class="pf-themes st-themes">${THEMES.map(t => html`<${ThemeSwatch} t=${t} active=${me && me.theme === t.id} onClick=${() => me && setTheme(t.id)} />`)}</div>
      <${Toggle} checked=${s.nightAuto} onChange=${v => up({ nightAuto: v })} label="Blueprint night mode after sunset (7pm–6am)" />
    </div>
    <div class="panel stack">
      <h3>Feel</h3>
      <${Toggle} checked=${s.reduceMotion} onChange=${v => up({ reduceMotion: v })} label="Reduce motion (no boiling lines or page flips)" />
      <${Toggle} checked=${s.sounds} onChange=${v => up({ sounds: v })} label="Paper sounds on clicks" />
    </div>
  </div>`;
}

// ------------------------------------------------------------ connect: trakt, addons, notifications
function TraktCard() {
  const rev = useStore(traktRev);
  const avail = useAsync(() => traktAvailable(), []);
  const acct = useAsync(() => traktAccount(), [rev]);
  const [dc, setDc] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState(null);
  const abort = useRef(null);
  useEffect(() => () => abort.current && abort.current.abort(), []);
  const connect = async () => {
    setErr(null);
    try {
      const code = await startConnect(); setDc(code);
      abort.current = new AbortController();
      const name = await finishConnect(code, abort.current.signal);
      toast(`Connected to Trakt${name ? ' as ' + name : ''}`, { icon: 'check' });
    } catch (x) { if (x.message !== 'Cancelled') setErr(x); } finally { setDc(null); }
  };
  const run = async (which, fn, msg) => {
    setBusy(which); setErr(null);
    try { toast(msg(await fn()), { icon: 'download' }); } catch (x) { setErr(x); } finally { setBusy(''); }
  };
  const a = acct.data;
  return html`<div class="panel stack">
    <h3><${Icon} name="check" /> Trakt</h3>
    ${avail.loading || acct.loading ? html`<${Spinner} size=${40} label="" />`
      : !avail.data ? html`<p class="muted">Trakt isn't set up on this server yet. The owner can add it in a couple of minutes (see DEPLOY.md).</p>`
      : a ? html`
        <p>Connected${a.username ? html` as <b>${a.username}</b>` : ''}. What this profile watches is scrobbled to Trakt.</p>
        <div class="cluster">
          <${Btn} icon="download" disabled=${!!busy} onClick=${() => run('h', importHistory, n => `Imported ${n} watched ${n === 1 ? 'item' : 'items'}`)}>${busy === 'h' ? 'Importing…' : 'Import watch history'}<//>
          <${Btn} icon="heart" disabled=${!!busy} onClick=${() => run('w', importWatchlist, n => `Added ${n} to your watchlist`)}>${busy === 'w' ? 'Importing…' : 'Import watchlist'}<//>
          <${Btn} variant="ghost" icon="logout" onClick=${traktDisconnect}>Disconnect<//>
        </div>`
      : dc ? html`<div class="stack st-trakt-code">
          <p>Open <a href=${dc.verification_url} target="_blank" rel="noopener">${dc.verification_url.replace(/^https?:\/\//, '')}</a> and enter this code:</p>
          <b class="st-code type">${dc.user_code}</b>
          <${Spinner} size=${40} label="waiting for you to approve…" />
          <div><${Btn} variant="ghost" onClick=${() => abort.current && abort.current.abort()}>Cancel<//></div>
        </div>`
      : html`<p class="muted">Scrobble what you watch and bring your Trakt history into Streamora. Connected per profile.</p><div><${Btn} variant="primary" icon="link" onClick=${connect}>Connect Trakt<//></div>`}
    ${err && html`<${ErrorNote} error=${err} compact />`}
  </div>`;
}

function AddonsCard() {
  const list = useStore(addons);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const add = async e => {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const a = await addAddon(url); setUrl(''); toast(`${a.name} added`, { icon: 'plus' }); } catch (x) { setErr(x); } finally { setBusy(false); }
  };
  return html`<div class="panel stack">
    <h3><${Icon} name="layers" /> Source addons</h3>
    <p class="muted">Extra Stremio addons to search for sources next to Torrentio. Only torrent sources are used.</p>
    ${list.length > 0 && html`<ul class="st-addons">${list.map(a => html`<li key=${a.url}>
      <div><b>${a.name}</b><div class="type faint st-addon-url">${a.url.replace(/^https:\/\//, '').replace(/\/manifest\.json$/, '')}</div></div>
      <${IconBtn} icon="trash" label=${`Remove ${a.name}`} onClick=${() => removeAddon(a.url)} />
    </li>`)}</ul>`}
    <form class="stack" onSubmit=${add}>
      <${Field} label="Addon link" hint="…/manifest.json or stremio://…"><${Input} value=${url} onInput=${e => setUrl(e.currentTarget.value)} inputmode="url" autocomplete="off" spellcheck="false" /><//>
      ${err && html`<${ErrorNote} error=${err} compact />`}
      <div><${Btn} icon="plus" type="submit" disabled=${busy || !url.trim()}>${busy ? 'Checking…' : 'Add addon'}<//></div>
    </form>
  </div>`;
}

const notifPerm = () => (typeof Notification === 'undefined' ? 'unsupported' : Notification.permission);
function NotifyCard() {
  const [busy, setBusy] = useState(false);
  const [perm, setPerm] = useState(notifPerm);
  const enable = async () => {
    setBusy(true);
    try {
      const m = await import('../lib/newEpisodes.js');
      await m.requestEpisodeNotifications();
      setPerm(notifPerm());
      toast(notifPerm() === 'granted' ? 'New-episode alerts are on' : 'Notifications are blocked in your browser settings', { icon: 'bell' });
    } catch (x) { toast(x.message || 'Could not turn on notifications', { kind: 'error' }); } finally { setBusy(false); }
  };
  return html`<div class="panel stack">
    <h3><${Icon} name="bell" /> New episodes</h3>
    <p class="muted">Get a heads-up when a show you follow drops an episode.${perm === 'unsupported' ? ' On iPhone, add Streamora to your Home Screen first.' : ''}</p>
    <div><${Btn} icon="bell" disabled=${busy || perm === 'granted' || perm === 'unsupported'} onClick=${enable}>${perm === 'granted' ? 'Notifications on' : busy ? 'Asking…' : 'Enable notifications'}<//></div>
  </div>`;
}

function Connect() {
  return html`<div class="st-grid"><${TraktCard} /><${AddonsCard} /><${NotifyCard} /></div>`;
}

function Privacy() {
  const [ask, setAsk] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const p = activeProfile();
  const clearHistory = () => { history.set([]); progress.set({}); hidden.set([]); setAsk(null); toast('History wiped clean', { icon: 'sparkle' }); };
  const deleteAll = async () => {
    setBusy(true); setErr(null);
    try { await deleteDriveData(); } catch (x) { setBusy(false); return setErr(x); }
    await revokeAccess();
    await eraseDevice();
  };
  return html`<div class="stack">
    <div class="panel stack st-privacy">
      <h3>What lives where</h3>
      <ul>
        <li><b>Your Google Drive:</b> profiles, watchlists, progress, diary, settings, your Real-Debrid key and Trakt sign-ins, in one file in the "Streamora" folder of your Drive. Streamora can only see files it made itself, never your own. Leave that file be: deleting it removes your data from every device.</li>
        <li><b>This device:</b> a copy of the same, so everything is instant and works offline (localStorage). Your key is AES-encrypted here with a key the browser can't export.</li>
        <li><b>The relays</b> (/api/rd, /api/google) forward requests to Real-Debrid and Google and store nothing.</li>
        <li><b>Catalog and sources</b> come from Cinemeta, Kitsu and Torrentio. Torrentio receives your key to mark cached sources. <b>Trakt</b> (optional, per profile) sees what you watch.</li>
        <li>No analytics, no cookies, no Streamora accounts: your Google account is the only one.</li>
      </ul>
    </div>
    <div class="cluster">
      <${Btn} icon="trash" onClick=${() => setAsk('history')}>Clear ${p ? p.name + '\'s' : ''} watch history<//>
      <${Btn} variant="danger" icon="trash" onClick=${() => setAsk('all')}>Delete everything from Drive<//>
    </div>
    <${Modal} open=${!!ask} onClose=${() => setAsk(null)} title=${ask === 'all' ? 'Delete everything?' : 'Clear history?'}>
      <div class="stack">
        <${Reel} mood="sad" size=${100} />
        <p>${ask === 'all' ? 'Every profile, watchlist, diary entry and your key are deleted from your Google Drive and this device, and Streamora is signed out of your Google account everywhere. This cannot be undone.' : 'Continue Watching, resume points and history for this profile will be erased on every device.'}</p>
        ${err && html`<${ErrorNote} error=${err} compact />`}
        <div class="cluster"><${Btn} variant="danger" icon="trash" disabled=${busy} onClick=${ask === 'all' ? deleteAll : clearHistory}>${busy ? 'Deleting…' : 'Yes, erase'}<//><${Btn} variant="ghost" onClick=${() => setAsk(null)}>Cancel<//></div>
      </div>
    <//>
  </div>`;
}

function About() {
  return html`<div class="panel stack st-about">
    <div class="cluster"><${Reel} mood="popcorn" size=${110} /><div><h2>Streamora</h2><div class="type faint">version ${VERSION}</div></div></div>
    <p>A sketchbook that plays movies. Bring your own Real-Debrid key; everything else is kept in your own Google Drive.</p>
    <h3>Thanks to</h3>
    <ul>
      <li><b>Cinemeta</b> for movie and series catalogs and art</li>
      <li><b>Kitsu</b> (anime-kitsu addon) for anime catalogs</li>
      <li><b>Torrentio</b> for sources and cache flags</li>
      <li><b>OpenSubtitles</b> for subtitles</li>
      <li><b>Real-Debrid</b> for streaming and transcoding</li>
      <li>Preact, htm, hls.js, qrcode-generator</li>
    </ul>
    <p class="sticky-note">Streamora doesn't host or index anything. It connects services you choose, and you're responsible for what you stream and where you live.</p>
  </div>`;
}

const TABS = [
  { id: 'account', label: 'Account', icon: 'key' },
  { id: 'player', label: 'Player', icon: 'play' },
  { id: 'look', label: 'Look', icon: 'palette' },
  { id: 'connect', label: 'Connect', icon: 'cloud' },
  { id: 'privacy', label: 'Privacy', icon: 'lock' },
  { id: 'about', label: 'About', icon: 'info' },
];

export default function Settings({ query }) {
  const tab = TABS.some(t => t.id === query.tab) ? query.tab : 'account';
  const View = { account: Account, player: Player, look: Look, connect: Connect, privacy: Privacy, about: About }[tab];
  return html`<${Page} title="Settings" kicker="knobs & dials" icon="gear">
    <${Tabs} tabs=${TABS} value=${tab} onChange=${t => setQuery({ tab: t })} />
    <div class="st-body">${activeProfileId.get() || tab === 'about' ? html`<${View} />` : html`<${Empty} mood="confused" title="Pick a profile first" action=${html`<${Btn} href="#/profiles">Profiles<//>`} />`}</div>
  <//>`;
}
