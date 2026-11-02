// Subtitles from SubDL and SubSource with the app's own API keys (Pages secrets SUBDL_API_KEY, SUBSOURCE_API_KEY),
// so nobody has to bring keys. Both sites share one catalogue (same subtitle ids) and serve zips, often season packs.
//   GET /api/subs/search?type=movie|series&id=tt123[:s:e]&langs=ara,eng  -> { subtitles: [{ id, lang, release, releases, source, author, downloads, hi, url }] }
//   GET /api/subs/file?src=subdl|subsource&ref=…&s=1&e=2                  -> the one .srt/.ass/.vtt for that episode, raw bytes
// Keys never leave the server; answers are cached at the edge (search 6 h, files 7 days).

const LANGS = {
  ara: ['AR', 'arabic'], eng: ['EN', 'english'], fre: ['FR', 'french'], fra: ['FR', 'french'], spa: ['ES', 'spanish'],
  ger: ['DE', 'german'], deu: ['DE', 'german'], ita: ['IT', 'italian'], por: ['PT', 'portuguese'], pob: ['BR_PT', 'brazillian_portuguese'],
  tur: ['TR', 'turkish'], rus: ['RU', 'russian'], dut: ['NL', 'dutch'], nld: ['NL', 'dutch'], per: ['FA', 'farsi_persian'], fas: ['FA', 'farsi_persian'],
  kor: ['KO', 'korean'], jpn: ['JA', 'japanese'], ind: ['ID', 'indonesian'], heb: ['HE', 'hebrew'], hin: ['HI', 'hindi'],
};
const FROM_SUBDL = Object.fromEntries(Object.entries(LANGS).map(([k, [c]]) => [c, k]));
const FROM_SS = Object.fromEntries(Object.entries(LANGS).map(([k, [, n]]) => [n, k]));
const SS = 'https://api.subsource.net/api/v1';
const SUB_EXT = /\.(srt|ass|ssa|vtt|sub)$/i;
const MAX_ZIP = 15 * 1024 * 1024;

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } });
const sameOrigin = request => {
  const origin = request.headers.get('Origin'), site = request.headers.get('Sec-Fetch-Site');
  if (origin && origin !== new URL(request.url).origin) return false;
  return !site || site === 'same-origin' || site === 'none';
};
const cache = () => (typeof caches !== 'undefined' && caches.default) || null;

// ------------------------------------------------------------------ episode matching
const epTag = /s(\d{1,2})[ ._-]*e(\d{1,3})|(\d{1,2})x(\d{2,3})/i;
/** Is this release (or file) name for another episode than s/e? Season packs and unnamed ones are not. */
export function otherEpisode(name, s, e) {
  const m = epTag.exec(String(name || ''));
  if (!m || !e) return false;
  const [ms, me] = m[1] ? [+m[1], +m[2]] : [+m[3], +m[4]];
  return ms !== +s || me !== +e;
}
/** The subtitle file in a zip for this episode (or the biggest one for a movie / a single-file zip). */
export function pickEntry(entries, s, e) {
  const subs = entries.filter(x => SUB_EXT.test(x.name) && !/(^|\/)__MACOSX\//.test(x.name));
  if (!subs.length) return null;
  const biggest = list => list.slice().sort((a, b) => b.size - a.size)[0];
  if (!e) return biggest(subs);
  const base = x => x.name.split('/').pop();
  const exact = subs.filter(x => { const m = epTag.exec(base(x)); return m && (m[1] ? +m[1] === +s && +m[2] === +e : +m[3] === +s && +m[4] === +e); });
  if (exact.length) return biggest(exact);
  const n = String(+e);
  const loose = subs.filter(x => new RegExp(`(?:\\b|_)(?:e|ep|episode)?[ ._-]?0*${n}(?:\\b|_)`, 'i').test(base(x).replace(/\.(srt|ass|ssa|vtt|sub)$/i, '').replace(/(19|20)\d\d|\d{3,4}p|[xh]\.?26[45]/gi, ' ')));
  if (loose.length === 1) return loose[0];
  return subs.length === 1 && !epTag.test(base(subs[0])) ? subs[0] : null;
}

// ------------------------------------------------------------------ zip (stored + deflate entries, no zip64)
export function zipEntries(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('not a zip');
  const count = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  for (let i = 0; i < count && dv.getUint32(p, true) === 0x02014b50; i++) {
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true), csize = dv.getUint32(p + 20, true), size = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), local = dv.getUint32(p + 42, true);
    const raw = u8.subarray(p + 46, p + 46 + nl);
    const name = new TextDecoder(flags & 0x800 ? 'utf-8' : 'latin1').decode(raw);
    out.push({ name, method, csize, size, local });
    p += 46 + nl + xl + cl;
  }
  return out;
}
export async function zipRead(buf, entry) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const at = entry.local + 30 + dv.getUint16(entry.local + 26, true) + dv.getUint16(entry.local + 28, true);
  const data = u8.subarray(at, at + entry.csize);
  if (entry.method === 0) return data;
  if (entry.method !== 8) throw new Error('unsupported zip method');
  return new Uint8Array(await new Response(new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
}

// ------------------------------------------------------------------ providers
async function subdl(env, imdb, s, e, langs) {
  if (!env.SUBDL_API_KEY) return [];
  const codes = langs.map(l => LANGS[l] && LANGS[l][0]).filter(Boolean);
  if (!codes.length) return [];
  const q = new URLSearchParams({ api_key: env.SUBDL_API_KEY, imdb_id: imdb, type: s ? 'tv' : 'movie', languages: [...new Set(codes)].join(','), subs_per_page: '30' });
  if (s) { q.set('season_number', s); if (e) q.set('episode_number', e); }
  const r = await fetch('https://api.subdl.com/api/v1/subtitles?' + q, { signal: AbortSignal.timeout(10000) });
  if (!r.ok) return [];
  const j = await r.json();
  return (j.subtitles || []).map(x => {
    const path = String(x.url || '').split('?')[0];
    const m = /\/subtitle\/(\d+)-(\d+)\.zip$/.exec(path);
    if (!m) return null;
    return { id: 'sx:' + m[2], lang: FROM_SUBDL[x.language] || String(x.language || '').toLowerCase(), release: x.release_name || '', releases: [x.release_name].filter(Boolean),
      source: 'SubDL', author: x.author || '', hi: !!x.hi, downloads: 0, pack: !!x.full_season, ref: `${m[1]}-${m[2]}`, src: 'subdl' };
  }).filter(Boolean);
}
async function subsource(env, imdb, s, e, langs) {
  if (!env.SUBSOURCE_API_KEY) return [];
  const h = { 'X-API-Key': env.SUBSOURCE_API_KEY };
  const sr = await fetch(`${SS}/movies/search?searchType=imdb&imdb=${encodeURIComponent(imdb)}`, { headers: h, signal: AbortSignal.timeout(10000) });
  if (!sr.ok) return [];
  const found = (await sr.json()).data || [];
  const movie = s ? found.find(x => +x.season === +s) : found[0];
  if (!movie) return [];
  const names = [...new Set(langs.map(l => LANGS[l] && LANGS[l][1]).filter(Boolean))];
  const lists = await Promise.all(names.map(n => fetch(`${SS}/subtitles?movieId=${movie.movieId}&language=${n}&limit=100`, { headers: h, signal: AbortSignal.timeout(10000) })
    .then(r => (r.ok ? r.json() : {})).then(j => j.data || []).catch(() => [])));
  return lists.flat().map(x => {
    const releases = Array.isArray(x.releaseInfo) ? x.releaseInfo : [x.releaseInfo].filter(Boolean);
    return { id: 'sx:' + x.subtitleId, lang: FROM_SS[x.language] || x.language, release: releases[0] || '', releases, source: 'SubSource',
      author: ((x.contributors || [])[0] || {}).displayname || '', hi: !!x.hearingImpaired, downloads: x.downloads || 0,
      rating: x.rating ? (x.rating.good || 0) - (x.rating.bad || 0) : 0, ref: String(x.subtitleId), src: 'subsource' };
  }).filter(x => !e || !x.releases.length || !x.releases.every(r => otherEpisode(r, s, e)));
}

/** Both providers, one entry per subtitle id (SubDL's download needs no key, so it wins; SubSource adds counts and releases). */
export function mergeProviders(a, b) {
  const m = new Map();
  for (const x of [...a, ...b]) {
    const y = m.get(x.id);
    if (!y) { m.set(x.id, x); continue; }
    const [keep, more] = y.src === 'subdl' ? [y, x] : [x, y];
    m.set(x.id, { ...keep, releases: [...new Set([...keep.releases, ...more.releases])], downloads: Math.max(keep.downloads || 0, more.downloads || 0),
      rating: keep.rating || more.rating || 0, author: keep.author || more.author, also: more.source });
  }
  return [...m.values()];
}

async function search(env, url) {
  const type = url.searchParams.get('type');
  const [imdb, s, e] = String(url.searchParams.get('id') || '').split(':');
  const langs = String(url.searchParams.get('langs') || 'ara').split(',').map(x => x.trim()).filter(x => LANGS[x]).slice(0, 4);
  if (!/^tt\d{5,10}$/.test(imdb) || (type === 'series' && !(+s >= 0))) return json({ subtitles: [] });
  const [a, b] = await Promise.all([subdl(env, imdb, s, e, langs).catch(() => []), subsource(env, imdb, s, e, langs).catch(() => [])]);
  const subtitles = mergeProviders(a, b).map(({ ref, src, ...x }) => ({ ...x, url: `/api/subs/file?${new URLSearchParams({ src, ref, ...(s ? { s } : {}), ...(e ? { e } : {}) })}` }));
  return json({ subtitles }, 200, { 'Cache-Control': 'public, max-age=21600' });
}

async function file(env, url) {
  const src = url.searchParams.get('src'), ref = url.searchParams.get('ref') || '', s = url.searchParams.get('s'), e = url.searchParams.get('e');
  let r;
  if (src === 'subdl' && /^\d+-\d+$/.test(ref)) r = await fetch(`https://dl.subdl.com/subtitle/${ref}.zip`, { signal: AbortSignal.timeout(15000) });
  else if (src === 'subsource' && /^\d+$/.test(ref) && env.SUBSOURCE_API_KEY) r = await fetch(`${SS}/subtitles/${ref}/download`, { headers: { 'X-API-Key': env.SUBSOURCE_API_KEY }, signal: AbortSignal.timeout(15000) });
  else return json({ error: 'bad_ref' }, 400);
  if (!r.ok) return json({ error: 'upstream', status: r.status }, 502);
  const buf = await r.arrayBuffer();
  if (buf.byteLength > MAX_ZIP) return json({ error: 'too_big' }, 502);
  let bytes;
  try {
    const entry = pickEntry(zipEntries(buf), s, e);
    if (!entry) return json({ error: 'no_file_for_episode' }, 404);
    bytes = await zipRead(buf, entry);
  } catch {
    const head = new Uint8Array(buf.slice(0, 4));
    if (head[0] === 0x50 && head[1] === 0x4b) return json({ error: 'bad_zip' }, 502);
    bytes = new Uint8Array(buf);   // a bare .srt
  }
  return new Response(bytes, { headers: { 'Content-Type': 'text/plain; charset=binary', 'Cache-Control': 'public, max-age=604800' } });
}

export async function onRequest({ request, env, params }) {
  if (request.method !== 'GET') return json({ error: 'method' }, 405);
  if (!sameOrigin(request)) return json({ error: 'forbidden' }, 403);
  const url = new URL(request.url);
  const what = [].concat(params.path || [])[0];
  if (what !== 'search' && what !== 'file') return json({ error: 'not_found' }, 404);
  const c = cache(), key = new Request(url.toString());
  if (c) { const hit = await c.match(key); if (hit) return hit; }
  const res = what === 'search' ? await search(env, url) : await file(env, url);
  if (c && res.ok) await c.put(key, res.clone());
  return res;
}
