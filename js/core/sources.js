// Finding sources for a title via Torrentio and the built-in debrid addons. TorBox's own cache check decides what's
// cached; the addons' flags ([TB+], ⚡) only count when that check can't answer.
import { getTbKey } from './store.js';
import { fetchT } from './net.js';
import { canRemuxMkv, hevcInMse } from '../player/mkv-plan.js';

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
    cached: /\[TB\+\]|\bTB ?⚡|\bTRB ?⚡/.test(name),
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
    site: ((/⚙️\s*([^\n]+)/.exec(rest.join('\n')) || [])[1] || '').trim(),
    langs: (meta.match(/[\u{1F1E6}-\u{1F1FF}]{2}/gu) || []),
    release: release.trim(),
    filename: (s.behaviorHints && s.behaviorHints.filename) || (fileLine && fileLine.trim()) || null,
    infoHash: s.infoHash || (/\/([a-f0-9]{40})\//i.exec(s.url || '') || [])[1] || null,
    fileIdx: s.fileIdx ?? (() => { const m = /\/[a-f0-9]{40}\/[^/]+\/(\d+)\//i.exec(s.url || ''); return m ? +m[1] : undefined; })(),
    // Torrentio adds a file-path line only when the file differs from the torrent (collections like "IMDB Top 250").
    // Packs can hold many files and may start the wrong one, so they rank last.
    pack: rest.some(l => l.trim() && !/👤|💾|⚙️/.test(l) && !/^[\s/\u{1F1E6}-\u{1F1FF}]+$/u.test(l)),
    binge: s.behaviorHints && s.behaviorHints.bingeGroup,
  };
}

/** Popular titles return over a thousand releases. Keep every cached one, plus the best-seeded uncached ones, so the list stays quick on phones. */
export const trimStreams = (list, uncached = 60) => {
  const keep = new Set(list.filter(s => !s.cached).sort((a, b) => b.seeders - a.seeders).slice(0, uncached));
  return list.filter(s => s.cached || keep.has(s));
};

/**
 * streams('movie', 'tt1392214')  |  streams('series', 'tt0944947:1:1')  |  streams('series', 'kitsu:7442:3')
 * For series pass the *video id* (episode id), for movies the meta id.
 */
export async function streams(type, id) {
  const key = await getTbKey();
  const cfg = key ? `/sort=qualitysize|torbox=${key}` : '/sort=qualitysize';
  const extraP = import('./addons.js').then(m => m.addonStreams(type, id, key)).catch(() => []);
  const load = async () => {
    const r = await fetchT(`${TORRENTIO}${cfg}/stream/${type}/${encodeURIComponent(id)}.json`, {}, 12000, 'Torrentio');
    if (!r.ok) throw new Error(`Source search failed (${r.status})`);
    return r.json();
  };
  let j, err;
  try { j = await load(); }
  catch { try { await new Promise(r => setTimeout(r, 600)); j = await load(); } catch (e) { err = e; } } // one retry
  const extra = await extraP;
  // Torrentio down: the other addons' sources still count; only when nothing answered is it an error
  if (err && !extra.length) throw err;
  // one entry per release; if any addon says it's cached, it is (until TorBox itself says otherwise below)
  const byHash = new Map();
  for (const s of [...(err ? [] : j.streams || []), ...extra].map(parseStream)) {
    if (!s.infoHash) continue;
    const h = s.infoHash.toLowerCase(), had = byHash.get(h);
    if (!had) byHash.set(h, s); else if (s.cached) had.cached = true;
  }
  let out = [...byHash.values()];
  if (key && out.length) {
    const { checkCached } = await import('./tb.js');
    const have = await checkCached([...byHash.keys()]).catch(() => null);
    if (have) out.forEach(s => { s.cached = have.has(s.infoHash.toLowerCase()); });
  }
  out = trimStreams(out);
  if (err) Object.defineProperty(out, 'failed', { value: ['Torrentio'], enumerable: false }); // sources that didn't answer
  return out;
}

// Torrentio tags non-English releases with flag emojis. A release flagged only with other languages
// (and not multi/dual audio) probably lacks the preferred audio track.
const FLAGS = { eng: '🇬🇧🇺🇸', spa: '🇪🇸🇲🇽', fre: '🇫🇷', fra: '🇫🇷', ger: '🇩🇪', deu: '🇩🇪', ita: '🇮🇹', por: '🇵🇹🇧🇷', pob: '🇧🇷', rus: '🇷🇺', jpn: '🇯🇵', kor: '🇰🇷',
  chi: '🇨🇳🇹🇼', zho: '🇨🇳🇹🇼', hin: '🇮🇳', ara: '🇸🇦🇦🇪🇪🇬', tur: '🇹🇷', pol: '🇵🇱', dut: '🇳🇱', nld: '🇳🇱', ukr: '🇺🇦' };
const langMismatch = (s, lang) => !!lang && !!s.langs && s.langs.length > 0 && !s.dual && !s.langs.some(f => (FLAGS[lang] || '').includes(f));

/**
 * Sort best-first for this device.
 * prefs: { maxQuality:'2160p'|'1080p'|..., cachedOnly, preferSmall (phones), preferBinge, audioLang (ISO 639-2, e.g. 'eng'), preferMp4 (no native mkv), mp4First (mkv can't play at all here) }
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
    // mp4 plays directly where mkv can't, e.g. Safari; wins ties within a quality tier
    const mp4 = /\.(mp4|m4v)$/i.test(s.filename || '');
    if (prefs.preferMp4 && mp4) x += 55;
    // browsers often can't decode these inside an mp4 either, so plain h264/aac copies go first
    if (prefs.mp4First && mp4) x += /x265|hevc|h\.?265|e?ac-?3|ddp|dd[+ .]?5|dts|truehd/i.test(`${s.filename} ${s.release}`) ? 500 : 700;
    if (prefs.remux) {
      const text = `${s.filename} ${s.release}`;
      if (/\bdts\b|dts-?hd|truehd/i.test(text)) x -= 400;
      if (prefs.avoidHevc && /x265|hevc|h\.?265/i.test(text)) x -= 250;
      if (mp4 && /e?ac-?3|ddp|dd[+ .]?5/i.test(text)) x -= 100;
    }
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

// true where the browser can't play mkv itself (Safari/iOS), so mp4 releases go first (the app's VLC player plays mkv)
export const noMkv = () => typeof document !== 'undefined' && !(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform())
  && !document.createElement('video').canPlayType('video/x-matroska');

// The caller supplies the plan's streaming refusal; keep this module independent of tb.js.
export function webPrefs(webStreamingRefused = false) {
  const native = typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.();
  const remux = !native && canRemuxMkv();
  const preferMp4 = noMkv();
  return { preferMp4, mp4First: preferMp4 && webStreamingRefused && !remux, remux, avoidHevc: remux && !hevcInMse() };
}
