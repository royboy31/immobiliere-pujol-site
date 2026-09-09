// POST /api/admin-pujol/articles/bulk-categories/ → category-only bulk update
export const prerender = false;

import type { APIRoute } from 'astro';
import { requireAdmin } from '../../../../lib/admin-guard';
import {
  BLOG_THEMES,
  bulkUpdateArticleCategories,
  ensureSchema,
  getDB,
  listStoredArticleCategories,
} from '../../../../lib/blog-db';
import { parseBulkCategoryRequest } from '../../../../lib/blog-bulk-categories';

export const POST: APIRoute = async ({ request }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const db = await getDB();
  await ensureSchema(db);
  const storedCategories = await listStoredArticleCategories(db);
  const allowedCategories = [...storedCategories, ...BLOG_THEMES.map((theme) => theme.value)];

  try {
    const body: unknown = await request.json();
    const input = parseBulkCategoryRequest(body, allowedCategories);
    const updated = await bulkUpdateArticleCategories(db, input.ids, input.operation, input.category);
    return Response.json({ updated, requested: input.ids.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Requête invalide';
    return new Response(message, { status: 400 });
  }
};
