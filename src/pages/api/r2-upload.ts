// Temporary admin upload endpoint. Removed after initial image migration.
// Key is passed in X-R2-Key header (as base64) to avoid CF WAF blocks on
// unicode URL paths.

export const prerender = false;

import type { APIRoute } from 'astro';

function decodeKey(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const bytes = Uint8Array.from(atob(raw), c => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return null;
  }
}

export const PUT: APIRoute = async ({ request }) => {
  const { env } = await import('cloudflare:workers');
  const e = env as any;

  const token = request.headers.get('x-upload-token') || '';
  if (!token || token !== e.UPLOAD_TOKEN) {
    return new Response('unauthorized', { status: 401 });
  }

  const key = decodeKey(request.headers.get('x-r2-key'));
  if (!key) return new Response('missing or bad x-r2-key (base64 utf-8)', { status: 400 });
  if (!e.PHOTOS) return new Response('R2 binding missing', { status: 500 });

  const body = await request.arrayBuffer();
  const contentType = request.headers.get('content-type') || 'application/octet-stream';

  await e.PHOTOS.put(key, body, { httpMetadata: { contentType } });

  return new Response(JSON.stringify({ ok: true, key, size: body.byteLength }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
};

export const GET: APIRoute = async ({ request }) => {
  const { env } = await import('cloudflare:workers');
  const e = env as any;
  const key = decodeKey(request.headers.get('x-r2-key'));
  if (!key || !e.PHOTOS) return new Response('bad', { status: 400 });
  const obj = await e.PHOTOS.head(key);
  if (!obj) return new Response('not found', { status: 404 });
  return new Response(JSON.stringify({ key, size: obj.size }), {
    status: 200, headers: { 'content-type': 'application/json' },
  });
};
