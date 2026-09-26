// #/myrd : your own Real-Debrid library, grouped by title and matched to posters.
import { html, useState, useEffect, useMemo } from '../../vendor/preact-htm.js';
import { Page, Grid, Tabs, Chip, Btn, IconBtn, Modal, Empty, ErrorNote, Spinner, Underline, PosterCard, Icon, loadCSS, useAsync, toast, hrefTitle, plural, cx } from '../ui/components.js';
import { user, allTorrents, downloads, torrentInfo, deleteTorrent, deleteDownload, VIDEO_RE } from '../core/rd.js';
import { resolveTitle } from '../core/meta.js';
import { fmtSize } from '../core/sources.js';
import { parse } from '../core/parse.js';
import { hash } from '../ui/sketch.js';
import { pool } from '../lib/pool.js';

loadCSS('css/pages/myrd.css');

export const watchHref = (link, name) => `#/watch/rd/${encodeURIComponent(link)}?name=${encodeURIComponent(name || '')}`;

// ---------- grouping + matching ----------
function groupTorrents(list) {
  const groups = new Map();
  for (const t of list) {
    const p = parse(t.filename);
    const kind = p.anime ? 'anime' : p.type;
    const key = `${kind}:${p.title.toLowerCase()}${p.type === 'movie' && p.year ? ':' + p.year : ''}`;
    if (!groups.has(key)) groups.set(key, { key, title: p.title || t.filename, year: p.year, type: p.type, kind, torrents: [], seasons: new Set(), eps: 0, bytes: 0, added: 0 });
    const g = groups.get(key);
    g.torrents.push({ ...t, parsed: p });
    if (p.season != null) g.seasons.add(p.season);
    if (p.episode != null) g.eps++;
    g.bytes += t.bytes || 0;
    g.added = Math.max(g.added, +new Date(t.added));
    if (!g.year && p.year) g.year = p.year;
  }
  return [...groups.values()];
}

function useMatches(groups) {
  const [matches, set] = useState({});
  useEffect(() => {
    let alive = true;
    pool(groups, 6, async g => {
      const m = await resolveTitle(g.title, g.year, g.kind === 'anime' ? 'anime' : g.type);
      if (alive && m) set(s => ({ ...s, [g.key]: m }));
    });
    return () => { alive = false; };
  }, [groups]);
  return matches;
}

const daysLeft = u => Math.max(0, Math.round((new Date(u.expiration) - Date.now()) / 864e5));

function Account({ u }) {
  if (!u) return null;
  const d = daysLeft(u);
  return html`<div class="myrd-account">
    <div><div class="kicker type">signed in as</div><b class="myrd-user display">${u.username}</b><div class="type faint">${u.points} fidelity points</div></div>
    <div class=${cx('myrd-stamp', d < 7 && 'low')} title=${`Premium until ${new Date(u.expiration).toLocaleDateString()}`}>
      <span class="type">${u.type}</span><b>${d}</b><span class="type">days left</span>
    </div>
  </div>`;
}

// ---------- library ----------
function GroupModal({ group, match, onClose, onDeleted }) {
  const [files, setFiles] = useState({}); // torrentId -> [{name, link, bytes}] | 'loading'
  const [confirm, setConfirm] = useState(null);
  if (!group) return null;
  const sorted = group.torrents.slice().sort((a, b) => ((a.parsed.season ?? 0) - (b.parsed.season ?? 0)) || ((a.parsed.episode ?? 0) - (b.parsed.episode ?? 0)) || a.filename.localeCompare(b.filename));

  const expand = async t => {
    setFiles(f => ({ ...f, [t.id]: 'loading' }));
    try {
      const info = await torrentInfo(t.id);
      const sel = info.files.filter(f => f.selected);
      const list = sel.map((f, i) => ({ name: f.path.split('/').pop(), link: info.links[i], bytes: f.bytes })).filter(f => f.link && VIDEO_RE.test(f.name));
      setFiles(f => ({ ...f, [t.id]: list }));
    } catch (e) { toast(e.message, { kind: 'error' }); setFiles(f => ({ ...f, [t.id]: undefined })); }
  };
  const del = async t => {
    try { await deleteTorrent(t.id); toast('Removed from Real-Debrid', { icon: 'trash' }); onDeleted(t.id); }
    catch (e) { toast(e.message, { kind: 'error' }); }
    setConfirm(null);
  };

  return html`<${Modal} open title=${group.title} onClose=${onClose} wide>
    ${match && html`<a class="myrd-matched" href=${hrefTitle(match)} onClick=${onClose}><${Icon} name="info" size=${18} /> Open the ${match.type === 'series' ? 'show' : 'movie'} page</a>`}
    <ul class="myrd-files">
      ${sorted.map(t => {
        const p = t.parsed, fs = files[t.id];
        const multi = t.links && t.links.length > 1;
        return html`<li key=${t.id}>
          <div class="myrd-file">
            <span class="myrd-file-tag type">${p.season != null ? `S${p.season}${p.episode != null ? ' E' + p.episode : ''}` : p.episode != null ? `E${p.episode}` : p.quality || 'file'}</span>
            <span class="myrd-file-name" title=${t.filename}>${t.filename}</span>
            <span class="type faint">${fmtSize(t.bytes)}${multi ? ` · ${t.links.length} files` : ''}</span>
            <span class="cluster">
              ${t.status !== 'downloaded' ? html`<span class="type">${t.status} ${t.progress}%</span>`
                : multi ? html`<${Btn} size="sm" icon=${fs ? 'up' : 'list'} onClick=${() => (fs ? setFiles(f => ({ ...f, [t.id]: undefined })) : expand(t))}>Files<//>`
                : html`<${Btn} size="sm" variant="primary" icon="play" href=${watchHref(t.links[0], t.filename)}>Play<//>`}
              <${IconBtn} icon="trash" label="Delete" onClick=${() => setConfirm(t)} />
            </span>
          </div>
          ${fs === 'loading' && html`<${Spinner} label="opening the torrent…" size=${40} />`}
          ${Array.isArray(fs) && html`<ul class="myrd-subfiles">${fs.map(f => html`<li>
            <span class="myrd-file-name">${f.name}</span><span class="type faint">${fmtSize(f.bytes)}</span>
            <${Btn} size="sm" variant="primary" icon="play" href=${watchHref(f.link, f.name)}>Play<//>
          </li>`)}</ul>`}
        </li>`;
      })}
    </ul>
    <${Modal} open=${!!confirm} title="Delete from Real-Debrid?" onClose=${() => setConfirm(null)}>
      <p>This removes <b>${confirm && confirm.filename}</b> from your Real-Debrid account. You can always add it again.</p>
      <div class="cluster"><${Btn} variant="danger" icon="trash" onClick=${() => del(confirm)}>Delete<//><${Btn} variant="ghost" onClick=${() => setConfirm(null)}>Keep it<//></div>
    <//>
  <//>`;
}

function Library({ torrents, onDeleted }) {
  const [kind, setKind] = useState('all');
  const [sort, setSort] = useState('recent');
  const [open, setOpen] = useState(null);
  const groups = useMemo(() => groupTorrents(torrents.filter(t => t.status === 'downloaded')), [torrents]);
  const matches = useMatches(groups);
  const shown = groups.filter(g => kind === 'all' || g.kind === kind)
    .sort(sort === 'az' ? (a, b) => a.title.localeCompare(b.title) : sort === 'size' ? (a, b) => b.bytes - a.bytes : (a, b) => b.added - a.added);
  if (!groups.length) return html`<${Empty} mood="popcorn" title="Your Real-Debrid is empty" text="Anything you play in Streamora or add on real-debrid.com shows up here." action=${html`<${Btn} href="#/add" icon="magnet">Add a magnet<//>`} />`;
  const count = k => groups.filter(g => g.kind === k).length;
  return html`
    <div class="spread myrd-filters">
      <div class="chips scroll">
        ${[['all', 'Everything', groups.length], ['movie', 'Movies', count('movie')], ['series', 'Shows', count('series')], ['anime', 'Anime', count('anime')]]
          .map(([id, label, n]) => html`<${Chip} active=${kind === id} onClick=${() => setKind(id)}>${label} <span class="type faint">${n}</span><//>`)}
      </div>
      <div class="chips">
        ${[['recent', 'Recent'], ['az', 'A–Z'], ['size', 'Biggest']].map(([id, l]) => html`<${Chip} icon=${id === sort ? 'sort' : null} active=${sort === id} onClick=${() => setSort(id)}>${l}<//>`)}
      </div>
    </div>
    <${Grid} items=${shown} render=${g => {
      const m = matches[g.key];
      const label = g.type === 'series'
        ? [g.seasons.size && `S${[...g.seasons].sort((a, b) => a - b).join(', ')}`, g.eps ? plural(g.eps, 'ep') : plural(g.torrents.length, 'pack')].filter(Boolean).join(' · ')
        : `${g.year || ''}${g.year ? ' · ' : ''}${fmtSize(g.bytes)}`;
      const item = { id: 'rd:' + hash(g.key), name: m ? m.name : g.title, poster: m && m.poster, year: g.year };
      return html`<${PosterCard} key=${g.key} item=${item} label=${label} onClick=${() => setOpen(g)} badge=${g.torrents.some(t => /2160p|4k/i.test(t.filename)) ? '4K' : null} />`;
    }} />
    ${open && html`<${GroupModal} group=${open} match=${matches[open.key]} onClose=${() => setOpen(null)}
      onDeleted=${id => { onDeleted(id); setOpen(o => { const t = o.torrents.filter(x => x.id !== id); return t.length ? { ...o, torrents: t } : null; }); }} />`}`;
}

// ---------- downloads (torrents still in progress) ----------
function Active({ torrents, onDeleted }) {
  const active = torrents.filter(t => t.status !== 'downloaded');
  if (!active.length) return html`<${Empty} mood="sleep" title="Nothing downloading" text="Uncached sources you start show their progress here while Real-Debrid fetches them." />`;
  const bad = s => ['error', 'magnet_error', 'virus', 'dead'].includes(s);
  return html`<ul class="myrd-active">${active.map(t => html`<li key=${t.id} class=${cx('panel', bad(t.status) && 'bad')}>
    <div class="spread">
      <span class="myrd-file-name" title=${t.filename}>${t.filename}</span>
      <span class="cluster"><span class=${cx('myrd-status type', bad(t.status) && 'bad')}>${t.status.replace(/_/g, ' ')}</span>
      <${IconBtn} icon="trash" label="Delete" onClick=${async () => { try { await deleteTorrent(t.id); onDeleted(t.id); toast('Removed'); } catch (e) { toast(e.message, { kind: 'error' }); } }} /></span>
    </div>
    <${Underline} seed=${hash(t.id)} pct=${(t.progress || 0) / 100} class="myrd-progress" />
    <div class="type faint">${t.progress || 0}% · ${fmtSize(t.bytes)}${t.speed ? ` · ${fmtSize(t.speed)}/s` : ''}${t.seeders != null ? ` · ${t.seeders} seeders` : ''}</div>
  </li>`)}</ul>`;
}

// ---------- hoster links (unrestricted downloads) ----------
function Hosters({ list, onDeleted }) {
  const items = list.filter(d => d.host !== 'real-debrid.com');
  if (!items.length) return html`<${Empty} mood="binoculars" title="No hoster links yet" text="Paste a link from a file hoster on the Add page and it will appear here." action=${html`<${Btn} href="#/add" icon="link">Add a link<//>`} />`;
  return html`<ul class="myrd-active">${items.map(d => html`<li key=${d.id} class="panel">
    <div class="spread">
      <span class="cluster myrd-host">${d.host_icon && html`<img src=${d.host_icon} alt="" width="20" height="20" />`}<span class="myrd-file-name" title=${d.filename}>${d.filename}</span></span>
      <span class="cluster">
        <span class="type faint">${fmtSize(d.filesize)} · ${d.host}</span>
        ${d.streamable ? html`<${Btn} size="sm" variant="primary" icon="play" href=${watchHref(d.link, d.filename)}>Play<//>` : html`<a class="btn btn-ghost btn-sm" href=${d.download} target="_blank" rel="noopener"><${Icon} name="download" size=${16} /><span>Download</span></a>`}
        <${IconBtn} icon="trash" label="Delete" onClick=${async () => { try { await deleteDownload(d.id); onDeleted(d.id); } catch (e) { toast(e.message, { kind: 'error' }); } }} />
      </span>
    </div>
  </li>`)}</ul>`;
}

export default function MyRD() {
  const [tab, setTab] = useState('library');
  const acct = useAsync(() => user(), []);
  const data = useAsync(() => Promise.all([allTorrents(), downloads(1, 100)]).then(([t, d]) => ({ t: t || [], d: d || [] })), []);
  const [gone, setGone] = useState(new Set());
  const t = ((data.data && data.data.t) || []).filter(x => !gone.has(x.id));
  const d = ((data.data && data.data.d) || []).filter(x => !gone.has(x.id));
  const drop = id => setGone(s => new Set([...s, id]));
  const activeCount = t.filter(x => x.status !== 'downloaded').length;

  return html`<${Page} title="My Real-Debrid" kicker="your own shelf" icon="cloud" class="myrd"
      actions=${html`<div class="cluster"><${Btn} size="sm" icon="magnet" href="#/add">Add<//><${Btn} size="sm" icon="refresh" variant="ghost" onClick=${() => { setGone(new Set()); data.reload(); acct.reload(); }}>Refresh<//></div>`}>
    <${Account} u=${acct.data} />
    <${Tabs} tabs=${[
      { id: 'library', label: 'Library', icon: 'grid', count: data.data ? t.filter(x => x.status === 'downloaded').length : null },
      { id: 'active', label: 'Downloads', icon: 'download', count: data.data ? activeCount : null },
      { id: 'hosters', label: 'Hosters', icon: 'link', count: data.data ? d.filter(x => x.host !== 'real-debrid.com').length : null },
    ]} value=${tab} onChange=${setTab} />
    <div class="myrd-body">
      ${data.error ? html`<${ErrorNote} error=${data.error} retry=${data.reload} />`
        : data.loading ? html`<${Grid} items=${[]} loading />`
        : tab === 'library' ? html`<${Library} torrents=${t} onDeleted=${drop} />`
        : tab === 'active' ? html`<${Active} torrents=${t} onDeleted=${drop} />`
        : html`<${Hosters} list=${d} onDeleted=${drop} />`}
    </div>
  <//>`;
}
