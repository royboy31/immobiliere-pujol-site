// GET /media/<key>  — public. Streams an object from the R2 PHOTOS bucket.
// Used for blog images uploaded via the admin editor. Works identically in local
// dev (Miniflare R2) and production (real R2) — no public-URL/env branching.
export const prerender = false;

import type { APIRoute } from 'astro';

export const GET: APIRoute = async ({ params }) => {
  const key = params.path;
  if (!key) return new Response('Not found', { status: 404 });

  const { env } = await import('cloudflare:workers');
  const photos = (env as any).PHOTOS as R2Bucket;
  if (!photos) return new Response('R2 binding missing', { status: 500 });

  const obj = await photos.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  const headers = new Headers();
  headers.set('content-type', obj.httpMetadata?.contentType || 'application/octet-stream');
  headers.set('cache-control', 'public, max-age=31536000, immutable');
  if (obj.httpEtag) headers.set('etag', obj.httpEtag);
  return new Response(obj.body, { headers });
};
