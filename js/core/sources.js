// Finding sources for a title via Torrentio, marked [RD+] when Real-Debrid already has them cached.
// Real-Debrid's own "instantAvailability" endpoint is disabled, so Torrentio's flag is the cache check.
import { getRdKey } from './store.js';

export const TORRENTIO = 'https://torrentio.strem.fun';

const QUALITY_RANK = { '2160p': 4, '1440p': 3.5, '1080p': 3, '720p': 2, '576p': 1.5, '480p': 1, 'SD': .5, '?': 0 };

export function parseSize(s) {
  const m = /([\d.]+)\s*(TB|GB|MB|KB)/i.exec(s || '');
  if (!m) return 0;
  return parseFloat(m[1]) * { TB: 1e12, GB: 1e9, MB: 1e6, KB: 1e3 }[m[2].toUpperCase()];
}

export function parseStream(s) {
  const name = s.name || '';
  const [release = '', ...rest] = (s.title || '').split('\n');
  const meta = rest.join(' ');
  const text = `${name} ${s.title || ''}`;
  const q = (/\b(2160p|4k|1440p|1080p|720p|576p|480p)\b/i.exec(text) || [])[1];
  const quality = !q ? '?' : /4k/i.test(q) ? '2160p' : q.toLowerCase();
  const fileLine = rest.find(l => /\.(mkv|mp4|avi|mov|m4v|webm|ts)$/i.test(l.trim()));
  return {
    raw: s,
    cached: /\[RD\+\]/.test(name),
    quality,
    rank: QUALITY_RANK[quality] ?? 0,
    hdr: /\bHDR|DV\b|Dolby ?Vision/i.test(text),
    dv: /\bDV\b|Dolby ?Vision/i.test(text),
    hevc: /x265|hevc|h\.?265/i.test(text),
    remux: /remux/i.test(text),
    cam: /\b(cam|hdcam|ts|telesync|tc|hdts)\b/i.test(release),
    dual: /dual audio|multi/i.test(text),
    size: parseSize(meta),
    seeders: +((/👤\s*(\d+)/.exec(meta) || [])[1] || 0),
    site: ((/⚙️\s*([^\n]+)/.exec(meta) || [])[1] || '').trim(),
    langs: (meta.match(/[\u{1F1E6}-\u{1F1FF}]{2}/gu) || []),
    release: release.trim(),
    filename: (s.behaviorHints && s.behaviorHints.filename) || (fileLine && fileLine.trim()) || null,
    infoHash: s.infoHash || (/\/([a-f0-9]{40})\//i.exec(s.url || '') || [])[1] || null,
    fileIdx: s.fileIdx ?? (() => { const m = /\/[a-f0-9]{40}\/[^/]+\/(\d+)\//i.exec(s.url || ''); return m ? +m[1] : undefined; })(),
    // Torrentio adds a file-path line only when the file differs from the torrent (collections like "IMDB Top 250").
    // Packs often resolve to the wrong file on Real-Debrid, so they rank last.
    pack: rest.some(l => l.trim() && !/👤|💾|⚙️/.test(l)),
    binge: s.behaviorHints && s.behaviorHints.bingeGroup,
  };
}

/**
 * streams('movie', 'tt1392214')  |  streams('series', 'tt0944947:1:1')  |  streams('series', 'kitsu:7442:3')
 * For series pass the *video id* (episode id), for movies the meta id.
 */
export async function streams(type, id) {
  const key = await getRdKey();
  const cfg = key ? `/sort=qualitysize|realdebrid=${key}` : '/sort=qualitysize';
  const extraP = import('./addons.js').then(m => m.addonStreams(type, id)).catch(() => []);
  const r = await fetch(`${TORRENTIO}${cfg}/stream/${type}/${encodeURIComponent(id)}.json`);
  if (!r.ok) throw new Error(`Source search failed (${r.status})`);
  const j = await r.json();
  const extra = await extraP, seen = new Set((j.streams || []).map(s => s.infoHash));
  return [...(j.streams || []), ...extra.filter(s => !seen.has(s.infoHash))].map(parseStream).filter(s => s.infoHash);
}

// Torrentio tags non-English releases with flag emojis. A release flagged only with other languages
// (and not multi/dual audio) probably lacks the preferred audio track.
const FLAGS = { eng: '🇬🇧🇺🇸', spa: '🇪🇸🇲🇽', fre: '🇫🇷', fra: '🇫🇷', ger: '🇩🇪', deu: '🇩🇪', ita: '🇮🇹', por: '🇵🇹🇧🇷', pob: '🇧🇷', rus: '🇷🇺', jpn: '🇯🇵', kor: '🇰🇷',
  chi: '🇨🇳🇹🇼', zho: '🇨🇳🇹🇼', hin: '🇮🇳', ara: '🇸🇦🇦🇪🇪🇬', tur: '🇹🇷', pol: '🇵🇱', dut: '🇳🇱', nld: '🇳🇱', ukr: '🇺🇦' };
const langMismatch = (s, lang) => !!lang && !!s.langs && s.langs.length > 0 && !s.dual && !s.langs.some(f => (FLAGS[lang] || '').includes(f));

/**
 * Sort best-first for this device.
 * prefs: { maxQuality:'2160p'|'1080p'|..., cachedOnly, preferSmall (phones), preferBinge, audioLang (ISO 639-2, e.g. 'eng'), preferMp4 (no native mkv) }
 */
export function rankStreams(list, prefs = {}) {
  const max = QUALITY_RANK[prefs.maxQuality || '2160p'] ?? 4;
  const score = s => {
    let x = 0;
    if (s.cached) x += 1000;
    if (s.cam) x -= 800;
    if (s.pack) x -= 1500;
    x += (s.rank <= max ? s.rank : max - (s.rank - max)) * 60;
    if (prefs.preferBinge && s.binge === prefs.preferBinge) x += 400;
    if (langMismatch(s, prefs.audioLang)) x -= 300;
    // mp4 plays directly (no RD transcode) where mkv can't, e.g. Safari; wins ties within a quality tier
    if (prefs.preferMp4 && /\.(mp4|m4v)$/i.test(s.filename || '')) x += 55;
    const gb = s.size / 1e9;
    // huge remuxes transcode slowly; favour sane sizes, more so on phones
    x -= prefs.preferSmall ? gb * 4 : gb * 2 + Math.max(0, gb - 20) * 6;
    x += Math.min(s.seeders, 200) / 10;
    return x;
  };
  return list
    .filter(s => !prefs.cachedOnly || s.cached)
    .map(s => ({ ...s, score: score(s) }))
    .sort((a, b) => b.score - a.score);
}

export const isPhone = () => matchMedia('(max-width: 700px)').matches || /iPhone|Android.+Mobile/.test(navigator.userAgent);

export const fmtSize = b => !b ? '' : b >= 1e9 ? `${(b / 1e9).toFixed(b >= 1e10 ? 0 : 1)} GB` : `${Math.round(b / 1e6)} MB`;

// true where the browser can't play mkv itself (Safari/iOS), so mp4 releases skip the transcoder
export const noMkv = () => typeof document !== 'undefined' && !document.createElement('video').canPlayType('video/x-matroska');
