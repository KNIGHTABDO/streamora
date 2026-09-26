// Settings (notebook tabs) + the #/import?d=… receiver for the "send to another device" QR code.
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { Page, Btn, Tabs, Field, Input, Toggle, Select, Icon, Reel, Modal, ErrorNote, Spinner, Empty, useAsync, toast, loadCSS, cx } from '../ui/components.js';
import { Avatar } from '../ui/avatars.js';
import {
  useStore, settings, profiles, activeProfileId, activeProfile, history, progress, hidden, watchlist,
  saveRdKey, forgetRdKey, exportAll, importAll, ls,
} from '../core/store.js';
import { user } from '../core/rd.js';
import { navigate, setQuery } from '../router.js';
import { THEMES, ThemeSwatch } from './profiles.js';

loadCSS('css/pages/settings.css');

export const VERSION = '1.0.0';

// ------------------------------------------------------------ transfer encoding (deflate-raw + base64url)
const b64u = bytes => { let s = ''; bytes.forEach(b => (s += String.fromCharCode(b))); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
const unb64u = s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));
async function pipe(bytes, stream) { return new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer()); }

export async function packTransfer(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (typeof CompressionStream !== 'undefined') {
    try { return 'z' + b64u(await pipe(raw, new CompressionStream('deflate-raw'))); } catch {}
  }
  return 'p' + b64u(raw);
}
export async function unpackTransfer(s) {
  const bytes = unb64u(s.slice(1));
  const raw = s[0] === 'z' ? await pipe(bytes, new DecompressionStream('deflate-raw')) : bytes;
  return JSON.parse(new TextDecoder().decode(raw));
}

// Only what a new device needs, newest progress first, trimmed until the URL fits in a QR code.
function transferBundle(pid, keepProgress) {
  const full = exportAll({ onlyProfile: pid }).data;
  const p = k => full[`p:${pid}:${k}`];
  const prog = Object.entries(p('progress') || {}).sort((a, b) => (b[1].updated || 0) - (a[1].updated || 0)).slice(0, keepProgress)
    .map(([id, e]) => {
      const last = e.eps && e.eps[e.last || '_'];
      return [id, { ...e, eps: last ? { [e.last || '_']: last } : {}, background: undefined }];
    });
  return {
    app: 'streamora', v: 1, at: Date.now(),
    data: {
      profiles: full.profiles,
      [`p:${pid}:settings`]: p('settings'),
      [`p:${pid}:watchlist`]: (p('watchlist') || []).slice(0, keepProgress * 2).map(({ id, type, name, poster }) => ({ id, type, name, poster })),
      [`p:${pid}:progress`]: Object.fromEntries(prog),
      [`p:${pid}:follows`]: (p('follows') || []).slice(0, 30).map(({ id, type, name }) => ({ id, type, name })),
    },
  };
}
const QR_MAX = 2600; // bytes of URL a version-40/L QR can still carry with margin

function loadQR() {
  return window.qrcode ? Promise.resolve(window.qrcode) : new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/qrcode.js'; s.onload = () => res(window.qrcode); s.onerror = rej;
    document.head.appendChild(s);
  });
}

function QRCard({ pid }) {
  const [st, set] = useState({ loading: true });
  useEffect(() => {
    let alive = true;
    (async () => {
      let url = '', keep = 60;
      for (; keep >= 0; keep = keep > 10 ? Math.floor(keep / 2) : keep - 5) {
        url = `${location.origin}${location.pathname}#/import?d=${await packTransfer(transferBundle(pid, Math.max(keep, 0)))}`;
        if (url.length <= QR_MAX) break;
      }
      const qrcode = await loadQR();
      const qr = qrcode(0, 'L'); qr.addData(url); qr.make();
      alive && set({ svg: qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true }), url, keep: Math.max(keep, 0) });
    })().catch(error => alive && set({ error }));
    return () => { alive = false; };
  }, [pid]);
  if (st.loading) return html`<${Spinner} label="drawing your code…" />`;
  if (st.error) return html`<${ErrorNote} error=${st.error} />`;
  return html`<div class="st-qr-wrap">
    <div class="st-qr pf-polaroid static" style="--tilt:-2deg"><span class="tape top"></span><div class="st-qr-code" dangerouslySetInnerHTML=${{ __html: st.svg }}></div><span class="type">scan me</span></div>
    <div class="stack">
      <p>Point your phone's camera at this. It opens Streamora there with this profile's watchlist, progress and settings.</p>
      <p class="faint">Your Real-Debrid key is <b>not</b> included. Enter it on the new device.${st.keep < 60 ? ` Only the ${st.keep} most recent titles fit in the code. Use a backup file for everything.` : ''}</p>
      <div><${Btn} size="sm" icon="link" onClick=${() => navigator.clipboard.writeText(st.url).then(() => toast('Link copied'), () => toast('Could not copy', { kind: 'error' }))}>Copy link instead<//></div>
    </div>
  </div>`;
}

// ------------------------------------------------------------ import receiver (#/import?d=)
function ImportView({ d }) {
  const [st, set] = useState({ loading: true });
  useEffect(() => { unpackTransfer(d).then(b => set({ b }), error => set({ error })); }, [d]);
  const b = st.b;
  const pid = b && b.data.profiles && b.data.profiles[0] && b.data.profiles[0].id;
  const count = k => { const v = b && b.data[`p:${pid}:${k}`]; return Array.isArray(v) ? v.length : v ? Object.keys(v).length : 0; };
  const go = () => {
    try {
      importAll(b);
      if (!activeProfileId.get() && pid) activeProfileId.set(pid);
      toast('Imported! Welcome to this device.', { icon: 'sparkle' });
      navigate('/', { replace: true });
    } catch (e) { set({ error: e }); }
  };
  return html`<main class="page center-fill"><div class="panel stack st-import">
    <span class="tape top"></span>
    ${st.loading ? html`<${Spinner} label="unfolding the note…" />`
      : st.error ? html`<${Reel} mood="confused" size=${120} /><${ErrorNote} error=${st.error} /><${Btn} href="#/">Go home<//>`
      : html`
        <div class="cluster"><${Reel} mood="love" size=${100} />${b.data.profiles.map(p => html`<${Avatar} id=${p.avatar} ink=${p.ink} size=${80} />`)}</div>
        <h2>Bring ${b.data.profiles.map(p => p.name).join(', ')} over?</h2>
        <p class="muted type">${count('watchlist')} saved · ${count('progress')} in progress · ${count('follows')} followed</p>
        <p class="faint">Existing profiles on this device stay as they are.</p>
        <div class="cluster"><${Btn} variant="primary" icon="download" onClick=${go}>Import<//><${Btn} variant="ghost" href="#/">Not now<//></div>`}
  </div></main>`;
}

// ------------------------------------------------------------ tabs
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
      <${Btn} variant="danger" icon="logout" onClick=${() => setConfirm(true)}>Forget key on this device<//>
    </div>`}
    <${Modal} open=${confirm} onClose=${() => setConfirm(false)} title="Forget the key?">
      <p>Profiles and history stay. You'll need to paste your key again to watch anything.</p>
      <div class="cluster"><${Btn} variant="danger" icon="logout" onClick=${() => { forgetRdKey(); navigate('/welcome', { replace: true }); }}>Forget it<//><${Btn} variant="ghost" onClick=${() => setConfirm(false)}>Keep<//></div>
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

function Backup() {
  const pid = activeProfileId.get();
  const file = useRef();
  const [qr, setQr] = useState(false);
  const download = () => {
    const blob = new Blob([JSON.stringify(exportAll(), null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `streamora-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Backup saved', { icon: 'download' });
  };
  const upload = async e => {
    const f = e.currentTarget.files[0]; e.currentTarget.value = '';
    if (!f) return;
    try { importAll(JSON.parse(await f.text())); toast('Backup merged in', { icon: 'upload' }); }
    catch (x) { toast(x.message || 'Not a Streamora backup', { kind: 'error' }); }
  };
  return html`<div class="stack">
    <div class="st-grid">
      <div class="panel stack"><h3><${Icon} name="download" /> Backup file</h3><p class="muted">Every profile, watchlist, diary and progress in one JSON file. Your key is never included.</p><div><${Btn} icon="download" onClick=${download}>Export backup<//></div></div>
      <div class="panel stack"><h3><${Icon} name="upload" /> Restore</h3><p class="muted">Merge a backup into this device. Profiles you already have are kept.</p><div><${Btn} icon="upload" onClick=${() => file.current.click()}>Import backup<//></div>
        <input ref=${file} type="file" accept="application/json,.json" hidden onChange=${upload} /></div>
    </div>
    <div class="panel stack">
      <h3><${Icon} name="qr" /> Send to another device</h3>
      ${qr ? html`<${QRCard} pid=${pid} />` : html`<p class="muted">Start on your laptop, finish on your phone. Makes a QR code for this profile.</p><div><${Btn} variant="primary" icon="qr" onClick=${() => setQr(true)}>Show QR code<//></div>`}
    </div>
  </div>`;
}

function Privacy() {
  const [ask, setAsk] = useState(null);
  const p = activeProfile();
  const clearHistory = () => { history.set([]); progress.set({}); hidden.set([]); setAsk(null); toast('History wiped clean', { icon: 'sparkle' }); };
  const resetAll = async () => {
    forgetRdKey();
    for (const k of ls.keys()) ls.del(k);
    try { sessionStorage.clear(); } catch {}
    try { for (const n of await caches.keys()) await caches.delete(n); } catch {}
    location.hash = '#/welcome'; location.reload();
  };
  return html`<div class="stack">
    <div class="panel stack st-privacy">
      <h3>What lives where</h3>
      <ul>
        <li><b>This browser only:</b> profiles, watchlists, progress, diary and settings (localStorage).</li>
        <li><b>Your Real-Debrid key:</b> AES-encrypted in localStorage, and the encryption key can't be exported from the browser (IndexedDB).</li>
        <li><b>The relay</b> (/api/rd) forwards requests to Real-Debrid and stores nothing.</li>
        <li><b>Catalog and sources</b> come from Cinemeta, Kitsu and Torrentio. Torrentio receives your key to mark cached sources.</li>
        <li>No analytics, no accounts, no cookies.</li>
      </ul>
    </div>
    <div class="cluster">
      <${Btn} icon="trash" onClick=${() => setAsk('history')}>Clear ${p ? p.name + '\'s' : ''} watch history<//>
      <${Btn} variant="danger" icon="refresh" onClick=${() => setAsk('all')}>Reset everything<//>
    </div>
    <${Modal} open=${!!ask} onClose=${() => setAsk(null)} title=${ask === 'all' ? 'Reset everything?' : 'Clear history?'}>
      <div class="stack">
        <${Reel} mood="sad" size=${100} />
        <p>${ask === 'all' ? 'Every profile, watchlist, diary entry and your key will be erased from this device. This cannot be undone.' : 'Continue Watching, resume points and history for this profile will be erased.'}</p>
        <div class="cluster"><${Btn} variant="danger" icon="trash" onClick=${ask === 'all' ? resetAll : clearHistory}>Yes, erase<//><${Btn} variant="ghost" onClick=${() => setAsk(null)}>Cancel<//></div>
      </div>
    <//>
  </div>`;
}

function About() {
  return html`<div class="panel stack st-about">
    <div class="cluster"><${Reel} mood="popcorn" size=${110} /><div><h2>Streamora</h2><div class="type faint">version ${VERSION}</div></div></div>
    <p>A sketchbook that plays movies. Bring your own Real-Debrid key, and everything else stays on your device.</p>
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
  { id: 'backup', label: 'Backup', icon: 'qr' },
  { id: 'privacy', label: 'Privacy', icon: 'lock' },
  { id: 'about', label: 'About', icon: 'info' },
];

export default function Settings({ query }) {
  if (query.d) return html`<${ImportView} d=${query.d} />`;
  const tab = TABS.some(t => t.id === query.tab) ? query.tab : 'account';
  const View = { account: Account, player: Player, look: Look, backup: Backup, privacy: Privacy, about: About }[tab];
  return html`<${Page} title="Settings" kicker="knobs & dials" icon="gear">
    <${Tabs} tabs=${TABS} value=${tab} onChange=${t => setQuery({ tab: t })} />
    <div class="st-body">${activeProfileId.get() || tab === 'about' ? html`<${View} />` : html`<${Empty} mood="confused" title="Pick a profile first" action=${html`<${Btn} href="#/profiles">Profiles<//>`} />`}</div>
  <//>`;
}
