export const prerender = false;
import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { getDB, ensureSchema, getPage, updatePage } from '../../../../lib/pages-db';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

export const GET: APIRoute = async ({ request, params }) => {
  if (!(await requireAdmin(request))) return json({ error: 'unauthorized' }, 401);
  const id = Number(params.id);
  if (!Number.isFinite(id)) return json({ error: 'invalid id' }, 400);

  try {
    const db = await getDB();
    await ensureSchema(db);
    const page = await getPage(db, id);
    return page ? json(page) : json({ error: 'not found' }, 404);
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
};

/**
 * Update a legal page. Only title / SEO / body are accepted — slug is immutable
 * (it is a live URL), and there is no DELETE.
 */
export const PUT: APIRoute = async ({ request, params }) => {
  const email = await requireAdmin(request);
  if (!email) return json({ error: 'unauthorized' }, 401);
  const id = Number(params.id);
  if (!Number.isFinite(id)) return json({ error: 'invalid id' }, 400);

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Requête invalide.' }, 400);
  }

  const title = String(body?.title ?? '').trim();
  if (!title) return json({ error: 'Le titre est obligatoire.' }, 400);

  try {
    const db = await getDB();
    await ensureSchema(db);
    const page = await updatePage(
      db,
      id,
      {
        title,
        seo_title: String(body?.seo_title ?? ''),
        seo_description: String(body?.seo_description ?? ''),
        body_html: String(body?.body_html ?? ''),
      },
      email,
    );
    return page ? json(page) : json({ error: 'not found' }, 404);
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
};
