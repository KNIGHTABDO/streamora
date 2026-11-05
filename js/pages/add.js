// #/add : paste a magnet / info hash / hoster link, or drop a .torrent file, then play it.
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { Page, Btn, Spinner, ErrorNote, Underline, Reel, Icon, loadCSS, toast, cx } from '../ui/components.js';
import { addMagnet, addTorrentFile, addWebLink, torrentInfo, webInfo, deleteTorrent, deleteWeb, TBError, VIDEO_RE, videoFiles } from '../core/tb.js';
import { fmtSize } from '../core/sources.js';
import { watchHref } from './myrd.js';
import { hash } from '../ui/sketch.js';

loadCSS('css/pages/add.css');

const HASH_RE = /^[a-f0-9]{40}$|^[a-z2-7]{32}$/i;
const sleep = ms => new Promise(r => setTimeout(r, ms));

function kindOf(text) {
  const t = text.trim();
  if (/^magnet:\?/i.test(t)) return 'magnet';
  if (HASH_RE.test(t)) return 'hash';
  if (/^https?:\/\//i.test(t)) return 'link';
  return null;
}

export default function Add() {
  const [text, setText] = useState('');
  const [job, setJob] = useState(null);     // { step, torrentId?, info?, files?, error? }
  const [drag, setDrag] = useState(false);
  const fileIn = useRef();
  const alive = useRef(true);
  useEffect(() => () => { alive.current = false; }, []);
  const kind = kindOf(text);

  // follow a torrent until it is ready (or keeps downloading in the background)
  async function follow(id, web) {
    const get = web ? webInfo : torrentInfo;
    let info = await get(id);
    while (alive.current && !['downloaded', 'error'].includes(info.status)) {
      setJob({ step: info.status === 'magnet_conversion' ? 'Reading the magnet…' : info.status === 'downloading' ? 'Not cached: TorBox is downloading it' : 'Waiting for TorBox…', torrentId: id, web, info });
      await sleep(3000); info = await get(id);
    }
    if (!alive.current) return;
    if (info.status !== 'downloaded') throw new TBError(`TorBox could not get this (${info.state}).`, 'failed', 0);
    const vids = videoFiles(info);
    setJob({ step: 'ready', torrentId: id, web, info, files: vids.length ? vids : info.files });
  }

  async function go(e) {
    e && e.preventDefault();
    const t = text.trim();
    try {
      if (kind === 'link') {
        setJob({ step: 'Sending the link to TorBox…' });
        await follow(await addWebLink(t), true);
      } else if (kind) {
        setJob({ step: 'Sending to TorBox…' });
        await follow(await addMagnet(kind === 'hash' ? `magnet:?xt=urn:btih:${t}` : t));
      }
    } catch (x) { alive.current && setJob(j => ({ ...(j || {}), step: 'error', error: x })); }
  }

  async function onFile(file) {
    if (!file) return;
    if (!/\.torrent$/i.test(file.name)) return toast('That is not a .torrent file', { kind: 'warn' });
    try { setJob({ step: 'Uploading the .torrent…' }); await follow(await addTorrentFile(file)); }
    catch (x) { setJob(j => ({ ...(j || {}), step: 'error', error: x })); }
  }

  const reset = () => { setJob(null); setText(''); };
  const discard = async () => { try { await (job.web ? deleteWeb : deleteTorrent)(job.torrentId); toast('Removed from TorBox', { icon: 'trash' }); } catch (x) { toast(x.message, { kind: 'error' }); } reset(); };
  const busy = job && !['ready', 'error'].includes(job.step);
  const info = job && job.info;

  return html`<${Page} title="Add & play" kicker="paste anything" icon="magnet" class="add">
    <div class="add-layout">
      <form class=${cx('add-drop panel', drag && 'drag')} onSubmit=${go}
        onDragOver=${e => { e.preventDefault(); setDrag(true); }} onDragLeave=${() => setDrag(false)}
        onDrop=${e => { e.preventDefault(); setDrag(false); onFile(e.dataTransfer.files[0]); }}>
        <span class="tape tl"></span><span class="tape tr alt"></span>
        <label class="add-label" for="add-text">Magnet link, info hash or hoster link</label>
        <textarea id="add-text" class="add-text" rows="4" value=${text} onInput=${e => setText(e.currentTarget.value)} disabled=${busy}
          placeholder="magnet:?xt=urn:btih:…   ·   a 40-character hash   ·   https://hoster.example/file" spellcheck="false" autocapitalize="off"></textarea>
        <div class="spread">
          <span class="type add-kind">${kind === 'magnet' ? '✎ looks like a magnet' : kind === 'hash' ? '✎ looks like an info hash' : kind === 'link' ? '✎ looks like a hoster link' : text.trim() ? '✎ hmm, not sure what that is' : '✎ or drop a .torrent file here'}</span>
          <span class="cluster">
            <${Btn} variant="ghost" icon="upload" onClick=${() => fileIn.current.click()} disabled=${busy}>.torrent<//>
            <${Btn} variant="primary" icon="play" type="submit" disabled=${!kind || busy}>Add & play<//>
          </span>
        </div>
        <input ref=${fileIn} type="file" accept=".torrent,application/x-bittorrent" hidden onChange=${e => { onFile(e.currentTarget.files[0]); e.currentTarget.value = ''; }} />
      </form>

      <section class="add-status">
        ${!job ? html`<div class="add-idle"><${Reel} mood="think" size=${130} /><p class="muted">Paste a magnet or link and it plays here.</p></div>`
        : job.step === 'error' ? html`<div class="stack"><${Reel} mood="sad" size=${110} /><${ErrorNote} error=${job.error} /><div class="cluster"><${Btn} icon="refresh" onClick=${go} disabled=${!kind}>Try again<//><${Btn} variant="ghost" onClick=${reset}>Start over<//></div></div>`
        : job.step !== 'ready' ? html`<div class="stack add-working">
            <${Spinner} label=${job.step} />
            ${info && html`<div class="panel">
              <div class="add-name">${info.filename}</div>
              ${info.status === 'downloading' && html`<${Underline} seed=${hash(info.id)} pct=${(info.progress || 0) / 100} class="add-progress" />
                <div class="type faint">${info.progress || 0}% · ${fmtSize(info.bytes)}${info.speed ? ` · ${fmtSize(info.speed)}/s` : ''}${info.seeders != null ? ` · ${info.seeders} seeders` : ''}</div>
                <p class="muted add-note">Keep this page open; it plays as soon as it's ready.</p>`}
            </div>`}
            ${job.torrentId && html`<${Btn} variant="ghost" icon="trash" onClick=${discard}>Cancel & remove<//>`}
          </div>`
        : html`<div class="stack">
            <div class="spread"><h2 class="add-ready">Ready!</h2><${Reel} mood="party" size=${90} /></div>
            <div class="add-name muted">${info.filename}</div>
            <ul class="add-files">${job.files.map(f => html`<li class="panel">
              <${Icon} name=${VIDEO_RE.test(f.name) ? 'film' : 'info'} />
              <span class="add-name" title=${f.path}>${f.name}</span>
              <span class="type faint">${fmtSize(f.bytes)}</span>
              ${VIDEO_RE.test(f.name) ? html`<${Btn} size="sm" variant="primary" icon="play" href=${watchHref(info, f)}>Play<//>` : html`<span></span>`}
            </li>`)}</ul>
            <div class="cluster"><${Btn} variant="ghost" onClick=${reset}>Add another<//></div>
          </div>`}
      </section>
    </div>
  <//>`;
}
