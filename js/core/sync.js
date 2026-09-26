// Passphrase sync: every device that knows the passphrase shares one encrypted blob in /api/sync.
// passphrase -> PBKDF2 (310k, SHA-256) -> 512 bits: first half hashed = blob id, second half = AES-GCM key.
// Only the derived id + non-extractable AES key are kept (IndexedDB); the passphrase is never stored.
// The server only ever sees ciphertext. The RD key, Trakt tokens and this device's active profile never sync.
import {
  store, ls, exportAll, importAll, profiles, watchlist, progress, history, diary, follows, hidden, settings,
} from './store.js';
import { addons } from './addons.js';

export const syncState = store('sync-status', { on: false, ver: 0, last: 0, error: null, busy: false });
const PUSH_DELAY = 30e3;
const SALT = 'streamora-sync-v1';
const ITER = 310000;

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

// ------------------------------------------------------------ crypto
const enc = s => new TextEncoder().encode(s);
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
const b64 = buf => { let s = ''; new Uint8Array(buf).forEach(b => (s += String.fromCharCode(b))); return btoa(s); };
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
const through = async (bytes, stream) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(stream)).arrayBuffer());

export async function deriveKeys(pass, iterations = ITER) {
  const km = await crypto.subtle.importKey('raw', enc(pass.normalize('NFKC')), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: enc(SALT), iterations }, km, 512));
  const id = hex(await crypto.subtle.digest('SHA-256', bits.slice(0, 32)));
  const aes = await crypto.subtle.importKey('raw', bits.slice(32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { id, aes };
}
export async function seal(aes, obj) {
  let raw = enc(JSON.stringify(obj)), tag = 'p';
  if (typeof CompressionStream !== 'undefined') { raw = await through(raw, new CompressionStream('gzip')); tag = 'z'; }
  const iv = crypto.getRandomValues(new Uint8Array(12));
  return { iv: b64(iv), ct: tag + '.' + b64(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, aes, raw)) };
}
export async function open(aes, { iv, ct }) {
  let raw = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, aes, unb64(ct.slice(2))));
  if (ct[0] === 'z') raw = await through(raw, new DecompressionStream('gzip'));
  return JSON.parse(new TextDecoder().decode(raw));
}

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
const url = id => `/api/sync/${id}`;
let cred = null;
async function getCred() { return cred || (cred = await idbGet('sync')); }
const localBundle = () => ({ at: ls.get('sync-changed', 0), data: Object.fromEntries(Object.entries(exportAll().data).filter(([k]) => syncable(k))) });

let applying = false;
function apply(data) {
  applying = true;
  try { importAll({ app: 'streamora', data }, { merge: true }); addons._refresh(); settings._refresh(); } finally { applying = false; }
}
async function explain(r) {
  if (r.status === 501) return new Error("Sync isn't set up on this server yet (see DEPLOY.md).");
  if (r.status === 413) return new Error('Too much data to sync (512 KB max).');
  return new Error(`Sync server said ${r.status}`);
}
async function pull(c) {
  const r = await fetch(url(c.id), { cache: 'no-store' });
  if (r.status === 404) return null;
  if (!r.ok) throw await explain(r);
  const blob = await r.json();
  try { return { ver: blob.ver, ...(await open(c.aes, blob)) }; } catch { throw new Error("Couldn't decrypt the synced data. Wrong passphrase?"); }
}
async function put(c, ver, bundle, keepalive = false) {
  const body = JSON.stringify(await seal(c.aes, bundle));
  return fetch(url(c.id), { method: 'PUT', headers: { 'Content-Type': 'application/json', 'If-Match': String(ver) }, body, keepalive: keepalive && body.length < 60e3 });
}

async function run() {
  const c = await getCred();
  if (!c) return syncState.set({ ...syncState.get(), on: false });
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
    syncState.set({ ...syncState.get(), busy: false, error: e.message || String(e) });
  }
}
let running = null;
export const syncNow = () => running || (running = run().finally(() => { running = null; }));

// ------------------------------------------------------------ public API + listeners
export async function setPassphrase(pass) {
  if (!pass || pass.length < 12) throw new Error('Use at least 12 characters. Longer is better; a few random words work well.');
  const k = await deriveKeys(pass);
  await idbSet('sync', k);
  cred = k;
  ls.del('sync-base');
  return syncNow();
}
export async function forgetSync() {
  cred = null; clearTimeout(timer); timer = null;
  await idbDel('sync');
  ls.del('sync-base');
  syncState.set({ on: false, ver: 0, last: 0, error: null, busy: false });
}

let timer = null;
function changed() {
  if (applying) return;
  ls.set('sync-changed', Date.now());
  if (cred && !timer) timer = setTimeout(() => { timer = null; syncNow(); }, PUSH_DELAY);
}
async function flush() {
  if (!timer || !cred) return;
  clearTimeout(timer); timer = null;
  // best effort while the page goes away; a 409 here is fine, the next start pulls + merges + pushes
  try { await put(cred, syncState.get().ver, localBundle(), true); } catch {}
}

let started = false;
export async function initSync() {
  if (started) return;
  started = true;
  for (const s of [profiles, watchlist, progress, history, diary, follows, hidden, settings, addons]) s.subscribe(changed);
  addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => (document.visibilityState === 'visible' ? cred && syncNow() : flush()));
  if (await getCred()) syncNow();
  else if (syncState.get().on) syncState.set({ ...syncState.get(), on: false });
}
