export const prerender = false;
import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import { getDB, ensureSchema, listPages } from '../../../../lib/pages-db';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** List the legal pages. No POST: legal pages are a fixed set (see pages-db). */
export const GET: APIRoute = async ({ request }) => {
  if (!(await requireAdmin(request))) return json({ error: 'unauthorized' }, 401);
  try {
    const db = await getDB();
    await ensureSchema(db);
    return json({ pages: await listPages(db) });
  } catch (e: any) {
    return json({ error: String(e?.message || e) }, 500);
  }
};
