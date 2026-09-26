// Extra Stremio addons (stream resource only). We only read their JSON; addon code never runs here.
// Direct fetch first (most addons send CORS headers), then the /api/addon relay.
import { store } from './store.js';

export const addons = store('addons', []); // [{ url, id, name, types, idPrefixes }]

export function manifestUrl(input) {
  let s = String(input || '').trim().replace(/^stremio:\/\//i, 'https://');
  if (!/^https:\/\//i.test(s)) throw new Error('Paste an https:// (or stremio://) addon link.');
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
  return s.endsWith('/manifest.json') ? s : s + '/manifest.json';
}
const baseOf = u => u.replace(/\/manifest\.json$/, '');

async function getJson(u) {
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(10000) });
    if (r.ok) return await r.json();
  } catch {}
  const r = await fetch(`/api/addon?url=${encodeURIComponent(u)}`);
  if (!r.ok) throw new Error(`Addon didn't answer (${r.status})`);
  return r.json();
}

/** Validates a manifest: needs the 'stream' resource. Returns the saved addon entry. */
export function checkManifest(m, url) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || typeof m.name !== 'string') throw new Error("That link isn't a Stremio addon manifest.");
  const res = (Array.isArray(m.resources) ? m.resources : []).find(r => r === 'stream' || (r && r.name === 'stream'));
  if (!res) throw new Error(`${m.name} doesn't provide streams, so Streamora can't use it.`);
  const types = (res.types || m.types || []).filter(t => typeof t === 'string');
  if (!types.some(t => t === 'movie' || t === 'series')) throw new Error(`${m.name} has no movie or series streams.`);
  const idPrefixes = res.idPrefixes || m.idPrefixes || null;
  return { url, id: m.id, name: m.name.slice(0, 60), types, idPrefixes: Array.isArray(idPrefixes) ? idPrefixes.filter(p => typeof p === 'string') : null };
}

export async function addAddon(input) {
  const url = manifestUrl(input);
  if (addons.get().some(a => a.url === url)) throw new Error('Already added.');
  const a = checkManifest(await getJson(url), url);
  addons.set([...addons.get(), a]);
  return a;
}
export const removeAddon = url => addons.set(addons.get().filter(a => a.url !== url));

/** One addon stream -> the Torrentio shape parseStream() reads, or null if it has no torrent. */
export function normalizeStream(s, addonName) {
  if (!s || typeof s !== 'object') return null;
  const hash = String(s.infoHash || (/\/([a-f0-9]{40})\//i.exec(s.url || '') || [])[1] || '').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(hash)) return null;
  const str = v => (typeof v === 'string' ? v : '');
  const bh = s.behaviorHints || {};
  return {
    name: `[${addonName}] ${str(s.name)}`.trim(),
    title: str(s.title) || str(s.description),
    infoHash: hash,
    fileIdx: Number.isInteger(s.fileIdx) ? s.fileIdx : undefined,
    behaviorHints: { filename: str(bh.filename) || undefined, bingeGroup: str(bh.bingeGroup) || undefined },
  };
}

/** Streams from every added addon that handles this type/id, deduped by infoHash. Never throws. */
export async function addonStreams(type, id) {
  const list = addons.get().filter(a => a.types.includes(type) && (!a.idPrefixes || a.idPrefixes.some(p => id.startsWith(p))));
  const all = await Promise.allSettled(list.map(async a => {
    const j = await getJson(`${baseOf(a.url)}/stream/${type}/${encodeURIComponent(id)}.json`);
    return (Array.isArray(j && j.streams) ? j.streams : []).map(s => normalizeStream(s, a.name));
  }));
  const seen = new Set();
  return all.flatMap(r => (r.status === 'fulfilled' ? r.value : [])).filter(s => s && !seen.has(s.infoHash) && seen.add(s.infoHash));
}
