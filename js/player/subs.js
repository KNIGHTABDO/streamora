// Subtitles: OpenSubtitles (Stremio addon, CORS ok) + SRT/VTT parsing for our own overlay.
// Embedded tracks inside the file can't be fetched separately from Real-Debrid; they are burned in
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

/** [{ id, lang, label, url }] for a movie id or an episode video id */
export async function openSubs(type, id) {
  try {
    const r = await fetch(`${OPENSUBS}/subtitles/${type}/${encodeURIComponent(id)}.json`);
    if (!r.ok) return [];
    const j = await r.json();
    return (j.subtitles || []).map(s => ({ id: 'os:' + s.id, lang: s.lang, label: langName(s.lang), release: s.movieReleaseName || s.subtitleFileName || '', url: s.url }));
  } catch { return []; }
}

const ts = s => {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[,.](\d{1,3})/.exec(s);
  return m ? (+(m[1] || 0)) * 3600 + (+m[2]) * 60 + (+m[3]) + (+m[4].padEnd(3, '0')) / 1000 : 0;
};

/** SRT or WebVTT text -> [{ start, end, text }] (text keeps <i>/<b>, drops other tags) */
export function parseSubs(text) {
  const out = [];
  const blocks = text.replace(/\r/g, '').replace(/^﻿/, '').split(/\n{2,}/);
  for (const b of blocks) {
    const lines = b.split('\n');
    const i = lines.findIndex(l => l.includes('-->'));
    if (i < 0) continue;
    const [a, z] = lines[i].split('-->');
    const body = lines.slice(i + 1).join('\n')
      .replace(/\{\\[^}]*\}/g, '')                      // ASS override tags
      .replace(/<(?!\/?[ib]>)[^>]+>/gi, '')             // keep only <i> <b>
      .trim();
    if (body) out.push({ start: ts(a), end: ts(z), text: body });
  }
  return out.sort((x, y) => x.start - y.start);
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

export async function loadSubFile(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Subtitle download failed');
  const buf = await r.arrayBuffer();
  let text = new TextDecoder('utf-8').decode(buf);
  if (text.includes('�')) text = new TextDecoder('windows-1252').decode(buf);
  return parseSubs(text);
}

// Self-check: node js/player/subs.js
if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('subs.js')) {
  const assert = (await import('node:assert')).default;
  const c = parseSubs('1\n00:00:43,480 --> 00:00:48,646\n<font color="#808080">KELLER:</font> <i>Our Father</i>\n\n2\n00:00:49,280 --> 00:00:51,123\nThy kingdom\n');
  assert.equal(c.length, 2);
  assert.equal(c[0].text, 'KELLER: <i>Our Father</i>');
  assert.equal(c[0].start, 43.48);
  assert.deepEqual(cuesAt(c, 45), ['KELLER: <i>Our Father</i>']);
  assert.deepEqual(cuesAt(c, 48.9), []);
  assert.ok(toVTT(c).startsWith('WEBVTT\n\n00:00:43.480 --> 00:00:48.646'));
  console.log('subs.js ok');
}
