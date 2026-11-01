// Cloudflare Pages ignores Range on static files, and Safari and the iOS app refuse to play a video without it.
// Answers Range requests for the films; everything else under /media is served as normal static files.
export async function onRequest({ request, env, next }) {
  const url = new URL(request.url);
  if (!url.pathname.endsWith('.mp4') || !['GET', 'HEAD'].includes(request.method)) return next();
  const asset = await env.ASSETS.fetch(new Request(url.origin + url.pathname));
  if (!asset.ok) return asset;
  const headers = new Headers({
    'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=31536000, immutable',
    'X-Content-Type-Options': 'nosniff',
  });
  const match = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('Range') || '');
  if (!match || (!match[1] && !match[2])) {
    const len = asset.headers.get('Content-Length');
    if (len) headers.set('Content-Length', len);
    return new Response(request.method === 'HEAD' ? null : asset.body, { status: 200, headers });
  }
  const data = await asset.arrayBuffer();
  const size = data.byteLength;
  const start = match[1] ? +match[1] : Math.max(0, size - +match[2]);
  const end = match[1] && match[2] ? Math.min(+match[2], size - 1) : size - 1;
  if (start >= size || start > end) return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
  headers.set('Content-Range', `bytes ${start}-${end}/${size}`);
  headers.set('Content-Length', String(end - start + 1));
  return new Response(request.method === 'HEAD' ? null : data.slice(start, end + 1), { status: 206, headers });
}
