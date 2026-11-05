// Intro / credits times for anime from AniSkip (Kitsu id -> MyAnimeList id -> skip times). Cached per session.
// skipTimes(meta, video) -> { op: [start, end] | null, ed: [start, end] | null } | null (not anime / unknown)

const cache = (k, f) => async () => {
  try { const hit = sessionStorage.getItem(k); if (hit) return JSON.parse(hit); } catch {}
  const v = await f();
  try { sessionStorage.setItem(k, JSON.stringify(v)); } catch {}
  return v;
};

const malOf = (kitsuId, signal) => cache('skip:mal:' + kitsuId, async () => {
  const r = await fetch(`https://kitsu.io/api/edge/anime/${kitsuId}/mappings?filter[externalSite]=myanimelist/anime`, { signal });
  if (!r.ok) throw new Error('kitsu ' + r.status);
  const j = await r.json();
  const m = (j.data || []).find(x => x.attributes && x.attributes.externalSite === 'myanimelist/anime');
  return m ? m.attributes.externalId : null;
})();

export async function skipTimes(meta, video, { signal } = {}) {
  if (signal?.aborted) return null;
  const kitsu = /^kitsu:(\d+)/.exec(String((video && video.id) || (meta && meta.id) || ''));
  if (!kitsu) return null;
  const ep = (video && video.episode) || 1;
  try {
    const mal = await malOf(kitsu[1], signal);
    if (signal?.aborted) return null;
    if (!mal) return null;
    return await cache(`skip:${mal}:${ep}`, async () => {
      const r = await fetch(`https://api.aniskip.com/v2/skip-times/${mal}/${ep}?types[]=op&types[]=ed&episodeLength=0`, { signal });
      if (!r.ok) return { op: null, ed: null };      // 404 = nobody submitted times yet
      const j = await r.json();
      const get = t => { const x = (j.results || []).find(y => y.skipType === t); return x ? [x.interval.startTime, x.interval.endTime] : null; };
      return { op: get('op'), ed: get('ed') };
    })();
  } catch { return null; }
}
