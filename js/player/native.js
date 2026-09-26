// Native player for the iOS/Android app (Capacitor shell, see app/). Plays RD's original file with VLC, so mkv,
// HEVC, Dolby and DTS play without RD's live transcode. On the web isNative() is false and this is never used.
// Same props as <Player>. The native side sends 'progress' {position, duration, paused} every few seconds,
// 'next' when the viewer taps Next, and 'closed' {position, duration, ended} when it goes away.
import { html, useEffect, useRef } from '../../vendor/preact-htm.js';
import { Reel } from '../ui/components.js';
import { useStore, settings } from '../core/store.js';
import { saveProgress } from '../core/progress.js';
import { watchHref } from '../lib/play.js';
import { nextVideo } from '../core/meta.js';
import { navigate } from '../router.js';

const plugin = () => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.StreamoraPlayer) || null;
export const isNative = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && plugin());

export function NativePlayer({ meta, video, stream, start = 0, source, noProgress, onFatal, onBack }) {
  const s = useStore(settings);
  const last = useRef({ position: start, duration: 0 });
  const next = meta && video ? nextVideo(meta, video.id) : null;

  useEffect(() => {
    const p = plugin();
    let done = false;
    const handles = [];
    const pct = () => (last.current.duration ? (last.current.position / last.current.duration) * 100 : 0);
    const emit = state => {
      if (!meta || noProgress) return;
      try { window.dispatchEvent(new CustomEvent('streamora:playback', { detail: { state, meta, video, progress: +pct().toFixed(2) } })); } catch {}
    };
    const save = final => {
      const { position, duration } = last.current;
      if (noProgress || !meta || !duration) return;
      saveProgress(meta, video, final ? duration : position, duration,
        source && { infoHash: source.infoHash, fileIdx: source.fileIdx, binge: source.binge, filename: source.filename || null });
    };
    const goNext = () => navigate(watchHref(meta, next, 0, source && source.infoHash ? { infoHash: source.infoHash } : null), { replace: true });
    const on = (name, f) => Promise.resolve(p.addListener(name, f)).then(h => (done ? h.remove() : handles.push(h)));

    on('progress', d => {
      const was = last.current.paused;
      last.current = d;
      save();
      if (was !== d.paused) emit(d.paused ? 'pause' : 'start');
    });
    on('next', () => { save(); emit('stop'); done = true; next ? goNext() : onBack(); });
    on('closed', d => {
      if (done) return;
      done = true;
      last.current = { ...last.current, ...d };
      save(d.ended);
      emit('stop');
      if (d.error) return onFatal && onFatal(new Error(d.error), d.position || 0);
      if (d.ended && next && s.autoNext !== false) goNext(); else onBack();
    });

    const sub = video ? `S${video.season} · E${video.episode}${video.name || video.title ? ' · ' + (video.name || video.title) : ''}` : '';
    p.play({ url: stream.direct, title: meta ? meta.name : stream.filename || '', subtitle: sub, start: Math.max(0, Math.floor(start || 0)), hasNext: !!next })
      .then(() => emit('start'))
      .catch(e => { done = true; onFatal ? onFatal(e, start) : onBack(); });

    return () => { const was = done; done = true; handles.forEach(h => h.remove()); if (!was) p.close().catch(() => {}); };
  }, [stream && stream.direct]);

  return html`<div class="watch-native" style="position:fixed;inset:0;display:grid;place-items:center;background:#000"><${Reel} size=${80} /></div>`;
}
