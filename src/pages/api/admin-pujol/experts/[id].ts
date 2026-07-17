// GET    /api/admin-pujol/experts/:id  → one expert
// PUT    /api/admin-pujol/experts/:id  → update
// DELETE /api/admin-pujol/experts/:id  → delete
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { getDB, ensureSchema, getExpert, updateExpert, deleteExpert } from '../../../../lib/experts-db';

export const GET: APIRoute = async ({ request, params }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const expert = await getExpert(db, Number(params.id));
  if (!expert) return new Response('Not found', { status: 404 });
  return Response.json(expert);
};

export const PUT: APIRoute = async ({ request, params }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const input = await request.json().catch(() => ({}));
  const updated = await updateExpert(db, Number(params.id), input);
  if (!updated) return new Response('Not found', { status: 404 });
  return Response.json(updated);
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const ok = await deleteExpert(db, Number(params.id));
  return Response.json({ ok });
};
