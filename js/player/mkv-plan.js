// Capability and track selection helpers; safe to import without a DOM.
export const canRemuxMkv = () => typeof window !== 'undefined' && !!(window.MediaSource || window.ManagedMediaSource);
export function hevcInMse() {
  const MS = typeof window !== 'undefined' && (window.MediaSource || window.ManagedMediaSource);
  return !!MS?.isTypeSupported?.('video/mp4; codecs="hvc1.1.6.L120.90"');
}

export function planAudio(tracks, prefLang, encodeTarget) {
  if (!tracks.length) return { id: null, mode: 'none' };
  const playable = tracks.filter(t => t.mseOk || (t.canDecode && encodeTarget));
  const track = playable.find(t => prefLang && t.languageCode === prefLang) || playable[0];
  if (!track) return null;
  return track.mseOk ? { id: track.id, mode: 'copy' } : { id: track.id, mode: 'transcode', codec: encodeTarget };
}
