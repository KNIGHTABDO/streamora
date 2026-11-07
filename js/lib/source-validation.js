// Small rejection cache. Playback metadata is reused, never fetched a second time for validation.
import { ls, progress } from '../core/store.js';
import { baseName, expectedIdentity, sourceIssue } from './source-identity.js';

const KEY = 'source-rejections-v1', TTL = 7 * 864e5;
let rejected;
const entries = () => {
  if (!rejected) {
    const saved = ls.get(KEY, {});
    rejected = saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  }
  return rejected;
};
const keyOf = (target, source) => JSON.stringify([target?.id, target?.videoId, target?.duration, String(source.infoHash || '').toLowerCase(), baseName(source.filename)]);
export function rejectedSource(target, source) {
  const hit = entries()[keyOf(target, source)];
  return hit && Date.now() - hit.at < TTL ? hit.reason : null;
}
export function rejectSource(target, source, reason) {
  if (!target || !source?.infoHash) return;
  const rows = entries();
  const record = { at: Date.now(), reason };
  rows[keyOf(target, source)] = record;
  if ('candidateFilename' in source) rows[keyOf(target, { ...source, filename: source.candidateFilename })] = record;
  Object.keys(rows).sort((a, b) => rows[b].at - rows[a].at).slice(100).forEach(k => delete rows[k]);
  ls.set(KEY, rows);
}
export function assessSources(list, target) {
  return list.map(source => ({ ...source, mismatch: sourceIssue(source, target) || rejectedSource(target, source) }))
    .sort((a, b) => Number(!!a.mismatch) - Number(!!b.mismatch));
}

export function invalidateRememberedSource(target, source) {
  if (!target || !source?.infoHash) return;
  const old = progress.get()[target.id];
  if (old?.source?.infoHash?.toLowerCase() !== source.infoHash.toLowerCase()) return;
  if (old.source.filename && source.filename && baseName(old.source.filename) !== baseName(source.filename)) return;
  progress.update(rows => {
    const entry = rows[target.id];
    entry.source = null;
    if ((entry.last || '') === target.videoId && entry.eps?.[target.videoId || '_']) entry.eps[target.videoId || '_'].sourceMismatch = true;
    entry.updated = Date.now();
    return rows;
  });
}

// Same policy for HTMLMediaElement and VlcVideo. One check per changed duration, no polling or requests.
export function watchIdentity(media, { meta, video, source, noProgress, onMismatch }) {
  const target = noProgress ? null : expectedIdentity(meta, video);
  let stopped = false, last = 0, seen = !target;
  const check = () => {
    if (stopped) return false;
    const duration = media.duration;
    if (!(duration > 0 && Number.isFinite(duration))) return !target?.duration;
    seen = true;
    if (duration === last) return true;
    last = duration;
    const issue = sourceIssue({ filename: media.filename || source?.filename, ...source }, target, duration);
    if (!issue) return true;
    stopped = true; // pause emits synchronous events; suppress progress before pausing
    rejectSource(target, source, issue);
    media.pause();
    onMismatch(issue);
    return false;
  };
  media.addEventListener('loadedmetadata', check);
  media.addEventListener('durationchange', check);
  if (media.readyState >= 1) check();
  return {
    check,
    failed: () => stopped,
    allowed: () => !stopped && (seen || !target?.duration),
    stop: () => { media.removeEventListener('loadedmetadata', check); media.removeEventListener('durationchange', check); },
  };
}
