// TorBox client. All calls go through our same-origin relay (/api/tb/*).
import { getTbKey, ls } from './store.js';
import { fetchT } from './net.js';
import { canRemuxMkv } from '../player/mkv-plan.js';

export class TBError extends Error {
  constructor(msg, code, status) { super(msg); this.code = code; this.status = status; }
}
const MESSAGES = {
  BAD_TOKEN: 'Your TorBox key is invalid or expired.',
  NO_AUTH: 'Your TorBox key is invalid or expired.',
  ACTIVE_LIMIT: 'Your TorBox download slots are full. Wait for one to finish, or pick a cached source.',
  MONTHLY_LIMIT: 'You reached your TorBox monthly limit.',
  COOLDOWN_LIMIT: 'TorBox asks you to wait a moment before adding another one.',
  DOWNLOAD_TOO_LARGE: 'This file is too large for your TorBox plan.',
  PLAN_RESTRICTED_FEATURE: 'Your TorBox plan doesn\'t include this.',
  DOWNLOAD_SERVER_ERROR: 'TorBox is having trouble with this download.',
  DATABASE_ERROR: 'TorBox is too busy right now.',
};
const PLANS = { 0: 'free', 1: 'essential', 2: 'pro', 3: 'standard' };
const NOWEB = 'tb-noweb'; // when TorBox last refused browser streaming on this plan
const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function tb(path, { method = 'GET', json, form, data, key, retry = true } = {}) {
  key = key || await getTbKey();
  if (!key) throw new TBError('No TorBox key set.', 'nokey', 0);
  const init = { method, headers: { Authorization: `Bearer ${key}` } };
  if (json) { init.body = JSON.stringify(json); init.headers['Content-Type'] = 'application/json'; }
  if (form) { init.body = new URLSearchParams(form); init.headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  if (data) init.body = data; // FormData: the browser writes the boundary
  let r;
  try { r = await fetchT(`/api/tb/${path}`, init, 20000, 'TorBox'); }
  catch (e) { throw e.code === 'timeout' ? new TBError(e.message, 'timeout', 0) : new TBError('Could not reach the relay. Are you offline?', 'network', 0); }
  if (r.status === 429 && retry) {
    await sleep(Math.min(10, +r.headers.get('Retry-After') || 2) * 1000);
    return tb(path, { method, json, form, data, key, retry: false });
  }
  const text = await r.text();
  let j = null; try { j = text ? JSON.parse(text) : null; } catch {}
  if (!r.ok || !j || j.success === false) {
    const name = j && j.error, detail = j && j.detail;
    const bad = r.status === 401 || name === 'BAD_TOKEN' || name === 'NO_AUTH';
    throw new TBError(MESSAGES[name] || detail || `TorBox error ${r.status}`, bad ? 'badkey' : name || r.status, r.status);
  }
  return j.data;
}

const q = o => new URLSearchParams(Object.entries(o).filter(([, v]) => v != null)).toString();

/** TorBox's record -> the app's shape. */
export function normalize(t, kind = 'torrent') {
  const state = String(t.download_state || '');
  const failed = /fail|error|dead|virus/i.test(state);
  return {
    id: t.id, kind, hash: String(t.hash || '').toLowerCase(), filename: t.name || '', bytes: t.size || 0,
    status: t.download_present || t.download_finished ? 'downloaded' : failed ? 'error' : state === 'metaDL' || /^check/i.test(state) ? 'magnet_conversion' : t.active === false && !state ? 'queued' : 'downloading',
    state, progress: Math.round((t.progress || 0) * 100), speed: t.download_speed || 0, seeders: t.seeds, added: t.created_at,
    files: (t.files || []).filter(f => !f.infected).map(f => ({ id: f.id, path: f.name || f.short_name || '', name: f.short_name || String(f.name || '').split('/').pop(), bytes: f.size || 0, mime: f.mimetype })),
  };
}

export async function user(key) {
  const u = await tb(`user/me?${q({ settings: false })}`, { key });
  const paid = !!u.plan && u.is_subscribed !== false && (!u.premium_expires_at || new Date(u.premium_expires_at) > new Date());
  return { username: u.email, email: u.email, plan: PLANS[u.plan] || 'plan', type: paid ? 'premium' : 'free', expiration: u.premium_expires_at };
}
const list = async (base, kind, page, limit) => {
  const d = await tb(`${base}/mylist?${q({ bypass_cache: true, limit, offset: (page - 1) * limit })}`);
  return (Array.isArray(d) ? d : []).map(t => normalize(t, kind));
};
export const torrents = (page = 1, limit = 100) => list('torrents', 'torrent', page, limit);
export const webDownloads = (page = 1, limit = 100) => list('webdl', 'web', page, limit);
export const torrentInfo = async id => normalize(await tb(`torrents/mylist?${q({ bypass_cache: true, id })}`));
export const webInfo = async id => normalize(await tb(`webdl/mylist?${q({ bypass_cache: true, id })}`), 'web');
export const deleteTorrent = id => tb('torrents/controltorrent', { method: 'POST', json: { torrent_id: id, operation: 'delete' } });
export const deleteWeb = id => tb('webdl/controlwebdownload', { method: 'POST', json: { webdl_id: id, operation: 'delete' } });

const createTorrent = fields => {
  const f = new FormData();
  Object.entries({ seed: 3, allow_zip: false, ...fields }).forEach(([k, v]) => f.append(k, v));
  return tb('torrents/createtorrent', { method: 'POST', data: f });
};
const addedId = d => {
  const id = d && (d.torrent_id ?? d.id);
  if (id == null) throw new TBError('TorBox queued this one. It starts when a download slot frees up.', 'notcached', 0);
  return id;
};
export const addMagnet = async magnet => addedId(await createTorrent({ magnet }));
export const addTorrentFile = async file => addedId(await createTorrent({ file }));
export const addWebLink = async link => {
  const d = await tb('webdl/createwebdownload', { method: 'POST', form: { link } });
  const id = d && (d.webdownload_id ?? d.web_id ?? d.id);
  if (id == null) throw new TBError('TorBox queued this link. It starts when a download slot frees up.', 'notcached', 0);
  return id;
};

/** Which of these hashes TorBox has ready right now, or null if it couldn't say. */
export async function checkCached(hashes) {
  const out = new Set();
  try {
    const batches = [];
    for (let i = 0; i < hashes.length; i += 100) batches.push(hashes.slice(i, i + 100));
    const worker = async () => {
      for (let b; (b = batches.shift());) {
        const d = await tb(`torrents/checkcached?${q({ format: 'object', list_files: false })}`, { method: 'POST', json: { hashes: b } });
        Object.keys(d || {}).forEach(h => out.add(h.toLowerCase()));
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out;
  } catch (e) { if (e.code === 'badkey' || e.code === 'nokey') throw e; return null; }
}

const SAMPLE_RE = /(^|[\W_])(sample|trailer|featurette|extras?)([\W_]|$)/i;
export const VIDEO_RE = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|flv|mpg|mpeg)$/i;
export const videoFiles = t => t.files.filter(f => VIDEO_RE.test(f.path) && !SAMPLE_RE.test(f.path));

export function pickFile(files, { fileIdx, filename, season, episode }) {
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
  if (fileIdx != null) { const m = pool.find(f => f.id === fileIdx); if (m) return m; }
  return pool.slice().sort((a, b) => b.bytes - a.bytes)[0];
}

// ---- web playback: direct browser files, TorBox HLS, or client-side MKV remuxing
const mkvFile = name => /\.mkv$/i.test(name || '');
const browserFile = name => /\.(mp4|m4v|webm)$/i.test(name || '');
const hevc = name => /x265|hevc|h\.?265/i.test(name || '');
/** true once TorBox has told us this plan has no browser streaming (remembered for a day, then asked again). */
export const webStreamingRefused = () => Date.now() - ls.get(NOWEB, 0) < 864e5;
const webPlanError = () => new TBError("This file's format can't play in this browser. Pick another source, or play it in the Streamora app.", 'webplan', 0);

async function webHls(id, fileId, kind) {
  if (webStreamingRefused()) return null;
  try {
    const d = await tb(`stream/createstream?${q({ id, file_id: fileId, type: kind, chosen_subtitle_index: null })}`);
    const u = d && d.hls_url;
    return u ? { original: u } : null;
  } catch (e) {
    if (/not allowed|upgrade|PLAN_RESTRICTED/i.test(`${e.message} ${e.code}`)) ls.set(NOWEB, Date.now());
    if (e.code === 'badkey') throw e;
    return null;
  }
}

async function finish(t, file, direct) {
  const kind = t.kind;
  let hls = null;
  if (!direct && (!browserFile(file.path) || hevc(file.path))) {
    hls = await webHls(t.id, file.id, kind);
    if (!hls && !browserFile(file.path) && !(mkvFile(file.path) && canRemuxMkv())) throw webPlanError();
  }
  const url = await tb(`${kind === 'web' ? 'webdl' : 'torrents'}/requestdl?${q(kind === 'web' ? { web_id: t.id, file_id: file.id } : { torrent_id: t.id, file_id: file.id })}`);
  if (!url) throw new TBError('TorBox has no link for this file. Pick another source.', 'nolink', 0);
  return { downloadId: `${t.id}:${file.id}`, filename: file.path.split('/').pop(), filesize: file.bytes, direct: url, torrentId: t.id, mime: file.mime, hls, remux: !direct && !hls && mkvFile(file.path) };
}

const resolveCache = () => ls.get('resolved', {});
function remember(k, v) {
  const c = resolveCache(); c[k] = { ...v, at: Date.now() };
  Object.keys(c).sort((a, b) => c[b].at - c[a].at).slice(200).forEach(x => delete c[x]); // keep the newest 200
  ls.set('resolved', c);
}

async function findInAccount(h) {
  for (let page = 1; page <= 3; page++) {
    const batch = await torrents(page, 500);
    const same = batch.filter(t => t.hash === h && t.status !== 'error');
    const t = same.find(x => x.status === 'downloaded') || same[0];
    if (t || batch.length < 500) return t || null;
  }
  return null;
}

/**
 * Turn a source into a playable file. A copy already in the account is used as is; otherwise it's added (TorBox answers
 * at once when cached). onStep(text) reports progress. direct=true (the app's VLC player) plays any file as it is.
 * Returns { downloadId, filename, filesize, direct, hls, remux, torrentId, mime }.
 */
export async function resolveStream({ infoHash, fileIdx, filename, season, episode, direct = false }, onStep = () => {}) {
  infoHash = infoHash.toLowerCase();
  // Do not add a known unsupported format when this plan has already refused streaming.
  if (!direct && webStreamingRefused() && filename && !browserFile(filename) && !(mkvFile(filename) && canRemuxMkv())) throw webPlanError();
  const cacheKey = ['tb1', infoHash, fileIdx ?? '', filename || '', season ?? '', episode ?? ''].join('|');
  const hit = resolveCache()[cacheKey];
  if (hit && Date.now() - hit.at < 6 * 3600e3) {
    // links are minted fresh each time; only the file choice is remembered
    try { return await finish({ id: hit.torrentId, kind: 'torrent' }, { id: hit.fileId, path: hit.filename, bytes: hit.filesize, mime: hit.mime }, direct); }
    catch (e) { if (e.code === 'webplan' || e.code === 'badkey') throw e; }
  }

  onStep('Looking in your TorBox…');
  let t = await findInAccount(infoHash);
  if (!t) {
    onStep('Adding it to your TorBox…');
    const id = addedId(await createTorrent({ magnet: `magnet:?xt=urn:btih:${infoHash}` }));
    t = { id, status: 'queued' };
  }
  for (let i = 0; t.status !== 'downloaded' && i < 6; i++) {
    if (t.status === 'error') throw new TBError('This source failed on TorBox.', 'failed', 0);
    if (i) onStep(t.status === 'downloading' ? `Not cached. TorBox is downloading (${t.progress || 0}%)…` : 'Waiting for TorBox…');
    if (i) await sleep(1000 * i);
    try { t = await torrentInfo(t.id); } catch (e) { if (e.code === 'badkey' || e.code === 'network') throw e; }
  }
  if (t.status !== 'downloaded') throw new TBError('This source is not cached yet. TorBox keeps downloading it in the background, so try another source or come back later.', 'notcached', 0);

  const file = pickFile(t.files, { fileIdx, filename, season, episode });
  if (!file) throw new TBError('TorBox has no file for this episode in that source. Pick another one.', 'nolink', 0);
  onStep('Unlocking the stream…');
  const out = await finish(t, file, direct);
  remember(cacheKey, { torrentId: t.id, fileId: file.id, filename: out.filename, filesize: out.filesize, mime: out.mime });
  return out;
}

// Library links are "<torrent id>:<file id>" or "web:<id>:<file id>"
export const libraryRef = (t, f) => `${t.kind === 'web' ? 'web:' : ''}${t.id}:${f.id}`;
export async function resolveLink(ref, { direct = false } = {}) {
  const web = ref.startsWith('web:');
  const [id, fileId] = ref.replace(/^web:/, '').split(':').map(Number);
  const t = await (web ? webInfo : torrentInfo)(id);
  const file = t.files.find(f => f.id === fileId);
  if (!file) throw new TBError('That file is no longer in your TorBox.', 'nolink', 0);
  return finish(t, file, direct);
}
