// GET  /api/admin-pujol/experts/       → list all experts
// POST /api/admin-pujol/experts/       → create an expert
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { getDB, ensureSchema, listExperts, createExpert } from '../../../../lib/experts-db';

export const GET: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  return Response.json(await listExperts(db));
};

export const POST: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const input = await request.json().catch(() => ({}));
  const created = await createExpert(db, input, admin);
  return Response.json(created, { status: 201 });
};
