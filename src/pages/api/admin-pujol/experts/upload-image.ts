// POST /api/admin-pujol/experts/upload-image/  (guarded)
// Accepts a multipart file field "file", stores it in the R2 PHOTOS bucket under
// experts/<year>/<ts>-<slug>.<ext>, and returns a root-relative URL served by
// /media/[...path]. Same pattern as the blog upload endpoint (kept separate so
// expert photos land under experts/ and the blog endpoint stays untouched).
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { slugify } from '../../../../lib/experts-db';
import { sniffImage } from '../../../../lib/image-sniff';

const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

export const POST: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const { env } = await import('cloudflare:workers');
  const photos = (env as any).PHOTOS as R2Bucket;
  if (!photos) return new Response('R2 binding missing', { status: 500 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return new Response('No file', { status: 400 });

  if (file.size > MAX_BYTES) return new Response('Image trop lourde (max 8 Mo)', { status: 413 });

  // The bytes decide the format, not file.type: that is the browser's guess and
  // it is '' on OS/browser combos with no MIME mapping, which rejected valid
  // images outright. Sniffing is also what makes the stored contentType honest.
  const bytes = await file.arrayBuffer();
  const kind = sniffImage(bytes);
  if (!kind) return new Response('Type d’image non supporté (PNG, JPEG, WebP, GIF ou AVIF)', { status: 415 });

  const base = slugify(file.name.replace(/\.[^.]+$/, '')) || 'photo';
  const year = new Date().getFullYear();
  const key = `experts/${year}/${Date.now()}-${base}.${kind.ext}`;

  await photos.put(key, bytes, { httpMetadata: { contentType: kind.type } });

  // Trailing slash: the site is trailingSlash:'always', so /media/<key>/ is the
  // canonical, routable path (without it the request falls through to the 404 route).
  return Response.json({ ok: true, key, url: `/media/${key}/` }, { status: 201 });
};
