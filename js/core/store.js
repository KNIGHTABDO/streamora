// Persistence + tiny reactive stores. Everything lives in this browser only.
// - store(key, init): global value persisted in localStorage
// - pstore(bucket, init): per-profile value, swaps automatically when the active profile changes
// - useStore(s): Preact hook that re-renders on change
import { useState, useEffect } from '../../vendor/preact-htm.js';

const NS = 'streamora:';

export const ls = {
  get(k, d) { try { const v = localStorage.getItem(NS + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(NS + k, JSON.stringify(v)); return true; } catch { return false; } },
  del(k) { try { localStorage.removeItem(NS + k); } catch {} },
  keys() { try { return Object.keys(localStorage).filter(k => k.startsWith(NS)).map(k => k.slice(NS.length)); } catch { return []; } },
};

const clone = v => (v && typeof v === 'object' ? structuredClone(v) : v);

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
      cacheKey = k; cache = v;
      if (k) ls.set(k, v);
      subs.forEach(f => f(v));
    },
    update(fn) { const cur = s.get(); const next = fn(cur); s.set(next === undefined ? cur : next); },
    subscribe(f) { subs.add(f); return () => subs.delete(f); },
    _refresh() { cacheKey = UNSET; const v = s.get(); subs.forEach(f => f(v)); },
  };
  return s;
}

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
  autoNext: true, skipIntroSec: 85,
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
  } catch { return null; }
}
export function forgetRdKey() {
  keyMem = null; ls.del('rdkey'); keyStore.set({ set: false });
  try { indexedDB.deleteDatabase(IDB); } catch {}
}
if (ls.get('rdkey', null)) keyStore.set({ set: true });

// ---- backup: everything except the key ----
export function exportAll({ onlyProfile } = {}) {
  const data = {};
  for (const k of ls.keys()) {
    if (k === 'rdkey' || k === 'rdkey-state') continue;
    if (onlyProfile && k.startsWith('p:') && !k.startsWith(`p:${onlyProfile}:`)) continue;
    data[k] = ls.get(k);
  }
  if (onlyProfile) data.profiles = (data.profiles || []).filter(p => p.id === onlyProfile);
  return { app: 'streamora', v: 1, at: Date.now(), data };
}
export function importAll(bundle, { merge = true } = {}) {
  if (!bundle || bundle.app !== 'streamora' || !bundle.data) throw new Error('Not a Streamora backup');
  for (const [k, v] of Object.entries(bundle.data)) {
    if (k === 'profiles' && merge) {
      const cur = profiles.get();
      const ids = new Set(cur.map(p => p.id));
      ls.set(k, [...cur, ...v.filter(p => !ids.has(p.id))]);
    } else ls.set(k, v);
  }
  profiles._refresh(); activeProfileId._refresh();
}
