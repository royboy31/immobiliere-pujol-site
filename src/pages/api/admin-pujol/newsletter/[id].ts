// GET    /api/admin-pujol/newsletter/:id  → one campaign (for re-open/stats)
// PUT    /api/admin-pujol/newsletter/:id  → update a draft in place (re-edit)
// DELETE /api/admin-pujol/newsletter/:id  → delete a campaign log row
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { getDB, ensureSchema, getCampaign, updateCampaign, deleteCampaign } from '../../../../lib/newsletter-db';

export const GET: APIRoute = async ({ request, params }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const campaign = await getCampaign(db, Number(params.id));
  if (!campaign) return new Response('Not found', { status: 404 });
  return Response.json(campaign);
};

export const PUT: APIRoute = async ({ request, params }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const id = Number(params.id);
  const existing = await getCampaign(db, id);
  if (!existing) return new Response('Not found', { status: 404 });
  // A newsletter that already went out is a historical record, not a draft.
  if (existing.status === 'sent')
    return Response.json({ ok: false, error: 'Une newsletter déjà envoyée ne peut pas être modifiée.' }, { status: 409 });

  const body: any = await request.json().catch(() => ({}));
  const data = body.data || {};
  const updated = await updateCampaign(db, id, {
    subject: body.subject || data.subject || 'Sans objet',
    preheader: body.preheader || data.preheader || '',
    template: body.template || 'blog',
    intro: data.intro || '', outro: data.outro || '',
    article_slugs: Array.isArray(data.articles) ? data.articles.map((a: any) => a.slug).filter(Boolean) : [],
    content_json: data,
    status: 'draft',
  });
  return Response.json(updated);
};

export const DELETE: APIRoute = async ({ request, params }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const ok = await deleteCampaign(db, Number(params.id));
  return Response.json({ ok });
};
