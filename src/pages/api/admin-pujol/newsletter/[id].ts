// GET    /api/admin-pujol/newsletter/:id  → one campaign (for re-open/stats)
// DELETE /api/admin-pujol/newsletter/:id  → delete a campaign log row
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { getDB, ensureSchema, getCampaign, deleteCampaign } from '../../../../lib/newsletter-db';

export const GET: APIRoute = async ({ request, params }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const campaign = await getCampaign(db, Number(params.id));
  if (!campaign) return new Response('Not found', { status: 404 });
  return Response.json(campaign);
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const ok = await deleteCampaign(db, Number(params.id));
  return Response.json({ ok });
};
