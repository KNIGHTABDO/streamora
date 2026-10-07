// The Streamora player: a <video> wrapped in hand-drawn controls.
// Props:
//   meta, video (episode or null), stream {hls, direct, downloadId, filename}, info (mediaInfos or null),
//   start (seconds), source {infoHash, fileIdx, binge, release, quality, filename} | null, noProgress,
//   live (a ref: gets the current position in seconds, so a source switch can resume there),
//   onFatal(err, pos) (stream died or stalled; pos = real seconds to resume at: parent tries another source), onPickSource(), onBack()
//   engine: 'web' (a <video>) | 'vlc' (iPhone/iPad app: VLC draws behind the transparent page, see vlc.js; same controls)
// Emits window 'streamora:playback' events (see emit()).
import { html, useState, useEffect, useRef, useMemo, useCallback } from '../../vendor/preact-htm.js';
import { Icon, Reel, cx, fmtTime, toast, Img } from '../ui/components.js';
import { registerIcons } from '../ui/icons.js';
import { underlinePath, scribbleLoop, roughRect, hash } from '../ui/sketch.js';
import { useStore, settings } from '../core/store.js';
import { saveProgress, epState, showPrefs } from '../core/progress.js';
import { watchHref } from '../lib/play.js';
import { nextVideo, seasonsOf, isReleased } from '../core/meta.js';
import { isPhone } from '../core/sources.js';
import { navigate } from '../router.js';
import { moveFocus } from '../ui/focus.js';
import { attach, buildUrl, autoQuality, QUALITIES, isIOS, isSafari } from './engine.js';
import { openSubs, loadSubFile, parseSubs, decodeSubs, cuesAt, toVTT, langName } from './subs.js';
import { skipTimes } from './skip.js';
import { VlcVideo } from './vlc.js';

registerIcons({
  episodes: { d: 'M3.6 5.2h11.6M3.5 10.1h11.7M3.6 15h7.9M17.2 12.6l3.6 2.4-3.6 2.5zM3.5 19.8h7.9' },
  moon2: { d: 'M18.6 14.4c-4.6 1.2-9-2.2-9-7 0-1.2.3-2.3.8-3.3-3.6 1-6.1 4.3-6 8.1.1 4.6 3.9 8.3 8.5 8.2 3.2 0 5.9-2 7.1-4.8zM16.4 3.9h3.2l-3.2 3.6h3.3', fill: 'M18.6 14.4c-4.6 1.2-9-2.2-9-7 0-1.2.3-2.3.8-3.3-3.6 1-6.1 4.3-6 8.1.1 4.6 3.9 8.3 8.5 8.2 3.2 0 5.9-2 7.1-4.8z' },
  source: { d: 'M4.1 5.1h15.8M4.1 12h15.8M4.1 18.9h15.8M8.2 3.2v3.9M15.6 10.1v3.9M10.4 17v3.8' },
  fit: { d: 'M3.9 6.1h16.2v11.8H3.9zM7.8 12h8.4M10.2 9.8 7.8 12l2.4 2.2M13.8 9.8l2.4 2.2-2.4 2.2' },
});

// consecutive auto-played episodes without any input; after STILL_AFTER we ask "Still watching?"
const AUTO_KEY = 'streamora:autoNextRuns', STILL_AFTER = 3;
const autoRuns = () => { try { return +sessionStorage.getItem(AUTO_KEY) || 0; } catch { return 0; } };
const resetAutoRuns = () => { try { sessionStorage.removeItem(AUTO_KEY); } catch {} };

const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
const SLEEP = [{ id: 'off', label: 'Off' }, { id: 'end', label: 'End of this episode' }, { id: '15', label: '15 minutes' }, { id: '30', label: '30 minutes' }, { id: '60', label: '1 hour' }];
const levelFrame = roughRect(30, 150, 5, { inset: 3, sw: 2.2 });   // the volume bar's hand-drawn frame

const vidCodec = { h264: 'avc1.640028', avc: 'avc1.640028', hevc: 'hvc1.1.6.L120.90', h265: 'hvc1.1.6.L120.90' };
const audCodec = { aac: 'mp4a.40.2', mp3: 'mp4a.6B', ac3: 'ac-3', eac3: 'ec-3' };
/** true when stream.direct is an mp4 whose first video/audio tracks this browser says it can play. */
function directOk(stream, info) {
  if (!/\.(mp4|m4v)(\?|$)/i.test((stream && stream.direct) || '') || !info || !info.details) return false;
  const vc = vidCodec[String(Object.values(info.details.video || {})[0]?.codec).toLowerCase()];
  const a0 = Object.values(info.details.audio || {})[0];
  const ac = a0 ? audCodec[String(a0.codec).toLowerCase().replace(/[^a-z0-9]/g, '')] : 'mp4a.40.2';
  return !!vc && !!ac && document.createElement('video').canPlayType(`video/mp4; codecs="${vc}, ${ac}"`) !== '';
}

function pickAudio(info, pref) {
  const a = (info && info.details && info.details.audio) || {};
  const keys = Object.keys(a);
  if (!keys.length) return null;
  return keys.find(k => a[k].lang_iso === pref) || keys[0];
}

// Embedded tracks often have no language tag (RD reports "Unknown"/"und"): label them by language when
// known, "Track N" otherwise, and number duplicates ("English · 2"). -> [[key, track, label]]
function trackLabels(tracks) {
  const known = x => x.lang_iso && !/^(und|unk|mis|zxx)$/i.test(x.lang_iso) && !/^unknown$/i.test(x.lang || '');
  const list = Object.entries(tracks), seen = {};
  const total = {};
  list.forEach(([, x]) => { if (known(x)) total[x.lang_iso] = (total[x.lang_iso] || 0) + 1; });
  return list.map(([k, x], i) => {
    if (!known(x)) return [k, x, `Track ${i + 1}`];
    const name = langName(x.lang_iso) !== x.lang_iso.toUpperCase() ? langName(x.lang_iso) : (x.lang || x.lang_iso);
    seen[x.lang_iso] = (seen[x.lang_iso] || 0) + 1;
    return [k, x, total[x.lang_iso] > 1 ? `${name} · ${seen[x.lang_iso]}` : name];
  });
}

export function Player({ meta, video, stream, info, start = 0, source, noProgress, live, onFatal, onPickSource, onBack, engine = 'web' }) {
  const s = useStore(settings);
  const fitCover = s.videoFit === 'cover';   // fill the frame (cropped) instead of letterboxing; remembered in settings
  // VLC mode: a stand-in for the <video> element (same properties and events), so everything below works on both
  const vlc = useMemo(() => (engine === 'vlc' ? new VlcVideo() : null), []);
  const vRef = useRef(vlc), boxRef = useRef();
  const phone = useMemo(isPhone, []);
  const height = info && info.details && Object.values(info.details.video || {})[0]?.height;
  const fatalRef = useRef(onFatal);
  fatalRef.current = onFatal;
  const fatal = (e, pos) => fatalRef.current && fatalRef.current(e, pos);
  // per-show memory (audio language, subtitle language or 'off', speed): read once, written on save when the viewer changes one
  const mem = useMemo(() => (noProgress || !meta ? {} : showPrefs(meta.id)), []);
  const picked = useRef({});
  // started from 0 on a finished episode/movie = a rewatch, so it may become unwatched again
  const rewatch = useMemo(() => !start && !!meta && !!(epState(meta.id, video && video.id) || {}).done, []);
  const rateRef = useRef(mem.rate || 1);

  // ------------------------------------------------ stream selection
  const [quality, setQuality] = useState(() => (s.quality && s.quality !== 'auto' ? s.quality : autoQuality(height, phone)));
  const [audio, setAudio] = useState(() => pickAudio(info, mem.audioLang || s.audioLang));
  const [burn, setBurn] = useState('none');            // embedded subtitle key burned into the video
  // Direct play: an h264 mp4 the device decodes itself needs no RD transcode (which can fall behind realtime → stalls).
  // Only while nothing needs the transcoder (default audio, no burned subs, quality untouched); dropped on error.
  const [direct, setDirect] = useState(() => directOk(stream, info));
  const url = useMemo(() => {
    if (vlc) return stream.direct;   // VLC plays the original file, whatever it is
    if (direct && burn === 'none' && (!audio || audio === pickAudio(info))) return stream.direct;
    if (info && info.modelUrl && audio) return buildUrl(info.modelUrl, { audio, subs: burn, quality });
    const h = stream.hls || {};
    return h[quality] || h.high || h.original || Object.values(h).find(Boolean) || (/\.(mp4|webm|m4v)(\?|$)/i.test(stream.direct || '') ? stream.direct : null);
  }, [info, audio, burn, quality, stream, direct]);

  // ------------------------------------------------ playback state
  const [st, setSt] = useState({ playing: false, t: start, dur: 0, buf: 0, waiting: true, vol: 1, muted: false, rate: rateRef.current, ended: false });
  const [blocked, setBlocked] = useState(false);       // autoplay refused
  const [started, setStarted] = useState(false);       // first frame shown (drop the backdrop behind the video)
  const [ui, setUi] = useState(true);                  // controls visible
  const [menu, setMenu] = useState(null);              // null | 'settings' | 'subs' | 'audio' | 'episodes'
  const [flash, setFlash] = useState(null);            // double-tap feedback
  // RD transcodes on the fly and only serves segments near where it is converting, so a far seek
  // can't just set currentTime: it re-requests the playlist with ?t=<seconds>, which restarts the
  // conversion there. offRef = the real time of the stream's first segment; real time = off + currentTime.
  const isTc = /stream\.real-debrid\.com\/t\//.test(url || '');
  const posRef = useRef(start);          // real position to (re)start at
  const seekPending = useRef(false);     // a far seek set posRef; don't let the re-attach cleanup overwrite it
  const offRef = useRef(0);
  const [off, setOff] = useState(0);
  const [reload, setReload] = useState(0);
  const startedRef = useRef(false); startedRef.current = started;
  // next lower transcode quality, or null (direct play / already lowest)
  const downRef = useRef();
  const qi = QUALITIES.findIndex(q => q.key === quality);
  downRef.current = isTc && qi >= 0 && qi < QUALITIES.length - 1 && (info && info.modelUrl || (stream.hls || {})[QUALITIES[qi + 1].key])
    ? () => { toast(`Slow stream — switching to ${QUALITIES[qi + 1].label}`, { icon: 'source' }); setQuality(QUALITIES[qi + 1].key); } : null;
  const realDur = x => (info && info.duration) || (x && isFinite(x.duration) ? offRef.current + x.duration : 0);
  const realNow = x => offRef.current + ((x && x.currentTime) || 0);
  const hideT = useRef();

  const poke = useCallback(() => {
    setUi(true);
    clearTimeout(hideT.current);
    hideT.current = setTimeout(() => { const v = vRef.current; if (v && !v.paused) { setUi(false); setMenu(m => (m === 'episodes' ? m : null)); } }, 3200);
  }, []);

  // Playback events for scrobblers (Trakt): window 'streamora:playback' { state: 'start'|'pause'|'stop', meta, video, progress 0-100 }
  const pctRef = useRef(0);
  const emit = state => {
    if (!meta || noProgress) return;
    try { window.dispatchEvent(new CustomEvent('streamora:playback', { detail: { state, meta, video, progress: +pctRef.current.toFixed(2) } })); } catch {}
  };

  // attach / re-attach when the url changes (keep position)
  useEffect(() => {
    const v = vRef.current;
    if (!url) { fatal(new Error('No playable stream for this file.'), posRef.current); return; }
    let detach = () => {}, dead = false;
    seekPending.current = false;
    const o = isTc ? Math.max(0, Math.floor(posRef.current)) : 0;
    offRef.current = o; setOff(o);
    const src = o > 0 ? `${url}${url.includes('?') ? '&' : '?'}t=${o}` : url;
    setSt(x => ({ ...x, waiting: true }));
    if (vlc) vlc.setMeta({ title, subtitle: sub, poster: meta && meta.poster });   // lock screen / Now Playing
    (vlc ? vlc.open(src, { start: posRef.current, audioLang: mem.audioLang || s.audioLang, onFatal: (e, p) => !dead && fatal(e, p) })
      : attach(v, src, { start: isTc ? 0 : posRef.current, onFatal: (e, p) => !dead && (src === stream.direct && info && info.modelUrl ? (posRef.current = p || posRef.current, setDirect(false)) : fatal(e, offRef.current + (p || 0))) })).then(d => {
      if (dead) return d();
      detach = d;
      v.playbackRate = rateRef.current;
      const p = v.play();
      p && p.catch(() => setBlocked(true));
    }, e => !dead && fatal(e, posRef.current));
    return () => { dead = true; if (!seekPending.current && v.currentTime > 0) posRef.current = realNow(v); detach(); };
  }, [url, reload]);

  useEffect(() => {
    const v = vRef.current;
    if (live) live.current = start;
    const up = () => {
      const dur = realDur(v);
      if (live) live.current = realNow(v);
      if (dur && v.currentTime > 0) pctRef.current = Math.min(100, realNow(v) / dur * 100);
      setSt(x => ({ ...x, t: realNow(v), dur: dur || x.dur, buf: offRef.current + (v.buffered.length ? v.buffered.end(v.buffered.length - 1) : 0) }));
    };
    const ms ='mediaSession' in navigator ? navigator.mediaSession : null;
    let posAt = 0;
    const position = () => {
      const now = Date.now(), dur = realDur(v);
      if (!ms || !ms.setPositionState || now - posAt < 1000 || !dur || !isFinite(dur)) return;
      posAt = now;
      try { ms.setPositionState({ duration: dur, position: Math.min(dur, Math.max(0, realNow(v))), playbackRate: v.playbackRate || 1 }); } catch {}
    };
    // stall watchdog: only a real freeze (still buffering, playhead not moving for 25s) counts. 'stalled' just means
    // the download paused (often because the buffer is full), so it's ignored. Step down a quality once before
    // giving up on the source.
    let stallT;
    const stall = () => {
      clearTimeout(stallT);
      const at = v.currentTime;
      stallT = setTimeout(() => {
        if (v.paused || v.seeking || v.readyState >= 3 || v.currentTime !== at) return;
        const d = downRef.current;
        if (d) d(); else fatal(new Error('The stream stalled.'), realNow(v));
      }, 25000);
    };
    const unstall = () => clearTimeout(stallT);
    const ev = {
      timeupdate: () => { up(); position(); }, durationchange: up, progress: up,
      play: () => { setBlocked(false); setSt(x => ({ ...x, playing: true, ended: false })); poke(); ms && (ms.playbackState = 'playing'); emit('start'); },
      pause: () => { setSt(x => ({ ...x, playing: false })); setUi(true); save(); unstall(); ms && (ms.playbackState = 'paused'); if (!v.ended) emit('pause'); },
      waiting: () => { setSt(x => ({ ...x, waiting: true })); stall(); },
      playing: () => { setStarted(true); setSt(x => ({ ...x, waiting: false })); unstall(); },
      canplay: () => { setSt(x => ({ ...x, waiting: false })); unstall(); },
      seeked: up,
      volumechange: () => setSt(x => ({ ...x, vol: v.volume, muted: v.muted })),
      ratechange: () => { rateRef.current = v.playbackRate; setSt(x => ({ ...x, rate: v.playbackRate })); },
      ended: () => { setSt(x => ({ ...x, ended: true, playing: false })); save(true); pctRef.current = 100; emit('stop'); },
    };
    for (const [k, f] of Object.entries(ev)) v.addEventListener(k, f);
    return () => { unstall(); if (!v.ended) emit('stop'); for (const [k, f] of Object.entries(ev)) v.removeEventListener(k, f); };
  }, []);

  // ------------------------------------------------ progress
  const save = useCallback((final) => {
    const v = vRef.current;
    if (noProgress || !v || !meta) return;
    const dur = realDur(v);
    const t = final ? dur : realNow(v);
    const prefs = Object.keys(picked.current).length ? picked.current : null;
    if (dur && isFinite(dur)) saveProgress(meta, video, t, dur, source && { infoHash: source.infoHash, fileIdx: source.fileIdx, binge: source.binge, filename: source.filename || null }, { prefs, restart: rewatch });
  }, [meta, video, source, noProgress]);
  useEffect(() => {
    const i = setInterval(() => vRef.current && !vRef.current.paused && save(), 5000);
    const vis = () => document.visibilityState === 'hidden' && save();
    document.addEventListener('visibilitychange', vis);
    addEventListener('pagehide', vis);
    return () => { clearInterval(i); document.removeEventListener('visibilitychange', vis); removeEventListener('pagehide', vis); save(); };
  }, [save]);

  // ------------------------------------------------ wake lock + media session
  useEffect(() => {
    if (!st.playing || !navigator.wakeLock) return;
    let lock = null, gone = false;
    const get = () => navigator.wakeLock.request('screen').then(l => { if (gone) l.release().catch(() => {}); else lock = l; }, () => {});
    // the browser drops the lock whenever the tab is hidden: take it again on return
    const vis = () => document.visibilityState === 'visible' && get();
    get();
    document.addEventListener('visibilitychange', vis);
    return () => { gone = true; document.removeEventListener('visibilitychange', vis); lock && lock.release().catch(() => {}); };
  }, [st.playing]);
  const next = useMemo(() => (video && meta ? nextVideo(meta, video.id) : null), [meta, video]);
  const title = meta ? meta.name : stream.filename;
  const release = (source && source.filename) || stream.filename || '';   // subtitles are matched against this
  const sub = video ? `S${video.season} · E${video.episode}${video.name || video.title ? ' · ' + (video.name || video.title) : ''}` : '';
  // keep the same release for the next episode (watch falls back to ranked sources if it lacks that episode)
  const goNext = useCallback(auto => {
    if (!next) return;
    save();
    try { sessionStorage.setItem(AUTO_KEY, auto === true ? autoRuns() + 1 : 0); } catch {}
    navigate(watchHref(meta, next, 0, source && source.infoHash ? { infoHash: source.infoHash } : null), { replace: true });
  }, [next, meta, save, source]);
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    const ms = navigator.mediaSession;
    const acts = ['play', 'pause', 'seekbackward', 'seekforward', 'seekto', 'nexttrack'];
    try {
      navigator.mediaSession.metadata = new MediaMetadata({ title: sub ? `${title} · ${sub}` : title, artist: 'Streamora', artwork: meta && meta.poster ? [{ src: meta.poster, sizes: '300x450', type: 'image/jpeg' }] : [] });
      const v = vRef.current;
      ms.setActionHandler('play', () => v.play());
      ms.setActionHandler('pause', () => v.pause());
      ms.setActionHandler('seekbackward', d => seekRef.current(realNow(v) - (d.seekOffset || 10)));
      ms.setActionHandler('seekforward', d => seekRef.current(realNow(v) + (d.seekOffset || 10)));
      ms.setActionHandler('seekto', d => seekRef.current(d.seekTime));
      ms.setActionHandler('nexttrack', next ? () => goNext() : null);
    } catch {}
    return () => {
      for (const a of acts) try { ms.setActionHandler(a, null); } catch {}
      try { ms.metadata = null; ms.playbackState = 'none'; } catch {}
    };
  }, [title, sub, next, goNext]);

  // ------------------------------------------------ subtitles (external, own overlay)
  const [ext, setExt] = useState([]);               // available OpenSubtitles
  const [cur, setCur] = useState(null);             // { id, label, cues }
  const [delay, setDelay] = useState(0);
  const [line, setLine] = useState([]);
  const [subQ, setSubQ] = useState('');
  const [extDone, setExtDone] = useState(false);
  // VLC: the file's audio / subtitle tracks as VLC lists them
  const [vt, setVt] = useState({ audio: [], subs: [], audioId: -1, subId: -1 });
  useEffect(() => {
    if (!vlc) return;
    const on = e => setVt(e.detail);
    vlc.addEventListener('tracks', on);
    return () => vlc.removeEventListener('tracks', on);
  }, []);
  // VLC auto-pick: a subtitle track in the file in the wanted language, else OpenSubtitles; none when the
  // audio is already in that language (unless this show remembers subtitles on)
  const autoSubbed = useRef(false);
  useEffect(() => {
    if (!vlc || autoSubbed.current || !(vt.audio.length || vt.subs.length)) return;
    const want = mem.subLang || s.subsLang;
    if (!want || want === 'off') { autoSubbed.current = true; return; }
    const name = langName(want).toLowerCase();
    const isWant = t => t.name.toLowerCase().includes(name) || new RegExp(`\\b${want}\\b`, 'i').test(t.name);
    const aud = vt.audio.find(t => t.id === vt.audioId);
    if (!mem.subLang && aud && isWant(aud)) { autoSubbed.current = true; return; }
    const inFile = vt.subs.find(t => t.id >= 0 && isWant(t));
    if (inFile) { autoSubbed.current = true; vlc.setSub(inFile.id); return; }
    if (!extDone) return;
    autoSubbed.current = true;
    const hit = ext.find(x => x.lang === want && x.match) || ext.find(x => x.lang === want);
    if (hit) chooseExt(hit);
  }, [vt, extDone]);
  useEffect(() => {
    if (!meta || String(meta.id).startsWith('rd:')) return;
    openSubs(meta.type, video ? video.id : meta.id, release).then(list => {
      setExt(list);
      // auto-pick: this show's remembered language, else the preferred one when the audio isn't in it
      // (unknown / 'und' audio counts as "not in it")
      setExtDone(true);
      if (vlc) return;   // VLC: see the effect below (the file's own tracks count too)
      const want = mem.subLang || s.subsLang;
      if (!want || want === 'off') return;
      const aud = info && info.details && info.details.audio && audio && info.details.audio[audio];
      const same = aud && aud.lang_iso && !/^(und|unk)$/i.test(aud.lang_iso) && aud.lang_iso === want;
      if (mem.subLang || !same) {
        const hit = list.find(x => x.lang === want && x.match) || list.find(x => x.lang === want);
        if (hit) chooseExt(hit);
      }
    });
  }, [meta && meta.id, video && video.id]);
  const chooseExt = async (it, user) => {
    if (user) picked.current.subLang = it ? it.lang : 'off';
    if (vlc && (it || user)) vlc.setSub(-1);
    if (!it) { setCur(null); return; }
    setCur({ id: it.id, label: it.label, cues: [], loading: true });
    try { showCues(it, await loadSubFile(it.url, it.lang)); }
    catch (e) { setCur(null); toast('That subtitle file would not load', { kind: 'warn' }); }
  };
  const showCues = (it, cues) => {
    if (!cues.length) { setCur(null); toast('That subtitle file has no lines I can read', { kind: 'warn' }); return; }
    setCur({ id: it.id, label: it.label, cues });
  };
  const loadLocal = async e => {
    const f = e.currentTarget.files && e.currentTarget.files[0];
    e.currentTarget.value = '';
    if (!f) return;
    setBurn('none');
    try { showCues({ id: 'file:' + f.name, label: f.name }, parseSubs(decodeSubs(await f.arrayBuffer(), s.subsLang))); }
    catch { toast('That subtitle file would not load', { kind: 'warn' }); }
  };
  useEffect(() => {
    if (!cur || !cur.cues.length) { setLine([]); return; }
    let raf, last = '';
    const tick = () => {
      const v = vRef.current;
      const l = v ? cuesAt(cur.cues, realNow(v) - delay) : [];
      const k = l.join('\n');
      if (k !== last) { last = k; setLine(l); }
      raf = requestAnimationFrame(tick);
    };
    tick();
    return () => cancelAnimationFrame(raf);
  }, [cur, delay]);
  // iOS native fullscreen can't show our overlay: mirror the cues into a <track>
  const trackUrl = useMemo(() => {
    if (!isIOS || !cur || !cur.cues.length) return null;
    return URL.createObjectURL(new Blob([toVTT(cur.cues.map(c => ({ ...c, start: c.start + delay - off, end: c.end + delay - off })).filter(c => c.end > 0))], { type: 'text/vtt' }));
  }, [cur, delay, off]);
  useEffect(() => () => trackUrl && URL.revokeObjectURL(trackUrl), [trackUrl]);
  // Only show the native <track> in iOS native fullscreen; inline, our overlay draws them (else: double subs).
  useEffect(() => {
    const x = vRef.current; if (!x || !trackUrl) return;
    const set = m => () => { for (const tt of x.textTracks) tt.mode = m; };
    const hide = set('hidden'), show = set('showing');
    hide(); const t0 = setTimeout(hide, 300);   // the <track default> flips itself to 'showing' once loaded
    x.addEventListener('webkitbeginfullscreen', show); x.addEventListener('webkitendfullscreen', hide);
    return () => { clearTimeout(t0); x.removeEventListener('webkitbeginfullscreen', show); x.removeEventListener('webkitendfullscreen', hide); };
  }, [trackUrl]);

  // ------------------------------------------------ sleep timer
  const [sleep, setSleep] = useState({ id: 'off', at: 0 });
  const [asleep, setAsleep] = useState(false);
  useEffect(() => {
    if (sleep.id === 'off') return;
    const i = setInterval(() => {
      const v = vRef.current;
      if (sleep.id === 'end' ? st.ended || (v && realDur(v) - realNow(v) < 1) : Date.now() >= sleep.at) {
        v && v.pause(); setAsleep(true); setSleep({ id: 'off', at: 0 });
      }
    }, 1000);
    return () => clearInterval(i);
  }, [sleep, st.ended]);

  // ------------------------------------------------ up next card
  const [nextDismissed, setNextDismissed] = useState(false);
  const [count, setCount] = useState(10);
  // anime: AniSkip opening / ending times (null until loaded, or when unknown → heuristics below)
  const [skip, setSkip] = useState(null);
  useEffect(() => { let ok = true; skipTimes(meta, video).then(x => ok && setSkip(x)); return () => { ok = false; }; }, []);
  const credits = skip && skip.ed && skip.ed[0] > 60 ? st.t >= skip.ed[0] : st.dur - st.t < 22;
  const [stillAsk, setStillAsk] = useState(false);   // "Still watching?" after STILL_AFTER auto-played episodes
  const showNext = !!next && isReleased(next) && !nextDismissed && !stillAsk && st.dur > 0 && (st.ended || credits) && sleep.id !== 'end' && !asleep;
  useEffect(() => {
    if (!showNext || !s.autoNext) return;
    if (count <= 0) {
      if (autoRuns() >= STILL_AFTER) { v() && v().pause(); setStillAsk(true); } else goNext(true);
      return;
    }
    const i = setTimeout(() => setCount(c => c - 1), 1000);
    return () => clearTimeout(i);
  }, [showNext, count, s.autoNext]);
  useEffect(() => { if (!showNext) setCount(10); }, [showNext]);

  // ------------------------------------------------ actions
  const v = () => vRef.current;
  const toggle = () => { const x = v(); if (!x) return; if (x.paused) { const p = x.play(); p && p.catch(() => setBlocked(true)); } else x.pause(); };
  const reloadT = useRef();
  const seekTo = T => {
    const x = v(); if (!x) return;
    const dur = realDur(x);
    T = Math.max(0, dur ? Math.min(dur - .5, T) : T);
    const local = T - offRef.current;
    // inside a loaded range (or a few seconds past one): a normal seek. Anywhere else on a transcode: restart there.
    let near = false;
    for (let i = 0; i < x.buffered.length; i++) near ||= local >= x.buffered.start(i) - 1 && local <= x.buffered.end(i) + 8;
    clearTimeout(reloadT.current);
    if (!isTc || (local >= 0 && near)) { seekPending.current = false; x.currentTime = Math.max(0, local); }
    else {
      // debounce: rapid taps / scrubbing would otherwise restart the transcode once per step
      posRef.current = T; seekPending.current = true; x.pause();
      reloadT.current = setTimeout(() => setReload(k => k + 1), 450);
    }
    setSt(s0 => ({ ...s0, t: T }));
  };
  const seekBy = d => { const x = v(); if (!x) return; seekTo(realNow(x) + d); poke(); };
  const seekRef = useRef(seekTo);
  seekRef.current = seekTo;
  const setVol = val => { const x = v(); if (!x) return; x.volume = Math.max(0, Math.min(1, val)); x.muted = x.volume === 0; };
  // audio delay (seconds) on elements that have one (the VLC engine); a plain <video> has none
  const [ad, setAd] = useState(0);
  const setAudioDelay = sec => { const x = v(); if (!x || !('audioDelay' in x)) return; const val = Math.round(sec * 1000) / 1000; x.audioDelay = val; setAd(val); };
  const toggleFit = () => settings.update(x => ({ ...x, videoFit: x.videoFit === 'cover' ? 'contain' : 'cover' }));
  const fsEl = () => document.fullscreenElement || document.webkitFullscreenElement;
  const fullscreen = () => {
    const box = boxRef.current, x = v();
    if (fsEl()) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    else if (box.requestFullscreen) box.requestFullscreen().then(() => screen.orientation && screen.orientation.lock && screen.orientation.lock('landscape').catch(() => {}), () => {});
    else if (box.webkitRequestFullscreen) box.webkitRequestFullscreen();
    else if (x.webkitEnterFullscreen) x.webkitEnterFullscreen();
  };
  const [isFs, setFs] = useState(false);
  useEffect(() => {
    const on = () => setFs(!!fsEl());
    // iPhone: native video fullscreen only fires these on the <video>
    const x = v(), vIn = () => setFs(true), vOut = () => setFs(false);
    document.addEventListener('fullscreenchange', on); document.addEventListener('webkitfullscreenchange', on);
    x.addEventListener('webkitbeginfullscreen', vIn); x.addEventListener('webkitendfullscreen', vOut);
    return () => {
      document.removeEventListener('fullscreenchange', on); document.removeEventListener('webkitfullscreenchange', on);
      x.removeEventListener('webkitbeginfullscreen', vIn); x.removeEventListener('webkitendfullscreen', vOut);
    };
  }, []);
  const pip = async () => {
    const x = v();
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (x.requestPictureInPicture) await x.requestPictureInPicture();
      else if (x.webkitSetPresentationMode) x.webkitSetPresentationMode(x.webkitPresentationMode === 'picture-in-picture' ? 'inline' : 'picture-in-picture');
    } catch { toast('Picture-in-picture is not available here', { kind: 'warn' }); }
  };
  const canPip = !vlc && typeof document !== 'undefined' && (document.pictureInPictureEnabled || (isSafari || isIOS));
  const [airplay, setAirplay] = useState(false);
  useEffect(() => {
    const x = v();
    if (!window.WebKitPlaybackTargetAvailabilityEvent) return;
    const on = e => setAirplay(e.availability === 'available');
    x.addEventListener('webkitplaybacktargetavailabilitychanged', on);
    return () => x.removeEventListener('webkitplaybacktargetavailabilitychanged', on);
  }, []);
  const canCast = !vlc && !isSafari && !isIOS && typeof HTMLMediaElement !== 'undefined' && 'remote' in HTMLMediaElement.prototype;
  const cast = () => v().remote.prompt().catch(e => toast(e && e.name === 'NotSupportedError' ? 'Casting isn\'t supported for this stream in this browser' : 'No cast device picked', { kind: 'warn' }));

  const still = () => {
    const x = v();
    try {
      const w = x.videoWidth, h = x.videoHeight;
      if (!w) throw new Error('no frame');
      const pad = Math.round(w * .04), c = document.createElement('canvas');
      c.width = w + pad * 2; c.height = h + pad * 3.2;
      const g = c.getContext('2d');
      g.fillStyle = '#fff8ea'; g.fillRect(0, 0, c.width, c.height);
      g.drawImage(x, pad, pad, w, h);
      g.fillStyle = '#1e1630';
      g.fill(new Path2D(roughRect(c.width, c.height, hash(title || 'x'), { inset: pad * .35, sw: pad * .12 })));
      g.font = `${Math.round(pad * .9)}px "Caveat Brush", cursive`;
      g.fillText(`${title || ''}${sub ? ' · ' + sub : ''}  ·  ${fmtTime(realNow(x))}`, pad, h + pad * 2.3);
      c.toBlob(b => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = `${(title || 'still').replace(/[^\w-]+/g, '_')}_${Math.floor(realNow(x))}.png`;
        a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
        toast('Still saved', { icon: 'camera' });
      }, 'image/png');
    } catch { toast('This browser won\'t let me grab that frame', { kind: 'warn' }); }
  };

  // ------------------------------------------------ keyboard & remote
  // the handler is rebuilt every render (it reads fresh state); the listener is added once and calls the latest one
  const keyRef = useRef();
  keyRef.current = e => {
    if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && e.target.type !== 'range' || e.target.isContentEditable;
    if (typing) return;
    resetAutoRuns();
    const onControl = e.target.closest && e.target.closest('.pl-ui button, .pl-ui a, .pl-menu, .pl-still');
    const k = e.key;
    const hover = matchMedia('(hover: hover)').matches;
    if (k === ' ' || k === 'k' || k === 'MediaPlayPause') { if (k === ' ' && onControl) return; e.preventDefault(); toggle(); poke(); }
    else if (k === 'j') seekBy(-10);
    else if (k === 'l') seekBy(10);
    else if (k === 'f') fullscreen();
    else if (k === 'm') { v().muted = !v().muted; poke(); }
    else if (k === 'c') { setMenu(m => (m === 'subs' ? null : 'subs')); poke(); }
    else if (k === 'z' && !vlc) { toggleFit(); poke(); }
    else if (k === 'n' && next) goNext();
    else if (k === 'MediaFastForward') { e.preventDefault(); seekBy(30); }
    else if (k === 'MediaRewind') { e.preventDefault(); seekBy(-30); }
    else if (k === 'MediaTrackNext' && next) { e.preventDefault(); goNext(); }
    else if (k === 'MediaStop') { e.preventDefault(); v().pause(); onBack && onBack(); }
    else if (k === 'Escape' || k === 'GoBack' || k === 'BrowserBack' || k === 'Backspace') {
      e.preventDefault();
      if (menu) setMenu(null);
      else if (k === 'Escape' && fsEl()) fullscreen();
      else onBack && onBack();
    }
    else if (k === 'ArrowLeft' || k === 'ArrowRight') {
      e.preventDefault();
      if (onControl && ui) { moveFocus(k) || null; poke(); }
      else seekBy(k === 'ArrowLeft' ? -5 : 5);
    } else if (k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault();
      if (!ui) { poke(); return; }
      if (hover && !onControl) setVol(v().volume + (k === 'ArrowUp' ? .1 : -.1));
      else moveFocus(k);
      poke();
    } else if (k === 'Enter' && !onControl) { e.preventDefault(); toggle(); poke(); }
  };
  useEffect(() => {
    const onKey = e => keyRef.current(e);
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  // ------------------------------------------------ touch: tap = controls, double tap sides = ±10
  const lastTap = useRef(0);
  const onSurface = e => {
    if (e.target !== e.currentTarget) return;
    const touch = e.pointerType === 'touch' || e.pointerType === 'pen';
    const now = Date.now();
    const r = e.currentTarget.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width;
    if (touch) {
      if (now - lastTap.current < 300 && (x < .35 || x > .65)) {
        const d = x < .35 ? -10 : 10;
        seekBy(d); setFlash({ side: d < 0 ? 'left' : 'right', k: now });
        lastTap.current = 0; return;
      }
      lastTap.current = now;
      if (ui && !menu) { setUi(false); } else { poke(); }
      setMenu(null);
    } else {
      if (menu) { setMenu(null); return; }
      toggle(); poke();
    }
  };
  // touch gestures: a vertical drag on the right half = volume; holding still = 2× while the finger is down
  const [gest, setGest] = useState(null);      // { kind: 'vol', level } | { kind: 'hold' }
  const touchG = useRef(null);
  const onDown = e => {
    if (e.pointerType !== 'touch' || !v()) return;
    const r = e.currentTarget.getBoundingClientRect();
    const g = { x: e.clientX, y: e.clientY, h: r.height, right: (e.clientX - r.left) / r.width > .5, vol: v().volume, mode: null };
    g.timer = setTimeout(() => { if (!v()) return; g.mode = 'hold'; g.rate = v().playbackRate; v().playbackRate = 2; setGest({ kind: 'hold' }); }, 450);
    touchG.current = g;
  };
  const onMove = e => {
    const g = touchG.current;
    if (!g || g.mode === 'hold') return;
    if (!g.mode) {
      if (Math.hypot(e.clientX - g.x, e.clientY - g.y) < 12) return;
      clearTimeout(g.timer);
      if (!g.right || Math.abs(e.clientY - g.y) < Math.abs(e.clientX - g.x)) { g.mode = 'off'; return; }
      g.mode = 'vol';
    }
    if (g.mode !== 'vol') return;
    const level = Math.max(0, Math.min(1, g.vol + (g.y - e.clientY) / (g.h * .6)));
    setVol(level); setGest({ kind: 'vol', level });
  };
  // returns true when the touch was a gesture (so it is not also a tap)
  const endGesture = () => {
    const g = touchG.current;
    touchG.current = null;
    if (!g) return false;
    clearTimeout(g.timer);
    if (g.mode === 'hold' && v()) v().playbackRate = g.rate;
    if (g.mode !== 'hold' && g.mode !== 'vol') return false;
    setGest(null);
    return true;
  };
  const onUp = e => { if (!endGesture()) onSurface(e); };
  useEffect(() => { if (!flash) return; const t = setTimeout(() => setFlash(null), 600); return () => clearTimeout(t); }, [flash]);

  // ------------------------------------------------ render
  // audio + in-file subtitle choices: RD's media info on the web, VLC's own track list in VLC mode
  const audios = vlc
    ? vt.audio.filter(t => t.id >= 0).map(t => ({ key: t.id, label: t.name, on: vt.audioId === t.id, pick: () => vlc.setAudio(t.id) }))
    : Object.entries((info && info.details && info.details.audio) || {}).map(([k, a]) => ({ key: k, label: a.lang || langName(a.lang_iso), extra: `${a.codec} ${a.channels}`, on: audio === k, pick: () => { setAudio(k); picked.current.audioLang = a.lang_iso; } }));
  const embeddedWeb = useMemo(() => trackLabels((info && info.details && info.details.subtitles) || {}), [info]);
  const embedded = vlc
    ? vt.subs.filter(t => t.id >= 0).map(t => ({ key: t.id, label: t.name, on: !cur && vt.subId === t.id, pick: () => { chooseExt(null); vlc.setSub(t.id); } }))
    : embeddedWeb.map(([k, x, label]) => ({ key: k, label, extra: x.type && String(x.type).toUpperCase(), on: burn === k, pick: () => { chooseExt(null); setBurn(k); picked.current.subLang = x.lang_iso && !/^(und|unk)$/i.test(x.lang_iso) ? x.lang_iso : 'off'; } }));
  const subsOn = !!cur || burn !== 'none' || (!!vlc && vt.subId >= 0);
  useEffect(() => {
    if (!vlc) return;
    document.documentElement.classList.add('vlc-on');
    return () => document.documentElement.classList.remove('vlc-on');
  }, []);
  const extByLang = useMemo(() => {
    const m = new Map();
    const q = subQ.trim().toLowerCase();
    for (const x of ext) {
      if (q && !`${x.label} ${x.lang} ${x.release}`.toLowerCase().includes(q)) continue;
      if (!m.has(x.lang)) m.set(x.lang, []); m.get(x.lang).push(x);
    }
    return [...m.entries()].sort((a, b) => (b[0] === s.subsLang) - (a[0] === s.subsLang) || a[1][0].label.localeCompare(b[1][0].label));
  }, [ext, subQ]);
  const pct = st.dur ? st.t / st.dur : 0;
  const subStyle = `--sub-size:${(s.subsSize || 100) / 100};--sub-color:${s.subsColor || '#fffbe8'};--sub-bg:rgba(0,0,0,${s.subsBg ?? .35})`;
  const op = skip && skip.op;
  const inIntro = op ? st.t >= op[0] && st.t < op[1] - 1 : !!video && st.t > 5 && st.t < 180 && st.dur > 600;
  const skipIntro = () => (op ? seekTo(op[1]) : seekBy(s.skipIntroSec || 85));

  return html`<div class=${cx('player', ui ? 'show-ui' : 'hide-ui', st.waiting && 'is-waiting', vlc && 'pl-vlc', fitCover && 'pl-cover')} ref=${boxRef} data-own-arrows data-focus-scope
      onPointerMove=${e => e.pointerType === 'mouse' && poke()} onPointerDown=${resetAutoRuns} style=${subStyle}>
    ${vlc ? (!started && html`<div class="pl-poster" style=${meta && meta.background ? `background-image:url("${meta.background}")` : ''}></div>`)
      : html`<video ref=${vRef} class="pl-video" playsinline webkit-playsinline autopictureinpicture preload="auto" crossorigin="anonymous" x-webkit-airplay="allow"
      style=${meta && meta.background && !started ? `background:#000 url("${meta.background}") center/cover no-repeat` : ''}>
      ${trackUrl && html`<track kind="subtitles" src=${trackUrl} srclang=${s.subsLang || 'en'} label=${cur && cur.label} default />`}
    </video>`}

    <div class="pl-surface" onPointerDown=${onDown} onPointerMove=${onMove} onPointerUp=${onUp} onPointerCancel=${endGesture}></div>

    ${line.length > 0 && html`<div class="pl-subs" aria-live="off">${line.map(l => html`<span dangerouslySetInnerHTML=${{ __html: l.replace(/\n/g, '<br>') }}></span>`)}</div>`}

    ${flash && html`<div class=${'pl-flash ' + flash.side} key=${flash.k}><${Icon} name=${flash.side === 'left' ? 'rewind' : 'forward'} size=${38} /><span>10s</span></div>`}
    ${gest && (gest.kind === 'hold'
      ? html`<div class="pl-gest hold"><span class="display">2×</span></div>`
      : html`<div class="pl-gest vol"><svg viewBox="0 0 30 150" class="pl-level" aria-hidden="true"><path d=${levelFrame} /><rect x="9" y=${144 - gest.level * 132} width="12" height=${gest.level * 132} rx="3" /></svg><span class="type">${Math.round(gest.level * 100)}</span></div>`)}
    ${st.waiting && !blocked && html`<div class="pl-buffer" aria-label="Buffering"><${Reel} mood="think" size=${96} /></div>`}
    ${blocked && html`<button type="button" class="pl-bigplay" onClick=${toggle} aria-label="Play"><${Icon} name="play" size=${54} /><span class="display">tap to play</span></button>`}

    <div class="pl-ui" aria-hidden=${!ui}>
      <div class="pl-top">
        <button type="button" class="pl-btn" onClick=${onBack} aria-label="Back"><${Icon} name="back" size=${28} /></button>
        <div class="pl-title">
          <div class="display pl-title-main">${title}</div>
          ${sub && html`<div class="type pl-title-sub">${sub}</div>`}
        </div>
        <div class="pl-top-tools">
          ${airplay && html`<button type="button" class="pl-btn" onClick=${() => v().webkitShowPlaybackTargetPicker()} aria-label="AirPlay"><${Icon} name="airplay" /></button>`}
          ${canCast && html`<button type="button" class="pl-btn" onClick=${cast} aria-label="Cast"><${Icon} name="cast" /></button>`}
          ${onPickSource && html`<button type="button" class="pl-btn pl-source-btn" onClick=${onPickSource} aria-label="Change source" title=${source && source.release}><${Icon} name="source" /><span class="type">${source && source.quality !== '?' ? source.quality : 'source'}</span></button>`}
        </div>
      </div>

      <div class="pl-center">
        <button type="button" class="pl-btn pl-skip10" onClick=${() => seekBy(-10)} aria-label="Back 10 seconds"><${Icon} name="rewind" size=${38} /></button>
        <button type="button" class="pl-btn pl-play" onClick=${toggle} aria-label=${st.playing ? 'Pause' : 'Play'}><${Icon} name=${st.playing ? 'pause' : 'play'} size=${46} /></button>
        <button type="button" class="pl-btn pl-skip10" onClick=${() => seekBy(10)} aria-label="Forward 10 seconds"><${Icon} name="forward" size=${38} /></button>
      </div>

      <div class="pl-bottom">
        ${inIntro && html`<button type="button" class="pl-chip pl-skipintro" onClick=${skipIntro}><${Icon} name="skip" size=${18} /> Skip intro</button>`}
        <${SeekBar} t=${st.t} dur=${st.dur} buf=${st.buf} onSeek=${seekTo} seed=${hash(String(meta && meta.id))} onActive=${poke} />
        <div class="pl-row">
          <button type="button" class="pl-btn" onClick=${toggle} aria-label=${st.playing ? 'Pause' : 'Play'}><${Icon} name=${st.playing ? 'pause' : 'play'} /></button>
          <button type="button" class="pl-btn hide-phone" onClick=${() => seekBy(-10)} aria-label="Back 10 seconds"><${Icon} name="rewind" /></button>
          <button type="button" class="pl-btn hide-phone" onClick=${() => seekBy(10)} aria-label="Forward 10 seconds"><${Icon} name="forward" /></button>
          <div class="pl-vol hide-phone">
            <button type="button" class="pl-btn" onClick=${() => (v().muted = !v().muted)} aria-label=${st.muted ? 'Unmute' : 'Mute'}><${Icon} name=${st.muted || st.vol === 0 ? 'mute' : 'audio'} /></button>
            <input type="range" min="0" max="1" step="0.05" value=${st.muted ? 0 : st.vol} onInput=${e => setVol(+e.currentTarget.value)} aria-label="Volume" />
          </div>
          <span class="pl-time type">${fmtTime(st.t)} <span class="faint">/ ${fmtTime(st.dur)}</span></span>
          <span class="pl-spacer"></span>
          ${next && html`<button type="button" class="pl-btn" onClick=${goNext} aria-label="Next episode" title="Next episode"><${Icon} name="skip" /></button>`}
          ${meta && meta.videos && meta.videos.length > 0 && html`<button type="button" class=${cx('pl-btn', menu === 'episodes' && 'on')} onClick=${() => setMenu(m => (m === 'episodes' ? null : 'episodes'))} aria-label="Episodes"><${Icon} name="episodes" /></button>`}
          <button type="button" class=${cx('pl-btn', subsOn && 'lit', menu === 'subs' && 'on')} onClick=${() => setMenu(m => (m === 'subs' ? null : 'subs'))} aria-label="Subtitles"><${Icon} name="subtitles" /></button>
          ${audios.length > 1 && html`<button type="button" class=${cx('pl-btn hide-phone', menu === 'audio' && 'on')} onClick=${() => setMenu(m => (m === 'audio' ? null : 'audio'))} aria-label="Audio"><${Icon} name="audio" /></button>`}
          <button type="button" class=${cx('pl-btn', menu === 'settings' && 'on', sleep.id !== 'off' && 'lit')} onClick=${() => setMenu(m => (m === 'settings' ? null : 'settings'))} aria-label="Settings"><${Icon} name="gear" /></button>
          ${canPip && html`<button type="button" class="pl-btn hide-phone" onClick=${pip} aria-label="Picture in picture"><${Icon} name="pip" /></button>`}
          ${!vlc && html`<button type="button" class=${cx('pl-btn hide-phone', fitCover && 'on')} onClick=${toggleFit} aria-pressed=${fitCover} aria-label="Fill the screen" title="Fill the screen (z)"><${Icon} name="fit" /></button>`}
          ${!vlc && html`<button type="button" class="pl-btn" onClick=${fullscreen} aria-label="Fullscreen"><${Icon} name=${isFs ? 'exitFullscreen' : 'fullscreen'} /></button>`}
        </div>
      </div>
    </div>

    ${menu === 'subs' && html`<${Menu} title="Subtitles" onClose=${() => setMenu(null)}>
      <${Item} on=${!subsOn} onClick=${() => { chooseExt(null, true); setBurn('none'); }}>Off<//>
      <label class="pl-chip pl-subfile"><${Icon} name="upload" size=${16} /> Load file…<input type="file" accept=".srt,.vtt,.ass,.ssa" onChange=${loadLocal} /></label>
      ${cur && html`<div class="pl-delay"><span>Timing</span>
        <button type="button" class="pl-chip" onClick=${() => setDelay(d => +(d - .25).toFixed(2))}>−¼s</button>
        <span class="type">${delay > 0 ? '+' : ''}${delay.toFixed(2)}s</span>
        <button type="button" class="pl-chip" onClick=${() => setDelay(d => +(d + .25).toFixed(2))}>+¼s</button>
      </div>`}
      ${!!v() && 'audioDelay' in v() && html`<div class="pl-delay"><span>Audio delay</span>
        <button type="button" class="pl-chip" onClick=${() => setAudioDelay(ad - .05)}>−50ms</button>
        <span class="type">${ad > 0 ? '+' : ''}${Math.round(ad * 1000)}ms</span>
        <button type="button" class="pl-chip" onClick=${() => setAudioDelay(ad + .05)}>+50ms</button>
        <button type="button" class="pl-chip" onClick=${() => setAudioDelay(0)}>Reset</button>
      </div>`}
      ${embedded.length > 0 && html`<div class="pl-menu-kicker kicker type">${vlc ? 'in the file' : 'in the file (burned in)'}</div>`}
      ${embedded.map(x => html`<${Item} key=${x.key} on=${x.on} onClick=${x.pick}>${x.label}${x.extra && html` <span class="faint type">${x.extra}</span>`}<//>`)}
      ${ext.length > 0 && html`<div class="pl-menu-kicker kicker type">opensubtitles</div>
        <input type="search" class="pl-subfilter" placeholder="Filter by language or release…" value=${subQ} onInput=${e => setSubQ(e.currentTarget.value)} aria-label="Filter subtitles" />`}
      ${extByLang.map(([lang, list]) => html`<details class="pl-sublang" open=${lang === s.subsLang || !!subQ}>
        <summary>${list[0].label} <span class="faint type">${list.length}</span></summary>
        ${list.slice(0, subQ ? 30 : 8).map(x => html`<${Item} on=${cur && cur.id === x.id} onClick=${() => { setBurn('none'); chooseExt(x, true); }}><span class="pl-sub-rel">${x.release || x.label}</span><//>`)}
      </details>`)}
      ${subQ && !extByLang.length && html`<p class="faint">Nothing matches “${subQ}”.</p>`}
      ${!embedded.length && !ext.length && html`<p class="faint">No subtitles found for this one.</p>`}
    <//>`}

    ${menu === 'audio' && html`<${Menu} title="Audio" onClose=${() => setMenu(null)}>
      ${audios.map(a => html`<${Item} key=${a.key} on=${a.on} onClick=${a.pick}>${a.label}${a.extra && html` <span class="faint type">${a.extra}</span>`}<//>`)}
    <//>`}

    ${menu === 'settings' && html`<${Menu} title="Settings" onClose=${() => setMenu(null)}>
      ${!vlc && html`<div class="pl-menu-kicker kicker type">quality</div>`}
      ${!vlc && html`<div class="pl-grid">${QUALITIES.filter(q => info ? true : stream.hls && stream.hls[q.key]).map(q => html`<button type="button" class=${cx('pl-chip', quality === q.key && 'on')} onClick=${() => { setDirect(false); setQuality(q.key); }}>${q.label}</button>`)}</div>`}
      ${audios.length > 1 && html`<div class="pl-menu-kicker kicker type">audio</div>
        <div class="pl-grid">${audios.map(a => html`<button type="button" key=${a.key} class=${cx('pl-chip', a.on && 'on')} onClick=${a.pick}>${a.label}</button>`)}</div>`}
      <div class="pl-menu-kicker kicker type">speed</div>
      <div class="pl-grid">${SPEEDS.map(r => html`<button type="button" class=${cx('pl-chip', st.rate === r && 'on')} onClick=${() => { v().playbackRate = r; picked.current.rate = r; }}>${r}×</button>`)}</div>
      <div class="pl-menu-kicker kicker type">sleep timer</div>
      <div class="pl-grid">${SLEEP.filter(x => x.id !== 'end' || video).map(x => html`<button type="button" class=${cx('pl-chip', sleep.id === x.id && 'on')}
        onClick=${() => setSleep({ id: x.id, at: x.id === 'off' || x.id === 'end' ? 0 : Date.now() + +x.id * 60e3 })}>${x.label}</button>`)}</div>
      <div class="pl-menu-kicker kicker type">extras</div>
      <div class="pl-grid">
        ${!vlc && html`<button type="button" class="pl-chip" onClick=${still}><${Icon} name="camera" size=${16} /> Save a still</button>`}
        ${canPip && html`<button type="button" class="pl-chip" onClick=${pip}><${Icon} name="pip" size=${16} /> Picture in picture</button>`}
        ${onPickSource && html`<button type="button" class="pl-chip" onClick=${() => { setMenu(null); onPickSource(); }}><${Icon} name="source" size=${16} /> Change source</button>`}
        ${!vlc && html`<button type="button" class=${cx('pl-chip', fitCover && 'on')} onClick=${toggleFit} aria-pressed=${fitCover}><${Icon} name="fit" size=${16} /> Fill the screen</button>`}
      </div>
      ${source && source.release && html`<p class="faint type pl-release">${source.release}</p>`}
    <//>`}

    ${menu === 'episodes' && meta && html`<${Episodes} meta=${meta} current=${video && video.id} onClose=${() => setMenu(null)} />`}

    ${showNext && html`<div class="pl-next">
      <span class="tape top"></span>
      <div class="kicker type">up next</div>
      <div class="pl-next-body">
        ${next.thumbnail && html`<${Img} src=${next.thumbnail} alt="" class="pl-next-thumb" />`}
        <div>
          <div class="display pl-next-title">S${next.season} · E${next.episode}</div>
          <div class="pl-next-name">${next.name || next.title || ''}</div>
        </div>
      </div>
      <div class="pl-next-actions">
        <button type="button" class="pl-chip on pl-next-go" onClick=${goNext}>
          <svg viewBox="0 0 36 36" class="pl-count" aria-hidden="true"><circle cx="18" cy="18" r="15" pathLength="1" style=${`stroke-dashoffset:${s.autoNext ? count / 10 : 0}`} /></svg>
          Play${s.autoNext ? ` in ${count}` : ''}
        </button>
        <button type="button" class="pl-chip" onClick=${() => setNextDismissed(true)}>Keep watching</button>
      </div>
    </div>`}

    ${stillAsk && html`<div class="pl-sleep pl-still" role="dialog" aria-label="Still watching?">
      <${Reel} mood="yawn" size=${150} />
      <h2>Still watching?</h2>
      <p class="muted">That's ${STILL_AFTER} episodes in a row. Up next: S${next.season} · E${next.episode}.</p>
      <div class="pl-next-actions">
        <button type="button" class="pl-chip on" autofocus onClick=${() => { resetAutoRuns(); goNext(); }}><${Icon} name="play" size=${18} /> Keep going</button>
        <button type="button" class="pl-chip" onClick=${() => { resetAutoRuns(); onBack && onBack(); }}>I'm done</button>
      </div>
    </div>`}

    ${asleep && html`<div class="pl-sleep" onClick=${() => setAsleep(false)}>
      <${Reel} mood="sleep" size=${170} />
      <h2>Sleep well.</h2>
      <p class="muted">Paused by your sleep timer. Tap to wake up.</p>
    </div>`}
  </div>`;
}

function Menu({ title, onClose, children }) {
  const ref = useRef();
  useEffect(() => { const b = ref.current && ref.current.querySelector('button, summary'); b && b.focus({ preventScroll: true }); }, []);
  return html`<div class="pl-menu" ref=${ref} role="dialog" aria-label=${title}>
    <div class="pl-menu-head"><h3>${title}</h3><button type="button" class="pl-btn" onClick=${onClose} aria-label="Close"><${Icon} name="close" size=${20} /></button></div>
    <div class="pl-menu-body">${children}</div>
  </div>`;
}
function Item({ on, onClick, children }) {
  return html`<button type="button" class=${cx('pl-item', on && 'on')} onClick=${onClick}>
    <span class="pl-item-tick">${on && html`<${Icon} name="check" size=${18} />`}</span><span class="pl-item-label">${children}</span>
  </button>`;
}

function Episodes({ meta, current, onClose }) {
  const seasons = seasonsOf(meta);
  const curSeason = (meta.videos.find(x => x.id === current) || {}).season;
  const [season, setSeason] = useState(curSeason ?? (seasons[0] && seasons[0][0]));
  const list = (seasons.find(x => x[0] === season) || [0, []])[1];
  const ref = useRef();
  useEffect(() => { const el = ref.current && ref.current.querySelector('.pl-ep.now'); el && el.scrollIntoView({ block: 'center' }); }, [season]);
  return html`<div class="pl-menu pl-episodes" role="dialog" aria-label="Episodes">
    <div class="pl-menu-head"><h3>Episodes</h3><button type="button" class="pl-btn" onClick=${onClose} aria-label="Close"><${Icon} name="close" size=${20} /></button></div>
    ${seasons.length > 1 && html`<div class="pl-grid pl-seasons">${seasons.map(([n]) => html`<button type="button" class=${cx('pl-chip', n === season && 'on')} onClick=${() => setSeason(n)}>${n === 0 ? 'Specials' : `S${n}`}</button>`)}</div>`}
    <div class="pl-menu-body" ref=${ref}>
      ${list.map(ep => {
        const e = epState(meta.id, ep.id);
        const out = !isReleased(ep);
        return html`<a class=${cx('pl-ep', ep.id === current && 'now', out && 'soon')} href=${out ? null : `#/watch/${meta.type}/${encodeURIComponent(meta.id)}?v=${encodeURIComponent(ep.id)}`}
            onClick=${e2 => { if (out) return; e2.preventDefault(); navigate(`#/watch/${meta.type}/${encodeURIComponent(meta.id)}?v=${encodeURIComponent(ep.id)}`, { replace: true }); }}>
          <span class="pl-ep-thumb">${ep.thumbnail ? html`<${Img} src=${ep.thumbnail} alt="" />` : html`<span class="display">${ep.episode}</span>`}
            ${e && html`<span class="pl-ep-bar" style=${`width:${e.done ? 100 : Math.round(e.t / e.dur * 100)}%`}></span>`}</span>
          <span class="pl-ep-text"><b>${ep.episode}. ${ep.name || ep.title || 'Episode ' + ep.episode}</b>
            <small class="faint type">${out ? 'coming ' + new Date(ep.released).toLocaleDateString() : e && e.done ? 'watched ✓' : ''}</small></span>
        </a>`;
      })}
    </div>
  </div>`;
}

/** Pencil-line seek bar with a scribbled scrubber. */
function SeekBar({ t, dur, buf, onSeek, seed, onActive }) {
  const ref = useRef();
  const [drag, setDrag] = useState(null);      // fraction while dragging
  const [hover, setHover] = useState(null);
  const d = useMemo(() => underlinePath(1000, seed, { sw: 6, h: 14 }), [seed]);
  const knob = useMemo(() => scribbleLoop(40, 40, seed, { sw: 3.2, turns: 1.3 }), [seed]);
  const frac = e => { const r = ref.current.getBoundingClientRect(); return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); };
  const shown = drag ?? (dur ? t / dur : 0);
  const kb = e => {
    if (!dur) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); onSeek(Math.max(0, Math.min(dur, t + (e.key === 'ArrowLeft' ? -10 : 10)))); onActive(); }
    if (e.key === 'Home') onSeek(0);
    if (e.key === 'End') onSeek(dur - 1);
  };
  return html`<div class="pl-seek" ref=${ref} role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax=${Math.round(dur)} aria-valuenow=${Math.round(t)} aria-valuetext=${fmtTime(t)}
      onKeyDown=${kb}
      onPointerDown=${e => { if (!dur) return; e.currentTarget.setPointerCapture(e.pointerId); setDrag(frac(e)); onActive(); }}
      onPointerMove=${e => { if (!dur) return; const f = frac(e); setHover(f); if (drag != null) { setDrag(f); onActive(); } }}
      onPointerUp=${e => { if (drag != null) { onSeek(frac(e) * dur); setDrag(null); } }}
      onPointerCancel=${() => setDrag(null)}
      onPointerLeave=${() => setHover(null)}>
    <svg viewBox="0 0 1000 14" preserveAspectRatio="none" class="pl-seek-line" aria-hidden="true">
      <clipPath id="plbuf"><rect width=${dur ? 1000 * Math.min(1, buf / dur) : 0} height="14" /></clipPath>
      <clipPath id="plplay"><rect width=${1000 * shown} height="14" /></clipPath>
      <path d=${d} fill="rgba(255,255,255,.28)" />
      <path d=${d} fill="rgba(255,255,255,.55)" clip-path="url(#plbuf)" />
      <path d=${d} fill="var(--a1)" clip-path="url(#plplay)" />
    </svg>
    <svg viewBox="0 0 40 40" class="pl-knob" style=${`left:${shown * 100}%`} aria-hidden="true"><circle cx="20" cy="20" r="11" fill="var(--a3)"/><path d=${knob} fill="#1e1630"/></svg>
    ${hover != null && dur > 0 && html`<span class="pl-seek-tip type" style=${`left:${(drag ?? hover) * 100}%`}>${fmtTime((drag ?? hover) * dur)}</span>`}
  </div>`;
}
