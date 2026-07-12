// GET  /api/admin-pujol/newsletter/   → list campaigns (history)
// POST /api/admin-pujol/newsletter/   → save a draft campaign (no send)
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { getDB, ensureSchema, listCampaigns, createCampaign } from '../../../../lib/newsletter-db';

export const GET: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  return Response.json(await listCampaigns(db));
};

export const POST: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });
  const db = await getDB();
  await ensureSchema(db);
  const body = await request.json().catch(() => ({} as any));
  const data = body.data || {};
  const created = await createCampaign(db, {
    subject: body.subject || data.subject || 'Sans objet',
    preheader: body.preheader || data.preheader || '',
    template: body.template || 'blog',
    intro: data.intro || '', outro: data.outro || '',
    article_slugs: Array.isArray(data.articles) ? data.articles.map((a: any) => a.slug).filter(Boolean) : [],
    content_json: data,
    status: 'draft',
  }, admin);
  return Response.json(created, { status: 201 });
};
