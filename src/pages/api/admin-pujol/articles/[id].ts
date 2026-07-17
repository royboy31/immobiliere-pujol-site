// GET    /api/admin-pujol/articles/:id  → one article
// PUT    /api/admin-pujol/articles/:id  → update
// DELETE /api/admin-pujol/articles/:id  → delete
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { getDB, ensureSchema, getArticle, updateArticle, deleteArticle } from '../../../../lib/blog-db';

export const GET: APIRoute = async ({ request, params }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const article = await getArticle(db, Number(params.id));
  if (!article) return new Response('Not found', { status: 404 });
  return Response.json(article);
};

export const PUT: APIRoute = async ({ request, params }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const input = await request.json().catch(() => ({}));
  const updated = await updateArticle(db, Number(params.id), input);
  if (!updated) return new Response('Not found', { status: 404 });
  return Response.json(updated);
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const ok = await deleteArticle(db, Number(params.id));
  return Response.json({ ok });
};
