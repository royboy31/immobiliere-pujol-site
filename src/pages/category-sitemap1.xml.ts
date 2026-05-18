// Category sitemap — matches live WP category-sitemap1.xml
export const prerender = false;

import type { APIRoute } from 'astro';
import { entry, wrapUrlset, xmlResponse } from '../lib/sitemap';

export const GET: APIRoute = async ({ request }) => {
  const urls: string[] = [];

  try {
    const origin = new URL(request.url).origin;
    const resp = await fetch(`${origin}/_data/sitemap-slugs.json`);
    if (resp.ok) {
      const data = (await resp.json()) as { categories: string[] };
      for (const slug of data.categories) {
        urls.push(entry(`/categorie/${slug}/`));
      }
    }
  } catch { /* skip */ }

  return xmlResponse(wrapUrlset(urls));
};
