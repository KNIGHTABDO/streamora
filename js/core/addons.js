// Extra Stremio addons (stream resource only), built in and user-added. We only read their JSON; addon code never runs here.
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

// MediaFusion writes languages as words; Torrentio-style flags let rankStreams() check audio the same way
const LANG_FLAGS = { english: '🇬🇧', arabic: '🇸🇦', turkish: '🇹🇷', french: '🇫🇷', spanish: '🇪🇸', german: '🇩🇪', italian: '🇮🇹', portuguese: '🇵🇹',
  russian: '🇷🇺', japanese: '🇯🇵', korean: '🇰🇷', chinese: '🇨🇳', hindi: '🇮🇳', polish: '🇵🇱', dutch: '🇳🇱', ukrainian: '🇺🇦', persian: '🇮🇷', urdu: '🇵🇰' };

/**
 * One addon stream -> the Torrentio shape parseStream() reads ("release\n👤 seeds 💾 size ⚙️ site\nflags"), or null
 * if it has no torrent. The hash comes from infoHash, the url, or Comet's bingeGroup ("comet|realdebrid|<hash>").
 * An https url is kept: debrid addons start the source on Real-Debrid from their own server when it's opened.
 */
export function normalizeStream(s, addonName) {
  if (!s || typeof s !== 'object') return null;
  const str = v => (typeof v === 'string' ? v : '');
  const bh = s.behaviorHints || {};
  const hash = String(s.infoHash || (/\/([a-f0-9]{40})\//i.exec(str(s.url)) || [])[1] || (/\|([a-f0-9]{40})$/i.exec(str(bh.bingeGroup)) || [])[1] || '').toLowerCase();
  if (!/^[a-f0-9]{40}$/.test(hash)) return null;
  const text = str(s.title) || str(s.description);
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  const release = str(bh.filename) || (lines[0] || '').replace(/^📄\s*/, '');
  const size = (/(?:💾|📦)\s*([\d.]+\s*[KMGT]B)/i.exec(text) || [])[1] || (bh.videoSize > 0 ? `${(bh.videoSize / 1e9).toFixed(2)} GB` : '');
  const seeds = (/👤\s*(\d+)/.exec(text) || [])[1];
  const site = ((/⚙️\s*([^\n]+)/.exec(text) || [])[1] || addonName).trim();
  const words = ((/🌐\s*([^\n]+)/.exec(text) || [])[1] || '').toLowerCase().split(/[^a-z]+/).filter(w => LANG_FLAGS[w]);
  // English alone isn't flagged (Torrentio's convention); next to other languages it marks the release as having it
  const flags = [...new Set([...(text.match(/[\u{1F1E6}-\u{1F1FF}]{2}/gu) || []), ...(words.length > 1 || words[0] !== 'english' ? words.map(w => LANG_FLAGS[w]) : [])])];
  return {
    name: `[${addonName}] ${str(s.name)}`.trim(),
    title: [release, [seeds && `👤 ${seeds}`, size && `💾 ${size}`, `⚙️ ${site}`].filter(Boolean).join(' '), flags.join(' / ')].filter(Boolean).join('\n'),
    infoHash: hash,
    fileIdx: Number.isInteger(s.fileIdx) ? s.fileIdx : undefined,
    url: /^https:\/\//.test(str(s.url)) ? s.url : undefined,
    behaviorHints: { filename: str(bh.filename) || undefined, bingeGroup: str(bh.bingeGroup) || undefined },
  };
}

// Built-in debrid addons searched next to Torrentio with the user's Real-Debrid key. They find releases Torrentio
// doesn't index (much of the Arabic and Turkish catalog), and their playback links add the source on Real-Debrid
// from their own servers, which works where Torrentio's resolve link doesn't know the release.
const COMET = 'https://comet.elfhosted.com';
const MEDIAFUSION = 'https://mediafusionfortheweebs.midnightignite.me';
const cometCfg = key => btoa(JSON.stringify({
  maxResultsPerResolution: 8, maxSize: 0, cachedOnly: false, removeTrash: true, resultFormat: ['all'],
  debridServices: [{ service: 'realdebrid', apiKey: key }], enableTorrent: false, deduplicateStreams: true, debridStreamProxyPassword: '',
  languages: { required: [], exclude: [], preferred: [] }, resolutions: {},
  options: { remove_ranks_under: -10000000000, allow_english_in_languages: false, remove_unknown_languages: false },
}));
// MediaFusion wants its config encrypted by the server first; one request per key per session
let mfCfg = null;
const mediafusionCfg = key => {
  if (!mfCfg || mfCfg.key !== key) {
    const p = fetch(`${MEDIAFUSION}/encrypt-user-data`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000),
      body: JSON.stringify({ streaming_providers: [{ service: 'realdebrid', token: key }] }),
    }).then(r => r.json()).then(j => { if (!j || typeof j.encrypted_str !== 'string') throw new Error('MediaFusion config'); return j.encrypted_str; });
    p.catch(() => { if (mfCfg && mfCfg.p === p) mfCfg = null; });
    mfCfg = { key, p };
  }
  return mfCfg.p;
};
export const BUILTIN = [
  { name: 'Comet', base: async key => `${COMET}/${cometCfg(key)}` },
  { name: 'MediaFusion', base: async key => `${MEDIAFUSION}/${await mediafusionCfg(key)}` },
];

async function fromAddon(name, base, type, id, get) {
  const j = await get(`${base}/stream/${type}/${encodeURIComponent(id)}.json`);
  return (Array.isArray(j && j.streams) ? j.streams : []).map(s => normalizeStream(s, name));
}
// built-ins send CORS headers; the 9 s cap keeps a slow first search (Comet scrapes on a miss) from holding up the list
const getDirect = async u => { const r = await fetch(u, { signal: AbortSignal.timeout(9000) }); if (!r.ok) throw new Error(`${r.status}`); return r.json(); };

/** Streams from the built-ins (with a Real-Debrid key) and every added addon that handles this type/id, deduped by infoHash. Never throws. */
export async function addonStreams(type, id, rdKey) {
  const list = addons.get().filter(a => a.types.includes(type) && (!a.idPrefixes || a.idPrefixes.some(p => id.startsWith(p))));
  const all = await Promise.allSettled([
    ...(rdKey && /^tt\d+/.test(id) ? BUILTIN.map(async b => fromAddon(b.name, await b.base(rdKey), type, id, getDirect)) : []),
    ...list.map(a => fromAddon(a.name, baseOf(a.url), type, id, getJson)),
  ]);
  const seen = new Set();
  return all.flatMap(r => (r.status === 'fulfilled' ? r.value : [])).filter(s => s && !seen.has(s.infoHash) && seen.add(s.infoHash));
}
