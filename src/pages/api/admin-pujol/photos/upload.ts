// POST /api/admin-pujol/photos/upload/  (guarded)
// Multipart "file" (already resized in the browser). Width and height are read from the image header,
// never from the form; a truncated or malformed file (incomplete container) is refused. Stores it in R2 PHOTOS under
// lp-proposition/<sha256>.<ext> and returns the Photo to save as a draft. The key is the hash of the
// bytes: a new file always gets a new key (immutable cache stays correct), and the same file uploaded
// twice gets the same key, which is what the "same photo used twice" warning compares.
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { imageLooksComplete, imageSize, sniffImage } from '../../../../lib/image-sniff';
import { validatePhoto } from '../../../../lib/lp-photos';

const MAX_BYTES = 8 * 1024 * 1024;
const ALLOWED = new Set(['webp', 'jpg', 'png']);

export const POST: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const { env } = await import('cloudflare:workers');
  const photos = (env as any).PHOTOS as R2Bucket;
  if (!photos) return new Response('R2 binding missing', { status: 500 });

  const form = await request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) return new Response('Aucun fichier reçu', { status: 400 });
  if (file.size > MAX_BYTES) return new Response('Photo trop lourde (max 8 Mo)', { status: 413 });

  const bytes = await file.arrayBuffer();
  const kind = sniffImage(bytes);
  if (!kind || !ALLOWED.has(kind.ext)) return new Response('Format non supporté (JPEG, PNG ou WebP)', { status: 415 });

  const size = imageSize(bytes, kind.ext);
  if (!size || !imageLooksComplete(bytes, kind.ext)) return new Response('Image illisible ou abîmée', { status: 415 });

  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const key = `lp-proposition/${hash}.${kind.ext}`;
  const photo = validatePhoto({ src: `/media/${key}/`, w: size.w, h: size.h });
  if (typeof photo === 'string') return new Response(photo, { status: 400 });

  if (!(await photos.head(key))) await photos.put(key, bytes, { httpMetadata: { contentType: kind.type } });
  return Response.json({ ok: true, photo }, { status: 201 });
};
