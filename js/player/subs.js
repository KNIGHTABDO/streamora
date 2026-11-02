// Subtitles: OpenSubtitles + SubDL/SubSource (our server) + SubSense + user subtitle addons (Stremio addons, CORS ok) + SRT/VTT parsing for our own overlay.
// Embedded tracks inside the file can't be fetched separately; they are burned in
// through the transcode URL's {subtitles} slot instead (see engine.js).

export const OPENSUBS = 'https://opensubtitles-v3.strem.io';

const LANG_NAMES = {
  eng: 'English', spa: 'Spanish', fre: 'French', fra: 'French', ger: 'German', deu: 'German', ita: 'Italian', por: 'Portuguese',
  pob: 'Portuguese (BR)', dut: 'Dutch', nld: 'Dutch', rus: 'Russian', ara: 'Arabic', tur: 'Turkish', pol: 'Polish', swe: 'Swedish',
  nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', gre: 'Greek', ell: 'Greek', heb: 'Hebrew', hin: 'Hindi', jpn: 'Japanese',
  kor: 'Korean', chi: 'Chinese', zho: 'Chinese', ze: 'Chinese', rum: 'Romanian', ron: 'Romanian', hun: 'Hungarian', cze: 'Czech',
  ces: 'Czech', ind: 'Indonesian', may: 'Malay', vie: 'Vietnamese', tha: 'Thai', per: 'Persian', fas: 'Persian', ukr: 'Ukrainian',
  bul: 'Bulgarian', hrv: 'Croatian', srp: 'Serbian', slv: 'Slovenian', slo: 'Slovak', est: 'Estonian', lav: 'Latvian', lit: 'Lithuanian',
};
export const langName = code => LANG_NAMES[code] || (code || '?').toUpperCase();

// "Show.S01E02.1080p.WEB-DL.x264-GRP.mkv" and "Show S01E02 1080p WEB DL x264 GRP [TGx]" are the same release
const relKey = s => String(s || '').toLowerCase().replace(/\.(mkv|mp4|m4v|avi|webm)$/, '').replace(/[^a-z0-9]+/g, ' ').trim();
// a season pack ("Show.S01.WEB.H264-RBB") is the same release as its episodes ("Show.S01E02.1080p.WEB.h264-RBB"): same season, same group
const packKey = k => { const m = /\bs(\d{1,2})(?:e\d{1,3})?\b.*\b([a-z0-9]{2,12})$/.exec(k); return m && !/^(web|webrip|dl|x264|x265|h264|h265|hevc|1080p|720p|2160p|aac|ddp5|nf|amzn)$/.test(m[2]) ? `${+m[1]}|${m[2]}` : null; };
const sameRelease = (a, b) => {
  a = relKey(a); b = relKey(b);
  if (a.length <= 8 || b.length <= 8) return false;
  if (a.includes(b) || b.includes(a)) return true;
  const pa = packKey(a);
  return !!pa && pa === packKey(b);
};

async function openSubtitlesOrg(type, id, filename) {
  try {
    const extra = filename ? `/filename=${encodeURIComponent(filename)}` : '';
    const r = await fetch(`${OPENSUBS}/subtitles/${type}/${encodeURIComponent(id)}${extra}.json`, { signal: AbortSignal.timeout(12000) });
    if (!r.ok) return [];
    const j = await r.json();
    return (j.subtitles || []).map(s => ({ id: 'os:' + s.id, lang: s.lang, url: s.url, release: s.movieReleaseName || s.subtitleFileName || '', source: 'OpenSubtitles' }));
  } catch { return []; }
}

// SubDL + SubSource through our server (it holds the API keys): lots of Arabic, season packs unzipped there
async function subdlSubsource(type, id, want) {
  if (!/^tt\d+/.test(id)) return [];
  try {
    const langs = [...new Set(['ara', ...want, 'eng'])].join(',');
    const r = await fetch(`/api/subs/search?${new URLSearchParams({ type, id, langs })}`, { signal: AbortSignal.timeout(15000) });
    return r.ok ? (await r.json()).subtitles || [] : [];
  } catch { return []; }
}

/** [{ id, lang, label, url, release, match, source }] for a movie id or an episode video id, from OpenSubtitles,
 *  SubDL, SubSource, SubSense and any subtitle addons the user added. `want` are extra languages to ask for (Arabic and
 *  English always are). With the release filename being played, subtitles of that release come first (match: true). */
export async function openSubs(type, id, filename, want = []) {
  want = want.filter(l => l && l !== 'off');
  const [os, sx, more] = await Promise.all([
    openSubtitlesOrg(type, id, filename),
    subdlSubsource(type, id, want),
    import('../core/addons.js').then(m => m.addonSubtitles(type, id, filename, want)).catch(() => []),
  ]);
  const seen = new Set();
  return [...os, ...sx, ...more].filter(s => s.url && !seen.has(s.url) && seen.add(s.url))
    .map(s => ({ ...s, label: langName(s.lang), match: !!filename && [s.release, ...(s.releases || [])].some(r => sameRelease(r, filename)) }))
    .sort((a, b) => b.match - a.match);
}

const ts = s => {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(s);
  return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000 : 0;
};

/** ASS/SSA text -> cues. Only Dialogue lines; override tags dropped, \N / \n become line breaks. */
function parseAss(text) {
  const out = [];
  let fmt = ['layer', 'start', 'end', 'style', 'name', 'marginl', 'marginr', 'marginv', 'effect', 'text'];
  for (const l of text.split(/\r?\n/)) {
    const f = /^Format:\s*(.*)$/i.exec(l);
    if (f && /text/i.test(f[1])) { fmt = f[1].split(',').map(x => x.trim().toLowerCase()); continue; }
    const m = /^Dialogue:\s*(.*)$/i.exec(l);
    if (!m) continue;
    const parts = m[1].split(',');
    const cols = [...parts.slice(0, fmt.length - 1), parts.slice(fmt.length - 1).join(',')];
    const get = k => cols[fmt.indexOf(k)] || '';
    const body = get('text').replace(/\{[^}]*\}/g, '').replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ').trim();
    if (body) out.push({ start: ts(get('start')), end: ts(get('end')), text: body });
  }
  return out.sort((x, y) => x.start - y.start);
}

/** Parse timing and format-specific overrides before the common HTML sanitizer. */
function parseRawSubs(text) {
  if (/^\s*\[Script Info\]|^Dialogue:/im.test(text)) return parseAss(text);
  const out = [];
  const blocks = text.replace(/\r/g, '').replace(/^﻿/, '').split(/\n{2,}/);
  for (const b of blocks) {
    const lines = b.split('\n');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->');
    const body = lines.slice(i + 1).join('\n')
      .replace(/\{\\[^}]*\}/g, '')                      // ASS override tags
      .trim();
    if (body) out.push({ start: ts(a), end: ts(z), text: body });
  }
  return out.sort((x, y) => x.start - y.start);
}

// Escape first; only exact, attribute-free formatting tags may become markup again.
const sanitize = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/&lt;(\/?)(i|b|u|em|strong|br)&gt;/gi, (_, close, tag) => `<${close}${tag.toLowerCase()}>`);

/** SRT, WebVTT and ASS/SSA all use the same strict formatting whitelist. */
export function parseSubs(text) {
  return parseRawSubs(text).map(cue => ({ ...cue, text: sanitize(cue.text) }));
}

/** cues -> WebVTT (for the iOS native-fullscreen <track> fallback) */
export function toVTT(cues) {
  const f = t => { const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = (t % 60).toFixed(3).padStart(6, '0'); return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${s}`; };
  return 'WEBVTT\n\n' + cues.map(c => `${f(c.start)} --> ${f(c.end)}\n${c.text}`).join('\n\n');
}

/** Active cue texts at time t (binary search on start). */
export function cuesAt(cues, t) {
  let lo = 0, hi = cues.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (cues[mid].start <= t) lo = mid + 1; else hi = mid; }
  const out = [];
  for (let i = lo - 1; i >= 0 && i >= lo - 8; i--) if (cues[i].end > t) out.unshift(cues[i].text);
  return out;
}

// Legacy code page per subtitle language (ISO 639-1/2), tried when the file isn't valid UTF-8.
const CODEPAGE = [[/^(ar|ara|per|fas|urd)$/, 'windows-1256'], [/^(ru|rus|uk|ukr|bg|bul|sr|srp|mk|mac|mkd|be|bel)$/, 'windows-1251'],
  [/^(el|ell|gre)$/, 'windows-1253'], [/^(tr|tur)$/, 'windows-1254'], [/^(he|heb)$/, 'windows-1255']];
export function decodeSubs(buf, lang) {
  try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch {}
  const cp = (CODEPAGE.find(([re]) => re.test(String(lang || '').toLowerCase())) || [, 'windows-1252'])[1];
  return new TextDecoder(cp).decode(buf);
}

/** Downloads and parses a subtitle. A zip (SubDL season packs come straight from dl.subdl.com) is opened here and the
 *  episode named in the URL's #s=…&e=… is taken out of it. */
export async function loadSubFile(url, lang) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Subtitle download failed');
  let buf = new Uint8Array(await r.arrayBuffer());
  const { isZip, zipEntries, pickEntry, zipRead } = await import('../lib/zip.js');
  if (isZip(buf)) {
    const ep = new URLSearchParams(String(url).split('#')[1] || '');
    const entry = pickEntry(zipEntries(buf), ep.get('s'), ep.get('e'));
    if (!entry) throw new Error('No subtitle for this episode in that pack');
    buf = await zipRead(buf, entry);
  }
  return parseSubs(decodeSubs(buf, lang));
}

// Self-check: node js/player/subs.js
if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('subs.js')) {
  const assert = (await import('node:assert')).default;
  const c = parseSubs('1\n00:00:43,480 --> 00:00:48,646\n<font color="#808080">KELLER:</font> <i>Our Father</i>\n\n2\n00:00:49,280 --> 00:00:51,123\nThy kingdom\n');
  assert.equal(c.length, 2);
  assert.equal(c[0].text, '&lt;font color="#808080"&gt;KELLER:&lt;/font&gt; <i>Our Father</i>');
  assert.equal(c[0].start, 43.48);
  assert.deepEqual(cuesAt(c, 45), ['&lt;font color="#808080"&gt;KELLER:&lt;/font&gt; <i>Our Father</i>']);
  assert.deepEqual(cuesAt(c, 48.9), []);
  assert.ok(toVTT(c).startsWith('WEBVTT\n\n00:00:43.480 --> 00:00:48.646'));
  const a = parseSubs('[Script Info]\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.50,0:00:03.00,Default,,0,0,0,,{\\an8}Hello,\\Nworld\n');
  assert.deepEqual(a, [{ start: 1.5, end: 3, text: 'Hello,\nworld' }]);
  assert.equal(decodeSubs(new Uint8Array([0xc7, 0xe1]), 'ara'), 'ال');
  assert.ok(sameRelease('Daily.Dose.Of.Sunshine.S01.WEB.H264-RBB', 'Daily.Dose.of.Sunshine.S01E02.1080p.WEB.h264-RBB.mkv'));
  assert.ok(!sameRelease('Daily.Dose.Of.Sunshine.S01.WEB.H264-RBB', 'Daily.Dose.of.Sunshine.S01E02.1080p.WEB.h264-EDITH.mkv'));
  console.log('subs.js ok');
}
