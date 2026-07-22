// GET /api/admin-pujol/newsletter/articles?limit=40  (guarded)
// Feeds the blog-template article picker. Sources the live published articles
// from the content collection (getCollection('articles')), newest first.
export const prerender = false;

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { requireAdmin } from '../../../../lib/admin-guard';

const SITE = 'https://www.immobiliere-pujol.fr';

export const GET: APIRoute = async ({ request, url }) => {
  const admin = await requireAdmin(request);
  if (!admin) return new Response('Unauthorized', { status: 401 });

  const limit = Math.min(Number(url.searchParams.get('limit')) || 40, 100);
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();

  const all = await getCollection('articles');
  let items = all
    .map((e) => {
      const d = e.data;
      const slug = d.slug || e.id.replace(/\.md$/, '');
      return {
        slug,
        title: d.title,
        excerpt: d.excerpt || '',
        featuredImage: d.featuredImage || '',
        date: d.date || '',
        url: `${SITE}/${slug}/`,
      };
    })
    // /local/ SEO landing pages are picked/linked from their own hub, never here.
    .filter((a) => !a.slug.startsWith('local/'))
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  if (q) items = items.filter((a) => a.title.toLowerCase().includes(q));
  return Response.json(items.slice(0, limit));
};
