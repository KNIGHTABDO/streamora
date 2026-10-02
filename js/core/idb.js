// Tiny IndexedDB key-value store for tokens (Google, Trakt). Never exported to localStorage.
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
export const idbWipe = () => new Promise(res => { try { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => res(); } catch { res(); } });
