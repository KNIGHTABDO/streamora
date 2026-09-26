// Persistence + tiny reactive stores. Everything lives in this browser only.
// - store(key, init): global value persisted in localStorage
// - pstore(bucket, init): per-profile value, swaps automatically when the active profile changes
// - useStore(s): Preact hook that re-renders on change
import { useState, useEffect } from '../../vendor/preact-htm.js';

const NS = 'streamora:';

export const ls = {
  get(k, d) { try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) {
    try { localStorage.setItem(NS + k, JSON.stringify(v)); return true; }
    catch (e) {
      console.warn('streamora: could not save', k, e);
      try { dispatchEvent(new CustomEvent('streamora:quota', { detail: { key: k, error: e } })); } catch {}
      return false;
    }
  },
  del(k) { try { localStorage.removeItem(NS + k); } catch {} },
  keys() { try { return Object.keys(localStorage).filter(k => k.startsWith(NS)).map(k => k.slice(NS.length)); } catch { return []; } },
};

const clone = v => (v && typeof v === 'object' ? structuredClone(v) : v);
// a fresh top-level reference so useStore's setState sees a change even after in-place mutation
const fresh = v => (Array.isArray(v) ? [...v] : v && typeof v === 'object' ? { ...v } : v);

const allStores = [];
function makeStore(keyFn, init) {
  const subs = new Set();
  const UNSET = {};
  let cacheKey = UNSET, cache;
  const s = {
    get() {
      const k = keyFn();
      if (k !== cacheKey) { cacheKey = k; cache = k ? ls.get(k, clone(init)) : clone(init); }
      return cache;
    },
    set(v) {
      const k = keyFn();
      cacheKey = k; cache = v = fresh(v);
      if (k) ls.set(k, v);
      subs.forEach(f => f(v));
    },
    update(fn) { const cur = s.get(); const next = fn(cur); s.set(next === undefined ? cur : next); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    _refresh() { cacheKey = UNSET; const v = s.get(); subs.forEach(f => f(v)); },
    _key: keyFn,
  };
  allStores.push(s);
  return s;
}

// another tab changed something: reload the stores that read that key
try {
  addEventListener('storage', e => {
    if (e.key == null) return allStores.forEach(s => s._refresh()); // localStorage.clear()
    if (!e.key.startsWith(NS)) return;
    const k = e.key.slice(NS.length);
    allStores.filter(s => s._key() === k).forEach(s => s._refresh());
  });
} catch {}

export const store = (key, init) => makeStore(() => key, init);

// ---- profiles ----
export const profiles = store('profiles', []);           // [{id,name,avatar,theme,ink,kids,pin,created}]
export const activeProfileId = store('activeProfile', null);
export const activeProfile = () => profiles.get().find(p => p.id === activeProfileId.get()) || null;

const pstores = [];
export function pstore(bucket, init) {
  const s = makeStore(() => (activeProfileId.get() ? `p:${activeProfileId.get()}:${bucket}` : null), init);
  pstores.push(s);
  return s;
}
activeProfileId.subscribe(() => pstores.forEach(s => s._refresh()));

// Per-profile buckets shared across the app (one definition each, import from here).
export const watchlist = pstore('watchlist', []);   // [{id,type,name,poster,added}]
export const progress  = pstore('progress', {});    // see progress.js
export const history   = pstore('history', []);     // [{id,type,name,poster,videoId,season,episode,at}]
export const diary     = pstore('diary', []);       // [{id,type,name,poster,rating,note,at}]
export const follows   = pstore('follows', []);     // [{id,type,name,poster}] shows followed for the calendar
export const hidden    = pstore('hidden', []);      // meta ids removed from Continue Watching
export const settings  = pstore('settings', {
  quality: 'auto',          // auto | original | high | high_low | medium | medium_low | low | low_low
  subsLang: 'eng', subsSize: 100, subsColor: '#fffbe8', subsBg: .35,
  audioLang: 'eng',
  autoNext: true, autoPlay: true, skipIntroSec: 85,
  nightAuto: true,          // switch to blueprint theme after sunset
  sounds: false, reduceMotion: false,
  cachedOnly: true,
});

export function useStore(s) {
  const [v, setV] = useState(() => s.get());
  useEffect(() => { setV(s.get()); return s.subscribe(setV); }, [s]);
  return v;
}

export const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

// ---- the Real-Debrid key: AES-GCM encrypted in localStorage, with a non-extractable
// CryptoKey kept in IndexedDB so the raw key never sits in storage as plain text.
const IDB = 'streamora-vault';
function idb(mode, fn) {
  return new Promise((res, rej) => {
    const open = indexedDB.open(IDB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore('k');
    open.onerror = () => rej(open.error);
    open.onsuccess = () => {
      const tx = open.result.transaction('k', mode);
      const req = fn(tx.objectStore('k'));
      tx.oncomplete = () => res(req && req.result);
      tx.onerror = () => rej(tx.error);
    };
  });
}
async function vaultKey() {
  let k = await idb('readonly', st => st.get('aes'));
  if (!k) {
    k = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    await idb('readwrite', st => st.put(k, 'aes'));
  }
  return k;
}
const b64 = buf => btoa(String.fromCharCode(...new Uint8Array(buf)));
const unb64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));

let keyMem = null;
export const keyStore = store('rdkey-state', { set: false }); // reactive "is a key saved" flag
export async function saveRdKey(plain) {
  keyMem = plain;
  try {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await vaultKey(), new TextEncoder().encode(plain));
    ls.set('rdkey', { v: 1, iv: b64(iv), ct: b64(ct) });
  } catch {
    // ponytail: no IndexedDB/WebCrypto (very old browser / some private modes) -> obfuscated fallback
    ls.set('rdkey', { v: 0, raw: btoa(plain) });
  }
  keyStore.set({ set: true });
}
export async function getRdKey() {
  if (keyMem) return keyMem;
  const rec = ls.get('rdkey', null);
  if (!rec) return null;
  try {
    if (rec.v === 0) return (keyMem = atob(rec.raw));
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(rec.iv) }, await vaultKey(), unb64(rec.ct));
    return (keyMem = new TextDecoder().decode(pt));
  } catch { forgetRdKey(); return null; } // vault key lost (cleared site data / other browser): ask again
}
export function forgetRdKey() {
  keyMem = null; ls.del('rdkey'); keyStore.set({ set: false });
  try { indexedDB.deleteDatabase(IDB); } catch {}
}
if (ls.get('rdkey', null)) keyStore.set({ set: true });

// ---- backup / sync: everything except the key ----
// exportAll({onlyProfile}) -> {app:'streamora', v:1, at, data:{[lsKey]: value}}
// importAll(bundle, {merge=true}): merge=true merges per key (see mergeValue); merge=false overwrites.
// js/core/sync.js relies on both signatures.
const isKeyKey = k => k.startsWith('rdkey');
export const allDataKeys = () => ls.keys().filter(k => !isKeyKey(k));

export function exportAll({ onlyProfile } = {}) {
  const data = {};
  for (const k of allDataKeys()) {
    if (onlyProfile && k.startsWith('p:') && !k.startsWith(`p:${onlyProfile}:`)) continue;
    data[k] = ls.get(k);
  }
  if (onlyProfile) data.profiles = (data.profiles || []).filter(p => p.id === onlyProfile);
  return { app: 'streamora', v: 1, at: Date.now(), data };
}

const kind = v => (Array.isArray(v) ? 'array' : v === null ? 'null' : typeof v);
// ms timestamp of a record, if it carries one (`t` only counts when it's an epoch, not a playback position)
const stamp = o => (o && typeof o === 'object' ? o.updated ?? o.at ?? o.added ?? (o.t > 1e12 ? o.t : undefined) : undefined);
const newer = (a, b) => { const ta = stamp(a), tb = stamp(b); return ta != null && tb != null ? (tb > ta ? b : a) : b; };
// array items match by id+videoId, so repeat watches of one episode collapse into the newest;
// diary entries (rating/note) are separate logs, so each keeps its own `at`
const itemKey = x => (x && typeof x === 'object' ? (x.id != null ? `${x.id}|${x.videoId ?? ''}${'rating' in x || 'note' in x ? '|' + x.at : ''}` : JSON.stringify(x)) : JSON.stringify(x));

/** Pure merge of one stored value: arrays by id (newer wins, local order first), objects key-wise (newer wins), else incoming. */
export function mergeValue(cur, inc) {
  if (Array.isArray(cur) && Array.isArray(inc)) {
    const out = new Map(cur.map(x => [itemKey(x), x]));
    for (const x of inc) { const k = itemKey(x); out.set(k, out.has(k) ? newer(out.get(k), x) : x); }
    return [...out.values()];
  }
  if (kind(cur) === 'object' && kind(inc) === 'object') {
    if (stamp(cur) != null && stamp(inc) != null) return newer(cur, inc);
    const out = { ...cur };
    for (const [k, v] of Object.entries(inc)) out[k] = k in cur ? (kind(cur[k]) === 'object' && kind(v) === 'object' ? newer(cur[k], v) : v) : v;
    return out;
  }
  return inc;
}

/** Pure: current data map + incoming data map -> {[key]: value to write}. Skips key material and type mismatches. */
export function mergeData(cur, inc, merge = true) {
  const out = {};
  for (const [k, v] of Object.entries(inc || {})) {
    if (isKeyKey(k) || v === undefined) continue;
    const c = cur[k];
    if (c != null && v != null && kind(c) !== kind(v)) continue;
    if (k.startsWith('p:') && ['watchlist', 'history', 'diary', 'follows', 'hidden'].includes(k.split(':')[2]) && !Array.isArray(v)) continue;
    if (k === 'profiles' && !(Array.isArray(v) && v.every(p => p && typeof p.id === 'string'))) continue;
    if (merge && k === 'activeProfile' && c) continue;
    out[k] = merge && c != null ? mergeValue(c, v) : v;
  }
  return out;
}

export function importAll(bundle, { merge = true } = {}) {
  if (!bundle || bundle.app !== 'streamora' || !bundle.data || typeof bundle.data !== 'object') throw new Error('Not a Streamora backup');
  const cur = Object.fromEntries(Object.keys(bundle.data).map(k => [k, ls.get(k, null)]));
  for (const [k, v] of Object.entries(mergeData(cur, bundle.data, merge))) ls.set(k, v);
  allStores.forEach(s => s._refresh());
}
