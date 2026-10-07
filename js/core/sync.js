// Everything Streamora remembers lives in one file, "Streamora/streamora-data", in the signed-in Google account's Drive.
// Scope drive.file: Streamora only ever sees files it created (found by appProperties, so renaming/moving is fine),
// and every client of the Google project (web, TV/iPhone app) shares them. localStorage stays the instant
// local copy, so the UI never waits for the network:
// - a change is pushed ~1.5 s later (several quick changes go up together, at most ~8 s apart);
// - other devices' changes come in on start, when the tab comes back, every 45 s while visible, and when back online;
// - "did anything change?" is a tiny metadata call (Drive's file `version`); the file is only downloaded when it did,
//   and only uploaded when something here changed. The file is gzipped JSON.
// Lists and progress merge item by item (newest wins; deletions stick thanks to `sync-base`), see merge().
// Secrets (Real-Debrid key, Trakt tokens) travel in the same private file; newest change wins.
// The active profile, caches and this device's sign-in never sync.
import { store, ls, exportAll, importAll, profiles, settings, getRdKey, saveRdKey, forgetRdKey } from './store.js';
import { addons } from './addons.js';
import { account, accessToken, SignedOut } from './google.js';
import { idbGet, idbSet } from './idb.js';

export const syncState = store('sync-status', { busy: false, last: 0, error: null });
if (syncState.get().busy) syncState.set({ ...syncState.get(), busy: false });
const DEBOUNCE = 1500, MAX_WAIT = 8000, POLL = 45e3, NAME = 'streamora-data';
const TAG = (v) => encodeURIComponent(`appProperties has { key='streamora' and value='${v}' } and trashed=false`);
const API = 'https://www.googleapis.com/drive/v3', UP = 'https://www.googleapis.com/upload/drive/v3';

// ------------------------------------------------------------ merge (pure, tested in tests/integrations.test.mjs)
// what syncs: profiles, addons and every per-profile bucket. Everything else in localStorage is this device's own.
export const syncable = k => k === 'profiles' || k === 'addons' || k.startsWith('p:');
const bucketOf = k => (k.startsWith('p:') ? k.split(':')[2] : k);
// how to identify items of list-like buckets (for union + deletion detection)
const ITEM_KEY = {
  profiles: x => x.id, watchlist: x => x.id, follows: x => x.id, hidden: x => x, addons: x => x.url,
  history: x => `${x.id}|${x.videoId || ''}|${x.at}`, diary: x => `${x.id}|${x.at}`,
  progress: null, // object keyed by meta id, handled separately
};
export const idsOf = (k, v) => {
  const b = bucketOf(k);
  if (b === 'progress') return Object.keys(v || {});
  return ITEM_KEY[b] && Array.isArray(v) ? v.map(ITEM_KEY[b]) : null;
};

function mergeProgress(a = {}, b = {}, base) {
  const out = {};
  for (const id of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[id], y = b[id];
    if (!x || !y) { if (!(base && base.has(id))) out[id] = structuredClone(x || y); continue; } // missing on one side + known before = deleted
    const [newer, older] = (y.updated || 0) > (x.updated || 0) ? [y, x] : [x, y];
    const eps = { ...older.eps };
    for (const [k, e] of Object.entries(newer.eps || {})) if (!eps[k] || (e.at || 0) >= (eps[k].at || 0)) eps[k] = e;
    out[id] = { ...structuredClone(newer), eps: structuredClone(eps) };
  }
  return out;
}
function mergeList(a = [], b = [], keyOf, base, preferB, pickB) {
  const m = new Map();
  const [first, second] = preferB ? [b, a] : [a, b];
  for (const x of first) m.set(keyOf(x), x);
  const inA = new Set(a.map(keyOf)), inB = new Set(b.map(keyOf));
  for (const x of second) {
    const k = keyOf(x);
    if (!m.has(k)) m.set(k, x);
    else if (pickB) m.set(k, (pickB(String(k)) ? b : a).find(y => keyOf(y) === k)); // on both sides: the newer edit of this item wins
  }
  return [...m.entries()].filter(([k]) => (inA.has(k) && inB.has(k)) || !(base && base.has(k))).map(([, x]) => x);
}

// Per-item edit times ("stamps") so a later change to one item/setting on another device can't undo this one.
// A bundle carries stamps: {lsKey: {itemId | settingName: at}}; bundles saved before this have none and fall back to the bundle's `at`.
const hash = v => { const s = JSON.stringify(v) ?? ''; let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) | 0; return h; };
const stamped = k => syncable(k) && !['progress', 'history', 'diary', 'hidden'].includes(bucketOf(k));
const plain = v => !!v && typeof v === 'object' && !Array.isArray(v);
const parts = (k, v) => {
  if (Array.isArray(v) && ITEM_KEY[bucketOf(k)]) return v.map(x => [String(ITEM_KEY[bucketOf(k)](x)), x]);
  return plain(v) ? Object.entries(v) : [['', v]];
};
const stampOf = (bundle, k, id) => (bundle.stamps ? (bundle.stamps[k] || {})[id] || 0 : bundle.at || 0);

/** Like merge(), also returning the merged per-item stamps: { data, stamps }. */
export function mergeFull(local, remote, base = null) {
  const out = {}, stamps = {};
  const remoteNewer = (remote.at || 0) > (local.at || 0);
  for (const k of new Set([...Object.keys(local.data), ...Object.keys(remote.data || {})])) {
    if (!syncable(k)) continue;
    const a = local.data[k], b = (remote.data || {})[k];
    if (a === undefined || b === undefined) out[k] = structuredClone(a === undefined ? b : a);
    else {
      const bk = bucketOf(k), known = base && base[k] ? new Set(base[k]) : null;
      const pickB = id => { const la = stampOf(local, k, id), ra = stampOf(remote, k, id); return ra !== la ? ra > la : remoteNewer; };
      if (bk === 'progress') out[k] = mergeProgress(a, b, known);
      else if (ITEM_KEY[bk] && Array.isArray(a) && Array.isArray(b)) {
        let list = mergeList(a, b, ITEM_KEY[bk], known, remoteNewer, stamped(k) ? pickB : null);
        if (bk === 'history' || bk === 'diary') list = list.sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, 2000);
        out[k] = structuredClone(list);
      } else if (stamped(k) && plain(a) && plain(b)) {
        const o = {};
        for (const f of new Set([...Object.keys(a), ...Object.keys(b)])) o[f] = structuredClone(!(f in b) ? a[f] : !(f in a) ? b[f] : pickB(f) ? b[f] : a[f]);
        out[k] = o;
      } else out[k] = structuredClone(pickB('') ? b : a);
    }
    if (stamped(k)) {
      const st = {};
      for (const [id] of parts(k, out[k])) { const t = Math.max(stampOf(local, k, id), stampOf(remote, k, id)); if (t) st[id] = t; }
      if (Object.keys(st).length) stamps[k] = st;
    }
  }
  return { data: out, stamps };
}

/**
 * local/remote = { at: last change time, data: {lsKey: value}, stamps? }; base = {lsKey: [ids]} from the last sync (or null).
 * Lists and progress merge item by item (newest wins, deletions since `base` stick); profile/addon items, settings fields and
 * other values are resolved per item/field by their own edit time (stamps), falling back to the newer bundle.
 */
export function merge(local, remote, base = null) { return mergeFull(local, remote, base).data; }

// This device's own stamps, kept in ls 'sync-stamps' as {key: {id: {h: hash, at}}}: an item whose hash changed was edited now.
function stampKey(k, v, stored, at) {
  if (!stamped(k) || v === undefined || v === null) return;
  const cur = stored[k], next = {};
  for (const [id, x] of parts(k, v)) { const h = hash(x), o = cur && cur[id]; next[id] = !o ? { h, at: cur ? at : 0 } : o.h === h ? o : { h, at }; }
  stored[k] = next;
}
function stampsOf(stored) {
  const out = {};
  for (const [k, items] of Object.entries(stored)) {
    const st = {};
    for (const [id, o] of Object.entries(items)) if (o.at) st[id] = o.at;
    if (Object.keys(st).length) out[k] = st;
  }
  return out;
}
function adoptStamps(data, stamps) { // after a merge was written locally: the winners keep their times
  const stored = ls.get('sync-stamps', {});
  for (const [k, v] of Object.entries(data)) {
    if (!stamped(k)) continue;
    stored[k] = Object.fromEntries(parts(k, v).map(([id, x]) => [id, { h: hash(x), at: (stamps[k] || {})[id] || 0 }]));
  }
  ls.set('sync-stamps', stored);
}

/**
 * Secrets: { rd: {v: key|null, at}, trakt: {profileId: token|{off:true}, with `at`} }. Newest `at` wins per entry;
 * a tie goes to b (Drive's copy), so two devices that never stamped their key settle on one instead of ping-ponging.
 */
export function mergeSecrets(a = {}, b = {}) {
  const pick = (x, y) => (!x ? y : !y ? x : (y.at || 0) >= (x.at || 0) ? y : x);
  const ta = a.trakt || {}, tb = b.trakt || {}, trakt = {};
  for (const id of new Set([...Object.keys(ta), ...Object.keys(tb)])) trakt[id] = pick(ta[id], tb[id]);
  return { rd: pick(a.rd, b.rd) || { v: null, at: 0 }, trakt };
}
const baseOf = data => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, idsOf(k, v)]).filter(([, v]) => v));
const canon = d => JSON.stringify(Object.keys(d || {}).sort().map(k => [k, d[k]]));

// ------------------------------------------------------------ local side
const localBundle = () => {
  const at = ls.get('sync-changed', 0), data = Object.fromEntries(Object.entries(exportAll().data).filter(([k]) => syncable(k)));
  const stored = ls.get('sync-stamps', {});
  for (const [k, v] of Object.entries(data)) stampKey(k, v, stored, at || Date.now());
  ls.set('sync-stamps', stored);
  return { at, data, stamps: stampsOf(stored) };
};
async function localSecrets() {
  const v = await getRdKey();
  const trakt = {};
  for (const p of profiles.get()) { const t = await idbGet(`trakt:${p.id}`); if (t) trakt[p.id] = t; }
  if (v && !ls.get('rdkey-at', 0)) ls.set('rdkey-at', 1); // key from before Drive: older than any real change
  return { rd: { v: v || null, at: ls.get('rdkey-at', 0) }, trakt };
}

let applying = 0; // remote changes being written locally: don't count them as local edits
// `data` is already the merged result, so it overwrites (a union here would bring deleted items back)
function apply(data) {
  applying++;
  try { importAll({ app: 'streamora', data }, { merge: false }); addons._refresh(); settings._refresh(); } finally { applying--; }
}
async function applySecrets(next, cur) {
  applying++;
  try {
    if (next.rd.v !== cur.rd.v) {
      if (next.rd.v) await saveRdKey(next.rd.v, next.rd.at);
      else if (next.rd.at) { forgetRdKey(true); ls.set('rdkey-at', next.rd.at); }
    }
    let traktChanged = false;
    for (const [pid, t] of Object.entries(next.trakt)) {
      if (canon(t) !== canon(cur.trakt[pid])) { await idbSet(`trakt:${pid}`, t); traktChanged = true; }
    }
    if (traktChanged) { const { traktRev } = await import('./trakt.js'); traktRev.set(traktRev.get() + 1); }
  } finally { applying--; }
}

// ------------------------------------------------------------ Drive
class HttpError extends Error { constructor(r, what) { super(`${what}: Google Drive said ${r.status}`); this.status = r.status; } }
async function drive(url, opts = {}, tries = 0) {
  const r = await fetch(url, { ...opts, headers: { ...opts.headers, Authorization: `Bearer ${await accessToken(tries > 0 && opts._401)}` } });
  if (r.status === 401 && tries === 0) return drive(url, { ...opts, _401: true }, 1);
  if ((r.status === 429 || r.status >= 500) && tries < 2) { await new Promise(res => setTimeout(res, 800 * (tries + 1))); return drive(url, opts, tries + 1); }
  return r;
}
async function fileMeta() {
  const id = ls.get('gd-file', null);
  if (id) {
    const r = await drive(`${API}/files/${id}?fields=id,version`);
    if (r.ok) return r.json();
    if (r.status !== 404) throw new HttpError(r, 'Checking for changes');
  }
  const r = await drive(`${API}/files?q=${TAG('data')}&orderBy=createdTime&pageSize=10&fields=files(id,version)`);
  if (!r.ok) throw new HttpError(r, 'Looking for your data');
  const f = (await r.json()).files[0] || null; // two devices racing to create it: everyone settles on the oldest
  ls.set('gd-file', f && f.id);
  return f;
}

const gz = typeof CompressionStream !== 'undefined';
const pipe = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());
async function encode(obj) {
  const raw = new TextEncoder().encode(JSON.stringify(obj));
  if (gz) { try { return await pipe(raw, new CompressionStream('gzip')); } catch {} }
  return raw;
}
async function decode(buf) {
  let b = new Uint8Array(buf);
  if (b[0] === 0x1f && b[1] === 0x8b) b = await pipe(b, new DecompressionStream('gzip'));
  const j = JSON.parse(new TextDecoder().decode(b));
  if (!j || j.app !== 'streamora' || typeof j.data !== 'object') throw new Error('The Streamora file in your Drive is damaged.');
  return j;
}
async function download(id) {
  const r = await drive(`${API}/files/${id}?alt=media`, { cache: 'no-store' });
  if (!r.ok) throw new HttpError(r, 'Downloading your data');
  return decode(await r.arrayBuffer());
}
/** The "Streamora" folder the data file goes in (made on first save). */
async function folder() {
  const r = await drive(`${API}/files?q=${TAG('folder')}&orderBy=createdTime&pageSize=1&fields=files(id)`);
  if (!r.ok) throw new HttpError(r, 'Looking for the Streamora folder');
  const f = (await r.json()).files[0];
  if (f) return f.id;
  const c = await drive(`${API}/files?fields=id`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Streamora', mimeType: 'application/vnd.google-apps.folder', appProperties: { streamora: 'folder' } }) });
  if (!c.ok) throw new HttpError(c, 'Making the Streamora folder');
  return (await c.json()).id;
}
async function upload(id, bundle) {
  const bytes = await encode(bundle);
  let r;
  if (id) {
    r = await drive(`${UP}/files/${id}?uploadType=media&fields=id,version`, { method: 'PATCH', headers: { 'Content-Type': 'application/octet-stream' }, body: bytes });
  } else {
    const meta = { name: NAME, parents: [await folder()], mimeType: 'application/octet-stream', appProperties: { streamora: 'data' }, description: 'Streamora keeps your profiles, watchlists and progress here. Leave it be: deleting it removes them from every device.' };
    const b = 'streamora' + Math.random().toString(36).slice(2);
    const body = new Blob([`--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: application/octet-stream\r\n\r\n`, bytes, `\r\n--${b}--`]);
    r = await drive(`${UP}/files?uploadType=multipart&fields=id,version`, { method: 'POST', headers: { 'Content-Type': `multipart/related; boundary=${b}` }, body });
  }
  if (!r.ok) throw new HttpError(r, 'Saving to Drive');
  return r.json();
}

/** Deletes Streamora's file from Drive (Settings → Privacy). */
export async function deleteDriveData() {
  const f = await fileMeta();
  if (f) { const r = await drive(`${API}/files/${f.id}`, { method: 'DELETE' }); if (!r.ok && r.status !== 404) throw new HttpError(r, 'Deleting'); }
  for (const k of ['gd-file', 'gd-ver', 'gd-clean', 'sync-base']) ls.del(k);
}

// ------------------------------------------------------------ one sync round
async function run() {
  if (!account.get()) return;
  syncState.set({ ...syncState.get(), busy: true });
  try {
    const meta = await fileMeta();
    const local = localBundle(), sLocal = await localSecrets();
    const dirty = (local.at || 0) > ls.get('gd-clean', -1);
    let push = !meta || dirty, data = local.data, secrets = sLocal, at = local.at || 0, stamps = local.stamps;
    if (meta && meta.version !== ls.get('gd-ver', null)) {
      // someone else saved since we last looked: bring it in, merge, and push the merge back if it differs
      const remote = await download(meta.id);
      // edited here while it downloaded? merge the newest local state instead
      if (ls.get('sync-changed', 0) !== local.at) Object.assign(local, localBundle());
      ({ data, stamps } = mergeFull(local, remote, ls.get('sync-base', null)));
      secrets = mergeSecrets(sLocal, remote.secrets);
      if (canon(data) !== canon(local.data)) apply(data);
      adoptStamps(data, stamps);
      await applySecrets(secrets, sLocal);
      at = Math.max(at, remote.at || 0);
      push = canon(data) !== canon(remote.data) || canon(secrets) !== canon(mergeSecrets(remote.secrets));
    }
    let ver = meta && meta.version;
    if (push) {
      const res = await upload(meta && meta.id, { app: 'streamora', v: 2, at, data, secrets, stamps });
      ls.set('gd-file', res.id);
      ver = res.version;
    }
    ls.set('gd-ver', ver);
    ls.set('gd-clean', local.at || 0); // edits made while this ran keep it dirty, so they go up next round
    ls.set('sync-base', baseOf(data));
    syncState.set({ busy: false, last: Date.now(), error: null });
  } catch (e) {
    const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
    syncState.set({ ...syncState.get(), busy: false, error: e instanceof SignedOut ? null : offline ? 'Offline. Changes are kept here and saved when you\'re back.' : (e.message || String(e)) });
  }
  if (ls.get('sync-changed', 0) > ls.get('gd-clean', -1)) schedule(DEBOUNCE);
}
let running = null, again = false;
/** Runs a sync round now (or right after the current one). Resolves when this device is in step with Drive. */
export function syncNow() {
  if (running) { again = true; return running; }
  running = run().finally(() => { running = null; if (again) { again = false; syncNow(); } });
  return running;
}
export const syncPending = () => !!timer || !!running || ls.get('sync-changed', 0) > ls.get('gd-clean', -1);

// ------------------------------------------------------------ when to sync
let timer = null, firstChange = 0;
function schedule(ms) {
  if (!account.get()) return;
  const now = Date.now();
  if (!timer) firstChange = now;
  clearTimeout(timer);
  timer = setTimeout(() => { timer = null; syncNow(); }, Math.max(0, Math.min(ms, firstChange + MAX_WAIT - now)));
}
function changed(key) {
  if (applying) return;
  const now = Date.now();
  if (key && stamped(key)) { const stored = ls.get('sync-stamps', {}); stampKey(key, ls.get(key, null), stored, now); ls.set('sync-stamps', stored); }
  ls.set('sync-changed', now);
  schedule(DEBOUNCE);
}
let lastPull = 0;
function pull() {
  if (!account.get() || document.visibilityState !== 'visible' || Date.now() - lastPull < 5e3) return;
  lastPull = Date.now();
  syncNow();
}

let started = false;
export async function initSync() {
  if (started) return;
  started = true;
  // every store write announces its key (store.js); the key and Trakt tokens count too
  addEventListener('streamora:changed', e => (syncable(e.detail) || e.detail === 'rdkey-state' || e.detail === 'trakt-rev') && changed(e.detail));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') pull();
    else if (timer) { clearTimeout(timer); timer = null; syncNow(); } // leaving: save now while the page still runs
  });
  addEventListener('online', () => { lastPull = 0; pull(); });
  setInterval(pull, POLL);
  account.subscribe(a => { if (a) syncNow(); });
  if (account.get()) syncNow();
}
