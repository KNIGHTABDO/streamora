// #/watch/{type}/{id}?v=&t=&hash=&file=&fn=   and   #/watch/rd/{link}?name=
// Finds a source, resolves it on Real-Debrid (auto-retrying the next source), asks to resume, then hands off to <Player>.
import { html, useState, useEffect, useRef } from '../../vendor/preact-htm.js';
import { Btn, Icon, Reel, Img, Modal, Chip, cx, fmtTime, loadCSS } from '../ui/components.js';
import { meta as getMeta, backdropOf } from '../core/meta.js';
import { streams, rankStreams, fmtSize, isPhone, noMkv } from '../core/sources.js';
import { resolveStream, resolveLink, mediaInfos, torrents } from '../core/rd.js';
import { resumeAt } from '../core/progress.js';
import { settings, progress } from '../core/store.js';
import { navigate } from '../router.js';
import { Player } from '../player/player.js';
import { NativePlayer, isNative } from '../player/native.js';

loadCSS('css/player.css');

const MAX_AUTO = 4;

export default function Watch({ params, query }) {
  if (params.type === 'rd') return html`<${RdWatch} key=${params.id} link=${params.id} name=${query.name} />`;
  const k = [params.type, params.id, query.v || '', query.hash || '', query.file || ''].join('|');
  return html`<${Session} key=${k} params=${params} query=${query} />`;
}

const backTo = (type, id) => () => navigate(`#/title/${type}/${encodeURIComponent(id)}`, { replace: true });

function friendly(e) {
  const code = e && e.code;
  if (code === 'nokey' || code === 8 || (e && e.status === 401)) return { mood: 'sad', title: 'Your Real-Debrid key stopped working', text: 'It may have expired or been reset. Paste a fresh one in Settings.', key: true };
  if (code === 'network') return { mood: 'sad', title: 'Can\'t reach Real-Debrid', text: 'Looks like you\'re offline, or the relay is down. Try again in a moment.' };
  if (code === 'notcached') return { mood: 'sleep', title: 'Not cached yet', text: e.message };
  if (code === 'nosources') return { mood: 'binoculars', title: 'Nothing cached for this one', text: 'Real-Debrid doesn\'t have a ready copy. Open the source list to try an uncached one (it downloads in the background).' };
  return { mood: 'confused', title: 'That reel got tangled', text: (e && e.message) || 'Something went wrong while starting playback.' };
}

function Session({ params, query }) {
  const [meta, setMeta] = useState(null);
  const [video, setVideo] = useState(null);
  const [cands, setCands] = useState(null);       // ranked sources
  const [allCands, setAll] = useState(null);      // including uncached
  const [step, setStep] = useState('Finding sources…');
  const [attempt, setAttempt] = useState(0);
  const [ready, setReady] = useState(null);       // { stream, info, source }
  const [err, setErr] = useState(null);
  const [picker, setPicker] = useState(false);
  const [startAt, setStartAt] = useState(query.t ? +query.t : null);
  const [ask, setAsk] = useState(0);              // resume seconds to ask about
  const tried = useRef(new Set());
  const gen = useRef(0);
  const s = settings.get();

  // 1. meta + resume question
  useEffect(() => {
    getMeta(params.type, params.id).then(m => {
      if (!m) throw new Error('Title not found');
      setMeta(m);
      const v = query.v ? (m.videos || []).find(x => x.id === query.v) || { id: query.v, season: +query.v.split(':').slice(-2)[0] || 1, episode: +query.v.split(':').pop() } : null;
      setVideo(v);
      if (startAt == null) {
        const r = resumeAt(m.id, v && v.id);
        if (r > 0) setAsk(r); else setStartAt(0);
      }
    }).catch(e => setErr(e));
  }, []);

  // 2. sources
  useEffect(() => {
    if (!meta) return;
    const id = video ? video.id : meta.id;
    const binge = (progress.get()[meta.id] || {}).source?.binge;
    // transcodes top out at 1080p unless "original" is chosen, so 4K files only cost start-up time
    const prefs = { cachedOnly: s.cachedOnly !== false, preferSmall: isPhone(), preferMp4: noMkv(), preferBinge: binge, audioLang: s.audioLang, maxQuality: s.quality === 'original' ? '2160p' : '1080p' };
    Promise.all([streams(meta.type, id), torrents(1, 100).catch(() => [])]).then(([list, mine]) => {
      // sources already in the account start instantly (no new torrent added), so they go first
      const have = new Set((mine || []).filter(t => t.status === 'downloaded').map(t => t.hash.toLowerCase()));
      list.forEach(x => { if (have.has(x.infoHash.toLowerCase())) { x.inAccount = true; x.cached = true; } });
      const first = x => x.inAccount && !x.pack;
      const mineFirst = l => [...l.filter(first), ...l.filter(x => !first(x))];
      const all = mineFirst(rankStreams(list, { ...prefs, cachedOnly: false }));
      setAll(all);
      if (query.hash) {
        const h = query.hash.toLowerCase();
        const pinned = all.find(x => x.infoHash.toLowerCase() === h) || { infoHash: h, fileIdx: query.file != null ? +query.file : undefined, filename: query.fn || null, release: query.fn || 'Chosen source', quality: '?', cached: true };
        setCands([pinned, ...mineFirst(rankStreams(list, prefs)).filter(x => x.infoHash.toLowerCase() !== h)]);
      } else {
        const ranked = mineFirst(rankStreams(list, prefs));
        setCands(ranked);
        if (!ranked.length) setErr(Object.assign(new Error('No cached sources'), { code: 'nosources' }));
      }
    }, e => {
      if (query.hash) setCands([{ infoHash: query.hash, fileIdx: query.file != null ? +query.file : undefined, filename: query.fn || null, release: query.fn || 'Chosen source', quality: '?' }]);
      else setErr(Object.assign(new Error('Couldn\'t search for sources: ' + e.message), { code: 'network' }));
    });
  }, [meta, video]);

  // 3. resolve candidate by candidate
  const tryFrom = async (list, i, manual) => {
    const me = ++gen.current;
    setErr(null); setReady(null);
    for (let n = 0; i < list.length && (manual || n < MAX_AUTO); i++) {
      const c = list[i];
      if (!manual && tried.current.has(c.infoHash)) continue;
      tried.current.add(c.infoHash);
      setAttempt(++n);   // skipped (already tried) sources don't count toward MAX_AUTO
      try {
        const stream = await resolveStream({ infoHash: c.infoHash, fileIdx: c.fileIdx, filename: c.filename, season: video && video.season, episode: video && video.episode },
          t => me === gen.current && setStep(t));
        if (me !== gen.current) return;
        let info = null;
        try { info = await mediaInfos(stream.downloadId); } catch {}
        if (me !== gen.current) return;
        setReady({ stream, info, source: c });
        return;
      } catch (e) {
        if (me !== gen.current) return;
        if (e.code === 'nokey' || e.code === 8 || e.code === 'network' || manual) { setErr(e); return; }
        setStep(`That one didn't work (${e.message.split('.')[0].toLowerCase()}). Trying another…`);
      }
    }
    if (me === gen.current) setErr(Object.assign(new Error('None of the best sources would start.'), { code: 'nosources' }));
  };
  useEffect(() => { if (cands && cands.length) tryFrom(cands, 0); }, [cands]);

  const pick = c => { setPicker(false); tried.current.delete(c.infoHash); tryFrom([c], 0, true); };
  const onFatal = (e, pos) => {
    // the resolved stream died while playing → move to the next untried source, resuming where it stopped
    if (pos > 0) setStartAt(Math.floor(pos));
    if (!cands) return setErr(e);
    const i = cands.findIndex(c => !tried.current.has(c.infoHash));
    if (i < 0) setErr(e); else { setStep('That stream hiccuped. Trying another source…'); tryFrom(cands, i); }
  };

  const onBack = backTo(params.type, params.id);
  const bg = meta && backdropOf(meta);
  const showPlayer = ready && startAt != null;

  return html`<div class="watch" data-no-paper>
    ${showPlayer
      ? html`<${isNative() ? NativePlayer : Player} meta=${meta} video=${video} stream=${ready.stream} info=${ready.info} start=${startAt} source=${ready.source}
          onFatal=${onFatal} onPickSource=${() => setPicker(true)} onBack=${onBack} />`
      : html`<${Loading} bg=${bg} meta=${meta} video=${video} step=${step} attempt=${attempt} err=${err}
          onBack=${onBack} onPick=${allCands ? () => setPicker(true) : null}
          onRetry=${() => { tried.current.clear(); cands && cands.length ? tryFrom(cands, 0) : location.reload(); }} />`}

    ${ask > 0 && startAt == null && html`<div class="watch-resume">
      <div class="watch-resume-card panel">
        <span class="tape top"></span>
        <${Reel} mood="popcorn" size=${96} />
        <h2>Welcome back!</h2>
        <p class="muted">You stopped at <b>${fmtTime(ask)}</b>${video ? ` in S${video.season} · E${video.episode}` : ''}.</p>
        <div class="cluster">
          <${Btn} variant="primary" icon="play" onClick=${() => setStartAt(ask)} autofocus>Resume from ${fmtTime(ask)}<//>
          <${Btn} icon="refresh" onClick=${() => setStartAt(0)}>Start over<//>
        </div>
      </div>
    </div>`}

    <${SourcePicker} open=${picker} onClose=${() => setPicker(false)} list=${allCands} current=${ready && ready.source} onPick=${pick} />
  </div>`;
}

function Loading({ bg, meta, video, step, attempt, err, onBack, onPick, onRetry }) {
  const f = err && friendly(err);
  return html`<div class="watch-loading">
    ${bg && html`<div class="watch-bg riso"><${Img} src=${bg} alt="" /></div>`}
    <div class="watch-bg-fade"></div>
    <button type="button" class="pl-btn watch-back" onClick=${onBack} aria-label="Back"><${Icon} name="back" size=${28} /></button>
    <div class="watch-loading-card">
      ${f ? html`
        <${Reel} mood=${f.mood} size=${150} />
        <h2>${f.title}</h2>
        <p class="muted">${f.text}</p>
        <div class="cluster watch-actions">
          ${f.key ? html`<${Btn} variant="primary" icon="key" href="#/settings">Open settings<//>` : html`<${Btn} variant="primary" icon="refresh" onClick=${onRetry}>Try again<//>`}
          ${onPick && html`<${Btn} icon="source" onClick=${onPick}>Choose a source<//>`}
          <${Btn} variant="ghost" icon="back" onClick=${onBack}>Back<//>
        </div>`
      : html`
        <${Reel} mood=${/prepar|unlock/i.test(step) ? 'popcorn' : 'binoculars'} size=${150} />
        ${meta && html`<h2 class="watch-title">${meta.name}</h2>`}
        ${video && html`<div class="type muted">S${video.season} · E${video.episode}${video.name ? ' · ' + video.name : ''}</div>`}
        <p class="watch-step"><span class="watch-dots"><i></i><i></i><i></i></span>${step}</p>
        ${attempt > 1 && html`<p class="type faint">source ${attempt} of ${MAX_AUTO}</p>`}
        ${onPick && html`<${Btn} size="sm" variant="ghost" icon="source" onClick=${onPick}>Pick a source myself<//>`}`}
    </div>
  </div>`;
}

function SourcePicker({ open, onClose, list, current, onPick }) {
  const [cachedOnly, setCachedOnly] = useState(true);
  const [q, setQ] = useState('all');
  if (!open) return null;
  const quals = ['all', ...new Set((list || []).map(x => x.quality).filter(x => x !== '?'))];
  const shown = (list || []).filter(x => (!cachedOnly || x.cached) && (q === 'all' || x.quality === q));
  return html`<${Modal} open=${open} onClose=${onClose} title="Pick a source" wide class="watch-picker">
    <div class="spread">
      <div class="chips scroll">${quals.map(x => html`<${Chip} active=${q === x} onClick=${() => setQ(x)}>${x === 'all' ? 'All' : x}<//>`)}</div>
      <${Chip} active=${cachedOnly} icon="cloud" onClick=${() => setCachedOnly(!cachedOnly)}>Cached only<//>
    </div>
    ${!list ? html`<p class="muted">Still looking…</p>` : !shown.length ? html`<p class="muted">No sources match. ${cachedOnly && 'Try turning off "Cached only".'}</p>` : html`
    <ul class="watch-sources">
      ${shown.slice(0, 80).map(x => html`<li><button type="button" class=${cx('watch-src', current && current.infoHash === x.infoHash && 'now')} onClick=${() => onPick(x)}>
        <span class="watch-src-q display">${x.quality === '2160p' ? '4K' : x.quality === '?' ? '—' : x.quality.replace('p', '')}<small>${x.quality !== '?' && x.quality !== '2160p' ? 'p' : ''}</small></span>
        <span class="watch-src-body">
          <span class="watch-src-name">${x.release}</span>
          <span class="watch-src-tags">
            ${x.inAccount && html`<span class="watch-tag rd">in your RD</span>`}
            ${x.cached ? html`<span class="watch-tag rd">RD+ cached</span>` : html`<span class="watch-tag slow">not cached</span>`}
            ${x.hdr && html`<span class="watch-tag">${x.dv ? 'Dolby Vision' : 'HDR'}</span>`}
            ${x.remux && html`<span class="watch-tag">remux</span>`}
            ${x.dual && html`<span class="watch-tag">multi-audio</span>`}
            ${x.cam && html`<span class="watch-tag warn">cam</span>`}
            <span class="type faint">${[fmtSize(x.size), x.seeders ? `${x.seeders} seeds` : '', x.site, x.langs.join(' ')].filter(Boolean).join(' · ')}</span>
          </span>
        </span>
        <${Icon} name=${current && current.infoHash === x.infoHash ? 'check' : 'play'} size=${22} />
      </button></li>`)}
    </ul>`}
  <//>`;
}

// ---- play something straight from the user's Real-Debrid account
function RdWatch({ link, name }) {
  const [st, setSt] = useState({ ready: null, err: null });
  useEffect(() => {
    resolveLink(link).then(async stream => {
      let info = null;
      try { info = await mediaInfos(stream.downloadId); } catch {}
      if (!stream.hls && !/\.(mp4|webm|m4v)$/i.test(stream.filename || '')) throw new Error('Real-Debrid can\'t stream this file type.');
      setSt({ ready: { stream, info } });
    }).catch(err => setSt({ err }));
  }, []);
  const onBack = () => (history.length > 1 ? history.back() : navigate('#/myrd'));
  const pseudo = st.ready && { id: 'rd:' + st.ready.stream.downloadId, type: 'movie', name: name || st.ready.stream.filename, background: st.ready.info && st.ready.info.backdrop_path };
  return html`<div class="watch" data-no-paper>
    ${st.ready ? html`<${isNative() ? NativePlayer : Player} meta=${pseudo} video=${null} stream=${st.ready.stream} info=${st.ready.info} start=${0} noProgress onFatal=${e => setSt({ err: e })} onBack=${onBack} />`
      : html`<${Loading} step="Unlocking your file…" attempt=${0} err=${st.err} onBack=${onBack} onRetry=${() => location.reload()} />`}
  </div>`;
}
