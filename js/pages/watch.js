// #/watch/{type}/{id}?v=&t=&hash=&file=&fn=   and   #/watch/tb/{ref}?name=
// Finds a source, resolves it on TorBox (auto-retrying the next source), asks to resume, then hands off to <Player>.
import { mark } from '../lib/perf-mark.js';
import { expectedIdentity, sourceIssue, sourceFileKey, contentError, baseName } from '../lib/source-identity.js';
import { assessSources, rejectedSource, rejectSource, invalidateRememberedSource } from '../lib/source-validation.js';
import { html, useState, useEffect, useRef, useMemo } from '../../vendor/preact-htm.js';
import { Btn, Icon, Reel, Img, Modal, Chip, cx, fmtTime, loadCSS, toast } from '../ui/components.js';
import { meta as getMeta, backdropOf, nextVideo, isReleased } from '../core/meta.js';
import { streams, rankStreams, fmtSize, isPhone, webPrefs, peekStreams, prefetchStreams } from '../core/sources.js';
import { resolveStream, resolveLink, torrents, webStreamingRefused, knownTorrents, prefetchOwned, ownedFile } from '../core/tb.js';
import { resumeAt } from '../core/progress.js';
import { settings, progress } from '../core/store.js';
import { navigate, back } from '../router.js';
import { Player } from '../player/player.js';
import { AppPlayer, isNative } from '../player/native.js';

loadCSS('css/player.css');

const MAX_AUTO = 4;

export function mp4TailRange(stream, native = false) {
  return !native && !stream.hls && !stream.remux && /\.mp4$/i.test(stream.filename || '') && Number.isFinite(stream.filesize) && stream.filesize > 0
    ? `bytes=${Math.max(0, stream.filesize - 262144)}-` : null;
}
export function warmMp4Tail(stream, { native = false, signal } = {}) {
  const range = mp4TailRange(stream, native);
  if (range && stream.direct && !signal?.aborted) {
    try { fetch(stream.direct, { mode: 'no-cors', headers: { Range: range }, signal }).catch(() => {}); } catch {}
  }
}

export default function Watch({ params, query }) {
  if (params.type === 'tb') return html`<${LibraryWatch} key=${params.id} link=${params.id} name=${query.name} />`;
  const k = [params.type, params.id, query.v || '', query.hash || '', query.file || ''].join('|');
  return html`<${Session} key=${k} params=${params} query=${query} />`;
}

const backTo = (type, id) => () => navigate(`#/title/${type}/${encodeURIComponent(id)}`, { replace: true });

// a request that never got an answer (offline, server down, blocked): never show the browser's raw wording
const netFail = e => !!e && (e.code === 'network' || /failed to fetch|networkerror|load failed/i.test(e.message || ''));

function friendly(e) {
  const code = e && e.code;
  if (code === 'nokey' || code === 'badkey') return { mood: 'sad', title: 'Your TorBox key stopped working', text: 'It may have expired or been reset. Paste a fresh one in Settings.', key: true };
  if (netFail(e)) return { mood: 'sad', title: 'Can\'t reach TorBox', text: 'Looks like you\'re offline, or the relay is down. Try again in a moment.' };
  if (code === 'content_mismatch') return { mood: 'binoculars', title: 'No matching copy found', text: e.message + ' Choose another source, or try again later.' };
  if (code === 'sources') return { mood: 'binoculars', title: 'The sources didn\'t answer', text: 'They are slow or down right now. Try again in a moment.' };
  if (code === 'notcached') return { mood: 'sleep', title: 'Not cached yet', text: e.message };
  if (code === 'webplan') return { mood: 'confused', title: 'This copy can\'t play in a browser', text: e.message };
  if (code === 'nosources') return { mood: 'binoculars', title: 'Nothing cached for this one', text: 'TorBox doesn\'t have a ready copy. Open the source list to try an uncached one (it downloads in the background).' };
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
  const controller = useRef(null);
  if (!controller.current) controller.current = typeof AbortController === 'function' ? new AbortController() : { abort() {}, signal: undefined };
  const known = useRef([]);
  const automatic = useRef([]);
  const prefetching = useRef(false);
  const live = useRef(null);      // the player's position (s), kept current by <Player>: a source switch resumes there
  const s = settings.get();

  // 1. meta + resume question
  useEffect(() => {
    mark('play:tap');
    getMeta(params.type, params.id, { signal: controller.current.signal }).then(m => {
      if (controller.current.signal?.aborted) return;
      if (!m) throw new Error('Title not found');
      mark('play:meta');
      setMeta(m);
      const v = query.v ? (m.videos || []).find(x => x.id === query.v) || { id: query.v, season: query.v.startsWith('kitsu:') ? undefined : +query.v.split(':').slice(-2)[0] || 1, episode: +query.v.split(':').pop() } : null;
      setVideo(v);
      const target = expectedIdentity(m, v), previous = progress.get()[m.id];
      const oldDuration = previous?.eps?.[v?.id || '_']?.dur;
      // Manual 'mark watched' entries use a synthetic duration of 100 seconds.
      const issue = oldDuration > 300 && previous?.source && sourceIssue(previous.source, target, oldDuration);
      if (previous?.eps?.[v?.id || '_']?.sourceMismatch) {
        setStartAt(0); setAsk(0);
      } else if (issue && previous?.source && (previous.last || '') === (v?.id || '')) {
        rejectSource(target, previous.source, issue);
        invalidateRememberedSource(target, previous.source);
        setStartAt(0); setAsk(0);
      } else if (startAt == null) {
        const r = resumeAt(m.id, v && v.id);
        if (r > 0) setAsk(r); else setStartAt(0);
      }
    }).catch(e => { if (!controller.current.signal?.aborted) setErr(e); });
    return () => { gen.current++; controller.current.abort(); };
  }, []);

  // 2. sources
  useEffect(() => {
    const id = query.v || params.id;
    const signal = controller.current.signal;
    const binge = (progress.get()[params.id] || {}).source?.binge;
    // on the web 4K files only cost start-up time unless "original" is chosen
    const prefs = { cachedOnly: s.cachedOnly !== false, preferSmall: isPhone(), ...webPrefs(webStreamingRefused()), preferBinge: binge, audioLang: s.audioLang, maxQuality: s.quality === 'original' ? '2160p' : '1080p' };
    let gone = false, initial = false, latest = null;
    const markOwned = list => {
      const have = new Set(known.current.filter(t => t.status === 'downloaded').map(t => t.hash.toLowerCase()));
      return list.map(x => have.has(x.infoHash.toLowerCase()) ? { ...x, inAccount: true, cached: true } : x);
    };
    const partial = list => {
      latest = list;
      if (!gone && initial) {
        const owned = markOwned(list);
        automatic.current = rankStreams(owned, prefs);
        setAll(rankStreams(owned, { ...prefs, cachedOnly: false }));
      }
    };
    const cached = typeof peekStreams === 'function' && peekStreams(params.type, params.id, query.v);
    const sources = cached ? Promise.resolve(cached) : streams(params.type, id, { signal, onPartial: partial });
    if (cached && !cached.complete) streams(params.type, id, { signal, onPartial: partial }).then(partial).catch(() => {});
    const account = (typeof knownTorrents === 'function' ? knownTorrents() : Promise.resolve(null))
      .then(rows => rows || torrents(1, 100, { signal })).catch(() => []);
    Promise.all([sources, account]).then(([found, mine]) => {
      if (gone || signal?.aborted) return;
      known.current = mine || []; initial = true;
      if (found.failed?.length && found.length) toast(`${found.failed.join(', ')} didn't answer. Showing the rest.`, { kind: 'warn', icon: 'warn' });
      const list = markOwned(found);
      // a copy already in the account starts a little faster, but only goes first when it's as good as the best one
      const mineFirst = l => {
        const top = l.find(x => x.cached);
        const first = x => x.inAccount && !x.pack && (!top || x.rank >= top.rank);
        return [...l.filter(first), ...l.filter(x => !first(x))];
      };
      const all = mineFirst(rankStreams(list, { ...prefs, cachedOnly: false }));
      setAll(all);
      if (query.hash) {
        const h = query.hash.toLowerCase();
        const exact = all.find(x => x.infoHash.toLowerCase() === h && (!query.fn || baseName(x.filename) === baseName(query.fn)));
        const sameHash = all.find(x => x.infoHash.toLowerCase() === h);
        const pinned = exact || (sameHash && { ...sameHash, durations: [], contentIds: [] }) || { infoHash: h, fileIdx: query.file != null ? +query.file : undefined, filename: query.fn || null, release: query.fn || 'Chosen source', quality: '?', cached: true };
        const chosen = { ...pinned, ...(query.file != null ? { fileIdx: +query.file } : {}), ...(query.fn != null ? { filename: query.fn } : {}) };
        const selected = [chosen, ...mineFirst(rankStreams(list, prefs)).filter(x => sourceFileKey(x) !== sourceFileKey(chosen))];
        automatic.current = selected; setCands(selected);
      } else {
        const ranked = mineFirst(rankStreams(list, prefs));
        automatic.current = ranked; setCands(ranked);
        if (!ranked.length) setErr(Object.assign(new Error('No cached sources'), { code: !list.length && list.failed && list.failed.length ? 'sources' : 'nosources' }));
      }
      if (latest) partial(latest);
    }, e => {
      if (gone || signal?.aborted) return;
      if (query.hash) {
        const pinned = [{ infoHash: query.hash, fileIdx: query.file != null ? +query.file : undefined, filename: query.fn || null, release: query.fn || 'Chosen source', quality: '?' }];
        automatic.current = pinned; setCands(pinned);
      }
      else setErr(Object.assign(new Error('Couldn\'t search for sources: ' + e.message), { code: navigator.onLine === false ? 'network' : 'sources' }));
    });
    return () => { gone = true; };
  }, []);

  // 3. resolve candidate by candidate
  const tryFrom = async (list, i, manual) => {
    const me = ++gen.current;
    setErr(null); setReady(null);
    let last = null;
    const identity = expectedIdentity(meta, video);
    for (let n = 0; i < list.length && (manual || n < MAX_AUTO); i++) {
      const c = list[i];
      const choice = sourceFileKey(c);
      if (!manual && tried.current.has(choice)) continue;
      tried.current.add(choice);
      const mismatch = sourceIssue(c, identity) || rejectedSource(identity, c);
      if (mismatch) {
        last = contentError(mismatch);
        invalidateRememberedSource(identity, c);
        continue;
      }
      setAttempt(++n);   // skipped (already tried) sources don't count toward MAX_AUTO
      try {
        const app = isNative();
        mark('play:resolve:start');
        const stream = await resolveStream({ infoHash: c.infoHash, fileIdx: c.fileIdx, filename: c.filename, season: video && video.season, episode: video && video.episode, anime: meta.anime, identity, direct: app, known: known.current, signal: controller.current.signal },
          t => me === gen.current && setStep(t));
        if (me !== gen.current) return;
        mark('play:link');
        if (typeof warmMp4Tail === 'function') warmMp4Tail(stream, { native: app, signal: controller.current.signal });
        setReady({ stream, info: null, source: { ...c, candidateFilename: c.filename || null, filename: stream.filename || c.filename } });
        return;
      } catch (e) {
        if (me !== gen.current) return;
        last = e;
        if (e.code === 'content_mismatch') {
          rejectSource(identity, c, e.message);
          invalidateRememberedSource(identity, c);
        }
        if (e.code === 'nokey' || e.code === 'badkey' || netFail(e) || manual) { setErr(e); return; }
        if (e.code !== 'webplan') setStep(`That one didn't work (${e.message.split('.')[0].toLowerCase()}). Trying another…`);
      }
    }
    if (me === gen.current) setErr(last && ['webplan', 'content_mismatch'].includes(last.code) ? last : Object.assign(new Error('None of the best sources would start.'), { code: 'nosources' }));
  };
  useEffect(() => { if (meta && cands && cands.length) tryFrom(cands, 0); }, [cands, meta, video]);

  // switching source keeps the place: the new copy starts where the old one was (no player yet = keep startAt)
  const pick = c => {
    setPicker(false);
    if (live.current != null) setStartAt(Math.floor(live.current));
    tried.current.delete(sourceFileKey(c)); tryFrom([c], 0, true);
  };
  const onFatal = (e, pos) => {
    // the resolved stream died while playing → move to the next untried source, resuming where it stopped
    if (e.code === 'content_mismatch') {
      const target = expectedIdentity(meta, video);
      if (ready?.source) {
        rejectSource(target, ready.source, e.message);
        invalidateRememberedSource(target, ready.source);
      }
      live.current = null; setStartAt(0); setAsk(0);
    } else if (pos > 0) setStartAt(Math.floor(pos));
    if (!cands) return setErr(e);
    const fallback = automatic.current;
    const i = fallback.findIndex(c => !tried.current.has(sourceFileKey(c)));
    if (i < 0) { setReady(null); setErr(e); } else { setStep(e.code === 'content_mismatch' ? 'That copy did not match. Checking another source…' : 'That stream hiccuped. Trying another source…'); tryFrom(fallback, i); }
  };

  const prefetchNext = async () => {
    const next = video && nextVideo(meta, video.id);
    if (!next || !isReleased(next) || prefetching.current || navigator.connection?.saveData) return;
    prefetching.current = true;
    const signal = controller.current.signal;
    try {
      await prefetchStreams(meta.type, meta.id, next.id, { signal });
      const list = peekStreams(meta.type, meta.id, next.id) || [];
      if (signal?.aborted) return;
      const args = c => ({ ...c, season: next.season, episode: next.episode, anime: meta.anime, identity: expectedIdentity(meta, next), known: known.current, direct: isNative(), signal });
      const available = rankStreams(assessSources(list, expectedIdentity(meta, next)).filter(c => !c.mismatch), { cachedOnly: false, ...webPrefs(webStreamingRefused()) }).filter(c => known.current.some(t => ownedFile(t, args(c))));
      const owned = available.find(c => c.infoHash.toLowerCase() === ready?.source?.infoHash?.toLowerCase()) || available[0];
      if (owned) await prefetchOwned(args(owned));
    } catch { /* optional read-only warmup */ }
  };

  const assessed = useMemo(() => allCands && meta ? assessSources(allCands, expectedIdentity(meta, video)) : allCands, [allCands, meta, video, ready, err]);
  // Late evidence may rescue a rejected search, but never interrupts a healthy playing copy.
  useEffect(() => {
    if (!meta || ready || !['content_mismatch', 'nosources'].includes(err?.code)) return;
    const next = automatic.current.filter(c => !tried.current.has(sourceFileKey(c)));
    if (next.some(c => !sourceIssue(c, expectedIdentity(meta, video)) && !rejectedSource(expectedIdentity(meta, video), c))) tryFrom(next, 0);
  }, [allCands]);
  const onBack = backTo(params.type, params.id);
  const bg = meta && backdropOf(meta);
  const showPlayer = ready && startAt != null;

  return html`<div class="watch" data-no-paper>
    ${showPlayer
      ? html`<${isNative() ? AppPlayer : Player} meta=${meta} video=${video} stream=${ready.stream} info=${ready.info} start=${startAt} source=${ready.source}
          live=${live} onUpNext=${prefetchNext} onFatal=${onFatal} onPickSource=${() => setPicker(true)} onBack=${onBack} />`
      : html`<${Loading} bg=${bg} meta=${meta} video=${video} step=${step} attempt=${attempt} err=${err}
          onBack=${onBack} onPick=${allCands ? () => setPicker(true) : null}
          onRetry=${() => { tried.current.clear(); automatic.current.length ? tryFrom(automatic.current, 0) : location.reload(); }} />`}

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

    <${SourcePicker} open=${picker} onClose=${() => setPicker(false)} list=${assessed} current=${ready && ready.source} onPick=${pick} />
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
      ${shown.slice(0, 80).map(x => html`<li><button type="button" class=${cx('watch-src', current && current.infoHash === x.infoHash && 'now')} disabled=${!!x.mismatch} onClick=${() => onPick(x)}>
        <span class="watch-src-q display">${x.quality === '2160p' ? '4K' : x.quality === '?' ? '—' : x.quality.replace('p', '')}<small>${x.quality !== '?' && x.quality !== '2160p' ? 'p' : ''}</small></span>
        <span class="watch-src-body">
          <span class="watch-src-name">${x.release}</span>
          <span class="watch-src-tags">
            ${x.mismatch && html`<span class="watch-tag warn">${x.mismatch}</span>`}
            ${x.durations?.length === 1 && html`<span class="watch-tag">${Math.round(x.durations[0] / 60)} min</span>`}
            ${x.cached ? html`<span class="watch-tag rd">cached</span>` : html`<span class="watch-tag slow">not cached</span>`}
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

// ---- play something straight from the user's TorBox account
function LibraryWatch({ link, name }) {
  const [st, setSt] = useState({ ready: null, err: null });
  useEffect(() => {
    mark('play:tap');
    const ac = new AbortController();
    mark('play:resolve:start');
    resolveLink(link, { direct: isNative(), signal: ac.signal }).then(stream => { if (!ac.signal.aborted) { mark('play:link'); warmMp4Tail(stream, { native: isNative(), signal: ac.signal }); setSt({ ready: { stream, info: null } }); } }).catch(err => { if (!ac.signal.aborted) setSt({ err }); });
    return () => ac.abort();
  }, []);
  const onBack = () => back();
  const pseudo = st.ready && { id: 'tb:' + st.ready.stream.downloadId, type: 'movie', name: name || st.ready.stream.filename };
  return html`<div class="watch" data-no-paper>
    ${st.ready ? html`<${isNative() ? AppPlayer : Player} meta=${pseudo} video=${null} stream=${st.ready.stream} info=${st.ready.info} start=${0} noProgress onFatal=${e => setSt({ err: e })} onBack=${onBack} />`
      : html`<${Loading} step="Unlocking your file…" attempt=${0} err=${st.err} onBack=${onBack} onRetry=${() => location.reload()} />`}
  </div>`;
}
