// Real-Debrid client. All calls go through our same-origin relay (/api/rd/*).
import { getRdKey, ls } from './store.js';

export class RDError extends Error {
  constructor(msg, code, status) { super(msg); this.code = code; this.status = status; }
}
const MESSAGES = {
  8: 'Your Real-Debrid key is invalid or expired.',
  9: 'Real-Debrid refused this request.',
  20: 'Hoster not available on Real-Debrid.',
  21: 'Too many active downloads on your account.',
  23: 'Traffic limit reached.',
  24: 'This file is unavailable.',
  34: 'Too many requests. Slow down a little.',
  35: 'This file was blocked by Real-Debrid.',
  36: 'Real-Debrid is too busy right now.',
};

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function rd(path, { method = 'GET', body, key, retry = true } = {}) {
  key = key || await getRdKey();
  if (!key) throw new RDError('No Real-Debrid key set.', 'nokey', 0);
  const init = { method, headers: { Authorization: `Bearer ${key}` } };
  if (body) {
    init.body = new URLSearchParams(body);
    init.headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  let r;
  try { r = await fetch(`/api/rd/${path}`, init); }
  catch { throw new RDError('Could not reach the relay. Are you offline?', 'network', 0); }
  if (r.status === 429 && retry) {
    await sleep(Math.min(10, +r.headers.get('Retry-After') || 2) * 1000);
    return rd(path, { method, body, key, retry: false });
  }
  if (r.status === 204) return null;
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok || (j && j.error)) {
    const code = j && j.error_code;
    throw new RDError(MESSAGES[code] || (j && j.error) || `Real-Debrid error ${r.status}`, code || r.status, r.status);
  }
  return j;
}

export const user = key => rd('user', { key });
export const torrents = (page = 1, limit = 100) => rd(`torrents?page=${page}&limit=${limit}`);
export const torrentInfo = id => rd(`torrents/info/${id}`);
export const deleteTorrent = id => rd(`torrents/delete/${id}`, { method: 'DELETE' });
export const downloads = (page = 1, limit = 100) => rd(`downloads?page=${page}&limit=${limit}`);
export const trafficToday = async () => { const d = new Date().toISOString().slice(0, 10); const j = await rd(`traffic/details?start=${d}&end=${d}`); return Object.values(j || {}).reduce((n, x) => n + ((x && x.bytes) || 0), 0); };
export const deleteDownload = id => rd(`downloads/delete/${id}`, { method: 'DELETE' });
export const unrestrict = link => rd('unrestrict/link', { method: 'POST', body: { link } });
export const transcode = id => rd(`streaming/transcode/${id}`);
export const mediaInfos = id => rd(`streaming/mediaInfos/${id}`);
export const addMagnet = magnet => rd('torrents/addMagnet', { method: 'POST', body: { magnet } });
export const selectFiles = (id, files) => rd(`torrents/selectFiles/${id}`, { method: 'POST', body: { files } });

export async function allTorrents() {
  const out = [];
  for (let page = 1; page < 50; page++) {
    const batch = await torrents(page, 100);
    if (!batch || !batch.length) break;
    out.push(...batch);
    if (batch.length < 100) break;
  }
  return out;
}

export const VIDEO_RE = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|flv|mpg|mpeg)$/i;

// The download id is what the streaming endpoints want: https://xx.download.real-debrid.com/d/{ID}/name
export const downloadIdFrom = unrestricted => unrestricted.id || (unrestricted.download || '').split('/d/')[1]?.split('/')[0];

// Turn a transcode response into what the player needs.
export function hlsFrom(tc) {
  const a = (tc && tc.apple) || {};
  return {
    original: a.original, high: a.high, high_low: a.high_low, medium: a.medium,
    medium_low: a.medium_low, low: a.low, low_low: a.low_low,
  };
}

const resolveCache = () => ls.get('resolved', {});
function remember(k, v) {
  const c = resolveCache(); c[k] = { ...v, at: Date.now() };
  // keep the newest 200
  const keys = Object.keys(c).sort((a, b) => c[b].at - c[a].at).slice(200);
  keys.forEach(x => delete c[x]);
  ls.set('resolved', c);
}

// Torrentio's explainer videos (…/videos/<reason>_v3.mp4) -> what to tell the viewer
const TORRENTIO_REASONS = {
  failed_infringement: ['Real-Debrid won\'t download this release (its copyright filter). Pick one marked RD+ cached.', 35],
  downloading: ['Not cached yet: Real-Debrid is downloading it in the background. Try another source or come back later.', 'notcached'],
  failed_download: ['Real-Debrid couldn\'t download this source.', 'failed'],
  failed_access: ['Real-Debrid refused access. Check that your premium is active.', 8],
  failed_rar: ['This release is a RAR archive, which can\'t be streamed.', 'failed'],
  failed_opening: ['Real-Debrid couldn\'t open this file.', 'failed'],
  limits_exceeded: ['Real-Debrid says you hit a limit. Try again in a while.', 21],
  failed_too_big: ['This file is too big for Real-Debrid.', 'failed'],
};

/**
 * Turn a source into a playable Real-Debrid file. Torrentio does the adding and unlocking from its servers, like in
 * Stremio (Real-Debrid refuses torrent adds from many addresses; see functions/api/resolve.js). `url` is the
 * stream's own Torrentio link when we have it; otherwise one is built from hash + file index + filename.
 * Returns { downloadId, filename, direct, hls }. direct=true (the app's VLC player) skips RD's transcode.
 */
export async function resolveStream({ infoHash, fileIdx, filename, url, season, episode, direct = false }, onStep = () => {}) {
  infoHash = infoHash.toLowerCase();
  const cacheKey = ['v3', infoHash, fileIdx ?? '', filename || '', season ?? '', episode ?? ''].join('|');
  const hit = resolveCache()[cacheKey];
  if (hit && Date.now() - hit.at < 6 * 3600e3) {
    if (direct) return { ...hit, hls: null };
    try { return { ...hit, hls: hlsFrom(await transcode(hit.downloadId)) }; } catch {}
  }

  const key = await getRdKey();
  if (!key) throw new RDError('No Real-Debrid key set.', 'nokey', 0);
  const tio = url && /^https:\/\/torrentio\.strem\.fun\/resolve\/realdebrid\//.test(url) ? url
    : `https://torrentio.strem.fun/resolve/realdebrid/${key}/${infoHash}/null/${fileIdx ?? 0}/${encodeURIComponent(filename || 'video')}`;
  onStep('Unlocking it on Real-Debrid…');
  let j;
  try { j = await (await fetch(`/api/resolve?u=${encodeURIComponent(tio)}`)).json(); }
  catch { throw new RDError('Could not reach Torrentio. Are you offline?', 'network', 0); }
  if (!j.ok) {
    const [msg, code] = TORRENTIO_REASONS[j.reason] || [`This source didn't start (${String(j.reason || j.error || 'unknown').replace(/_/g, ' ')}).`, 'failed'];
    throw new RDError(msg, code, 0);
  }
  const link = j.url;
  const name = decodeURIComponent(link.split('/').pop().split('?')[0] || '') || filename || 'video';
  const out = { downloadId: link.split('/d/')[1]?.split('/')[0], filename: name, direct: link, mime: /\.mp4$/i.test(name) ? 'video/mp4' : null };
  remember(cacheKey, out);
  if (direct) return { ...out, hls: null };
  onStep('Preparing video for your device…');
  let hls = null;
  try { hls = hlsFrom(await transcode(out.downloadId)); } catch {}
  return { ...out, hls };
}

// Play something already in the account (My Real-Debrid page): a torrent link or a hoster link.
export async function resolveLink(link, { direct = false } = {}) {
  const un = await unrestrict(link);
  const downloadId = downloadIdFrom(un);
  let hls = null;
  if (!direct) try { hls = hlsFrom(await transcode(downloadId)); } catch {}
  return { downloadId, filename: un.filename, filesize: un.filesize, direct: un.download, mime: un.mimeType, hls };
}
