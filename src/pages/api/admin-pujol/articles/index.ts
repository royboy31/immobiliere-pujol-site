// GET  /api/admin-pujol/articles/       → list all articles
// POST /api/admin-pujol/articles/       → create an article
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { getDB, ensureSchema, listArticles, createArticle } from '../../../../lib/blog-db';
import { resolveArticleStatus } from '../../../../lib/blog-workflow';

export const GET: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  return Response.json(await listArticles(db));
};

export const POST: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const input = await request.json().catch(() => ({})) as any;
  let status;
  try { status = resolveArticleStatus('draft', input.status_action); }
  catch (error: any) { return new Response(error.message, { status: 400 }); }
  // Status is derived from the explicit action. A forged `status` field cannot
  // publish or unpublish an article through the normal save request.
  const created = await createArticle(db, { ...input, status }, admin);
  return Response.json(created, { status: 201 });
};
