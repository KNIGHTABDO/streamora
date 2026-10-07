// Title detail: riso hero, actions, seasons & episodes, sources, cast, more like this.
import { html, useState, useMemo, useEffect } from '../../vendor/preact-htm.js';
import { Page, Hero, Row, Btn, IconBtn, Chip, Tabs, Stars, Spinner, ErrorNote, Empty, Modal, Img, Icon, Underline, toast, useAsync, loadCSS, cx, fmtTime, plural } from '../ui/components.js';
import { hash, tiltOf } from '../ui/sketch.js';
import { useStore, progress, watchlist, follows, diary, settings } from '../core/store.js';
import { meta as getMeta, castPhotos, catalog, seasonsOf, isReleased } from '../core/meta.js';
import { streams, rankStreams, fmtSize, isPhone, noMkv } from '../core/sources.js';
import { epState, markWatched, markUnwatched, markSeasonWatched, markSeasonUnwatched, resumeAt } from '../core/progress.js';
import { addHistory, removeHistory } from '../core/trakt.js';
import { navigate } from '../router.js';
import { watchHref, nextUp, playAction, inWatchlist, toggleWatchlist } from '../lib/play.js';
import { getMoreLikeThis } from './detail/related.js';

loadCSS('css/pages/detail.css');

const fmtDate = d => d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '';

// ---------------------------------------------------------------- sources modal
function SourcesModal({ meta, video, onClose }) {
  const s = useStore(settings);
  const [cachedOnly, setCachedOnly] = useState(s.cachedOnly !== false);
  const [q, setQ] = useState('all');
  const id = video ? video.id : meta.id;
  const type = video ? 'series' : meta.type;
  const res = useAsync(() => streams(type, id), [type, id]);
  const list = useMemo(() => {
    if (!res.data) return [];
    return rankStreams(res.data, { cachedOnly, preferSmall: isPhone(), preferMp4: noMkv(), audioLang: s.audioLang }).filter(x => q === 'all' || x.quality === q);
  }, [res.data, cachedOnly, q]);
  const qualities = useMemo(() => ['all', ...new Set((res.data || []).map(x => x.quality).filter(x => x !== '?'))].slice(0, 6), [res.data]);
  const pick = src => navigate(watchHref(meta, video, resumeAt(meta.id, video && video.id), src));
  return html`<${Modal} open class="det-modal" onClose=${onClose} wide title=${video ? `Sources · S${video.season} E${video.episode}` : 'Choose a source'}>
    <div class="spread det-src-bar">
      <div class="chips">${qualities.map(x => html`<${Chip} active=${q === x} onClick=${() => setQ(x)}>${x === 'all' ? 'All' : x === '2160p' ? '4K' : x}<//>`)}</div>
      <${Chip} active=${cachedOnly} icon="cloud" onClick=${() => setCachedOnly(!cachedOnly)}>Cached only<//>
    </div>
    ${res.loading ? html`<${Spinner} label="asking the trackers…" />`
      : res.error ? html`<${ErrorNote} error=${res.error} retry=${res.reload} />`
      : !list.length ? html`<${Empty} mood="binoculars" title="No sources here" text=${cachedOnly ? 'Nothing cached on Real-Debrid yet. Try showing uncached sources too.' : 'The trackers came back empty for this one.'}
          action=${cachedOnly && html`<${Btn} icon="eye" onClick=${() => setCachedOnly(false)}>Show uncached<//>`} />`
      : html`<ul class="det-src-list">
        ${list.slice(0, 60).map((x, i) => html`<li key=${x.infoHash + i}>
          <button type="button" class="det-src" onClick=${() => pick(x)}>
            <span class=${cx('det-q display', x.rank >= 4 && 'uhd')}>${x.quality === '2160p' ? '4K' : x.quality === '?' ? 'SD' : x.quality.replace('p', '')}</span>
            <span class="det-src-main">
              <span class="det-src-name">${x.release}</span>
              <span class="det-src-tags type">
                ${x.cached ? html`<b class="det-tag ok">RD+ cached</b>` : html`<b class="det-tag">not cached</b>`}
                ${x.hdr && html`<b class="det-tag">${x.dv ? 'DV' : 'HDR'}</b>`}${x.hevc && html`<b class="det-tag">HEVC</b>`}${x.remux && html`<b class="det-tag">REMUX</b>`}${x.dual && html`<b class="det-tag">multi-audio</b>`}${x.cam && html`<b class="det-tag bad">CAM</b>`}
                <span>${fmtSize(x.size)}</span>${x.seeders ? html`<span>👤 ${x.seeders}</span>` : ''}${x.site && html`<span>${x.site}</span>`}${x.langs.join(' ')}
              </span>
            </span>
            <${Icon} name="play" size=${22} />
          </button>
        </li>`)}
      </ul>`}
  <//>`;
}

// ---------------------------------------------------------------- rate & log
function RateModal({ meta, onClose }) {
  const d = useStore(diary);
  const prev = d.find(x => x.id === meta.id);
  const [rating, setRating] = useState(prev ? prev.rating : 0);
  const [note, setNote] = useState('');
  const save = () => {
    diary.update(l => [{ id: meta.id, type: meta.type, name: meta.name, poster: meta.poster, rating, note: note.trim(), at: Date.now() }, ...l]);
    toast(`Logged “${meta.name}” in your diary`, { icon: 'book' });
    onClose();
  };
  return html`<${Modal} open class="det-modal" onClose=${onClose} title="Rate & log">
    <div class="stack det-rate">
      <p class="muted">How was <b>${meta.name}</b>?</p>
      <${Stars} value=${rating} onChange=${setRating} size=${38} />
      <label class="field"><span class="field-label">A note for your diary (optional)</span>
        <textarea class="det-note" rows="4" value=${note} onInput=${e => setNote(e.currentTarget.value)} placeholder="the ending wrecked me…"></textarea>
      </label>
      <${Btn} variant="primary" icon="pencil" onClick=${save} disabled=${!rating}>Log it<//>
    </div>
  <//>`;
}

function TrailerModal({ id, onClose }) {
  return html`<${Modal} open class="det-modal" onClose=${onClose} wide title="Trailer">
    <div class="det-trailer"><iframe src=${`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`} title="Trailer" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>
  <//>`;
}

// ---------------------------------------------------------------- episodes
function Episodes({ meta, onSources }) {
  useStore(progress);
  const seasons = useMemo(() => seasonsOf(meta), [meta]);
  const start = useMemo(() => { const v = nextUp(meta); return v ? v.season : seasons[0] && seasons[0][0]; }, [meta]);
  const [season, setSeason] = useState(start);
  useEffect(() => setSeason(start), [meta.id]);
  const eps = (seasons.find(s => s[0] === season) || [, []])[1];
  if (!seasons.length) return null;
  const rel = eps.filter(isReleased);
  const allWatched = rel.length > 0 && rel.every(v => epState(meta.id, v.id)?.done);

  const toggleSeason = () => {
    if (allWatched) {
      markSeasonUnwatched(meta, rel);
      removeHistory(meta, rel).catch(() => toast('Trakt sync failed', { kind: 'warn' }));
      toast(html`<span>Marked season unwatched <button type="button" class="det-undo-btn" onClick=${() => {
        markSeasonWatched(meta, rel);
        addHistory(meta, rel).catch(() => toast('Trakt sync failed', { kind: 'warn' }));
        toast('Marked season watched', { icon: 'check' });
      }}>Undo</button></span>`, { icon: 'undo' });
    } else {
      markSeasonWatched(meta, rel);
      addHistory(meta, rel).catch(() => toast('Trakt sync failed', { kind: 'warn' }));
      toast(html`<span>Marked ${plural(rel.length, 'episode')} watched <button type="button" class="det-undo-btn" onClick=${() => {
        markSeasonUnwatched(meta, rel);
        removeHistory(meta, rel).catch(() => toast('Trakt sync failed', { kind: 'warn' }));
        toast('Marked season unwatched', { icon: 'undo' });
      }}>Undo</button></span>`, { icon: 'check' });
    }
  };

  const toggleEp = (v, e) => {
    e && (e.preventDefault(), e.stopPropagation());
    const st = epState(meta.id, v.id);
    const isDone = !!(st && st.done);
    if (isDone) {
      markUnwatched(meta, v);
      removeHistory(meta, v).catch(() => toast('Trakt sync failed', { kind: 'warn' }));
      toast(html`<span>Marked E${v.episode} unwatched <button type="button" class="det-undo-btn" onClick=${() => {
        markWatched(meta, v);
        addHistory(meta, v).catch(() => toast('Trakt sync failed', { kind: 'warn' }));
        toast(`Marked E${v.episode} watched`, { icon: 'check' });
      }}>Undo</button></span>`, { icon: 'undo' });
    } else {
      markWatched(meta, v);
      addHistory(meta, v).catch(() => toast('Trakt sync failed', { kind: 'warn' }));
      toast(html`<span>Marked E${v.episode} watched <button type="button" class="det-undo-btn" onClick=${() => {
        markUnwatched(meta, v);
        removeHistory(meta, v).catch(() => toast('Trakt sync failed', { kind: 'warn' }));
        toast(`Marked E${v.episode} unwatched`, { icon: 'undo' });
      }}>Undo</button></span>`, { icon: 'check' });
    }
  };

  return html`<section class="det-eps">
    <div class="spread">
      <h2>Episodes</h2>
      <${Btn} size="sm" variant="ghost" icon=${allWatched ? 'undo' : 'check'} onClick=${toggleSeason}>
        ${allWatched ? 'Mark season unwatched' : 'Mark season watched'}
      <//>
    </div>
    <${Tabs} class="det-seasons" value=${season} onChange=${setSeason}
      tabs=${seasons.map(([s, list]) => ({ id: s, label: s === 0 ? 'Specials' : `Season ${s}`, count: list.length }))} />
    <ol class="det-ep-list">
      ${eps.map(v => {
        const st = epState(meta.id, v.id);
        const out = isReleased(v);
        const t = st && !st.done ? st.t : 0;
        const title = v.name || v.title || `Episode ${v.episode}`;
        return html`<li key=${v.id} class=${cx('det-ep', !out && 'soon', st && st.done && 'done')}>
          <a class="det-ep-link" href=${out ? watchHref(meta, v, t) : null} aria-disabled=${!out} style=${`--tilt:${tiltOf(v.id, 1.4).toFixed(2)}deg`}>
            <span class="det-ep-thumb">
              <${Img} src=${v.thumbnail} alt="" fallback=${html`<span class="det-ep-num display">${v.episode}</span>`} />
              ${out && html`<span class="det-ep-play"><${Icon} name="play" size=${22} /></span>`}
              ${out && html`<button type="button" class=${cx('det-ep-check', st && st.done && 'done')}
                aria-label=${st && st.done ? `Mark E${v.episode} unwatched` : `Mark E${v.episode} watched`}
                title=${st && st.done ? 'Mark unwatched' : 'Mark watched'}
                onClick=${e => toggleEp(v, e)}>
                <span class="det-ep-check-mark"><${Icon} name="check" size=${18} /></span>
              </button>`}
            </span>
            <span class="det-ep-body">
              <span class="det-ep-title"><b class="type">E${v.episode}</b> ${title}</span>
              ${v.overview && html`<span class="det-ep-over muted">${v.overview}</span>`}
              <span class="det-ep-date type faint">${out ? fmtDate(v.released) : `airs ${fmtDate(v.released)}`}${t ? ` · ${fmtTime(t)} in` : ''}</span>
              ${st && !st.done && st.dur ? html`<${Underline} seed=${hash(v.id)} pct=${st.t / st.dur} class="det-ep-prog" />` : null}
            </span>
          </a>
          ${out && html`<${IconBtn} class="det-ep-src" icon="list" size=${18} label="Choose source" onClick=${() => onSources(v)} />`}
        </li>`;
      })}
    </ol>
  </section>`;
}

// ---------------------------------------------------------------- page
export default function Detail({ params }) {
  const { type, id } = params;
  const q = useAsync(() => getMeta(type, id), [type, id]);
  const wl = useStore(watchlist);
  const fl = useStore(follows);
  const s = useStore(settings);
  useStore(progress);
  const [modal, setModal] = useState(null); // {kind:'src', video} | {kind:'rate'} | {kind:'trailer', id}

  const m = q.data;
  const g0 = m && (m.genres || [])[0];
  const similar = useAsync(() => getMoreLikeThis(m), [m && m.id]);
  const photos = useAsync(() => castPhotos((m && m.cast || []).slice(0, 16)), [m && m.id]);

  if (q.loading) return html`<${Page} bleed><${Hero} /><div class="center-fill det-wait"><${Spinner} label="unrolling the film…" /></div><//>`;
  if (q.error) return html`<${Page}><${ErrorNote} error=${q.error} retry=${q.reload} /><//>`;
  if (!m) return html`<${Page}><${Empty} mood="confused" title="Couldn't find this one" text="The sketchbook has no page for it." action=${html`<${Btn} href="#/" icon="home">Go home<//>`} /><//>`;

  const series = m.type === 'series' || (m.videos && m.videos.length > 1);
  const play = playAction(m);
  const loved = inWatchlist(wl, m.id);
  const followed = fl.some(f => f.id === m.id);
  const trailer = (m.trailers || []).find(t => t.source) || null;
  const chooseSource = () => setModal({ kind: 'src', video: series ? nextUp(m) : null });

  const follow = () => {
    follows.update(l => followed ? l.filter(f => f.id !== m.id) : [{ id: m.id, type: m.type, name: m.name, poster: m.poster }, ...l]);
    toast(followed ? 'Unfollowed' : `Following “${m.name}”. New episodes land in your calendar.`, { icon: 'bell' });
  };
  const share = async () => {
    const url = location.href;
    try {
      if (navigator.share) await navigator.share({ title: m.name, url });
      else { await navigator.clipboard.writeText(url); toast('Link copied', { icon: 'link' }); }
    } catch {}
  };
  const movieDone = !series && !!(epState(m.id, null)?.done);
  const toggleMovieWatched = () => {
    if (movieDone) {
      markUnwatched(m, null);
      removeHistory(m, null).catch(() => toast('Trakt sync failed', { kind: 'warn' }));
      toast(html`<span>Marked unwatched <button type="button" class="det-undo-btn" onClick=${() => {
        markWatched(m, null);
        addHistory(m, null).catch(() => toast('Trakt sync failed', { kind: 'warn' }));
        toast('Marked as watched', { icon: 'check' });
      }}>Undo</button></span>`, { icon: 'undo' });
    } else {
      markWatched(m, null);
      addHistory(m, null).catch(() => toast('Trakt sync failed', { kind: 'warn' }));
      toast(html`<span>Marked as watched <button type="button" class="det-undo-btn" onClick=${() => {
        markUnwatched(m, null);
        removeHistory(m, null).catch(() => toast('Trakt sync failed', { kind: 'warn' }));
        toast('Marked unwatched', { icon: 'undo' });
      }}>Undo</button></span>`, { icon: 'check' });
    }
  };

  return html`<${Page} bleed class="detail">
    <${Hero} item=${m} tall kicker=${m.anime ? 'anime' : series ? 'series' : 'movie'} actions=${html`
      ${s.autoPlay !== false
        ? html`<${Btn} variant="primary" size="lg" icon="play" href=${play.href}>${play.label}<//>`
        : html`<${Btn} variant="primary" size="lg" icon="play" onClick=${chooseSource}>${play.label}<//>`}
      <${Btn} size="lg" variant=${s.autoPlay !== false ? undefined : 'ghost'} icon="list" onClick=${chooseSource}>Choose source<//>
      <${IconBtn} class="det-round love" icon=${loved ? 'heartFill' : 'heart'} label=${loved ? 'Remove from watchlist' : 'Add to watchlist'}
        onClick=${() => toast(toggleWatchlist(m) ? 'Pinned to your watchlist' : 'Removed from watchlist', { icon: 'heart' })} />
      ${series && html`<${IconBtn} class=${cx('det-round', followed && 'on')} icon="bell" label=${followed ? 'Unfollow' : 'Follow new episodes'} onClick=${follow} />`}
      ${trailer && html`<${IconBtn} class="det-round" icon="film" label="Watch trailer" onClick=${() => setModal({ kind: 'trailer', id: trailer.source })} />`}
      <${IconBtn} class="det-round" icon="starFill" label="Rate & log" onClick=${() => setModal({ kind: 'rate' })} />
      ${!series && html`<${IconBtn} class=${cx('det-round', movieDone && 'on')} icon="check" label=${movieDone ? 'Mark unwatched' : 'Mark watched'} onClick=${toggleMovieWatched} />`}
      <${IconBtn} class="det-round" icon="share" label="Share" onClick=${share} />
    `}>
      ${m.imdbRating && html`<div class="det-stamp" aria-label=${`IMDb ${m.imdbRating}`}><small class="type">IMDb</small><b class="display">${m.imdbRating}</b></div>`}
      ${(m.genres || []).length > 0 && html`<div class="chips det-genres">${m.genres.slice(0, 6).map(g => html`<a class="chip" href=${`#/genre/${m.anime ? 'anime' : m.type}/${encodeURIComponent(g)}`}>${g}</a>`)}</div>`}
    <//>

    <div class="det-body">
      <section class="det-info">
        ${m.description && m.description.length > 260 && html`<p class="det-desc">${m.description}</p>`}
        <dl class="det-facts">
          ${m.director && m.director.length > 0 && html`<div><dt class="type">directed by</dt><dd>${m.director.map(n => html`<a class="det-person" href=${`#/person/${encodeURIComponent(n)}`}>${n}</a>`)}</dd></div>`}
          ${m.runtime && html`<div><dt class="type">runtime</dt><dd>${m.runtime}</dd></div>`}
          ${(m.releaseInfo || m.year) && html`<div><dt class="type">${series ? 'aired' : 'released'}</dt><dd>${m.releaseInfo || m.year}</dd></div>`}
          ${m.country && html`<div><dt class="type">country</dt><dd>${m.country}</dd></div>`}
          ${m.awards && html`<div><dt class="type">awards</dt><dd>${m.awards}</dd></div>`}
        </dl>
      </section>

      ${m.cast && m.cast.length > 0 && html`<section class="det-cast">
        <h2>Cast</h2>
        <div class="det-tags">${m.cast.slice(0, 16).map((n, i) => html`<a class="det-tag-name" style=${`--r:${((hash(n) % 7) - 3)}deg;--c:var(--a${(i % 4) + 1})`} href=${`#/person/${encodeURIComponent(n)}`}>
          <span class="type">hello my name is</span>${photos.data && photos.data[n] && html`<${Img} class="det-face" src=${photos.data[n]} alt="" />`}<b>${n}</b></a>`)}</div>
      </section>`}

      ${series && html`<${Episodes} meta=${m} onSources=${v => setModal({ kind: 'src', video: v })} />`}

      <${Row} title="More like this"
        kicker=${similar.data?.source === 'trakt' ? 'trakt recommended' : (g0 ? `more ${g0.toLowerCase()}` : '')}
        icon="sparkle"
        items=${similar.data?.items}
        loading=${similar.loading} />
    </div>

    ${modal && modal.kind === 'src' && html`<${SourcesModal} meta=${m} video=${modal.video} onClose=${() => setModal(null)} />`}
    ${modal && modal.kind === 'rate' && html`<${RateModal} meta=${m} onClose=${() => setModal(null)} />`}
    ${modal && modal.kind === 'trailer' && html`<${TrailerModal} id=${modal.id} onClose=${() => setModal(null)} />`}
  <//>`;
}
