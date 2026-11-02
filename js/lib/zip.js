// Reading subtitle zips (season packs) and picking the episode's file. Used by the browser (SubDL downloads)
// and by functions/api/subs (SubSource downloads). Stored + deflate entries, no zip64.

const SUB_EXT = /\.(srt|ass|ssa|vtt|sub)$/i;

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

// ------------------------------------------------------------------ zip
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


export const isZip = u8 => u8.length > 4 && u8[0] === 0x50 && u8[1] === 0x4b && u8[2] === 3 && u8[3] === 4;
