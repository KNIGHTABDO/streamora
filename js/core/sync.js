// Zero-setup sync: whenever a Real-Debrid key is set, this device shares one blob in /api/sync with every
// other device signed in to the same RD account. The server checks the key with RD and keys the blob by the RD user id
// (encrypted at rest when the server has SYNC_SECRET). No KV on the server (501) -> sync quietly stays off.
// The RD key, Trakt tokens and this device's active profile never sync.
import {
  store, ls, exportAll, importAll, profiles, watchlist, progress, history, diary, follows, hidden, settings, getRdKey, keyStore,
} from './store.js';
import { addons } from './addons.js';

export const syncState = store('sync-status', { on: false, ver: 0, last: 0, error: null, busy: false });
const PUSH_DELAY = 30e3;

// ------------------------------------------------------------ tiny IndexedDB (also used by trakt.js)
const DB = 'streamora-integrations';
function idb(mode, fn) {
  return new Promise((res, rej) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('k');
    open.onerror = () => rej(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('k', mode);
      const req = fn(tx.objectStore('k'));
      tx.oncomplete = () => { open.result.close(); res(req && req.result); };
      tx.onerror = () => rej(tx.error);
    };
  });
}
export const idbGet = k => idb('readonly', s => s.get(k)).catch(() => null);
export const idbSet = (k, v) => idb('readwrite', s => s.put(v, k));
export const idbDel = k => idb('readwrite', s => s.delete(k)).catch(() => {});

// ------------------------------------------------------------ merge (pure, tested in tests/integrations.test.mjs)
export const syncable = k => !(k === 'activeProfile' || k.startsWith('rdkey') || k.startsWith('sync') || k.startsWith('trakt'));
const bucketOf = k => (k.startsWith('p:') ? k.split(':')[2] : k);
// how to identify items of list-like buckets (for union + deletion detection)
const ITEM_KEY = {
  profiles: x => x.id, watchlist: x => x.id, follows: x => x.id, hidden: x => x,
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
function mergeList(a = [], b = [], keyOf, base, preferB) {
  const m = new Map();
  const [first, second] = preferB ? [b, a] : [a, b];
  for (const x of first) m.set(keyOf(x), x);
  const inA = new Set(a.map(keyOf)), inB = new Set(b.map(keyOf));
  for (const x of second) if (!m.has(keyOf(x))) m.set(keyOf(x), x);
  return [...m.entries()].filter(([k]) => (inA.has(k) && inB.has(k)) || !(base && base.has(k))).map(([, x]) => x);
}

/**
 * local/remote = { at: last change time, data: {lsKey: value} }; base = {lsKey: [ids]} from the last sync (or null).
 * Lists and progress merge item by item (newest wins, deletions since `base` stick); anything else: newer bundle wins.
 */
export function merge(local, remote, base = null) {
  const out = {};
  const remoteNewer = (remote.at || 0) > (local.at || 0);
  for (const k of new Set([...Object.keys(local.data), ...Object.keys(remote.data)])) {
    if (!syncable(k)) continue;
    const a = local.data[k], b = remote.data[k];
    if (a === undefined || b === undefined) { out[k] = structuredClone(a === undefined ? b : a); continue; }
    const bk = bucketOf(k), known = base && base[k] ? new Set(base[k]) : null;
    if (bk === 'progress') out[k] = mergeProgress(a, b, known);
    else if (ITEM_KEY[bk] && Array.isArray(a) && Array.isArray(b)) {
      let list = mergeList(a, b, ITEM_KEY[bk], known, remoteNewer);
      if (bk === 'history' || bk === 'diary') list = list.sort((x, y) => (y.at || 0) - (x.at || 0)).slice(0, 2000);
      out[k] = structuredClone(list);
    } else out[k] = structuredClone(remoteNewer ? b : a);
  }
  return out;
}
const baseOf = data => Object.fromEntries(Object.entries(data).map(([k, v]) => [k, idsOf(k, v)]).filter(([, v]) => v));
const canon = d => JSON.stringify(Object.keys(d).sort().map(k => [k, d[k]]));

// ------------------------------------------------------------ push / pull
const URL_ = '/api/sync';
let off = false; // server has no KV: stop trying until reload
const localBundle = () => ({ at: ls.get('sync-changed', 0), data: Object.fromEntries(Object.entries(exportAll().data).filter(([k]) => syncable(k))) });

let applying = false;
function apply(data) {
  applying = true;
  try { importAll({ app: 'streamora', data }, { merge: true }); addons._refresh(); settings._refresh(); } finally { applying = false; }
}
class Off extends Error {}
function explain(r) {
  if (r.status === 501) return new Off();
  if (r.status === 401) return new Error('Real-Debrid did not accept your key, so sync is paused.');
  if (r.status === 413) return new Error('Too much data to sync (512 KB max).');
  return new Error(`Sync server said ${r.status}`);
}
const auth = key => ({ Authorization: `Bearer ${key}` });
async function pull(key) {
  const r = await fetch(URL_, { cache: 'no-store', headers: auth(key) });
  if (r.status === 404) return null;
  if (!r.ok) throw explain(r);
  const j = await r.json();
  return { ver: j.ver, ...j.data };
}
function put(key, ver, bundle, keepalive = false) {
  const body = JSON.stringify({ data: bundle });
  return fetch(URL_, { method: 'PUT', headers: { ...auth(key), 'Content-Type': 'application/json', 'If-Match': String(ver) }, body, keepalive: keepalive && body.length < 60e3 });
}

async function run() {
  const c = !off && await getRdKey();
  if (!c) return syncState.set({ ...syncState.get(), on: false, busy: false });
  syncState.set({ ...syncState.get(), on: true, busy: true });
  try {
    for (let tries = 0; ; tries++) {
      const remote = await pull(c);
      const local = localBundle();
      let data = local.data;
      if (remote) {
        data = merge(local, remote, ls.get('sync-base', null));
        if (canon(data) !== canon(local.data)) apply(data);
      }
      const at = Math.max(local.at || 0, (remote && remote.at) || 0);
      let ver = remote ? remote.ver : 0;
      if (!remote || canon(data) !== canon(remote.data)) {
        const r = await put(c, ver, { at, data });
        if (r.status === 409 && tries < 3) continue; // someone pushed in between: pull, merge, push again
        if (!r.ok) throw await explain(r);
        ver = (await r.json()).ver;
      }
      ls.set('sync-base', baseOf(data));
      syncState.set({ on: true, ver, last: Date.now(), error: null, busy: false });
      return;
    }
  } catch (e) {
    if (e instanceof Off) { off = true; return syncState.set({ on: false, ver: 0, last: 0, error: null, busy: false }); }
    syncState.set({ ...syncState.get(), busy: false, error: e.message || String(e) });
  }
}
let running = null;
export const syncNow = () => running || (running = run().finally(() => { running = null; }));

// ------------------------------------------------------------ listeners
const enabled = () => !off && keyStore.get().set;
let timer = null;
function changed() {
  if (applying) return;
  ls.set('sync-changed', Date.now());
  if (enabled() && !timer) timer = setTimeout(() => { timer = null; syncNow(); }, PUSH_DELAY);
}
async function flush() {
  if (!timer || !enabled()) return;
  clearTimeout(timer); timer = null;
  // best effort while the page goes away; a 409 here is fine, the next start pulls + merges + pushes
  try { const k = await getRdKey(); if (k) await put(k, syncState.get().ver, localBundle(), true); } catch {}
}

let started = false;
export async function initSync() {
  if (started) return;
  started = true;
  for (const s of [profiles, watchlist, progress, history, diary, follows, hidden, settings, addons]) s.subscribe(changed);
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? enabled() && syncNow() : flush()));
  // key added -> sync (a new account starts from a fresh base); key removed -> off
  keyStore.subscribe(k => { ls.del('sync-base'); if (k.set) { off = false; syncNow(); } else syncState.set({ on: false, ver: 0, last: 0, error: null, busy: false }); });
  if (enabled()) syncNow();
  else if (syncState.get().on) syncState.set({ ...syncState.get(), on: false });
}
