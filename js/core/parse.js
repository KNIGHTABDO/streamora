// Release file name -> structured info. Real-Debrid's own metadata guesses are unreliable,
// so the My Real-Debrid page matches files to Cinemeta/Kitsu using this.
// parse('Reacher.S04E05.Bridge.1080p.HEVC.x265-MeGusta[EZTVx.to].mkv')
//  -> { title:'Reacher', year:null, season:4, episode:5, quality:'1080p', hevc:true, hdr:false, group:'MeGusta', type:'series' }

const QUAL = /\b(2160p|4k|uhd|1440p|1080p|720p|576p|480p)\b/i;

export function parse(name) {
  let s = String(name || '').replace(/\.[a-z0-9]{2,4}$/i, '');
  const info = { raw: name, title: '', year: null, season: null, episode: null, quality: null, hevc: false, hdr: false, group: null, type: 'movie' };

  const q = QUAL.exec(s); if (q) info.quality = /4k|uhd/i.test(q[1]) ? '2160p' : q[1].toLowerCase();
  info.hevc = /x265|hevc|h\.?265/i.test(s);
  info.hdr = /\bhdr|\bdv\b|dolby.?vision/i.test(s);
  const g = /-([A-Za-z0-9]+)(?:\[[^\]]*\])?$/.exec(s); if (g) info.group = g[1];

  // strip leading [Group] tags (anime) and bracketed junk
  const animeGroup = /^\[([^\]]+)\]\s*/.exec(s);
  if (animeGroup) { info.group = animeGroup[1]; s = s.slice(animeGroup[0].length); }

  const patterns = [
    [/[ ._-]S(\d{1,2})[ ._-]?E(\d{1,3})/i, m => ({ season: +m[1], episode: +m[2] })],
    [/[ ._-](\d{1,2})x(\d{2,3})\b/i, m => ({ season: +m[1], episode: +m[2] })],
    [/\[?Cap\.?\s?(\d)(\d{2})\]?/i, m => ({ season: +m[1], episode: +m[2] })],           // Spanish "Cap.404"
    [/[ ._-]S(\d{1,2})(?![0-9E])/i, m => ({ season: +m[1] })],                              // season pack
    [/\s-\s(\d{1,4})(?:v\d)?(?:\s|$|\[|\()/i, m => ({ episode: +m[1] })],                  // anime " - 05 "
  ];
  let cut = s.length;
  for (const [re, f] of patterns) {
    const m = re.exec(s);
    if (m) { Object.assign(info, f(m)); cut = Math.min(cut, m.index); info.type = 'series'; break; }
  }
  const y = /[ .(\[_-]((?:19|20)\d{2})(?:[ .)\]_-]|$)/.exec(s);
  if (y && y.index > 0) { info.year = +y[1]; cut = Math.min(cut, y.index); }
  const qi = s.search(QUAL); if (qi > 0) cut = Math.min(cut, qi);
  const bi = s.search(/\s*[\[(]/); if (bi > 0) cut = Math.min(cut, bi);

  info.title = s.slice(0, cut).replace(/[._]+/g, ' ').replace(/\s+-\s*$/, '').replace(/\s+/g, ' ').trim();
  if (animeGroup && info.episode != null) info.anime = true;
  return info;
}

// Self-check: node js/core/parse.js
if (typeof process !== 'undefined' && process.argv && process.argv[1] && process.argv[1].endsWith('parse.js')) {
  const assert = (await import('node:assert')).default;
  const a = parse('Reacher.S04E05.Bridge.1080p.HEVC.x265-MeGusta[EZTVx.to].mkv');
  assert.deepEqual([a.title, a.season, a.episode, a.quality, a.hevc, a.group], ['Reacher', 4, 5, '1080p', true, 'MeGusta']);
  const b = parse('Prisoners.2013.1080p.BluRay.DDP5.1.x265.10bit-GalaxyRG265.mkv');
  assert.deepEqual([b.title, b.year, b.type], ['Prisoners', 2013, 'movie']);
  const c = parse("The Shadow's Edge (2025) 2160p H265 HDR DV iTA Chi EAC3 Sub EnG-MIRCrew.mkv");
  assert.deepEqual([c.title, c.year, c.quality, c.hdr], ["The Shadow's Edge", 2025, '2160p', true]);
  const d = parse('Reacher [4k 2160p][Cap.404].mkv');
  assert.deepEqual([d.title, d.season, d.episode], ['Reacher', 4, 4]);
  const e = parse('[SubsPlease] Frieren - 05 (1080p) [ABCD1234].mkv');
  assert.deepEqual([e.title, e.episode, e.anime], ['Frieren', 5, true]);
  const f = parse('The.Odyssey.Prologue.2025.IMAX.2D.4K.ProRes.4444.5.1.Ch.PCM-hutaoing.mov');
  assert.deepEqual([f.title, f.year], ['The Odyssey Prologue', 2025]);
  console.log('parse.js ok');
}
