// Cheap, synchronous checks shared by discovery, file selection and the players. No network or storage.
export const VIDEO_FILE = /\.(mkv|mp4|m4v|avi|mov|webm|ts|m2ts|wmv|flv|mpg|mpeg)$/i;
const EXTRA = /(?:^|[\W_])(sample|trailer|featurette|extras?)(?:[\W_]|$)/i;
export const baseName = path => String(path || '').split(/[\\/]/).pop().toLowerCase();
const positive = x => typeof x === 'number' && Number.isFinite(x) && x > 0 && x < 7 * 86400;
const unique = values => [...new Set(values)];

// Addon durations are seconds. Catalog runtime numbers and strings are minutes.
export function runtimeSeconds(value) {
  if (typeof value === 'number') return positive(value * 60) ? value * 60 : 0;
  const text = String(value || '').trim();
  if (/^\d+(?:\.\d+)?(?:\s*min(?:utes?)?)?$/i.test(text)) return runtimeSeconds(parseFloat(text));
  const m = /^(?:(\d+)\s*h(?:ours?)?\s*)?(?:(\d+)\s*m(?:in(?:utes?)?)?)?$/i.exec(text);
  const n = m ? (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 : 0;
  return positive(n) ? n : 0;
}

export function expectedIdentity(meta, video) {
  if (!meta) return null;
  const series = meta.type === 'series' || !!video;
  return {
    id: meta.id, videoId: video?.id || '', name: meta.name || '', series, anime: !!meta.anime,
    year: series ? 0 : parseInt(meta.year || meta.releaseInfo, 10) || 0,
    season: video?.season, episode: video?.episode,
    // An average series runtime would reject legitimate long finales and short specials.
    duration: runtimeSeconds(series ? video?.runtime : meta.runtime),
  };
}

export function identityEvidence(stream, provider) {
  const hints = stream.behaviorHints || {};
  const imdb = stream.imdbId || stream.imdb_id || hints.imdbId;
  const array = value => Array.isArray(value) ? value : [];
  return {
    durations: unique([...array(stream.durations), hints.duration].filter(positive)).slice(0, 8),
    contentIds: unique([...array(stream.contentIds), imdb].filter(id => typeof id === 'string' && /^tt\d+$/.test(id))).slice(0, 8),
    providers: unique([...array(stream.providers), provider].filter(name => typeof name === 'string' && name)).slice(0, 8),
  };
}

// A torrent can contain several films/episodes. Do not merge their file evidence together.
export function sourceFileKey(stream) {
  const filename = stream.filename || stream.behaviorHints?.filename;
  return `${String(stream.infoHash || '').toLowerCase()}|${filename ? baseName(filename) : `#${stream.fileIdx ?? ''}`}`;
}
export function mergeSourceEvidence(first, next) {
  return {
    ...first,
    cached: first.cached || next.cached,
    durations: unique([...(first.durations || []), ...(next.durations || [])]).slice(0, 8),
    contentIds: unique([...(first.contentIds || []), ...(next.contentIds || [])]).slice(0, 8),
    providers: unique([...(first.providers || []), ...(next.providers || [])]).slice(0, 8),
  };
}

// null means there is no explicit episode marker; false means a contradictory marker.
export function episodeMatches(filename, season, episode, anime = false) {
  const name = baseName(filename);
  const m = /(?:^|[\W_])s(\d{1,3})[ ._-]?e(\d{1,4})(?!\d)|(?:^|[\W_])(\d{1,3})x(\d{1,4})(?!\d)/i.exec(name);
  if (m) return (season == null || +(m[1] || m[3]) === +season) && +(m[2] || m[4]) === +episode;
  if (anime || season == null) {
    const a = /(?:\s-\s|(?:^|[\W_])(?:ep?|episode)[ ._-]?)(\d{1,4})(?:v\d)?(?=[\W_]|$)/i.exec(name.replace(VIDEO_FILE, ''));
    if (a) return +a[1] === +episode;
  }
  return null;
}

export function durationIssue(expected, actual, extended = false) {
  if (!positive(expected) || !positive(actual)) return null;
  // Allow normal cuts, credits, PAL speed-up and rounded catalog data. Only clear conflicts are blocked.
  const tolerance = Math.max(expected < 3600 ? 180 : 600, expected * (extended && actual > expected ? .60 : .20));
  return Math.abs(actual - expected) > tolerance
    ? `This copy is ${Math.round(actual / 60)} min; expected about ${Math.round(expected / 60)} min.` : null;
}

export function sourceIssue(source, target, actualDuration) {
  if (!target) return null;
  const filenames = [source.filename || source.release].filter(Boolean);
  const ids = [...(source.contentIds || []), ...filenames.flatMap(f => [...f.matchAll(/\bimdb[ -]*(tt\d+)\b/gi)].map(m => m[1]))];
  if (ids.some(id => /^tt\d+$/.test(target.id) && id !== target.id)) return 'This copy belongs to a different title.';
  for (const filename of filenames) {
    // Do not reject a movie actually named "Trailer" or "Prologue".
    const extra = /(?:^|[\W_])(sample|trailer|prologue|featurette|extras?)(?:[\W_]|$)/i.exec(filename);
    if (extra && !new RegExp(`\\b${extra[1]}\\b`, 'i').test(target.name)) return 'This is a preview or extra, rather than the full title.';
    if (target.episode != null && episodeMatches(filename, target.season, target.episode, target.anime) === false) return 'This copy contains a different episode.';
    if (!target.series && target.year) {
      // Only unambiguous release years before technical metadata; numeric movie titles must survive.
      const head = filename.split(/\b(?:2160p|1080p|720p|480p|bluray|brrip|webrip|web-dl)\b/i)[0];
      const titleYears = new Set(target.name.match(/\b(?:19|20)\d{2}\b/g) || []);
      const years = [...head.matchAll(/(?:[ ._(\[-])((?:19|20)\d{2})(?=[ ._)\]-]|$)/g)].filter(m => !titleYears.has(m[1]));
      const year = years.length && +years.at(-1)[1];
      if (year && Math.abs(year - target.year) > 1) return `This copy is from ${year}; the selected film is from ${target.year}.`;
    }
  }
  const durations = actualDuration != null ? [actualDuration] : source.durations || [];
  const extended = /\bextended\b|director'?s[ ._-]*cut|\bunrated\b/i.test(source.filename || source.release || '');
  for (const duration of durations) { const issue = durationIssue(target.duration, duration, extended); if (issue) return issue; }
  return null;
}

export const contentError = message => Object.assign(new Error(message), { code: 'content_mismatch' });

export function selectVideoFile(files, { filename, season, episode, anime = false, identity } = {}) {
  const videos = files.filter(f => {
    const extra = EXTRA.exec(baseName(f.path));
    return VIDEO_FILE.test(f.path) && (!extra || new RegExp(`\\b${extra[1]}\\b`, 'i').test(identity?.name || ''));
  });
  const matching = filename && videos.find(f => baseName(f.path) === baseName(filename));
  if (episode != null) {
    if (matching && episodeMatches(matching.path, season, episode, anime) !== false) return matching;
    const matches = videos.filter(f => episodeMatches(f.path, season, episode, anime) === true);
    if (matches.length === 1) return matches[0];
    return null;
  }
  if (matching) return matching;
  if (filename) return null;
  // An addon index is not a TorBox file ID. A multi-film pack needs an advertised path.
  return videos.length === 1 ? videos[0] : null;
}
