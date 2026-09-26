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
const SAMPLE_RE = /(^|[\W_])(sample|trailer|featurette|extras?)([\W_]|$)/i;

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

function pickFile(files, { fileIdx, filename, season, episode }) {
  const vids = files.filter(f => VIDEO_RE.test(f.path) && !SAMPLE_RE.test(f.path));
  const pool = vids.length ? vids : files;
  const base = p => p.split('/').pop().toLowerCase();
  if (filename) { const m = pool.find(f => base(f.path) === filename.toLowerCase()); if (m) return m; }
  if (season != null && episode != null) {
    const re = new RegExp(`s0*${season}[ ._-]?e0*${episode}(?!\\d)|\\b${season}x0*${episode}(?!\\d)`, 'i');
    const m = pool.find(f => re.test(base(f.path)));
    if (m) return m;
  } else if (episode != null) {
    // anime absolute numbering: "- 05", "E05", " 05 "
    const re = new RegExp(`(?:e|ep|episode|[ _-])0*${episode}(?:v\\d)?(?=[ ._\\-\\[\\(]|$)`, 'i');
    const m = pool.find(f => re.test(base(f.path).replace(VIDEO_RE, '')));
    if (m) return m;
  }
  if (fileIdx != null) { const m = files[fileIdx]; if (m && VIDEO_RE.test(m.path)) return m; }
  return pool.slice().sort((a, b) => b.bytes - a.bytes)[0];
}

const FAILED = ['error', 'magnet_error', 'virus', 'dead'];
const failIf = info => { if (FAILED.includes(info.status)) throw new RDError(`Source failed on Real-Debrid (${info.status}).`, info.status, 0); };

/**
 * Resolve a torrent (by info hash) into a playable stream on Real-Debrid.
 * Reuses a torrent already in the account when possible.
 * onStep(text) reports progress for the UI ("adding", "waiting", ...).
 * Returns { downloadId, filename, filesize, direct, hls, torrentId }.
 */
export async function resolveStream({ infoHash, fileIdx, filename, season, episode }, onStep = () => {}) {
  infoHash = infoHash.toLowerCase();
  const cacheKey = ['v2', infoHash, fileIdx ?? '', filename || '', season ?? '', episode ?? ''].join('|');
  const hit = resolveCache()[cacheKey];
  if (hit && Date.now() - hit.at < 6 * 3600e3) {
    try { return { ...hit, hls: hlsFrom(await transcode(hit.downloadId)) }; } catch {}
  }

  onStep('Looking in your Real-Debrid…');
  // any live copy already in the account (first 3 pages), so we don't add duplicates
  let existing = null;
  for (let page = 1; page <= 3 && !existing; page++) {
    const batch = (await torrents(page, 100)) || [];
    const same = batch.filter(t => t.hash.toLowerCase() === infoHash && !FAILED.includes(t.status));
    existing = same.find(t => t.status === 'downloaded') || same[0];
    if (batch.length < 100) break;
  }
  let id = existing && existing.id;
  if (!id) {
    onStep('Adding to Real-Debrid…');
    id = (await addMagnet(`magnet:?xt=urn:btih:${infoHash}`)).id;
  }

  let info = await torrentInfo(id);
  for (let i = 0; info.status === 'magnet_conversion' && i < 12; i++) { await sleep(Math.min(4000, 800 * 1.3 ** i)); info = await torrentInfo(id); }
  failIf(info);

  const file = pickFile(info.files || [], { fileIdx, filename, season, episode });
  if (!file) throw new RDError('No playable video file in this source.', 'nofile', 0);

  if (info.status === 'waiting_files_selection') {
    onStep('Picking the file…');
    const vids = info.files.filter(f => VIDEO_RE.test(f.path) && !SAMPLE_RE.test(f.path));
    // Select every video file so the same torrent serves the whole season later.
    await selectFiles(id, (vids.length ? vids : [file]).map(f => f.id).join(','));
    info = await torrentInfo(id);
  }

  for (let i = 0; info.status !== 'downloaded' && i < 8; i++) {
    failIf(info);
    onStep(info.status === 'downloading' ? `Not cached. Real-Debrid is downloading (${info.progress || 0}%)…` : 'Waiting for Real-Debrid…');
    await sleep(Math.min(5000, 1000 * 1.4 ** i));
    info = await torrentInfo(id);
  }
  failIf(info);
  if (info.status !== 'downloaded') {
    throw new RDError('This source is not cached yet. Real-Debrid keeps downloading it in the background, so try another source or come back later.', 'notcached', 0);
  }

  // links[] line up with the selected files, in file order
  const selected = info.files.filter(f => f.selected);
  const idx = selected.findIndex(f => f.id === file.id);
  const link = (info.links || [])[idx >= 0 ? idx : 0];
  if (!link) throw new RDError('Real-Debrid has no link for this file yet. Try again in a moment or pick another source.', 'nolink', 0);
  onStep('Unlocking the stream…');
  const un = await unrestrict(link);
  // RD's links don't always line up with files in big packs: never play a different file than the one we picked
  const want = file.path.split('/').pop().toLowerCase();
  if (selected.length > 1 && un.filename && un.filename.toLowerCase() !== want) throw new RDError('This source points at a different file.', 'wrongfile', 0);
  const downloadId = downloadIdFrom(un);
  onStep('Preparing video for your device…');
  const tc = await transcode(downloadId);
  const out = { downloadId, filename: un.filename, filesize: un.filesize, direct: un.download, torrentId: id, mime: un.mimeType };
  remember(cacheKey, out);
  return { ...out, hls: hlsFrom(tc) };
}

// Play something already in the account (My Real-Debrid page): a torrent link or a hoster link.
export async function resolveLink(link) {
  const un = await unrestrict(link);
  const downloadId = downloadIdFrom(un);
  let hls = null;
  try { hls = hlsFrom(await transcode(downloadId)); } catch {}
  return { downloadId, filename: un.filename, filesize: un.filesize, direct: un.download, mime: un.mimeType, hls };
}
