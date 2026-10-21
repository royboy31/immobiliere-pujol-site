// POST /api/admin-pujol/articles/:id/restore → restore an article from trash
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../../lib/admin-guard';
import { getDB, ensureSchema, restoreArticle } from '../../../../../lib/blog-db';

export const POST: APIRoute = async ({ request, params }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const ok = await restoreArticle(db, Number(params.id));
  if (!ok) return new Response('Not found', { status: 404 });
  return Response.json({ ok });
};
