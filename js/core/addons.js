// Extra Stremio addons (stream and subtitles resources), built in and user-added. We only read their JSON; addon code never runs here.
// Direct fetch first (most addons send CORS headers), then the /api/addon relay.
import { store, ls } from './store.js';
import { fetchT } from './net.js';

export const addons = store('addons', []); // [{ url, id, name, types, idPrefixes }]

export function manifestUrl(input) {
  let s = String(input || '').trim().replace(/^stremio:\/\//i, 'https://');
  if (!/^https:\/\//i.test(s)) throw new Error('Paste an https:// (or stremio://) addon link.');
  s = s.replace(/[?#].*$/, '').replace(/\/+$/, '');
  return s.endsWith('/manifest.json') ? s : s + '/manifest.json';
}
const baseOf = u => u.replace(/\/manifest\.json$/, '');

async function getJson(u, { signal } = {}) {
  try {
    return await fetchT(u, { signal }, 10000, 'The addon', r => {
      if (!r.ok) throw new Error(`Addon didn't answer (${r.status})`);
      return r.json();
    });
  } catch (e) { if (signal?.aborted) throw e; }
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return fetchT(`/api/addon?url=${encodeURIComponent(u)}`, { signal }, 10000, 'The addon', r => {
    if (!r.ok) throw new Error(`Addon didn't answer (${r.status})`);
    return r.json();
  });
}

const resourceOf = (m, name) => (Array.isArray(m.resources) ? m.resources : []).find(r => r === name || (r && r.name === name));
// { types, idPrefixes } for one resource, or null when it serves neither movies nor series
function scopeOf(m, name) {
  const res = resourceOf(m, name);
  if (!res) return null;
  const types = (res.types || m.types || []).filter(t => typeof t === 'string');
  if (!types.some(t => t === 'movie' || t === 'series')) return null;
  const idPrefixes = res.idPrefixes || m.idPrefixes || null;
  return { types, idPrefixes: Array.isArray(idPrefixes) ? idPrefixes.filter(p => typeof p === 'string') : null };
}

/** Validates a manifest: needs the 'stream' or 'subtitles' resource. Returns the saved addon entry
 *  ({ url, id, name, types, idPrefixes } for streams, plus subs: { types, idPrefixes } for subtitles). */
export function checkManifest(m, url) {
  if (!m || typeof m !== 'object' || typeof m.id !== 'string' || typeof m.name !== 'string') throw new Error("That link isn't a Stremio addon manifest.");
  const stream = scopeOf(m, 'stream'), subs = scopeOf(m, 'subtitles');
  if (!stream && !subs) {
    if (!resourceOf(m, 'stream') && !resourceOf(m, 'subtitles')) throw new Error(`${m.name} doesn't provide streams or subtitles, so Streamora can't use it.`);
    throw new Error(`${m.name} has nothing for movies or series.`);
  }
  const a = { url, id: m.id, name: m.name.slice(0, 60), types: stream ? stream.types : [], idPrefixes: stream ? stream.idPrefixes : null };
  if (subs) a.subs = subs;
  return a;
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
 * if it has no torrent. The hash comes from infoHash, the url, or Comet's bingeGroup ("comet|torbox|<hash>").
 * An https url is kept for addons that only offer a playback link.
 */
export function normalizeStream(s, addonName) {
  if (!s || typeof s !== 'object') return null;
  const str = v => (typeof v === 'string' ? v : '');
  const bh = s.behaviorHints || {};
  const hash = String(s.infoHash || (/\/([a-f0-9]{40})(?:[/?#]|$)/i.exec(str(s.url)) || [])[1] || (/\|([a-f0-9]{40})$/i.exec(str(bh.bingeGroup)) || [])[1] || '').toLowerCase();
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

// Built-in debrid addons searched next to Torrentio with the user's TorBox key. They find releases Torrentio
// doesn't index (much of the Arabic and Turkish catalog).
const COMET = 'https://comet.elfhosted.com';
const MEDIAFUSION = 'https://mediafusionfortheweebs.midnightignite.me';
const METEOR = 'https://meteorfortheweebs.midnightignite.me'; // needs no key, so nothing of the user's leaves the app
const cometCfg = key => btoa(JSON.stringify({
  maxResultsPerResolution: 50, maxSize: 0, cachedOnly: false, removeTrash: true, resultFormat: ['all'],
  debridServices: [{ service: 'torbox', apiKey: key }], enableTorrent: false, deduplicateStreams: true, debridStreamProxyPassword: '',
  languages: { required: [], exclude: [], preferred: [] }, resolutions: {},
  options: { remove_ranks_under: -10000000000, allow_english_in_languages: false, remove_unknown_languages: false },
}));
// Store only the encrypted config, indexed by a digest of the key (never the raw key).
const mfPending = new Map();
export const mediafusionCfg = async (key, signal) => {
  // Older TV browsers and HTTP LAN previews may not offer SubtleCrypto. They still work without persistence.
  const digest = globalThis.crypto?.subtle && await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
  const name = digest ? 'mf-config:' + Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('') : null;
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  const saved = name && ls.get(name, null);
  if (typeof saved === 'string' && saved) return saved;
  let job = mfPending.get(key);
  if (!job) {
    const controller = new AbortController();
    job = { controller, users: new Set() };
    job.p = fetchT(`${MEDIAFUSION}/encrypt-user-data`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: controller.signal,
      body: JSON.stringify({ streaming_providers: [{ service: 'torbox', token: key }] }),
    }, 8000, 'MediaFusion', r => {
      if (!r.ok) throw new Error('MediaFusion config');
      return r.json();
    }).then(j => {
      if (!j || typeof j.encrypted_str !== 'string' || !j.encrypted_str) throw new Error('MediaFusion config');
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      if (name) ls.set(name, j.encrypted_str);
      return j.encrypted_str;
    }).finally(() => { if (mfPending.get(key) === job) mfPending.delete(key); });
    mfPending.set(key, job);
  }
  const user = {};
  job.users.add(user);
  let stop;
  try {
    return await new Promise((resolve, reject) => {
      stop = () => reject(new DOMException('Aborted', 'AbortError'));
      signal?.addEventListener('abort', stop, { once: true });
      job.p.then(resolve, reject);
    });
  } finally {
    signal?.removeEventListener('abort', stop);
    job.users.delete(user);
    if (!job.users.size) {
      if (mfPending.get(key) === job) mfPending.delete(key);
      job.controller.abort();
    }
  }
};
export const BUILTIN = [
  { name: 'Comet', base: async key => `${COMET}/${cometCfg(key)}` },
  { name: 'MediaFusion', base: async (key, signal) => `${MEDIAFUSION}/${await mediafusionCfg(key, signal)}` },
  { name: 'Meteor', base: async () => METEOR },
];

async function fromAddon(name, base, type, id, get) {
  const j = await get(`${base}/stream/${type}/${encodeURIComponent(id)}.json`);
  return (Array.isArray(j && j.streams) ? j.streams : []).map(s => normalizeStream(s, name));
}
// built-ins send CORS headers; the 9 s cap keeps a slow first search (Comet scrapes on a miss) from holding up the list
const getDirect = (u, { signal } = {}) => fetchT(u, { signal }, 9000, 'The addon', r => { if (!r.ok) throw new Error(`${r.status}`); return r.json(); });

/** Streams from the built-ins (with a TorBox key) and every added addon that handles this type/id, deduped by infoHash. Never throws. */
export async function addonStreams(type, id, tbKey, { signal, onPartial } = {}) {
  const list = addons.get().filter(a => (a.types || []).includes(type) && (!a.idPrefixes || a.idPrefixes.some(p => id.startsWith(p))));
  const seen = new Map();
  const receive = rows => {
    if (signal?.aborted) return;
    for (const s of rows) if (s) { const had = seen.get(s.infoHash); if (!had) seen.set(s.infoHash, s); else if (/TB\+|⚡/.test(s.name)) had.name = s.name; }
    onPartial?.([...seen.values()]);
  };
  await Promise.allSettled([
    ...(tbKey && /^tt\d+/.test(id) ? BUILTIN.map(async b => {
      const base = await b.base(tbKey, signal);
      if (signal?.aborted) return;
      receive(await fromAddon(b.name, base, type, id, u => getDirect(u, { signal })));
    }) : []),
    ...list.map(async a => receive(await fromAddon(a.name, baseOf(a.url), type, id, u => getJson(u, { signal })))),
  ]);
  return [...seen.values()];
}

// ------------------------------------------------------------ subtitles
// SubSense (keyless): OpenSubtitles, Gestdown, YIFY, BetaSeries, TVsubtitles, AnimeTosho in the languages asked for.
// Arabic and English are always asked for. A SubSense link the user configured with free SubDL / SubSource keys
// (much more Arabic) is added in Settings like any other addon and searched next to this one.
const SUBSENSE = 'https://subsense.nepiraw.com';
const ISO1 = { ara: 'ar', eng: 'en', fre: 'fr', fra: 'fr', spa: 'es', ger: 'de', deu: 'de', ita: 'it', por: 'pt', pob: 'pt-br', tur: 'tr',
  rus: 'ru', dut: 'nl', nld: 'nl', per: 'fa', fas: 'fa', heb: 'he', hin: 'hi', jpn: 'ja', kor: 'ko', chi: 'zh', zho: 'zh', ind: 'id', pol: 'pl' };
const ISO2 = { ar: 'ara', en: 'eng', fr: 'fre', es: 'spa', de: 'ger', it: 'ita', pt: 'por', 'pt-br': 'pob', tr: 'tur', ru: 'rus', nl: 'dut',
  fa: 'per', he: 'heb', hi: 'hin', ja: 'jpn', ko: 'kor', zh: 'chi', id: 'ind', pl: 'pol', arabic: 'ara', english: 'eng' };
/** Any addon's language tag ("ar", "ara", "Arabic", "pt-BR") -> the 3-letter code OpenSubtitles uses. */
export const subLang = l => {
  const k = String(l || '').trim().toLowerCase();
  if (ISO2[k]) return ISO2[k];
  if (/^[a-z]{3}$/.test(k)) return k;
  return ISO2[k.split(/[-_]/)[0]] || k;
};
export const subsenseBase = (want = []) => {
  const languages = [...new Set(['ar', 'en', ...want.map(l => ISO1[l] || (/^[a-z]{2}$/.test(l) ? l : null)).filter(Boolean)])];
  return `${SUBSENSE}/streamra-${encodeURIComponent(JSON.stringify({ languages }))}`;
};

/** One addon subtitle -> { id, lang, url, release, source }, or null. */
export function normalizeSub(s, addonName) {
  if (!s || typeof s !== 'object' || typeof s.url !== 'string' || !/^https:\/\//.test(s.url)) return null;
  const str = v => (typeof v === 'string' ? v : '');
  return {
    id: `${addonName}:${str(s.id) || s.url}`, lang: subLang(s.lang), url: s.url,
    release: str(s.releaseName) || str(s.fileName) || str(s.label) || '', source: addonName,
  };
}

/** Subtitles from SubSense and every added addon with the subtitles resource, deduped by url. Never throws. */
export async function addonSubtitles(type, id, filename, want = [], { signal } = {}) {
  if (signal?.aborted) return [];
  const extra = filename ? `/filename=${encodeURIComponent(filename)}` : '';
  const path = `/subtitles/${type}/${encodeURIComponent(id)}${extra}.json`;
  const list = addons.get().filter(a => a.subs && a.subs.types.includes(type) && (!a.subs.idPrefixes || a.subs.idPrefixes.some(p => id.startsWith(p))));
  const from = (name, base, get) => get(base + path, { signal })
    .then(j => (Array.isArray(j && j.subtitles) ? j.subtitles : []).map(s => normalizeSub(s, name)));
  const all = await Promise.allSettled([
    ...(/^(tt|kitsu)/.test(id) ? [from('SubSense', subsenseBase(want), getDirect)] : []),
    ...list.map(a => from(a.name, baseOf(a.url), getJson)),
  ]);
  const seen = new Set();
  return all.flatMap(r => (r.status === 'fulfilled' ? r.value : [])).filter(s => s && !seen.has(s.url) && seen.add(s.url));
}
