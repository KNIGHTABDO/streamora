// TorBox client. All calls go through our same-origin relay (/api/tb/*).
import { mark } from '../lib/perf-mark.js';
import { selectVideoFile, sourceIssue, contentError } from '../lib/source-identity.js';
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
const NOWEB = 'tb-noweb'; // streaming refusals indexed by a key digest
const abort = signal => { if (signal?.aborted) throw new DOMException('Aborted', 'AbortError'); };
const sleep = (ms, signal) => new Promise((resolve, reject) => {
  abort(signal);
  const t = setTimeout(() => { signal?.removeEventListener('abort', stop); resolve(); }, ms);
  const stop = () => { clearTimeout(t); reject(new DOMException('Aborted', 'AbortError')); };
  signal?.addEventListener('abort', stop, { once: true });
});
let account = '', lastKey;
async function accountScope() {
  const key = await getTbKey();
  if (lastKey !== key) {
    const digest = globalThis.crypto?.subtle && await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key || ''));
    // No shared persistent account choices on older TV browsers without WebCrypto.
    account = digest ? Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') : 'session-' + Date.now() + '-' + Math.random().toString(36).slice(2);
    lastKey = key;
  }
  return account;
}
const knownLists = new Map();
export async function knownTorrents() {
  const hit = knownLists.get(await accountScope());
  return hit && Date.now() - hit.at < 600e3 ? hit.list : null;
}

export async function tb(path, { method = 'GET', json, form, data, key, retry = true, signal } = {}) {
  abort(signal);
  key = key || await getTbKey();
  abort(signal);
  if (!key) throw new TBError('No TorBox key set.', 'nokey', 0);
  const init = { method, signal, headers: { Authorization: `Bearer ${key}` } };
  if (json) { init.body = JSON.stringify(json); init.headers['Content-Type'] = 'application/json'; }
  if (form) { init.body = new URLSearchParams(form); init.headers['Content-Type'] = 'application/x-www-form-urlencoded'; }
  if (data) init.body = data; // FormData: the browser writes the boundary
  let r;
  try { r = await fetchT(`/api/tb/${path}`, init, 20000, 'TorBox', async r => ({ status: r.status, ok: r.ok, headers: r.headers, text: await r.text() })); }
  catch (e) { abort(signal); throw e.code === 'timeout' ? new TBError(e.message, 'timeout', 0) : new TBError('Could not reach the relay. Are you offline?', 'network', 0); }
  mark('play:tb:' + path.split('?')[0].split('/').pop());
  if (path.split('?')[0].endsWith('/checkcached')) mark('play:checkcached');
  if (r.status === 429 && retry) {
    await sleep(Math.min(10, +r.headers.get('Retry-After') || 2) * 1000, signal);
    return tb(path, { method, json, form, data, key, signal, retry: false });
  }
  const text = r.text;
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
const list = async (base, kind, page, limit, signal) => {
  const d = await tb(`${base}/mylist?${q({ bypass_cache: true, limit, offset: (page - 1) * limit })}`, { signal });
  return (Array.isArray(d) ? d : []).map(t => normalize(t, kind));
};
export const torrents = async (page = 1, limit = 100, { signal } = {}) => {
  const scope = await accountScope();
  const rows = await list('torrents', 'torrent', page, limit, signal);
  if (page === 1 && limit >= 100 && !signal?.aborted) knownLists.set(scope, { at: Date.now(), list: rows });
  return rows;
};
export const webDownloads = (page = 1, limit = 100) => list('webdl', 'web', page, limit);
export const torrentInfo = async (id, { signal } = {}) => normalize(await tb(`torrents/mylist?${q({ bypass_cache: true, id })}`, { signal }));
export const webInfo = async (id, { signal } = {}) => normalize(await tb(`webdl/mylist?${q({ bypass_cache: true, id })}`, { signal }), 'web');
export const deleteTorrent = id => tb('torrents/controltorrent', { method: 'POST', json: { torrent_id: id, operation: 'delete' } });
export const deleteWeb = id => tb('webdl/controlwebdownload', { method: 'POST', json: { webdl_id: id, operation: 'delete' } });

const createTorrent = (fields, signal) => {
  const f = new FormData();
  Object.entries({ seed: 3, allow_zip: false, ...fields }).forEach(([k, v]) => f.append(k, v));
  return tb('torrents/createtorrent', { method: 'POST', data: f, signal });
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
export async function checkCached(hashes, { signal } = {}) {
  const out = new Set();
  try {
    const batches = [];
    for (let i = 0; i < hashes.length; i += 100) batches.push(hashes.slice(i, i + 100));
    const worker = async () => {
      for (let b; (b = batches.shift());) {
        const d = await tb(`torrents/checkcached?${q({ format: 'object', list_files: false })}`, { method: 'POST', json: { hashes: b }, signal });
        Object.keys(d || {}).forEach(h => out.add(h.toLowerCase()));
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    return out;
  } catch (e) { abort(signal); if (e.code === 'badkey' || e.code === 'nokey') throw e; return null; }
}

const SAMPLE_RE = /(^|[\W_])(sample|trailer|featurette|extras?)([\W_]|$)/i;
export const VIDEO_RE = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|flv|mpg|mpeg)$/i;
export const videoFiles = t => t.files.filter(f => VIDEO_RE.test(f.path) && !SAMPLE_RE.test(f.path));

export function pickFile(files, args) {
  return selectVideoFile(files, args);
}

// ---- web playback: direct browser files, TorBox HLS, or client-side MKV remuxing
const mkvFile = name => /\.mkv$/i.test(name || '');
const browserFile = name => /\.(mp4|m4v|webm)$/i.test(name || '');
const hevc = name => /x265|hevc|h\.?265/i.test(name || '');
/** true once TorBox told this key's plan it has no browser streaming (remembered for a week, then asked again, so a plan upgrade is noticed).
 *  Before the key digest is known (a fresh page load), any recent refusal counts. */
const refusals = () => { const m = ls.get(NOWEB, {}); return typeof m === 'number' ? { legacy: m } : m && typeof m === 'object' ? m : {}; };
export const webStreamingRefused = () => {
  const m = refusals(), fresh = at => Date.now() - (+at || 0) < 7 * 864e5;
  return account ? fresh(m[account]) : Object.values(m).some(fresh);
};
const webPlanError = () => new TBError("This file's format can't play in this browser. Pick another source, or play it in the Streamora app.", 'webplan', 0);

async function webHls(id, fileId, kind, signal) {
  await accountScope();
  abort(signal);
  if (webStreamingRefused()) return null;
  try {
    const d = await tb(`stream/createstream?${q({ id, file_id: fileId, type: kind, chosen_subtitle_index: null })}`, { signal });
    const u = d && d.hls_url;
    return u ? { original: u } : null;
  } catch (e) {
    abort(signal);
    if (/not allowed|upgrade|PLAN_RESTRICTED/i.test(`${e.message} ${e.code}`)) { const m = refusals(); delete m.legacy; ls.set(NOWEB, { ...m, [account]: Date.now() }); }
    if (e.code === 'badkey') throw e;
    return null;
  }
}

async function finish(t, file, direct, signal, providedUrl) {
  abort(signal);
  const kind = t.kind;
  let hls = null;
  if (!direct && (!browserFile(file.path) || hevc(file.path))) {
    hls = await webHls(t.id, file.id, kind, signal);
    if (!hls && !browserFile(file.path) && !(mkvFile(file.path) && canRemuxMkv())) throw webPlanError();
  }
  const url = providedUrl || await tb(`${kind === 'web' ? 'webdl' : 'torrents'}/requestdl?${q(kind === 'web' ? { web_id: t.id, file_id: file.id } : { torrent_id: t.id, file_id: file.id })}`, { signal });
  if (!url) throw new TBError('TorBox has no link for this file. Pick another source.', 'nolink', 0);
  return { downloadId: `${t.id}:${file.id}`, filename: file.path.split('/').pop(), filesize: file.bytes, direct: url, torrentId: t.id, mime: file.mime, hls, remux: !direct && !hls && mkvFile(file.path) };
}

const resolveCache = scope => ls.get('resolved:' + scope, {});
function remember(scope, k, v) {
  const c = resolveCache(scope); c[k] = { ...v, at: Date.now() };
  Object.keys(c).sort((a, b) => c[b].at - c[a].at).slice(200).forEach(x => delete c[x]); // keep the newest 200
  ls.set('resolved:' + scope, c);
}

async function findInAccount(h, signal) {
  for (let page = 1; page <= 3; page++) {
    const batch = await torrents(page, 500, { signal });
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
export async function resolveStream({ infoHash, fileIdx, filename, season, episode, anime = false, identity, direct = false, known = [], signal, retryMissing = true }, onStep = () => {}) {
  const scope = await accountScope();
  abort(signal);
  infoHash = infoHash.toLowerCase();
  // Do not add a known unsupported format when this plan has already refused streaming.
  if (!direct && webStreamingRefused() && filename && !browserFile(filename) && !(mkvFile(filename) && canRemuxMkv())) throw webPlanError();
  const cacheKey = choiceKey({ infoHash, fileIdx, filename, season, episode });
  const validate = file => {
    const issue = sourceIssue({ filename: file.path }, identity);
    if (issue) throw contentError(issue);
  };
  const prefetched = takePrefetched(scope, cacheKey, direct);
  if (prefetched) {
    validate(prefetched.file);
    const out = await finish(prefetched.t, prefetched.file, direct, signal, prefetched.stream.direct);
    remember(scope, cacheKey, { torrentId: out.torrentId, fileId: prefetched.file.id, filename: out.filename, filesize: out.filesize, mime: out.mime });
    return out;
  }
  const hit = resolveCache(scope)[cacheKey];
  if (hit) {
    validate({ path: hit.filename });
    // links are minted fresh each time; only the file choice is remembered
    try { return await finish({ id: hit.torrentId, kind: 'torrent' }, { id: hit.fileId, path: hit.filename, bytes: hit.filesize, mime: hit.mime }, direct, signal); }
    catch (e) {
      abort(signal);
      if (!missing(e)) throw e;
      const c = resolveCache(scope); delete c[cacheKey]; ls.set('resolved:' + scope, c);
      known = known.filter(t => t.id !== hit.torrentId);
      retryMissing = false;
    }
  }

  onStep('Looking in your TorBox…');
  let t = known.find(t => t.hash?.toLowerCase() === infoHash && t.status === 'downloaded') || known.find(t => t.hash?.toLowerCase() === infoHash && t.status !== 'error') || await findInAccount(infoHash, signal);
  if (!t) {
    onStep('Adding it to your TorBox…');
    const id = addedId(await createTorrent({ magnet: `magnet:?xt=urn:btih:${infoHash}` }, signal));
    t = { id, status: 'queued' };
  }
  for (let i = 0; t.status !== 'downloaded' && i < 6; i++) {
    if (t.status === 'error') throw new TBError('This source failed on TorBox.', 'failed', 0);
    if (i) onStep(t.status === 'downloading' ? `Not cached. TorBox is downloading (${t.progress || 0}%)…` : 'Waiting for TorBox…');
    if (i) await sleep(1000 * i, signal);
    try { t = await torrentInfo(t.id, { signal }); } catch (e) { abort(signal); if (e.code === 'badkey' || e.code === 'network') throw e; }
  }
  if (t.status !== 'downloaded') throw new TBError('This source is not cached yet. TorBox keeps downloading it in the background, so try another source or come back later.', 'notcached', 0);

  const file = pickFile(t.files, { fileIdx, filename, season, episode, anime, identity });
  if (!file) throw contentError('This source has no matching video for the selected title or episode.');
  validate(file);
  onStep('Unlocking the stream…');
  let out;
  try { out = await finish(t, file, direct, signal); }
  catch (e) {
    abort(signal);
    if (!retryMissing || !missing(e)) throw e;
    return resolveStream({ infoHash, fileIdx, filename, season, episode, anime, identity, direct, signal, known: [], retryMissing: false }, onStep);
  }
  remember(scope, cacheKey, { torrentId: t.id, fileId: file.id, filename: out.filename, filesize: out.filesize, mime: out.mime });
  return out;
}

const missing = e => e.status === 404 || e.code === 'nolink' || /not[ _-]?found|does not exist|invalid.*(torrent|file|id)/i.test(`${e.code} ${e.message}`);
const choiceKey = ({ infoHash, fileIdx, filename, season, episode }) => ['tb2', infoHash.toLowerCase(), fileIdx ?? '', filename || '', season ?? '', episode ?? ''].join('|');
const prefetchedLinks = new Map();
const takePrefetched = (scope, key, direct) => {
  const k = `${scope}|${direct}|${key}`, hit = prefetchedLinks.get(k);
  prefetchedLinks.delete(k);
  return hit && Date.now() - hit.at < 300e3 ? hit : null;
};
/** Strict next-episode selection: pickFile's largest-file fallback is not safe for speculation. */
export function ownedFile(t, args) {
  if (!t || t.status !== 'downloaded' || t.hash?.toLowerCase() !== args.infoHash?.toLowerCase()) return null;
  const file = pickFile(t.files || [], args);
  if (!file || sourceIssue({ filename: file.path }, args.identity)) return null;
  if (args.filename && file.path.split('/').pop().toLowerCase() === args.filename.split('/').pop().toLowerCase()) return file;
  if (args.episode != null) {
    const re = args.season != null
      ? new RegExp(`s0*${args.season}[ ._-]?e0*${args.episode}(?!\\d)|\\b${args.season}x0*${args.episode}(?!\\d)`, 'i')
      : new RegExp(`(?:e|ep|episode|[ _-])0*${args.episode}(?:v\\d)?(?=[ ._\\-\\[\\(]|$)`, 'i');
    if (re.test(file.path.split('/').pop())) return file;
    return null;
  }
  return args.fileIdx != null && file.id === args.fileIdx ? file : null;
}
/** Only requestdl is allowed here: never lookup, add, poll or create a web stream. */
export async function prefetchOwned(args) {
  const { known = [], direct = false, signal } = args;
  const t = known.find(t => ownedFile(t, args));
  const file = t && ownedFile(t, args);
  if (!file) return null;
  const scope = await accountScope();
  abort(signal);
  const stream = await finish(t, file, true, signal);
  abort(signal);
  prefetchedLinks.set(`${scope}|${direct}|${choiceKey(args)}`, { at: Date.now(), stream, t, file });
  if (prefetchedLinks.size > 10) prefetchedLinks.delete(prefetchedLinks.keys().next().value);
  return stream;
}

// Library links are "<torrent id>:<file id>" or "web:<id>:<file id>"
export const libraryRef = (t, f) => `${t.kind === 'web' ? 'web:' : ''}${t.id}:${f.id}`;
export async function resolveLink(ref, { direct = false, signal } = {}) {
  const web = ref.startsWith('web:');
  const [id, fileId] = ref.replace(/^web:/, '').split(':').map(Number);
  const t = await (web ? webInfo : torrentInfo)(id, { signal });
  const file = t.files.find(f => f.id === fileId);
  if (!file) throw new TBError('That file is no longer in your TorBox.', 'nolink', 0);
  return finish(t, file, direct, signal);
}
