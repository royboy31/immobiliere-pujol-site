// POST /api/admin-pujol/pages/upload-file/  (guarded)
// Accepts a multipart file field "file" holding a PDF, stores it in the R2 PHOTOS
// bucket under documents/<year>/<ts>-<slug>.pdf, and returns a root-relative URL
// served by /media/[...path]. Root-relative so the same stored HTML works on
// localhost and in production without any per-environment URL rewriting.
//
// Sits next to [id].ts: a static segment outranks the dynamic route, so
// /api/admin-pujol/pages/upload-file/ lands here and never reaches [id].ts —
// the same pairing articles/ already uses for upload-image.ts.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { slugify } from '../../../../lib/blog-db';

const MAX_BYTES = 20 * 1024 * 1024; // 20 MB — legal PDFs run larger than blog images

export const POST: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const { env } = await import('cloudflare:workers');
  const photos = (env as any).PHOTOS as R2Bucket;
  if (!photos) return new Response('R2 binding missing', { status: 500 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return new Response('No file', { status: 400 });

  if (file.type !== 'application/pdf') return new Response('Seuls les fichiers PDF sont acceptés', { status: 415 });
  if (file.size > MAX_BYTES) return new Response('PDF trop lourd (max 20 Mo)', { status: 413 });

  // Trust the bytes, not the browser-declared type: a renamed .doc still arrives
  // as application/pdf. We hardcode the stored contentType below, so a mislabeled
  // file would otherwise be served as a PDF that no reader can open.
  // (Length-checked first: a truncated/empty upload would make the 5-byte view throw.)
  const bytes = await file.arrayBuffer();
  const magic = bytes.byteLength >= 5 ? new TextDecoder().decode(new Uint8Array(bytes, 0, 5)) : '';
  if (magic !== '%PDF-') return new Response('Ce fichier n’est pas un PDF valide', { status: 415 });

  const base = slugify(file.name.replace(/\.[^.]+$/, '')) || 'document';
  const year = new Date().getFullYear();
  const key = `documents/${year}/${Date.now()}-${base}.pdf`;

  await photos.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } });

  // Trailing slash: the site is trailingSlash:'always', so /media/<key>/ is the
  // canonical, routable path (without it the request falls through to the 404 route).
  return Response.json({ ok: true, key, url: `/media/${key}/`, name: file.name }, { status: 201 });
};
