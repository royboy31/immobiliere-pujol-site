// GET  /api/admin-pujol/experts/       → list all experts
// POST /api/admin-pujol/experts/       → create an expert
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { TranslatedContentError } from '../../../../lib/translation-guard';
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
  let created;
  try { created = await createExpert(db, input, admin); }
  catch (e) { if (e instanceof TranslatedContentError) return new Response(e.message, { status: 422 }); throw e; }
  return Response.json(created, { status: 201 });
};
