// Catalogs only: full metadata (including episodes) still comes directly from Cinemeta.
const FIELDS = ['id', 'type', 'name', 'poster', 'background', 'logo', 'description', 'releaseInfo', 'year', 'imdbRating', 'genres', 'runtime'];
export const slimCatalog = data => ({ metas: (Array.isArray(data?.metas) ? data.metas : []).map(m =>
  Object.fromEntries(FIELDS.filter(k => m[k] !== undefined).map(k => [k, m[k]]))) });
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': status === 200 ? 'public, max-age=300, s-maxage=21600' : 'no-store' },
});
export async function onRequest({ request }) {
  if (request.method !== 'GET') return json({ error: 'method' }, 405);
  const url = new URL(request.url), path = url.pathname.slice('/api/catalog/'.length);
  if (!/^(movie|series)\/[^/]+(?:\/[^/]+)?\.json$/.test(path)) return json({ error: 'catalog_path' }, 400);
  try {
    const r = await fetch(`https://cinemeta-catalogs.strem.io/catalog/${path}${url.search}`, {
      signal: request.signal, cf: { cacheTtl: 21600, cacheEverything: true },
    });
    if (!r.ok) return json({ error: 'upstream' }, 502);
    const data = await r.json();
    if (!Array.isArray(data?.metas)) return json({ error: 'upstream' }, 502);
    return json(slimCatalog(data));
  } catch { return json({ error: 'upstream' }, 502); }
}
