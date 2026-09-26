// Video engine: attaches an HLS (or direct) url to a <video>. Safari/iOS plays HLS natively; others use hls.js.
// Also builds Real-Debrid transcode urls from mediaInfos().modelUrl so audio / burned-in subs / quality can change.

export const QUALITIES = [
  { key: 'original', model: 'full', label: 'Original' },
  { key: 'high', model: '1080p_8mbps', label: '1080p · high' },
  { key: 'high_low', model: '1080p_4mbps', label: '1080p' },
  { key: 'medium', model: '720p_4mbps', label: '720p · high' },
  { key: 'medium_low', model: '720p_2mbps', label: '720p' },
  { key: 'low', model: '480p_2mbps', label: '480p · high' },
  { key: 'low_low', model: '480p_1mbps', label: '480p' },
];

const ua = navigator.userAgent;
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isSafari = /Safari/.test(ua) && !/Chrome|Chromium|CriOS|FxiOS|Edg|Android/.test(ua);

/** 'auto' for this device. "original" re-encodes at source size (4K → heavy, slow to start), so auto never picks it. */
export function autoQuality(height, phone) {
  if (phone) return 'high_low';
  return height && height <= 720 ? 'medium' : 'high';
}

/** Build a transcode url. model = mediaInfos().modelUrl */
export function buildUrl(model, { audio, subs = 'none', quality = 'high', format = 'm3u8' }) {
  const q = (QUALITIES.find(x => x.key === quality) || QUALITIES[1]).model;
  return model.replace('{audio}', audio).replace('{subtitles}', subs || 'none').replace('{audioCodec}', 'aac').replace('{quality}', q).replace('{format}', format);
}

let hlsPromise;
export function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  return hlsPromise ||= new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'vendor/hls.min.js';
    s.onload = () => res(window.Hls);
    s.onerror = () => { hlsPromise = null; rej(new Error('Could not load the video engine')); };
    document.head.appendChild(s);
  });
}

const nativeHls = v => isSafari || isIOS ? !!v.canPlayType('application/vnd.apple.mpegurl') : false;

/**
 * attach(video, url, { start, onFatal }) -> detach()
 * start = seconds to begin at. onFatal(err, pos) when the stream can't be played; pos = video.currentTime then.
 */
export async function attach(video, url, { start = 0, onFatal = () => {} } = {}) {
  const isHls = /\.m3u8(\?|$)/.test(url);
  const seek = () => { if (start > 0) try { video.currentTime = start; } catch {} };
  const fatal = e => onFatal(e, video.currentTime || start);
  const plain = () => {
    // native HLS / direct files: the first error gets one reload at the current position, the second is fatal
    let retried = false;
    const onErr = () => {
      if (retried) return fatal(new Error('This stream could not be played on this device.'));
      retried = true;
      start = video.currentTime || start;
      video.src = url; video.load();
      video.addEventListener('loadedmetadata', seek, { once: true });
      video.play && video.play().catch(() => {});
    };
    video.src = url;
    video.addEventListener('loadedmetadata', seek, { once: true });
    video.addEventListener('error', onErr);
    return () => { video.removeEventListener('error', onErr); video.removeEventListener('loadedmetadata', seek); video.removeAttribute('src'); video.load(); };
  };
  if (!isHls || nativeHls(video)) return plain();
  const Hls = await loadHls();
  if (!Hls.isSupported()) return plain();
  // RD transcodes on the fly: a cold segment can take 20s+ to appear, so be patient before calling it dead.
  const slow = { maxTimeToFirstByteMs: 60000, maxLoadTimeMs: 90000, timeoutRetry: { maxNumRetry: 4, retryDelayMs: 1000, maxRetryDelayMs: 4000 }, errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 } };
  const hls = new Hls({ startPosition: start > 0 ? start : -1, maxBufferLength: 120, maxMaxBufferLength: 300, maxBufferSize: 150e6, backBufferLength: 90, maxBufferHole: 1, startFragPrefetch: true, enableWorker: true,
    fragLoadPolicy: { default: slow }, playlistLoadPolicy: { default: slow }, manifestLoadPolicy: { default: slow } });
  let recovered = 0;

  hls.on(Hls.Events.FRAG_BUFFERED, () => { recovered = 0; });   // healthy again: allow fresh recoveries later
  hls.on(Hls.Events.ERROR, (_, d) => {
    if (!d.fatal) return;
    if (d.type === Hls.ErrorTypes.NETWORK_ERROR && recovered < 3) { recovered++; hls.startLoad(); return; }
    if (d.type === Hls.ErrorTypes.MEDIA_ERROR && recovered < 3) { recovered++; hls.recoverMediaError(); return; }
    fatal(new Error(d.details || 'Stream error'));
  });
  hls.loadSource(url);
  hls.attachMedia(video);
  return () => hls.destroy();
}
